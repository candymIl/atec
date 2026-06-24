BEGIN;

UPDATE atec.tblequiptypecriteria
SET
  fieldtype = 'YESNO',
  resulttype = 'YES_NO'
WHERE equiptypeid = 324
  AND (
    lower(coalesce(criterianame, '')) LIKE '%safe%service%'
    OR lower(coalesce(criteriadescription, '')) LIKE '%safe%continued%service%'
    OR lower(coalesce(criteriadescription, '')) LIKE '%confirm whether the equipment is safe%'
  );

COMMIT;
