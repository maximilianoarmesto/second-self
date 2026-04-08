FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy everything from host (including node_modules via .dockerignore allowing it)
COPY . .

RUN mkdir -p public

# Reinstall platform-specific binaries for Linux (host node_modules are for macOS)
RUN npm rebuild
# Ensure the correct SWC binary is installed for this platform
RUN npm install @next/swc-linux-arm64-musl --save-optional 2>/dev/null || true
RUN npm install @next/swc-linux-arm64-gnu --save-optional 2>/dev/null || true

ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV PRISMA_DATABASE_URL="postgresql://build:build@localhost:5432/build"

RUN npx prisma generate --config=prisma.config.ts
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public

RUN mkdir -p public/uploads && chown -R nextjs:nodejs public/uploads

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy prisma schema, config, seed, generated client, and startup script
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/start.sh ./scripts/start.sh
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

# Copy node_modules for prisma CLI, tsx, and adapter dependencies needed at startup
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs

EXPOSE 3066

ENV PORT=3066
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "scripts/start.sh"]
