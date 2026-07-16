# NFC Asset Support

## Architecture

NFC support uses standards-based NDEF URI tags. A tag stores only an HTTPS URL to the ATEC web app in the form `/?nfc=<opaque-token>`. The web app opens in the browser, authenticates the user if needed, and then resolves the token through the authenticated API.

QR codes remain unchanged. Existing QR labels continue to use the existing `?qr=` flow and `ATEC-ASSET-<assetid>` identifier. NFC uses a separate random token so it can be rotated or revoked without invalidating existing QR labels.

## Security Model

The NFC chip must not store customer names, serial numbers, inspection results, credentials, session cookies, or bearer tokens. It stores only the generated HTTPS URL.

NFC tokens are random, unique, non-sequential values stored in `atec.tblasset.nfc_token`. Public guessing is minimized by validating token format, rate limiting lookup, returning a generic not-found message, and requiring authentication before asset details are shown.

Archived assets can be resolved by an authorized user, but inspection actions are disabled. Revoked or disabled NFC tokens do not resolve to asset details.

## NFC Versus QR

QR labels are preserved for camera scanning and printed labels. NFC is an additional tap workflow for supported phones and tablets. Rotating or revoking NFC does not affect QR because the identifiers are separate.

## Tag Guidance

Use NFC Forum Type 2 or Type 4 tags with enough memory for a short HTTPS URL. NTAG213 is usually sufficient for short URLs; NTAG215 or NTAG216 provides more margin.

For cranes, lifting equipment, workshops, and steel environments, use anti-metal NFC tags or an approved spacer. Standard tags placed directly on steel can be unreadable.

Place tags where they are reachable, protected from impact, not hidden behind metal, and visibly associated with the correct asset.

## Writing Procedure

1. Open the asset in ATEC as an Admin or Manager.
2. Generate the NFC URL.
3. Copy the URL.
4. Write it as an NDEF URI record using an approved Android NFC-writing app.
5. Test the tap while logged in.
6. Test the tap while logged out and confirm login returns to the asset.
7. Confirm the physical tag is on the correct asset.
8. Lock the tag read-only only after successful testing.

Do not permanently lock a tag before testing.

## Replacement And Revocation

Use Replace Token when a tag is lost, damaged, or replaced. Existing written tags for that asset stop working and a new URL must be written.

Use Revoke NFC when NFC access should be disabled. QR labels continue to work.

## Permissions

Admins and Managers can generate, rotate, revoke, copy, and preview NFC URLs. Inspectors, Viewers, and Customers cannot manage NFC tokens. Server-side authorization enforces this.

## Scan Experience

Authenticated authorized users see asset identity, customer, site, section, equipment type, asset tag, serial number, current archived status, recent visual and load-test history, quick inspection actions, QR label access, and NFC status where permitted.

Unauthenticated users are shown the login page and remain on the NFC URL. After login, the app opens the requested asset. Unauthorized users see access denied or a safe unavailable message without customer details.

## Audit Logging

The backend records safe audit events for NFC token issue, rotation, revocation, scans, denied scans, and archived asset taps. Full tokens are not written to audit details; token values are masked.

## Database Changes

The migration `database/2026-07-15-task13-nfc-asset-support.sql` adds:

- `nfc_token`
- `nfc_enabled`
- `nfc_issued_at`
- `nfc_revoked_at`
- `nfc_last_scanned_at`
- `nfc_scan_count`

It also adds a unique partial index for active non-null NFC tokens. The migration is idempotent and includes read-only audit queries and rollback guidance.

## Testing

Run:

```sh
npm run test:task13
npm run test:task7
npm run test:task9
npm run test:task10
npm run test:task11
npm run test:task12-framework
npm run test:task12a
npm run test:task12b
npm run test:task12c
npm --prefix frontend run build
node --check backend/server.js
node --check frontend/src/main.js
```

## Deployment

Production deployment must be done only after review. Apply the migration first, deploy backend and frontend together, then smoke-test QR and NFC lookup.

NOT EXECUTED:

```sh
psql "$DATABASE_URL" -f database/2026-07-15-task13-nfc-asset-support.sql
npm --prefix frontend run build
```

## Rollback

Disable NFC in the UI and API first if needed. The migration file contains rollback SQL to drop the NFC indexes and columns. QR labels do not depend on NFC columns.

## Known Limitations

The first release does not write NFC tags from the browser and does not use NFC hardware UIDs. Mobile compatibility depends on the phone and tag-writing app. The web app only needs the URL opened by the operating system.
