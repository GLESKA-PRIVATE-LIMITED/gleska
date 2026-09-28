import { useCallback, useEffect, useRef, useState } from "react";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { AlertCircle, Check, Eye, Loader2, UploadCloud, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { apiGet, apiPost, apiRequest } from "../../lib/api";
import { getSupabaseClient } from "../../lib/supabase";
import WorkerMobileShell from "./WorkerMobileShell";

type DocumentType = "EXPERIENCE_CERTIFICATE" | "POLICE_VERIFICATION";

type WorkerDocument = {
  id: string;
  worker_profile_id: string;
  document_type: DocumentType;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
  updated_at: string;
};

type DocumentListResponse = {
  documents: WorkerDocument[];
  total_count: number;
};

type UploadStartResponse = {
  storage_path: string;
  document_type: DocumentType;
  worker_profile_id: string;
};

type DocumentFeedback = {
  message: string;
  kind: "success" | "error";
};

type DocumentProgress = {
  progress: number;
};

const DOCUMENTS: { type: DocumentType; title: string }[] = [
  { type: "EXPERIENCE_CERTIFICATE", title: "Experience Certificate" },
  { type: "POLICE_VERIFICATION", title: "Police Verification" },
];

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

function validateFile(file: File): string | null {
  if (!file.name.trim() || file.name.includes("/") || file.name.includes("\\") || file.name.includes("..")) {
    return "File name cannot contain path separators or parent directory references.";
  }
  if (file.size === 0) return "File is empty.";
  if (file.size > MAX_FILE_SIZE) return "File size exceeds maximum of 5MB.";
  const extensions = ALLOWED_MIME_TYPES[file.type];
  if (!extensions) return "File type is not allowed. Allowed: PDF, JPG, PNG.";
  const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!extensions.includes(extension)) return "File extension does not match file type.";
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function WorkerDocumentsScreen() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [documents, setDocuments] = useState<WorkerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [progressByType, setProgressByType] = useState<Partial<Record<DocumentType, DocumentProgress>>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<DocumentFeedback | null>(null);
  const inputRefs = useRef<Partial<Record<DocumentType, HTMLInputElement | null>>>({});

  const loadDocuments = useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setLoading(true);
    setListError("");
    try {
      const response = await apiGet<DocumentListResponse>("/api/v1/workers/me/documents");
      setDocuments(response.documents || []);
    } catch (error) {
      setListError(errorMessage(error, "Failed to fetch documents."));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth/signin", { replace: true });
      return;
    }
    if (user.role !== "WORKER") {
      navigate("/worker/auth", { replace: true });
      return;
    }
    void loadDocuments();
  }, [authLoading, loadDocuments, navigate, user]);

  const setProgress = (type: DocumentType, progress: number) => {
    setProgressByType((current) => ({ ...current, [type]: { progress } }));
  };

  const uploadDocument = async (file: File, documentType: DocumentType) => {
    const validationError = validateFile(file);
    if (validationError) {
      setFeedback({ kind: "error", message: validationError });
      return;
    }

    setFeedback(null);
    setProgress(documentType, 10);
    const request = {
      document_type: documentType,
      original_filename: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
    };

    try {
      setProgress(documentType, 20);
      const { storage_path: storagePath } = await apiPost<UploadStartResponse>(
        "/api/v1/workers/me/documents/upload-start",
        request,
      );

      setProgress(documentType, 40);
      const { data: { session } } = await getSupabaseClient().auth.getSession();
      if (!session) throw new Error("No authenticated session found.");

      const { error: uploadError } = await getSupabaseClient()
        .storage
        .from("worker-documents")
        .upload(storagePath, file, { cacheControl: "3600", upsert: true });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      setProgress(documentType, 70);
      const uploadedDocument = await apiPost<WorkerDocument>(
        "/api/v1/workers/me/documents/upload-complete",
        { ...request, storage_path: storagePath },
      );

      setDocuments((current) => [
        ...current.filter((document) => document.document_type !== documentType),
        uploadedDocument,
      ]);
      setProgress(documentType, 100);
      setFeedback({
        kind: "success",
        message: `${documentType.replace(/_/g, " ")} uploaded successfully.`,
      });
    } catch (error) {
      setProgressByType((current) => {
        const next = { ...current };
        delete next[documentType];
        return next;
      });
      setFeedback({ kind: "error", message: errorMessage(error, "Upload failed.") });
    } finally {
      inputRefs.current[documentType] && (inputRefs.current[documentType]!.value = "");
      window.setTimeout(() => {
        setProgressByType((current) => {
          const next = { ...current };
          delete next[documentType];
          return next;
        });
      }, 900);
    }
  };

  const viewDocument = async (documentId: string) => {
    setFeedback(null);
    try {
      const { url } = await apiGet<{ url: string; expires_in: number }>(
        `/api/v1/workers/me/documents/${encodeURIComponent(documentId)}/view`,
      );
      if (Capacitor.isNativePlatform()) await Browser.open({ url });
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setFeedback({ kind: "error", message: errorMessage(error, "Unable to open document.") });
    }
  };

  const deleteDocument = async (document: WorkerDocument) => {
    if (!window.confirm("Are you sure you want to delete this document?")) return;
    setFeedback(null);
    setDeletingId(document.id);
    try {
      await apiRequest<void>(`/api/v1/workers/me/documents/${encodeURIComponent(document.id)}`, { method: "DELETE" });
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setFeedback({ kind: "success", message: "Document deleted successfully." });
    } catch (error) {
      setFeedback({ kind: "error", message: errorMessage(error, "Failed to delete document.") });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <WorkerMobileShell>
      <main className="worker-documents-page">
        <header className="worker-documents-page-header">
          <div>
            <p className="worker-documents-eyebrow">Documents</p>
            <h1>Documents</h1>
            <p className="worker-documents-description">Manage your verification documents.</p>
          </div>
        </header>

        <section className="worker-documents-panel" aria-labelledby="worker-documents-panel-title">
          {loading ? (
            <div className="worker-documents-loading" role="status">
              <Loader2 size={20} className="worker-documents-spinner" />
            </div>
          ) : (
            <>
              <div className="worker-documents-panel-heading">
                <div className="worker-documents-panel-icon"><UploadCloud size={20} /></div>
                <div><h2 id="worker-documents-panel-title">Documents</h2></div>
              </div>
              <p className="worker-documents-guidance">
                Upload your documents for verification (PDF, JPG or PNG, max 5MB each)
              </p>

              {listError ? (
                <div className="worker-documents-error" role="alert">
                  <AlertCircle size={14} />
                  <p>{listError}</p>
                  <button type="button" onClick={() => void loadDocuments()}>Try again</button>
                </div>
              ) : (
                <div className="worker-documents-list">
                  {DOCUMENTS.map(({ type, title }) => {
                    const currentDocument = documents.find((document) => document.document_type === type) || null;
                    const progress = progressByType[type];
                    const isUploading = Boolean(progress);
                    const isDeleting = currentDocument?.id === deletingId;

                    return (
                      <div className="worker-document-row" key={type}>
                        <div className="worker-document-row-content">
                          <div className="worker-document-type-icon">
                            {currentDocument ? <Check size={16} /> : <UploadCloud size={16} />}
                          </div>
                          <div className="worker-document-copy">
                            <p className="worker-document-title">{title}</p>
                            {currentDocument ? (
                              <p className="worker-document-detail" title={currentDocument.original_filename}>
                                {currentDocument.original_filename}
                              </p>
                            ) : (
                              <p className="worker-document-detail">Upload PDF, JPG or PNG</p>
                            )}
                          </div>
                        </div>

                        <div className="worker-document-actions">
                          {isUploading && (
                            <div className="worker-document-progress" role="status">
                              <Loader2 size={14} className="worker-documents-spinner" />
                              <span>{progress?.progress}%</span>
                            </div>
                          )}

                          {!isUploading && currentDocument && !isDeleting && (
                            <button
                              type="button"
                              className="worker-document-action worker-document-view"
                              onClick={() => void viewDocument(currentDocument.id)}
                              title="View document"
                              aria-label={`View ${title}`}
                            ><Eye size={16} /></button>
                          )}

                          {!isUploading && currentDocument && !isDeleting && (
                            <button
                              type="button"
                              className="worker-document-action worker-document-delete"
                              onClick={() => void deleteDocument(currentDocument)}
                              title="Delete document"
                              aria-label={`Delete ${title}`}
                            ><X size={16} /></button>
                          )}

                          {isDeleting && <Loader2 size={16} className="worker-document-deleting worker-documents-spinner" />}

                          {!isUploading && !isDeleting && (
                            <>
                              <input
                                ref={(element) => { inputRefs.current[type] = element; }}
                                className="worker-document-file-input"
                                type="file"
                                accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  event.target.value = "";
                                  if (file) void uploadDocument(file, type);
                                }}
                                disabled={isUploading || isDeleting}
                                aria-label={`${currentDocument ? "Replace" : "Upload"} ${title}`}
                              />
                              <button
                                type="button"
                                className="worker-document-action worker-document-upload"
                                onClick={() => inputRefs.current[type]?.click()}
                                title={currentDocument ? "Replace document" : "Upload document"}
                                aria-label={`${currentDocument ? "Replace" : "Upload"} ${title}`}
                                disabled={isUploading || isDeleting}
                              ><UploadCloud size={16} /></button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {feedback && (
                <div className={`worker-documents-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
                  {feedback.message}
                  <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message"><X size={14} /></button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </WorkerMobileShell>
  );
}