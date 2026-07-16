-- Responsible Person ownership hierarchy diagnostics.
--
-- READ ONLY. Do not run this against production unless the operator has an
-- approved maintenance/audit window. This script does not update, archive, or
-- delete data.
--
-- Expected hierarchy:
--   customer -> site -> section -> responsible person
--
-- Current compatible model:
--   atec.tblpeople stores the person.
--   atec.tblsection.responsibleid stores the section/person relationship.
--   A person can be linked to multiple sections when several section rows point
--   to the same tblpeople.personid.

\echo 'Responsible-person schema columns'
SELECT
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'atec'
  AND table_name IN ('tblpeople', 'tblsection', 'tblsites', 'tblclients', 'tblasset')
  AND (
    column_name IN ('personid', 'responsibleid', 'clientid', 'siteid', 'sectionid', 'archived')
    OR table_name = 'tblpeople'
  )
ORDER BY table_name, ordinal_position;

\echo 'Responsible-person foreign keys and indexes'
SELECT
  con.conname,
  conrelid::regclass AS table_name,
  confrelid::regclass AS references_table,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
WHERE con.connamespace = 'atec'::regnamespace
  AND con.conrelid IN ('atec.tblpeople'::regclass, 'atec.tblsection'::regclass, 'atec.tblasset'::regclass)
  AND pg_get_constraintdef(con.oid) ILIKE '%responsible%'
ORDER BY con.conname;

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'atec'
  AND tablename IN ('tblpeople', 'tblsection', 'tblasset')
  AND indexdef ILIKE '%responsible%'
ORDER BY tablename, indexname;

\echo 'People with no section relationship'
SELECT
  p.personid,
  p.clientid AS stored_clientid,
  c.clientname AS stored_customer,
  p.name,
  COALESCE(p.archived, false) AS person_archived
FROM atec.tblpeople p
LEFT JOIN atec.tblclients c
  ON p.clientid = c.clientid
LEFT JOIN atec.tblsection sec
  ON sec.responsibleid = p.personid
WHERE sec.sectionid IS NULL
ORDER BY c.clientname, p.name, p.personid;

\echo 'Responsible people shared across several sections'
SELECT
  p.personid,
  p.name,
  COUNT(sec.sectionid)::int AS section_count,
  COUNT(DISTINCT sec.siteid)::int AS site_count,
  COUNT(DISTINCT sec.clientid)::int AS customer_count,
  STRING_AGG(sec.sectionid::text, ', ' ORDER BY sec.sectionid) AS sectionids
FROM atec.tblpeople p
JOIN atec.tblsection sec
  ON sec.responsibleid = p.personid
WHERE COALESCE(p.archived, false) = false
  AND COALESCE(sec.archived, false) = false
GROUP BY p.personid, p.name
HAVING COUNT(sec.sectionid) > 1
ORDER BY section_count DESC, p.name;

\echo 'Person stored customer disagrees with section customer'
SELECT
  p.personid,
  p.name,
  p.clientid AS person_clientid,
  pc.clientname AS person_customer,
  sec.sectionid,
  sec.clientid AS section_clientid,
  sc.clientname AS section_customer,
  sec.siteid,
  s.sitename,
  sec.sectionname
FROM atec.tblpeople p
JOIN atec.tblsection sec
  ON sec.responsibleid = p.personid
LEFT JOIN atec.tblclients pc
  ON p.clientid = pc.clientid
LEFT JOIN atec.tblclients sc
  ON sec.clientid = sc.clientid
LEFT JOIN atec.tblsites s
  ON sec.siteid = s.siteid
WHERE p.clientid IS DISTINCT FROM sec.clientid
ORDER BY p.personid, sec.sectionid;

\echo 'Section site/customer disagreements'
SELECT
  sec.sectionid,
  sec.sectionname,
  sec.clientid AS section_clientid,
  sc.clientname AS section_customer,
  sec.siteid,
  s.clientid AS site_clientid,
  stc.clientname AS site_customer,
  s.sitename
FROM atec.tblsection sec
JOIN atec.tblsites s
  ON sec.siteid = s.siteid
LEFT JOIN atec.tblclients sc
  ON sec.clientid = sc.clientid
LEFT JOIN atec.tblclients stc
  ON s.clientid = stc.clientid
WHERE sec.clientid IS DISTINCT FROM s.clientid
ORDER BY sec.sectionid;

\echo 'Assets whose stored responsible person disagrees with their section responsible person'
SELECT
  a.assetid,
  a.clientid,
  a.siteid,
  a.sectionid,
  a.responsibleid AS asset_responsibleid,
  sec.responsibleid AS section_responsibleid,
  a.serialno,
  a.assettagno,
  sec.sectionname
FROM atec.tblasset a
JOIN atec.tblsection sec
  ON a.sectionid = sec.sectionid
WHERE a.responsibleid IS DISTINCT FROM sec.responsibleid
ORDER BY a.assetid;

\echo 'Duplicate active people by customer and normalized name'
SELECT
  clientid,
  lower(trim(name)) AS normalized_name,
  COUNT(*)::int AS duplicate_count,
  STRING_AGG(personid::text, ', ' ORDER BY personid) AS personids
FROM atec.tblpeople
WHERE clientid IS NOT NULL
  AND nullif(trim(name), '') IS NOT NULL
  AND COALESCE(archived, false) = false
GROUP BY clientid, lower(trim(name))
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, normalized_name;

-- Backfill strategy:
-- 1. For records where tblpeople.clientid disagrees with exactly one active
--    linked section customer, tblpeople.clientid can be backfilled from that
--    section customer after manual approval.
-- 2. Where a person is linked to sections in multiple customers, do not guess:
--    split/merge the person records manually or preserve the valid shared
--    assignment after business review.
-- 3. Where an asset responsible person disagrees with its section responsible
--    person, assets can be backfilled from the section only when the asset
--    section is correct and active.
-- 4. Redundant tblpeople.clientid and tblasset.responsibleid should not be
--    removed until all consumers are converted and historical reporting rules
--    are agreed.
