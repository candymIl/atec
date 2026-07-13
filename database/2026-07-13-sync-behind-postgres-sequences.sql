-- Production Hardening Task 2: PostgreSQL sequence health sync
-- Generated from read-only checker: scripts/check-postgres-sequences.js
--
-- Current affected sequence:
--   table:    atec.tblusers
--   column:   userid
--   sequence: atec.tblusers_userid_seq
--   current MAX(userid): 87
--   current sequence last_value: 86, is_called: true
--   current next value: 87
--   required next value: 88
--
-- This statement is safe to re-run:
--   - If tblusers is empty, it resets the sequence to its configured start value with is_called = false.
--   - If tblusers has rows, it sets the sequence to at least MAX(userid).
--   - If the sequence has already moved ahead, it keeps the higher sequence value and does not move it backward.
--   - After correction for the current data, the next generated userid will be 88.

SELECT setval(
  'atec.tblusers_userid_seq'::regclass,
  CASE
    WHEN sequence_bounds.max_id IS NULL THEN sequence_bounds.start_value
    ELSE GREATEST(sequence_bounds.max_id, sequence_bounds.last_value)
  END,
  sequence_bounds.max_id IS NOT NULL
)
FROM (
  SELECT
    (SELECT MAX(userid)::bigint FROM atec.tblusers) AS max_id,
    (SELECT last_value::bigint FROM atec.tblusers_userid_seq) AS last_value,
    (
      SELECT start_value::bigint
      FROM pg_sequences
      WHERE schemaname = 'atec'
        AND sequencename = 'tblusers_userid_seq'
    ) AS start_value
) AS sequence_bounds;
