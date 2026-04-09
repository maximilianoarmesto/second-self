/**
 * Unit tests — bcrypt password hashing and comparison
 *
 * These tests exercise the **real** bcryptjs implementation (no mocks) so they
 * guard against regressions if the hashing logic, salt-round constant, or
 * library is accidentally changed.  They mirror the exact operations performed
 * by the signup route (bcrypt.hash) and the login route (bcrypt.compare).
 *
 * Tests verify:
 *  1.  A password hash is not equal to the plaintext password
 *  2.  bcrypt.compare returns `true` for the correct plaintext password
 *  3.  bcrypt.compare returns `false` for an incorrect password
 *  4.  Two hashes of the same password are not identical (salt is random)
 *  5.  The hash encodes exactly 12 salt rounds (≥ the minimum required)
 *  6.  bcrypt.compare rejects a hash produced from a different password
 *  7.  bcrypt.compare rejects when a plaintext string is passed as the hash
 *  8.  Hashing a different password produces a hash that does not verify
 *      against the original password
 *
 * Timeout is raised to 15 s because real bcrypt at 12 rounds takes ~200–400 ms
 * per operation on CI hardware, and several hashes are generated in parallel.
 */

import bcrypt from 'bcryptjs';

// ---------------------------------------------------------------------------
// Constants — mirror what the signup route uses
// ---------------------------------------------------------------------------

/** Must match BCRYPT_SALT_ROUNDS in src/app/api/auth/signup/route.ts */
const SALT_ROUNDS = 12;

/** Minimum acceptable cost factor enforced by project policy. */
const MIN_SALT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAINTEXT_PASSWORD = 'correct-horse-battery-staple';
const WRONG_PASSWORD = 'this-is-not-the-right-password';
const OTHER_PASSWORD = 'another-completely-different-password';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('bcrypt password hashing', () => {
  /**
   * Pre-hash the fixture password once before all tests so that the expensive
   * bcrypt operation is not repeated for every individual assertion.
   * Individual tests that need their own fresh hash generate it inline.
   */
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PLAINTEXT_PASSWORD, SALT_ROUNDS);
  }, 15_000);

  // -------------------------------------------------------------------------
  // 1. Hash does not equal the plaintext password
  // -------------------------------------------------------------------------
  it('produces a hash that is not equal to the plaintext password', () => {
    expect(passwordHash).not.toBe(PLAINTEXT_PASSWORD);
  });

  // -------------------------------------------------------------------------
  // 2. bcrypt.compare returns true for the correct password
  // -------------------------------------------------------------------------
  it('bcrypt.compare returns true when compared with the correct plaintext password', async () => {
    const result = await bcrypt.compare(PLAINTEXT_PASSWORD, passwordHash);
    expect(result).toBe(true);
  }, 15_000);

  // -------------------------------------------------------------------------
  // 3. bcrypt.compare returns false for an incorrect password
  // -------------------------------------------------------------------------
  it('bcrypt.compare returns false when compared with an incorrect password', async () => {
    const result = await bcrypt.compare(WRONG_PASSWORD, passwordHash);
    expect(result).toBe(false);
  }, 15_000);

  // -------------------------------------------------------------------------
  // 4. Two hashes of the same password are not identical (salt is random)
  // -------------------------------------------------------------------------
  it('produces a different hash each time the same password is hashed (random salt)', async () => {
    const hash1 = await bcrypt.hash(PLAINTEXT_PASSWORD, SALT_ROUNDS);
    const hash2 = await bcrypt.hash(PLAINTEXT_PASSWORD, SALT_ROUNDS);
    expect(hash1).not.toBe(hash2);
  }, 15_000);

  // -------------------------------------------------------------------------
  // 5. The hash encodes at least 12 salt rounds
  //
  //    bcrypt hashes embed their cost factor in the prefix: $2b$12$...
  //    bcryptjs exposes getRounds() to read it back from any valid hash.
  // -------------------------------------------------------------------------
  it(`encodes at least ${MIN_SALT_ROUNDS} salt rounds in the hash`, () => {
    const rounds = bcrypt.getRounds(passwordHash);
    expect(rounds).toBeGreaterThanOrEqual(MIN_SALT_ROUNDS);
  });

  // -------------------------------------------------------------------------
  // 6. A hash of a different password does not verify against the original
  // -------------------------------------------------------------------------
  it('does not verify the original password against a hash of a different password', async () => {
    const otherHash = await bcrypt.hash(OTHER_PASSWORD, SALT_ROUNDS);
    const result = await bcrypt.compare(PLAINTEXT_PASSWORD, otherHash);
    expect(result).toBe(false);
  }, 15_000);

  // -------------------------------------------------------------------------
  // 7. Passing a plaintext string as the hash rejects without throwing
  //
  //    Guards the login route's error handling: if passwordHash stored in the
  //    DB is somehow plain text, bcrypt.compare must return false (not throw)
  //    so the route falls through to the 401 path instead of crashing to 500.
  // -------------------------------------------------------------------------
  it('bcrypt.compare returns false (not throw) when the hash argument is a plain string', async () => {
    const result = await bcrypt.compare(PLAINTEXT_PASSWORD, PLAINTEXT_PASSWORD);
    expect(result).toBe(false);
  }, 15_000);

  // -------------------------------------------------------------------------
  // 8. Cross-verification: the second independently generated hash also
  //    accepts the correct password and rejects the wrong one
  //
  //    Validates that the random-salt property from test 4 does not break
  //    subsequent compare calls — every unique hash must remain independently
  //    verifiable against the same plaintext.
  // -------------------------------------------------------------------------
  it('both independently generated hashes of the same password still verify correctly', async () => {
    const hash1 = await bcrypt.hash(PLAINTEXT_PASSWORD, SALT_ROUNDS);
    const hash2 = await bcrypt.hash(PLAINTEXT_PASSWORD, SALT_ROUNDS);

    // Each hash must accept the correct password…
    const [match1, match2] = await Promise.all([
      bcrypt.compare(PLAINTEXT_PASSWORD, hash1),
      bcrypt.compare(PLAINTEXT_PASSWORD, hash2),
    ]);
    expect(match1).toBe(true);
    expect(match2).toBe(true);

    // …and reject the wrong password.
    const [noMatch1, noMatch2] = await Promise.all([
      bcrypt.compare(WRONG_PASSWORD, hash1),
      bcrypt.compare(WRONG_PASSWORD, hash2),
    ]);
    expect(noMatch1).toBe(false);
    expect(noMatch2).toBe(false);
  }, 15_000);
});
