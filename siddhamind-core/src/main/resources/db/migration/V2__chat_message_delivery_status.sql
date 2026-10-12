-- ============================================================
--  Distinguish an assistant reply's three outcomes explicitly.
--
--  not_found_in_corpus alone could not: an outage and a legitimately
--  uncited answer both stored FALSE with no citations, so once the row was
--  read back there was nothing to tell them apart. That matters because the
--  two say opposite things to a practitioner - "the classical texts do not
--  cover this" versus "we could not reach the assistant, try again" - and
--  the chat page renders entirely from persisted state after its
--  post-redirect-get.
--
--  not_found_in_corpus is kept rather than replaced. It is a column Java
--  reads today and dropping it in the same migration that adds this one
--  would couple a schema change to a code change across two services.
-- ============================================================

ALTER TABLE chat_messages
    ADD COLUMN delivery_status VARCHAR(20) NOT NULL DEFAULT 'ANSWERED';

-- Backfill from what the older rows do encode. Anything previously flagged
-- as not-found stays not-found; everything else is treated as answered,
-- which is the safe reading - mislabelling a real outage as an answer shows
-- the assistant's own "temporarily unavailable" sentence in a neutral
-- bubble, whereas the reverse would tell a reader the corpus was silent
-- when it was never consulted.
UPDATE chat_messages
SET delivery_status = 'NOT_FOUND'
WHERE not_found_in_corpus = TRUE;

-- USER messages have no delivery outcome of their own; ANSWERED is inert
-- for them and keeps the column NOT NULL without a special case.
ALTER TABLE chat_messages
    ADD CONSTRAINT ck_msg_delivery_status
        CHECK (delivery_status IN ('ANSWERED', 'NOT_FOUND', 'UNAVAILABLE'));

COMMENT ON COLUMN chat_messages.delivery_status IS
    'ANSWERED | NOT_FOUND | UNAVAILABLE. NOT_FOUND is a legitimate final answer; '
    'UNAVAILABLE means the AI service could not be reached and the question is '
    'still unanswered.';
