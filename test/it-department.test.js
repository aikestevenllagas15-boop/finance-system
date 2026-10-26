import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get as httpGet } from "node:http";
import express from "express";
import { getHubStudent } from "../src/integrations/it-department.js";
import studentsRouter from "../src/routes/students.js";
import transactionsRouter from "../src/routes/transactions.js";
import { db } from "../src/db.js";

test("Hub student lookup maps the documented student profile", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({
      student_id: "2026-00234",
      full_name: "Lander Student",
      year_level: "2nd Year",
      section: "BSIT-A",
      enrollment_status: "Enrolled",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const student = await getHubStudent("2026-00234");
    assert.match(requestedUrl, /\/hub\/students\/2026-00234$/);
    assert.equal(student.student_no, "2026-00234");
    assert.equal(student.name, "Lander Student");
    assert.equal(student.section, "BSIT-A");
    assert.equal(student.status, "Enrolled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hub student lookup reports missing records and upstream errors", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 404 });
    assert.equal(await getHubStudent("missing"), null);

    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(getHubStudent("2026-00234"), {
      status: 502,
      message: "The IT Department Hub returned HTTP 503.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("student route caches Hub profiles with fields not used by SQL bindings", async () => {
  const originalFetch = globalThis.fetch;
  const studentNo = `TEST-${randomUUID()}`;
  globalThis.fetch = async () => new Response(JSON.stringify({
    student_id: studentNo,
    full_name: "Test Student",
    year_level: 1,
    section: "A",
    enrollment_status: "Enrolled",
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const app = express();
  app.use("/api/students", studentsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const response = await new Promise((resolve, reject) => {
      const request = httpGet(
        { hostname: "127.0.0.1", port, path: `/api/students/${studentNo}` },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body }));
        }
      );
      request.on("error", reject);
    });

    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).student.section, "A");
    assert.equal(db.prepare("SELECT student_no FROM students WHERE student_no = ?").get(studentNo).student_no, studentNo);
  } finally {
    db.prepare("DELETE FROM students WHERE student_no = ?").run(studentNo);
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("transactions summary sums gross amounts and excludes voided transactions", async () => {
  const suffix = randomUUID();
  const studentNo = `TEST-${suffix}`;
  const transactionIds = [`TEST-PAID-${suffix}`, `TEST-PENDING-${suffix}`, `TEST-VOIDED-${suffix}`];
  db.prepare(
    `INSERT INTO students (student_no, name, program, year_level, status, discount_eligibility)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(studentNo, "Test Student", "BSIT", "1st Year", "Active", "None");

  const insertTransaction = db.prepare(
    `INSERT INTO transactions (
       id, student_no, student_name, program, fee_type, gross_amount, discount_type,
       discount_percent, discount_amount, amount, method, or_number, term,
       processed_by, verified_by, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertTransaction.run(
    transactionIds[0], studentNo, "Test Student", "BSIT", "Tuition Fee",
    10000, "None", 0, 0, 10000, "Cash", `OR-PAID-${suffix}`,
    "1st Sem", "Tester", "", "Paid", new Date().toISOString()
  );
  insertTransaction.run(
    transactionIds[1], studentNo, "Test Student", "BSIT", "Laboratory Fee",
    2500, "None", 0, 0, 2500, "Cash", `OR-PENDING-${suffix}`,
    "1st Sem", "Tester", "", "Pending", new Date().toISOString()
  );
  insertTransaction.run(
    transactionIds[2], studentNo, "Test Student", "BSIT", "Miscellaneous Fee",
    700, "None", 0, 0, 700, "Cash", `OR-VOIDED-${suffix}`,
    "1st Sem", "Tester", "", "Voided", new Date().toISOString()
  );

  const app = express();
  app.use("/api/transactions", transactionsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const response = await new Promise((resolve, reject) => {
      const request = httpGet(
        { hostname: "127.0.0.1", port, path: "/api/transactions" },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body }));
        }
      );
      request.on("error", reject);
    });

    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).expectedCollectedAmount, 12500);
  } finally {
    db.prepare("DELETE FROM transactions WHERE id IN (?, ?, ?)").run(...transactionIds);
    db.prepare("DELETE FROM students WHERE student_no = ?").run(studentNo);
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
