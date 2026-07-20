-- Task 17: scheduled customer notification delivery history.

BEGIN;

CREATE TABLE IF NOT EXISTS atec.tblnotificationdelivery (
  notificationdeliveryid BIGSERIAL PRIMARY KEY,
  clientid INTEGER REFERENCES atec.tblclients(clientid),
  siteid INTEGER REFERENCES atec.tblsites(siteid),
  delivery_type VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  status VARCHAR(20) NOT NULL DEFAULT 'SENT',
  subject TEXT,
  message TEXT,
  recipients TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  due_assets INTEGER NOT NULL DEFAULT 0,
  overdue_assets INTEGER NOT NULL DEFAULT 0,
  expiring_certificates INTEGER NOT NULL DEFAULT 0,
  failed_assets INTEGER NOT NULL DEFAULT 0,
  unresolved_visit_items INTEGER NOT NULL DEFAULT 0,
  deferred_followups_due INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  sent_by_user_id INTEGER REFERENCES atec.tblusers(userid),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblnotificationdelivery_delivery_type_check'
      AND conrelid = 'atec.tblnotificationdelivery'::regclass
  ) THEN
    ALTER TABLE atec.tblnotificationdelivery
      ADD CONSTRAINT tblnotificationdelivery_delivery_type_check
      CHECK (delivery_type IN ('MANUAL', 'AUTOMATIC'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblnotificationdelivery_status_check'
      AND conrelid = 'atec.tblnotificationdelivery'::regclass
  ) THEN
    ALTER TABLE atec.tblnotificationdelivery
      ADD CONSTRAINT tblnotificationdelivery_status_check
      CHECK (status IN ('SENT', 'FAILED', 'SKIPPED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tblnotificationdelivery_customer_site_sent
  ON atec.tblnotificationdelivery (clientid, siteid, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_tblnotificationdelivery_type_status_sent
  ON atec.tblnotificationdelivery (delivery_type, status, sent_at DESC);

COMMIT;
