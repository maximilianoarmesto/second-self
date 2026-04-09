#!/bin/sh
set -e

echo "Ensuring uploads directory exists and is writable..."
mkdir -p /app/public/uploads
chown -R node:node /app/public/uploads 2>/dev/null || true

echo "Pushing database schema..."
npx prisma db push --config=prisma.config.ts

echo "Seeding database..."
npx tsx prisma/seed.ts || true

echo "Starting server..."
node server.js
