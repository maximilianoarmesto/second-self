"""
Integration tests for the /api/v1/documents/* endpoints.

PDF extraction and OpenAI embedding calls are mocked so no real files or
network connections are required.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Minimal valid-looking PDF bytes (real pypdf would reject this, but we mock
# the extraction call so it never reaches pypdf).
_FAKE_PDF = b"%PDF-1.4 fake pdf content for testing purposes"

# Single page, single chunk worth of extracted text.
_FAKE_PAGES = [(1, "This is the extracted text from the first page of the document.")]
_FAKE_EMBEDDING = [0.1] * 3  # short dummy vector


def _mock_ingest():
    """
    Context-manager patcher that short-circuits PDF extraction and embedding.

    Patches both helpers used inside DocumentService._process_pdf so the
    ingestion pipeline runs end-to-end through the real service/DB code
    without needing a real PDF or OpenAI key.
    """
    extract_patch = patch(
        "app.services.document_service._extract_text_from_pdf",
        return_value=(_FAKE_PAGES, 1),
    )
    embed_patch = patch(
        "app.services.document_service._embed_texts",
        new_callable=AsyncMock,
        return_value=[_FAKE_EMBEDDING],
    )
    return extract_patch, embed_patch


def _pdf_upload_payload(filename: str = "test.pdf"):
    return {
        "file": (filename, BytesIO(_FAKE_PDF), "application/pdf"),
    }


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_requires_auth(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/documents/upload",
        files={"file": ("test.pdf", BytesIO(_FAKE_PDF), "application/pdf")},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_documents_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/api/v1/documents/")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /documents/upload
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_pdf_success(client: AsyncClient, auth_headers: dict) -> None:
    ep, embed_p = _mock_ingest()
    with ep, embed_p:
        response = await client.post(
            "/api/v1/documents/upload",
            files={"file": ("report.pdf", BytesIO(_FAKE_PDF), "application/pdf")},
            headers=auth_headers,
        )

    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "completed"
    assert data["original_filename"] == "report.pdf"
    assert data["file_size"] == len(_FAKE_PDF)
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_upload_pdf_rejects_non_pdf_mimetype(
    client: AsyncClient, auth_headers: dict
) -> None:
    response = await client.post(
        "/api/v1/documents/upload",
        files={"file": ("doc.txt", BytesIO(b"plain text"), "text/plain")},
        headers=auth_headers,
    )
    assert response.status_code == 415


@pytest.mark.asyncio
async def test_upload_pdf_rejects_empty_file(
    client: AsyncClient, auth_headers: dict
) -> None:
    response = await client.post(
        "/api/v1/documents/upload",
        files={"file": ("empty.pdf", BytesIO(b""), "application/pdf")},
        headers=auth_headers,
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_upload_pdf_stores_document_in_db(
    client: AsyncClient, auth_headers: dict
) -> None:
    ep, embed_p = _mock_ingest()
    with ep, embed_p:
        upload_resp = await client.post(
            "/api/v1/documents/upload",
            files={"file": ("stored.pdf", BytesIO(_FAKE_PDF), "application/pdf")},
            headers=auth_headers,
        )

    doc_id = upload_resp.json()["id"]

    detail_resp = await client.get(
        f"/api/v1/documents/{doc_id}", headers=auth_headers
    )
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["id"] == doc_id
    assert detail["original_filename"] == "stored.pdf"
    assert detail["page_count"] == 1
    assert len(detail["chunks"]) == 1
    assert detail["chunks"][0]["content"] == _FAKE_PAGES[0][1]


@pytest.mark.asyncio
async def test_upload_pdf_accepts_octet_stream_with_pdf_extension(
    client: AsyncClient, auth_headers: dict
) -> None:
    ep, embed_p = _mock_ingest()
    with ep, embed_p:
        response = await client.post(
            "/api/v1/documents/upload",
            files={
                "file": (
                    "report.pdf",
                    BytesIO(_FAKE_PDF),
                    "application/octet-stream",
                )
            },
            headers=auth_headers,
        )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_upload_marks_failed_when_extraction_raises(
    client: AsyncClient, auth_headers: dict
) -> None:
    with patch(
        "app.services.document_service._extract_text_from_pdf",
        side_effect=RuntimeError("Bad PDF"),
    ):
        response = await client.post(
            "/api/v1/documents/upload",
            files={"file": ("bad.pdf", BytesIO(_FAKE_PDF), "application/pdf")},
            headers=auth_headers,
        )

    assert response.status_code == 201
    assert response.json()["status"] == "failed"


# ---------------------------------------------------------------------------
# GET /documents/
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_documents_empty(client: AsyncClient, auth_headers: dict) -> None:
    response = await client.get("/api/v1/documents/", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_documents_returns_own_only(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    ep, embed_p = _mock_ingest()
    with ep, embed_p:
        await client.post(
            "/api/v1/documents/upload",
            files={"file": ("a.pdf", BytesIO(_FAKE_PDF), "application/pdf")},
            headers=auth_headers,
        )
        await client.post(
            "/api/v1/documents/upload",
            files={"file": ("b.pdf", BytesIO(_FAKE_PDF), "application/pdf")},
            headers=second_auth_headers,
        )

    response = await client.get("/api/v1/documents/", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["original_filename"] == "a.pdf"


@pytest.mark.asyncio
async def test_list_documents_pagination(
    client: AsyncClient, auth_headers: dict
) -> None:
    ep, embed_p = _mock_ingest()
    with ep, embed_p:
        for i in range(5):
            await client.post(
                "/api/v1/documents/upload",
                files={
                    "file": (f"doc{i}.pdf", BytesIO(_FAKE_PDF), "application/pdf")
                },
                headers=auth_headers,
            )

    r1 = await client.get(
        "/api/v1/documents/?skip=0&limit=3", headers=auth_headers
    )
    r2 = await client.get(
        "/api/v1/documents/?skip=3&limit=3", headers=auth_headers
    )
    assert len(r1.json()) == 3
    assert len(r2.json()) == 2


# ---------------------------------------------------------------------------
# GET /documents/{document_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_document_not_found(
    client: AsyncClient, auth_headers: dict
) -> None:
    response = await client.get("/api/v1/documents/99999", headers=auth_headers)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_document_by_non_owner_returns_403(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    ep, embed_p = _mock_ingest()
    with ep, embed_p:
        upload_resp = await client.post(
            "/api/v1/documents/upload",
            files={"file": ("private.pdf", BytesIO(_FAKE_PDF), "application/pdf")},
            headers=auth_headers,
        )
    doc_id = upload_resp.json()["id"]

    response = await client.get(
        f"/api/v1/documents/{doc_id}", headers=second_auth_headers
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /documents/{document_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_document(client: AsyncClient, auth_headers: dict) -> None:
    ep, embed_p = _mock_ingest()
    with ep, embed_p:
        upload_resp = await client.post(
            "/api/v1/documents/upload",
            files={"file": ("delete_me.pdf", BytesIO(_FAKE_PDF), "application/pdf")},
            headers=auth_headers,
        )
    doc_id = upload_resp.json()["id"]

    del_response = await client.delete(
        f"/api/v1/documents/{doc_id}", headers=auth_headers
    )
    assert del_response.status_code == 204

    get_response = await client.get(
        f"/api/v1/documents/{doc_id}", headers=auth_headers
    )
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_delete_document_not_found(
    client: AsyncClient, auth_headers: dict
) -> None:
    response = await client.delete(
        "/api/v1/documents/99999", headers=auth_headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_document_by_non_owner_returns_403(
    client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
) -> None:
    ep, embed_p = _mock_ingest()
    with ep, embed_p:
        upload_resp = await client.post(
            "/api/v1/documents/upload",
            files={"file": ("protected.pdf", BytesIO(_FAKE_PDF), "application/pdf")},
            headers=auth_headers,
        )
    doc_id = upload_resp.json()["id"]

    response = await client.delete(
        f"/api/v1/documents/{doc_id}", headers=second_auth_headers
    )
    assert response.status_code == 403

    # Owner can still see the document
    get_response = await client.get(
        f"/api/v1/documents/{doc_id}", headers=auth_headers
    )
    assert get_response.status_code == 200
