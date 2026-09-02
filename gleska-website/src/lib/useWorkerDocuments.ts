/**
 * Hook for managing worker document uploads, list, retrieve, and delete operations.
 * Handles the complete flow: upload-start → file upload to Storage → upload-complete → DB metadata
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import apiClient from '@/lib/api';

export type DocumentType = 'EXPERIENCE_CERTIFICATE' | 'POLICE_VERIFICATION';

export interface WorkerDocument {
  id: string;
  worker_profile_id: string;
  document_type: DocumentType;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
  updated_at: string;
}

export interface DocumentListResponse {
  documents: WorkerDocument[];
  total_count: number;
}

export interface DocumentUploadProgress {
  isUploading: boolean;
  progress: number; // 0-100
  error: string | null;
}

interface UploadStartResponse {
  storage_path: string;
  document_type: string;
  worker_profile_id: string;
}

// Maximum file size: 5 MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Allowed MIME types
const ALLOWED_MIME_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
};

/**
 * Validate file before upload
 * Checks: size, MIME type, extension
 */
export function validateFileForUpload(file: File): { valid: boolean; error?: string } {
  // Check size
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }

  if (file.size === 0) {
    return { valid: false, error: 'File is empty' };
  }

  // Check MIME type
  const allowedMimes = Object.keys(ALLOWED_MIME_TYPES);
  if (!allowedMimes.includes(file.type)) {
    return { valid: false, error: `File type ${file.type} is not allowed. Allowed: PDF, JPG, PNG` };
  }

  // Check extension
  const filename = file.name.toLowerCase();
  const ext = filename.substring(filename.lastIndexOf('.'));
  const validExts = ALLOWED_MIME_TYPES[file.type as keyof typeof ALLOWED_MIME_TYPES];

  if (!validExts || !validExts.includes(ext)) {
    return { valid: false, error: `File extension ${ext} does not match file type` };
  }

  return { valid: true };
}

/**
 * Custom hook for worker document management
 */
export function useWorkerDocuments() {
  const [documents, setDocuments] = useState<WorkerDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<DocumentUploadProgress>({
    isUploading: false,
    progress: 0,
    error: null,
  });

  /**
   * Fetch all documents for the authenticated worker
   */
  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<DocumentListResponse>('/api/v1/workers/me/documents');
      setDocuments(response.data.documents);
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to fetch documents';
      setError(errorMsg);
      console.error('Failed to fetch documents:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Upload a document file
   * Three-step process:
   * 1. Call upload-start endpoint to get storage path and validate metadata
   * 2. Upload file to Supabase Storage (direct upload)
   * 3. Call upload-complete endpoint to create/update metadata in database
   */
  const uploadDocument = useCallback(
    async (file: File, documentType: DocumentType): Promise<WorkerDocument | null> => {
      // Validate file
      const validation = validateFileForUpload(file);
      if (!validation.valid) {
        setUploadProgress({
          isUploading: false,
          progress: 0,
          error: validation.error || 'Validation failed',
        });
        return null;
      }

      setUploadProgress({
        isUploading: true,
        progress: 10,
        error: null,
      });

      try {
        // Step 1: Start upload - get storage path and validate metadata
        setUploadProgress({ isUploading: true, progress: 20, error: null });

        const startResponse = await apiClient.post<UploadStartResponse>(
          '/api/v1/workers/me/documents/upload-start',
          {
            document_type: documentType,
            original_filename: file.name,
            mime_type: file.type,
            file_size_bytes: file.size,
          }
        );

        const { storage_path } = startResponse.data;

        // Step 2: Upload file to Supabase Storage
        // Using the public supabase client with auth token
        setUploadProgress({ isUploading: true, progress: 40, error: null });

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          throw new Error('No authenticated session found');
        }

        // Upload to Storage using the anon key (RLS handles authorization)
        const { error: uploadError, data } = await supabase.storage
          .from('worker-documents')
          .upload(storage_path, file, {
            cacheControl: '3600',
            upsert: true, // Allow replacement
          });

        if (uploadError) {
          throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        setUploadProgress({ isUploading: true, progress: 70, error: null });

        // Step 3: Complete upload - create metadata in database
        const completeResponse = await apiClient.post<WorkerDocument>(
          '/api/v1/workers/me/documents/upload-complete',
          {
            document_type: documentType,
            original_filename: file.name,
            mime_type: file.type,
            file_size_bytes: file.size,
          }
        );

        setUploadProgress({ isUploading: false, progress: 100, error: null });

        // Update local state
        const uploadedDocument = completeResponse.data;
        setDocuments((prev) => {
          // Replace existing document of same type, or add new
          const filtered = prev.filter((doc) => doc.document_type !== documentType);
          return [...filtered, uploadedDocument];
        });

        return uploadedDocument;
      } catch (err: any) {
        const errorMsg = err.response?.data?.detail || err.message || 'Upload failed';
        setUploadProgress({
          isUploading: false,
          progress: 0,
          error: errorMsg,
        });
        console.error('Document upload failed:', err);
        return null;
      }
    },
    []
  );

  /**
   * Delete a document
   */
  const deleteDocument = useCallback(async (documentId: string): Promise<boolean> => {
    setError(null);

    try {
      await apiClient.delete(`/api/v1/workers/me/documents/${documentId}`);

      // Update local state
      setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));

      return true;
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to delete document';
      setError(errorMsg);
      console.error('Failed to delete document:', err);
      return false;
    }
  }, []);

  /**
   * Get a specific document
   */
  const getDocument = useCallback(async (documentId: string): Promise<WorkerDocument | null> => {
    setError(null);

    try {
      const response = await apiClient.get<WorkerDocument>(
        `/api/v1/workers/me/documents/${documentId}`
      );
      return response.data;
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to get document';
      setError(errorMsg);
      console.error('Failed to get document:', err);
      return null;
    }
  }, []);

  const getDocumentViewUrl = useCallback(async (documentId: string): Promise<string | null> => {
    try {
      const response = await apiClient.get<{ url: string }>(
        `/api/v1/workers/me/documents/${documentId}/view`
      );
      return response.data.url;
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to open document';
      setError(errorMsg);
      console.error('Failed to open document:', err);
      return null;
    }
  }, []);

  /**
   * Get a document by type (e.g., get the current Experience Certificate)
   */
  const getDocumentByType = useCallback(
    (documentType: DocumentType): WorkerDocument | null => {
      return documents.find((doc) => doc.document_type === documentType) || null;
    },
    [documents]
  );

  return {
    documents,
    isLoading,
    error,
    uploadProgress,
    fetchDocuments,
    uploadDocument,
    deleteDocument,
    getDocument,
    getDocumentViewUrl,
    getDocumentByType,
  };
}
