"""
SQLAlchemy ORM models for PDF document ingestion.

Document  — top-level record per uploaded PDF (metadata + status).
DocumentChunk — individual text chunks derived from a Document, each
                storing its embedding as a JSON-serialised float array.
"""

from __future__ import annotations

import enum

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.db.base import Base


class DocumentStatus(enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    # Original name supplied by the client
    original_filename = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)          # bytes
    page_count = Column(Integer, nullable=True)
    status = Column(
        Enum(DocumentStatus),
        nullable=False,
        default=DocumentStatus.PENDING,
    )
    # Error message populated when status == FAILED
    error_message = Column(Text, nullable=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    chunks = relationship(
        "DocumentChunk", back_populates="document", cascade="all, delete-orphan"
    )
    user = relationship("User")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(
        Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    # Zero-based index of this chunk within the document
    chunk_index = Column(Integer, nullable=False)
    # Source page (1-based) this chunk was drawn from
    page_number = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    # OpenAI text-embedding stored as a JSON array of floats
    embedding = Column(JSON, nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationship
    document = relationship("Document", back_populates="chunks")
