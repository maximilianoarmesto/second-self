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
│   ├── next.config.js      # Next.js config (standalone output + API proxy rewrites)
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
│   ├── alembic/            # Alembic migration environment
│   ├── alembic.ini         # Alembic configuration (git-ignored — see note below)
│   ├── Dockerfile
│   ├── pyproject.toml      # Black, isort, mypy configuration
│   ├── pytest.ini          # Pytest configuration
│   └── requirements.txt
├── database/
│   └── init/01_init.sql    # PostgreSQL initialisation script (run once on first start)
├── docker-compose.yml
├── Makefile                # Developer shortcuts
└── .env.example            # Template for environment variables
```

> **`alembic.ini` note:** `alembic.ini` is listed in `.gitignore` and is therefore not committed to the repository. If you need to run Alembic migrations outside Docker you must generate it first: `cd backend && alembic init alembic` (then restore `alembic/env.py` from the repo, or just run `docker compose exec backend alembic upgrade head`).

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

Then open `.env` in your editor and replace the placeholder values. At minimum you **must** set `OPENAI_API_KEY` and `SECRET_KEY`.

### Generating a `SECRET_KEY`

`SECRET_KEY` is used to sign JWTs. Generate a cryptographically secure value with one of these commands:

```bash
# Python (recommended)
python -c "import secrets; print(secrets.token_hex(32))"

# OpenSSL
openssl rand -hex 32
```

### Full Variable Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | No ¹ | assembled from parts | Full async DB URL — **must** use `postgresql+asyncpg://` scheme |
| `POSTGRES_SERVER` | Yes | `localhost` | PostgreSQL host (`postgres` inside Docker Compose) |
| `POSTGRES_USER` | Yes | `secondself_user` | PostgreSQL username |
| `POSTGRES_PASSWORD` | **Yes** | `secondself_pass` | PostgreSQL password — change before going to production |
| `POSTGRES_DB` | Yes | `secondself_db` | PostgreSQL database name |
| `POSTGRES_PORT` | Yes | `5432` | PostgreSQL port |
| `OPENAI_API_KEY` | **Yes** | — | OpenAI API key — chat will not work without this |
| `OPENAI_MODEL` | No | `gpt-3.5-turbo` | OpenAI model (`gpt-4`, `gpt-4o`, `gpt-4-turbo`, …) |
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

> ¹ If `DATABASE_URL` is omitted it is assembled automatically from the individual `POSTGRES_*` variables in `backend/app/core/config.py`.
>
> **The `DATABASE_URL` must use the `postgresql+asyncpg://` scheme** — plain `postgresql://` will fail because the backend uses SQLAlchemy's async engine. Alembic automatically strips `+asyncpg` when running migrations so it can use `psycopg2`.

### Example `.env`

```dotenv
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://secondself_user:secondself_pass@localhost:5432/secondself_db
POSTGRES_SERVER=localhost
POSTGRES_USER=secondself_user
POSTGRES_PASSWORD=secondself_pass
POSTGRES_DB=secondself_db
POSTGRES_PORT=5432

# ── OpenAI ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...                      # required — get yours at platform.openai.com
OPENAI_MODEL=gpt-3.5-turbo

# ── Application ───────────────────────────────────────────────────────────────
SECRET_KEY=a1b2c3...                       # generate: python -c "import secrets; print(secrets.token_hex(32))"
ENVIRONMENT=development
LOG_LEVEL=INFO

# ── Redis / Celery ────────────────────────────────────────────────────────────
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

> **Docker Compose note:** When running with Docker Compose, you do **not** need to change `POSTGRES_SERVER`, `REDIS_URL`, `CELERY_BROKER_URL`, or `CELERY_RESULT_BACKEND` — the Compose file automatically overrides these with the correct container hostnames (`postgres`, `redis`). Only `OPENAI_API_KEY` and `SECRET_KEY` must be set by you.

---

## Quick Start — Docker Compose (recommended)

This workflow builds and starts all four services (frontend, backend, PostgreSQL, Redis) with a single command. PostgreSQL is initialised automatically on the first run via `database/init/01_init.sql`.

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

1. Build the backend and frontend images.
2. Start PostgreSQL and Redis, waiting until both pass their health checks.
3. Start the backend — waits for PostgreSQL and Redis to be healthy; creates all database tables on startup via SQLAlchemy.
4. Start the frontend — waits for the backend to be healthy.

> **First build:** typically takes **3–5 minutes** while Docker downloads base images and installs dependencies. Subsequent starts without `--build` are much faster.

### Step 4 — Open the app

| Service | URL |
|---|---|
| **Frontend** | <http://localhost:3000> |
| **Backend API** | <http://localhost:8000> |
| **Swagger UI** | <http://localhost:8000/docs> |
| **ReDoc** | <http://localhost:8000/redoc> |
| **Health check** | <http://localhost:8000/health> |

### Running in the background (detached mode)

```bash
docker compose up --build -d    # start all services in the background
docker compose logs -f          # stream logs from all services
docker compose logs -f backend  # stream logs for a single service
docker compose ps               # check the status and health of each service
```

### Stopping the stack

```bash
docker compose down             # stop containers, keep volumes (data preserved)
docker compose down -v          # stop containers AND delete volumes — ⚠ DATA LOSS
```

---

## Local Development Setup (without Docker)

Use this workflow for hot-reload and direct debugger access. PostgreSQL and Redis still run inside Docker (simplest approach); only the application services run on your machine.

### Step 1 — Start infrastructure services

```bash
docker compose up postgres redis -d
```

This starts just the database and cache, forwarding their default ports (`5432`, `6379`) to your host machine.

### Step 2 — Configure environment variables

```bash
cp .env.example .env
```

The defaults in `.env.example` point to `localhost`, which matches the Docker-forwarded ports. Only these two values need changing:

```dotenv
OPENAI_API_KEY=sk-...
SECRET_KEY=<generated-secret>
```

### Step 3 — Set up and start the backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt

# Start the development server with auto-reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend reads all configuration from the root `.env` file via `pydantic-settings`. Database tables are created automatically on startup. The API is available at <http://localhost:8000>.

> **Note:** `POSTGRES_SERVER=localhost` (the default) works because port `5432` is forwarded from the Docker container to your host.

### Step 4 — Set up and start the frontend

Open a **new terminal**:

```bash
cd frontend

# Install Node.js dependencies
npm install

# Create the frontend environment file
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
echo "NEXT_PUBLIC_APP_NAME=Second Self"         >> .env.local

# Start the development server with hot-reload
npm run dev
```

The frontend is now available at <http://localhost:3000>.

> **API proxy:** `next.config.js` rewrites all `/api/*` requests made by the Next.js dev server to the backend URL. The frontend also makes direct calls to `NEXT_PUBLIC_API_URL` from the browser for non-proxied routes such as `/health`.

---

## Makefile Shortcuts

A `Makefile` at the project root exposes common tasks. Run `make help` to list all targets.

> **CLI note:** The Makefile uses the `docker-compose` CLI (Compose v1 plugin syntax). If your system only has the `docker compose` (v2, space-separated) sub-command, either install the v1 plugin or replace `docker-compose` with `docker compose` in the Makefile targets you invoke directly.

```bash
make help            # list all available targets
```

### First-time setup (no Docker)

```bash
make dev-setup       # copies .env.example → .env, runs npm install and pip install -r requirements.txt
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
make migrate                          # run: alembic upgrade head (inside backend/)
make migrate-create name="add_users"  # generate a new Alembic revision
```

### Testing & Code Quality

```bash
make test            # run the backend pytest suite
make lint            # flake8 + mypy (backend) and ESLint (frontend)
make format          # black + isort (backend) and Prettier (frontend)
```

### Local Dev Servers

```bash
make backend         # start uvicorn with --reload on port 8000
make frontend        # start Next.js dev server on port 3000
```

---

## API Reference

All REST endpoints live under the `/api/v1` prefix. The full interactive documentation (with a built-in request runner) is available at <http://localhost:8000/docs>.

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns service health status |

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

**Send a message (start a new conversation):**

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

**Get current user (demo):**

```bash
curl -s http://localhost:8000/api/v1/users/me | jq
```

**Get user by ID:**

```bash
curl -s http://localhost:8000/api/v1/users/1 | jq
```

---

## Database Migrations

Migrations are managed with [Alembic](https://alembic.sqlalchemy.org/). The backend automatically creates all tables via SQLAlchemy on startup, so explicit migration runs are only needed when you change the schema.

### With Docker Compose (recommended)

```bash
# Apply all pending migrations
docker compose exec backend alembic upgrade head

# Generate a new migration from model changes
docker compose exec backend alembic revision --autogenerate -m "describe_your_change"

# Roll back one migration
docker compose exec backend alembic downgrade -1

# Show current revision
docker compose exec backend alembic current

# Show full migration history
docker compose exec backend alembic history --verbose
```

### Locally (inside the virtual environment)

```bash
cd backend
source venv/bin/activate

alembic upgrade head
alembic revision --autogenerate -m "describe_your_change"
alembic downgrade -1
alembic current
alembic history --verbose
```

### Via Makefile

```bash
make migrate
make migrate-create name="describe_your_change"
```

> **How Alembic handles the async URL:** `alembic/env.py` automatically strips the `+asyncpg` suffix from `DATABASE_URL` before passing it to Alembic, so Alembic uses `psycopg2` (synchronous) for running migrations while the application uses `asyncpg` for async I/O at runtime.

---

## Running Tests

Tests live in `backend/tests/` and are configured via `backend/pytest.ini`.

```bash
# Run the full test suite from the backend directory
cd backend && pytest

# Run a specific test file
cd backend && pytest tests/test_chat.py

# Run only unit tests
cd backend && pytest -m unit

# Run only integration tests
cd backend && pytest -m integration

# Verbose output with short tracebacks (matches pytest.ini defaults)
cd backend && pytest --verbose --tb=short

# Via Makefile (from project root)
make test
```

Available pytest markers (defined in `pytest.ini`): `unit`, `integration`, `slow`.

---

## Code Quality

### Backend

```bash
cd backend

black app/          # auto-format Python code (line length 88, configured in pyproject.toml)
isort app/          # sort imports (black-compatible profile)
flake8 app/         # lint (config in backend/.flake8, max-line-length 88)
mypy app/           # static type checking (strict settings in pyproject.toml)
```

### Frontend

```bash
cd frontend

npm run lint         # ESLint (config in .eslintrc.json)
npm run lint:fix     # ESLint with auto-fix
npm run type-check   # TypeScript — tsc --noEmit
npm run prettier     # Prettier auto-format (config in .prettierrc)
npm run prettier:check  # Prettier check without writing
```

### Run everything at once (via Makefile)

```bash
make lint            # flake8 + mypy (backend) and ESLint (frontend)
make format          # black + isort (backend) and Prettier (frontend)
```

---

## Docker Commands Reference

### Building and starting services

```bash
# Build and start all services (foreground)
docker compose up --build

# Build and start all services (background)
docker compose up --build -d

# Rebuild a single service after a Dockerfile or dependency change
docker compose build backend
docker compose build frontend

# Start a specific service (and its dependencies)
docker compose up backend -d
```

### Inspecting services

```bash
# Check container status and health
docker compose ps

# Stream logs from all services
docker compose logs -f

# Stream logs from a specific service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
docker compose logs -f redis
```

### Interacting with containers

```bash
# Open a shell inside a running container
docker compose exec backend bash
docker compose exec frontend sh

# Connect to PostgreSQL directly
docker compose exec postgres psql -U secondself_user -d secondself_db

# Run a one-off command in the backend container
docker compose exec backend python -c "from app.core.config import settings; print(settings.DATABASE_URL)"
```

### Restarting and stopping

```bash
# Restart a single service without rebuilding
docker compose restart backend

# Stop all services (data volumes preserved)
docker compose down

# Stop all services and remove volumes — ⚠ DATA LOSS
docker compose down -v

# Remove everything including orphaned containers
docker compose down -v --remove-orphans
docker system prune -f
```

---

## Troubleshooting

### Backend cannot connect to PostgreSQL

**Symptom:** Backend logs show `Connection refused` or `could not connect to server`.

**With Docker Compose:** Ensure the `postgres` container is healthy:

```bash
docker compose ps postgres
docker compose logs postgres
```

The backend `depends_on` the `postgres` service with `condition: service_healthy`, so if the backend started it means PostgreSQL passed its health check. If the backend container keeps restarting, check the `DATABASE_URL` scheme (see below).

**With local dev:** Confirm PostgreSQL is running (`docker compose up postgres -d`) and that `POSTGRES_SERVER=localhost` is set in `.env`.

---

### `OPENAI_API_KEY` errors

**Symptom:** Chat requests return `500` with a message about the API key.

The backend starts successfully even with a missing or invalid key, but every `/api/v1/chat/` request will fail. Set the correct key in `.env` and restart:

```bash
docker compose restart backend
```

Or, for local dev, stop `uvicorn` and rerun it after updating `.env`.

---

### `DATABASE_URL` scheme error

**Symptom:** Backend logs show `Could not load backend 'postgresql'` or asyncpg driver errors.

Ensure `DATABASE_URL` uses the `postgresql+asyncpg://` scheme:

```dotenv
# ✅ Correct
DATABASE_URL=postgresql+asyncpg://secondself_user:secondself_pass@localhost:5432/secondself_db

# ❌ Wrong — will fail with async SQLAlchemy
DATABASE_URL=postgresql://secondself_user:secondself_pass@localhost:5432/secondself_db
```

---

### Frontend shows "Disconnected"

**Symptom:** The UI header displays a red *● Disconnected* badge.

The frontend polls `GET /health` on load. If it shows *Disconnected*, check:

1. The backend container is running: `docker compose ps`
2. `NEXT_PUBLIC_API_URL` in `.env` points to the correct host and port (`http://localhost:8000` for local dev)
3. CORS — `http://localhost:3000` is allowed by default in `backend/app/core/config.py`

---

### Port conflicts

Default port assignments:

| Port | Service |
|---|---|
| `3000` | Frontend (Next.js) |
| `8000` | Backend (FastAPI) |
| `5432` | PostgreSQL |
| `6379` | Redis |

If a port is already in use, either stop the conflicting process or change the host-side port in `docker-compose.yml` (the left-hand number in the `ports:` mapping).

---

### Alembic migration failures

**Symptom:** `alembic upgrade head` fails with a connection or import error.

- Ensure PostgreSQL is running and reachable.
- For local dev (outside Docker), run `docker compose up postgres -d` first so port `5432` is forwarded.
- `alembic.ini` is git-ignored. If running outside Docker for the first time, generate it: `cd backend && alembic init alembic` (then restore `alembic/env.py` from the repo). Inside Docker the file is baked into the image and already present.
- Ensure `psycopg2-binary` is installed in your virtual environment — Alembic uses it for synchronous migrations.

---

### Python virtual environment issues

**Symptom:** `ModuleNotFoundError` when running the backend locally.

Ensure the virtual environment is activated before running any Python commands:

```bash
cd backend
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

### Docker Compose CLI version mismatch

**Symptom:** `make up` / `make build` fail with `docker-compose: command not found`.

The `Makefile` uses the `docker-compose` binary (Compose v1 plugin). Install it or create an alias:

```bash
# Option A — install the standalone docker-compose binary
# https://docs.docker.com/compose/install/standalone/

# Option B — alias v2 to the v1 name
echo 'alias docker-compose="docker compose"' >> ~/.bashrc && source ~/.bashrc
```

Alternatively, run the underlying `docker compose` (v2) commands directly — they are documented in each section above.

---

## Contributing

1. Fork the repository and create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes following the existing code style
3. Ensure `make lint` and `make test` pass
4. Open a pull request with a clear description of the change

---

## License

MIT License
