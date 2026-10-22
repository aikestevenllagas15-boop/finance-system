import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get as httpGet } from "node:http";
import express from "express";
import { getHubStudent } from "../src/integrations/it-department.js";
import studentsRouter from "../src/routes/students.js";
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
