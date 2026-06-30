# ATEC Production Environment Checklist

Use this checklist when creating the live environment files on the server.

## Frontend

Create `frontend/.env.production` before building:

```env
VITE_API_URL=https://www.fbcranes.co.za/atec/api
```

Then build:

```powershell
cd D:\Projects\ATEC\frontend
npm run build
```

Copy the contents of `frontend/dist` to the live `public_html/atec` folder.

## Backend

Create `backend/.env` on the production server:

```env
NODE_ENV=production
PORT=5000

DB_HOST=
DB_PORT=5432
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_SCHEMA=atec

FRONTEND_ORIGIN=https://www.fbcranes.co.za
PUBLIC_APP_URL=https://www.fbcranes.co.za/atec
PUBLIC_BASE_PATH=/atec
BACKEND_API_PREFIX=/api
TRUST_PROXY=1

JWT_SECRET=replace-with-a-long-random-production-secret
JWT_EXPIRES_IN=8h

COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_PATH=/atec

UPLOADS_PATH=D:\ATECUploads
PUPPETEER_EXECUTABLE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=ATEC <no-reply@fbcranes.co.za>
```

## Live Verification

After deployment, confirm:

- `https://www.fbcranes.co.za/atec/` opens the login page.
- Refresh/F5 on `https://www.fbcranes.co.za/atec/` still opens the app.
- Login works and sets a secure `atec_session` cookie.
- `https://www.fbcranes.co.za/atec/api/` reaches the backend through the proxy.
- Asset photos load after login.
- A certificate preview opens.
- A single certificate PDF downloads.
- A bulk PDF download works for a small selection.
- Logout clears the session.
