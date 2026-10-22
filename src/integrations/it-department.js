const HUB_URL =
  process.env.IT_DEPARTMENT_HUB_URL || "https://it-department-hub.onrender.com";

export async function getHubStudent(studentNo) {
  let response;
  try {
    response = await fetch(
      `${HUB_URL.replace(/\/+$/, "")}/hub/students/${encodeURIComponent(studentNo)}`,
      { signal: AbortSignal.timeout(55_000) }
    );
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      const timeoutError = new Error("The IT Department Hub request timed out. Please try again.");
      timeoutError.status = 504;
      throw timeoutError;
    }
    const networkError = new Error("Could not connect to the IT Department Hub.");
    networkError.status = 502;
    throw networkError;
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`The IT Department Hub returned HTTP ${response.status}.`);
    error.status = 502;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error("The IT Department Hub returned an invalid response.");
    error.status = 502;
    throw error;
  }

  const record =
    payload?.student ??
    payload?.data?.student ??
    payload?.data ??
    payload?.profile ??
    payload;
  const id = record?.student_id ?? record?.student_no ?? record?.studentNo;
  const name = record?.full_name ?? record?.name;
  if (id == null || !name) {
    const error = new Error("The IT Department Hub response is missing the student's ID or name.");
    error.status = 502;
    throw error;
  }
  if (String(id) !== String(studentNo)) {
    const error = new Error("The IT Department Hub returned a different student's profile.");
    error.status = 502;
    throw error;
  }

  return {
    student_no: String(id),
    name: String(name),
    program: record.program ? String(record.program) : "",
    section: record.section ? String(record.section) : "",
    year_level: String(record.year_level ?? record.yearLevel ?? ""),
    status: String(record.enrollment_status ?? record.status ?? "Unverified"),
    discount_eligibility: record.discount_eligibility
      ? String(record.discount_eligibility)
      : "None",
  };
}
