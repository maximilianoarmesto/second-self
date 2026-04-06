"""
ChatService — database-backed management of Conversations and Messages.

Design notes
------------
* All DB interaction is async (SQLAlchemy 2 asyncpg driver).
* Conversation ownership is enforced: callers supply the *requesting* user's ID
  and any access to another user's private conversation is rejected with a
  PermissionError so the endpoint layer can map it to HTTP 403.
* ``get_conversation_context`` returns messages in chronological order ready
  for the AI service — newest messages are capped to keep the context window
  manageable.
"""

from __future__ import annotations

import logging
from typing import Dict, List

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.conversation import Conversation, Message, MessageRole
from app.schemas.chat import (
    Conversation as ConversationSchema,
    ConversationSummary,
    ConversationUpdate,
)

logger = logging.getLogger(__name__)

# Maximum number of past messages to load when building AI context.
CONTEXT_WINDOW = 20


class ConversationNotFoundError(Exception):
    """Raised when a requested conversation does not exist."""


class ConversationPermissionError(Exception):
    """Raised when a user attempts to access a conversation they do not own."""


class ChatService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Conversation CRUD
    # ------------------------------------------------------------------

    async def create_conversation(
        self,
        user_id: int,
        title: str = "New Conversation",
        is_public: bool = False,
    ) -> int:
        """Create a new conversation and return its ID."""
        conversation = Conversation(
            user_id=user_id,
            title=title,
            is_public=is_public,
        )
        self.db.add(conversation)
        await self.db.flush()  # populate id without a full commit
        await self.db.commit()
        await self.db.refresh(conversation)
        logger.debug(
            "Created conversation id=%d for user_id=%d", conversation.id, user_id
        )
        return conversation.id

    async def get_conversation(
        self,
        conversation_id: int,
        requesting_user_id: int,
    ) -> ConversationSchema:
        """
        Return the full conversation (with messages) by ID.

        Raises
        ------
        ConversationNotFoundError
            If no conversation with *conversation_id* exists.
        ConversationPermissionError
            If the conversation is private and belongs to a different user.
        """
        query = (
            select(Conversation)
            .options(
                selectinload(Conversation.messages),
            )
            .where(Conversation.id == conversation_id)
        )
        result = await self.db.execute(query)
        conversation = result.scalar_one_or_none()

        if conversation is None:
            raise ConversationNotFoundError(
                f"Conversation {conversation_id} not found"
            )

        self._assert_access(conversation, requesting_user_id)
        return ConversationSchema.model_validate(conversation)

    async def get_user_conversations(
        self,
        user_id: int,
        skip: int = 0,
        limit: int = 20,
    ) -> List[ConversationSummary]:
        """Return a paginated list of conversations owned by *user_id* (no messages).

        Conversations are ordered by *updated_at* descending; rows where
        *updated_at* is NULL (newly created, not yet bumped) fall back to
        *created_at* so they still sort sensibly without a NULLS LAST clause
        (which is unsupported by SQLite).
        """
        sort_key = func.coalesce(Conversation.updated_at, Conversation.created_at)
        query = (
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(sort_key.desc())
            .offset(skip)
            .limit(limit)
        )
        result = await self.db.execute(query)
        conversations = result.scalars().all()
        return [ConversationSummary.model_validate(conv) for conv in conversations]

    async def update_conversation(
        self,
        conversation_id: int,
        requesting_user_id: int,
        update_data: ConversationUpdate,
    ) -> ConversationSchema:
        """
        Update conversation title and/or visibility.

        Raises
        ------
        ConversationNotFoundError / ConversationPermissionError
            Same semantics as :meth:`get_conversation`.
        """
        result = await self.db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        conversation = result.scalar_one_or_none()

        if conversation is None:
            raise ConversationNotFoundError(
                f"Conversation {conversation_id} not found"
            )
        # Only the owner can update
        if conversation.user_id != requesting_user_id:
            raise ConversationPermissionError(
                f"User {requesting_user_id} does not own conversation {conversation_id}"
            )

        changed = False
        if update_data.title is not None:
            conversation.title = update_data.title
            changed = True
        if update_data.is_public is not None:
            conversation.is_public = update_data.is_public
            changed = True

        if changed:
            # Explicitly bump updated_at so the timestamp reflects the change
            # even when SQLAlchemy's onupdate is driver-dependent.
            await self.db.execute(
                update(Conversation)
                .where(Conversation.id == conversation_id)
                .values(
                    title=conversation.title,
                    is_public=conversation.is_public,
                    updated_at=func.now(),
                )
            )
            await self.db.commit()

        # Reload with messages
        return await self.get_conversation(conversation_id, requesting_user_id)

    async def delete_conversation(
        self,
        conversation_id: int,
        requesting_user_id: int,
    ) -> None:
        """
        Delete a conversation and all its messages (cascade).

        Raises
        ------
        ConversationNotFoundError / ConversationPermissionError
        """
        result = await self.db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        conversation = result.scalar_one_or_none()

        if conversation is None:
            raise ConversationNotFoundError(
                f"Conversation {conversation_id} not found"
            )
        if conversation.user_id != requesting_user_id:
            raise ConversationPermissionError(
                f"User {requesting_user_id} does not own conversation {conversation_id}"
            )

        await self.db.delete(conversation)
        await self.db.commit()
        logger.debug(
            "Deleted conversation id=%d by user_id=%d",
            conversation_id,
            requesting_user_id,
        )

    # ------------------------------------------------------------------
    # Message operations
    # ------------------------------------------------------------------

    async def save_message(
        self,
        conversation_id: int,
        content: str,
        role: str,
    ) -> int:
        """
        Persist a message and bump the parent conversation's *updated_at*.

        Returns the new message's ID.
        """
        try:
            message_role = MessageRole(role)
        except ValueError:
            # Fallback: unknown roles stored as USER
            logger.warning("Unknown message role '%s'; defaulting to 'user'", role)
            message_role = MessageRole.USER

        message = Message(
            conversation_id=conversation_id,
            content=content,
            role=message_role,
        )
        self.db.add(message)

        # Explicitly bump updated_at on the parent conversation
        await self.db.execute(
            update(Conversation)
            .where(Conversation.id == conversation_id)
            .values(updated_at=func.now())
        )

        await self.db.flush()
        await self.db.commit()
        await self.db.refresh(message)
        return message.id

    async def get_conversation_context(
        self,
        conversation_id: int,
        limit: int = CONTEXT_WINDOW,
    ) -> List[Dict[str, str]]:
        """
        Return the *limit* most-recent messages in **chronological** order,
        as plain dicts ready to pass straight into the AI service.

        Schema: ``[{"role": "user"|"assistant"|"system", "content": "..."}, ...]``
        """
        query = (
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
        result = await self.db.execute(query)
        messages = result.scalars().all()

        # Reverse so the AI receives them oldest → newest
        return [
            {"role": msg.role.value, "content": msg.content}
            for msg in reversed(messages)
        ]

    async def get_messages(
        self,
        conversation_id: int,
        requesting_user_id: int,
        skip: int = 0,
        limit: int = 50,
    ) -> List[dict]:
        """
        Return paginated messages for a conversation, oldest first.

        Performs an ownership / visibility check before returning data.
        """
        # Existence + access check (reuse get_conversation)
        await self.get_conversation(conversation_id, requesting_user_id)

        query = (
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc())
            .offset(skip)
            .limit(limit)
        )
        result = await self.db.execute(query)
        messages = result.scalars().all()
        return [
            {
                "id": msg.id,
                "role": msg.role.value,
                "content": msg.content,
                "created_at": msg.created_at,
            }
            for msg in messages
        ]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _assert_access(conversation: Conversation, requesting_user_id: int) -> None:
        """Raise ConversationPermissionError if the user may not read the conversation."""
        if conversation.user_id != requesting_user_id and not conversation.is_public:
            raise ConversationPermissionError(
                f"User {requesting_user_id} does not have access to "
                f"conversation {conversation.id}"
            )
