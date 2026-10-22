// src/db.js
// Persistence layer for the Finance System.
// Uses Node's built-in `node:sqlite` for local deployment and can be replaced
// with a MySQL or Prisma-backed implementation in production without changing
// the route interfaces.

import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "finance.db");

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    student_no          TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    program              TEXT NOT NULL,
    year_level           TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'Active',
    discount_eligibility TEXT NOT NULL DEFAULT 'None'
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id               TEXT PRIMARY KEY,
    student_no       TEXT NOT NULL,
    student_name     TEXT NOT NULL,
    program          TEXT NOT NULL,
    fee_type         TEXT NOT NULL,
    gross_amount     REAL NOT NULL DEFAULT 0,
    discount_type    TEXT NOT NULL DEFAULT 'None',
    discount_percent REAL NOT NULL DEFAULT 0,
    discount_amount  REAL NOT NULL DEFAULT 0,
    amount           REAL NOT NULL, -- net amount actually collected
    method           TEXT NOT NULL,
    or_number        TEXT NOT NULL,
    term             TEXT NOT NULL,
    processed_by     TEXT NOT NULL DEFAULT '',
    verified_by      TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'Pending', -- Paid | Pending | Voided
    created_at       TEXT NOT NULL,
    FOREIGN KEY (student_no) REFERENCES students(student_no)
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    student_no TEXT NOT NULL,
    term       TEXT NOT NULL,
    enrolled_at TEXT NOT NULL,
    PRIMARY KEY (student_no, term)
  );

  CREATE INDEX IF NOT EXISTS idx_tx_or_number ON transactions(or_number);
  CREATE INDEX IF NOT EXISTS idx_tx_student ON transactions(student_no);
`);

// ---------------------------------------------------------------
// MIGRATIONS
// `CREATE TABLE IF NOT EXISTS` above only runs once — if this project was
// downloaded and run before, then re-downloaded after a schema change, the
// existing data/finance.db file keeps its OLD columns forever, and any
// INSERT referencing a new column throws (surfacing as a 500 in the app).
// This adds any columns that are missing from an existing local database
// without touching existing rows.
// ---------------------------------------------------------------
function ensureColumns(table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, ddl] of Object.entries(columns)) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
      console.log(`Migrated: added ${table}.${name}`);
    }
  }
}

ensureColumns("students", {
  discount_eligibility: "TEXT NOT NULL DEFAULT 'None'",
});

ensureColumns("transactions", {
  gross_amount: "REAL NOT NULL DEFAULT 0",
  discount_type: "TEXT NOT NULL DEFAULT 'None'",
  discount_percent: "REAL NOT NULL DEFAULT 0",
  discount_amount: "REAL NOT NULL DEFAULT 0",
  processed_by: "TEXT NOT NULL DEFAULT ''",
  verified_by: "TEXT NOT NULL DEFAULT ''",
});

// Backfill: any pre-existing transaction rows from before gross_amount
// existed had their fee stored in `amount` with no gross/discount split.
// Treat those as gross == net, 0% discount (already the column defaults),
// but gross_amount defaulted to 0 above — copy amount into it so old rows
// don't display "Gross: ₱0.00".
db.exec(`UPDATE transactions SET gross_amount = amount WHERE gross_amount = 0 AND amount > 0`);

// ---------------------------------------------------------------
// TRANSACTION ID SEQUENCE
// Human-readable, sequential IDs like COL004074 instead of random hex —
// easier to write on a physical receipt book / cross-reference by hand.
// Backed by a real counter row so numbers stay unique and gapless even
// after transactions are voided (voided rows are never deleted).
// ---------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );
`);

const ID_PREFIX = "COL";
const ID_DIGITS = 6; // COL000001 .. COL999999

(function initTransactionCounter() {
  const existing = db.prepare("SELECT value FROM counters WHERE name = 'transaction_id'").get();
  if (existing) return;

  // First run against a database that may already have COL-formatted ids
  // (e.g. re-seeded) — resume from the highest one found instead of
  // restarting at 0 and risking a collision.
  const rows = db.prepare(`SELECT id FROM transactions WHERE id LIKE '${ID_PREFIX}%'`).all();
  let maxNum = 0;
  const pattern = new RegExp(`^${ID_PREFIX}(\\d+)$`);
  for (const r of rows) {
    const m = pattern.exec(r.id);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  db.prepare("INSERT INTO counters (name, value) VALUES ('transaction_id', ?)").run(maxNum);
})();

export function nextTransactionId() {
  db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'transaction_id'").run();
  const { value } = db.prepare("SELECT value FROM counters WHERE name = 'transaction_id'").get();
  return `${ID_PREFIX}${String(value).padStart(ID_DIGITS, "0")}`;
}

const OR_PREFIX = "OR-";
const OR_DIGITS = 6;

(function initOrNumberCounter() {
  const existing = db.prepare("SELECT value FROM counters WHERE name = 'or_number'").get();
  if (existing) return;

  const rows = db.prepare("SELECT or_number FROM transactions").all();
  let maxNum = 0;
  const pattern = new RegExp(`^${OR_PREFIX}(\\d+)$`);
  for (const row of rows) {
    const match = pattern.exec(row.or_number);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  db.prepare("INSERT INTO counters (name, value) VALUES ('or_number', ?)").run(maxNum);
})();

export function nextOrNumber() {
  db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'or_number'").run();
  const { value } = db.prepare("SELECT value FROM counters WHERE name = 'or_number'").get();
  return `${OR_PREFIX}${String(value).padStart(OR_DIGITS, "0")}`;
}

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM students").get().n;
  if (count > 0) return;

  const insertStudent = db.prepare(
    `INSERT INTO students (student_no, name, program, year_level, status, discount_eligibility) VALUES (?, ?, ?, ?, ?, ?)`
  );

  const students = [
    ["CSFJ-2023-0114", "Aike Steven Llagas", "BSIT", "3rd Year", "Active", "None"],
    ["CSFJ-2023-0089", "Prince William Perez", "BSIT", "3rd Year", "Active", "Working Scholar"],
    ["CSFJ-2024-0201", "Gabriela Emong", "BSIT", "2nd Year", "Active", "Employee Dependent (Parent/Guardian CSFJ Staff)"],
    ["CSFJ-2022-0045", "Mary Queen Arlante", "BSED", "4th Year", "Active", "Academic Scholarship — Full"],
    ["CSFJ-2023-0177", "Christel Faith Nagal", "BSED", "3rd Year", "Active", "Sibling Discount"],
    ["CSFJ-2024-0033", "Leahmar Tagupa", "BSBA", "2nd Year", "Active", "None"],
    ["CSFJ-2021-0009", "Danilo Macaraeg", "BSIT", "4th Year", "On Leave", "Academic Scholarship — Partial"],
  ];

  for (const s of students) insertStudent.run(...s);

  console.log(`Seeded ${students.length} students into finance.db`);
}

// Allow `npm run seed` to reseed on demand.
if (process.argv.includes("--seed")) {
  db.exec("DELETE FROM students");
  seed();
}

export default db;
