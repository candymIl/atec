# Migration Governance - Work Package 1

## Current Interpretation

The `atec.schema_migrations` ledger is a partial forward-looking ledger, not a complete historical migration record.

Observed state during Work Package 1:

- Ledger rows: 9 tracked migrations.
- Repository SQL files: many more than 9, including historical migrations, rollback scripts, diagnostics, reports and one-off repair scripts.
- Several repository files predate the ledger baseline or are diagnostic-only and should not be marked as applied without independent verification.

## Categories

- `Tracked baseline migrations`: rows already present in `atec.schema_migrations`.
- `Historical/pre-ledger SQL`: older schema/data scripts that may have been applied before the ledger was introduced.
- `Repair migrations`: controlled one-off data repairs with rollback scripts and audit tables.
- `Rollback scripts`: scripts prefixed with `rollback` or otherwise explicitly reversible; these should not be inserted as applied migrations.
- `Diagnostics/report SQL`: read-only scripts; these should not be inserted as applied migrations.
- `Future migrations`: new schema/data changes should be recorded consistently after execution.

## Governance Rules

1. Do not insert all SQL filenames into `schema_migrations`.
2. Do not mark a historical script as applied unless the target database state and checksum are independently verified.
3. Keep rollback and diagnostics files out of the applied migration ledger.
4. For every new data repair, keep:
   - migration script,
   - rollback script,
   - audit table or explicit before-values,
   - expected row count,
   - final verification result.
5. For future production planning, create a reviewed manifest that labels each SQL file as migration, rollback, diagnostic, baseline, or obsolete.

## Remaining Governance Risk

The repository still contains many untracked SQL files. This is acceptable for the current test repair work, but production migration planning must reconcile the manifest before deployment.
