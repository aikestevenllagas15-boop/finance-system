// public/app.js
// Every action here is a real fetch() call against the Express API in
// server.js — no mock data, no localStorage-as-a-database.

import { buildReceiptHtml, createReceiptPdf } from "./receipt.js";

const API = location.protocol === "file:" ? "http://localhost:4000" : "";
let currentStudent = null; // { student_no, name, program, year_level, status, discount_eligibility } | null
let reviewLocked = false; // true once "Review Transaction" has validated
let lastCommittedTx = null;

const DEFAULT_DISCOUNT_PERCENT = {
  "None": 0,
  "Academic Scholarship — Full": 100,
  "Academic Scholarship — Partial": 50,
  "Working Scholar": 50,
  "Employee Dependent (Parent/Guardian CSFJ Staff)": 50,
  "Sibling Discount": 10,
  "Other / Manual": 0,
};

const $ = (sel) => document.querySelector(sel);
const peso = (n) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toast(msg, kind = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed");
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function enterApp() {
  loadLedger();
  loadStudents();
}

/* ---------------- HEADER DATE ---------------- */
$("#header-date").textContent = new Date()
  .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  .toUpperCase();

enterApp();

/* ---------------- STUDENT LOOKUP (real GET /api/students/:query) ---------------- */
$("#lookup-btn").addEventListener("click", async () => {
  const q = $("#f-studentNo").value.trim();
  if (!q) return;
  $("#lookup-notfound").classList.add("hidden");
  const btn = $("#lookup-btn");
  btn.disabled = true;
  btn.textContent = "Verifying…";
  try {
    const data = await api(`/api/students/${encodeURIComponent(q)}`);
    applyStudent(data.student);
  } catch (err) {
    if (err.status === 404) {
      $("#lookup-notfound").classList.remove("hidden");
      clearStudentFields();
    } else {
      toast(err.message, "error");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Look up";
  }
});

function applyStudent(student) {
  currentStudent = student;
  $("#f-fullName").value = student.name;
  $("#f-program").value = student.program;
  $("#f-yearLevel").value = student.year_level;
  $("#f-enrollStatus").value = student.status;

  const elig = student.discount_eligibility || "None";
  const hint = $("#discount-hint");
  if (elig !== "None") {
    $("#f-discountType").value = elig;
    $("#f-discountPercent").value = DEFAULT_DISCOUNT_PERCENT[elig] ?? 0;
    hint.textContent = `Per Registrar record: eligible for "${elig}" — verify supporting documents before applying.`;
    hint.classList.remove("hidden");
  } else {
    $("#f-discountType").value = "None";
    $("#f-discountPercent").value = 0;
    hint.classList.add("hidden");
  }
  updateReceipt();
}

function clearStudentFields() {
  currentStudent = null;
  ["#f-fullName", "#f-program", "#f-yearLevel", "#f-enrollStatus"].forEach((id) => ($(id).value = ""));
  $("#f-discountType").value = "None";
  $("#f-discountPercent").value = 0;
  $("#discount-hint").classList.add("hidden");
  updateReceipt();
}

/* ---------------- DISCOUNT ---------------- */
$("#f-discountType").addEventListener("change", () => {
  const type = $("#f-discountType").value;
  $("#f-discountPercent").value = DEFAULT_DISCOUNT_PERCENT[type] ?? 0;
  unlockReview();
  updateReceipt();
});

function computeNet() {
  const gross = Number($("#f-amount").value) || 0;
  let pct = Number($("#f-discountPercent").value) || 0;
  pct = Math.min(100, Math.max(0, pct));
  const discount = Math.round((gross * pct) / 100 * 100) / 100;
  const net = Math.round((gross - discount) * 100) / 100;
  return { gross, pct, discount, net };
}

/* ---------------- LIVE RECEIPT PREVIEW ---------------- */
function updateReceipt() {
  $("#r-student").textContent = currentStudent ? currentStudent.name : "—";
  $("#r-no").textContent = currentStudent ? currentStudent.student_no : "—";
  $("#r-program").textContent = currentStudent ? currentStudent.program : "—";
  $("#r-fee").textContent = $("#f-feeType").value;
  $("#r-method").textContent = $("#f-method").value;
  $("#r-or").textContent = "—";
  const sy = $("#f-schoolYear").value.trim() || "—";
  $("#r-sy").textContent = `${sy} · ${$("#f-semester").value}`;

  const { gross, pct, discount, net } = computeNet();
  $("#r-gross").textContent = peso(gross);
  $("#f-netAmount").value = peso(net);
  $("#r-amount").textContent = peso(net);

  const discountType = $("#f-discountType").value;
  if (discountType !== "None" && pct > 0) {
    $("#r-discount-row").classList.remove("hidden");
    $("#r-discount").textContent = `${discountType} (${pct}%) −${peso(discount)}`;
  } else {
    $("#r-discount-row").classList.add("hidden");
  }

  if (reviewLocked) {
    $("#receipt-txn-status").textContent = "TXN — READY";
    $("#r-pill").textContent = "Ready to commit";
    $("#r-pill").className = "status-pill ready";
  } else {
    $("#receipt-txn-status").textContent = "TXN — PENDING";
    $("#r-pill").textContent = "Awaiting entry";
    $("#r-pill").className = "status-pill";
  }
}

[
  "f-feeType", "f-amount", "f-method", "f-schoolYear", "f-semester", "f-discountPercent",
].forEach((id) => {
  $(`#${id}`).addEventListener("input", () => { unlockReview(); updateReceipt(); });
  $(`#${id}`).addEventListener("change", () => { unlockReview(); updateReceipt(); });
});

function unlockReview() {
  const wasLocked = reviewLocked;
  const wasCommitted = !$("#post-commit-row").classList.contains("hidden");
  if (!wasLocked && !wasCommitted) return;
  reviewLocked = false;
  lastCommittedTx = null;
  $("#review-btn").classList.remove("hidden");
  $("#confirm-row").classList.add("hidden");
  $("#post-commit-row").classList.add("hidden");
  updateReceipt();
}

/* ---------------- REVIEW / COMMIT ---------------- */
function formPayload() {
  return {
    studentNo: currentStudent?.student_no,
    studentName: currentStudent?.name,
    program: currentStudent?.program,
    feeType: $("#f-feeType").value,
    grossAmount: $("#f-amount").value,
    discountType: $("#f-discountType").value,
    discountPercent: $("#f-discountPercent").value,
    method: $("#f-method").value,
    term: `${$("#f-semester").value}, S.Y. ${$("#f-schoolYear").value.trim()}`,
    processedBy: $("#f-processedBy").value.trim(),
    verifiedBy: $("#f-verifiedBy").value.trim(),
  };
}

$("#review-btn").addEventListener("click", () => {
  const v = formPayload();
  const errs = [];
  if (!currentStudent) errs.push("Look up a student before reviewing the transaction.");
  if (!(Number(v.grossAmount) > 0)) errs.push("Enter a gross amount greater than zero.");
  if (!$("#f-schoolYear").value.trim()) errs.push("School year is required.");
  if (!v.processedBy) errs.push("Processed by (Accounting) is required.");
  const pct = Number(v.discountPercent) || 0;
  if (pct < 0 || pct > 100) errs.push("Discount % must be between 0 and 100.");
  if (v.discountType !== "None" && pct === 0) errs.push("Enter a discount percentage, or set discount type to None.");

  const errEl = $("#form-errors");
  if (errs.length) {
    errEl.innerHTML = errs.map((e) => `<li>✕ ${e}</li>`).join("");
    errEl.classList.remove("hidden");
    return;
  }
  errEl.classList.add("hidden");
  reviewLocked = true;
  $("#review-btn").classList.add("hidden");
  $("#confirm-row").classList.remove("hidden");
  updateReceipt();
});

$("#cancel-review-btn").addEventListener("click", unlockReview);

$("#commit-btn").addEventListener("click", async () => {
  const btn = $("#commit-btn");
  btn.disabled = true;
  btn.textContent = "Committing…";
  try {
    const tx = await api("/api/transactions", { method: "POST", body: JSON.stringify(formPayload()) });
    $("#r-or").textContent = tx.or_number;
    toast(`Transaction committed — O.R. #${tx.or_number}.`, "success");
    $("#r-pill").textContent = tx.status;
    $("#r-pill").className = "status-pill committed";
    $("#receipt-txn-status").textContent = `TXN — ${tx.status.toUpperCase()}`;
    lastCommittedTx = tx;
    $("#confirm-row").classList.add("hidden");
    $("#post-commit-row").classList.remove("hidden");
    loadLedger();
  } catch (err) {
    const msg = err.payload?.errors ? err.payload.errors.join(" ") : err.message;
    toast(msg, "error");
    $("#form-errors").innerHTML = (err.payload?.errors || [err.message]).map((e) => `<li>✕ ${e}</li>`).join("");
    $("#form-errors").classList.remove("hidden");
    unlockReview();
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm & Commit";
  }
});

$("#print-receipt-btn").addEventListener("click", () => {
  if (lastCommittedTx) printReceipt(lastCommittedTx);
});
$("#download-receipt-btn").addEventListener("click", () => {
  if (lastCommittedTx) downloadReceipt(lastCommittedTx);
});
$("#new-transaction-btn").addEventListener("click", resetForm);

/* ---------------- PRINT / DOWNLOAD RECEIPT ---------------- */
function openReceiptWindow(html) {
  const w = window.open("", "_blank", "width=440,height=720");
  if (!w) {
    toast("Allow pop-ups to print or download the receipt.", "error");
    return null;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return w;
}

function printReceipt(t) {
  const html = buildReceiptHtml(t);
  const w = openReceiptWindow(html);
  if (!w) return;
  w.onload = () => {
    w.focus();
    w.print();
  };
}

function downloadReceipt(t) {
  if (createReceiptPdf(t)) {
    return;
  }

  const html = buildReceiptHtml(t);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = (t.or_number || t.id || "receipt").replace(/[^a-zA-Z0-9-_]+/g, "-").toLowerCase();
  link.href = url;
  link.download = `receipt-${safeName}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetForm() {
  $("#f-studentNo").value = "";
  clearStudentFields();
  $("#f-amount").value = "";
  $("#f-schoolYear").value = "";
  $("#f-processedBy").value = "";
  $("#f-verifiedBy").value = "";
  $("#form-errors").classList.add("hidden");
  $("#lookup-notfound").classList.add("hidden");
  reviewLocked = false;
  lastCommittedTx = null;
  $("#review-btn").classList.remove("hidden");
  $("#confirm-row").classList.add("hidden");
  $("#post-commit-row").classList.add("hidden");
  updateReceipt();
}
/* ---------------- LEDGER (real GET/PATCH /api/transactions) ---------------- */
let ledgerCache = [];

async function loadLedger() {
  try {
    const data = await api("/api/transactions");
    ledgerCache = data.transactions;
    renderStats();
    $("#stat-expected").textContent = peso(data.expectedCollectedAmount);
    renderLedgerList($("#ledger-search").value.trim());
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderStats() {
  const paid = ledgerCache.filter((t) => t.status === "Paid");
  const pendingVoided = ledgerCache.filter((t) => t.status !== "Paid");
  $("#stat-count").textContent = ledgerCache.length;
  $("#stat-collected").textContent = peso(paid.reduce((s, t) => s + t.amount, 0));
  $("#stat-pv").textContent = pendingVoided.length;
}

function renderLedgerList(query) {
  const q = (query || "").toLowerCase();
  const rows = !q
    ? ledgerCache
    : ledgerCache.filter(
        (t) =>
          t.student_name.toLowerCase().includes(q) ||
          t.or_number.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
      );

  const list = $("#ledger-list");
  if (rows.length === 0) {
    list.innerHTML = `<div class="ledger-empty">${ledgerCache.length === 0 ? "No transactions recorded yet." : "No transactions match that search."}</div>`;
    return;
  }

  list.innerHTML = rows
    .map(
      (t) => `
    <div class="tx-row" data-id="${t.id}">
      <div class="left">
        <div class="name-row"><span class="name">${t.student_name}</span><span class="badge ${t.status}">${t.status}</span></div>
        <p class="meta"><strong>${t.id}</strong> · ${t.fee_type} · O.R. #${t.or_number} · ${t.term} · ${new Date(t.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}${t.discount_type && t.discount_type !== "None" ? ` · ${t.discount_type} (${t.discount_percent}% off gross ${peso(t.gross_amount)})` : ""}</p>
      </div>
      <div class="right">
        <span class="amt">${peso(t.amount)}</span>
        <button class="void-btn" data-print="${t.id}" title="Print receipt">🖨</button>
        ${t.status !== "Voided" ? `<button class="void-btn" data-void="${t.id}" title="Void transaction">⊘</button>` : ""}
      </div>
    </div>`
    )
    .join("");

  list.querySelectorAll("[data-print]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tx = ledgerCache.find((t) => t.id === btn.dataset.print);
      if (tx) printReceipt(tx);
    });
  });
  list.querySelectorAll("[data-void]").forEach((btn) => {
    btn.addEventListener("click", () => confirmVoid(btn, btn.dataset.void));
  });
}

function confirmVoid(btn, id) {
  const row = btn.closest(".right");
  btn.outerHTML = `
    <span class="void-confirm">
      <button class="yes" data-confirm-yes="${id}">Void it</button>
      <button class="no" data-confirm-no="${id}">Cancel</button>
    </span>`;
  row.querySelector(`[data-confirm-yes="${id}"]`).addEventListener("click", () => doVoid(id));
  row.querySelector(`[data-confirm-no="${id}"]`).addEventListener("click", () => renderLedgerList($("#ledger-search").value.trim()));
}

async function doVoid(id) {
  try {
    await api(`/api/transactions/${id}/void`, { method: "PATCH" });
    toast("Transaction voided.", "success");
    loadLedger();
  } catch (err) {
    toast(err.message, "error");
  }
}

$("#ledger-search").addEventListener("input", (e) => renderLedgerList(e.target.value.trim()));
$("#refresh-btn").addEventListener("click", loadLedger);
setInterval(() => {
  if (!$("#app-screen").classList.contains("hidden")) loadLedger();
}, 30000);

/* ---------------- MANAGE STUDENTS (real GET/DELETE /api/students) ---------------- */
let studentCache = [];

async function loadStudents() {
  try {
    const data = await api("/api/students");
    studentCache = data.students;
    renderStudentList($("#student-search").value.trim());
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderStudentList(query) {
  const q = (query || "").toLowerCase();
  const rows = !q
    ? studentCache
    : studentCache.filter(
        (s) => s.student_no.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );

  const list = $("#student-list");
  if (rows.length === 0) {
    list.innerHTML = `<div class="ledger-empty">${studentCache.length === 0 ? "No students yet." : "No students match that search."}</div>`;
    return;
  }

  list.innerHTML = rows
    .map(
      (s) => `
    <div class="tx-row" data-student="${s.student_no}">
      <div class="left">
        <div class="name-row"><span class="name">${s.name}</span><span class="badge Paid">${s.status}</span></div>
        <p class="meta">${s.student_no} · ${s.program} · ${s.year_level}${s.discount_eligibility && s.discount_eligibility !== "None" ? ` · ${s.discount_eligibility}` : ""}</p>
      </div>
      <div class="right">
        <button class="void-btn" data-delete-student="${s.student_no}" title="Delete student">⊘</button>
      </div>
    </div>`
    )
    .join("");

  list.querySelectorAll("[data-delete-student]").forEach((btn) => {
    btn.addEventListener("click", () => confirmDeleteStudent(btn, btn.dataset.deleteStudent));
  });
}

function confirmDeleteStudent(btn, studentNo) {
  const row = btn.closest(".right");
  row.innerHTML = `
    <span class="void-confirm">
      <button class="yes" data-confirm-yes>Delete it</button>
      <button class="no" data-confirm-no>Cancel</button>
    </span>`;
  row.querySelector("[data-confirm-yes]").addEventListener("click", () => doDeleteStudent(studentNo));
  row.querySelector("[data-confirm-no]").addEventListener("click", () => renderStudentList($("#student-search").value.trim()));
}

async function doDeleteStudent(studentNo) {
  try {
    const res = await api(`/api/students/${encodeURIComponent(studentNo)}`, { method: "DELETE" });
    toast(res.note ? `Student removed. ${res.note}` : "Student removed.", "success");
    loadStudents();
  } catch (err) {
    toast(err.message, "error");
  }
}

$("#student-search").addEventListener("input", (e) => renderStudentList(e.target.value.trim()));

updateReceipt();
