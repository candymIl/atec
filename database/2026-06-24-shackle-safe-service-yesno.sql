BEGIN;

UPDATE atec.tblequiptypecriteria
SET
  fieldtype = 'YESNO',
  resulttype = 'YES_NO'
WHERE equiptypeid IN (303, 305)
  AND (
    lower(coalesce(criterianame, '')) LIKE '%safe%service%'
    OR lower(coalesce(criteriadescription, '')) LIKE '%safe%continued%service%'
  );

COMMIT;
