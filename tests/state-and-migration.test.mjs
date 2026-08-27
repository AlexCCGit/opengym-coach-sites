import assert from "node:assert/strict";
import test from "node:test";

import { applyRevisionedUpdate } from "../lib/revision.mjs";
import { mergeGymCoachState, migrateGymCoachState } from "../lib/migration.mjs";
import { createInitialState } from "../lib/domain.mjs";

test("rechaza una escritura con revision antigua sin modificar el estado", () => {
  const current = { revision: 4, state: { workouts: [{ id: "kept" }] } };

  const result = applyRevisionedUpdate(current, 3, (state) => ({ ...state, workouts: [] }));

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.deepEqual(current.state.workouts, [{ id: "kept" }]);
});

test("incrementa exactamente una revision al aceptar una escritura", () => {
  const current = { revision: 4, state: { workouts: [] } };
  const result = applyRevisionedUpdate(current, 4, (state) => ({ ...state, workouts: [{ id: "new" }] }));

  assert.equal(result.ok, true);
  assert.equal(result.revision, 5);
  assert.deepEqual(result.state.workouts, [{ id: "new" }]);
});

test("migra minutos a segundos y conserva ejercicios desconocidos", () => {
  const source = {
    workouts: [{
      id: "legacy-1",
      date: "2026-08-01T10:00:00.000Z",
      exercises: [
        { name: "Plancha", sets: [{ minutes: 1.5 }] },
        { name: "Press vikingo casero", sets: [{ weight: 20, reps: 8 }], notes: "No perder" },
      ],
    }],
  };

  const result = migrateGymCoachState(source, "user-1");

  const plank = result.state.workouts[0].exercises[0];
  assert.equal(plank.sets[0].seconds, 90);
  assert.equal(result.state.customExercises.length, 1);
  assert.equal(result.state.customExercises[0].name, "Press vikingo casero");
  assert.equal(result.report.workouts, 1);
  assert.equal(result.report.dropped, 0);
});

test("migra el historial original de Gym Coach con series numéricas y temporizadas", () => {
  const source = {
    history: [{
      date: "2026-08-20T10:00:00.000Z",
      exercises: [
        { id: "remo-antiguo", name: "Remo antiguo", weight: 55, sets: [12, { reps: 10, weight: 60, rir: 1 }] },
        { id: "plancha-antigua", name: "Plancha antigua", metric: "time", sets: [1, { reps: 0.75 }] },
      ],
    }],
  };

  const result = migrateGymCoachState(source, "user-1");
  const [row, plank] = result.state.workouts[0].exercises;

  assert.equal(result.report.workouts, 1);
  assert.equal(result.report.sets, 4);
  assert.deepEqual(row.sets.map((set) => [set.weight, set.reps]), [[55, 12], [60, 10]]);
  assert.deepEqual(plank.sets.map((set) => set.seconds), [60, 45]);
});

test("fusiona sin reemplazar datos nuevos y omite duplicados", () => {
  const current = createInitialState("user-1");
  const source = {
    workouts: [
      current.workouts[0],
      { id: "legacy-2", name: "Pierna", date: "2026-08-15T10:00:00.000Z", exercises: [{ name: "Plancha", sets: [{ seconds: 45 }] }] },
    ],
    bodyweight: [current.bodyweight[0], { id: "legacy-weight", date: "2026-08-15", weight: 77.5 }],
  };

  const result = mergeGymCoachState(source, current);

  assert.equal(result.state.workouts.length, current.workouts.length + 1);
  assert.equal(result.state.bodyweight.length, current.bodyweight.length + 1);
  assert.equal(result.report.workouts, 1);
  assert.equal(result.report.bodyweight, 1);
  assert.equal(result.report.duplicates, 2);
});

test("migra rutinas y conserva conflictos del calendario nuevo", () => {
  const current = createInitialState("user-1");
  const source = {
    routines: [{ id: "legacy-legs", name: "Pierna antigua", exercises: [{ name: "Sentadilla isométrica en pared", targetSets: 4, targetSeconds: 50 }] }],
    weekPlan: { monday: "legacy-legs", tuesday: "legacy-legs" },
  };

  const result = mergeGymCoachState(source, current);

  assert.equal(result.report.routines, 1);
  assert.equal(result.report.assignments, 1);
  assert.equal(result.report.conflicts, 1);
  assert.equal(result.state.weekPlan.monday, "routine-pull-a");
  assert.equal(result.state.weekPlan.tuesday, "legacy-legs");
  assert.equal(result.state.routines.at(-1).exercises[0].exerciseId, "wall-sit");
});
