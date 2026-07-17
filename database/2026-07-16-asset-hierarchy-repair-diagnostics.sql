-- Milestone 1D hierarchy diagnostics.
--
-- READ ONLY. This script classifies invalid asset hierarchy records and emits
-- the manual-review queue without updating data.

\echo 'Asset hierarchy issue counts'
WITH asset_facts AS (
  SELECT
    a.assetid,
    a.assettagno,
    a.description,
    a.clientid AS current_clientid,
    a.siteid AS current_siteid,
    a.sectionid AS current_sectionid,
    COALESCE(a.archived, false) AS asset_archived,
    c.clientid AS asset_customer_exists,
    COALESCE(c.archived, false) AS asset_customer_archived,
    s.siteid AS asset_site_exists,
    s.clientid AS site_clientid,
    COALESCE(s.archived, false) AS asset_site_archived,
    sec.sectionid AS section_exists,
    sec.siteid AS section_siteid,
    sec.clientid AS section_clientid,
    COALESCE(sec.archived, false) AS section_archived,
    section_site.siteid AS section_site_exists,
    section_site.clientid AS section_site_clientid,
    COALESCE(section_site.archived, false) AS section_site_archived,
    section_client.clientid AS section_client_exists,
    COALESCE(section_client.archived, false) AS section_client_archived,
    et.description AS equipment_type
  FROM atec.tblasset a
  LEFT JOIN atec.tblclients c ON c.clientid = a.clientid
  LEFT JOIN atec.tblsites s ON s.siteid = a.siteid
  LEFT JOIN atec.tblsection sec ON sec.sectionid = a.sectionid
  LEFT JOIN atec.tblsites section_site ON section_site.siteid = sec.siteid
  LEFT JOIN atec.tblclients section_client ON section_client.clientid = sec.clientid
  LEFT JOIN atec.tblequiptype et ON et.equiptypeid = a.equiptypeid
),
classified AS (
  SELECT
    *,
    current_sectionid IS NULL AS is_null_section,
    current_sectionid IS NOT NULL AND section_exists IS NULL AS is_invalid_section,
    section_exists IS NOT NULL AND current_siteid IS DISTINCT FROM section_siteid AS is_section_site_mismatch,
    section_exists IS NOT NULL AND (
      current_clientid IS DISTINCT FROM section_clientid
      OR section_clientid IS DISTINCT FROM section_site_clientid
    ) AS is_section_customer_mismatch,
    asset_site_exists IS NOT NULL AND current_clientid IS DISTINCT FROM site_clientid AS is_site_customer_mismatch,
    COALESCE(asset_customer_archived, false)
      OR COALESCE(asset_site_archived, false)
      OR COALESCE(section_archived, false)
      OR COALESCE(section_site_archived, false)
      OR COALESCE(section_client_archived, false) AS is_archived_hierarchy
  FROM asset_facts
)
SELECT 'null_section' AS issue, COUNT(*)::int AS count FROM classified WHERE is_null_section
UNION ALL SELECT 'invalid_section', COUNT(*)::int FROM classified WHERE is_invalid_section
UNION ALL SELECT 'section_site_mismatch', COUNT(*)::int FROM classified WHERE is_section_site_mismatch
UNION ALL SELECT 'section_customer_mismatch', COUNT(*)::int FROM classified WHERE is_section_customer_mismatch
UNION ALL SELECT 'site_customer_mismatch', COUNT(*)::int FROM classified WHERE is_site_customer_mismatch
UNION ALL SELECT 'archived_hierarchy', COUNT(*)::int FROM classified WHERE is_archived_hierarchy
ORDER BY issue;

\echo 'Manual-review queue'
WITH asset_facts AS (
  SELECT
    a.assetid,
    NULLIF(TRIM(a.assettagno), '') AS assettagno,
    a.description,
    et.description AS equipment_type,
    a.clientid AS current_clientid,
    a.siteid AS current_siteid,
    a.sectionid AS current_sectionid,
    c.clientid AS asset_customer_exists,
    COALESCE(c.archived, false) AS asset_customer_archived,
    s.siteid AS asset_site_exists,
    s.clientid AS site_clientid,
    COALESCE(s.archived, false) AS asset_site_archived,
    sec.sectionid AS section_exists,
    sec.siteid AS section_siteid,
    sec.clientid AS section_clientid,
    COALESCE(sec.archived, false) AS section_archived
  FROM atec.tblasset a
  LEFT JOIN atec.tblclients c ON c.clientid = a.clientid
  LEFT JOIN atec.tblsites s ON s.siteid = a.siteid
  LEFT JOIN atec.tblsection sec ON sec.sectionid = a.sectionid
  LEFT JOIN atec.tblequiptype et ON et.equiptypeid = a.equiptypeid
),
classified AS (
  SELECT
    *,
    CASE
      WHEN current_siteid IS NULL OR asset_site_exists IS NULL THEN 'F'
      ELSE 'H'
    END AS category,
    CASE
      WHEN current_siteid IS NULL OR asset_site_exists IS NULL THEN 'missing or invalid site/section parent records'
      ELSE 'null section and no authoritative replacement relationship'
    END AS reason_unresolved
  FROM asset_facts
  WHERE current_sectionid IS NULL
)
SELECT
  assetid,
  assettagno,
  description,
  equipment_type,
  current_clientid,
  current_siteid,
  current_sectionid,
  reason_unresolved,
  ARRAY[
    'current site: ' || COALESCE(current_siteid::text, 'NULL'),
    'site customer: ' || COALESCE(site_clientid::text, 'NULL')
  ] AS candidate_hierarchy_records,
  ARRAY[
    'asset customer archived: ' || asset_customer_archived::text,
    'asset site archived: ' || asset_site_archived::text,
    'section archived: ' || section_archived::text
  ] AS archive_status,
  CASE
    WHEN category = 'F' THEN 'Confirm the correct customer/site/section from source records before repair.'
    ELSE 'Provide authoritative section evidence; do not infer from names or neighbouring assets.'
  END AS recommended_business_question,
  CASE WHEN category = 'F' THEN 'high' ELSE 'medium' END AS risk_level
FROM classified
ORDER BY category, assetid;
