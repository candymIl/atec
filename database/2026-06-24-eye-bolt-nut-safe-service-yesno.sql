BEGIN;

UPDATE atec.tblequiptypecriteria
SET
  fieldtype = 'YESNO',
  resulttype = 'YES_NO'
WHERE equiptypeid = 309
  AND (
    lower(coalesce(criterianame, '')) LIKE '%safe%service%'
    OR lower(coalesce(criteriadescription, '')) LIKE '%safe%continued%service%'
  );

COMMIT;
