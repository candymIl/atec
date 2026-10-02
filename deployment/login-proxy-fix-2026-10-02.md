# Login lockout repair — 2 October 2026

Jacques approved the proposed login repair for main ATEC and South Deep.

Root cause: production TRUST_PROXY defaults to string "1"; Express interprets that as an address rather than the numeric one-hop policy. Verified proxy-addr.compile("1") does not trust 127.0.0.1. With Nginx on loopback, unrelated users shared the same default login limiter counter (10 requests per 15 minutes). The limiter also counted successful sign-ins. Morning Nginx logs showed successful logins followed by 429 responses across different client addresses.

Changes: proxyTrust.js normalizes numeric and boolean strings; server.js passes the resulting numeric policy to Express. Login limiter adds skipSuccessfulRequests:true. Failed attempts remain limited per client IP. Shared email/username selection is unchanged; a read-only account lookup found one active account for Jacques's email.

Applied targeted replacements to both deployed server.js files, preserving their site-specific settings. Backups: server.js.before-login-proxy-20261002 in each backend directory. Main path /var/www/atec/ATEC/backend; South Deep path /var/www/atec-south-deep/releases/20260929-accelo-actions/app/backend. Restarted atec-backend and atec-southdeep to clear incorrect in-memory counters. No database changes or credential changes.

Verification: local HTTP regression passed 12 successful logins, 10 allowed failures, the next failure returning 429, and an independent client still succeeding with its own forwarded IP. Six shared-email tests passed. Syntax/whitespace checks passed. Both live application configurations reported proxyTrust numeric 1, loopback trusted, second hop untrusted. Both public health endpoints returned status ok. Actual user login confirmation remains pending; no user passwords were used for testing.

Git commit/push remains pending. Live server.js files contain the targeted hotfix; reconcile with the eventual committed source before the next deploy-live.sh run.
