# Certificate PDF recovery — 1 October 2026

Jacques approved targeted live temporary-file cleanup and a permanent fix.

Cause: the 2 GB /tmp tmpfs was full, with 1.9 GB of Snap Chromium PDF profiles and browser temporary files. Renderer cleanup removed the outer /tmp profile while Snap retained the private counterpart. Logs recorded printToPDF failures, 120-second engine timeouts and Nginx 504s (180-second proxy timeout).

Cleanup was restricted to atec-pdf-*, org.chromium.Chromium.* and puppeteer_dev_chrome_profile-* directories directly inside /tmp/snap-private-tmp/snap.chromium/tmp, after checking no Chromium process was running. /tmp fell to 54 MB / 3% used.

Permanent change: certificateRenderer.js now places Snap profiles in /root/snap/chromium/common/atec-pdf on disk-backed storage, sets browser temporary environment paths to the profile, disables background/component downloads, and removes each profile in finally. Non-Snap platforms retain ordinary temporary profile behavior.

Only the certificate renderer was replaced on main ATEC; backend restarted. Backup: /var/www/atec/ATEC/output/certificateRenderer-before-20261001.js. Installed/local SHA256: 1fa9f4a706ee5b6f396d8ba5d72d4eb3f36638fa5ddcede76bd3ec8cd4ea8549. Existing live HEAD: 3b0d2faa; this targeted repair is a working-tree change, not a new deployed Git commit. No database migration.

Verification:
- Local syntax, certificate measurement regression, profile placement/failure cleanup regression and diff whitespace checks passed.
- Authenticated live certificate 92592 PDF returned HTTP 200, 408452 bytes, backend duration 2362 ms.
- Two-certificate bulk PDF (92592, 92599) returned HTTP 200, 693270 bytes.
- After both requests, profile directory contained zero profiles; Snap private temporary directory used zero bytes; /tmp remained 3% used.
- Public and loopback health returned status ok.

Large bulk batches and long-term retention are not separately load-tested. Snap/renderer crashes can still leave disk-backed profiles, but normal success and handled failure cleanup are covered. South Deep renderer was not deployed separately.
