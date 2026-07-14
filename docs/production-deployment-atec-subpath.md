# ATEC Production Deployment

ATEC is currently deployed at the root of:

```text
https://www.atecinspections.co.za/
```

Do not use `/atec/` as the production frontend base path. Older notes in this repository may describe a retired subpath deployment shape.

## Frontend Build

Create `frontend/.env.production` on the Ubuntu production server:

```env
VITE_API_URL=https://www.atecinspections.co.za/api
VITE_BASE_PATH=/
```

Build on Ubuntu:

```bash
cd /var/www/atec/ATEC/frontend
npm ci
npm run build
```

Publish the contents of `frontend/dist` to the web root serving `https://www.atecinspections.co.za/`.

## Backend Environment

Production backend environment:

```env
NODE_ENV=production
PORT=5000

FRONTEND_ORIGIN=https://www.atecinspections.co.za
PUBLIC_APP_URL=https://www.atecinspections.co.za
PUBLIC_BASE_PATH=/
BACKEND_API_PREFIX=/api
TRUST_PROXY=1

COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_PATH=/

JWT_SECRET=replace-with-a-strong-random-secret-at-least-32-characters

UPLOADS_PATH=/var/www/atec/ATEC/backend/uploads
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=ATEC <no-reply@atecinspections.co.za>
```

Keep database values private in the real production `.env`.

## Reverse Proxy Shape

Configure the Ubuntu web server so:

- `/` serves the built frontend.
- `/api/` proxies to the Node backend.
- `/uploads/` proxies to authenticated backend uploads.
- Refresh/F5 on frontend routes falls back to `/index.html`.

The backend can accept stripped paths such as `/auth/login` or mounted paths such as `/api/auth/login`.

Ready-to-copy examples are included in:

- `deployment/nginx/atec.conf.example`
- `deployment/apache/atec.conf.example`
- `deployment/production-env-checklist.md`

## Example Nginx Shape

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:5000/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
}

location / {
  root /var/www/atec/public;
  try_files $uri $uri/ /index.html;
}
```

## Live Test

After upload/configuration, confirm:

- `https://www.atecinspections.co.za/` opens the ATEC login page.
- Refresh/F5 on `https://www.atecinspections.co.za/` still opens ATEC.
- `https://www.atecinspections.co.za/api/` returns `ATEC backend is running`.
- `https://www.atecinspections.co.za/api/admin/system-info` returns detailed System Health JSON for an Admin session.
- Login works.
- Asset photos load after login.
- Certificate preview opens.
- Single PDF download works.
- Bulk PDF download works for a small selection.
