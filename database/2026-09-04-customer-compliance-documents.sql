-- Customer portal company compliance document library.

BEGIN;

CREATE TABLE IF NOT EXISTS atec.tblcompliancedocument (
  compliancedocumentid BIGSERIAL PRIMARY KEY,
  document_type VARCHAR(40) NOT NULL,
  title TEXT NOT NULL,
  reference_number TEXT,
  issuing_authority TEXT,
  issue_date DATE,
  expiry_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  audience_all BOOLEAN NOT NULL DEFAULT TRUE,
  file_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  uploaded_by_user_id INTEGER REFERENCES atec.tblusers(userid) ON DELETE SET NULL,
  archived_by_user_id INTEGER REFERENCES atec.tblusers(userid) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT chk_compliance_document_status
    CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  CONSTRAINT chk_compliance_document_type
    CHECK (document_type IN ('TAX_CLEARANCE', 'LETTER_OF_GOOD_STANDING', 'LME', 'ISO_14001', 'ISO_9001', 'ISO_45001', 'OTHER')),
  CONSTRAINT chk_compliance_document_dates
    CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date)
);

CREATE TABLE IF NOT EXISTS atec.tblcompliancedocumentaudience (
  compliancedocumentid BIGINT NOT NULL REFERENCES atec.tblcompliancedocument(compliancedocumentid) ON DELETE CASCADE,
  clientid INTEGER NOT NULL REFERENCES atec.tblclients(clientid) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (compliancedocumentid, clientid)
);

CREATE INDEX IF NOT EXISTS idx_compliance_document_status_expiry
  ON atec.tblcompliancedocument(status, expiry_date, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_document_audience_client
  ON atec.tblcompliancedocumentaudience(clientid, compliancedocumentid);

COMMIT;
