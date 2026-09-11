import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialState,
  estimateOneRepMax,
  getOneRepMaxHistory,
  getMuscleBalance,
  prefillExercise,
  weightForTargetOneRepMax,
} from "../lib/domain.mjs";

test("estima 1RM solo a partir de series elegibles de hasta 12 repeticiones", () => {
  assert.equal(estimateOneRepMax({ weight: 80, reps: 8 }), 101.3);
  assert.equal(estimateOneRepMax({ weight: 80, reps: 13 }), null);
  assert.equal(estimateOneRepMax({ weight: 0, reps: 8 }), null);
});

test("explica la curva de 1RM y calcula una carga objetivo", () => {
  const state = createInitialState("user-1");
  const history = getOneRepMaxHistory(state, "lat-pulldown");
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].sourceSet, { weight: 52.5, reps: 10, id: "set-1" });
  assert.equal(weightForTargetOneRepMax(100, 5), 85.7);
  assert.equal(weightForTargetOneRepMax(100, 13), null);
});

test("precarga peso y repeticiones desde la ultima sesion del mismo ejercicio", () => {
  const state = createInitialState("user-1");
  const previous = state.workouts[0].exercises[0];
  const prefilled = prefillExercise(state, previous.exerciseId);

  assert.equal(prefilled.sets[0].weight, previous.sets[0].weight);
  assert.equal(prefilled.sets[0].reps, previous.sets[0].reps);
});

test("conserva ejercicios temporizados y el significado por mancuerna", () => {
  const state = createInitialState("user-1");
  const plank = state.exercises.find((exercise) => exercise.id === "plank");
  const shrug = state.exercises.find((exercise) => exercise.id === "dumbbell-shrug");

  assert.equal(plank.measurement, "time");
  assert.equal(plank.weightMode, "none");
  assert.equal(plank.tracksReps, true);
  assert.equal(plank.defaultRir, 2);
  assert.equal(shrug.weightMode, "per-dumbbell");
});

test("calcula el equilibrio muscular a partir del volumen registrado", () => {
  const state = createInitialState("user-1");
  const balance = getMuscleBalance(state);

  assert.ok(balance.back > 0);
  assert.ok(balance.biceps > 0);
  assert.equal(balance.chest, 0);
});
