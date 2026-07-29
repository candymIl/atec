# Magnetic Particle Inspection Module

## Decision record

ATEC will add Magnetic Particle Inspection (MPI) as the first method in a
dedicated nondestructive testing (NDT) report family.

The module will not store MPI as ordinary equipment-type inspection criteria.
It will reuse ATEC customers, sites, sections, assets, users, access control,
uploads, PDF queueing, customer delivery and audit conventions while preserving
MPI-specific technical records in dedicated tables.

Approved business decisions:

- The FBC286 Revision 1 practical-examination record remains a required output.
- A separate customer outcome report is issued from the same examination.
- An MPI subject may be an existing ATEC asset or an externally identified item.
- If an MT Level 1 technician performs the examination, an active MT Level 2
  user must review and certify it.
- If an MT Level 2 technician performs the examination, the same technician may
  certify the examination without a second signatory.
- The base report number is `MPI-YYYY-NNNNN`.
- `-PE` identifies the practical-examination PDF and `-CR` identifies the
  customer-report PDF. These are output identifiers, not separate examinations.
- Document template control remains `FBC286`, Revision `1`. The template number
  is not used as the individual examination number.

## Outcomes

The primary technical outcome is one of:

- `ACCEPTABLE`
- `REJECTED`
- `INCONCLUSIVE`

The indication summary is one of:

- `NO_RELEVANT_INDICATIONS`
- `RELEVANT_INDICATIONS_ACCEPTABLE`
- `RELEVANT_INDICATIONS_REJECTABLE`
- `EXAMINATION_LIMITED`

The customer report must not describe an item as safe for service unless that
conclusion is separately and explicitly made within the authorized scope.

## Workflow

1. Create a draft MPI examination.
2. Select an ATEC asset or capture an external item.
3. Capture the job, procedure, acceptance standard, material and examination
   scope.
4. Select the performing technician and validate their active MT qualification.
5. Capture technique, preparation, equipment, calibration, consumables and
   pre-use checks.
6. Record no relevant indications or add any number of indication records.
7. Capture diagram positions, photographs, limitations and notes.
8. Review and sign as the performing technician.
9. Route an MT Level 1 examination to an MT Level 2 certifier.
10. Certify and lock the report revision.
11. Generate the practical-examination and customer-report PDFs.
12. Issue the customer report through controlled download, portal or email.

Permitted statuses:

- `DRAFT`
- `READY_FOR_SIGNING`
- `AWAITING_LEVEL_2`
- `RETURNED_FOR_CORRECTION`
- `CERTIFIED`
- `ISSUED`
- `SUPERSEDED`
- `VOID`

Any technical change after a signature invalidates the current approval path and
requires a new signature event. An issued report is corrected by creating a new
revision; the issued revision is not overwritten.

## FBC286-1 field mapping

### Document and report control

| FBC286-1 field | ATEC source | Storage |
| --- | --- | --- |
| Document No | Fixed template metadata | `FBC286` |
| Template Revision | Fixed template metadata | `1` |
| Report No | System generated | NDT report header |
| Examination revision | System generated | NDT report header |
| Date of Test | Inspector entry | NDT report header |
| Practical Exam | Fixed report purpose | NDT report header |

### Customer and subject

| FBC286-1 field | ATEC source | Storage |
| --- | --- | --- |
| Client | Selected ATEC customer | Header snapshot |
| Address | Customer/site or explicit job address | Header snapshot |
| Item description and size | Asset snapshot or external entry | Header snapshot |
| Serial No | Asset snapshot or external entry | Header snapshot |
| Material Specification | Inspector entry | Header |
| Customer/job reference | New digital field | Header |
| Drawing/weld/component reference | New digital field | Header |

An asset link is optional. Final reports use snapshots so later changes to a
customer, asset or site cannot alter an issued report.

### Examination specification

| FBC286-1 field | Digital representation |
| --- | --- |
| Procedure used | Controlled value plus snapshotted display text |
| Acceptance standard | Controlled value plus snapshotted display text |
| Area/s tested | Weld and HAZ, entire surface/casting, or described other area |
| Surface condition | Required text |
| Test coverage | Required scope description |

### Technique and preparation

| FBC286-1 field | Digital representation |
| --- | --- |
| Current type | `AC` or `DC` |
| Particle medium | `WET_INK` or `DRY_POWDER` |
| Viewing method | `VISIBLE_CONTRAST` or `FLUORESCENT` |
| Magnetising method | Initially `CONTINUOUS`; extensible |
| Pre-cleaning | Structured method plus notes |
| White background | Aerosol, bulk-painted, not used, or other |
| Post clean | Yes/no plus method |
| Surface temperature | Numeric Celsius reading |
| Visible-light reading | Numeric lux reading |
| UV-A reading | Numeric microwatts per square centimetre reading |
| Demagnetisation reading | Numeric gauss reading |
| Flux indicator | Type A, type G, not applicable, and observed result |

### Test equipment and calibration

The FBC286 rows are represented as repeatable equipment-usage records:

- AC/DC yoke
- Gauss meter
- Temperature gauge
- Light meter or radiometer
- Visible light source or UV-A lamp
- 4.5 kg or 18.1 kg lift weight
- Flux indicator strip

Each usage snapshots:

- equipment type
- manufacturer
- model
- serial number
- calibration or verification due date
- certificate number
- reading and unit
- verification result
- whether it was compliant on the examination date

The master equipment record and its calibration history remain independently
maintainable. Issued reports use the usage snapshot.

### Consumables

The cleaner/remover, magnetic ink and white background are repeatable usage
records with:

- consumable type
- manufacturer
- product name/code
- batch number
- expiry date
- compliant-at-test flag

Expired required consumables block certification.

### Yoke pre-use checks

The following required checks store `YES`, `NO` or `NOT_APPLICABLE`, a result
note and the applicable limit snapshot:

1. Plastic casing/body has no cracks.
2. Power cable has no loose strands or exposed wires.
3. Plug is not damaged, broken or improperly repaired.
4. Switch releases correctly and the dust cover is in place.
5. Lift test meets the AC or DC requirement.
6. Legs/poles are easily adjustable.
7. Legs/poles provide suitable flat contact areas.

A failed required check blocks certification unless the examination is marked
inconclusive and the reason is recorded.

### Indications and defect plotting

The paper limit of seven rows per page is not a system limit. Each indication
stores:

- sequence number
- examined area
- datum description
- distance from datum in millimetres
- datum direction/side
- distance from weld centreline in millimetres
- centreline side
- length and width in millimetres
- suggested classification
- technician-confirmed classification
- relevance
- code disposition
- description
- diagram number
- normalized diagram X/Y coordinates

Width is added because the form defines linear and rounded indications using the
length-to-width relationship.

### Notes, limitations and controlled wording

Limitations and technical notes are stored separately. If examination coverage
or yoke contact is incomplete, limitations are mandatory and the outcome cannot
be `ACCEPTABLE` without an authorized, recorded justification.

The FBC286 definitions and NDT disclaimer are versioned report-template text,
not inspector-entered fields.

### Signatures and qualifications

The performing user and certifying user are linked to ATEC users. Every
signature event snapshots:

- full name
- method and level
- qualification scheme
- certificate number
- qualification expiry
- signature image
- role in the report
- signing time
- report revision and record hash

The conditional approval rule is enforced by the backend and database-supported
workflow, not only by the interface.

## Report numbering and revisions

The number allocator maintains an independent counter for each calendar year
and formats the result as `MPI-YYYY-NNNNNN`.

Examples:

- Base examination: `MPI-2026-000001`
- Practical examination output: `MPI-2026-000001-PE`
- Customer report output: `MPI-2026-000001-CR`
- Corrected customer output: `MPI-2026-000001-CR, Rev 1`

Numbers are never reused. Voided reports retain their allocated number.

## Output requirements

### Practical-examination report

The practical-examination PDF follows the FBC286-1 content order and includes
all technical details, equipment, consumables, checks, indication tables,
diagrams, limitations, notes and applicable signatures. Additional indication
pages are generated automatically.

### Customer outcome report

The customer PDF contains:

- controlled report identity and revision
- customer and subject identification
- examination scope and date
- procedure and acceptance standard
- concise technique summary
- findings summary
- limitations
- primary outcome and indication summary
- technician and required certifier details
- issue date and supersession information

## Access rules

- Administrators manage qualification, equipment, calibration and consumable
  master data.
- Managers may manage master data and view all MPI reports.
- Inspectors may create and edit their permitted draft examinations.
- Only a suitably qualified performing technician may sign the technician step.
- Only an active MT Level 2 user may complete a required Level 2 certification.
- Customers may view only issued customer reports belonging to their customer
  account.
- Practical-examination reports remain internal unless explicitly released by
  an authorized ATEC user.

## Validation and acceptance tests

Minimum regression cases:

- Existing ATEC asset and external item examinations.
- MT Level 1 routes to Level 2 and cannot self-issue.
- MT Level 2 can perform and certify without a second signatory.
- Expired/inactive qualifications block signing or certification.
- Expired equipment calibration and consumables block certification.
- Failed yoke checks prevent an acceptable outcome.
- No relevant indications produces no empty continuation page.
- Multiple indications flow onto additional PDF pages.
- Diagram coordinates and attached evidence remain tied to the correct finding.
- Signed data changes invalidate the prior approval.
- Issued revisions are immutable and supersession retains both revisions.
- Customer access is limited to the customer outcome report and correct tenant.
- Report numbers remain unique under concurrent creation.

