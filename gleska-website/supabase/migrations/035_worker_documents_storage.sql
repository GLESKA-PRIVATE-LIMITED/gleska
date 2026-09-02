-- Storage bucket setup for worker documents
-- This migration creates the "worker-documents" private bucket and configures RLS policies
-- NOTE: Supabase Storage bucket creation and RLS policies are configured via SQL
-- Bucket must exist with the name "worker-documents" before this script runs

-- Create the private bucket for worker documents if it doesn't exist
-- Note: In Supabase, buckets are typically created via the UI or SDK
-- This ensures RLS policies are in place once the bucket exists

-- Enable RLS on storage.objects for the worker-documents bucket
INSERT INTO storage.buckets (id, name, owner, public, created_at, updated_at)
VALUES ('worker-documents', 'worker-documents', auth.uid(), false, now(), now())
ON CONFLICT (id) DO NOTHING;

-- RLS Policy 1: Allow authenticated users to upload to their own worker folder
-- Path format: workers/{worker_id}/documents/{type}/{filename}
-- Extract worker_id from path and verify it matches the user's worker_profile
CREATE POLICY "Allow workers to upload their own documents"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'worker-documents'
    AND (storage.foldername(name))[1] = 'workers'
    AND auth.uid() IN (
      SELECT user_id FROM public.worker_profiles 
      WHERE id::text = (storage.foldername(name))[2]
    )
  );

-- RLS Policy 2: Allow authenticated users to view only their own documents
CREATE POLICY "Allow workers to view their own documents"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'worker-documents'
    AND (storage.foldername(name))[1] = 'workers'
    AND auth.uid() IN (
      SELECT user_id FROM public.worker_profiles 
      WHERE id::text = (storage.foldername(name))[2]
    )
  );

-- RLS Policy 3: Allow authenticated users to update (replace) only their own documents
CREATE POLICY "Allow workers to update their own documents"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'worker-documents'
    AND (storage.foldername(name))[1] = 'workers'
    AND auth.uid() IN (
      SELECT user_id FROM public.worker_profiles 
      WHERE id::text = (storage.foldername(name))[2]
    )
  )
  WITH CHECK (
    bucket_id = 'worker-documents'
    AND (storage.foldername(name))[1] = 'workers'
    AND auth.uid() IN (
      SELECT user_id FROM public.worker_profiles 
      WHERE id::text = (storage.foldername(name))[2]
    )
  );

-- RLS Policy 4: Allow authenticated users to delete only their own documents
CREATE POLICY "Allow workers to delete their own documents"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'worker-documents'
    AND (storage.foldername(name))[1] = 'workers'
    AND auth.uid() IN (
      SELECT user_id FROM public.worker_profiles 
      WHERE id::text = (storage.foldername(name))[2]
    )
  );
