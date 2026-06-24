BEGIN;

SET search_path TO atec, public;

-- Some older inspection result rows still point to criteria IDs that were
-- removed from the criteria setup. Recreate those IDs as inactive historical
-- criteria so old certificates/results remain linked and readable.
WITH recovered(criteriaid, equiptypeid, criterianame, sortorder) AS (
  VALUES
    (283::bigint, 301::bigint, 'Recovered historical criterion 283 - Beam clamp', 283),
    (343::bigint, 404::bigint, 'Recovered historical criterion 343 - Crane A-Frame', 343),
    (344::bigint, 404::bigint, 'Recovered historical criterion 344 - Crane A-Frame', 344),
    (346::bigint, 404::bigint, 'Recovered historical criterion 346 - Crane A-Frame', 346),
    (347::bigint, 404::bigint, 'Recovered historical criterion 347 - Crane A-Frame', 347),
    (349::bigint, 404::bigint, 'Recovered historical criterion 349 - Crane A-Frame', 349),
    (368::bigint, 402::bigint, 'Recovered historical criterion 368 - Overhead/Bridge Crane', 368),
    (370::bigint, 402::bigint, 'Recovered historical criterion 370 - Overhead/Bridge Crane', 370),
    (371::bigint, 402::bigint, 'Recovered historical criterion 371 - Overhead/Bridge Crane', 371),
    (373::bigint, 402::bigint, 'Recovered historical criterion 373 - Overhead/Bridge Crane', 373),
    (392::bigint, 501::bigint, 'Recovered historical criterion 392 - Crawl Beam', 392),
    (394::bigint, 501::bigint, 'Recovered historical criterion 394 - Crawl Beam', 394),
    (401::bigint, 501::bigint, 'Recovered historical criterion 401 - Crawl Beam', 401)
)
INSERT INTO atec.tblequiptypecriteria (
  criteriaid,
  equiptypeid,
  criterianame,
  fieldtype,
  required,
  sortorder,
  inspectioncategory,
  criteriadescription,
  resulttype,
  inspection_category,
  severity,
  active,
  displayorder
)
SELECT
  recovered.criteriaid,
  recovered.equiptypeid,
  recovered.criterianame,
  'PASS_FAIL',
  false,
  recovered.sortorder,
  'HISTORICAL',
  recovered.criterianame,
  'PASS_FAIL',
  'PERIODIC_THOROUGH_INSPECTION',
  'OBSERVATION',
  false,
  recovered.sortorder
FROM recovered
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptypecriteria existing
  WHERE existing.criteriaid = recovered.criteriaid
);

ALTER TABLE atec.tblinspectionresult
  DROP CONSTRAINT IF EXISTS tblinspectionresult_criteriaid_fk;

ALTER TABLE atec.tblinspectionresult
  ADD CONSTRAINT tblinspectionresult_criteriaid_fk
  FOREIGN KEY (criteriaid)
  REFERENCES atec.tblequiptypecriteria(criteriaid)
  ON UPDATE CASCADE
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE atec.tblinspectionresult
  VALIDATE CONSTRAINT tblinspectionresult_criteriaid_fk;

SELECT setval(
  pg_get_serial_sequence('atec.tblequiptypecriteria', 'criteriaid'),
  GREATEST(
    COALESCE((SELECT MAX(criteriaid) FROM atec.tblequiptypecriteria), 1),
    1
  )
)
WHERE pg_get_serial_sequence('atec.tblequiptypecriteria', 'criteriaid') IS NOT NULL;

DO $$
DECLARE
  remaining_orphans integer;
BEGIN
  SELECT COUNT(*)
  INTO remaining_orphans
  FROM atec.tblinspectionresult r
  WHERE r.criteriaid IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM atec.tblequiptypecriteria c
      WHERE c.criteriaid = r.criteriaid
    );

  IF remaining_orphans <> 0 THEN
    RAISE EXCEPTION 'tblinspectionresult still has % criteria orphans', remaining_orphans;
  END IF;
END $$;

COMMIT;
