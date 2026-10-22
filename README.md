# Finance & Collection Office

Tuition assessment, payment processing, and transaction ledger for a real
accounting workstation. This project is built with Node.js, Express, and
SQLite and is designed to behave like a live finance office system rather
than a static demo mock-up.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:4000**

The app opens directly without a login screen.

## Production notes

- The backend, database, validation, duplicate-O.R. rejection, and every API
  response are real — the frontend never fakes data locally.
- Authentication is disabled. Anyone who can reach the app can view and
  modify its finance records; keep it on a trusted network only.
- Student lookups use the IT Department Hub at
  `https://it-department-hub.onrender.com`. Set `IT_DEPARTMENT_HUB_URL` in
  Render only if the Hub's canonical address changes.
- The documented profile-read endpoint is public, so no API key is sent.
  Do not put the key in source code; configure it as a Render secret only if
  the IT Department provides an authenticated endpoint and specifies its
  required header.
- The Hub guide documents student reads but not an endpoint for posting
  payments to student dashboards. Payments remain in Finance until the IT
  Department provides that write endpoint and its request contract.

## Discounts — scholarships & employee dependents

Each seeded student carries a `discount_eligibility` field (as Finance would
receive it synced from Registrar/HR). When you look up a student who's
eligible, the form auto-fills the matching discount type and percentage and
shows a verification hint — the cashier still has to confirm supporting
documents before committing.

Built-in discount types (`src/routes/transactions.js` → `DISCOUNT_TYPES`):

| Type | Typical % |
|---|---|
| Academic Scholarship — Full | 100% |
| Academic Scholarship — Partial | 50% (editable) |
| Working Scholar | 50% (editable) |
| Employee Dependent (Parent/Guardian CSFJ Staff) | 50% (editable) |
| Sibling Discount | 10% (editable) |
| Other / Manual | 0% (cashier sets it) |

The percentage field is always editable — presets are a starting point, not
a hard rule. The **server** recomputes `discountAmount` and the net `amount`
from `grossAmount × discountPercent` on every commit (never trusts the
client's math), and rejects anything outside 0–100% or a non-zero percent
paired with discount type `None`. The ledger, stats, and `/api/sync/summary`
all total the **net** amount actually collected, with `gross_amount` and
`discount_amount` kept alongside every transaction for audit purposes.

To add a new discount category, add it to the `DISCOUNT_TYPES` array in
`src/routes/transactions.js` and to the `<select id="f-discountType">`
options and `DEFAULT_DISCOUNT_PERCENT` map in `public/index.html` /
`public/app.js`.

## Printing receipts

After committing a transaction, the form shows **ðŸ–¨ Print Receipt** instead
of resetting immediately — click it to open a print-ready receipt in a new
window (auto-triggers the browser's print dialog; pop-ups must be allowed).
Every past transaction can also be reprinted from the Ledger — each row has
a ðŸ–¨ icon next to the void button. The printable receipt is built entirely
client-side in `printReceipt()` in `public/app.js` from the transaction
object the API returns, so it always reflects the exact committed record
(gross amount, discount, net amount, both sign-off names).

## API surface

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/students/:query` | Verify identity/program/status before payment |
| GET | `/api/transactions` | Ledger list, `?search=` and `?status=` filters |
| GET | `/api/transactions/:id` | One transaction |
| GET | `/api/transactions/balance/:studentNo` | Payment status Enrollment/Registrar check |
| POST | `/api/transactions` | Validate → commit a new payment |
| PATCH | `/api/transactions/:id/void` | Void an active transaction |
| GET | `/api/students` | List all students (Manage Students screen) |
| DELETE | `/api/students/:studentNo` | Remove a student record (transaction history is untouched) |
| POST | `/api/sync/enrollment` | Record an official enrollment from the combined Enrollment system |
| GET | `/api/sync/summary` | Approved summary synced to the Central Server |

O.R. numbers are generated sequentially by the server when a transaction is
committed; staff do not need to enter or request a number. The ledger's **Expected transactions** count is the number of transaction
records already in the ledger plus each officially enrolled student/term that
does not yet have a non-voided transaction. The combined Enrollment system
should send a JSON request to `POST /api/sync/enrollment` with
`{ "studentNo": "...", "term": "1st Sem, S.Y. 2025-2026" }`. Repeated events
for the same student and term are idempotent, and a committed transaction
reduces the outstanding expected count. The ledger refreshes this figure
automatically every 30 seconds.

Transactions require a successful student lookup. If the student is not found,
verify the student number with Registrar before recording payment.

## Swapping SQLite for MySQL

Every route only calls the functions exported from `src/db.js`. To move to
MySQL (as named in the proposal's tech stack), replace that file's
`node:sqlite` calls with a `mysql2`/Prisma client exposing the same
`db.prepare(...).get/all/run` shape, or refactor the two route files to use
your ORM directly — the schema (`students`, `transactions`) carries over
unchanged.

## Transaction IDs

Every committed transaction gets a sequential, human-readable ID —
`COL000001`, `COL000002`, and so on — instead of a random string, so it's
easy to write on a receipt book or reference by hand. The counter is stored
in a `counters` table (not just `COUNT(*)` on transactions), so numbering
stays gapless and never collides even after transactions are voided or the
server restarts. If you're upgrading a database that already has old
random-style IDs, new transactions simply continue with `COL000001`
onward — old IDs aren't renumbered.

To change the prefix or digit count, edit `ID_PREFIX` / `ID_DIGITS` in
`src/db.js`.

## Project structure

```
finance-system/
  server.js              Express app, route wiring
  src/
    db.js                 SQLite schema + seed data
    routes/
      students.js          Registrar-style lookup
      transactions.js       Validate/commit/void/balance
      sync.js               Central Server summary
  public/                 Static frontend (HTML/CSS/JS, navy & gold theme)
    index.html
    styles.css
    app.js
  data/finance.db          Created on first run (gitignored)
```
