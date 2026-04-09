/**
 * Unit tests for prisma/seed.ts
 *
 * All external dependencies (PrismaClient, @prisma/adapter-pg, bcryptjs) are
 * mocked so the tests remain deterministic and require no running database.
 *
 * Tests verify:
 *  1.  User is upserted with a bcrypt-hashed password (not plaintext)
 *  2.  Owner is upserted for backwards-compatibility (ownerId = 1)
 *  3.  Settings record is upserted for the new user (userId) and owner (ownerId)
 *  4.  Email defaults to "admin@example.com" when SEED_USER_EMAIL is unset
 *  5.  Email is sourced from SEED_USER_EMAIL when the env var is set
 *  6.  Password defaults to "changeme123" when SEED_USER_PASSWORD is unset
 *  7.  Password is sourced from SEED_USER_PASSWORD when the env var is set
 *  8.  Email is normalised to lowercase before the upsert
 *  9.  Settings upsert uses the user id returned by the user upsert
 * 10.  bcrypt is called with BCRYPT_SALT_ROUNDS = 12
 * 11.  $disconnect is always called (even on success)
 * 12.  Name defaults to "My Second Self" when SEED_USER_NAME is unset
 * 13.  Name is sourced from SEED_USER_NAME when the env var is set
 */

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockUserUpsert = jest.fn();
const mockOwnerUpsert = jest.fn();
const mockSettingsUpsert = jest.fn();
const mockDisconnect = jest.fn();
const mockBcryptHash = jest.fn();

// Paths are relative to this file (src/__tests__/) so they resolve correctly.
jest.mock('../generated/prisma', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { upsert: (...args: unknown[]) => mockUserUpsert(...args) },
    owner: { upsert: (...args: unknown[]) => mockOwnerUpsert(...args) },
    settings: { upsert: (...args: unknown[]) => mockSettingsUpsert(...args) },
    $disconnect: () => mockDisconnect(),
  })),
}));

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { hash: (...args: unknown[]) => mockBcryptHash(...args) },
  hash: (...args: unknown[]) => mockBcryptHash(...args),
}));

// ---------------------------------------------------------------------------
// Constants shared across tests
// ---------------------------------------------------------------------------

const MOCK_USER_ID = 7;
const MOCK_OWNER_ID = 1;
const MOCK_HASHED_PASSWORD = '$2b$12$mockedhashvalue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute the seed script inside an isolated module registry so that each
 * test gets a fresh evaluation of `main()` and env var mutations take effect.
 *
 * `jest.isolateModules` + synchronous `require` is the idiomatic Jest way to
 * re-run top-level module side-effects between tests.
 */
function runSeed(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    jest.isolateModules(() => {
      try {
        // The seed lives at prisma/seed.ts — from this test file the relative
        // path traverses up two levels (src/__tests__ → project root) then
        // into prisma/.
        require('../../prisma/seed');
        // Allow the async main() invocation at the bottom of seed.ts to settle.
        setImmediate(resolve);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Default happy-path mock implementations
// ---------------------------------------------------------------------------

function setupHappyPath(): void {
  mockBcryptHash.mockResolvedValue(MOCK_HASHED_PASSWORD);
  mockUserUpsert.mockResolvedValue({
    id: MOCK_USER_ID,
    email: 'admin@example.com',
    name: 'My Second Self',
  });
  mockOwnerUpsert.mockResolvedValue({
    id: MOCK_OWNER_ID,
    email: 'admin@example.com',
    cloneName: 'My Second Self',
  });
  mockSettingsUpsert.mockResolvedValue({
    id: 1,
    ownerId: MOCK_OWNER_ID,
    userId: MOCK_USER_ID,
  });
  mockDisconnect.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prisma/seed.ts', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Work on a shallow copy so env mutations don't leak between tests.
    process.env = { ...originalEnv };
    delete process.env.SEED_USER_EMAIL;
    delete process.env.SEED_USER_PASSWORD;
    delete process.env.SEED_USER_NAME;
    setupHappyPath();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // -------------------------------------------------------------------------
  // 1. User upserted with a hashed password (not plaintext)
  // -------------------------------------------------------------------------
  it('upserts the User with a bcrypt-hashed password, never the plaintext', async () => {
    await runSeed();

    expect(mockUserUpsert).toHaveBeenCalledTimes(1);
    const [call] = mockUserUpsert.mock.calls;
    const createData = (call[0] as { create: Record<string, unknown> }).create;

    expect(createData.passwordHash).toBe(MOCK_HASHED_PASSWORD);
    expect(createData.passwordHash).not.toBe('changeme123');
  });

  // -------------------------------------------------------------------------
  // 2. Owner upserted for backwards-compatibility
  // -------------------------------------------------------------------------
  it('upserts the legacy Owner row for backwards-compatibility', async () => {
    await runSeed();

    expect(mockOwnerUpsert).toHaveBeenCalledTimes(1);
    const [call] = mockOwnerUpsert.mock.calls;
    const where = (call[0] as { where: Record<string, unknown> }).where;

    // Legacy owner is always id = 1.
    expect(where.id).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 3. Settings record is upserted with both userId and ownerId
  // -------------------------------------------------------------------------
  it('upserts a Settings record linked to both the User and the Owner', async () => {
    await runSeed();

    expect(mockSettingsUpsert).toHaveBeenCalledTimes(1);
    const [call] = mockSettingsUpsert.mock.calls;
    const createData = (call[0] as { create: Record<string, unknown> }).create;

    expect(createData.ownerId).toBe(MOCK_OWNER_ID);
    expect(createData.userId).toBe(MOCK_USER_ID);
  });

  // -------------------------------------------------------------------------
  // 4. Default email when SEED_USER_EMAIL is unset
  // -------------------------------------------------------------------------
  it('defaults to "admin@example.com" when SEED_USER_EMAIL is not set', async () => {
    await runSeed();

    const [call] = mockUserUpsert.mock.calls;
    const where = (call[0] as { where: Record<string, unknown> }).where;

    expect(where.email).toBe('admin@example.com');
  });

  // -------------------------------------------------------------------------
  // 5. Email sourced from SEED_USER_EMAIL env var
  // -------------------------------------------------------------------------
  it('uses SEED_USER_EMAIL when the env var is provided', async () => {
    process.env.SEED_USER_EMAIL = 'custom@example.com';

    await runSeed();

    const [call] = mockUserUpsert.mock.calls;
    const where = (call[0] as { where: Record<string, unknown> }).where;

    expect(where.email).toBe('custom@example.com');
  });

  // -------------------------------------------------------------------------
  // 6. Default password when SEED_USER_PASSWORD is unset
  // -------------------------------------------------------------------------
  it('defaults the password to "changeme123" when SEED_USER_PASSWORD is not set', async () => {
    await runSeed();

    expect(mockBcryptHash).toHaveBeenCalledWith('changeme123', 12);
  });

  // -------------------------------------------------------------------------
  // 7. Password sourced from SEED_USER_PASSWORD env var
  // -------------------------------------------------------------------------
  it('uses SEED_USER_PASSWORD when the env var is provided', async () => {
    process.env.SEED_USER_PASSWORD = 'supersecret99';

    await runSeed();

    expect(mockBcryptHash).toHaveBeenCalledWith('supersecret99', 12);
  });

  // -------------------------------------------------------------------------
  // 8. Email is normalised to lowercase
  // -------------------------------------------------------------------------
  it('normalises the email to lowercase before upserting', async () => {
    process.env.SEED_USER_EMAIL = 'Admin@EXAMPLE.COM';

    await runSeed();

    const [call] = mockUserUpsert.mock.calls;
    const where = (call[0] as { where: Record<string, unknown> }).where;
    const createData = (call[0] as { create: Record<string, unknown> }).create;

    expect(where.email).toBe('admin@example.com');
    expect(createData.email).toBe('admin@example.com');
  });

  // -------------------------------------------------------------------------
  // 9. Settings upsert uses the user id returned by the user upsert
  // -------------------------------------------------------------------------
  it('passes the user id returned by the user upsert to the settings upsert', async () => {
    const customUserId = 42;
    mockUserUpsert.mockResolvedValue({
      id: customUserId,
      email: 'admin@example.com',
      name: 'My Second Self',
    });

    await runSeed();

    const [call] = mockSettingsUpsert.mock.calls;
    const createData = (call[0] as { create: Record<string, unknown> }).create;

    expect(createData.userId).toBe(customUserId);
  });

  // -------------------------------------------------------------------------
  // 10. bcrypt called with 12 salt rounds
  // -------------------------------------------------------------------------
  it('calls bcrypt.hash with exactly 12 salt rounds', async () => {
    await runSeed();

    expect(mockBcryptHash).toHaveBeenCalledTimes(1);
    const [, saltRounds] = mockBcryptHash.mock.calls[0] as [string, number];
    expect(saltRounds).toBe(12);
  });

  // -------------------------------------------------------------------------
  // 11. $disconnect is always called
  // -------------------------------------------------------------------------
  it('calls $disconnect after a successful seed', async () => {
    await runSeed();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 12. Default name when SEED_USER_NAME is unset
  // -------------------------------------------------------------------------
  it('defaults to "My Second Self" when SEED_USER_NAME is not set', async () => {
    await runSeed();

    const [call] = mockUserUpsert.mock.calls;
    const createData = (call[0] as { create: Record<string, unknown> }).create;

    expect(createData.name).toBe('My Second Self');
  });

  // -------------------------------------------------------------------------
  // 13. Name sourced from SEED_USER_NAME env var
  // -------------------------------------------------------------------------
  it('uses SEED_USER_NAME when the env var is provided', async () => {
    process.env.SEED_USER_NAME = 'Alice Smith';

    await runSeed();

    const [call] = mockUserUpsert.mock.calls;
    const createData = (call[0] as { create: Record<string, unknown> }).create;

    expect(createData.name).toBe('Alice Smith');
  });
});
