import assert from "node:assert/strict";
import test from "node:test";

import { detectPersonalRecords, nextIncompleteSet, normalizeEffort, recommendProgression, shouldStartRest, summarizeEffort, supersetUnits, updateProgressionState, workoutSetOrder } from "../lib/training-engine.mjs";
import { createInitialState } from "../lib/domain.mjs";
import { exportPortableState, importPortableState, normalizeState } from "../lib/state-schema.mjs";

test("migra el estado MVP al esquema completo sin perder sesiones", () => {
  const old = createInitialState("user-1");
  old.schemaVersion = 1;
  delete old.settings;
  const migrated = normalizeState(old);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.workouts.length, old.workouts.length);
  assert.equal(migrated.settings.restSeconds, 90);
  assert.equal(migrated.routines[0].exercises[0].progression, "linear");
});

test("exporta e importa una copia portable conservando datos", () => {
  const state = createInitialState("user-1");
  const restored = importPortableState(exportPortableState(state), "user-2");
  assert.equal(restored.workouts[0].id, state.workouts[0].id);
  assert.equal(restored.schemaVersion, 2);
});

test("normaliza RIR y RPE y resume cobertura", () => {
  assert.equal(normalizeEffort({ rpe: 8.5 }), 1.5);
  const summary = summarizeEffort([{ exercises: [{ sets: [{ rir: 2 }, { rpe: 9 }, { completed: true }] }] }]);
  assert.equal(summary.trackedSets, 2);
  assert.equal(summary.coverage, 2 / 3);
  assert.equal(summary.hardSets, 2);
});

test("agrupa superseries manteniendo el orden de unidades", () => {
  const entries = [{ exerciseId: "a" }, { exerciseId: "b", supersetGroup: "x" }, { exerciseId: "c", supersetGroup: "x" }];
  assert.deepEqual(supersetUnits(entries).map((unit) => unit.map((entry) => entry.exerciseId)), [["a"], ["b", "c"]]);
});

test("descansa al completar la ronda de una superserie, no entre sus ejercicios", () => {
  const exercises = [
    { exerciseId: "a", supersetGroup: "x", sets: [{ completed: false }] },
    { exerciseId: "b", supersetGroup: "x", sets: [{ completed: false }] },
    { exerciseId: "c", sets: [{ completed: false }] },
  ];
  assert.equal(shouldStartRest(exercises, 0, 0), false);
  exercises[0].sets[0].completed = true;
  assert.equal(shouldStartRest(exercises, 1, 0), true);
  assert.equal(shouldStartRest(exercises, 2, 0), true);
});

test("ordena una sesión por series y alterna las superseries", () => {
  const exercises = [
    { exerciseId: "a", sets: [{ completed: false }, { completed: false }] },
    { exerciseId: "b", supersetGroup: "x", sets: [{ completed: false }, { completed: false }] },
    { exerciseId: "c", supersetGroup: "x", sets: [{ completed: false }, { completed: false }] },
  ];
  assert.deepEqual(workoutSetOrder(exercises), [
    { exerciseIndex: 0, setIndex: 0 }, { exerciseIndex: 0, setIndex: 1 },
    { exerciseIndex: 1, setIndex: 0 }, { exerciseIndex: 2, setIndex: 0 },
    { exerciseIndex: 1, setIndex: 1 }, { exerciseIndex: 2, setIndex: 1 },
  ]);
  exercises[0].sets[1].completed = true;
  assert.deepEqual(nextIncompleteSet(exercises, 0, 0), { exerciseIndex: 1, setIndex: 0 });
});

test("aplica progresión doble, Greyskull y descarga", () => {
  const double = recommendProgression({ policy: "double", previousSets: [{ weight: 50, reps: 10 }], targetReps: 10, increment: 2.5 });
  assert.equal(double.weight, 52.5);
  assert.equal(double.reps, 8);
  const greyskull = recommendProgression({ policy: "greyskull", previousSets: [{ weight: 50, reps: 20 }], targetReps: 10, increment: 2.5 });
  assert.equal(greyskull.weight, 55);
  const deload = recommendProgression({ policy: "linear", previousSets: [{ weight: 100, reps: 5 }], targetReps: 5, stalls: 3, increment: 2.5 });
  assert.equal(deload.weight, 90);
  assert.equal(deload.deload, true);
});

test("la progresión doble no aumenta carga cuando la última sesión llegó al fallo", () => {
  const held = recommendProgression({ policy: "double", previousSets: [{ weight: 60, reps: 12, rir: 0 }], targetReps: 12, minReps: 8, increment: 5 });
  assert.equal(held.weight, 60);
  assert.equal(held.reps, 12);
  assert.match(held.reason, /mantén/);

  const increased = recommendProgression({ policy: "double", previousSets: [{ weight: 60, reps: 12, rir: 2 }], targetReps: 12, minReps: 8, increment: 5 });
  assert.equal(increased.weight, 65);
  assert.equal(increased.reps, 8);
});

test("la progresión doble de peso corporal no inventa una carga", () => {
  const result = recommendProgression({ policy: "double", bodyweight: true, previousSets: [{ weight: 0, reps: 15, rir: 2 }], targetReps: 15, minReps: 10, increment: 5 });
  assert.equal(result.weight, 0);
  assert.equal(result.reps, 15);
  assert.match(result.reason, /variante/);
});

test("Greyskull resetea al primer fallo y el peso corporal progresa en repeticiones", () => {
  const reset = recommendProgression({ policy: "greyskull", previousSets: [{ weight: 100, reps: 4 }], targetReps: 5, stalls: 1, increment: 2.5 });
  assert.equal(reset.weight, 90);
  const bodyweight = recommendProgression({ policy: "linear", previousSets: [{ weight: 0, reps: 10 }], targetReps: 10 });
  assert.equal(bodyweight.reps, 11);
  assert.equal(bodyweight.weight, 0);
});

test("detecta records frente al historial previo", () => {
  const prior = [{ exercises: [{ exerciseId: "press", sets: [{ weight: 80, reps: 5 }] }] }];
  const candidate = { exercises: [{ exerciseId: "press", sets: [{ id: "new", weight: 82.5, reps: 5, completed: true }] }] };
  assert.deepEqual(detectPersonalRecords(prior, candidate).map((record) => record.setId), ["new"]);
});

test("actualiza estancamientos después de cada sesión", () => {
  const missed = updateProgressionState({}, { date: "2026-08-25", exercises: [{ exerciseId: "press", progression: { policy: "linear", reps: 10 }, sets: [{ reps: 8, completed: true }] }] });
  assert.equal(missed.press.stalls, 1);
  const hit = updateProgressionState(missed, { date: "2026-08-26", exercises: [{ exerciseId: "press", progression: { policy: "linear", reps: 10 }, sets: [{ reps: 10, completed: true }] }] });
  assert.equal(hit.press.stalls, 0);
  assert.equal(hit.press.sessions, 2);
});
