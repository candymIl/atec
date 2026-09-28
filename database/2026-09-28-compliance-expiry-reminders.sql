BEGIN;

-- Persist attempts before sending so restarts and concurrent workers cannot resend.
CREATE TABLE IF NOT EXISTS atec.tblcomplianceexpiryreminder (
  reminderid BIGSERIAL PRIMARY KEY,
  compliancedocumentid BIGINT NOT NULL REFERENCES atec.tblcompliancedocument(compliancedocumentid),
  expiry_date DATE NOT NULL,
  recipient TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('DAYS_60', 'DAYS_30', 'DAYS_14', 'DAYS_7', 'EXPIRED')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT')),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_complianceexpiryreminder_lookup
  ON atec.tblcomplianceexpiryreminder(compliancedocumentid, expiry_date, recipient, phase);

COMMIT;
