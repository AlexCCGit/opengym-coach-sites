import assert from "node:assert/strict";
import test from "node:test";

import { activityHeatmap, trainingStreak, weeklySummary } from "../lib/analytics.mjs";
import { createInitialState } from "../lib/domain.mjs";
import { buildPlanBundle, decodePlanBundle, encodePlanBundle, mergePlanBundle, printablePlanHtml } from "../lib/plan-share.mjs";

test("calcula heatmap, racha y resumen semanal", () => {
  const now = new Date("2026-08-25T12:00:00Z");
  const workouts = [{ date: "2026-08-24T10:00:00Z", durationSeconds: 600, exercises: [{ sets: [{ weight: 10, reps: 10 }] }] }, { date: "2026-08-25T10:00:00Z", durationSeconds: 600, exercises: [{ sets: [{ minutes: 20 }] }] }];
  assert.equal(trainingStreak(workouts, now), 2);
  assert.deepEqual(activityHeatmap(workouts, 2, now).map((day) => day.count), [1, 1]);
  assert.deepEqual(activityHeatmap(workouts, 2, now).map((day) => day.minutes), [10, 10]);
  assert.deepEqual(weeklySummary(workouts, now), { workouts: 2, sets: 2, volume: 100, cardioMinutes: 20, durationMinutes: 20 });
});

test("codifica, valida y fusiona planes compartidos", () => {
  const state = createInitialState("user-1");
  state.customExercises.push({ id: "custom-replacement", name: "Alternativa", muscle: "back", measurement: "reps", weightMode: "standard" });
  state.routines[0].exercises[0].substitutionExerciseIds = ["custom-replacement"];
  const decoded = decodePlanBundle(encodePlanBundle(buildPlanBundle(state)));
  assert.equal(decoded.routines.length, state.routines.length);
  assert.equal(decoded.customExercises.some((exercise) => exercise.id === "custom-replacement"), true);
  const merged = mergePlanBundle(state, decoded, true);
  assert.equal(merged.routines.length, state.routines.length * 2);
  assert.match(printablePlanHtml(state), /Guardar como PDF/);
  assert.match(printablePlanHtml(state), /alternativas: Alternativa/);
});
