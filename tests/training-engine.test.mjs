import assert from "node:assert/strict";
import test from "node:test";

import { detectPersonalRecords, normalizeEffort, recommendProgression, summarizeEffort, supersetUnits, updateProgressionState } from "../lib/training-engine.mjs";
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
