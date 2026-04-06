"""
DocumentService — PDF ingestion pipeline.

Responsibilities
----------------
1. Persist a ``Document`` record for the uploaded file.
2. Extract text from each PDF page using *pypdf*.
3. Split extracted text into overlapping chunks.
4. Generate an OpenAI embedding vector for every chunk.
5. Persist each chunk (text + embedding) as a ``DocumentChunk`` row.
6. Update the parent ``Document`` status throughout (PENDING → PROCESSING
   → COMPLETED / FAILED).

The embedding model used is ``text-embedding-3-small`` which returns 1 536-
dimensional float vectors.  Vectors are stored as JSON arrays so no
pgvector extension is required.
"""

from __future__ import annotations

import io
import logging
import math
import re
from typing import List, Optional

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.document import Document, DocumentChunk, DocumentStatus
from app.schemas.document import DocumentDetail, DocumentSummary, DocumentUploadResponse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tuneable constants
# ---------------------------------------------------------------------------

EMBEDDING_MODEL = "text-embedding-3-small"

# Target characters per chunk.  Smaller values → more granular retrieval.
CHUNK_SIZE = 1_000

# Overlap between consecutive chunks (characters) to preserve context at
# boundaries.
CHUNK_OVERLAP = 200

# Maximum characters sent to the embedding API in one request.
# text-embedding-3-small accepts up to ~8 191 tokens; 6 000 chars is a
# safe ceiling.
MAX_EMBED_CHARS = 6_000

# How many chunks are embedded in a single OpenAI batch call.
EMBED_BATCH_SIZE = 20


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _split_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """
    Split *text* into overlapping fixed-size chunks.

    The split respects sentence and paragraph boundaries where possible —
    it searches backwards from the hard cut point for the nearest whitespace.
    """
    if not text.strip():
        return []

    # Normalise whitespace (collapse runs of blank lines, etc.)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    chunks: List[str] = []
    start = 0
    length = len(text)

    while start < length:
        end = min(start + chunk_size, length)

        # Try to break on a natural boundary (paragraph > sentence > word)
        if end < length:
            for boundary in ("\n\n", ". ", "? ", "! ", "\n", " "):
                idx = text.rfind(boundary, start, end)
                if idx > start:
                    end = idx + len(boundary)
                    break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk[:MAX_EMBED_CHARS])

        # Next window starts *overlap* characters before the current end so
        # context is preserved across chunk boundaries.
        start = end - overlap if end - overlap > start else end

    return chunks


def _extract_text_from_pdf(file_bytes: bytes) -> tuple[List[tuple[int, str]], int]:
    """
    Use *pypdf* to extract text from each page.

    Returns
    -------
    pages : list of (page_number, text) tuples (1-based page numbers)
    page_count : total number of pages in the document
    """
    try:
        from pypdf import PdfReader  # local import so the dep is optional in tests
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "pypdf is required for PDF text extraction. "
            "Install it with: pip install pypdf"
        ) from exc

    reader = PdfReader(io.BytesIO(file_bytes))
    page_count = len(reader.pages)
    pages: List[tuple[int, str]] = []

    for page_num, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception as exc:
            logger.warning("Failed to extract text from page %d: %s", page_num, exc)
            text = ""
        pages.append((page_num, text))

    return pages, page_count


async def _embed_texts(
    client: AsyncOpenAI,
    texts: List[str],
) -> List[Optional[List[float]]]:
    """
    Generate embeddings for *texts* in batches.

    Returns a list of float-vectors in the same order as *texts*.  Any text
    that fails to embed gets ``None`` in the result list.
    """
    embeddings: List[Optional[List[float]]] = [None] * len(texts)

    for batch_start in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[batch_start : batch_start + EMBED_BATCH_SIZE]
        try:
            response = await client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=batch,
            )
            for i, embed_data in enumerate(response.data):
                embeddings[batch_start + i] = embed_data.embedding
        except Exception as exc:
            logger.error(
                "Embedding API error for batch starting at %d: %s",
                batch_start,
                exc,
                exc_info=True,
            )
            # Leave those slots as None; the chunks will still be stored
            # without embeddings rather than failing the entire ingestion.

    return embeddings


# ---------------------------------------------------------------------------
# Public service class
# ---------------------------------------------------------------------------


class DocumentNotFoundError(Exception):
    """Raised when a requested document does not exist."""


class DocumentPermissionError(Exception):
    """Raised when a user attempts to access a document they do not own."""


class DocumentService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._openai = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    # ------------------------------------------------------------------
    # Upload + ingestion
    # ------------------------------------------------------------------

    async def ingest_pdf(
        self,
        file_bytes: bytes,
        original_filename: str,
        user_id: int,
    ) -> DocumentUploadResponse:
        """
        Full ingestion pipeline for a PDF file.

        1. Creates a ``Document`` row (status=PROCESSING).
        2. Extracts text page-by-page.
        3. Chunks and embeds all text.
        4. Persists ``DocumentChunk`` rows.
        5. Marks the document COMPLETED (or FAILED on error).

        Returns the completed ``DocumentUploadResponse``.
        """
        # Sanitise filename
        safe_filename = re.sub(r"[^\w.\-]", "_", original_filename)

        document = Document(
            filename=safe_filename,
            original_filename=original_filename,
            file_size=len(file_bytes),
            status=DocumentStatus.PROCESSING,
            user_id=user_id,
        )
        self.db.add(document)
        await self.db.flush()
        await self.db.commit()
        await self.db.refresh(document)

        try:
            await self._process_pdf(document, file_bytes)
        except Exception as exc:
            logger.error(
                "Ingestion failed for document id=%d: %s", document.id, exc, exc_info=True
            )
            document.status = DocumentStatus.FAILED
            document.error_message = str(exc)[:500]
            await self.db.commit()
            await self.db.refresh(document)

        return DocumentUploadResponse(
            id=document.id,
            filename=document.filename,
            original_filename=document.original_filename,
            file_size=document.file_size,
            status=document.status.value,
            created_at=document.created_at,
        )

    async def _process_pdf(self, document: Document, file_bytes: bytes) -> None:
        """Extract text, chunk, embed, and persist chunks."""
        # ── 1. Extract text ───────────────────────────────────────────
        pages, page_count = _extract_text_from_pdf(file_bytes)
        document.page_count = page_count

        # ── 2. Build chunks ────────────────────────────────────────────
        # Each element: (chunk_index, page_number, text)
        raw_chunks: List[tuple[int, int, str]] = []
        chunk_index = 0
        for page_number, page_text in pages:
            for chunk_text in _split_text(page_text):
                raw_chunks.append((chunk_index, page_number, chunk_text))
                chunk_index += 1

        if not raw_chunks:
            # No extractable text (e.g. scanned image PDF); mark complete
            # with zero chunks rather than failing.
            logger.warning(
                "No extractable text found in document id=%d (%s)",
                document.id,
                document.original_filename,
            )
            document.status = DocumentStatus.COMPLETED
            await self.db.commit()
            return

        # ── 3. Generate embeddings ─────────────────────────────────────
        texts = [c[2] for c in raw_chunks]
        embeddings = await _embed_texts(self._openai, texts)

        # ── 4. Persist chunks ──────────────────────────────────────────
        for (idx, page_number, text), embedding in zip(raw_chunks, embeddings):
            chunk = DocumentChunk(
                document_id=document.id,
                chunk_index=idx,
                page_number=page_number,
                content=text,
                embedding=embedding,
            )
            self.db.add(chunk)

        document.status = DocumentStatus.COMPLETED
        await self.db.flush()
        await self.db.commit()

        logger.info(
            "Ingested document id=%d (%s): %d pages, %d chunks",
            document.id,
            document.original_filename,
            page_count,
            len(raw_chunks),
        )

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------

    async def get_document(
        self,
        document_id: int,
        requesting_user_id: int,
    ) -> DocumentDetail:
        """
        Return a document with all its chunks (embeddings excluded from the
        schema — they are stored in the DB but not serialised in API responses).

        Raises
        ------
        DocumentNotFoundError
        DocumentPermissionError
        """
        result = await self.db.execute(
            select(Document)
            .options(selectinload(Document.chunks))
            .where(Document.id == document_id)
        )
        document = result.scalar_one_or_none()

        if document is None:
            raise DocumentNotFoundError(f"Document {document_id} not found")
        if document.user_id != requesting_user_id:
            raise DocumentPermissionError(
                f"User {requesting_user_id} does not own document {document_id}"
            )

        return DocumentDetail.model_validate(document)

    async def list_documents(
        self,
        user_id: int,
        skip: int = 0,
        limit: int = 20,
    ) -> List[DocumentSummary]:
        """Return a paginated list of documents owned by *user_id* (newest first)."""
        result = await self.db.execute(
            select(Document)
            .where(Document.user_id == user_id)
            .order_by(Document.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        documents = result.scalars().all()
        return [DocumentSummary.model_validate(doc) for doc in documents]

    async def delete_document(
        self,
        document_id: int,
        requesting_user_id: int,
    ) -> None:
        """
        Delete a document and all its chunks (cascade).

        Raises
        ------
        DocumentNotFoundError
        DocumentPermissionError
        """
        result = await self.db.execute(
            select(Document).where(Document.id == document_id)
        )
        document = result.scalar_one_or_none()

        if document is None:
            raise DocumentNotFoundError(f"Document {document_id} not found")
        if document.user_id != requesting_user_id:
            raise DocumentPermissionError(
                f"User {requesting_user_id} does not own document {document_id}"
            )

        await self.db.delete(document)
        await self.db.commit()
        logger.debug(
            "Deleted document id=%d by user_id=%d", document_id, requesting_user_id
        )

    # ------------------------------------------------------------------
    # Similarity search (used by the chat/RAG pipeline)
    # ------------------------------------------------------------------

    async def search_similar_chunks(
        self,
        query_embedding: List[float],
        user_id: int,
        top_k: int = 5,
    ) -> List[DocumentChunk]:
        """
        Return the *top_k* chunks (owned by *user_id*) whose embeddings are
        most similar to *query_embedding*, ranked by cosine similarity.

        Because we store embeddings as JSON rather than native vectors we
        fetch all completed-document chunks for the user and rank in Python.
        This is acceptable for moderate document volumes; a pgvector column
        should be considered for large-scale deployments.
        """
        result = await self.db.execute(
            select(DocumentChunk)
            .join(Document, DocumentChunk.document_id == Document.id)
            .where(
                Document.user_id == user_id,
                Document.status == DocumentStatus.COMPLETED,
                DocumentChunk.embedding.isnot(None),
            )
        )
        chunks = result.scalars().all()

        if not chunks:
            return []

        scored = [
            (chunk, _cosine_similarity(query_embedding, chunk.embedding))
            for chunk in chunks
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [chunk for chunk, _ in scored[:top_k]]


# ---------------------------------------------------------------------------
# Utility — cosine similarity
# ---------------------------------------------------------------------------


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute the cosine similarity between two equal-length float vectors."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)
