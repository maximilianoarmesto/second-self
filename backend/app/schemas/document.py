"""
Pydantic schemas for the PDF document ingestion API.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Chunk schemas
# ---------------------------------------------------------------------------


class DocumentChunkBase(BaseModel):
    chunk_index: int
    page_number: int
    content: str


class DocumentChunk(DocumentChunkBase):
    id: int
    document_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Document schemas
# ---------------------------------------------------------------------------


class DocumentBase(BaseModel):
    filename: str
    original_filename: str
    file_size: int
    page_count: Optional[int] = None
    # Stored as a DocumentStatus enum in the ORM; serialised as its string value.
    status: str

    @field_validator("status", mode="before")
    @classmethod
    def coerce_status(cls, v: Any) -> str:
        """Accept both raw strings and enum instances."""
        if hasattr(v, "value"):
            return v.value
        return str(v)


class DocumentSummary(DocumentBase):
    """Lightweight view returned in list endpoints (no chunks)."""

    id: int
    user_id: int
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentDetail(DocumentSummary):
    """Full document view including text chunks (embeddings excluded)."""

    chunks: List[DocumentChunk] = Field(default_factory=list)

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Upload response
# ---------------------------------------------------------------------------


class DocumentUploadResponse(BaseModel):
    """Returned immediately after a PDF is accepted for processing."""

    id: int
    filename: str
    original_filename: str
    file_size: int
    status: str
    created_at: datetime

    @field_validator("status", mode="before")
    @classmethod
    def coerce_status(cls, v: Any) -> str:
        """Accept both raw strings and enum instances."""
        if hasattr(v, "value"):
            return v.value
        return str(v)

    model_config = {"from_attributes": True}
