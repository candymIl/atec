BEGIN;

CREATE TABLE IF NOT EXISTS atec.tblriskassessment (
  riskid serial PRIMARY KEY,
  assetid integer NULL,
  clientid integer NULL,
  siteid integer NULL,
  sectionid integer NULL,
  assessment_date date NOT NULL DEFAULT CURRENT_DATE,
  activity text NOT NULL,
  hazard text NOT NULL,
  consequence text NULL,
  initial_severity integer NULL CHECK (initial_severity BETWEEN 1 AND 5),
  initial_likelihood integer NULL CHECK (initial_likelihood BETWEEN 1 AND 5),
  initial_rating integer NULL,
  controls text NULL,
  residual_severity integer NULL CHECK (residual_severity BETWEEN 1 AND 5),
  residual_likelihood integer NULL CHECK (residual_likelihood BETWEEN 1 AND 5),
  residual_rating integer NULL,
  action_required text NULL,
  responsible_person text NULL,
  due_date date NULL,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED')),
  created_by_user_id integer NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  archived boolean NOT NULL DEFAULT false
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblriskassessment_assetid_fk'
      AND conrelid = 'atec.tblriskassessment'::regclass
  ) THEN
    ALTER TABLE atec.tblriskassessment
      ADD CONSTRAINT tblriskassessment_assetid_fk
      FOREIGN KEY (assetid)
      REFERENCES atec.tblasset(assetid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tblriskassessment_assetid
  ON atec.tblriskassessment(assetid);

CREATE INDEX IF NOT EXISTS idx_tblriskassessment_status
  ON atec.tblriskassessment(status);

CREATE INDEX IF NOT EXISTS idx_tblriskassessment_assessment_date
  ON atec.tblriskassessment(assessment_date DESC);

COMMIT;
