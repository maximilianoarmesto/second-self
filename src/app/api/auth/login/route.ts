import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// JWT expiry: 7 days expressed as a jsonwebtoken `expiresIn` string.
const JWT_EXPIRES_IN = '7d';

// Cookie max-age in seconds (7 days).
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * A pre-computed bcrypt hash used when no user record is found for the given
 * email. Running bcrypt.compare against this dummy hash ensures the response
 * time is indistinguishable from a real password comparison, defeating
 * timing-based user-enumeration attacks.
 *
 * The value is a valid bcrypt hash of the string "dummy" at 12 rounds and is
 * intentionally hard-coded so it is available synchronously without an extra
 * database or I/O call.
 */
const DUMMY_HASH =
  '$2b$12$KIXbqPBQDpWcDGa7gNHoaOLHNFEBBmmPCBLtXgzfS/tDN5bUTzxlW';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Build a `Set-Cookie` header value for the `session` HttpOnly cookie.
 * Mirrors the attributes used by the signup and logout routes so the browser
 * correctly tracks and deletes the cookie.
 */
function buildSessionCookie(token: string): string {
  const parts = [
    `session=${token}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
  ];

  // Only set Secure in production — dev server runs over plain HTTP.
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/** Generic 401 response — same message for wrong password and unknown email. */
function invalidCredentials(): NextResponse {
  return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

/**
 * Authenticates an existing owner by email and password. On success it:
 *  1. Validates the request body
 *  2. Looks up the owner by email (normalised to lowercase)
 *  3. Always calls bcrypt.compare to prevent timing-based user enumeration
 *  4. Signs a JWT containing { userId, email, name }
 *  5. Returns 200 with { id, email, name } and sets an HttpOnly session cookie
 *
 * Both "email not found" and "wrong password" return a generic 401 so callers
 * cannot distinguish between the two failure modes.
 */
export async function POST(request: NextRequest) {
  // ------------------------------------------------------------------
  // 1. Parse & validate the request body
  // ------------------------------------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== 'string' || email.trim().length === 0) {
    return NextResponse.json(
      { error: 'Email is required.' },
      { status: 400 }
    );
  }

  if (typeof password !== 'string' || password.length === 0) {
    return NextResponse.json(
      { error: 'Password is required.' },
      { status: 400 }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  // ------------------------------------------------------------------
  // 2. Look up the owner by email
  // ------------------------------------------------------------------
  let owner: {
    id: number;
    email: string | null;
    cloneName: string;
    passwordHash: string | null;
  } | null;

  try {
    owner = await prisma.owner.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        cloneName: true,
        passwordHash: true,
      },
    });
  } catch (error: unknown) {
    console.error('[login] Error looking up user:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }

  // ------------------------------------------------------------------
  // 3. Compare password — always run bcrypt.compare to mitigate timing attacks
  //
  //    When the owner is not found we compare against DUMMY_HASH so the
  //    response time is identical to a real hash comparison. The result is
  //    discarded; we return 401 either way.
  // ------------------------------------------------------------------
  const hashToCompare = owner?.passwordHash ?? DUMMY_HASH;

  let passwordMatches: boolean;
  try {
    passwordMatches = await bcrypt.compare(password, hashToCompare);
  } catch (error: unknown) {
    console.error('[login] Error comparing password:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }

  // Return the same generic error for both "no such email" and "wrong password".
  if (!owner || !passwordMatches) {
    return invalidCredentials();
  }

  // ------------------------------------------------------------------
  // 4. Sign the JWT
  // ------------------------------------------------------------------
  let token: string;
  try {
    const secret = getJwtSecret();
    token = jwt.sign(
      {
        userId: owner.id,
        email: owner.email,
        name: owner.cloneName,
      },
      secret,
      { expiresIn: JWT_EXPIRES_IN }
    );
  } catch (error: unknown) {
    console.error('[login] Error signing JWT:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }

  // ------------------------------------------------------------------
  // 5. Return 200 with user info and the session cookie
  // ------------------------------------------------------------------
  const response = NextResponse.json({
    id: owner.id,
    email: owner.email,
    name: owner.cloneName,
  });

  response.headers.set('Set-Cookie', buildSessionCookie(token));

  return response;
}
