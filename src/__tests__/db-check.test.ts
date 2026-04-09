/**
 * Verifies that the Jest setup file (setup-env.ts) correctly populates
 * the database-related environment variables before any test module runs.
 *
 * These are "always-pass" smoke checks that confirm the test infrastructure
 * is correctly configured, regardless of whether a real database is reachable.
 */

describe('setup-env: database environment variables', () => {
  it('PRISMA_DATABASE_URL is set to a non-empty string by setup-env.ts', () => {
    expect(typeof process.env.PRISMA_DATABASE_URL).toBe('string');
    expect(process.env.PRISMA_DATABASE_URL!.length).toBeGreaterThan(0);
  });

  it('DATABASE_URL is set to a non-empty string by setup-env.ts', () => {
    expect(typeof process.env.DATABASE_URL).toBe('string');
    expect(process.env.DATABASE_URL!.length).toBeGreaterThan(0);
  });

  it('JWT_SECRET is set to a non-empty string by setup-env.ts', () => {
    expect(typeof process.env.JWT_SECRET).toBe('string');
    expect(process.env.JWT_SECRET!.length).toBeGreaterThan(0);
  });

  it('PRISMA_DATABASE_URL is a valid PostgreSQL connection string', () => {
    const url = process.env.PRISMA_DATABASE_URL!;
    expect(url).toMatch(/^postgresql?:\/\//);
  });
});
