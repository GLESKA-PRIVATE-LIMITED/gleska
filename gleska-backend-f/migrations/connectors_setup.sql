-- Supabase migration: AI Assistant Connectors
-- Run this in Supabase SQL Editor before using connector features.

-- 1. connector_tokens table — stores OAuth tokens and API credentials per employer
CREATE TABLE IF NOT EXISTS connector_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employer_id UUID NOT NULL REFERENCES employer_profiles(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'expired')),
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    connector_metadata JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(employer_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_connector_tokens_employer ON connector_tokens(employer_id);
CREATE INDEX IF NOT EXISTS idx_connector_tokens_provider ON connector_tokens(provider);
CREATE INDEX IF NOT EXISTS idx_connector_tokens_status ON connector_tokens(status);

-- 2. Row Level Security — employers only see their own tokens
ALTER TABLE connector_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employers manage own connector tokens" ON connector_tokens;
CREATE POLICY "Employers manage own connector tokens" ON connector_tokens
    FOR ALL
    USING (
        employer_id IN (
            SELECT id FROM employer_profiles WHERE user_id = auth.uid()
        )
    );

-- 3. Storage bucket for AI Assistant file uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'assistant-uploads',
    'assistant-uploads',
    false,
    26214400,  -- 25 MB
    ARRAY[
        'application/pdf',
        'image/png', 'image/jpeg', 'image/gif', 'image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain', 'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'video/mp4', 'video/quicktime', 'video/webm'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage policies — users can upload and read their own files
DROP POLICY IF EXISTS "Users upload their own assistant files" ON storage.objects;
CREATE POLICY "Users upload their own assistant files" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'assistant-uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Users read their own assistant files" ON storage.objects;
CREATE POLICY "Users read their own assistant files" ON storage.objects
    FOR SELECT
    USING (
        bucket_id = 'assistant-uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- 5. Service role can access everything (backend uses service role key)
DROP POLICY IF EXISTS "Service role full access to assistant uploads" ON storage.objects;
CREATE POLICY "Service role full access to assistant uploads" ON storage.objects
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');
