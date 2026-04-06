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

| Tool | Minimum version | Notes |
|---|---|---|
| Docker | 24+ | Required for the recommended Docker workflow |
| Docker Compose | 2.20+ | Included with Docker Desktop |
| Node.js | 18+ | Only needed for local frontend development |
| Python | 3.11+ | Only needed for local backend development |
| OpenAI API key | — | <https://platform.openai.com/api-keys> |

---

## Environment Variables

Copy the example file and fill in your values before running anything:

```bash
cp .env.example .env
```

Open `.env` and replace the placeholder values:

```dotenv
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://secondself_user:secondself_pass@localhost:5432/secondself_db
POSTGRES_SERVER=localhost
POSTGRES_USER=secondself_user
POSTGRES_PASSWORD=secondself_pass          # change in production
POSTGRES_DB=secondself_db
POSTGRES_PORT=5432

# ── OpenAI ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...                      # required — get from platform.openai.com
OPENAI_MODEL=gpt-3.5-turbo                # or gpt-4, gpt-4o, etc.

# ── Application ───────────────────────────────────────────────────────────────
SECRET_KEY=change_this_to_a_long_random_string   # used for JWT signing
ENVIRONMENT=development

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# ── LangChain (optional) ──────────────────────────────────────────────────────
LANGCHAIN_TRACING_V2=false
LANGCHAIN_API_KEY=                         # only needed for LangSmith tracing

# ── Frontend ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_NAME=Second Self
```

> **Important:** `OPENAI_API_KEY` and `SECRET_KEY` must be set to real values before the application will work.  
> The Docker Compose file reads `OPENAI_API_KEY` and `SECRET_KEY` directly from your shell / `.env` file via variable interpolation.

---

## Quick Start (Docker Compose — recommended)

This single workflow starts all four services (frontend, backend, PostgreSQL, Redis) and runs the database initialisation script automatically.

```bash
# 1. Clone the repository
git clone <repository-url>
cd second-self

# 2. Set up environment variables
cp .env.example .env
#    → edit .env and add your OPENAI_API_KEY and SECRET_KEY

# 3. Build and start all services
docker compose up --build

# 4. (First run) the backend creates all database tables on startup via SQLAlchemy.
#    You can also run Alembic migrations explicitly:
docker compose exec backend alembic upgrade head
```

Once all containers are healthy, open:

| Service | URL |
|---|---|
| Frontend | <http://localhost:3000> |
| Backend API | <http://localhost:8000> |
| Swagger UI | <http://localhost:8000/docs> |
| ReDoc | <http://localhost:8000/redoc> |
| Health check | <http://localhost:8000/health> |

To run the stack in the background:

```bash
docker compose up --build -d
docker compose logs -f          # stream logs from all services
```

To stop and remove containers:

```bash
docker compose down             # stop containers, keep volumes
docker compose down -v          # stop containers AND delete volumes (data loss!)
```

---

## Local Development Setup (without Docker)

Use this workflow if you want hot-reload and direct debugger access for either service.

### 1 — Start infrastructure services

PostgreSQL and Redis still run in Docker (simplest approach):

```bash
docker compose up postgres redis -d
```

### 2 — Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy and configure environment variables
cp ../.env.example ../.env
# → edit ../.env and set OPENAI_API_KEY, SECRET_KEY

# Run database migrations
alembic upgrade head

# Start the development server (auto-reload enabled)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend reads its configuration from the `.env` file in the project root via `pydantic-settings`.

### 3 — Frontend

Open a new terminal:

```bash
cd frontend

# Install dependencies
npm install

# Create the local environment file
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
echo "NEXT_PUBLIC_APP_NAME=Second Self"         >> .env.local

# Start the development server (hot-reload enabled)
npm run dev
```

The frontend is now available at <http://localhost:3000>.

---

## Makefile Shortcuts

A `Makefile` at the project root exposes common tasks so you don't have to type Docker and npm commands by hand.

```bash
make help            # list all available targets

# Docker
make build           # build all Docker images
make up              # start all services in the background
make down            # stop all services
make logs            # stream logs from all services
make shell           # open a bash shell inside the backend container
make clean           # remove containers, volumes, and prune Docker system

# Database
make migrate         # run: alembic upgrade head  (inside backend/)
make migrate-create name="add_users_table"   # generate a new Alembic revision

# Testing & quality
make test            # run the backend pytest suite
make lint            # flake8 + mypy (backend) and ESLint (frontend)
make format          # black + isort (backend) and Prettier (frontend)

# Local dev servers
make backend         # start uvicorn with --reload
make frontend        # start Next.js dev server

# First-time setup (no Docker)
make dev-setup       # cp .env.example .env, npm install, pip install -r requirements.txt
```

---

## API Reference

All REST endpoints are prefixed with `/api/v1`.

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service health check |

### Chat

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/chat/` | Send a message and receive an AI response |
| `GET` | `/api/v1/chat/conversations/` | List conversations (`skip`, `limit` query params) |
| `GET` | `/api/v1/chat/conversations/{id}` | Retrieve a single conversation by ID |

**Example — send a message:**

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

### Users

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/users/` | Create a new user account |
| `GET` | `/api/v1/users/me` | Get the current user |
| `GET` | `/api/v1/users/{id}` | Get a user by ID |

**Example — create a user:**

```bash
curl -s -X POST http://localhost:8000/api/v1/users/ \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "username": "alice", "password": "secret123"}' | jq
```

Full interactive API documentation (with a built-in request runner) is available at <http://localhost:8000/docs>.

---

## Database Migrations

Migrations are managed with [Alembic](https://alembic.sqlalchemy.org/).

```bash
# Apply all pending migrations
cd backend && alembic upgrade head

# Generate a new migration from model changes
cd backend && alembic revision --autogenerate -m "describe_your_change"

# Downgrade one step
cd backend && alembic downgrade -1

# Show current revision
cd backend && alembic current
```

Or use the Makefile wrappers:

```bash
make migrate
make migrate-create name="describe_your_change"
```

> **Note:** When running with Docker Compose, run Alembic commands inside the container:  
> `docker compose exec backend alembic upgrade head`

---

## Running Tests

```bash
# Backend (pytest)
cd backend
pytest

# Watch mode
pytest -f

# Via Makefile
make test
```

---

## Code Quality

```bash
# Backend
cd backend
black app/          # auto-format
isort app/          # sort imports
flake8 app/         # lint
mypy app/           # type-check

# Frontend
cd frontend
npm run lint        # ESLint
npm run lint:fix    # ESLint with auto-fix
npm run type-check  # TypeScript
npm run prettier    # Prettier format

# Run everything at once
make lint
make format
```

---

## Docker Commands Reference

```bash
# Rebuild a single service after code changes
docker compose build backend
docker compose build frontend

# Restart a single service without rebuilding
docker compose restart backend

# View logs for a specific service
docker compose logs -f backend
docker compose logs -f frontend

# Open a shell inside a running container
docker compose exec backend bash
docker compose exec postgres psql -U secondself_user -d secondself_db

# Check running containers and their health status
docker compose ps
```

---

## Troubleshooting

### Backend cannot connect to PostgreSQL

Ensure the `postgres` container is healthy before the backend starts:

```bash
docker compose ps postgres
```

If starting services locally (without Docker for the backend), make sure `POSTGRES_SERVER` in `.env` is set to `localhost` and the port `5432` is exposed.

### `OPENAI_API_KEY` errors

The backend will start but every chat request will fail if the key is missing or invalid. Set the key in `.env` and restart the backend:

```bash
docker compose restart backend
```

### Frontend shows "Disconnected"

The frontend polls `GET /health` on startup. If it shows *Disconnected*, check:

1. The backend container is running: `docker compose ps`
2. `NEXT_PUBLIC_API_URL` in `.env` points to the correct host and port.
3. CORS is configured — `localhost:3000` is allowed by default.

### Port conflicts

The default ports are `3000` (frontend), `8000` (backend), `5432` (PostgreSQL), `6379` (Redis). If any of these are in use on your machine, stop the conflicting process or update the port mappings in `docker-compose.yml`.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes, ensuring `make lint` and `make test` pass
4. Submit a pull request

---

## License

MIT License
