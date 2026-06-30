# ATEC RBAC and Customer Isolation Checklist

Use this checklist before external customer access is enabled.

## Admin

- Can open dashboard, customers, sites, sections, responsible persons, assets, inspections, certificates, reports, equipment criteria, users, and SHE.
- Can create/edit/archive master data.
- Can manage users, roles, LMI numbers, and signatures.
- Can view all certificates and reports.
- Can email certificates.

## Manager

- Can view dashboard, customers, sites, sections, responsible persons, assets, inspections, certificates, reports, and SHE.
- Cannot manage users.
- Cannot edit equipment criteria.
- Cannot perform inspector-only inspection ownership actions unless specifically allowed.
- Can email certificates.

## Inspector

- Can create visual inspections and load tests under their own login.
- Cannot select another inspector.
- Can upload inspection photos.
- Can update only inspections created under their login.
- Can view certificates.
- Can email certificates.

## Viewer

- Can view dashboard, assets, certificates, and allowed read-only pages.
- Cannot create/edit/archive records.
- Cannot upload photos.
- Cannot manage users.
- Cannot email certificates unless explicitly approved later.

## Customer

- Can view only certificates linked to their `clientid`.
- Can view only customer reports linked to their `clientid`.
- Cannot see other customers' assets, photos, certificates, reports, or uploaded files.
- Can email only certificates they are allowed to view.
- Can email certificates only to their own registered email address.

## File Upload Isolation

- Customer users must not access upload files unless the file is linked to their own customer assets or inspections.
- Test direct upload URLs for another customer's asset photo.
- Test direct upload URLs for another customer's inspection photo.
- Test direct upload URLs for another customer's signature image.

## Certificate Isolation

- Test direct URL access to another customer's certificate JSON.
- Test direct URL access to another customer's certificate PDF.
- Test direct URL access to another customer's bulk certificate PDF.
- Test direct URL access to another customer's certificate email endpoint.

## Evidence To Save

- Screenshot of each role menu.
- Screenshot of denied access for restricted pages.
- Screenshot of customer attempting another customer's certificate and receiving Access denied.
- Screenshot or log of successful customer certificate access for own client.
- Audit log rows for login, certificate view, PDF generation, and email.
