.PHONY: help build up down logs dev clean setup db-push db-seed

help:
	@echo "Available commands:"
	@echo "  setup     - Initial project setup"
	@echo "  build     - Build Docker containers"
	@echo "  up        - Start with Docker"
	@echo "  down      - Stop Docker containers"
	@echo "  logs      - Show Docker logs"
	@echo "  dev       - Start local dev server"
	@echo "  db-push   - Push schema to database"
	@echo "  db-seed   - Seed the database"
	@echo "  clean     - Remove containers and volumes"

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

dev:
	npm run dev

db-push:
	npm run db:push

db-seed:
	npm run db:seed

clean:
	docker compose down -v --remove-orphans

setup:
	cp -n .env.example .env || true
	npm install
	@echo "Setup complete! Run 'make up' for Docker or 'make dev' for local development."
