# Second Self

A full-stack AI application built with Next.js, FastAPI, LangChain, and OpenAI API.

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Backend**: FastAPI, Python 3.11+
- **AI/ML**: OpenAI API, LangChain
- **Database**: PostgreSQL
- **Infrastructure**: Docker, Docker Compose

## Project Structure

```
second-self/
├── frontend/          # Next.js application
├── backend/           # FastAPI application
├── docker/            # Docker configuration
├── database/          # Database migrations and scripts
├── docker-compose.yml # Development environment
└── README.md
```

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- Python 3.11+ (for local development)

## Environment Variables

Create the following environment files:

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_NAME=Second Self
```

### Backend (.env)
```
DATABASE_URL=postgresql://user:password@localhost:5432/secondself
OPENAI_API_KEY=your_openai_api_key_here
SECRET_KEY=your_secret_key_here
ENVIRONMENT=development
```

## Quick Start

1. **Clone and setup**
   ```bash
   git clone <repository-url>
   cd second-self
   ```

2. **Start with Docker Compose (Recommended)**
   ```bash
   docker-compose up --build
   ```

3. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/docs

## Development Setup

### Backend Development
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend Development
```bash
cd frontend
npm install
npm run dev
```

### Database Setup
```bash
# Run migrations
cd backend
alembic upgrade head
```

## Available Scripts

### Frontend
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript checks

### Backend
- `uvicorn app.main:app --reload` - Start development server
- `pytest` - Run tests
- `alembic upgrade head` - Run database migrations
- `black .` - Format code
- `flake8` - Lint code

## API Documentation

Once the backend is running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

MIT License