BEGIN;

CREATE TABLE IF NOT EXISTS atec.tblinspectioncriteriasnapshot (
  testid integer NOT NULL,
  criteriaid integer NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (testid, criteriaid),
  CONSTRAINT tblinspectioncriteriasnapshot_testid_fk
    FOREIGN KEY (testid)
    REFERENCES atec.tblinspection(testid)
    ON DELETE CASCADE,
  CONSTRAINT tblinspectioncriteriasnapshot_criteriaid_fk
    FOREIGN KEY (criteriaid)
    REFERENCES atec.tblequiptypecriteria(criteriaid)
);

CREATE INDEX IF NOT EXISTS idx_tblinspectioncriteriasnapshot_criteriaid
  ON atec.tblinspectioncriteriasnapshot(criteriaid);

-- Historical inspections predate criteria-set snapshots. Their immutable
-- result rows are the authoritative record of which criteria were completed.
INSERT INTO atec.tblinspectioncriteriasnapshot (testid, criteriaid)
SELECT DISTINCT result.testid, result.criteriaid
FROM atec.tblinspectionresult result
INNER JOIN atec.tblinspection inspection
  ON inspection.testid = result.testid
INNER JOIN atec.tblequiptypecriteria criteria
  ON criteria.criteriaid = result.criteriaid
WHERE result.testid IS NOT NULL
  AND result.criteriaid IS NOT NULL
ON CONFLICT (testid, criteriaid) DO NOTHING;

COMMIT;
