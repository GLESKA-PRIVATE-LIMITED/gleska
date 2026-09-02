"use client";

import React, { useRef, useState, useEffect } from "react";
import { UploadCloud, X, Check, AlertCircle, Loader2, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  useWorkerDocuments,
  validateFileForUpload,
  WorkerDocument,
  DocumentType,
} from "@/lib/useWorkerDocuments";

interface DocumentCardProps {
  documentType: DocumentType;
  title: string;
  description: string;
  currentDocument: WorkerDocument | null;
  isUploading: boolean;
  uploadProgress: number;
  onUpload: (file: File) => Promise<void>;
  onDelete: (documentId: string) => Promise<void>;
  onView: (documentId: string) => Promise<void>;
}

/**
 * DocumentCard - UI for uploading, displaying, and managing a single document type
 */
export const DocumentCard: React.FC<DocumentCardProps> = ({
  documentType,
  title,
  description,
  currentDocument,
  isUploading,
  uploadProgress,
  onUpload,
  onDelete,
  onView,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file
    const validation = validateFileForUpload(file);
    if (!validation.valid) {
      toast.error(validation.error || "Invalid file");
      return;
    }

    // Clear input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    await onUpload(file);
  };

  const handleDeleteClick = async () => {
    if (!currentDocument) return;

    if (!confirm("Are you sure you want to delete this document?")) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDelete(currentDocument.id);
      toast.success("Document deleted successfully");
    } catch (error) {
      console.error("Delete failed:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3.5 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400 shrink-0">
          {currentDocument ? (
            <Check size={16} />
          ) : (
            <UploadCloud size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
            {title}
          </p>
          {currentDocument ? (
            <p className="text-[10px] text-slate-400 truncate">
              {currentDocument.original_filename}
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 truncate">{description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isUploading && (
          <div className="flex items-center gap-1">
            <Loader2 size={14} className="animate-spin text-blue-600" />
            <span className="text-[10px] text-slate-600 dark:text-slate-400">
              {uploadProgress}%
            </span>
          </div>
        )}

        {!isUploading && currentDocument && !isDeleting && (
          <button
            type="button"
            onClick={() => void onView(currentDocument.id)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition shrink-0 cursor-pointer dark:bg-blue-900/20 dark:text-blue-400"
            title="View document"
          >
            <Eye size={16} />
          </button>
        )}

        {!isUploading && currentDocument && !isDeleting && (
          <button
            type="button"
            onClick={handleDeleteClick}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition shrink-0 cursor-pointer dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
            title="Delete document"
          >
            <X size={16} />
          </button>
        )}

        {isDeleting && (
          <Loader2 size={16} className="animate-spin text-slate-400 shrink-0" />
        )}

        {!isUploading && !isDeleting && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isUploading || isDeleting}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={currentDocument ? "Replace document" : "Upload document"}
              disabled={isUploading || isDeleting}
            >
              <UploadCloud size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

interface DocumentsSectionProps {
  onDocumentsLoaded?: (count: number) => void;
}

/**
 * DocumentsSection - Full documents section with both document cards
 */
export const DocumentsSection: React.FC<DocumentsSectionProps> = ({ onDocumentsLoaded }) => {
  const {
    documents,
    isLoading,
    error,
    uploadProgress,
    fetchDocuments,
    uploadDocument,
    deleteDocument,
    getDocumentByType,
    getDocumentViewUrl,
  } = useWorkerDocuments();

  const [isInitialized, setIsInitialized] = useState(false);

  // Load documents on mount
  useEffect(() => {
    if (!isInitialized) {
      fetchDocuments().then(() => {
        setIsInitialized(true);
      });
    }
  }, [isInitialized, fetchDocuments]);

  // Notify parent of document count
  useEffect(() => {
    onDocumentsLoaded?.(documents.length);
  }, [documents.length, onDocumentsLoaded]);

  const handleUpload = async (file: File, documentType: DocumentType) => {
    const result = await uploadDocument(file, documentType);
    if (result) {
      toast.success(`${documentType.replace(/_/g, " ")} uploaded successfully`);
    } else {
      toast.error(uploadProgress.error || "Upload failed");
    }
  };

  const handleDelete = async (documentId: string) => {
    const success = await deleteDocument(documentId);
    if (!success) {
      throw new Error(error || "Delete failed");
    }
  };

  const handleView = async (documentId: string) => {
    const url = await getDocumentViewUrl(documentId);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.error(error || "Unable to open document");
  };

  if (isLoading && !isInitialized) {
    return (
      <section className="rounded-2xl bg-white p-6 dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-slate-400" />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-6 dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-800">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
          <UploadCloud size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Documents
          </h2>
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
        Upload your documents for verification (PDF, JPG or PNG, max 5MB each)
      </p>

      {error && !uploadProgress.error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
          <AlertCircle size={14} className="text-red-600 dark:text-red-400 shrink-0" />
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        {/* Experience Certificate */}
        <DocumentCard
          documentType="EXPERIENCE_CERTIFICATE"
          title="Experience Certificate"
          description="Upload PDF, JPG or PNG"
          currentDocument={getDocumentByType("EXPERIENCE_CERTIFICATE")}
          isUploading={uploadProgress.isUploading && documents.some((d) => d.document_type === "EXPERIENCE_CERTIFICATE")}
          uploadProgress={uploadProgress.progress}
          onUpload={(file) => handleUpload(file, "EXPERIENCE_CERTIFICATE")}
          onDelete={handleDelete}
          onView={handleView}
        />

        {/* Police Verification */}
        <DocumentCard
          documentType="POLICE_VERIFICATION"
          title="Police Verification"
          description="Upload PDF, JPG or PNG"
          currentDocument={getDocumentByType("POLICE_VERIFICATION")}
          isUploading={uploadProgress.isUploading && documents.some((d) => d.document_type === "POLICE_VERIFICATION")}
          uploadProgress={uploadProgress.progress}
          onUpload={(file) => handleUpload(file, "POLICE_VERIFICATION")}
          onDelete={handleDelete}
          onView={handleView}
        />
      </div>
    </section>
  );
};
