// src/routes/students.js
//   GET    /api/students            list all students (Manage Students screen)
//   GET    /api/students/:query     verify identity/program/status before payment
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
    ).run({
      student_no: student.student_no,
      name: student.name,
      program: student.program,
      year_level: student.year_level,
      status: student.status,
      discount_eligibility: student.discount_eligibility,
    });

    res.json({ source: "it-department-hub", student });
  } catch (error) {
    if (error.status === 502 || error.status === 504) {
      return res.status(error.status).json({ error: error.message });
    }
    next(error);
  }
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
