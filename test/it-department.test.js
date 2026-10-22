import test from "node:test";
import assert from "node:assert/strict";
import { getHubStudent } from "../src/integrations/it-department.js";

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
