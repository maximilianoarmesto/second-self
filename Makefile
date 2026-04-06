.PHONY: help build up down logs shell test lint format clean

# Default target
help:
	@echo "Available commands:"
	@echo "  build     - Build Docker containers"
	@echo "  up        - Start the application"
	@echo "  down      - Stop the application"
	@echo "  logs      - Show application logs"
	@echo "  shell     - Open shell in backend container"
	@echo "  test      - Run tests"
	@echo "  lint      - Run linting"
	@echo "  format    - Format code"
	@echo "  clean     - Clean up containers and volumes"
	@echo "  migrate   - Run database migrations"
	@echo "  frontend  - Start frontend development server"
	@echo "  backend   - Start backend development server"

# Docker commands
build:
	docker-compose build

up:
	docker-compose up -d

down:
	docker-compose down

logs:
	docker-compose logs -f

shell:
	docker-compose exec backend bash

# Development commands
frontend:
	cd frontend && npm run dev

backend:
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Database commands
migrate:
	cd backend && alembic upgrade head

migrate-create:
	cd backend && alembic revision --autogenerate -m "$(name)"

# Testing
test:
	cd backend && pytest

test-watch:
	cd backend && pytest -f

# Code quality
lint:
	cd backend && flake8 app/
	cd backend && mypy app/
	cd frontend && npm run lint

format:
	cd backend && black app/
	cd backend && isort app/
	cd frontend && npm run prettier

# Cleanup
clean:
	docker-compose down -v --remove-orphans
	docker system prune -f

# Setup commands
setup:
	cp .env.example .env
	@echo "Please edit .env file with your configuration"

install-frontend:
	cd frontend && npm install

install-backend:
	cd backend && pip install -r requirements.txt

# Full development setup
dev-setup: setup install-frontend install-backend
	@echo "Development environment setup complete!"
	@echo "1. Edit .env file with your configuration"
	@echo "2. Run 'make up' to start the application"