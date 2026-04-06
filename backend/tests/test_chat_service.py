"""
Unit tests for ChatService.

These tests exercise the service layer directly against the in-memory SQLite
database — no HTTP layer, no AI calls.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.models.user import User
from app.schemas.chat import ConversationUpdate
from app.services.chat_service import (
    CONTEXT_WINDOW,
    ChatService,
    ConversationNotFoundError,
    ConversationPermissionError,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_user(db: AsyncSession, user_id_hint: str = "a") -> User:
    """Insert a minimal User row and return it."""
    user = User(
        email=f"user_{user_id_hint}@test.com",
        username=f"user_{user_id_hint}",
        hashed_password=get_password_hash("password"),
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Conversation creation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_conversation_returns_id(db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    service = ChatService(db_session)

    conv_id = await service.create_conversation(
        user_id=user.id, title="Hello world", is_public=False
    )

    assert isinstance(conv_id, int)
    assert conv_id > 0


@pytest.mark.asyncio
async def test_create_conversation_defaults(db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=user.id)
    conv = await service.get_conversation(conv_id, requesting_user_id=user.id)

    assert conv.title == "New Conversation"
    assert conv.is_public is False
    assert conv.messages == []


# ---------------------------------------------------------------------------
# Conversation retrieval
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_conversation_not_found_raises(db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    service = ChatService(db_session)

    with pytest.raises(ConversationNotFoundError):
        await service.get_conversation(99999, requesting_user_id=user.id)


@pytest.mark.asyncio
async def test_get_private_conversation_by_owner(db_session: AsyncSession) -> None:
    owner = await _create_user(db_session, "owner")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(
        user_id=owner.id, title="Private", is_public=False
    )
    conv = await service.get_conversation(conv_id, requesting_user_id=owner.id)

    assert conv.id == conv_id
    assert conv.title == "Private"


@pytest.mark.asyncio
async def test_get_private_conversation_by_non_owner_raises(
    db_session: AsyncSession,
) -> None:
    owner = await _create_user(db_session, "owner2")
    stranger = await _create_user(db_session, "stranger2")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(
        user_id=owner.id, title="Secret", is_public=False
    )

    with pytest.raises(ConversationPermissionError):
        await service.get_conversation(conv_id, requesting_user_id=stranger.id)


@pytest.mark.asyncio
async def test_get_public_conversation_by_non_owner(db_session: AsyncSession) -> None:
    owner = await _create_user(db_session, "owner3")
    reader = await _create_user(db_session, "reader3")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(
        user_id=owner.id, title="Public chat", is_public=True
    )
    conv = await service.get_conversation(conv_id, requesting_user_id=reader.id)

    assert conv.id == conv_id


# ---------------------------------------------------------------------------
# Conversation listing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_conversations_returns_only_owner_convs(
    db_session: AsyncSession,
) -> None:
    alice = await _create_user(db_session, "alice")
    bob = await _create_user(db_session, "bob")
    service = ChatService(db_session)

    await service.create_conversation(user_id=alice.id, title="Alice chat 1")
    await service.create_conversation(user_id=alice.id, title="Alice chat 2")
    await service.create_conversation(user_id=bob.id, title="Bob chat")

    alice_convs = await service.get_user_conversations(user_id=alice.id)
    assert len(alice_convs) == 2
    titles = {c.title for c in alice_convs}
    assert titles == {"Alice chat 1", "Alice chat 2"}


@pytest.mark.asyncio
async def test_list_conversations_pagination(db_session: AsyncSession) -> None:
    user = await _create_user(db_session, "paginate")
    service = ChatService(db_session)

    for i in range(5):
        await service.create_conversation(user_id=user.id, title=f"Chat {i}")

    page1 = await service.get_user_conversations(user_id=user.id, skip=0, limit=3)
    page2 = await service.get_user_conversations(user_id=user.id, skip=3, limit=3)

    assert len(page1) == 3
    assert len(page2) == 2


# ---------------------------------------------------------------------------
# Conversation update
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_conversation_title(db_session: AsyncSession) -> None:
    user = await _create_user(db_session, "upd")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=user.id, title="Old title")
    updated = await service.update_conversation(
        conv_id, user.id, ConversationUpdate(title="New title")
    )

    assert updated.title == "New title"


@pytest.mark.asyncio
async def test_update_conversation_visibility(db_session: AsyncSession) -> None:
    user = await _create_user(db_session, "vis")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(
        user_id=user.id, title="Test", is_public=False
    )
    updated = await service.update_conversation(
        conv_id, user.id, ConversationUpdate(is_public=True)
    )

    assert updated.is_public is True


@pytest.mark.asyncio
async def test_update_conversation_by_non_owner_raises(
    db_session: AsyncSession,
) -> None:
    owner = await _create_user(db_session, "upd_owner")
    other = await _create_user(db_session, "upd_other")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=owner.id)

    with pytest.raises(ConversationPermissionError):
        await service.update_conversation(
            conv_id, other.id, ConversationUpdate(title="Hijacked")
        )


# ---------------------------------------------------------------------------
# Conversation deletion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_conversation(db_session: AsyncSession) -> None:
    user = await _create_user(db_session, "del")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=user.id, title="To delete")
    await service.delete_conversation(conv_id, user.id)

    with pytest.raises(ConversationNotFoundError):
        await service.get_conversation(conv_id, user.id)


@pytest.mark.asyncio
async def test_delete_conversation_by_non_owner_raises(
    db_session: AsyncSession,
) -> None:
    owner = await _create_user(db_session, "del_owner")
    other = await _create_user(db_session, "del_other")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=owner.id)

    with pytest.raises(ConversationPermissionError):
        await service.delete_conversation(conv_id, other.id)


# ---------------------------------------------------------------------------
# Message persistence
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_save_and_retrieve_messages(db_session: AsyncSession) -> None:
    user = await _create_user(db_session, "msgs")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=user.id)
    msg_id = await service.save_message(conv_id, "Hello!", "user")

    assert isinstance(msg_id, int)

    conv = await service.get_conversation(conv_id, user.id)
    assert len(conv.messages) == 1
    assert conv.messages[0].content == "Hello!"
    assert conv.messages[0].role == "user"


@pytest.mark.asyncio
async def test_save_message_unknown_role_defaults_to_user(
    db_session: AsyncSession,
) -> None:
    user = await _create_user(db_session, "unkrole")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=user.id)
    await service.save_message(conv_id, "Mystery message", "unknown_role")

    conv = await service.get_conversation(conv_id, user.id)
    assert conv.messages[0].role == "user"


# ---------------------------------------------------------------------------
# Conversation context for AI
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_conversation_context_chronological_order(
    db_session: AsyncSession,
) -> None:
    user = await _create_user(db_session, "ctx")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=user.id)
    await service.save_message(conv_id, "First", "user")
    await service.save_message(conv_id, "Second", "assistant")
    await service.save_message(conv_id, "Third", "user")

    ctx = await service.get_conversation_context(conv_id)

    assert len(ctx) == 3
    assert ctx[0]["content"] == "First"
    assert ctx[0]["role"] == "user"
    assert ctx[1]["content"] == "Second"
    assert ctx[1]["role"] == "assistant"
    assert ctx[2]["content"] == "Third"


@pytest.mark.asyncio
async def test_get_conversation_context_respects_limit(
    db_session: AsyncSession,
) -> None:
    user = await _create_user(db_session, "ctx_limit")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=user.id)
    for i in range(CONTEXT_WINDOW + 5):
        await service.save_message(conv_id, f"Message {i}", "user")

    ctx = await service.get_conversation_context(conv_id, limit=CONTEXT_WINDOW)

    assert len(ctx) == CONTEXT_WINDOW
    # Should be the most recent CONTEXT_WINDOW messages in chronological order
    assert ctx[-1]["content"] == f"Message {CONTEXT_WINDOW + 4}"


# ---------------------------------------------------------------------------
# Messages pagination
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_messages_pagination(db_session: AsyncSession) -> None:
    user = await _create_user(db_session, "msgpag")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(user_id=user.id)
    for i in range(10):
        await service.save_message(conv_id, f"Msg {i}", "user")

    page = await service.get_messages(
        conv_id, requesting_user_id=user.id, skip=0, limit=5
    )
    assert len(page) == 5
    assert page[0]["content"] == "Msg 0"


@pytest.mark.asyncio
async def test_get_messages_non_owner_private_raises(
    db_session: AsyncSession,
) -> None:
    owner = await _create_user(db_session, "msgpriv_owner")
    other = await _create_user(db_session, "msgpriv_other")
    service = ChatService(db_session)

    conv_id = await service.create_conversation(
        user_id=owner.id, is_public=False
    )
    await service.save_message(conv_id, "secret", "user")

    with pytest.raises(ConversationPermissionError):
        await service.get_messages(conv_id, requesting_user_id=other.id)
