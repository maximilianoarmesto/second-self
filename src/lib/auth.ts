/**
 * JWT utility module.
 *
 * Provides three exports consumed by API route handlers and middleware:
 *
 *  - `signToken(payload)`       — mint a signed JWT valid for 7 days
 *  - `verifyToken(token)`       — verify a token and return its typed payload
 *  - `getUserFromRequest(req)`  — extract + verify the token from an incoming
 *                                 Next.js Request, reading first from the
 *                                 `Authorization: Bearer <token>` header, then
 *                                 falling back to the `session` HttpOnly cookie
 *
 * All three functions throw (or return `null`) rather than swallowing errors
 * silently, so callers can decide on the appropriate HTTP response.
 *
 * Security notes:
 *  - The signing secret is read exclusively from `JWT_SECRET` env var.
 *    The module throws at call-time (not at import-time) so unit tests that
 *    do not exercise auth paths are not broken by a missing env var.
 *  - No secret is ever hard-coded in this file.
 *  - Tokens are signed with HS256 (jsonwebtoken default for string secrets).
 */

import jwt from 'jsonwebtoken';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 7 days — expressed as a jsonwebtoken `expiresIn` string. */
const JWT_EXPIRES_IN = '7d';

/** Name of the HttpOnly cookie set by the login / signup routes. */
const SESSION_COOKIE_NAME = 'session';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The shape of data embedded inside every JWT issued by this application.
 *
 * All three fields are optional at the type level because `verifyToken` also
 * accepts tokens that were minted before `email` or `name` were added to the
 * payload schema — callers should treat absent fields as `null`.
 */
export interface TokenPayload {
  /** Database primary key of the authenticated owner row. */
  userId: number;
  /** Owner's email address, or `null` when not stored on the token. */
  email: string | null;
  /** Owner's display name (`cloneName`), or `null` when not on the token. */
  name: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the JWT signing secret from the environment.
 *
 * Throws a descriptive `Error` when `JWT_SECRET` is absent so the problem is
 * caught during development rather than silently producing unsigned tokens.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not set. ' +
        'Add it to your .env file before starting the server.'
    );
  }
  return secret;
}

/**
 * Extract a raw Bearer token string from an `Authorization` header value.
 *
 * Returns `null` when the header is missing or does not follow the
 * `Bearer <token>` scheme.
 */
function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

  return token;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mint a signed JWT containing the supplied payload.
 *
 * The token is signed with `JWT_SECRET` and expires after 7 days.
 * Throws when `JWT_SECRET` is not set.
 *
 * @param payload - Data to embed in the token (`userId`, `email`, `name`).
 * @returns        The signed JWT string.
 *
 * @example
 * const token = signToken({ userId: 1, email: 'a@b.com', name: 'Alice' });
 */
export function signToken(payload: TokenPayload): string {
  const secret = getJwtSecret();

  return jwt.sign(payload, secret, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify a JWT and return its decoded payload.
 *
 * Returns `null` (instead of throwing) when the token is expired, tampered
 * with, or otherwise invalid. This keeps call-sites free of try/catch for the
 * common "bad token → 401" flow.
 *
 * Throws only when `JWT_SECRET` is not set (a configuration error that should
 * surface immediately, not be silently swallowed as an auth failure).
 *
 * @param token - The raw JWT string to verify.
 * @returns       The decoded `TokenPayload`, or `null` if verification fails.
 *
 * @example
 * const payload = verifyToken(token);
 * if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 */
export function verifyToken(token: string): TokenPayload | null {
  const secret = getJwtSecret();

  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload & {
      userId?: unknown;
      email?: unknown;
      name?: unknown;
    };

    // Guard against a token that was signed with a different payload schema.
    if (typeof decoded.userId !== 'number') return null;

    return {
      userId: decoded.userId,
      email: typeof decoded.email === 'string' ? decoded.email : null,
      name: typeof decoded.name === 'string' ? decoded.name : null,
    };
  } catch {
    // Covers: JsonWebTokenError, TokenExpiredError, NotBeforeError
    return null;
  }
}

/**
 * Extract and verify the session token from an incoming Next.js `Request`.
 *
 * Token resolution order:
 *  1. `Authorization: Bearer <token>` request header
 *  2. `session` HttpOnly cookie
 *
 * Returns `null` when no token is present or the token is invalid/expired.
 * Throws only when `JWT_SECRET` is not set.
 *
 * @param req - The incoming Next.js `Request` or `NextRequest` object.
 * @returns     The verified `TokenPayload`, or `null` if unauthenticated.
 *
 * @example
 * const user = getUserFromRequest(req);
 * if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 */
export function getUserFromRequest(req: Request | NextRequest): TokenPayload | null {
  // 1. Try the Authorization header first (useful for programmatic API clients)
  const bearerToken = extractBearerToken(req.headers.get('authorization'));
  if (bearerToken) {
    return verifyToken(bearerToken);
  }

  // 2. Fall back to the HttpOnly session cookie (used by the browser client)
  //    NextRequest exposes a `cookies` API; plain Request does not.
  //    We read the Cookie header manually so this function works with both.
  const cookieHeader = req.headers.get('cookie');
  if (cookieHeader) {
    const sessionToken = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME);
    if (sessionToken) {
      return verifyToken(sessionToken);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cookie parsing — internal helper
// ---------------------------------------------------------------------------

/**
 * Parse a single named cookie value out of a raw `Cookie:` header string.
 *
 * Returns `null` when the named cookie is not present.
 *
 * @example
 * parseCookieValue('session=abc; other=xyz', 'session') // → 'abc'
 * parseCookieValue('other=xyz', 'session')              // → null
 */
function parseCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;

    const cookieName = part.slice(0, eqIdx).trim();
    if (cookieName === name) {
      return part.slice(eqIdx + 1).trim() || null;
    }
  }
  return null;
}
