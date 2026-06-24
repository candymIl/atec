BEGIN;

UPDATE atec.tblasset
SET equiptypeid = 602
WHERE equiptypeid = 323;

DELETE FROM atec.tblequiptypecriteria
WHERE equiptypeid = 323;

DELETE FROM atec.tblequiptype
WHERE equiptypeid = 323;

COMMIT;
