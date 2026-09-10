import assert from "node:assert/strict";
import test from "node:test";

import { applyRevisionedUpdate } from "../lib/revision.mjs";
import { mergeGymCoachState, migrateGymCoachState } from "../lib/migration.mjs";
import { createInitialState } from "../lib/domain.mjs";
import { normalizeState } from "../lib/state-schema.mjs";

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

test("clasifica la flexión de rodilla como trabajo de isquiotibiales", () => {
  const result = migrateGymCoachState({ exercises: [{ name: "Flexión de rodilla" }] }, "user-1");
  assert.equal(result.state.customExercises[0].muscle, "hamstrings");
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

test("crea ejercicios desde el plan vigente y una rutina desde la sesión más reciente", () => {
  const source = {
    exercises: [
      { id: "elevacion-lateral", name: "Elevación lateral", group: "Tren superior", weight: 8, min: 10, max: 15, inc: 2, pain: 5 },
      { id: "biceps-maquina", name: "Bíceps en máquina", group: "Tren superior", weight: 20, min: 8, max: 12, inc: 2.5 },
    ],
    history: [
      { date: "2026-09-01T10:00:00.000Z", exercises: [{ id: "biceps-maquina", name: "Bíceps en máquina", group: "Tren superior", sets: [{ weight: 20, reps: 12 }] }] },
      { date: "2026-09-08T10:00:00.000Z", exercises: [{ id: "elevacion-lateral", name: "Elevación lateral", group: "Tren superior", min: 10, max: 15, inc: 2, sets: [{ weight: 8, reps: 15 }, { weight: 8, reps: 13 }] }] },
    ],
  };

  const result = migrateGymCoachState(source, "user-1");
  const lateral = result.state.customExercises.find((exercise) => exercise.name === "Elevación lateral");
  const routine = result.state.routines.find((entry) => entry.id === "gym-coach-latest");

  assert.equal(result.state.customExercises.length, 2);
  assert.equal(lateral.muscle, "shoulders");
  assert.deepEqual(lateral.legacyPlan, { sourceId: "elevacion-lateral", group: "Tren superior", weight: 8, minReps: 10, maxReps: 15, increment: 2, rir: null, pain: 5, technique: null });
  assert.equal(routine.sourceDate, "2026-09-08T10:00:00.000Z");
  assert.deepEqual(routine.exercises[0], { exerciseId: lateral.id, targetSets: 2, targetReps: 15, minReps: 10, targetSeconds: undefined, increment: 2, progression: "double", supersetGroup: null });
});

test("actualiza el plan de ejercicios y la rutina más reciente sin duplicarlos", () => {
  const current = createInitialState("user-1");
  current.customExercises.push({ id: "custom-elevacion-lateral", name: "Elevación lateral", muscle: "other", measurement: "reps", weightMode: "standard", legacyPlan: { weight: 6 } });
  current.routines.push({ id: "gym-coach-latest", name: "Último entrenamiento de Gym Coach", importedFrom: "gym-coach-latest", sourceDate: "2026-09-01", exercises: [] });
  const source = {
    exercises: [{ id: "elevacion-lateral", name: "Elevación lateral", group: "Tren superior", weight: 8, min: 10, max: 15, inc: 2 }],
    history: [{ date: "2026-09-08T10:00:00.000Z", exercises: [{ id: "elevacion-lateral", name: "Elevación lateral", group: "Tren superior", min: 10, max: 15, inc: 2, sets: [{ weight: 8, reps: 13 }] }] }],
  };

  const result = mergeGymCoachState(source, current);
  const lateral = result.state.customExercises.find((exercise) => exercise.name === "Elevación lateral");
  const routines = result.state.routines.filter((routine) => routine.id === "gym-coach-latest");

  assert.equal(result.report.customExercises, 0);
  assert.equal(result.report.updatedExercises, 1);
  assert.equal(result.report.routines, 0);
  assert.equal(result.report.updatedRoutines, 1);
  assert.equal(lateral.muscle, "shoulders");
  assert.equal(lateral.legacyPlan.weight, 8);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].sourceDate, "2026-09-08T10:00:00.000Z");
  assert.equal(routines[0].exercises[0].exerciseId, lateral.id);
});

test("no confunde sesiones sin id importadas en lotes distintos", () => {
  const current = migrateGymCoachState({ history: [{ date: "2026-08-20T10:00:00.000Z", exercises: [] }] }, "user-1").state;
  const result = mergeGymCoachState({ history: [{ date: "2026-09-08T10:00:00.000Z", exercises: [] }] }, current);

  assert.equal(result.report.workouts, 1);
  assert.equal(result.report.duplicates, 0);
  assert.deepEqual(result.state.workouts.map((workout) => workout.date), ["2026-08-20T10:00:00.000Z", "2026-09-08T10:00:00.000Z"]);
});

test("normaliza sustituciones sin duplicados y las conserva en la rutina", () => {
  const state = createInitialState("user-1");
  state.routines[0].exercises[0].substitutionExerciseIds = ["seated-row", "seated-row", "dumbbell-curl"];

  const normalized = normalizeState(state);
  const entry = normalized.routines[0].exercises[0];

  assert.deepEqual(entry.substitutionExerciseIds, ["seated-row", "dumbbell-curl"]);
});
