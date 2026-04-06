# Second Self

An AI-powered personal assistant built with Next.js, FastAPI, LangChain, and OpenAI.

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 14, TypeScript, Tailwind CSS, Axios |
| **Backend** | FastAPI, Python 3.11+, SQLAlchemy (async), Alembic |
| **AI / ML** | OpenAI API (`gpt-3.5-turbo`), LangChain |
| **Database** | PostgreSQL 15 |
| **Cache / Queue** | Redis 7, Celery |
| **Infrastructure** | Docker, Docker Compose |

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Prerequisites](#prerequisites)
3. [Environment Variables](#environment-variables)
4. [Quick Start — Docker Compose](#quick-start--docker-compose-recommended)
5. [Local Development Setup](#local-development-setup-without-docker)
6. [Makefile Shortcuts](#makefile-shortcuts)
7. [API Reference](#api-reference)
8. [Database Migrations](#database-migrations)
9. [Running Tests](#running-tests)
10. [Code Quality](#code-quality)
11. [Docker Commands Reference](#docker-commands-reference)
12. [Troubleshooting](#troubleshooting)
13. [Contributing](#contributing)

---

## Project Structure

```
second-self/
├── frontend/               # Next.js application (port 3000)
│   ├── src/
│   │   ├── app/            # App Router pages and layouts
│   │   ├── components/ui/  # Reusable UI components
│   │   └── lib/            # API client and utilities
│   ├── Dockerfile
│   └── package.json
├── backend/                # FastAPI application (port 8000)
│   ├── app/
│   │   ├── api/api_v1/     # Versioned API routes
│   │   ├── core/           # Config and security
│   │   ├── db/             # Database engine and session
│   │   ├── models/         # SQLAlchemy ORM models
│   │   ├── schemas/        # Pydantic request/response schemas
│   │   └── services/       # Business logic (AI, chat, users)
│   ├── alembic/            # Database migrations
│   ├── Dockerfile
│   └── requirements.txt
├── database/
│   └── init/01_init.sql    # PostgreSQL initialisation script
├── docker-compose.yml
├── Makefile                # Developer shortcuts
└── .env.example            # Template for environment variables
```

---

## Prerequisites

| Tool | Minimum version | Install |
|---|---|---|
| Docker | 24+ | <https://docs.docker.com/get-docker/> |
| Docker Compose | 2.20+ | Included with Docker Desktop |
| Node.js | 18+ | Only needed for local frontend development |
| Python | 3.11+ | Only needed for local backend development |
| OpenAI API key | — | <https://platform.openai.com/api-keys> |

> **Docker Desktop users:** Docker Compose v2 is bundled — no separate installation needed.

---

## Environment Variables

### Setup

Copy the example file and fill in your values before running anything:

```bash
cp .env.example .env
```

Then open `.env` in your editor and replace the placeholder values (at minimum `OPENAI_API_KEY` and `SECRET_KEY`).

### Generating a `SECRET_KEY`

The `SECRET_KEY` is used to sign JWTs. Generate a cryptographically secure value with:

```bash
# Python (recommended)
python -c "import secrets; print(secrets.token_hex(32))"

# OpenSSL
openssl rand -hex 32
```

### Full Variable Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | No¹ | assembled from parts | Full async DB URL — must use `postgresql+asyncpg://` scheme |
| `POSTGRES_SERVER` | Yes | `localhost` | PostgreSQL host (use `postgres` when running inside Docker) |
| `POSTGRES_USER` | Yes | `secondself_user` | PostgreSQL username |
| `POSTGRES_PASSWORD` | **Yes** | — | PostgreSQL password — change from the default |
| `POSTGRES_DB` | Yes | `secondself_db` | PostgreSQL database name |
| `POSTGRES_PORT` | Yes | `5432` | PostgreSQL port |
| `OPENAI_API_KEY` | **Yes** | — | OpenAI API key — the app will not work without this |
| `OPENAI_MODEL` | No | `gpt-3.5-turbo` | OpenAI model name (`gpt-4`, `gpt-4o`, etc.) |
| `SECRET_KEY` | **Yes** | — | JWT signing secret — must be unique and kept private |
| `ENVIRONMENT` | No | `development` | `development` or `production` |
| `LOG_LEVEL` | No | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL` |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `CELERY_BROKER_URL` | No | `redis://localhost:6379/0` | Celery broker URL |
| `CELERY_RESULT_BACKEND` | No | `redis://localhost:6379/0` | Celery result backend URL |
| `LANGCHAIN_TRACING_V2` | No | `false` | Enable LangSmith tracing |
| `LANGCHAIN_API_KEY` | No | — | LangSmith API key (only needed when tracing is enabled) |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:8000` | Backend URL used by the browser |
| `NEXT_PUBLIC_APP_NAME` | No | `Second Self` | Application display name |

> ¹ If `DATABASE_URL` is omitted, it is assembled automatically from the individual `POSTGRES_*` variables.  
> **The `DATABASE_URL` must use the `postgresql+asyncpg://` scheme** (not plain `postgresql://`) because the backend uses SQLAlchemy's async engine.

### Example `.env` for local development

```dotenv
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://secondself_user:secondself_pass@localhost:5432/secondself_db
POSTGRES_SERVER=localhost
POSTGRES_USER=secondself_user
POSTGRES_PASSWORD=secondself_pass
POSTGRES_DB=secondself_db
POSTGRES_PORT=5432

# ── OpenAI ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...                      # required
OPENAI_MODEL=gpt-3.5-turbo

# ── Application ───────────────────────────────────────────────────────────────
SECRET_KEY=a1b2c3...                       # generate with: python -c "import secrets; print(secrets.token_hex(32))"
ENVIRONMENT=development
LOG_LEVEL=INFO

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# ── LangChain (optional) ──────────────────────────────────────────────────────
LANGCHAIN_TRACING_V2=false
LANGCHAIN_API_KEY=

# ── Frontend ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_NAME=Second Self
```

> **Docker Compose note:** When running with Docker Compose, you do **not** need to change `POSTGRES_SERVER`, `REDIS_URL`, `CELERY_BROKER_URL`, or `CELERY_RESULT_BACKEND` — the Compose file automatically overrides these with the correct container hostnames. Only `OPENAI_API_KEY` and `SECRET_KEY` must be set by you.

---

## Quick Start — Docker Compose (recommended)

This workflow builds and starts all four services (frontend, backend, PostgreSQL, Redis) with a single command. PostgreSQL is initialised automatically on the first run.

### Step 1 — Clone the repository

```bash
git clone <repository-url>
cd second-self
```

### Step 2 — Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set the two required values:

```dotenv
OPENAI_API_KEY=sk-...          # your real OpenAI API key
SECRET_KEY=<generated-secret>  # output of: python -c "import secrets; print(secrets.token_hex(32))"
```

### Step 3 — Build and start all services

```bash
docker compose up --build
```

Docker Compose will:
1. Build the backend and frontend images
2. Start PostgreSQL and Redis, waiting until both pass their health checks
3. Start the backend (waits for DB and Redis to be healthy)
4. Start the frontend (waits for the backend to be healthy)

The first build typically takes **3–5 minutes**. Subsequent starts (without `--build`) are much faster.

### Step 4 — (First run) Apply database migrations

The backend automatically creates all tables via SQLAlchemy on startup. To explicitly apply Alembic migrations instead:

```bash
docker compose exec backend alembic upgrade head
```

### Step 5 — Open the app

| Service | URL |
|---|---|
| **Frontend** | <http://localhost:3000> |
| **Backend API** | <http://localhost:8000> |
| **Swagger UI** | <http://localhost:8000/docs> |
| **ReDoc** | <http://localhost:8000/redoc> |
| **Health check** | <http://localhost:8000/health> |

### Running in the background

```bash
docker compose up --build -d    # detached mode
docker compose logs -f          # stream logs from all services
docker compose logs -f backend  # logs for a single service
```

### Stopping the stack

```bash
docker compose down             # stop containers, keep volumes (data preserved)
docker compose down -v          # stop containers AND delete volumes — DATA LOSS!
```

---

## Local Development Setup (without Docker)

Use this workflow for hot-reload and direct debugger access. PostgreSQL and Redis still run in Docker (simplest approach); only the application services run locally.

### Step 1 — Start infrastructure services

```bash
docker compose up postgres redis -d
```

### Step 2 — Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` — the defaults match the Docker-hosted PostgreSQL and Redis, so only these values need changing:

```dotenv
OPENAI_API_KEY=sk-...
SECRET_KEY=<generated-secret>
```

> The `POSTGRES_SERVER=localhost` default works because port `5432` is forwarded to your host.

### Step 3 — Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install Python dependencies (includes asyncpg for async DB I/O)
pip install -r requirements.txt

# Apply database migrations
alembic upgrade head

# Start the development server with auto-reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend reads all configuration from the `.env` file in the project root via `pydantic-settings`. The API is now available at <http://localhost:8000>.

### Step 4 — Frontend

Open a new terminal:

```bash
cd frontend

# Install Node dependencies
npm install

# Create the frontend environment file
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
echo "NEXT_PUBLIC_APP_NAME=Second Self"         >> .env.local

# Start the development server with hot-reload
npm run dev
```

The frontend is now available at <http://localhost:3000>.

---

## Makefile Shortcuts

A `Makefile` at the project root exposes common tasks to avoid typing long commands.

```bash
make help            # list all available targets
```

### Docker

```bash
make build           # build all Docker images
make up              # start all services in detached mode
make down            # stop all services
make logs            # stream logs from all services
make shell           # open a bash shell inside the backend container
make clean           # remove containers, volumes, and prune Docker system
```

### Database

```bash
make migrate                              # run: alembic upgrade head (inside backend/)
make migrate-create name="add_users"      # generate a new Alembic revision
```

### Testing & Code Quality

```bash
make test            # run the backend pytest suite
make lint            # flake8 + mypy (backend) and ESLint (frontend)
make format          # black + isort (backend) and Prettier (frontend)
```

### Local Dev Servers

```bash
make backend         # start uvicorn with --reload (port 8000)
make frontend        # start Next.js dev server (port 3000)
```

### First-time Setup (no Docker)

```bash
make dev-setup       # copies .env.example → .env, runs npm install and pip install
```

---

## API Reference

All REST endpoints live under the `/api/v1` prefix. The full interactive documentation (with a built-in request runner) is available at <http://localhost:8000/docs>.

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns service status |

```bash
curl -s http://localhost:8000/health | jq
```

```json
{
  "status": "healthy",
  "service": "second-self-api",
  "version": "1.0.0"
}
```

### Chat

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/chat/` | Send a message and receive an AI response |
| `GET` | `/api/v1/chat/conversations/` | List conversations (`skip`, `limit` query params) |
| `GET` | `/api/v1/chat/conversations/{id}` | Retrieve a single conversation with its messages |

**Send a message:**

```bash
curl -s -X POST http://localhost:8000/api/v1/chat/ \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, who are you?"}' | jq
```

```json
{
  "message": "I'm Second Self, your AI-powered personal assistant...",
  "conversation_id": 1,
  "created_at": "2024-01-15T12:00:00.000Z"
}
```

**Continue an existing conversation:**

```bash
curl -s -X POST http://localhost:8000/api/v1/chat/ \
  -H "Content-Type: application/json" \
  -d '{"message": "What can you help me with?", "conversation_id": 1}' | jq
```

**List conversations:**

```bash
curl -s "http://localhost:8000/api/v1/chat/conversations/?skip=0&limit=10" | jq
```

**Get a conversation by ID:**

```bash
curl -s http://localhost:8000/api/v1/chat/conversations/1 | jq
```

### Users

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/users/` | Create a new user account |
| `GET` | `/api/v1/users/me` | Get the current user (demo: returns user ID 1) |
| `GET` | `/api/v1/users/{id}` | Get a user by ID |

**Create a user:**

```bash
curl -s -X POST http://localhost:8000/api/v1/users/ \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "username": "alice",
    "password": "secret123",
    "full_name": "Alice Smith"
  }' | jq
```

```json
{
  "id": 1,
  "email": "alice@example.com",
  "username": "alice",
  "full_name": "Alice Smith",
  "is_active": true,
  "created_at": "2024-01-15T12:00:00.000Z",
  "updated_at": null
}
```

**Get current user:**

```bash
curl -s http://localhost:8000/api/v1/users/me | jq
```

---

## Database Migrations

Migrations are managed with [Alembic](https://alembic.sqlalchemy.org/).

```bash
# Apply all pending migrations
cd backend && alembic upgrade head

# Generate a new migration from model changes
cd backend && alembic revision --autogenerate -m "describe_your_change"

# Roll back one migration
cd backend && alembic downgrade -1

# Show current revision
cd backend && alembic current

# Show full migration history
cd backend && alembic history --verbose
```

When running with Docker Compose, prefix commands with `docker compose exec backend`:

```bash
docker compose exec backend alembic upgrade head
docker compose exec backend alembic revision --autogenerate -m "describe_your_change"
docker compose exec backend alembic current
```

Or use the Makefile wrappers:

```bash
make migrate
make migrate-create name="describe_your_change"
```

> **How it works:** Alembic strips the `+asyncpg` suffix from `DATABASE_URL` when running migrations so it can use the synchronous `psycopg2` driver. The application itself uses `asyncpg` for async I/O at runtime.

---

## Running Tests

```bash
# Backend (pytest) — from the backend/ directory
cd backend
pytest

# Run a specific test file
pytest tests/test_chat.py

# Run only unit tests
pytest -m unit

# Watch mode (re-runs on file changes)
pytest -f

# Via Makefile (from project root)
make test
```

---

## Code Quality

### Backend

```bash
cd backend

black app/          # auto-format Python code
isort app/          # sort imports
flake8 app/         # lint (config in backend/.flake8)
mypy app/           # static type checking (config in backend/pyproject.toml)
```

### Frontend

```bash
cd frontend

npm run lint        # ESLint
npm run lint:fix    # ESLint with auto-fix
npm run type-check  # TypeScript (tsc --noEmit)
npm run prettier    # Prettier auto-format
```

### Run everything at once (via Makefile)

```bash
make lint           # lint backend and frontend
make format         # format backend and frontend
```

---

## Docker Commands Reference

```bash
# Rebuild a single service after a Dockerfile or dependency change
docker compose build backend
docker compose build frontend

# Restart a single service without rebuilding
docker compose restart backend

# View logs for a specific service
docker compose logs -f backend
docker compose logs -f frontend

# Open a shell inside a running container
docker compose exec backend bash
docker compose exec frontend sh

# Connect to PostgreSQL directly
docker compose exec postgres psql -U secondself_user -d secondself_db

# Check container health status
docker compose ps

# Remove everything (containers, networks, volumes)
docker compose down -v --remove-orphans
docker system prune -f
```

---

## Troubleshooting

### Backend cannot connect to PostgreSQL

**Symptom:** Backend logs show `Connection refused` or `could not connect to server`.

**With Docker Compose:** Ensure the `postgres` container is healthy before the backend starts:

```bash
docker compose ps postgres
```

If the postgres container is unhealthy, check its logs:

```bash
docker compose logs postgres
```

**With local dev:** Confirm PostgreSQL is running and `POSTGRES_SERVER=localhost` is set in `.env`.

---

### `OPENAI_API_KEY` errors

**Symptom:** Chat requests return `500` with a message about the API key.

The backend starts successfully even with a missing/invalid key, but every chat request will fail. Set the key in `.env` and restart:

```bash
docker compose restart backend
# or, locally:
# kill the uvicorn process and rerun it
```

---

### `DATABASE_URL` scheme error

**Symptom:** Backend logs show `Could not load backend 'postgresql'` or similar asyncpg driver errors.

Ensure `DATABASE_URL` uses the `postgresql+asyncpg://` scheme, not plain `postgresql://`:

```dotenv
# ✅ Correct
DATABASE_URL=postgresql+asyncpg://secondself_user:secondself_pass@localhost:5432/secondself_db

# ❌ Incorrect — will fail with async SQLAlchemy
DATABASE_URL=postgresql://secondself_user:secondself_pass@localhost:5432/secondself_db
```

---

### Frontend shows "Disconnected"

**Symptom:** The UI displays a *Disconnected* status.

The frontend polls `GET /health` on startup. If it shows *Disconnected*, check:

1. The backend container is running: `docker compose ps`
2. `NEXT_PUBLIC_API_URL` in `.env` points to the correct host and port
3. CORS is configured — `http://localhost:3000` is allowed by default

---

### Port conflicts

The default ports are:

| Port | Service |
|---|---|
| `3000` | Frontend (Next.js) |
| `8000` | Backend (FastAPI) |
| `5432` | PostgreSQL |
| `6379` | Redis |

If any port is already in use, either stop the conflicting process or update the port mappings in `docker-compose.yml` (left-hand side of `ports` entries).

---

### Alembic migration failures

**Symptom:** `alembic upgrade head` fails with a connection error.

- Ensure PostgreSQL is running and reachable
- When running locally (outside Docker), check that `POSTGRES_SERVER=localhost` and port `5432` is exposed: `docker compose up postgres -d`
- The `DATABASE_URL` used by Alembic is automatically stripped of `+asyncpg` (handled in `alembic/env.py`) so Alembic uses `psycopg2`; ensure `psycopg2-binary` is installed

---

### Python virtual environment issues

If you see `ModuleNotFoundError` when running the backend locally, ensure the virtual environment is activated and dependencies are installed:

```bash
cd backend
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Ensure `make lint` and `make test` pass
5. Submit a pull request

---

## License

MIT License
