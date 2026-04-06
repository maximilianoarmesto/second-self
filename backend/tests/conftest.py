"""
Shared pytest fixtures for the Second Self backend test suite.

Uses an in-process SQLite (async) database so tests run without a real
Postgres instance.  The entire database is re-created for every test
function to guarantee isolation.
"""

from __future__ import annotations

import os
from typing import AsyncGenerator

# Mark the process as running tests BEFORE importing the app so that the
# lifespan handler skips the real Postgres `create_all` call.
os.environ.setdefault("TESTING", "true")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.database import get_db
from app.main import app as fastapi_app

# ---------------------------------------------------------------------------
# In-memory SQLite database (per-test isolation)
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


def _set_sqlite_pragma(dbapi_conn, connection_record):  # type: ignore[no-untyped-def]
    """Enable FK enforcement in SQLite (off by default)."""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@pytest_asyncio.fixture()
async def db_engine():
    """Create a fresh async engine backed by an in-memory SQLite DB."""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    # Enable FK support for SQLite
    event.listen(engine.sync_engine, "connect", _set_sqlite_pragma)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture()
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    """Yield a single AsyncSession for a test, then roll back."""
    TestingSessionLocal = sessionmaker(
        db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with TestingSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# FastAPI test client with overridden DB dependency
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture()
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """
    Return an AsyncClient wired to the FastAPI app with the DB dependency
    overridden to use the in-memory test session.
    """

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    fastapi_app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as ac:
        yield ac

    fastapi_app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helper — create a test user and return a valid Bearer token
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture()
async def auth_headers(client: AsyncClient) -> dict:
    """Register a test user and return Authorization headers with a valid token."""
    # Register
    await client.post(
        "/api/v1/users/",
        json={
            "email": "test@example.com",
            "username": "testuser",
            "password": "testpassword123",
            "full_name": "Test User",
        },
    )
    # Login
    response = await client.post(
        "/api/v1/auth/token",
        data={"username": "testuser", "password": "testpassword123"},
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture()
async def second_auth_headers(client: AsyncClient) -> dict:
    """A second, distinct authenticated user (used for permission tests)."""
    await client.post(
        "/api/v1/users/",
        json={
            "email": "other@example.com",
            "username": "otheruser",
            "password": "otherpassword123",
            "full_name": "Other User",
        },
    )
    response = await client.post(
        "/api/v1/auth/token",
        data={"username": "otheruser", "password": "otherpassword123"},
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
