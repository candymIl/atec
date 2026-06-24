BEGIN;

UPDATE atec.tblequiptypecriteria
SET
  fieldtype = 'PASSFAIL',
  resulttype = 'PASS_FAIL'
WHERE equiptypeid = 201
  AND inspectioncategory = 'VISUAL'
  AND criteriaid IN (25, 27);

COMMIT;
