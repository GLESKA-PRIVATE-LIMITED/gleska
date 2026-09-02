-- Create worker_documents table for storing document metadata
-- Documents are private (no public URLs), one per type per worker, optional for profile completion

-- Create ENUM type for document types if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_type' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE document_type AS ENUM ('EXPERIENCE_CERTIFICATE', 'POLICE_VERIFICATION');
  END IF;
END $$;

-- Create worker_documents table
CREATE TABLE IF NOT EXISTS public.worker_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_profile_id UUID NOT NULL REFERENCES public.worker_profiles(id) ON DELETE CASCADE,
  document_type document_type NOT NULL,
  
  -- File information (stored in Supabase Storage, not in database)
  storage_path TEXT NOT NULL UNIQUE,  -- e.g., "workers/{worker_id}/documents/{type}/{uuid}.pdf"
  original_filename TEXT NOT NULL,     -- e.g., "certificate.pdf"
  mime_type TEXT NOT NULL,             -- e.g., "application/pdf", "image/jpeg", "image/png"
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880),  -- <= 5 MB
  
  -- Lifecycle timestamps
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraint: one active document per type per worker
  -- Replacing a document updates the same row, doesn't create duplicates
  CONSTRAINT worker_documents_one_per_type UNIQUE (worker_profile_id, document_type),
  
  -- Ensure worker_profile_id is actually a valid worker
  CONSTRAINT valid_worker_profile FOREIGN KEY (worker_profile_id) REFERENCES public.worker_profiles(id) ON DELETE CASCADE
);

-- Create indexes for query performance
CREATE INDEX IF NOT EXISTS idx_worker_documents_worker_profile_id ON public.worker_documents(worker_profile_id);
CREATE INDEX IF NOT EXISTS idx_worker_documents_document_type ON public.worker_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_worker_documents_uploaded_at ON public.worker_documents(uploaded_at DESC);

-- Create updated_at trigger for worker_documents
DROP TRIGGER IF EXISTS update_worker_documents_updated_at ON public.worker_documents;
CREATE TRIGGER update_worker_documents_updated_at BEFORE UPDATE ON public.worker_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row-Level Security (RLS) on worker_documents
ALTER TABLE public.worker_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policy 1: Workers can only view their own documents
CREATE POLICY "Workers can view their own documents"
  ON public.worker_documents
  FOR SELECT
  USING (
    auth.uid() = (SELECT user_id FROM public.worker_profiles WHERE id = worker_profile_id)
  );

-- RLS Policy 2: Workers can only insert documents for their own profile
CREATE POLICY "Workers can insert documents for their own profile"
  ON public.worker_documents
  FOR INSERT
  WITH CHECK (
    auth.uid() = (SELECT user_id FROM public.worker_profiles WHERE id = worker_profile_id)
  );

-- RLS Policy 3: Workers can only update their own documents
CREATE POLICY "Workers can update their own documents"
  ON public.worker_documents
  FOR UPDATE
  USING (
    auth.uid() = (SELECT user_id FROM public.worker_profiles WHERE id = worker_profile_id)
  )
  WITH CHECK (
    auth.uid() = (SELECT user_id FROM public.worker_profiles WHERE id = worker_profile_id)
  );

-- RLS Policy 4: Workers can only delete their own documents
CREATE POLICY "Workers can delete their own documents"
  ON public.worker_documents
  FOR DELETE
  USING (
    auth.uid() = (SELECT user_id FROM public.worker_profiles WHERE id = worker_profile_id)
  );

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_documents TO authenticated;
