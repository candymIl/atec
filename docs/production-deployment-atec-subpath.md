# ATEC Production Deployment Under /atec

ATEC is intended to run at:

https://www.fbcranes.co.za/atec

Your WordPress website can remain at the main domain. ATEC will run from the `public_html/atec` folder.

## Frontend Build

Create `frontend/.env.production`:

```env
VITE_API_URL=https://www.fbcranes.co.za/atec/api
```

Build the frontend:

```powershell
cd D:\Projects\ATEC\frontend
npm run build
```

The Vite base path is `/atec/`, so the generated CSS and JavaScript assets are referenced under `/atec/`.

Upload the contents of `frontend/dist` into:

```text
public_html/atec
```

Upload the contents inside `dist`, not the `dist` folder itself.

The frontend build includes `.htaccess` and `web.config` files for refresh/F5 fallback. On cPanel/Apache, `.htaccess` is the important one.

## Backend Environment

Production backend environment:

```env
NODE_ENV=production
PORT=5000

FRONTEND_ORIGIN=https://www.fbcranes.co.za
PUBLIC_APP_URL=https://www.fbcranes.co.za/atec
PUBLIC_BASE_PATH=/atec
BACKEND_API_PREFIX=/api
TRUST_PROXY=1

COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_PATH=/atec

JWT_SECRET=replace-with-a-strong-random-secret-at-least-32-characters

UPLOADS_PATH=/home/fbcranesco/atec-uploads
PUPPETEER_EXECUTABLE_PATH=

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=ATEC <no-reply@fbcranes.co.za>
```

Keep database values private in the real production `.env`.

## cPanel Node App Requirement

The static frontend in `public_html/atec` is only the screen/app shell. The backend must also run as a Node.js application.

In cPanel, use **Setup Node.js App** if available:

- Application root: the uploaded ATEC backend folder.
- Application startup file: `server.js`.
- Application URL/URI: ideally `/atec/api`.
- Node environment: production.
- Run `npm install` in the backend app folder.
- Add the backend `.env` values above.

If cPanel cannot mount Node.js under `/atec/api`, hosting support must configure a reverse proxy so:

- `/atec/api/` goes to the Node backend.
- `/atec/api/uploads/` or `/atec/uploads/` reaches the backend upload route.
- The backend itself is not directly exposed on a public port.

## Reverse Proxy Shape

Configure the web server so:

- `/atec/` serves the built frontend files from `public_html/atec`.
- `/atec/api/` proxies to the Node backend.
- Refresh/F5 on any `/atec` frontend route falls back to `public_html/atec/index.html`.

The backend can accept stripped paths such as `/auth/login` or mounted paths such as `/atec/api/auth/login` and `/api/auth/login`.

Ready-to-copy examples are included in:

- `deployment/iis/web.config.example`
- `deployment/nginx/atec.conf.example`
- `deployment/apache/atec.conf.example`
- `deployment/cpanel-public-html-root-redirect.htaccess.example`
- `deployment/production-env-checklist.md`

If old bookmarks or browser history still use `/Atec`, add the optional redirect rule from `deployment/cpanel-public-html-root-redirect.htaccess.example` to the main `public_html/.htaccess` file above the WordPress rules. This redirects `/Atec` to `/atec`.

## Example Nginx Shape

```nginx
location /atec/api/ {
  proxy_pass http://127.0.0.1:5000/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
}

location /atec/ {
  alias /home/fbcranesco/public_html/atec/;
  try_files $uri $uri/ /atec/index.html;
}
```

## Live Test

After upload/configuration, confirm:

- `https://www.fbcranes.co.za/atec/` opens the ATEC login page.
- Refresh/F5 on `https://www.fbcranes.co.za/atec/` still opens ATEC.
- `https://www.fbcranes.co.za/atec/api/` returns `ATEC backend is running`.
- Login works.
- Asset photos load after login.
- Certificate preview opens.
- Single PDF download works.
- Bulk PDF download works for a small selection.
