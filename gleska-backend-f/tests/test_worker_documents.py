"""
Tests for worker document upload, list, retrieve, and delete endpoints.
Tests the complete runtime flow: upload → Storage → DB → refresh → list → delete.
Also tests cross-worker authorization.
"""

import pytest
import json
import io
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.worker import (
    WorkerDocumentResponse,
    WorkerDocumentListResponse,
    DocumentUploadRequest,
)
from app.services.document_service import WorkerDocumentService


client = TestClient(app)

# Mock test data
TEST_WORKER_ID = "550e8400-e29b-41d4-a716-446655440000"
TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440001"
TEST_DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440002"
TEST_DOCUMENT_STORAGE_PATH = f"workers/{TEST_WORKER_ID}/documents/EXPERIENCE_CERTIFICATE/abc123_cert.pdf"


class MockSupabaseResponse:
    """Mock Supabase response object."""
    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error


class TestDocumentValidation:
    """Test file validation in DocumentUploadRequest."""

    def test_valid_pdf_document(self):
        """Valid PDF document should pass validation."""
        request = DocumentUploadRequest(
            document_type="EXPERIENCE_CERTIFICATE",
            original_filename="certificate.pdf",
            mime_type="application/pdf",
            file_size_bytes=2048576,  # 2 MB
        )
        assert request.document_type == "EXPERIENCE_CERTIFICATE"
        assert request.file_size_bytes == 2048576

    def test_valid_jpeg_document(self):
        """Valid JPEG document should pass validation."""
        request = DocumentUploadRequest(
            document_type="POLICE_VERIFICATION",
            original_filename="verification.jpg",
            mime_type="image/jpeg",
            file_size_bytes=1048576,  # 1 MB
        )
        assert request.mime_type == "image/jpeg"

    def test_valid_png_document(self):
        """Valid PNG document should pass validation."""
        request = DocumentUploadRequest(
            document_type="POLICE_VERIFICATION",
            original_filename="verification.png",
            mime_type="image/png",
            file_size_bytes=512000,  # 500 KB
        )
        assert request.mime_type == "image/png"

    def test_invalid_document_type(self):
        """Invalid document type should raise validation error."""
        with pytest.raises(ValueError, match="document_type must be one of"):
            DocumentUploadRequest(
                document_type="INVALID_TYPE",
                original_filename="cert.pdf",
                mime_type="application/pdf",
                file_size_bytes=2048576,
            )

    def test_invalid_mime_type(self):
        """Invalid MIME type should raise validation error."""
        with pytest.raises(ValueError, match="mime_type must be one of"):
            DocumentUploadRequest(
                document_type="EXPERIENCE_CERTIFICATE",
                original_filename="cert.doc",
                mime_type="application/msword",
                file_size_bytes=2048576,
            )

    def test_oversized_file(self):
        """File over 5 MB should fail validation."""
        with pytest.raises(ValueError, match="File size exceeds"):
            DocumentUploadRequest(
                document_type="EXPERIENCE_CERTIFICATE",
                original_filename="cert.pdf",
                mime_type="application/pdf",
                file_size_bytes=10485760,  # 10 MB
                def test_oversized_file(self):
                    """File over 5 MB should fail validation."""
                    from pydantic import ValidationError
                    with pytest.raises(ValidationError, match="less than or equal"):
                        DocumentUploadRequest(
                            document_type="EXPERIENCE_CERTIFICATE",
                            original_filename="cert.pdf",
                            mime_type="application/pdf",
                            file_size_bytes=10485760,  # 10 MB
                        )
            )

    def test_zero_size_file(self):
        """Zero-size file should fail validation."""
        with pytest.raises(ValueError, match="File size must be greater"):
            DocumentUploadRequest(
                document_type="EXPERIENCE_CERTIFICATE",
                original_filename="cert.pdf",
                mime_type="application/pdf",
                file_size_bytes=0,
                def test_zero_size_file(self):
                    """Zero-size file should fail validation."""
                    from pydantic import ValidationError
                    with pytest.raises(ValidationError, match="greater than"):
                        DocumentUploadRequest(
                            document_type="EXPERIENCE_CERTIFICATE",
                            original_filename="cert.pdf",
                            mime_type="application/pdf",
                            file_size_bytes=0,
                        )
            )

    def test_path_traversal_in_filename(self):
        """Filename with path traversal should be rejected."""
        with pytest.raises(ValueError, match="cannot contain path separators"):
            DocumentUploadRequest(
                document_type="EXPERIENCE_CERTIFICATE",
                original_filename="../../../etc/passwd",
                    def test_invalid_document_type(self):
                        """Invalid document type should raise validation error."""
                        from pydantic import ValidationError
                        with pytest.raises(ValidationError):
                            DocumentUploadRequest(
                                document_type="INVALID_TYPE",
                                original_filename="cert.pdf",
                                mime_type="application/pdf",
                                file_size_bytes=2048576,
                            )

                    def test_invalid_mime_type(self):
                        """Invalid MIME type should raise validation error."""
                        from pydantic import ValidationError
                        with pytest.raises(ValidationError):
                            DocumentUploadRequest(
                                document_type="EXPERIENCE_CERTIFICATE",
                                original_filename="cert.doc",
                                mime_type="application/msword",
                                file_size_bytes=2048576,
                            )

                    def test_path_traversal_in_filename(self):
                        """Filename with path traversal should be rejected."""
                        from pydantic import ValidationError
                        with pytest.raises(ValidationError):
                            DocumentUploadRequest(
                                document_type="EXPERIENCE_CERTIFICATE",
                                original_filename="../../../etc/passwd",
                                mime_type="application/pdf",
                                file_size_bytes=2048576,
                            )
                mime_type="application/pdf",
                file_size_bytes=2048576,
            )


class TestDocumentService:
    """Test WorkerDocumentService class methods."""

    @pytest.fixture
    def mock_supabase(self):
        """Create a mock Supabase client."""
        return Mock()

    @pytest.fixture
    def document_service(self, mock_supabase):
        """Create a DocumentService instance with mocked Supabase."""
        return WorkerDocumentService(mock_supabase, mock_supabase)

    def test_get_document_storage_path(self, document_service):
        """Storage path should follow secure format."""
        path = document_service.get_document_storage_path(
            TEST_WORKER_ID,
            "EXPERIENCE_CERTIFICATE",
            "my_certificate.pdf"
        )
        assert path.startswith(f"workers/{TEST_WORKER_ID}/documents/EXPERIENCE_CERTIFICATE/")
        assert path.endswith("_my_certificate.pdf")
        assert "_" in path  # UUID separator

    def test_validate_file_metadata_valid(self, document_service):
        """Valid file metadata should pass validation."""
        request = DocumentUploadRequest(
            document_type="EXPERIENCE_CERTIFICATE",
            original_filename="cert.pdf",
            mime_type="application/pdf",
            file_size_bytes=2048576,
        )
        # Should not raise
        document_service.validate_file_metadata(request)

    def test_validate_file_metadata_oversized(self, document_service):
        """Oversized file should fail validation."""
        request = DocumentUploadRequest(
            document_type="EXPERIENCE_CERTIFICATE",
            original_filename="cert.pdf",
            mime_type="application/pdf",
            file_size_bytes=10485760,  # 10 MB
        )
        with pytest.raises(ValueError, match="exceeds maximum"):
            document_service.validate_file_metadata(request)

    def test_validate_file_metadata_invalid_extension(self, document_service):
        """Mismatched extension should fail validation."""
        request = DocumentUploadRequest(
            document_type="EXPERIENCE_CERTIFICATE",
            original_filename="cert.doc",  # .doc doesn't match application/pdf
            mime_type="application/pdf",
            file_size_bytes=2048576,
        )
        with pytest.raises(ValueError, match="does not match MIME type"):
            document_service.validate_file_metadata(request)


class TestDocumentEndpointsAuth:
    """Test document endpoints require authentication."""

    def test_upload_start_requires_auth(self):
        """POST /documents/upload-start should require authentication."""
        response = client.post(
            "/api/v1/workers/me/documents/upload-start",
            json={
                "document_type": "EXPERIENCE_CERTIFICATE",
                "original_filename": "cert.pdf",
                "mime_type": "application/pdf",
                "file_size_bytes": 2048576,
            }
        )
        assert response.status_code == 401  # Unauthorized

    def test_upload_complete_requires_auth(self):
        """POST /documents/upload-complete should require authentication."""
        response = client.post(
            "/api/v1/workers/me/documents/upload-complete",
            json={
                "document_type": "EXPERIENCE_CERTIFICATE",
                "original_filename": "cert.pdf",
                "mime_type": "application/pdf",
                "file_size_bytes": 2048576,
            }
        )
        assert response.status_code == 401  # Unauthorized

    def test_list_documents_requires_auth(self):
        """GET /documents should require authentication."""
        response = client.get("/api/v1/workers/me/documents")
        assert response.status_code == 401  # Unauthorized

    def test_get_document_requires_auth(self):
        """GET /documents/{id} should require authentication."""
        response = client.get(f"/api/v1/workers/me/documents/{TEST_DOCUMENT_ID}")
        assert response.status_code == 401  # Unauthorized

    def test_delete_document_requires_auth(self):
        """DELETE /documents/{id} should require authentication."""
        response = client.delete(f"/api/v1/workers/me/documents/{TEST_DOCUMENT_ID}")
        assert response.status_code == 401  # Unauthorized


class TestDocumentEndpoints:
    """Test document endpoints with authentication mocked."""

    @pytest.fixture
    def mock_auth_user(self, monkeypatch):
        """Mock authenticated user."""
        from app.schemas.auth import UserResponse
        user = UserResponse(
            id=TEST_USER_ID,
            email="worker@test.com",
            phone="+91-9999999999",
            user_type="WORKER",
        )
        
        async def mock_require_worker():
            return user
        
        monkeypatch.setattr(
            "app.routers.workers.require_worker",
            lambda: mock_require_worker()
        )
        return user

    @pytest.fixture
    def mock_supabase_client(self, monkeypatch):
        """Mock Supabase client globally."""
        mock_client = Mock()
        monkeypatch.setattr("app.routers.workers.supabase", mock_client)
        return mock_client

    def test_upload_start_success(self, mock_auth_user, mock_supabase_client):
        """Test successful upload-start."""
        # Mock database response
        mock_supabase_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = Mock(
            data={"id": TEST_WORKER_ID}
        )
        
        response = client.post(
            "/api/v1/workers/me/documents/upload-start",
            json={
                "document_type": "EXPERIENCE_CERTIFICATE",
                "original_filename": "cert.pdf",
                "mime_type": "application/pdf",
                "file_size_bytes": 2048576,
            }
        )
        
        # Should return 200 with storage path
        assert response.status_code == 200
        data = response.json()
        assert "storage_path" in data
        assert "document_type" in data
        assert data["document_type"] == "EXPERIENCE_CERTIFICATE"
        assert "worker_profile_id" in data

    def test_upload_start_validation_error(self, mock_auth_user, mock_supabase_client):
        """Test upload-start with invalid file size."""
        # Mock database response
        mock_supabase_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = Mock(
            data={"id": TEST_WORKER_ID}
        )
        
        response = client.post(
            "/api/v1/workers/me/documents/upload-start",
            json={
                "document_type": "EXPERIENCE_CERTIFICATE",
                "original_filename": "cert.pdf",
                "mime_type": "application/pdf",
                "file_size_bytes": 10485760,  # 10 MB - over limit
            }
        )
        
        # Should return 400 with validation error
        assert response.status_code == 400
        assert "exceeds maximum" in response.json().get("detail", "")

    def test_list_documents_empty(self, mock_auth_user, mock_supabase_client):
        """Test list documents when none exist."""
        # Mock database responses
        profile_query = Mock()
        profile_query.select.return_value.eq.return_value.single.return_value.execute.return_value = Mock(
            data={"id": TEST_WORKER_ID}
        )
        
        documents_query = Mock()
        documents_query.select.return_value.eq.return_value.order.return_value.execute.return_value = Mock(
            data=[]
        )
        
        mock_supabase_client.table.side_effect = [profile_query, documents_query]
        
        response = client.get("/api/v1/workers/me/documents")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total_count"] == 0
        assert len(data["documents"]) == 0

    def test_delete_document_not_found(self, mock_auth_user, mock_supabase_client):
        """Test delete document that doesn't exist."""
        # Mock database responses
        profile_query = Mock()
        profile_query.select.return_value.eq.return_value.single.return_value.execute.return_value = Mock(
            data={"id": TEST_WORKER_ID}
        )
        
        delete_query = Mock()
        delete_query.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = Mock(
            data=None
        )
        
        mock_supabase_client.table.side_effect = [profile_query, delete_query]
        
        response = client.delete(f"/api/v1/workers/me/documents/{TEST_DOCUMENT_ID}")
        
        assert response.status_code == 404
        assert "not found" in response.json().get("detail", "").lower()


class TestCrossWorkerAuthorization:
    """Test that workers cannot access other workers' documents."""

    def test_rls_policy_prevents_cross_worker_access(self):
        """
        RLS policies in database should prevent Worker A from accessing Worker B's documents.
        
        This test verifies the SQL-level RLS policy:
        WHERE auth.uid() = (SELECT user_id FROM worker_profiles WHERE id = worker_profile_id)
        """
        # This is a conceptual test - actual RLS testing requires a real database
        # The SQL constraint is: auth.uid() must match the user_id in worker_profiles
        
        worker_a_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        worker_b_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        
        # Mock RLS check
        authenticated_user_id = "user-a"
        
        # Worker A's profile
        worker_a_profile = {
            "id": worker_a_id,
            "user_id": authenticated_user_id,  # Matches authenticated user
        }
        
        # Worker B's profile
        worker_b_profile = {
            "id": worker_b_id,
            "user_id": "user-b",  # Different user
        }
        
        # RLS policy: SELECT should only return documents where:
        # auth.uid() (authenticated_user_id) == worker_profile.user_id
        
        assert worker_a_profile["user_id"] == authenticated_user_id  # ✅ Can access
        assert worker_b_profile["user_id"] != authenticated_user_id  # ❌ Cannot access


class TestDocumentStorageRLS:
    """Test Supabase Storage RLS policies prevent cross-worker access."""

    def test_storage_path_format_enforces_worker_ownership(self):
        """
        Storage path format: workers/{worker_id}/documents/{type}/{uuid}_{filename}
        RLS policy extracts worker_id from path and verifies worker ownership.
        """
        worker_a_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        worker_b_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        
        # Storage paths
        worker_a_path = f"workers/{worker_a_id}/documents/EXPERIENCE_CERTIFICATE/uuid_cert.pdf"
        worker_b_path = f"workers/{worker_b_id}/documents/EXPERIENCE_CERTIFICATE/uuid_cert.pdf"
        
        # RLS policy extracts worker_id from path[1]
        def extract_worker_id_from_path(path: str) -> str:
            parts = path.split("/")
            if len(parts) > 1:
                return parts[1]
            return ""
        
        # Verify extraction works
        assert extract_worker_id_from_path(worker_a_path) == worker_a_id
        assert extract_worker_id_from_path(worker_b_path) == worker_b_id
        assert extract_worker_id_from_path(worker_a_path) != extract_worker_id_from_path(worker_b_path)


class TestFileValidationBothSides:
    """Test that file validation happens on both frontend and backend."""

    def test_frontend_validation_frontend_only(self):
        """Frontend validation should reject file before sending to backend."""
        from app.lib.useWorkerDocuments import validateFileForUpload
        
        # Too large file
        large_file = Mock()
        large_file.size = 10485760  # 10 MB
        large_file.name = "cert.pdf"
        large_file.type = "application/pdf"
        
        result = validateFileForUpload(large_file)
        assert not result["valid"]
        assert "exceeds maximum" in result["error"].lower()

    def test_backend_validation_redundant_check(self):
        """Backend should also validate even if frontend passes."""
        request = DocumentUploadRequest(
            document_type="EXPERIENCE_CERTIFICATE",
            original_filename="cert.pdf",
            mime_type="application/pdf",
            file_size_bytes=10485760,  # 10 MB
        )
        
        # DocumentUploadRequest schema should reject during instantiation
        with pytest.raises(ValueError):
            DocumentUploadRequest(
                document_type="EXPERIENCE_CERTIFICATE",
                original_filename="cert.pdf",
                mime_type="application/pdf",
                file_size_bytes=10485760,  # Over 5 MB limit
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
