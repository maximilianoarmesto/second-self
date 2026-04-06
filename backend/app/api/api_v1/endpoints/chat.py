"""
Chat API endpoints.

All routes (except the public-conversation read) require a valid Bearer token.
The ``requesting_user_id`` is extracted from the token so no data can be accessed
or mutated by a different user without an explicit public-sharing flag.
"""

from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user_id
from app.db.database import get_db
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    Conversation as ConversationSchema,
    ConversationCreate,
    ConversationSummary,
    ConversationUpdate,
    Message as MessageSchema,
)
from app.services.ai_service import AIService
from app.services.chat_service import (
    ChatService,
    ConversationNotFoundError,
    ConversationPermissionError,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _not_found(conversation_id: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Conversation {conversation_id} not found",
    )


def _forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this conversation",
    )


# ---------------------------------------------------------------------------
# Chat (send a message)
# ---------------------------------------------------------------------------


@router.post("/", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ChatResponse:
    """
    Send a message and receive an AI-generated reply.

    * If ``conversation_id`` is omitted, a new conversation is created
      automatically and its ID is returned in the response.
    * Conversation history from the database is fed to the AI so each reply
      is contextually aware of prior turns.
    """
    chat_service = ChatService(db)
    ai_service = AIService()

    try:
        # ---- Resolve or create the conversation ---------------------------
        conversation_id = request.conversation_id
        if conversation_id is None:
            ai_title = ai_service.get_conversation_title(request.message)
            conversation_id = await chat_service.create_conversation(
                user_id=current_user_id,
                title=ai_title,
                is_public=request.is_public,
            )
        else:
            # Verify the conversation exists and the user may access it
            try:
                await chat_service.get_conversation(conversation_id, current_user_id)
            except ConversationNotFoundError:
                raise _not_found(conversation_id)
            except ConversationPermissionError:
                raise _forbidden()

        # ---- Persist the user turn ----------------------------------------
        await chat_service.save_message(
            conversation_id=conversation_id,
            content=request.message,
            role="user",
        )

        # ---- Build context from DB history --------------------------------
        # We load history *after* saving the user message so the AI always
        # sees the current turn included in the history window, which lets
        # the context cap work correctly when the window limit is hit.
        history = await chat_service.get_conversation_context(conversation_id)

        # Strip the last entry (the user message just saved) so we pass it
        # separately as `user_message` rather than duplicating it.
        if history and history[-1]["role"] == "user":
            history = history[:-1]

        # ---- Generate and persist the assistant reply ---------------------
        ai_response = await ai_service.generate_response(
            user_message=request.message,
            conversation_history=history,
        )

        await chat_service.save_message(
            conversation_id=conversation_id,
            content=ai_response,
            role="assistant",
        )

        return ChatResponse(
            message=ai_response,
            conversation_id=conversation_id,
            created_at=datetime.utcnow(),
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Chat processing failed: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Conversations — CRUD
# ---------------------------------------------------------------------------


@router.post(
    "/conversations",
    response_model=ConversationSchema,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    body: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ConversationSchema:
    """Explicitly create a new (empty) conversation."""
    chat_service = ChatService(db)
    conversation_id = await chat_service.create_conversation(
        user_id=current_user_id,
        title=body.title,
        is_public=body.is_public,
    )
    try:
        return await chat_service.get_conversation(conversation_id, current_user_id)
    except ConversationNotFoundError:
        raise _not_found(conversation_id)


@router.get("/conversations", response_model=List[ConversationSummary])
async def list_conversations(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> List[ConversationSummary]:
    """Return a paginated list of the current user's conversations (newest first)."""
    chat_service = ChatService(db)
    return await chat_service.get_user_conversations(
        user_id=current_user_id,
        skip=skip,
        limit=limit,
    )


@router.get("/conversations/{conversation_id}", response_model=ConversationSchema)
async def get_conversation(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ConversationSchema:
    """
    Return a conversation with all its messages.

    Public conversations are readable by any authenticated user; private ones
    are restricted to their owner.
    """
    chat_service = ChatService(db)
    try:
        return await chat_service.get_conversation(conversation_id, current_user_id)
    except ConversationNotFoundError:
        raise _not_found(conversation_id)
    except ConversationPermissionError:
        raise _forbidden()


@router.patch("/conversations/{conversation_id}", response_model=ConversationSchema)
async def update_conversation(
    conversation_id: int,
    body: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ConversationSchema:
    """Update the title or visibility of a conversation (owner only)."""
    chat_service = ChatService(db)
    try:
        return await chat_service.update_conversation(
            conversation_id=conversation_id,
            requesting_user_id=current_user_id,
            update_data=body,
        )
    except ConversationNotFoundError:
        raise _not_found(conversation_id)
    except ConversationPermissionError:
        raise _forbidden()


@router.delete(
    "/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_conversation(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> None:
    """Delete a conversation and all its messages (owner only)."""
    chat_service = ChatService(db)
    try:
        await chat_service.delete_conversation(
            conversation_id=conversation_id,
            requesting_user_id=current_user_id,
        )
    except ConversationNotFoundError:
        raise _not_found(conversation_id)
    except ConversationPermissionError:
        raise _forbidden()


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=List[MessageSchema],
)
async def get_messages(
    conversation_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> List[MessageSchema]:
    """
    Return paginated messages for a conversation, oldest first.

    Respects the same public/private visibility rules as
    :func:`get_conversation`.
    """
    chat_service = ChatService(db)
    try:
        raw = await chat_service.get_messages(
            conversation_id=conversation_id,
            requesting_user_id=current_user_id,
            skip=skip,
            limit=limit,
        )
    except ConversationNotFoundError:
        raise _not_found(conversation_id)
    except ConversationPermissionError:
        raise _forbidden()

    return [
        MessageSchema(
            id=m["id"],
            content=m["content"],
            role=m["role"],
            conversation_id=conversation_id,
            created_at=m["created_at"],
        )
        for m in raw
    ]
