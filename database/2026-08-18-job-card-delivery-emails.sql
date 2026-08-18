BEGIN;

ALTER TABLE atec.tbljobcard
  ADD COLUMN IF NOT EXISTS customer_contact_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_email_to text,
  ADD COLUMN IF NOT EXISTS customer_email_error text;

COMMIT;
