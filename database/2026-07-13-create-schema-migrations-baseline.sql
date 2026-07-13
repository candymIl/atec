-- Production Hardening Task 3: migration ledger and production baseline.
--
-- This migration creates atec.schema_migrations and records only migrations
-- whose structural effects are already visible in the current production
-- schema. It does not rerun old migrations and does not change business data.
--
-- Baseline policy:
--   - TRACKED below means the current schema proves the migration's structural
--     objects exist and the file checksum has been recorded.
--   - Excluded/uncertain migrations are intentionally not inserted into the
--     ledger. They need manual review, approval, or separate application.
--
-- Verified for baseline:
--   2026-06-23-phase-1-core-primary-keys-clean-foreign-keys.sql
--   2026-06-23-phase-1-fix-tblinspection-testid-primary-key.sql
--   2026-06-23-phase-3-qr-asset-labels.sql
--   2026-06-23-phase-5-she-risk-assessments.sql
--   2026-06-23-security-access-control.sql
--   2026-06-24-overhead-crane-aux-hoist-fields.sql
--   2026-06-30-performance-indexes.sql
--   2026-06-30-slamm-risk-assessment-upgrade.sql
--   2026-07-08-prevent-active-duplicate-master-data.sql
--
-- Excluded/uncertain:
--   2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql
--     Partially reflected by schema, but it also changes criteria data; full
--     data state cannot be proven safely from schema alone.
--   2026-06-23-phase-1-archive-orphan-inspection-results-add-fk.sql
--   2026-06-23-phase-1-clean-remaining-master-data-add-fks.sql
--   2026-06-23-phase-1-recover-historical-criteria-add-result-fk.sql
--     Data repair/archive effects cannot be proven safely as a baseline.
--   2026-06-24-*criteria*.sql and 2026-06-26-add-additional-comments-*.sql
--     Criteria data appears present in aggregate, but individual data updates
--     are not proven by schema checks.
--   2026-06-24-merge-equiptype-323-into-602.sql
--   2026-07-08 archive/merge/report duplicate cleanup files
--   2026-07-09-merge-duplicate-serial-assets-keep-latest-history.sql
--     Business-data cleanup/report migrations are not baselined here.
--   2026-07-02-pg-trgm-search-indexes.sql
--     pg_trgm extension and trigram indexes are not present and are not applied.
--   2026-07-08-prevent-active-duplicate-asset-serials.sql
--     Unique active asset serial index is not present.
--   2026-07-13-sync-behind-postgres-sequences.sql
--     Sequence sync migration is proposed separately and is not baselined here.

BEGIN;

CREATE TABLE IF NOT EXISTS atec.schema_migrations (
  migration_name text PRIMARY KEY,
  checksum text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user,
  notes text
);

INSERT INTO atec.schema_migrations (migration_name, checksum, applied_at, applied_by, notes)
VALUES
  (
    '2026-06-23-phase-1-core-primary-keys-clean-foreign-keys.sql',
    '335dfcd84f7fd3928f7097c80e7cb15446319ca671db04ec9c625c60295c4c23',
    now(),
    current_user,
    'Production baseline: verified primary keys, owned sequences/defaults, selected foreign keys, and supporting btree indexes are present. Original apply time unknown.'
  ),
  (
    '2026-06-23-phase-1-fix-tblinspection-testid-primary-key.sql',
    '368d3b8f0074699d0ff6daaa48b7fa462456ca09d255e00edb1244e754b0936c',
    now(),
    current_user,
    'Production baseline: verified tblinspection.testid primary key/default sequence and inspection photo support are present. Original apply time unknown.'
  ),
  (
    '2026-06-23-phase-3-qr-asset-labels.sql',
    '2650f2f3352aca3a03edeb30e92cf5609498787f68e8a3d73d69727724e685ba',
    now(),
    current_user,
    'Production baseline: verified tblasset.qrcode and qrcode unique/lower indexes are present. Original apply time unknown.'
  ),
  (
    '2026-06-23-phase-5-she-risk-assessments.sql',
    '06575e6a2a6f1b5f99b4777ed7df3f926e6ae0e3a6ed8a25c9f5244b2f9dca1b',
    now(),
    current_user,
    'Production baseline: verified tblriskassessment table, primary key, checks, and base indexes are present. Original apply time unknown.'
  ),
  (
    '2026-06-23-security-access-control.sql',
    '8111e5d276a3597c8792e976864ed84679843fa6a898918680862a4382ad17e6',
    now(),
    current_user,
    'Production baseline: verified tblusers role/is_active/login metadata, role check/indexes, audit_log, and inspector metadata columns are present. Original apply time unknown.'
  ),
  (
    '2026-06-24-overhead-crane-aux-hoist-fields.sql',
    '2227dc6cb4f999806f5ae2e90e370634fd3ca71d4b3dbd3bbe7f0f4bd8a34f1e',
    now(),
    current_user,
    'Production baseline: verified overhead crane auxiliary hoist fields exist on tblasset. Original apply time unknown.'
  ),
  (
    '2026-06-30-performance-indexes.sql',
    '719553d89d57f3017d0a34c79a8953943ba747f5e814adc9d0c30b675567c8b3',
    now(),
    current_user,
    'Production baseline: verified listed performance btree indexes are present; no trigram indexes included. Original apply time unknown.'
  ),
  (
    '2026-06-30-slamm-risk-assessment-upgrade.sql',
    'b6fc5087a437210d3fa837287022a1edaf2a3b2da8adae219134fb9d3ae102c3',
    now(),
    current_user,
    'Production baseline: verified SLAMM risk assessment columns and hazard_categories GIN index are present. Original apply time unknown.'
  ),
  (
    '2026-07-08-prevent-active-duplicate-master-data.sql',
    '51488c05d976b526d76c508c56010d0ff07aefef4b060800e34db32bfa87c384',
    now(),
    current_user,
    'Production baseline: verified active duplicate prevention unique indexes for sites, sections, and responsible people are present. Original apply time unknown.'
  )
ON CONFLICT (migration_name) DO UPDATE
SET
  checksum = EXCLUDED.checksum,
  notes = EXCLUDED.notes;

COMMIT;
