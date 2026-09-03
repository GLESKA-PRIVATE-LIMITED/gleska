"""Service for managing worker documents."""

import uuid
from datetime import datetime
from typing import Optional
from supabase import Client
from supabase.lib.client_options import ClientOptions
from storage3.utils import StorageException

from app.schemas.worker import WorkerDocumentResponse, DocumentUploadRequest


WORKER_DOCUMENTS_BUCKET = "worker-documents"
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png"}
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}


class WorkerDocumentService:
    """Service for worker document upload, retrieval, and deletion."""
    
    def __init__(self, supabase_client: Client, database_client):
        """
        Initialize the document service.
        
        Args:
            supabase_client: Supabase client for Storage operations
            database_client: Database client for PostgreSQL operations (via Supabase)
        """
        self.supabase = supabase_client
        self.db = database_client
    
    def get_document_storage_path(self, worker_id: str, document_type: str, filename: str) -> str:
        """
        Generate a secure storage path for a document.
        Format: workers/{worker_id}/documents/{document_type}/{uuid}_{filename}
        
        Args:
            worker_id: UUID of the worker
            document_type: Type of document (EXPERIENCE_CERTIFICATE or POLICE_VERIFICATION)
            filename: Original filename
            
        Returns:
            Storage path string
        """
        # Generate unique identifier to prevent collisions and allow multiple versions during same upload
        unique_id = str(uuid.uuid4())[:8]
        # Sanitize filename to remove any path components
        safe_filename = filename.split("/")[-1].split("\\")[-1]
        
        return f"workers/{worker_id}/documents/{document_type}/{unique_id}_{safe_filename}"
    
    def validate_file_metadata(self, upload_request: DocumentUploadRequest) -> None:
        """
        Validate file metadata before upload.
        
        Args:
            upload_request: Document upload request with metadata
            
        Raises:
            ValueError: If validation fails
        """
        # Validate MIME type
        if upload_request.mime_type not in ALLOWED_MIME_TYPES:
            raise ValueError(f"MIME type {upload_request.mime_type} not allowed")
        
        # Validate file size
        if upload_request.file_size_bytes > MAX_FILE_SIZE_BYTES:
            raise ValueError(f"File size exceeds maximum of {MAX_FILE_SIZE_BYTES} bytes")
        
        if upload_request.file_size_bytes <= 0:
            raise ValueError("File size must be greater than 0")
        
        # Validate filename extension matches MIME type
        import os
        _, ext = os.path.splitext(upload_request.original_filename.lower())
        
        if ext not in ALLOWED_EXTENSIONS:
            raise ValueError(f"File extension {ext} not allowed")
        
        # Cross-check MIME type and extension
        mime_ext_map = {
            "application/pdf": {".pdf"},
            "image/jpeg": {".jpg", ".jpeg"},
            "image/png": {".png"},
        }
        
        if ext not in mime_ext_map.get(upload_request.mime_type, set()):
            raise ValueError(f"File extension {ext} does not match MIME type {upload_request.mime_type}")
    
    async def create_document_metadata(
        self,
        worker_profile_id: str,
        upload_request: DocumentUploadRequest,
        storage_path: str
    ) -> WorkerDocumentResponse:
        """
        Create or update document metadata in the database.
        If a document of the same type exists, it will be replaced (UPSERT).
        
        Args:
            worker_profile_id: UUID of the worker profile
            upload_request: Document upload request with metadata
            storage_path: Path where file is stored in Supabase Storage
            
        Returns:
            WorkerDocumentResponse with the created/updated document metadata
            
        Raises:
            Exception: If database operation fails
        """
        # Prepare the record
        now = datetime.utcnow().isoformat()
        record = {
            "worker_profile_id": worker_profile_id,
            "document_type": upload_request.document_type,
            "storage_path": storage_path,
            "original_filename": upload_request.original_filename,
            "mime_type": upload_request.mime_type,
            "file_size_bytes": upload_request.file_size_bytes,
            "uploaded_at": now,
            "updated_at": now,
        }
        
        # UPSERT: If document of this type exists, update it; otherwise insert
        # Using ON CONFLICT on the unique constraint (worker_profile_id, document_type)
        response = self.db.table("worker_documents").upsert(record).execute()
        
        if not response.data or len(response.data) == 0:
            raise Exception("Failed to create/update document metadata")
        
        document_record = response.data[0]
        
        return WorkerDocumentResponse(
            id=document_record["id"],
            worker_profile_id=document_record["worker_profile_id"],
            document_type=document_record["document_type"],
            original_filename=document_record["original_filename"],
            mime_type=document_record["mime_type"],
            file_size_bytes=document_record["file_size_bytes"],
            uploaded_at=datetime.fromisoformat(document_record["uploaded_at"]),
            updated_at=datetime.fromisoformat(document_record["updated_at"]),
        )
    
    async def delete_old_document_storage(
        self,
        worker_id: str,
        document_type: str
    ) -> None:
        """
        Delete old document from Storage when replacing with new version.
        Queries database for existing document, then deletes from Storage.
        
        Args:
            worker_id: UUID of the worker
            document_type: Type of document
        """
        # Query database for existing document
        response = self.db.table("worker_documents").select("storage_path").eq(
            "worker_profile_id", worker_id
        ).eq(
            "document_type", document_type
        ).limit(1).execute()
        
        if response.data and len(response.data) > 0:
            old_path = response.data[0]["storage_path"]
            try:
                # Delete from Storage
                self.supabase.storage.from_(WORKER_DOCUMENTS_BUCKET).remove([old_path])
            except Exception as e:
                # Log but don't fail - old file cleanup is best-effort
                print(f"Warning: Failed to delete old document {old_path}: {str(e)}")
    
    async def get_document(self, worker_profile_id: str, document_id: str) -> WorkerDocumentResponse:
        """
        Retrieve a single document metadata.
        
        Args:
            worker_profile_id: UUID of the worker profile (for authorization check)
            document_id: UUID of the document
            
        Returns:
            WorkerDocumentResponse
            
        Raises:
            ValueError: If document not found or doesn't belong to this worker
        """
        response = self.db.table("worker_documents").select("*").eq("id", document_id).eq(
            "worker_profile_id", worker_profile_id
        ).single().execute()
        
        if not response.data:
            raise ValueError("Document not found")
        
        doc = response.data
        return WorkerDocumentResponse(
            id=doc["id"],
            worker_profile_id=doc["worker_profile_id"],
            document_type=doc["document_type"],
            original_filename=doc["original_filename"],
            mime_type=doc["mime_type"],
            file_size_bytes=doc["file_size_bytes"],
            uploaded_at=datetime.fromisoformat(doc["uploaded_at"]),
            updated_at=datetime.fromisoformat(doc["updated_at"]),
        )

    async def get_document_view_url(self, worker_profile_id: str, document_id: str) -> str:
        response = self.db.table("worker_documents").select("storage_path,document_type,original_filename").eq(
            "id", document_id
        ).eq("worker_profile_id", worker_profile_id).single().execute()
        if not response.data:
            raise ValueError("Document not found")
        storage_path = response.data["storage_path"]
        try:
            signed = self.get_signed_download_url(storage_path)
        except StorageException as exc:
            if "Object not found" not in str(exc):
                raise
            directory = "/".join(storage_path.split("/")[:-1])
            candidates = self.supabase.storage.from_(WORKER_DOCUMENTS_BUCKET).list(directory)
            matching_name = next(
                (
                    item["name"]
                    for item in candidates
                    if item.get("name", "").endswith(f"_{response.data['original_filename']}")
                ),
                None,
            )
            if not matching_name:
                raise
            signed = self.get_signed_download_url(f"{directory}/{matching_name}")
        return signed["signedURL"] if isinstance(signed, dict) else signed
    
    async def get_worker_documents(self, worker_profile_id: str) -> list[WorkerDocumentResponse]:
        """
        Retrieve all documents for a worker.
        
        Args:
            worker_profile_id: UUID of the worker profile
            
        Returns:
            List of WorkerDocumentResponse
        """
        response = self.db.table("worker_documents").select("*").eq(
            "worker_profile_id", worker_profile_id
        ).order("uploaded_at", desc=True).execute()
        
        documents = []
        if response.data:
            for doc in response.data:
                documents.append(
                    WorkerDocumentResponse(
                        id=doc["id"],
                        worker_profile_id=doc["worker_profile_id"],
                        document_type=doc["document_type"],
                        original_filename=doc["original_filename"],
                        mime_type=doc["mime_type"],
                        file_size_bytes=doc["file_size_bytes"],
                        uploaded_at=datetime.fromisoformat(doc["uploaded_at"]),
                        updated_at=datetime.fromisoformat(doc["updated_at"]),
                    )
                )
        
        return documents
    
    async def delete_document(self, worker_profile_id: str, document_id: str) -> None:
        """
        Delete a document (both metadata and Storage file).
        
        Args:
            worker_profile_id: UUID of the worker profile
            document_id: UUID of the document
            
        Raises:
            ValueError: If document not found or doesn't belong to this worker
        """
        # Get document to retrieve storage path
        response = self.db.table("worker_documents").select("storage_path").eq(
            "id", document_id
        ).eq("worker_profile_id", worker_profile_id).single().execute()
        
        if not response.data:
            raise ValueError("Document not found")
        
        storage_path = response.data["storage_path"]
        
        # Delete from Storage
        try:
            self.supabase.storage.from_(WORKER_DOCUMENTS_BUCKET).remove([storage_path])
        except Exception as e:
            # Continue even if Storage deletion fails - metadata will still be deleted
            print(f"Warning: Failed to delete storage file {storage_path}: {str(e)}")
        
        # Delete metadata from database
        self.db.table("worker_documents").delete().eq("id", document_id).eq(
            "worker_profile_id", worker_profile_id
        ).execute()
    
    def get_signed_download_url(
        self,
        storage_path: str,
        expires_in_seconds: int = 3600
    ) -> str:
        """
        Generate a signed URL for downloading a document.
        
        Args:
            storage_path: Path to file in Storage
            expires_in_seconds: URL expiration time in seconds (default 1 hour)
            
        Returns:
            Signed URL string
        """
        return self.supabase.storage.from_(WORKER_DOCUMENTS_BUCKET).create_signed_url(
            storage_path,
            expires_in_seconds
        )
