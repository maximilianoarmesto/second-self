"""
Document ingestion endpoints.

All routes require a valid Bearer token.  Users may only access documents
they own.

Routes
------
POST   /documents/upload            — upload a PDF and trigger ingestion
GET    /documents/                  — list the caller's documents
GET    /documents/{document_id}     — get document detail (with chunks)
DELETE /documents/{document_id}     — delete a document and its chunks
"""

from __future__ import annotations

from typing import List

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user_id
from app.db.database import get_db
from app.schemas.document import DocumentDetail, DocumentSummary, DocumentUploadResponse
from app.services.document_service import (
    DocumentNotFoundError,
    DocumentPermissionError,
    DocumentService,
)

router = APIRouter()

# Maximum accepted file size: 50 MB
_MAX_FILE_SIZE = 50 * 1024 * 1024  # bytes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _not_found(document_id: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Document {document_id} not found",
    )


def _forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this document",
    )


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


@router.post(
    "/upload",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and ingest a PDF file",
)
async def upload_document(
    file: UploadFile = File(..., description="PDF file to upload and ingest"),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> DocumentUploadResponse:
    """
    Accept a PDF file, extract its text, generate embeddings for each text
    chunk, and store everything in the database.

    * Only ``application/pdf`` files are accepted.
    * Maximum file size is 50 MB.
    * The response is returned **synchronously** once ingestion completes.
    """
    # ── Validate content type ─────────────────────────────────────────
    content_type = file.content_type or ""
    if content_type not in ("application/pdf", "application/octet-stream"):
        # Accept application/octet-stream as a fallback for clients that do
        # not set the MIME type explicitly, but validate the header first.
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Only PDF files are supported. Please upload a .pdf file.",
            )

    file_bytes = await file.read()

    # ── Validate file size ────────────────────────────────────────────
    if len(file_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )
    if len(file_bytes) > _MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum allowed size is {_MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    # ── Ingest ────────────────────────────────────────────────────────
    try:
        doc_service = DocumentService(db)
        return await doc_service.ingest_pdf(
            file_bytes=file_bytes,
            original_filename=file.filename or "upload.pdf",
            user_id=current_user_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Document ingestion failed: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


@router.get(
    "/",
    response_model=List[DocumentSummary],
    summary="List documents owned by the current user",
)
async def list_documents(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> List[DocumentSummary]:
    """Return a paginated list of documents (newest first) owned by the caller."""
    doc_service = DocumentService(db)
    return await doc_service.list_documents(
        user_id=current_user_id,
        skip=skip,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------


@router.get(
    "/{document_id}",
    response_model=DocumentDetail,
    summary="Get a document with all its text chunks",
)
async def get_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> DocumentDetail:
    """Return full document metadata and all extracted text chunks."""
    doc_service = DocumentService(db)
    try:
        return await doc_service.get_document(document_id, current_user_id)
    except DocumentNotFoundError:
        raise _not_found(document_id)
    except DocumentPermissionError:
        raise _forbidden()


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a document and all its chunks",
)
async def delete_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> None:
    """Delete a document and cascade-delete all its text chunks."""
    doc_service = DocumentService(db)
    try:
        await doc_service.delete_document(document_id, current_user_id)
    except DocumentNotFoundError:
        raise _not_found(document_id)
    except DocumentPermissionError:
        raise _forbidden()
