-- NOTE: flyway_schema_history is deliberately NOT listed below. Enabling RLS on it
-- from inside a Flyway migration self-deadlocks (ACCESS EXCLUSIVE against the lock
-- Flyway holds on that table for the whole run) and times out with SQLSTATE 57014.
-- It must be enabled out-of-band in the Supabase SQL editor, outside any
-- Flyway-managed transaction; that has already been handled separately.
-- Enable Row Level Security on every table in `public`, closing the Supabase
-- Security Advisor findings rls_disabled_in_public / sensitive_columns_exposed.
--
-- Supabase exposes every table in the `public` schema through PostgREST (the
-- auto-generated REST API) by default, regardless of whether the app actually
-- calls that API. This project's Java backend never does - siddhamind-core
-- talks to Postgres directly over JDBC as the migration/runtime role - but the
-- PostgREST endpoint still exists and is reachable by anyone holding the
-- project's anon key. Without RLS, every row in every one of these tables
-- (users, chat history, diagnosis sessions, safety checks...) is readable and
-- writable through that endpoint by design; RLS is what Postgres uses to
-- decide what a given role may see, and with it disabled the answer is
-- "everything."
--
-- Fix: enable RLS with NO policies. That is a default-deny for every role
-- PostgREST uses (anon, authenticated) - the API endpoint starts returning
-- empty results / permission-denied instead of the full table. It does NOT
-- affect this application: RLS is bypassed for a table's owner and for
-- superusers, and the role in JAVA_DB_URL / MIGRATION_DB_URL is the one that
-- ran V1__baseline_schema.sql and therefore owns every table below. If a
-- future feature needs to expose one of these tables through PostgREST
-- directly (rather than through the Java API), add explicit CREATE POLICY
-- statements for it then - do not disable RLS to work around this.
ALTER TABLE public.roles                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulation_ingredients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulation_diseases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diseases                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allopathic_drugs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contraindications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_checks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_check_findings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnosis_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnosis_candidates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnosis_suggestions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_chunks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_citations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications             ENABLE ROW LEVEL SECURITY;
