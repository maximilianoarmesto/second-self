/**
 * Jest setupFiles entry-point.
 *
 * This file runs in every Jest worker *before* the test framework is
 * installed and before any module under test is first required.  It sets
 * environment variables that are read at call-time by application modules
 * (e.g. PRISMA_DATABASE_URL for the Prisma adapter, JWT_SECRET for the
 * auth helpers).
 *
 * Resolution order for PRISMA_DATABASE_URL:
 *  1. Already set in the environment (CI, .env injected by the test runner)
 *  2. Docker-internal hostname "postgres" — used when tests run inside the
 *     app container that is part of the docker-compose network.
 *  3. localhost:5488 — used when running tests directly on the host machine
 *     with the database port-forwarded via docker-compose.
 *
 * The value chosen here is the same for every test file so that the
 * module-level prisma singleton in src/lib/prisma.ts is initialised with a
 * consistent (and valid) connection string regardless of which test runs
 * first.
 */

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

if (!process.env.PRISMA_DATABASE_URL && !process.env.DATABASE_URL) {
  // Prefer the Docker-internal hostname when running inside the app container.
  // Fall back to the port-forwarded localhost address for local dev runs.
  const dockerInternal =
    'postgresql://secondself_user:secondself_pass@postgres:5432/secondself_db';
  const localDev =
    'postgresql://secondself_user:secondself_pass@localhost:5488/secondself_db';

  // Detect whether we are inside Docker by checking for the "postgres"
  // hostname in /etc/hosts (Docker populates this automatically for services
  // defined in the same compose network).  Because this file is CommonJS we
  // can use synchronous fs APIs safely.
  let useDockerUrl = false;
  try {
    const fs = require('fs') as typeof import('fs');
    const hosts = fs.readFileSync('/etc/hosts', 'utf8');
    useDockerUrl = hosts.includes('postgres');
  } catch {
    // If we can't read /etc/hosts we assume a local dev environment.
    useDockerUrl = false;
  }

  const resolvedUrl = useDockerUrl ? dockerInternal : localDev;
  process.env.PRISMA_DATABASE_URL = resolvedUrl;
  process.env.DATABASE_URL = resolvedUrl;
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

// Ensure a JWT secret is always present so tests that import auth modules
// do not throw "JWT_SECRET environment variable is not set".  Individual test
// files that need a specific secret override this in their own beforeAll.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'jest-default-test-jwt-secret';
}
