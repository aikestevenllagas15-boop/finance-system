// src/routes/students.js
//   GET    /api/students            list all students (Manage Students screen)
//   GET    /api/students/:query     verify identity/program/status before payment
//   POST   /api/students            add a student to Finance's local record
//   DELETE /api/students/:studentNo remove a student's record
//
// Hub lookups refresh Finance's local copy; transactions retain a stable
// student name/program snapshot even if the remote record later changes.
// Deleting a student here does NOT touch transaction history — every
// transaction stores the student's name/program at the time of payment, so
// the ledger stays intact even after the student record is removed.

import { Router } from "express";
import { db } from "../db.js";
import { getHubStudent } from "../integrations/it-department.js";

const router = Router();

const STATUSES = ["Active", "On Leave", "Graduated", "Unverified"];

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM students ORDER BY student_no").all();
  res.json({ count: rows.length, students: rows });
});

router.get("/:query", async (req, res, next) => {
  const q = req.params.query.trim();
  try {
    const remoteStudent = await getHubStudent(q);
    if (!remoteStudent) {
      return res.status(404).json({ error: `No student matches "${q}".` });
    }

    const cachedStudent = db
      .prepare("SELECT program, discount_eligibility FROM students WHERE student_no = ?")
      .get(remoteStudent.student_no);
    const student = {
      ...remoteStudent,
      program: remoteStudent.program || remoteStudent.section || cachedStudent?.program || "—",
      discount_eligibility:
        remoteStudent.discount_eligibility !== "None"
          ? remoteStudent.discount_eligibility
          : cachedStudent?.discount_eligibility || "None",
    };

    db.prepare(
      `INSERT INTO students (student_no, name, program, year_level, status, discount_eligibility)
       VALUES (@student_no, @name, @program, @year_level, @status, @discount_eligibility)
       ON CONFLICT(student_no) DO UPDATE SET
         name = excluded.name,
         program = excluded.program,
         year_level = excluded.year_level,
         status = excluded.status`
    ).run(student);

    res.json({ source: "it-department-hub", student });
  } catch (error) {
    if (error.status === 502 || error.status === 504) {
      return res.status(error.status).json({ error: error.message });
    }
    next(error);
  }
});

router.post("/", (req, res) => {
  const { studentNo, name, program, yearLevel, status, discountEligibility } = req.body || {};

  const errors = [];
  if (!studentNo || !String(studentNo).trim()) errors.push("studentNo is required.");
  if (!name || !String(name).trim()) errors.push("name is required.");
  if (!program || !String(program).trim()) errors.push("program is required.");
  if (!yearLevel || !String(yearLevel).trim()) errors.push("yearLevel is required.");
  if (status && !STATUSES.includes(status)) errors.push(`status must be one of: ${STATUSES.join(", ")}`);

  if (studentNo) {
    const dup = db.prepare("SELECT student_no FROM students WHERE student_no = ?").get(String(studentNo).trim());
    if (dup) errors.push(`Student number "${studentNo}" already exists.`);
  }

  if (errors.length) return res.status(422).json({ errors });

  const row = {
    student_no: String(studentNo).trim(),
    name: String(name).trim(),
    program: String(program).trim(),
    year_level: String(yearLevel).trim(),
    status: status || "Active",
    discount_eligibility: discountEligibility || "None",
  };

  db.prepare(
    `INSERT INTO students (student_no, name, program, year_level, status, discount_eligibility)
     VALUES (@student_no, @name, @program, @year_level, @status, @discount_eligibility)`
  ).run(row);

  res.status(201).json(row);
});

router.delete("/:studentNo", (req, res) => {
  const studentNo = req.params.studentNo;
  const row = db.prepare("SELECT * FROM students WHERE student_no = ?").get(studentNo);
  if (!row) return res.status(404).json({ error: "Student not found." });

  const txCount = db
    .prepare("SELECT COUNT(*) AS n FROM transactions WHERE student_no = ?")
    .get(studentNo).n;

  db.prepare("DELETE FROM students WHERE student_no = ?").run(studentNo);

  res.json({
    deleted: studentNo,
    note: txCount > 0
      ? `${txCount} existing transaction(s) for this student remain in the ledger — historical records are never removed by this action.`
      : undefined,
  });
});

export default router;
