"""
Integration tests for the /api/v1/chat/* endpoints.

The AI service is mocked so tests do not make real OpenAI calls.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration

AI_MOCK_REPLY = "This is a mocked AI response."


def _mock_ai() -> Any:
    """Return a patcher that makes AIService.generate_response return a fixed string."""
    return patch(
        "app.api.api_v1.endpoints.chat.AIService.generate_response",
        new_callable=AsyncMock,
        return_value=AI_MOCK_REPLY,
    )


# ---------------------------------------------------------------------------
# Authentication guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_requires_auth(client: AsyncClient) -> None:
    response = await client.post("/api/v1/chat/", json={"message": "hi"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_conversations_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/api/v1/chat/conversations")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /chat/ — send message
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_creates_new_conversation(
    client: AsyncClient, auth_headers: dict
) -> None:
    with _mock_ai():
        response = await client.post(
            "/api/v1/chat/",
            json={"message": "Hello there!"},
            headers=auth_headers,
        )

    assert response.status_code == 200
    data = response.json()
    assert data["message"] == AI_MOCK_REPLY
    assert isinstance(data["conversation_id"], int)
    assert "created_at" in data


@pytest.mark.asyncio
async def test_chat_continues_existing_conversation(
    client: AsyncClient, auth_headers: dict
) -> None:
    with _mock_ai():
        # Create conversation on first turn
        r1 = await client.post(
            "/api/v1/chat/",
            json={"message": "Turn 1"},
            headers=auth_headers,
        )
        assert r1.status_code == 200
        conv_id = r1.json()["conversation_id"]

        # Continue the same conversation
        r2 = await client.post(
            "/api/v1/chat/",
            json={"message": "Turn 2", "conversation_id": conv_id},
            headers=auth_headers,
        )
    assert r2.status_code == 200
    assert r2.json()["conversation_id"] == conv_id


@pytest.mark.asyncio
async def test_chat_non_existent_conversation_returns_404(
    client: AsyncClient, auth_headers: dict
) -> None:
    with _mock_ai():
        response = await client.post(
            "/api/v1/chat/",
            json={"message": "Hi", "conversation_id": 99999},
            headers=auth_headers,
        )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_chat_other_users_private_conversation_returns_403(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    with _mock_ai():
        # User A creates a private conversation
        r = await client.post(
            "/api/v1/chat/",
            json={"message": "Private message", "is_public": False},
            headers=auth_headers,
        )
    conv_id = r.json()["conversation_id"]

    with _mock_ai():
        # User B tries to post into it
        r2 = await client.post(
            "/api/v1/chat/",
            json={"message": "Intrusion", "conversation_id": conv_id},
            headers=second_auth_headers,
        )
    assert r2.status_code == 403


@pytest.mark.asyncio
async def test_chat_stores_messages_in_db(
    client: AsyncClient, auth_headers: dict
) -> None:
    with _mock_ai():
        r = await client.post(
            "/api/v1/chat/",
            json={"message": "Store me"},
            headers=auth_headers,
        )
    conv_id = r.json()["conversation_id"]

    # Fetch the conversation and verify both messages were persisted
    conv_response = await client.get(
        f"/api/v1/chat/conversations/{conv_id}", headers=auth_headers
    )
    assert conv_response.status_code == 200
    messages = conv_response.json()["messages"]
    assert len(messages) == 2
    roles = [m["role"] for m in messages]
    assert "user" in roles
    assert "assistant" in roles


# ---------------------------------------------------------------------------
# POST /chat/conversations — explicit creation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_conversation_explicit(
    client: AsyncClient, auth_headers: dict
) -> None:
    response = await client.post(
        "/api/v1/chat/conversations",
        json={"title": "My custom chat", "is_public": True},
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "My custom chat"
    assert data["is_public"] is True
    assert data["messages"] == []


# ---------------------------------------------------------------------------
# GET /chat/conversations — list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_conversations_empty(
    client: AsyncClient, auth_headers: dict
) -> None:
    response = await client.get("/api/v1/chat/conversations", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_conversations_returns_own_only(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    # User A creates 2 conversations
    for title in ("A conv 1", "A conv 2"):
        await client.post(
            "/api/v1/chat/conversations",
            json={"title": title},
            headers=auth_headers,
        )
    # User B creates 1
    await client.post(
        "/api/v1/chat/conversations",
        json={"title": "B conv"},
        headers=second_auth_headers,
    )

    response = await client.get("/api/v1/chat/conversations", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    titles = {c["title"] for c in data}
    assert "B conv" not in titles


@pytest.mark.asyncio
async def test_list_conversations_pagination(
    client: AsyncClient, auth_headers: dict
) -> None:
    for i in range(5):
        await client.post(
            "/api/v1/chat/conversations",
            json={"title": f"Conv {i}"},
            headers=auth_headers,
        )

    r1 = await client.get(
        "/api/v1/chat/conversations?skip=0&limit=3", headers=auth_headers
    )
    r2 = await client.get(
        "/api/v1/chat/conversations?skip=3&limit=3", headers=auth_headers
    )
    assert len(r1.json()) == 3
    assert len(r2.json()) == 2


# ---------------------------------------------------------------------------
# GET /chat/conversations/{id} — detail
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_conversation_not_found(
    client: AsyncClient, auth_headers: dict
) -> None:
    response = await client.get(
        "/api/v1/chat/conversations/99999", headers=auth_headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_public_conversation_by_non_owner(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    r = await client.post(
        "/api/v1/chat/conversations",
        json={"title": "Public", "is_public": True},
        headers=auth_headers,
    )
    conv_id = r.json()["id"]

    response = await client.get(
        f"/api/v1/chat/conversations/{conv_id}", headers=second_auth_headers
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_get_private_conversation_by_non_owner_returns_403(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    r = await client.post(
        "/api/v1/chat/conversations",
        json={"title": "Private", "is_public": False},
        headers=auth_headers,
    )
    conv_id = r.json()["id"]

    response = await client.get(
        f"/api/v1/chat/conversations/{conv_id}", headers=second_auth_headers
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /chat/conversations/{id} — update
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_conversation_title(
    client: AsyncClient, auth_headers: dict
) -> None:
    r = await client.post(
        "/api/v1/chat/conversations",
        json={"title": "Original"},
        headers=auth_headers,
    )
    conv_id = r.json()["id"]

    response = await client.patch(
        f"/api/v1/chat/conversations/{conv_id}",
        json={"title": "Updated"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Updated"


@pytest.mark.asyncio
async def test_update_conversation_by_non_owner_returns_403(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    r = await client.post(
        "/api/v1/chat/conversations",
        json={"title": "Mine"},
        headers=auth_headers,
    )
    conv_id = r.json()["id"]

    response = await client.patch(
        f"/api/v1/chat/conversations/{conv_id}",
        json={"title": "Hacked"},
        headers=second_auth_headers,
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /chat/conversations/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_conversation(client: AsyncClient, auth_headers: dict) -> None:
    r = await client.post(
        "/api/v1/chat/conversations",
        json={"title": "Delete me"},
        headers=auth_headers,
    )
    conv_id = r.json()["id"]

    del_response = await client.delete(
        f"/api/v1/chat/conversations/{conv_id}", headers=auth_headers
    )
    assert del_response.status_code == 204

    get_response = await client.get(
        f"/api/v1/chat/conversations/{conv_id}", headers=auth_headers
    )
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_delete_conversation_by_non_owner_returns_403(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    r = await client.post(
        "/api/v1/chat/conversations",
        json={"title": "Protected"},
        headers=auth_headers,
    )
    conv_id = r.json()["id"]

    response = await client.delete(
        f"/api/v1/chat/conversations/{conv_id}", headers=second_auth_headers
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# GET /chat/conversations/{id}/messages
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_messages_returns_chronological(
    client: AsyncClient, auth_headers: dict
) -> None:
    with _mock_ai():
        r = await client.post(
            "/api/v1/chat/",
            json={"message": "First turn"},
            headers=auth_headers,
        )
    conv_id = r.json()["conversation_id"]

    with _mock_ai():
        await client.post(
            "/api/v1/chat/",
            json={"message": "Second turn", "conversation_id": conv_id},
            headers=auth_headers,
        )

    msgs_response = await client.get(
        f"/api/v1/chat/conversations/{conv_id}/messages", headers=auth_headers
    )
    assert msgs_response.status_code == 200
    msgs = msgs_response.json()
    # 2 user turns + 2 assistant turns = 4 messages
    assert len(msgs) == 4
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "First turn"


@pytest.mark.asyncio
async def test_get_messages_private_conv_non_owner_returns_403(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    r = await client.post(
        "/api/v1/chat/conversations",
        json={"title": "Private msgs", "is_public": False},
        headers=auth_headers,
    )
    conv_id = r.json()["id"]

    response = await client.get(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        headers=second_auth_headers,
    )
    assert response.status_code == 403
