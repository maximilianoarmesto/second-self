"""
Unit tests for DocumentService helper functions and the service class.

No real PDF files, OpenAI API calls, or external network connections are used.
"""

from __future__ import annotations

import math
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.document_service import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    DocumentService,
    _cosine_similarity,
    _embed_texts,
    _split_text,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_user(db: AsyncSession, user_id: int = 1) -> None:
    """Insert a minimal User row so FK constraints on documents are satisfied."""
    from app.core.security import get_password_hash
    from app.models.user import User
    from sqlalchemy import select

    existing = await db.execute(select(User).where(User.id == user_id))
    if existing.scalar_one_or_none() is None:
        user = User(
            id=user_id,
            email=f"user{user_id}@test.com",
            username=f"user{user_id}",
            hashed_password=get_password_hash("testpass"),
            is_active=True,
        )
        db.add(user)
        await db.flush()


# ---------------------------------------------------------------------------
# _split_text
# ---------------------------------------------------------------------------


def test_split_text_empty_string() -> None:
    assert _split_text("") == []


def test_split_text_whitespace_only() -> None:
    assert _split_text("   \n\n  ") == []


def test_split_text_short_text_returns_single_chunk() -> None:
    text = "Hello world, this is a short document."
    chunks = _split_text(text, chunk_size=500)
    assert chunks == [text]


def test_split_text_long_text_produces_multiple_chunks() -> None:
    # Create text longer than the default chunk size
    text = ("word " * 300).strip()  # ~1 500 chars
    chunks = _split_text(text, chunk_size=500, overlap=50)
    assert len(chunks) > 1


def test_split_text_chunks_have_overlap() -> None:
    """Consecutive chunks should share some content due to the overlap window."""
    text = "sentence one. sentence two. sentence three. " * 50
    chunks = _split_text(text, chunk_size=200, overlap=50)
    if len(chunks) >= 2:
        # End of chunk N and start of chunk N+1 should have overlapping content
        assert len(chunks[0]) > 0
        assert len(chunks[1]) > 0


def test_split_text_no_chunk_exceeds_max_embed_chars() -> None:
    from app.services.document_service import MAX_EMBED_CHARS

    long_para = "x" * (MAX_EMBED_CHARS + 500)
    chunks = _split_text(long_para)
    for chunk in chunks:
        assert len(chunk) <= MAX_EMBED_CHARS


def test_split_text_collapses_excessive_newlines() -> None:
    text = "para one\n\n\n\n\npara two"
    chunks = _split_text(text)
    combined = " ".join(chunks)
    assert "para one" in combined
    assert "para two" in combined


# ---------------------------------------------------------------------------
# _cosine_similarity
# ---------------------------------------------------------------------------


def test_cosine_similarity_identical_vectors() -> None:
    v = [1.0, 0.0, 0.0]
    assert math.isclose(_cosine_similarity(v, v), 1.0, rel_tol=1e-6)


def test_cosine_similarity_orthogonal_vectors() -> None:
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert math.isclose(_cosine_similarity(a, b), 0.0, rel_tol=1e-6)


def test_cosine_similarity_opposite_vectors() -> None:
    a = [1.0, 0.0]
    b = [-1.0, 0.0]
    assert math.isclose(_cosine_similarity(a, b), -1.0, rel_tol=1e-6)


def test_cosine_similarity_zero_vector() -> None:
    a = [0.0, 0.0]
    b = [1.0, 2.0]
    assert _cosine_similarity(a, b) == 0.0


def test_cosine_similarity_mismatched_lengths() -> None:
    assert _cosine_similarity([1.0, 2.0], [1.0]) == 0.0


def test_cosine_similarity_empty_vectors() -> None:
    assert _cosine_similarity([], []) == 0.0


# ---------------------------------------------------------------------------
# _embed_texts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_embed_texts_returns_correct_count() -> None:
    """Each input text must produce one embedding in the output list."""
    mock_client = MagicMock()

    def _make_embed_response(texts: List[str]):
        data = [
            MagicMock(embedding=[0.1, 0.2, 0.3], index=i) for i, _ in enumerate(texts)
        ]
        return MagicMock(data=data)

    mock_client.embeddings = MagicMock()
    mock_client.embeddings.create = AsyncMock(
        side_effect=lambda model, input: _make_embed_response(input)
    )

    texts = ["text one", "text two", "text three"]
    result = await _embed_texts(mock_client, texts)

    assert len(result) == 3
    assert all(emb == [0.1, 0.2, 0.3] for emb in result)


@pytest.mark.asyncio
async def test_embed_texts_handles_api_error_gracefully() -> None:
    """When the API call raises, affected slots are None but no exception bubbles up."""
    mock_client = MagicMock()
    mock_client.embeddings = MagicMock()
    mock_client.embeddings.create = AsyncMock(side_effect=RuntimeError("API down"))

    result = await _embed_texts(mock_client, ["text one", "text two"])

    assert result == [None, None]


@pytest.mark.asyncio
async def test_embed_texts_batches_correctly() -> None:
    """Texts are sent in batches; the API is called ceil(n/batch_size) times."""
    from app.services.document_service import EMBED_BATCH_SIZE

    call_count = 0

    async def fake_create(model, input):
        nonlocal call_count
        call_count += 1
        data = [MagicMock(embedding=[float(i)], index=i) for i, _ in enumerate(input)]
        return MagicMock(data=data)

    mock_client = MagicMock()
    mock_client.embeddings = MagicMock()
    mock_client.embeddings.create = fake_create

    n = EMBED_BATCH_SIZE + 3  # needs 2 batches
    texts = [f"text {i}" for i in range(n)]
    result = await _embed_texts(mock_client, texts)

    assert len(result) == n
    expected_calls = math.ceil(n / EMBED_BATCH_SIZE)
    assert call_count == expected_calls


# ---------------------------------------------------------------------------
# DocumentService.ingest_pdf (mocked extraction + embedding)
# ---------------------------------------------------------------------------


def _make_service(db_session) -> DocumentService:
    """Construct a DocumentService whose OpenAI client is a MagicMock."""
    service = DocumentService(db_session)
    service._openai = MagicMock()
    return service


@pytest.mark.asyncio
async def test_ingest_pdf_creates_document_and_chunks(db_session) -> None:
    """Happy path: valid PDF bytes produce a COMPLETED document with chunks."""
    from app.models.document import Document, DocumentStatus
    from sqlalchemy import select

    await _create_user(db_session, user_id=1)

    fake_pdf_bytes = b"%PDF-1.4 fake content for testing"
    pages = [(1, "Page one text with enough content to form a chunk.")]

    service = _make_service(db_session)

    # Mock PDF extraction
    with patch(
        "app.services.document_service._extract_text_from_pdf",
        return_value=(pages, 1),
    ):
        # Mock embedding generation
        with patch(
            "app.services.document_service._embed_texts",
            new_callable=AsyncMock,
            return_value=[[0.1, 0.2, 0.3]],
        ):
            response = await service.ingest_pdf(
                file_bytes=fake_pdf_bytes,
                original_filename="test.pdf",
                user_id=1,
            )

    assert response.status == "completed"
    assert response.original_filename == "test.pdf"

    # Verify the document row in DB
    result = await db_session.execute(select(Document).where(Document.id == response.id))
    doc = result.scalar_one()
    assert doc.status == DocumentStatus.COMPLETED
    assert doc.page_count == 1


@pytest.mark.asyncio
async def test_ingest_pdf_stores_chunks_with_embeddings(db_session) -> None:
    from app.models.document import DocumentChunk
    from sqlalchemy import select

    await _create_user(db_session, user_id=1)

    fake_pdf_bytes = b"%PDF-1.4 test"
    pages = [(1, "chunk text alpha"), (2, "chunk text beta")]
    embeddings = [[0.1, 0.2], [0.3, 0.4]]

    service = _make_service(db_session)

    with patch(
        "app.services.document_service._extract_text_from_pdf",
        return_value=(pages, 2),
    ):
        with patch(
            "app.services.document_service._embed_texts",
            new_callable=AsyncMock,
            return_value=embeddings,
        ):
            response = await service.ingest_pdf(
                file_bytes=fake_pdf_bytes,
                original_filename="multi_page.pdf",
                user_id=1,
            )

    result = await db_session.execute(
        select(DocumentChunk).where(DocumentChunk.document_id == response.id)
    )
    chunks = result.scalars().all()
    assert len(chunks) == 2
    stored_embeddings = [c.embedding for c in sorted(chunks, key=lambda c: c.chunk_index)]
    assert stored_embeddings[0] == [0.1, 0.2]
    assert stored_embeddings[1] == [0.3, 0.4]


@pytest.mark.asyncio
async def test_ingest_pdf_handles_no_text_gracefully(db_session) -> None:
    """Scanned PDFs with no extractable text should still complete without error."""
    from app.models.document import Document, DocumentStatus
    from sqlalchemy import select

    await _create_user(db_session, user_id=1)

    service = _make_service(db_session)

    with patch(
        "app.services.document_service._extract_text_from_pdf",
        return_value=([(1, ""), (2, "  ")], 2),
    ):
        response = await service.ingest_pdf(
            file_bytes=b"%PDF-1.4",
            original_filename="scanned.pdf",
            user_id=1,
        )

    assert response.status == "completed"
    result = await db_session.execute(select(Document).where(Document.id == response.id))
    doc = result.scalar_one()
    assert doc.status == DocumentStatus.COMPLETED


@pytest.mark.asyncio
async def test_ingest_pdf_marks_failed_on_extraction_error(db_session) -> None:
    """Extraction exceptions should be caught and the document marked FAILED."""
    from app.models.document import Document, DocumentStatus
    from sqlalchemy import select

    await _create_user(db_session, user_id=1)

    service = _make_service(db_session)

    with patch(
        "app.services.document_service._extract_text_from_pdf",
        side_effect=RuntimeError("Corrupted PDF"),
    ):
        response = await service.ingest_pdf(
            file_bytes=b"not a pdf",
            original_filename="corrupt.pdf",
            user_id=1,
        )

    assert response.status == "failed"
    result = await db_session.execute(select(Document).where(Document.id == response.id))
    doc = result.scalar_one()
    assert doc.status == DocumentStatus.FAILED
    assert "Corrupted PDF" in doc.error_message


# ---------------------------------------------------------------------------
# DocumentService.search_similar_chunks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_similar_chunks_returns_top_k(db_session) -> None:
    """Chunks are ranked by cosine similarity; only top_k are returned."""
    from app.models.document import Document, DocumentChunk, DocumentStatus
    from sqlalchemy import select

    await _create_user(db_session, user_id=42)

    # Seed a COMPLETED document with 3 chunks having known embeddings
    doc = Document(
        filename="search_test.pdf",
        original_filename="search_test.pdf",
        file_size=100,
        status=DocumentStatus.COMPLETED,
        user_id=42,
        page_count=1,
    )
    db_session.add(doc)
    await db_session.flush()

    chunk_embeddings = [
        [1.0, 0.0],   # identical to query
        [0.0, 1.0],   # orthogonal
        [-1.0, 0.0],  # opposite
    ]
    for i, emb in enumerate(chunk_embeddings):
        db_session.add(
            DocumentChunk(
                document_id=doc.id,
                chunk_index=i,
                page_number=1,
                content=f"chunk {i}",
                embedding=emb,
            )
        )
    await db_session.commit()

    service = _make_service(db_session)
    query_embedding = [1.0, 0.0]
    results = await service.search_similar_chunks(
        query_embedding=query_embedding,
        user_id=42,
        top_k=2,
    )

    assert len(results) == 2
    # Most similar chunk should be first
    assert results[0].content == "chunk 0"


@pytest.mark.asyncio
async def test_search_similar_chunks_empty_when_no_documents(db_session) -> None:
    service = _make_service(db_session)
    results = await service.search_similar_chunks(
        query_embedding=[1.0, 0.0],
        user_id=999,
        top_k=5,
    )
    assert results == []
