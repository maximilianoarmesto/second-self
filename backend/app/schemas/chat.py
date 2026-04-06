from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Message schemas
# ---------------------------------------------------------------------------


class MessageBase(BaseModel):
    content: str
    role: str


class MessageCreate(MessageBase):
    conversation_id: int


class Message(MessageBase):
    id: int
    conversation_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Conversation schemas
# ---------------------------------------------------------------------------


class ConversationBase(BaseModel):
    title: str = "New Conversation"
    is_public: bool = False


class ConversationCreate(ConversationBase):
    """Schema used when explicitly creating a new conversation."""

    title: str = "New Conversation"
    is_public: bool = False


class ConversationUpdate(BaseModel):
    """Schema for updating conversation metadata."""

    title: Optional[str] = None
    is_public: Optional[bool] = None


class ConversationSummary(ConversationBase):
    """Lightweight view returned in list endpoints (no messages)."""

    id: int
    user_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class Conversation(ConversationBase):
    """Full conversation view including messages."""

    id: int
    user_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    messages: List[Message] = Field(default_factory=list)

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Chat request / response schemas
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="The user message to send")
    conversation_id: Optional[int] = Field(
        None, description="Existing conversation ID; omit to start a new conversation"
    )
    is_public: bool = Field(
        False, description="Whether a newly created conversation should be public"
    )


class ChatResponse(BaseModel):
    message: str
    conversation_id: int
    created_at: datetime
