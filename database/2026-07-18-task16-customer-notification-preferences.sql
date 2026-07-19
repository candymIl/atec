-- Task 16: customer notification preferences.
-- These defaults keep existing customers opted in until ATEC changes them.

ALTER TABLE atec.tblclients
  ADD COLUMN IF NOT EXISTS notify_expiring_certificates boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_overdue_assets boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_failed_assets boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_visit_exceptions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_lead_days integer NOT NULL DEFAULT 30;

UPDATE atec.tblclients
SET notification_lead_days = 30
WHERE notification_lead_days IS NULL OR notification_lead_days < 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblclients_notification_lead_days_nonnegative'
  ) THEN
    ALTER TABLE atec.tblclients
      ADD CONSTRAINT tblclients_notification_lead_days_nonnegative
      CHECK (notification_lead_days >= 0)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE atec.tblclients
  VALIDATE CONSTRAINT tblclients_notification_lead_days_nonnegative;
