"""
Integration tests for the /api/v1/auth/* and /api/v1/users/* endpoints.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# User registration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_user(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/users/",
        json={
            "email": "new@example.com",
            "username": "newuser",
            "password": "secret123",
            "full_name": "New User",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "new@example.com"
    assert "hashed_password" not in data


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient) -> None:
    payload = {
        "email": "dup@example.com",
        "username": "dupuser",
        "password": "secret123",
    }
    await client.post("/api/v1/users/", json=payload)
    response = await client.post(
        "/api/v1/users/",
        json={**payload, "username": "differentuser"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_register_duplicate_username(client: AsyncClient) -> None:
    payload = {
        "email": "unique@example.com",
        "username": "samename",
        "password": "secret123",
    }
    await client.post("/api/v1/users/", json=payload)
    response = await client.post(
        "/api/v1/users/",
        json={**payload, "email": "other_unique@example.com"},
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Login / token issuance
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_returns_token(client: AsyncClient) -> None:
    await client.post(
        "/api/v1/users/",
        json={"email": "login@example.com", "username": "loginuser", "password": "pw123"},
    )
    response = await client.post(
        "/api/v1/auth/token",
        data={"username": "loginuser", "password": "pw123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_with_email(client: AsyncClient) -> None:
    await client.post(
        "/api/v1/users/",
        json={"email": "emaillogin@example.com", "username": "emailuser", "password": "pw123"},
    )
    response = await client.post(
        "/api/v1/auth/token",
        data={"username": "emaillogin@example.com", "password": "pw123"},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient) -> None:
    await client.post(
        "/api/v1/users/",
        json={"email": "wp@example.com", "username": "wpuser", "password": "correct"},
    )
    response = await client.post(
        "/api/v1/auth/token",
        data={"username": "wpuser", "password": "wrong"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/token",
        data={"username": "ghost", "password": "nope"},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# /users/me — authenticated profile
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_me(client: AsyncClient, auth_headers: dict) -> None:
    response = await client.get("/api/v1/users/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "testuser"


@pytest.mark.asyncio
async def test_get_me_unauthenticated(client: AsyncClient) -> None:
    response = await client.get("/api/v1/users/me")
    assert response.status_code == 401
