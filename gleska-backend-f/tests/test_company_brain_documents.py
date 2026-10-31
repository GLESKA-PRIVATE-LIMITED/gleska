"""Document intelligence: extraction, chunking, indexing versions, sync/deletion, embeddings via gateway."""

import io
import zipfile

import pytest

from app.ai_gateway import AIBillingError
from app.company_brain import documents
from app.company_brain.documents import chunk_text, extract_text
from app.company_brain.tools import OrgContext
from tests.company_brain_fixtures import ORG_A, ORG_B, USER_A, FakeDB


class FakeStorage:
    def __init__(self):
        self.files, self.removed = {}, []

    def from_(self, bucket):
        store = self

        class B:
            def upload(self, path, content, opts=None):
                store.files[(bucket, path)] = content

            def download(self, path):
                return store.files.get((bucket, path))

            def remove(self, paths):
                store.removed += paths

        return B()


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    for t in ("company_brain_documents", "company_brain_chunks", "general_work_files", "financial_invoice_scans"):
        fake.tables.setdefault(t, [])
    fake.storage = FakeStorage()
    monkeypatch.setattr(documents, "supabase", fake)
    return fake


@pytest.fixture
def embeddings(monkeypatch):
    calls = []

    async def embed(texts, *, operation, task_type, timeout):
        calls.append((operation, task_type, len(texts)))
        return [[0.1] * 768 for _ in texts]

    monkeypatch.setattr("app.ai_gateway.embed_texts", embed)
    return calls


CTX = OrgContext(employer_id=ORG_A, user_id=USER_A)


def docx(text):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f"<w:document><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>")
        z.writestr("[Content_Types].xml", "<Types/>")
    return buf.getvalue()


def minimal_pdf(text):
    """A one-page PDF with a real text layer (no external tools)."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for i, body in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


@pytest.mark.asyncio
async def test_pdf_text_layer_is_extracted_with_page_numbers():
    pages = await extract_text(minimal_pdf("Payment within 45 days"), "agreement.pdf", "application/pdf")
    assert pages[0][0] == 1 and "Payment within 45 days" in pages[0][1]


@pytest.mark.asyncio
async def test_docx_and_unreadable_files():
    assert "Leave policy" in (await extract_text(docx("Leave policy: 12 days"), "p.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))[0][1]
    with pytest.raises(documents.DocumentError):
        await extract_text(b"   ", "empty.txt", "text/plain")


def test_chunking_overlaps_and_keeps_pages():
    text = ("Clause. " * 400).strip()
    chunks = chunk_text([(3, text)])
    assert len(chunks) > 1 and all(c.page == 3 for c in chunks)
    assert all(len(c.content) <= documents.CHUNK_CHARS for c in chunks)
    assert chunks[0].content[-50:].split()[-1] in chunks[1].content  # overlap


@pytest.mark.asyncio
async def test_upload_validates_type_and_stores_under_owner_path(db, embeddings):
    with pytest.raises(documents.DocumentError):
        await documents.upload(CTX, "virus.exe", b"MZ....")
    with pytest.raises(documents.DocumentError):
        await documents.upload(CTX, "fake.pdf", b"not a pdf at all")
    doc = await documents.upload(CTX, "Agreement.pdf", minimal_pdf("Payment within 45 days"))
    assert doc["storage_path"].startswith(f"{USER_A}/company-brain/{doc['id']}/") and doc["status"] == "pending"


@pytest.mark.asyncio
async def test_indexing_embeds_through_gateway_and_versions_on_reindex(db, embeddings):
    doc = await documents.upload(CTX, "Agreement.pdf", minimal_pdf("Payment within 45 days"))
    first = await documents.index_document(doc)
    assert (first["status"], first["embedding_status"], first["version"]) == ("indexed", "embedded", 1)
    assert embeddings == [("brain_document_embedding", "RETRIEVAL_DOCUMENT", 1)]
    second = await documents.index_document(first)
    versions = {c["document_version"] for c in db.tables["company_brain_chunks"]}
    assert second["version"] == 2 and versions == {2}  # old version purged


@pytest.mark.asyncio
async def test_missing_embedding_price_still_indexes_for_keyword_search(db, monkeypatch):
    async def refuse(*_a, **_k):
        raise AIBillingError("AI_PRICING_NOT_CONFIGURED")

    monkeypatch.setattr("app.ai_gateway.embed_texts", refuse)
    doc = await documents.upload(CTX, "notes.txt", b"Supplier must deliver within 7 days.")
    result = await documents.index_document(doc)
    assert (result["status"], result["embedding_status"]) == ("indexed", "not_configured")
    assert db.tables["company_brain_chunks"][0]["embedding"] is None


@pytest.mark.asyncio
async def test_sync_adds_sources_and_purges_deleted_ones(db, embeddings):
    db.tables["general_work_files"].append({"id": "11111111-0000-0000-0000-00000000000f", "user_id": USER_A,
                                            "filename": "plan.txt", "mime_type": "text/plain", "kind": "document",
                                            "storage_bucket": "assistant-uploads", "storage_path": f"{USER_A}/general-work/x/plan.txt",
                                            "created_at": "2026-10-01T00:00:00+00:00"})
    db.storage.files[("assistant-uploads", f"{USER_A}/general-work/x/plan.txt")] = b"Quarterly plan text"
    db.tables["financial_invoice_scans"] += [
        {"id": "22222222-0000-0000-0000-00000000000a", "employer_id": ORG_A, "original_filename": "bill.jpg",
         "status": "CONFIRMED", "extracted_text": "Cement Co invoice total 12000", "updated_at": "2026-10-04T00:00:00+00:00"},
        {"id": "22222222-0000-0000-0000-00000000000b", "employer_id": ORG_B, "original_filename": "other.jpg",
         "status": "CONFIRMED", "extracted_text": "Other org secret", "updated_at": "2026-10-04T00:00:00+00:00"},
    ]
    stats = await documents.sync(CTX)
    docs = db.tables["company_brain_documents"]
    assert stats["added"] == 2 and stats["indexed"] == 2
    assert {d["employer_id"] for d in docs} == {ORG_A}
    assert not any("Other org secret" in c["content"] for c in db.tables["company_brain_chunks"])

    db.tables["general_work_files"].clear()  # deleted in General Work
    stats = await documents.sync(CTX)
    gw = next(d for d in docs if d["source_type"] == "general_work_file")
    assert stats["removed"] == 1 and gw["status"] == "deleted"
    assert not any(c["document_id"] == gw["id"] for c in db.tables["company_brain_chunks"])


@pytest.mark.asyncio
async def test_failed_documents_stop_retrying_after_max_attempts(db, embeddings):
    db.tables["company_brain_documents"].append({"id": "d-bad", "employer_id": ORG_A, "source_type": "upload",
                                                 "source_id": "d-bad", "filename": "gone.pdf", "storage_bucket": "assistant-uploads",
                                                 "storage_path": "x", "status": "failed", "attempts": 3, "created_at": "1"})
    stats = await documents.sync(CTX)
    assert stats["queued"] == 0


def test_delete_upload_removes_file_and_index_but_not_other_sources(db):
    db.tables["company_brain_documents"] += [
        {"id": "u1", "employer_id": ORG_A, "source_type": "upload", "storage_bucket": "assistant-uploads", "storage_path": "p/u1"},
        {"id": "g1", "employer_id": ORG_A, "source_type": "general_work_file", "storage_bucket": "assistant-uploads", "storage_path": "p/g1"},
        {"id": "o1", "employer_id": ORG_B, "source_type": "upload", "storage_bucket": "assistant-uploads", "storage_path": "p/o1"},
    ]
    documents.delete_upload(CTX, "u1")
    assert db.storage.removed == ["p/u1"]
    with pytest.raises(documents.DocumentError):
        documents.delete_upload(CTX, "g1")
    with pytest.raises(documents.DocumentError):
        documents.delete_upload(CTX, "o1")  # other organisation -> not found
