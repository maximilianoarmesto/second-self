# Second Self

A platform where you upload personal materials (PDFs, emails, writing samples) and create a digital version of yourself that can be chatted with. Built as a polished, local-first MVP.

## Features

- **Dashboard** — Stats overview with quick actions
- **Knowledge Base** — Upload PDFs, extract text, generate embeddings
- **Private Chat** — RAG-powered chat that speaks in your voice
- **Public Share** — Generate token-protected links for others to chat with your Second Self
- **Settings** — Configure clone name, OpenAI API key, tone, and behavior

## Tech Stack

- Next.js 14 (App Router, full-stack)
- TypeScript + Tailwind CSS
- PostgreSQL + pgvector
- Prisma ORM
- OpenAI API (embeddings + chat completions)
- Docker + docker-compose

## Quick Start (Docker)

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Start everything
docker compose up --build

# 3. Run database migrations and seed
docker compose exec app npx prisma db push --config=prisma.config.ts
docker compose exec app npx tsx prisma/seed.ts

# 4. Visit http://localhost:3066
# 5. Go to Settings and enter your OpenAI API key
# 6. Upload a PDF in the Knowledge Base
# 7. Start chatting with your Second Self
```

## Local Development (without Docker)

Requires: Node.js 18+, PostgreSQL 16 with pgvector extension.

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env — set PRISMA_DATABASE_URL to your PostgreSQL connection string

# 3. Generate Prisma client
npm run db:generate

# 4. Push schema to database
npm run db:push

# 5. Seed default data
npm run db:seed

# 6. Start dev server
npm run dev
```

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `PRISMA_DATABASE_URL` | PostgreSQL connection string | Yes |
| `POSTGRES_USER` | DB user (Docker) | For Docker |
| `POSTGRES_PASSWORD` | DB password (Docker) | For Docker |
| `POSTGRES_DB` | DB name (Docker) | For Docker |
| `OPENAI_API_KEY` | OpenAI key (can also set in UI) | Optional |

## Project Structure

```
src/
├── app/                    # Next.js pages and API routes
│   ├── api/               # Backend API routes
│   │   ├── chat/          # Chat endpoints
│   │   ├── clone/         # Public clone endpoints
│   │   ├── documents/     # Document upload/management
│   │   ├── settings/      # Settings endpoints
│   │   └── share-links/   # Share link management
│   ├── chat/              # Private chat page
│   ├── clone/[token]/     # Public chat page
│   ├── knowledge-base/    # Knowledge base + upload pages
│   ├── settings/          # Settings page
│   └── share/             # Share management page
├── components/            # React components
│   ├── layout/            # Sidebar, layout wrappers
│   ├── chat/              # Chat UI components
│   ├── documents/         # Document components
│   └── ui/                # Base UI components
├── lib/                   # Utilities and services
│   ├── services/          # Business logic
│   │   ├── chat-service.ts
│   │   ├── document-service.ts
│   │   └── rag-service.ts
│   ├── api.ts             # Client-side API wrapper
│   ├── openai.ts          # OpenAI client factory
│   ├── prisma.ts          # Prisma client singleton
│   └── utils.ts           # Utility functions
├── types/                 # TypeScript type definitions
└── generated/             # Generated Prisma client (gitignored)

prisma/
├── schema.prisma          # Database schema
└── seed.ts                # Seed script

database/
└── init/01_init.sql       # PostgreSQL init (pgvector extension)
```
