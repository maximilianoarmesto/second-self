// Prisma configuration for Next.js (Prisma 7+)
//
// The database connection URL is read from PRISMA_DATABASE_URL (preferred) or
// DATABASE_URL. The URL must use the standard postgresql:// scheme — NOT the
// postgresql+asyncpg:// scheme used by the Python backend's SQLAlchemy driver.
//
// Set this in frontend/.env.local for local development:
//   PRISMA_DATABASE_URL=postgresql://user:pass@localhost:5432/secondself_db
//
// Paths are resolved relative to this file (frontend/) so the config works
// regardless of where the Prisma CLI is invoked from.
//
// Docs: https://pris.ly/d/config-datasource

import path from "path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join(__dirname, "prisma/schema.prisma"),
  migrations: {
    path: path.join(__dirname, "prisma/migrations"),
  },
  datasource: {
    // Prefer a dedicated Prisma URL so it remains independent of the
    // backend's asyncpg-prefixed DATABASE_URL.
    url:
      process.env.PRISMA_DATABASE_URL ??
      process.env.DATABASE_URL?.replace("+asyncpg", "") ??
      "",
  },
});
