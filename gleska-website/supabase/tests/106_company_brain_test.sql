-- Assertion tests for migration 106 (Company Brain). Needs pgvector (e.g. the `pgserver` Python
-- package's Postgres 16) and the stand-ins from supabase/CLAUDE.md with these rows:
--   users 11111111-…-1111, 22222222-…-2222; employer_profiles aaaaaaaa-…-0001 → 1111…, aaaaaaaa-…-0002 → 2222….
-- Prints "ALL COMPANY BRAIN TESTS PASSED"; any failed check raises.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect(ok BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF; END $$;

-- 768-dim unit-ish vector with a 1 at position k
CREATE OR REPLACE FUNCTION pg_temp.onehot(k INT) RETURNS extensions.vector LANGUAGE sql AS $$
  SELECT ('[' || string_agg(CASE WHEN i = k THEN '1' ELSE '0' END, ',') || ']')::extensions.vector
  FROM generate_series(1, 768) i;
$$;

DO $$
DECLARE
  a UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  b UUID := 'aaaaaaaa-0000-0000-0000-000000000002';
  ua UUID := '11111111-1111-1111-1111-111111111111';
  d1 UUID; d2 UUID; d3 UUID; db UUID; failed BOOLEAN; top_doc UUID; n INT;
BEGIN
  INSERT INTO company_brain_documents (employer_id, user_id, source_type, source_id, filename, storage_path, status, version)
  VALUES (a, ua, 'upload', gen_random_uuid(), 'supplier-agreement.pdf', ua::text || '/company-brain/x/a.pdf', 'indexed', 2)
  RETURNING id INTO d1;
  INSERT INTO company_brain_documents (employer_id, user_id, source_type, source_id, filename, storage_path, status)
  VALUES (a, ua, 'upload', gen_random_uuid(), 'leave-policy.docx', ua::text || '/company-brain/y/b.docx', 'indexed')
  RETURNING id INTO d2;
  INSERT INTO company_brain_documents (employer_id, user_id, source_type, source_id, filename, storage_path, status)
  VALUES (a, ua, 'upload', gen_random_uuid(), 'deleted.txt', ua::text || '/company-brain/z/c.txt', 'deleted')
  RETURNING id INTO d3;
  INSERT INTO company_brain_documents (employer_id, source_type, source_id, filename, status)
  VALUES (b, 'invoice_scan', gen_random_uuid(), 'other-org.pdf', 'indexed') RETURNING id INTO db;

  INSERT INTO company_brain_chunks (document_id, employer_id, document_version, chunk_index, content, embedding) VALUES
    (d1, a, 2, 0, 'Payment terms: the supplier shall be paid within 45 days of invoice.', pg_temp.onehot(1)),
    (d1, a, 1, 0, 'OLD VERSION payment terms 90 days', pg_temp.onehot(1)),
    (d2, a, 1, 0, 'Employees receive 12 days of paid leave per year.', pg_temp.onehot(2)),
    (d3, a, 1, 0, 'Deleted document about payment terms.', pg_temp.onehot(1)),
    (db, b, 1, 0, 'Secret payment terms of another company.', pg_temp.onehot(1));

  -- keyword only
  SELECT document_id INTO top_doc FROM company_brain_search_chunks(a, 'payment terms', NULL, 5) LIMIT 1;
  PERFORM pg_temp.expect(top_doc = d1, 'keyword search finds the agreement');
  SELECT count(*) INTO n FROM company_brain_search_chunks(a, 'payment terms', NULL, 10);
  PERFORM pg_temp.expect(n = 1, 'old versions, deleted docs and other orgs are excluded (keyword)');
  -- vector only (no keyword overlap)
  SELECT document_id INTO top_doc FROM company_brain_search_chunks(a, 'zzzz', pg_temp.onehot(2), 5) LIMIT 1;
  PERFORM pg_temp.expect(top_doc = d2, 'vector search finds the policy by embedding');
  SELECT count(*) INTO n FROM company_brain_search_chunks(a, 'zzzz', pg_temp.onehot(1), 10)
   WHERE document_id IN (d3, db);
  PERFORM pg_temp.expect(n = 0, 'vector search never returns deleted docs or other orgs');
  -- hybrid: both signals agree -> highest score
  SELECT document_id INTO top_doc FROM company_brain_search_chunks(a, 'paid leave', pg_temp.onehot(2), 5) LIMIT 1;
  PERFORM pg_temp.expect(top_doc = d2, 'hybrid ranking');
  SELECT count(*) INTO n FROM company_brain_search_chunks(a, 'payment', NULL, 1000);
  PERFORM pg_temp.expect(n <= 20, 'limit is capped');

  failed := false;
  BEGIN
    INSERT INTO company_brain_documents (employer_id, user_id, source_type, source_id, filename, storage_path)
    VALUES (a, ua, 'upload', gen_random_uuid(), 'bad.pdf', 'someone-else/company-brain/x.pdf');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'uploads must live under the owner''s path');

  INSERT INTO company_brain_conversations (employer_id, user_id, title) VALUES (a, ua, 'A chat');
END $$;

-- Client access
SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
DO $$ DECLARE failed BOOLEAN := false; BEGIN
  PERFORM pg_temp.expect((SELECT count(*) FROM company_brain_conversations) = 0, 'other owner sees no conversations');
  PERFORM pg_temp.expect((SELECT count(*) FROM company_brain_documents) = 1, 'other owner sees only own documents');
  BEGIN PERFORM count(*) FROM company_brain_chunks; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'clients cannot read chunks');
  failed := false;
  BEGIN PERFORM * FROM company_brain_search_chunks('aaaaaaaa-0000-0000-0000-000000000001', 'payment', NULL, 5);
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'clients cannot call the search function');
  failed := false;
  BEGIN INSERT INTO company_brain_conversations (employer_id, user_id) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'clients cannot write conversations');
  failed := false;
  BEGIN PERFORM count(*) FROM company_brain_query_audit; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  PERFORM pg_temp.expect(failed, 'clients cannot read the audit log');
END $$;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$ BEGIN
  PERFORM pg_temp.expect((SELECT count(*) FROM company_brain_conversations) = 1, 'owner sees own conversation');
END $$;
RESET ROLE;

\echo ALL COMPANY BRAIN TESTS PASSED
