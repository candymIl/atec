-- ATEC performance indexes
-- Purpose:
--   Speed up common asset searches, certificate searches, dashboard counts,
--   reports, and inspection history lookups.
--
-- Safe to run more than once.
-- Run against the fbcranes database.

BEGIN;

-- Asset list, asset search, reports and QR lookup.
CREATE INDEX IF NOT EXISTS idx_tblasset_client_site_section
  ON atec.tblasset (clientid, siteid, sectionid);

CREATE INDEX IF NOT EXISTS idx_tblasset_client_equiptype
  ON atec.tblasset (clientid, equiptypeid);

CREATE INDEX IF NOT EXISTS idx_tblasset_active_assetid
  ON atec.tblasset (assetid)
  WHERE COALESCE(archived, false) = false;

CREATE INDEX IF NOT EXISTS idx_tblasset_serialno_lower
  ON atec.tblasset (lower(serialno));

CREATE INDEX IF NOT EXISTS idx_tblasset_assettagno_lower
  ON atec.tblasset (lower(assettagno));

CREATE INDEX IF NOT EXISTS idx_tblasset_hoistserialno_lower
  ON atec.tblasset (lower(hoistserialno));

CREATE INDEX IF NOT EXISTS idx_tblasset_auxhoistserialno_lower
  ON atec.tblasset (lower(auxhoistserialno));

CREATE INDEX IF NOT EXISTS idx_tblasset_qrcode_lower
  ON atec.tblasset (lower(qrcode));

-- Certificate search, inspection history, reports and dashboard status counts.
CREATE INDEX IF NOT EXISTS idx_tblinspection_asset_testdate
  ON atec.tblinspection (assetid, testdate DESC);

CREATE INDEX IF NOT EXISTS idx_tblinspection_type_status_testdate
  ON atec.tblinspection (inspectiontype, status, testdate DESC);

CREATE INDEX IF NOT EXISTS idx_tblinspection_validdate
  ON atec.tblinspection (validdate);

CREATE INDEX IF NOT EXISTS idx_tblinspection_tagnumber_lower
  ON atec.tblinspection (lower(tagnumber));

CREATE INDEX IF NOT EXISTS idx_tblinspection_inspector_date
  ON atec.tblinspection (inspector_user_id, testdate DESC);

-- Certificate result/photo loading.
CREATE INDEX IF NOT EXISTS idx_tblinspectionresult_testid
  ON atec.tblinspectionresult (testid);

CREATE INDEX IF NOT EXISTS idx_tblinspectionresult_testid_criteriaid
  ON atec.tblinspectionresult (testid, criteriaid);

CREATE INDEX IF NOT EXISTS idx_tblinspectionphoto_testid
  ON atec.tblinspectionphoto (testid);

CREATE INDEX IF NOT EXISTS idx_tblinspectionphoto_assetid
  ON atec.tblinspectionphoto (assetid);

-- Customer/site/section filters.
CREATE INDEX IF NOT EXISTS idx_tblclients_clientname_lower
  ON atec.tblclients (lower(clientname));

CREATE INDEX IF NOT EXISTS idx_tblsites_clientid_sitename
  ON atec.tblsites (clientid, lower(sitename));

CREATE INDEX IF NOT EXISTS idx_tblsection_siteid_sectionname
  ON atec.tblsection (siteid, lower(sectionname));

CREATE INDEX IF NOT EXISTS idx_tblsection_clientid
  ON atec.tblsection (clientid);

-- Equipment criteria loading during inspections.
CREATE INDEX IF NOT EXISTS idx_tblequiptypecriteria_equiptype_active_order
  ON atec.tblequiptypecriteria (equiptypeid, active, displayorder);

COMMIT;
