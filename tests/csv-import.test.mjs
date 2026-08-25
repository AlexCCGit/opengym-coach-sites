import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../lib/domain.mjs";
import { importWorkoutCsv, parseCsv } from "../lib/csv-import.mjs";

test("interpreta CSV con comas y comillas", () => {
  assert.deepEqual(parseCsv('Name,Notes\r\nPress,"Heavy, but clean"\r\n'), [{ name: "Press", notes: "Heavy, but clean" }]);
});

test("importa Strong agrupando series y preservando RPE", () => {
  const csv = "Date,Workout Name,Exercise Name,Set Order,Weight,Reps,RPE\n2026-08-20 10:00:00,Push,Barbell Bench Press,1,80,8,8\n2026-08-20 10:00:00,Push,Barbell Bench Press,2,80,7,9";
  const result = importWorkoutCsv(csv, createInitialState("user-1"));
  assert.equal(result.report.source, "strong");
  assert.equal(result.report.workouts, 1);
  assert.equal(result.report.sets, 2);
  assert.equal(result.state.workouts.at(-1).exercises[0].sets[1].rpe, 9);
});

test("detecta el formato Hevy", () => {
  const csv = "title,start_time,exercise_title,set_index,weight_kg,reps\nPull,2026-08-20T10:00:00Z,Lat Pulldown,0,50,10";
  assert.equal(importWorkoutCsv(csv, createInitialState("user-1")).report.source, "hevy");
});
