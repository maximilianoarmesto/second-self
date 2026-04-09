import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_SALT_ROUNDS = 12;

// Matches the most common RFC-5322-inspired email format used in browsers.
// Intentionally simple — full RFC compliance is not required here.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// JWT expiry: 7 days expressed as a jsonwebtoken `expiresIn` string.
const JWT_EXPIRES_IN = '7d';

// Cookie max-age in seconds (7 days).
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

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
 * Mirrors the attributes used by the logout route so the browser correctly
 * tracks and deletes the cookie.
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

// ---------------------------------------------------------------------------
// POST /api/auth/signup
// ---------------------------------------------------------------------------

/**
 * Creates a new owner account (the single-owner model maps one Owner row to
 * one user). On success it:
 *  1. Validates the request body
 *  2. Checks for duplicate email (409 Conflict)
 *  3. Hashes the password with bcrypt (12 rounds)
 *  4. Creates the Owner row and a linked Settings row in one transaction
 *  5. Signs a JWT containing { userId, email, name }
 *  6. Returns 201 with { id, email, name } and sets an HttpOnly session cookie
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

  const { email, password, name } = (body ?? {}) as Record<string, unknown>;

  // name — must be a non-empty string
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json(
      { error: 'Name is required and must be a non-empty string.' },
      { status: 400 }
    );
  }

  // email — must be a string that matches a basic email pattern
  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return NextResponse.json(
      { error: 'A valid email address is required.' },
      { status: 400 }
    );
  }

  // password — must be a string of at least 8 characters
  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters long.' },
      { status: 400 }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  const trimmedName = name.trim();

  // ------------------------------------------------------------------
  // 2. Check for duplicate email
  // ------------------------------------------------------------------
  try {
    const existing = await prisma.owner.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email address already exists.' },
        { status: 409 }
      );
    }
  } catch (error: unknown) {
    console.error('[signup] Error checking for existing user:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }

  // ------------------------------------------------------------------
  // 3. Hash the password
  // ------------------------------------------------------------------
  let passwordHash: string;
  try {
    passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  } catch (error: unknown) {
    console.error('[signup] Error hashing password:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }

  // ------------------------------------------------------------------
  // 4. Create Owner + Settings in a single transaction
  // ------------------------------------------------------------------
  let owner: { id: number; email: string | null; cloneName: string };
  try {
    owner = await prisma.$transaction(async (tx) => {
      const newOwner = await tx.owner.create({
        data: {
          cloneName: trimmedName,
          email: normalizedEmail,
          passwordHash,
        },
        select: {
          id: true,
          email: true,
          cloneName: true,
        },
      });

      // Auto-create an empty Settings record linked to the new owner.
      await tx.settings.create({
        data: {
          ownerId: newOwner.id,
          cloneName: trimmedName,
        },
      });

      return newOwner;
    });
  } catch (error: unknown) {
    console.error('[signup] Error creating user:', error);

    // Handle unique-constraint violation raised by the DB (e.g. race condition
    // between the duplicate-check and the insert).
    const isUniqueViolation =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002';

    if (isUniqueViolation) {
      return NextResponse.json(
        { error: 'An account with this email address already exists.' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create account. Please try again.' },
      { status: 500 }
    );
  }

  // ------------------------------------------------------------------
  // 5. Sign the JWT
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
    console.error('[signup] Error signing JWT:', error);
    return NextResponse.json(
      { error: 'Account created but could not establish a session. Please log in.' },
      { status: 500 }
    );
  }

  // ------------------------------------------------------------------
  // 6. Return 201 with user info and the session cookie
  // ------------------------------------------------------------------
  const response = NextResponse.json(
    {
      id: owner.id,
      email: owner.email,
      name: owner.cloneName,
    },
    { status: 201 }
  );

  response.headers.set('Set-Cookie', buildSessionCookie(token));

  return response;
}
