# WORKER DOCUMENTS FEATURE — IMPLEMENTATION COMPLETE

**Date:** 2026-09-02  
**Phase:** 3 & 4 (Design + Implementation)  
**Status:** ✅ Code implementation complete, requires Supabase bucket setup and testing

---

## IMPLEMENTATION SUMMARY

### Files Created

#### 1. Database Migration
- **File:** `gleska-website/supabase/migrations/034_worker_documents.sql`
- **Purpose:** Create worker_documents table with ENUM type, constraints, indexes, RLS policies
- **Key Features:**
  - One active document per type per worker (UNIQUE constraint on worker_profile_id, document_type)
  - File size constraint: ≤ 5 MB
  - Automatic updated_at trigger
  - Four RLS policies for SELECT, INSERT, UPDATE, DELETE (all ownership-checked via auth.uid())
  - Indexes for performance (worker_profile_id, document_type, uploaded_at)

#### 2. Storage Migration
- **File:** `gleska-website/supabase/migrations/035_worker_documents_storage.sql`
- **Purpose:** Create storage.objects RLS policies for private bucket
- **Key Features:**
  - Private bucket "worker-documents" (public=false)
  - Path-based RLS: `workers/{worker_id}/documents/{type}/{filename}`
  - Extract worker_id from storage path and verify against authenticated user
  - Four policies for INSERT, SELECT, UPDATE, DELETE

#### 3. Backend Schemas
- **File:** `gleska-backend-f/app/schemas/worker.py` (appended)
- **New Classes:**
  - `WorkerDocumentResponse`: API response schema with full document metadata
  - `WorkerDocumentListResponse`: Wrapper with documents array and total_count
  - `DocumentUploadRequest`: Validation schema with MIME type and file size checks
- **Validation:**
  - document_type: must be EXPERIENCE_CERTIFICATE or POLICE_VERIFICATION
  - mime_type: must be application/pdf, image/jpeg, or image/png
  - file_size_bytes: must be > 0 and ≤ 5242880 (5 MB)
  - original_filename: no path traversal allowed

#### 4. Backend Service
- **File:** `gleska-backend-f/app/services/document_service.py` (new)
- **Class:** `WorkerDocumentService`
- **Methods:**
  - `validate_file_metadata()`: Client-side + server-side file validation
  - `get_document_storage_path()`: Generate secure storage paths with UUID
  - `create_document_metadata()`: UPSERT document in database
  - `delete_old_document_storage()`: Clean up old files when replacing
  - `get_document()`: Retrieve single document with authorization check
  - `get_worker_documents()`: List all documents for worker (ordered by upload time)
  - `delete_document()`: Delete both metadata and Storage file
  - `get_signed_download_url()`: Generate signed URLs for private downloads

#### 5. Backend Endpoints
- **File:** `gleska-backend-f/app/routers/workers.py` (appended)
- **Endpoints:**
  1. `POST /api/v1/workers/me/documents/upload-start`
     - Validates file metadata
     - Generates storage path
     - Returns path + worker_profile_id for frontend
  2. `POST /api/v1/workers/me/documents/upload-complete`
     - Called AFTER file uploaded to Storage
     - Deletes old file if replacing
     - Creates/updates metadata in database
     - Returns created document
  3. `GET /api/v1/workers/me/documents`
     - Lists all documents for authenticated worker
     - Returns metadata (no file content)
  4. `GET /api/v1/workers/me/documents/{document_id}`
     - Retrieves single document metadata
     - Authorization checked via RLS
  5. `DELETE /api/v1/workers/me/documents/{document_id}`
     - Deletes metadata and Storage file
     - Returns 204 No Content

**All endpoints require authentication (require_worker decorator)**

#### 6. Frontend Hook
- **File:** `gleska-website/src/lib/useWorkerDocuments.ts` (new)
- **Hook:** `useWorkerDocuments()`
- **Features:**
  - State management: documents, isLoading, error, uploadProgress
  - Validation: `validateFileForUpload()` helper
  - Three-step upload flow: upload-start → Storage → upload-complete
  - Methods:
    - `fetchDocuments()`: Fetch all documents
    - `uploadDocument()`: Full upload flow with progress tracking
    - `deleteDocument()`: Delete by document ID
    - `getDocument()`: Retrieve single document
    - `getDocumentByType()`: Get current document by type
- **File validation:**
  - Frontend: size, MIME type, extension checks
  - Backend: redundant validation for security
  - Max size: 5 MB (enforced both sides)

#### 7. Frontend Component
- **File:** `gleska-website/src/components/DocumentsSection.tsx` (new)
- **Components:**
  - `DocumentCard`: UI for single document with upload/delete buttons
  - `DocumentsSection`: Full documents section with both cards
- **Features:**
  - File input with validation
  - Upload progress indicator
  - Success/error feedback (toast)
  - Delete confirmation
  - Shows current document name when uploaded
  - Responsive design matching existing profile UI
  - Dark mode support

#### 8. Worker Profile Page Update
- **File:** `gleska-website/src/app/worker/profile/page.tsx` (modified)
- **Change:** Replaced static document placeholder with `<DocumentsSection />` component
- **Import:** Added DocumentsSection from components

---

## SECURITY ARCHITECTURE

### Database-Level Security (PostgreSQL RLS)

```sql
-- Only authenticated workers can access their own documents
WHERE auth.uid() = (SELECT user_id FROM worker_profiles WHERE id = worker_profile_id)

-- Applied to all four operations: SELECT, INSERT, UPDATE, DELETE
-- Prevents cross-worker access at database level
```

### Storage-Level Security (Supabase Storage RLS)

```sql
-- Path format: workers/{worker_id}/documents/{type}/{uuid}_{filename}
-- Extract worker_id from path
-- Verify: authenticated user must own that worker_profile

WHERE bucket_id = 'worker-documents'
AND (storage.foldername(name))[1] = 'workers'
AND auth.uid() IN (
  SELECT user_id FROM worker_profiles 
  WHERE id::text = (storage.foldername(name))[2]
)

-- Prevents:
-- - Public access (private bucket)
-- - Cross-worker access (path-based authorization)
-- - Path traversal (path validation)
```

### API-Level Security (FastAPI)

```python
# All endpoints require authentication
@router.post("/me/documents/...")
async def endpoint(user: UserResponse = Depends(require_worker)):
    # Derive worker_profile_id from authenticated user
    profile = supabase.table("worker_profiles").select("id").eq("user_id", user.id)
    
    # Never trust client-supplied worker_id
    worker_profile_id = profile["id"]
```

### Frontend Validation (Client-Side)

```typescript
// Validate before sending to backend
validateFileForUpload(file): {valid: boolean; error?: string}
  - Check: file.size ≤ 5MB
  - Check: MIME type in {pdf, jpeg, png}
  - Check: extension matches MIME type
  - Check: filename has no path separators
```

---

## UPLOAD FLOW (Three-Step Process)

### Step 1: Upload Start (Frontend → Backend)
```
POST /api/v1/workers/me/documents/upload-start
{
  "document_type": "EXPERIENCE_CERTIFICATE",
  "original_filename": "cert.pdf",
  "mime_type": "application/pdf",
  "file_size_bytes": 2048576
}

Response:
{
  "storage_path": "workers/{worker_id}/documents/EXPERIENCE_CERTIFICATE/{uuid}_cert.pdf",
  "document_type": "EXPERIENCE_CERTIFICATE",
  "worker_profile_id": "{uuid}"
}
```

**Backend Actions:**
- Validate file metadata
- Generate secure storage path
- Return path to frontend

### Step 2: Direct Storage Upload (Frontend → Supabase Storage)
```
POST https://supabase.co/storage/v1/object/user/worker-documents/{storage_path}
[Binary file content]
Authorization: Bearer {session.access_token}

Storage RLS checks:
- auth.uid() in authenticated users
- Path starts with workers/
- Extracted worker_id matches user's worker_profile_id
```

**Frontend Actions:**
- Get session token from Supabase Auth
- Upload file directly to Storage via supabase.storage.upload()
- Track upload progress
- On success, call upload-complete

### Step 3: Upload Complete (Frontend → Backend)
```
POST /api/v1/workers/me/documents/upload-complete
{
  "document_type": "EXPERIENCE_CERTIFICATE",
  "original_filename": "cert.pdf",
  "mime_type": "application/pdf",
  "file_size_bytes": 2048576
}

Response:
{
  "id": "{uuid}",
  "worker_profile_id": "{uuid}",
  "document_type": "EXPERIENCE_CERTIFICATE",
  "original_filename": "cert.pdf",
  "mime_type": "application/pdf",
  "file_size_bytes": 2048576,
  "uploaded_at": "2026-09-02T...",
  "updated_at": "2026-09-02T..."
}
```

**Backend Actions:**
- Validate metadata (redundant, for security)
- Get worker_profile_id from authenticated user
- Delete old document from Storage if exists (replacement case)
- UPSERT metadata into database (creates or replaces)
- Return document metadata

---

## DATABASE SCHEMA

### Table: worker_documents

```sql
CREATE TABLE worker_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_profile_id UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
  document_type document_type NOT NULL,  -- ENUM: EXPERIENCE_CERTIFICATE, POLICE_VERIFICATION
  
  -- File metadata (actual file in Storage, not in database)
  storage_path TEXT NOT NULL UNIQUE,  -- workers/{worker_id}/documents/{type}/{uuid}_{filename}
  original_filename TEXT NOT NULL,     -- Original user filename for display
  mime_type TEXT NOT NULL,             -- application/pdf, image/jpeg, image/png
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880),
  
  -- Lifecycle
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT worker_documents_one_per_type UNIQUE (worker_profile_id, document_type)
);
```

### ENUM Type: document_type
```sql
CREATE TYPE document_type AS ENUM ('EXPERIENCE_CERTIFICATE', 'POLICE_VERIFICATION');
```

---

## STORAGE BUCKET CONFIGURATION

### Manual Setup Required (Supabase Dashboard)

**Bucket Name:** `worker-documents`

**Settings:**
- Public: NO (private bucket)
- File size limit: 50 MB (backend checks 5 MB)
- MIME types allowed: application/pdf, image/jpeg, image/png
- Allow read: No (authenticated RLS)
- Allow write: No (authenticated RLS)

**RLS Policies Applied via Migration 035:**
- SELECT: Workers can view their own documents
- INSERT: Workers can upload to their own folder
- UPDATE: Workers can replace their own documents
- DELETE: Workers can delete their own documents

---

## CHANGES NOT MADE (User Constraints Honored)

✅ **NOT Modified:**
- worker_profiles.profile_completed (documents are optional)
- worker_profiles.onboarding_status (no document requirement)
- onboarding flow (nextStep logic unchanged)
- location functionality (GPS, live tracking, matching)
- dashboard jobs (no impact on available-jobs)
- profile completion calculation (still 8 fields)
- authentication (no changes)

---

## RUNTIME TESTING CHECKLIST

### Test 1: File Upload & Storage
```
Steps:
1. Worker navigates to Profile → Documents section
2. Click "Upload Experience Certificate"
3. Select valid PDF (< 5MB)
4. Observe: progress bar, success toast
5. Observe: document name displayed in card
6. Backend actions: upload-start → Storage → upload-complete
7. DB check: worker_documents table has 1 row
8. Storage check: file exists at workers/{id}/documents/EXPERIENCE_CERTIFICATE/{uuid}_*.pdf
```

**Expected Result:** ✅ Document persists in Storage and DB metadata saved

### Test 2: File Validation (Invalid File)
```
Steps:
1. Try to upload .exe file
2. Observe: "File type not allowed" error (frontend validation)
3. Try to upload 10MB file
4. Observe: "File size exceeds maximum" error (frontend)
5. Upload valid file, then try 6MB file
6. Observe: Backend rejects with 400 Bad Request
```

**Expected Result:** ✅ Invalid files blocked at frontend and backend

### Test 3: Document Replacement
```
Steps:
1. Upload Experience Certificate (cert1.pdf)
2. Observe: document_type card shows cert1.pdf
3. Upload another file (cert2.pdf) for same type
4. Observe: UNIQUE constraint allows update (UPSERT)
5. DB check: still only 1 row for EXPERIENCE_CERTIFICATE (updated)
6. Storage check: old cert1.pdf deleted, only cert2.pdf remains
```

**Expected Result:** ✅ Replacement works, old file cleaned up

### Test 4: Document Deletion
```
Steps:
1. Upload document
2. Click delete button on document card
3. Click confirm on dialog
4. Observe: document removed from card, success toast
5. DB check: row deleted from worker_documents
6. Storage check: file deleted from bucket
```

**Expected Result:** ✅ Deletion removes both DB and Storage

### Test 5: Multiple Document Types
```
Steps:
1. Upload Experience Certificate
2. Upload Police Verification
3. Observe: both cards display uploaded documents
4. DB check: 2 rows in worker_documents (different document_type)
5. Delete one, verify other remains
```

**Expected Result:** ✅ Independent management of document types

### Test 6: Cross-Worker Authorization
```
Setup:
- Worker A with documents
- Worker B (different user)

Steps:
1. Log in as Worker A
2. Observe: Only Worker A's documents visible
3. Log in as Worker B
4. Observe: Worker B's documents (or empty if none uploaded)
5. Try direct SQL: SELECT * FROM worker_documents WHERE worker_profile_id = {worker_a_id}
6. Observe: RLS policy blocks (returns empty)
7. Try direct Storage access: GET /worker-documents/workers/{worker_a_id}/documents/...
8. Observe: 403 Forbidden (unauthorized)
```

**Expected Result:** ✅ RLS prevents cross-worker access at DB and Storage level

### Test 7: Session Persistence (Refresh)
```
Steps:
1. Upload document
2. Refresh page (F5)
3. Observe: Component loads documents on mount
4. Verify: Document list restored from database
5. Verify: Progress bar cleared, UI ready for new upload
```

**Expected Result:** ✅ Documents persist across sessions

### Test 8: Profile Completion Unchanged
```
Steps:
1. Upload documents
2. Check worker profile: profile_completed field
3. Verify: profile_completed remains unchanged by document upload
4. Check onboarding_status: remains unchanged
5. Check nextStep: remains unchanged
```

**Expected Result:** ✅ Documents are truly optional

---

## SUPABASE BUCKET SETUP INSTRUCTIONS

### Via Supabase Dashboard (One-Time Setup)

1. **Navigate to Storage → Buckets**
2. **Click "New Bucket"**
   - Name: `worker-documents`
   - Check "Private bucket"
   - Click "Create Bucket"
3. **Configure CORS (if needed)**
   - Storage → CORS
   - Add origin: your frontend URL
4. **RLS Policies**
   - Storage → Policies
   - Run migration 035 via SQL editor (policies created automatically)

### Via Supabase CLI

```bash
# Create bucket
supabase bucket create worker-documents --private

# Apply migrations
supabase migration up
```

### Test Bucket Access

```bash
# Via curl (requires auth token)
curl -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "https://your-project.supabase.co/storage/v1/bucket" \
  -d '{"name":"worker-documents","public":false}'
```

---

## FILES CHANGED & CREATED

### Created Files (4):
1. ✅ `gleska-website/supabase/migrations/034_worker_documents.sql` — Database schema + RLS
2. ✅ `gleska-website/supabase/migrations/035_worker_documents_storage.sql` — Storage RLS
3. ✅ `gleska-backend-f/app/services/document_service.py` — Document service
4. ✅ `gleska-website/src/lib/useWorkerDocuments.ts` — Frontend hook
5. ✅ `gleska-website/src/components/DocumentsSection.tsx` — React component

### Modified Files (3):
1. ✅ `gleska-backend-f/app/schemas/worker.py` — Added 3 schemas (WorkerDocumentResponse, WorkerDocumentListResponse, DocumentUploadRequest)
2. ✅ `gleska-backend-f/app/routers/workers.py` — Added 5 endpoints + imports
3. ✅ `gleska-website/src/app/worker/profile/page.tsx` — Replaced placeholder with DocumentsSection component

### Not Modified (As per requirements):
- ✅ Profile completion logic (documents don't affect it)
- ✅ Onboarding flow (documents don't affect it)
- ✅ Location/GPS (completely separate)
- ✅ Matching/routing (no changes)
- ✅ Dashboard (no changes)

---

## NEXT STEPS FOR RUNTIME TESTING

### Prerequisites
1. Supabase bucket created: `worker-documents` (private)
2. Migrations applied: 034 and 035
3. Backend running: Python FastAPI on http://localhost:8000
4. Frontend running: Next.js on http://localhost:3000
5. Database migrations applied: `supabase migration up`

### Testing Command
```bash
# In gleska-backend-f
python -m pytest tests/test_worker_documents.py -v

# Alternatively, manual testing in browser:
# 1. Navigate to http://localhost:3000/app/worker/profile
# 2. Find Documents section
# 3. Upload file
# 4. Verify success
# 5. Refresh page
# 6. Verify document persists
```

---

## IMPLEMENTATION STATUS

| Component | Status | Notes |
|-----------|--------|-------|
| Database migration (034) | ✅ Created | Table, constraints, indexes, RLS |
| Storage migration (035) | ✅ Created | Storage RLS policies |
| Backend schemas | ✅ Created | DocumentUploadRequest, DocumentResponse, etc |
| Backend service | ✅ Created | Full CRUD + validation + authorization |
| Backend endpoints | ✅ Created | 5 endpoints for upload/list/delete |
| Frontend hook | ✅ Created | State, upload flow, file validation |
| Frontend component | ✅ Created | DocumentCard, DocumentsSection |
| Profile page update | ✅ Updated | Uses DocumentsSection |
| Supabase bucket | ⏳ Manual | Requires one-time dashboard setup |
| Runtime testing | ⏳ Pending | Checklist provided above |

---

**Ready for runtime testing once Supabase bucket is created and migrations are applied.**

*End of Phase 3 & 4 Implementation Report*
