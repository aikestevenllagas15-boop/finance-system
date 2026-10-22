import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptHtml } from '../public/receipt.js';

test('receipt HTML includes print and PDF export actions for a committed payment', () => {
  const transaction = {
    id: 'COL000001',
    student_name: 'Maria Santos',
    student_no: 'CSFJ-2024-1001',
    program: 'BSIT',
    fee_type: 'Tuition Fee',
    method: 'GCash',
    or_number: 'OR-1001',
    term: '1st Sem, S.Y. 2025-2026',
    gross_amount: 15000,
    discount_type: 'Academic Scholarship — Partial',
    discount_percent: 50,
    discount_amount: 7500,
    amount: 7500,
    status: 'Paid',
    processed_by: 'R. Dela Cruz',
    verified_by: 'A. Reyes',
    created_at: '2026-10-12T11:00:00.000Z'
  };

  const html = buildReceiptHtml(transaction);

  assert.match(html, /OFFICIAL RECEIPT/i);
  assert.match(html, /Print Receipt/i);
  assert.match(html, /Download Receipt/i);
  assert.match(html, /Maria Santos/i);
});
