# Milestone 1 Manual Review Queue

Generated during ATEC Work Package 1 against the approved Atlas test database.

## Asset Hierarchy

- `128` assets still have null section assignments.
- `26` of those also lack sufficient valid site data.
- `102` have a valid current site/customer context but no authoritative section target.
- Required decision: identify the correct section from source records, inspection/import evidence or business owner confirmation. Do not infer from names or neighbouring assets.

Examples:

- Category F: `60376`, `60377`, `60378`, `60379`, `60380`, `60381`
- Category H: `59771`, `60582`, `63576`, `63577`, `63578`, `63579`

Risk: High for missing site/section parent data; Medium for valid-site/no-section records.

## Inspection Integrity

- `75` inspections still lack signature snapshots after deterministic repair.
- `2` inspections still lack LMI snapshots and have no inspector user link.
- `144` inspections have no result rows.
- `0` inspections currently have `SAFE` status with failed result rows.

Required decision: classify no-result inspections as draft, abandoned, imported header, valid missing results, duplicate shell, or unknown. Do not generate result rows without an authoritative source.

Risk: High for certificate/audit completeness.

## Equipment Type 105

- Equipment type `105` (`Hoists - Electric rope hoist`) has no criteria.
- It is used by `2` active assets.
- It has no inspection history in the current test database.

Required decision: approve criteria, retire/remap type usage, or block inspection creation for this type until criteria are approved.

Risk: Medium until inspections are attempted; High if operationally used without criteria.

## Asset Tags

- Blank asset tags are historically allowed and remain blank.
- Active nonblank tags currently have no customer-scoped duplicates.
- A partial unique index now prevents future duplicate active nonblank tags per customer.

Required decision: confirm whether nonblank asset tags should remain customer-scoped or become globally unique.

Risk: Low after safeguard; business policy still needed.

## Master Data

- Blank site: `siteid 801`, customer `368`, no active assets.
- Duplicate active responsible-person name groups: `0`.
- Unassigned active people: `72`.
- Archived parent asset inconsistencies: `0`.

Required decision: confirm whether blank site `801` should be named, archived, or retained. Classify unassigned people as historical, valid contact, duplicate candidate, inspector/user, or legacy orphan.

Risk: Medium.

## Migration Governance

- Ledger remains partial: 9 tracked migrations and many untracked SQL files.
- Do not mark unverified files as applied.

Risk: Medium for production planning.
