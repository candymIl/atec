# ATEC 10-User Read-Only Performance Test

This folder contains a guarded k6 script for a first-pass, read-only ATEC concurrency test.

The script defaults to localhost and refuses to run against a non-local URL unless
`ALLOW_NON_LOCAL_TARGET=true` is set. Do not run this against production without a
separate approval.

## Install k6

Ubuntu:

```bash
sudo gpg -k
curl -s https://dl.k6.io/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update
sudo apt install k6
```

Windows:

```powershell
winget install k6.k6
```

## Required Test Session Cookie

Log in to a local or approved test ATEC environment and copy the auth cookie value
from the browser developer tools.

Pass it as an environment variable:

```bash
export ATEC_AUTH_COOKIE='atec_auth=replace-with-test-cookie'
```

Do not commit real cookies, passwords, usernames, or tokens.

## Safe Localhost Test Command

From the repository root:

```bash
k6 run scripts/performance/atec-10-user-readonly.js
```

PowerShell:

```powershell
$env:ATEC_AUTH_COOKIE = 'atec_auth=replace-with-test-cookie'
k6 run scripts/performance/atec-10-user-readonly.js
```

The default target is:

```text
http://127.0.0.1:5000
```

If the backend is mounted below `/api`, use:

```bash
API_PREFIX=/api k6 run scripts/performance/atec-10-user-readonly.js
```

## Approved Non-Local Test Environment

Only for a separately approved test environment:

```bash
BASE_URL=https://test.example.com \
API_PREFIX=/api \
ALLOW_NON_LOCAL_TARGET=true \
ATEC_AUTH_COOKIE='atec_auth=replace-with-test-cookie' \
k6 run scripts/performance/atec-10-user-readonly.js
```

## What The Script Exercises

- Dashboard stats and summary widgets
- Asset list search
- Inspection asset picker search
- Asset quick details when a searched asset is returned
- Certificate search

It does not create inspections, modify assets, upload files, send email, or generate
bulk PDFs.

## Suggested Acceptance Targets

- API error rate: less than 1%
- Average API response time: less than 500 ms
- p95 API response time: less than 1,500 ms
- Database connection failures: 0
- Node process memory: stable during the hold period
- CPU: short bursts are acceptable; sustained saturation is not

## Ubuntu Monitoring During An Approved Test

CPU:

```bash
top -o %CPU
mpstat 1
```

Memory:

```bash
free -h
vmstat 1
```

Node process:

```bash
ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%cpu | grep node
pm2 monit
pm2 logs --lines 100
```

PostgreSQL connections:

```sql
SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = 'fbcranes'
GROUP BY state
ORDER BY state;
```

Active PostgreSQL queries:

```sql
SELECT pid,
       now() - query_start AS runtime,
       wait_event_type,
       wait_event,
       left(query, 240) AS query
FROM pg_stat_activity
WHERE datname = 'fbcranes'
  AND state <> 'idle'
ORDER BY runtime DESC;
```

Slow query watch:

```sql
SELECT pid,
       now() - query_start AS runtime,
       left(query, 500) AS query
FROM pg_stat_activity
WHERE datname = 'fbcranes'
  AND state = 'active'
  AND now() - query_start > interval '2 seconds'
ORDER BY runtime DESC;
```
