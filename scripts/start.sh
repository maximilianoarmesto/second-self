#!/bin/sh
set -e

echo "Pushing database schema..."
npx prisma db push --config=prisma.config.ts

echo "Seeding database..."
npx tsx prisma/seed.ts || true

echo "Starting server..."
node server.js
