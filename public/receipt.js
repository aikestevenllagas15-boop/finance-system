export function formatCurrency(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildReceiptHtml(t) {
  const discountLine = t.discount_type && t.discount_type !== "None"
    ? `<div class="row"><span>Discount</span><span>${t.discount_type} (${t.discount_percent}%) −${formatCurrency(t.discount_amount)}</span></div>`
    : "";

  const createdAt = t.created_at
    ? new Date(t.created_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })
    : "—";

  const safeValue = (value, fallback = "—") => (value ?? "") || fallback;
  const status = safeValue(t.status, "PAID").toUpperCase();

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt — ${safeValue(t.or_number, t.id)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Segoe UI', Tahoma, sans-serif;
      background: #f6f7fb;
      color: #111827;
      padding: 24px;
    }
    .page {
      max-width: 440px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #dfe5ef;
      border-radius: 12px;
      box-shadow: 0 10px 28px rgba(19, 34, 87, 0.08);
      padding: 26px 22px 18px;
    }
    .toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 16px;
    }
    .toolbar button {
      border: 1px solid #132257;
      border-radius: 8px;
      background: #132257;
      color: white;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .toolbar button.secondary {
      background: #fff;
      color: #132257;
    }
    .center { text-align: center; }
    h1 { font-size: 16px; margin: 0 0 2px; color: #132257; }
    .sub { font-size: 10.5px; color: #555; margin: 0 0 14px; letter-spacing: 0.06em; }
    .divider { border-top: 1px dashed #9ea8ba; margin: 12px 0; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; }
    .row span:first-child { color: #586274; }
    .row span:last-child { text-align: right; font-weight: 700; }
    .amount { font-size: 18px; font-weight: 800; }
    .status { text-align: center; margin-top: 14px; font-weight: 700; letter-spacing: 0.08em; font-size: 11px; }
    .sig { margin-top: 26px; display: flex; justify-content: space-between; gap: 20px; font-size: 10.5px; }
    .sig div { flex: 1; border-top: 1px solid #27314b; padding-top: 4px; text-align: center; }
    .footer { text-align: center; margin-top: 20px; font-size: 10px; color: #777; }
    @media print { body { background: white; padding: 0; } .page { box-shadow: none; border: none; border-radius: 0; max-width: 100%; } .toolbar { display: none; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <button type="button" onclick="window.print()">Print Receipt</button>
      <button type="button" class="secondary" onclick="const html = document.documentElement.outerHTML; const blob = new Blob([html], { type: 'text/html;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'receipt-${String(t.or_number || t.id).replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase()}.html'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);">Download Receipt</button>
    </div>

    <div class="center">
      <h1>Colegio de San Francisco Javier of Rizal</h1>
      <p class="sub">OFFICIAL RECEIPT — ACCOUNTING OFFICE</p>
    </div>

    <div class="divider"></div>
    <div class="row"><span>TXN ID</span><span>${safeValue(t.id)}</span></div>
    <div class="row"><span>Date</span><span>${createdAt}</span></div>
    <div class="divider"></div>
    <div class="row"><span>Student</span><span>${safeValue(t.student_name)}</span></div>
    <div class="row"><span>Student No.</span><span>${safeValue(t.student_no)}</span></div>
    <div class="row"><span>Program</span><span>${safeValue(t.program)}</span></div>
    <div class="divider"></div>
    <div class="row"><span>Fee type</span><span>${safeValue(t.fee_type)}</span></div>
    <div class="row"><span>Method</span><span>${safeValue(t.method)}</span></div>
    <div class="row"><span>O.R. number</span><span>${safeValue(t.or_number)}</span></div>
    <div class="row"><span>Term</span><span>${safeValue(t.term)}</span></div>
    <div class="divider"></div>
    <div class="row"><span>Gross amount</span><span>${formatCurrency(t.gross_amount)}</span></div>
    ${discountLine}
    <div class="row amount"><span>Net amount</span><span>${formatCurrency(t.amount)}</span></div>
    <div class="status">STATUS: ${status}</div>

    <div class="sig">
      <div>${safeValue(t.processed_by)}<br>Processed by (Accounting)</div>
      <div>${safeValue(t.verified_by)}<br>Verified by (Registrar)</div>
    </div>

    <div class="footer">System-generated receipt · Finance System · CSFJ</div>
  </div>
</body>
</html>`;
}

export function createReceiptPdf(t) {
  if (typeof window === "undefined" || !window.jspdf?.jsPDF) {
    return null;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a5" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;
  const lineHeight = 18;
  let y = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Colegio de San Francisco Javier of Rizal", pageWidth / 2, y, { align: "center" });
  y += 26;
  doc.setFontSize(9);
  doc.text("OFFICIAL RECEIPT — ACCOUNTING OFFICE", pageWidth / 2, y, { align: "center" });
  y += 24;
  doc.setDrawColor(150);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  const rows = [
    ["TXN ID", t.id || "—"],
    ["Date", new Date(t.created_at || Date.now()).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })],
    ["Student", t.student_name || "—"],
    ["Student No.", t.student_no || "—"],
    ["Program", t.program || "—"],
    ["Fee type", t.fee_type || "—"],
    ["Method", t.method || "—"],
    ["O.R. number", t.or_number || "—"],
    ["Term", t.term || "—"],
    ["Gross amount", formatCurrency(t.gross_amount)],
    ...(t.discount_type && t.discount_type !== "None" ? [["Discount", `${t.discount_type} (${t.discount_percent}%) - ${formatCurrency(t.discount_amount)}`]] : []),
    ["Net amount", formatCurrency(t.amount)],
    ["Status", (t.status || "Paid").toUpperCase()],
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  rows.forEach(([label, value]) => {
    doc.setTextColor(80, 80, 80);
    doc.text(label, margin, y);
    doc.setTextColor(20, 20, 20);
    doc.text(String(value), pageWidth - margin, y, { align: "right" });
    y += lineHeight;
  });

  y += 10;
  doc.setDrawColor(150);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const leftSig = t.processed_by || "—";
  const rightSig = t.verified_by || "—";
  doc.text(leftSig, margin + 40, y, { align: "center" });
  doc.text("Processed by (Accounting)", margin + 40, y + 14, { align: "center" });
  doc.text(rightSig, pageWidth - margin - 40, y, { align: "center" });
  doc.text("Verified by (Registrar)", pageWidth - margin - 40, y + 14, { align: "center" });

  doc.save(`receipt-${String(t.or_number || t.id || "finance").replace(/[^a-zA-Z0-9-_]+/g, "-").toLowerCase()}.pdf`);
  return true;
}
