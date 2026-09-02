# WORKER DOCUMENTS FEATURE — PHASE 1 & 2 AUDIT

**Date:** 2026-09-02  
**Scope:** Read-only audit of document architecture  
**Status:** Discovery complete, contract to be confirmed

---

## PHASE 1 — AUDIT FINDINGS

### Frontend Status

**File:** `gleska-website/src/app/worker/profile/page.tsx` (lines 1195-1265)

**Current UI:**
```
Documents Card
├── Experience Certificate
│   └── Button: "Upload Experience Certificate" (shows toast "Document upload feature coming soon")
└── Police Verification
    └── Button: "Upload Police Verification" (shows toast "Document upload feature coming soon")
```

**Configuration shown in UI:**
- Accepted formats: "PDF, JPG or PNG"
- Upload buttons are non-functional (toast placeholder)

**Current Implementation Status:**
- ✅ UI cards exist
- ❌ Upload component not implemented
- ❌ File input/picker not implemented
- ❌ No API integration
- ❌ No progress/loading state
- ❌ No success/failure feedback

### Backend Status

**Search Results:**
- ✅ Scanned all routers: `workers.py`, `employers.py`, `locations.py`, `auth.py`
- ❌ **NO** `/api/v1/workers/*/documents` endpoints found
- ❌ **NO** upload handlers found
- ❌ **NO** file processing code found
- ❌ **NO** storage integration found

**Schemas Status:**
- ✅ `app/schemas/worker.py` — exists and complete
- ❌ **NO** `DocumentResponse` schema
- ❌ **NO** `WorkerDocumentUpload` schema
- ❌ **NO** `DocumentMetadata` schema

**Services Status:**
- ✅ Multiple services exist (`auth_service`, `geocoding_service`, `payment_service`, etc.)
- ❌ **NO** document service found
- ❌ **NO** storage service found

### Database Status

**Migrations Audit:**
- ✅ Scanned all 33 migrations
- ✅ Found: users, worker_profiles, employer_profiles, job_sites, jobs, job_matches, employer_onboarding_details
- ❌ **NO** `worker_documents` table found
- ❌ **NO** `worker_document_storage` table found
- ❌ **NO** `document_metadata` table found
- ✅ Initial schema (001) creates core tables but no document tables

**Result:**
```
Migration 001: Core schema created ✅
  - users
  - worker_profiles ← Target for document association
  - employer_profiles
  - job_sites
  - jobs
  - job_matches
  - employer_onboarding_details
  
Migrations 002-033: Various enhancements
  - Payment, verification, onboarding, terms, security, locations, etc.
  - ❌ NONE mention worker documents
```

### Storage Status

**Configuration Search:**
- ✅ Checked `src/lib/supabase.ts` — Supabase client configured correctly
- ✅ Checked `.env.example` files — NO storage bucket configuration present
- ❌ **NO** `SUPABASE_STORAGE_BUCKET` variable in config
- ❌ **NO** document storage bucket explicitly created

**Result:**
```
Supabase Client: ✅ Configured (standard auth + database)
Storage Buckets: ❌ NONE configured for documents
```

### Old Backend Search

**Search Patterns Used:**
- `document|upload|file|certificate|verification|storage`

**Result:**
- ❌ **NO** old backend code related to worker documents found
- ✅ Verification code exists but for EMPLOYER verification (Cashfree), not worker documents
- ✅ Contact inquiries stored in Supabase tables (might serve as model for documents)

**Conclusion:**
```
No authoritative source-of-truth for document architecture.
Current frontend UI is the only specification.
```

---

## PHASE 2 — CONTRACT DETERMINATION

### Source of Truth Conflict

**Status:** ⚠️ **NO CONFLICTING SOURCES** (Frontend UI is sole source)

Since no old backend exists with document code, there is no conflict.

The frontend UI defines the minimal contract:
- Two document types shown
- UI accepts PDF, JPG, PNG
- Buttons exist but unimplemented

**Design Decision Required:** Confirm the contract below before implementation.

---

### Proposed Document Contract

Based on frontend UI and Goleska patterns, here is the minimal contract:

#### 1. Supported Document Types

```
Document Types:
├── EXPERIENCE_CERTIFICATE (shown in UI)
└── POLICE_VERIFICATION (shown in UI)
```

**Status:** ✅ Inferred from frontend UI (lines 1215, 1238)

**Question for confirmation:** Are these the ONLY types, or are more planned?

#### 2. Required vs Optional

**Current Finding:** No profile completion logic references documents

**Observation:** Profile completion requires 8 fields (name, mobile, email, trade, experience, wage, location, availability)

**Not found:** Any requirement that documents must be uploaded

**Proposed:** Documents are OPTIONAL (users can have profile_completed = true without documents)

**Status:** 🟡 **NEEDS CONFIRMATION**

#### 3. Maximum Files Per Type

**Proposed:** 1 file per document type (can replace but not accumulate)

**Rationale:** 
- UI shows single button per type
- Typical use case: upload once, replace if needed
- Simpler storage/DB model

**Status:** 🟡 **NEEDS CONFIRMATION**

#### 4. Allowed File Extensions

**Frontend UI States:** "PDF, JPG or PNG"

**Proposed Extensions:**
```
.pdf
.jpg, .jpeg
.png
```

**Status:** ✅ From frontend UI

#### 5. Allowed MIME Types

**Based on Extensions:**
```
application/pdf
image/jpeg
image/png
```

**Status:** ✅ Standard

#### 6. Maximum File Size

**Not specified anywhere.**

**Proposed:** 5 MB per file

**Rationale:**
- PDFs: typical certificates 1-3 MB
- Images: typical photos 1-2 MB
- Safe limit for browser + backend
- Common across SaaS platforms

**Status:** 🟡 **NEEDS CONFIRMATION**

#### 7. Replacement Allowed

**Not explicitly specified.**

**Proposed:** YES

**Rationale:**
- Worker should be able to re-upload if document changes
- Typical UX pattern
- No technical reason to prevent it

**Status:** 🟡 **NEEDS CONFIRMATION**

#### 8. Deletion Allowed

**Not explicitly specified.**

**Proposed:** YES

**Rationale:**
- Worker should be able to remove document
- Typical UX pattern
- No technical reason to prevent it

**Status:** 🟡 **NEEDS CONFIRMATION**

#### 9. Documents Are Private

**Proposed:** YES

**Rationale:**
- Certificates/identity docs are sensitive
- Should not be publicly accessible
- Only worker + admin can view
- Stored in private bucket with RLS

**Status:** ✅ **STANDARD PRACTICE**

#### 10. Worker Association

**Proposed:**
```
worker_documents.worker_profile_id → worker_profiles.id
```

**Rationale:**
- Follows existing pattern (worker_current_locations)
- One-to-many (worker has multiple documents, but max 1 per type)

**Status:** ✅ **PATTERN MATCH**

#### 11. Database Metadata

**Proposed Table:** `worker_documents`

```sql
CREATE TABLE worker_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_profile_id UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('EXPERIENCE_CERTIFICATE', 'POLICE_VERIFICATION')),
  
  -- File information
  storage_path TEXT NOT NULL UNIQUE,  -- e.g., "workers/{worker_id}/documents/{type}/{uuid}.pdf"
  original_filename TEXT NOT NULL,     -- e.g., "my_certificate.pdf"
  mime_type TEXT NOT NULL,             -- e.g., "application/pdf"
  file_size_bytes BIGINT NOT NULL,     -- e.g., 2048576
  
  -- Lifecycle
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint: one document per type per worker
  CONSTRAINT worker_documents_one_per_type UNIQUE (worker_profile_id, document_type)
);
```

**Status:** 🟡 **NEEDS CONFIRMATION**

**Questions:**
- Should we track who approved the document? (no verification system yet)
- Should we store verification_status? (no verification system yet)
- Should we track upload IP or device info? (privacy consideration)

#### 12. Document Verification

**Current Status:** ❌ NO verification system exists for documents

**Note:** Verification system exists for EMPLOYER (Cashfree-based)

**Proposed:** Start without verification

**Optional Future:** Could add verification_status column if verification provider is later added

**Status:** ✅ **FUTURE FEATURE**

#### 13. Impact on Profile Completion

**Current Finding:** 
```
profile_completed requires:
1. user.name ✅
2. user.mobile ✅
3. user.email ✅
4. profile.trade_id ✅
5. profile.experience_years ✅
6. profile.expected_daily_wage ✅
7. profile.city OR profile.address ✅
8. profile.availability_status (≠ OFFLINE) ✅
```

**NO mention of documents.**

**Proposed:** Documents do NOT affect profile_completed

**Status:** ✅ **NO CHANGES TO EXISTING LOGIC**

---

## PHASE 2 SUMMARY — CONTRACT GAPS

### Confirmed (From Frontend UI)

✅ Document types: Experience Certificate, Police Verification  
✅ File formats: PDF, JPG, PNG  
✅ Private storage: Expected (sensitive documents)  
✅ Worker association: Via worker_profile_id  

### Inferred (From Patterns)

✅ One file per type (replacement allowed)  
✅ Deletion allowed (standard UX)  
✅ Storage in private Supabase Storage bucket  
✅ Metadata in worker_documents table  
✅ RLS policies prevent cross-worker access  

### Not Specified (Requires Confirmation)

🟡 Maximum file size (proposed: 5 MB)  
🟡 Required vs optional (proposed: optional)  
🟡 Document verification (proposed: not yet, future feature)  
🟡 Document approval workflow (proposed: not needed for MVP)  
🟡 Retention policy (proposed: indefinite until deleted)  

---

## READY FOR PHASE 3?

**Status:** ⚠️ **CONDITIONAL**

**If Approval of Proposed Contract:**
- ✅ Proceed with Phase 3 (design minimal implementation)
- ✅ Proceed with Phase 4 (implement backend + storage + frontend)

**If Contract Changes Needed:**
- ⚠️ Clarify specific points above before proceeding
- ⚠️ Confirm document types, file size, required/optional status

---

## IMPORTANT FINDINGS FOR IMPLEMENTATION

### 1. No Old Backend Reference
**There is NO authoritative old backend code.** Frontend UI is the sole specification.

### 2. Storage Architecture Must Be Created
**Supabase Storage:**
- Bucket does not exist yet
- Must create private bucket for worker documents
- Must implement RLS policies
- Must prevent cross-worker access

### 3. Database Must Be Extended
**New Migration:**
- Create `worker_documents` table
- Add constraints
- Add indexes

### 4. Backend Must Be Created From Scratch
**New Endpoints:**
- POST /api/v1/workers/me/documents (upload)
- GET /api/v1/workers/me/documents (list)
- GET /api/v1/workers/me/documents/{id} (view/download)
- DELETE /api/v1/workers/me/documents/{id} (delete)
- PATCH /api/v1/workers/me/documents/{id} (replace)

**New Schemas:**
- WorkerDocumentResponse
- DocumentUploadRequest
- DocumentMetadata

**New Services:**
- WorkerDocumentService

### 5. Frontend Must Be Updated
**Worker Profile Page:**
- Replace toast placeholders with upload UI
- Add file input + validation
- Add progress indicator
- Add success/error feedback
- Add document list view
- Add replace/delete actions

### 6. Security Must Be Prioritized
**Critical:**
- No user-supplied worker_id (derive from auth)
- No path traversal in storage paths
- Validate file type (MIME + extension)
- Validate file size before upload
- RLS policies prevent cross-worker access
- No service-role credentials on frontend

---

## NEXT STEP: CONFIRM CONTRACT

**User action required:**
1. Review contract sections 1-13 above
2. Confirm or modify each point
3. Clarify any gaps (file size, required/optional, etc.)
4. Approve to proceed with Phase 3 design

**Recommended confirmation:**
```
✅ Document types: EXPERIENCE_CERTIFICATE, POLICE_VERIFICATION only
✅ Optional for profile completion
✅ Maximum 5 MB per file
✅ One file per type (replacement allowed)
✅ Deletion allowed
✅ Private storage with RLS
✅ No verification system initially
```

If confirmed, I will proceed with Phase 3 (minimal architecture design).

---

*End of Phase 1 & 2 Audit*
