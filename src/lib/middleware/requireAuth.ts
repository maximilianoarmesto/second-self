/**
 * `requireAuth` — API route handler wrapper that enforces authentication.
 *
 * Wraps a Next.js App Router route handler and returns a `401 Unauthorized`
 * JSON response when the request carries no valid session token. When the
 * token is valid, the decoded user identity (`userId`, `email`, `name`) is
 * injected into a context object that is passed as the second argument to the
 * wrapped handler.
 *
 * Usage:
 * ```ts
 * // src/app/api/some-protected/route.ts
 * import { requireAuth } from '@/lib/middleware/requireAuth';
 *
 * export const GET = requireAuth(async (req, ctx) => {
 *   const { userId, email, name } = ctx.auth;
 *   return NextResponse.json({ userId, email, name });
 * });
 * ```
 *
 * The wrapper is compatible with both plain route handlers
 * (`(req: NextRequest) => Promise<NextResponse>`) and dynamic-segment route
 * handlers that receive a `params` argument.
 *
 * Security notes:
 *  - Token verification is delegated to `getUserFromRequest` in `@/lib/auth`,
 *    which reads `JWT_SECRET` from the environment and returns `null` for any
 *    expired or tampered token.
 *  - The 401 response body is intentionally minimal to avoid leaking
 *    information about the token validation failure mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import type { TokenPayload } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The auth context injected into every wrapped handler upon successful
 * token verification.
 *
 * All three fields mirror the `TokenPayload` interface but `email` and `name`
 * are surfaced at the top level for ergonomics and are always present (though
 * they may be `null` for tokens minted before those fields were added).
 */
export interface AuthContext {
  auth: {
    /** Database primary key of the authenticated owner row. */
    userId: number;
    /** Owner's email address, or `null` when absent from the token. */
    email: string | null;
    /** Owner's display name (`cloneName`), or `null` when absent from the token. */
    name: string | null;
  };
}

/**
 * A Next.js App Router route handler that has been enriched with an
 * `AuthContext` second argument.
 *
 * The generic `TParams` allows dynamic-segment handlers to type their `params`
 * argument (e.g. `{ params: { id: string } }`). When omitted it defaults to
 * an empty object, which is the correct type for non-dynamic routes.
 */
export type AuthenticatedHandler<TParams = Record<string, never>> = (
  req: NextRequest,
  ctx: AuthContext & TParams
) => Promise<NextResponse> | NextResponse;

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

/**
 * Wrap a route handler with JWT authentication enforcement.
 *
 * The returned function is a standard Next.js App Router handler — it can be
 * exported directly as `GET`, `POST`, etc.
 *
 * When the incoming request carries a valid `session` cookie or
 * `Authorization: Bearer` header, the decoded `{ userId, email, name }` is
 * injected as `ctx.auth`. Otherwise a `401` JSON response is returned
 * immediately and the handler is never called.
 *
 * @param handler - The protected handler to invoke on successful auth.
 * @returns         A standard Next.js route handler function.
 *
 * @example
 * export const GET = requireAuth(async (req, ctx) => {
 *   return NextResponse.json({ userId: ctx.auth.userId });
 * });
 */
export function requireAuth<TParams = Record<string, never>>(
  handler: AuthenticatedHandler<TParams>
): (req: NextRequest, ctx?: TParams) => Promise<NextResponse> | NextResponse {
  return async function authenticatedHandler(
    req: NextRequest,
    ctx?: TParams
  ): Promise<NextResponse> {
    // --- Token extraction and verification -----------------------------------
    let payload: TokenPayload | null;

    try {
      payload = getUserFromRequest(req);
    } catch (err: unknown) {
      // getUserFromRequest only throws for a missing JWT_SECRET — a fatal
      // configuration error. Surface it as a 500 so it is not silently
      // swallowed as a 401.
      console.error('[requireAuth] Fatal configuration error:', err);
      return NextResponse.json(
        { error: 'Server configuration error.' },
        { status: 500 }
      );
    }

    // --- Authentication gate -------------------------------------------------
    if (!payload) {
      return NextResponse.json(
        { error: 'Unauthorized.' },
        { status: 401 }
      );
    }

    // --- Inject auth context and delegate ------------------------------------
    const authContext: AuthContext = {
      auth: {
        userId: payload.userId,
        email: payload.email,
        name: payload.name,
      },
    };

    // Merge the auth context with any existing route-level context (e.g. the
    // `params` object provided by Next.js for dynamic segments).
    const enrichedCtx = { ...ctx, ...authContext } as AuthContext & TParams;

    return handler(req, enrichedCtx);
  };
}
