import { createInitialState } from "./domain.mjs";

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const stableId = (name) => `custom-${normalize(name).replace(/\s+/g, "-") || "exercise"}`;

const EMPTY_WEEK = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
};

const uniqueId = (preferred, used, prefix) => {
  const base = String(preferred || `${prefix}-imported`);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

const workoutFingerprint = (workout) => JSON.stringify([
  String(workout?.date ?? ""),
  normalize(workout?.name),
  (workout?.exercises ?? []).map((entry) => [
    String(entry.exerciseId ?? ""),
    (entry.sets ?? []).map((set) => [
      Number(set.weight ?? 0), Number(set.reps ?? 0), Number(set.seconds ?? 0),
      set.rir == null ? null : Number(set.rir), set.rpe == null ? null : Number(set.rpe),
    ]),
  ]),
]);

const bodyweightFingerprint = (entry) => `${String(entry?.date ?? "")}|${Number(entry?.weight ?? 0)}`;

export function migrateGymCoachState(source, userId) {
  const state = createInitialState(userId);
  state.workouts = [];
  state.bodyweight = [];
  state.customExercises = [];
  state.routines = [];
  state.weekPlan = { ...EMPTY_WEEK };
  state.dayOverrides = {};

  const byName = new Map(state.exercises.map((exercise) => [normalize(exercise.name), exercise]));
  const aliases = new Map([
    ["plancha", "plank"],
    ["sentadilla isometrica en pared", "wall-sit"],
    ["triceps en polea con barra pushdown", "bar-pushdown"],
    ["triceps con cuerda por encima de la cabeza", "rope-overhead"],
    ["encogimientos de hombros con mancuernas", "dumbbell-shrug"],
  ]);
  const byId = new Map(state.exercises.map((exercise) => [exercise.id, exercise]));
  const report = { workouts: 0, exercises: 0, sets: 0, customExercises: 0, routines: 0, assignments: 0, bodyweight: 0, duplicates: 0, conflicts: 0, dropped: 0, warnings: [] };

  const resolveExercise = (legacyExercise) => {
    const normalizedName = normalize(legacyExercise?.name ?? legacyExercise?.exerciseName);
    const directId = legacyExercise?.exerciseId && byId.get(String(legacyExercise.exerciseId));
    const aliasId = aliases.get(normalizedName);
    let exercise = directId ?? byName.get(normalizedName) ?? (aliasId ? byId.get(aliasId) : null);

    if (!exercise) {
      const name = String(legacyExercise?.name ?? legacyExercise?.exerciseName ?? "Ejercicio sin nombre");
      const id = stableId(name);
      exercise = state.customExercises.find((entry) => entry.id === id);
      if (!exercise) {
        exercise = {
          id,
          name,
          muscle: legacyExercise?.muscle ?? "other",
          measurement: legacyExercise?.measurement ?? (legacyExercise?.sets?.some((set) => set.minutes != null || set.seconds != null) ? "time" : "reps"),
          weightMode: legacyExercise?.weightMode ?? "standard",
          description: legacyExercise?.description ?? "Importado desde Gym Coach",
        };
        state.customExercises.push(exercise);
        report.customExercises += 1;
        report.warnings.push(`Ejercicio personalizado creado: ${name}`);
      }
    }
    return exercise;
  };

  for (const legacyWorkout of source?.workouts ?? source?.sessions ?? []) {
    const migratedWorkout = {
      id: String(legacyWorkout.id ?? `legacy-${report.workouts + 1}`),
      routineId: legacyWorkout.routineId ?? null,
      name: legacyWorkout.name ?? legacyWorkout.routineName ?? "Entrenamiento importado",
      date: legacyWorkout.date ?? legacyWorkout.startedAt ?? "1970-01-01T00:00:00.000Z",
      durationSeconds: Number(legacyWorkout.durationSeconds ?? 0),
      notes: legacyWorkout.notes ?? "",
      exercises: [],
    };

    for (const legacyExercise of legacyWorkout.exercises ?? []) {
      const exercise = resolveExercise(legacyExercise);

      const sets = (legacyExercise.sets ?? []).map((set, index) => {
        const migrated = {
          id: String(set.id ?? `${migratedWorkout.id}-${exercise.id}-${index + 1}`),
          completed: set.completed ?? true,
          notes: set.notes ?? legacyExercise.notes ?? "",
        };
        if (exercise.measurement === "time" || set.seconds != null || set.minutes != null) {
          migrated.seconds = set.seconds != null ? Number(set.seconds) : Math.round(Number(set.minutes ?? 0) * 60);
          if (set.weight != null) migrated.weight = Number(set.weight);
        } else {
          migrated.weight = Number(set.weight ?? 0);
          migrated.reps = Number(set.reps ?? 0);
          if (set.rir != null) migrated.rir = Number(set.rir);
          if (set.rpe != null) migrated.rpe = Number(set.rpe);
        }
        return migrated;
      });

      migratedWorkout.exercises.push({ exerciseId: exercise.id, notes: legacyExercise.notes ?? "", sets });
      report.exercises += 1;
      report.sets += sets.length;
    }

    state.workouts.push(migratedWorkout);
    report.workouts += 1;
  }

  const routineIds = new Set();
  for (const legacyRoutine of source?.routines ?? source?.plans ?? []) {
    const id = uniqueId(legacyRoutine?.id ?? `imported-routine-${report.routines + 1}`, routineIds, "routine");
    routineIds.add(id);
    const routine = {
      ...legacyRoutine,
      id,
      name: String(legacyRoutine?.name ?? legacyRoutine?.title ?? "Rutina importada"),
      progression: legacyRoutine?.progression ?? "off",
      exercises: [],
    };
    for (const legacyEntry of legacyRoutine?.exercises ?? []) {
      const exercise = resolveExercise(legacyEntry);
      routine.exercises.push({
        ...legacyEntry,
        exerciseId: exercise.id,
        targetSets: Number(legacyEntry.targetSets ?? legacyEntry.sets ?? 3),
        targetReps: legacyEntry.targetReps == null && exercise.measurement !== "time" ? Number(legacyEntry.reps ?? 10) : legacyEntry.targetReps,
        targetSeconds: legacyEntry.targetSeconds == null && exercise.measurement === "time" ? Number(legacyEntry.seconds ?? (Math.round(Number(legacyEntry.minutes ?? 0) * 60) || 30)) : legacyEntry.targetSeconds,
        progression: legacyEntry.progression ?? "off",
        supersetGroup: legacyEntry.supersetGroup ?? null,
      });
    }
    state.routines.push(routine);
    report.routines += 1;
  }

  const importedWeek = source?.weekPlan ?? source?.week ?? {};
  for (const day of Object.keys(EMPTY_WEEK)) {
    const value = importedWeek?.[day];
    if (value == null) continue;
    state.weekPlan[day] = String(value);
    report.assignments += 1;
  }
  state.dayOverrides = { ...(source?.dayOverrides ?? source?.dayPlan ?? {}) };

  state.bodyweight = (source?.bodyweight ?? source?.bodyWeight ?? []).map((entry, index) => ({
    id: String(entry.id ?? `imported-weight-${index + 1}`),
    date: entry.date ?? "1970-01-01T00:00:00.000Z",
    weight: Number(entry.weight ?? entry.value ?? 0),
  }));
  report.bodyweight = state.bodyweight.length;
  state.updatedAt = source?.exportedAt ?? state.workouts.at(-1)?.date ?? "1970-01-01T00:00:00.000Z";

  return { state, report };
}

export function mergeGymCoachState(source, currentState) {
  const { state: imported, report } = migrateGymCoachState(source, currentState?.userId ?? "demo-user");
  const merged = structuredClone(currentState);

  const customByName = new Map((merged.customExercises ?? []).map((exercise) => [normalize(exercise.name), exercise]));
  const usedExerciseIds = new Set([...(merged.exercises ?? []), ...(merged.customExercises ?? [])].map((exercise) => String(exercise.id)));
  const exerciseRemap = new Map();
  let addedCustomExercises = 0;
  for (const exercise of imported.customExercises) {
    const existing = (merged.customExercises ?? []).find((entry) => entry.id === exercise.id) ?? customByName.get(normalize(exercise.name));
    if (existing) {
      exerciseRemap.set(exercise.id, existing.id);
      continue;
    }
    const id = uniqueId(exercise.id, usedExerciseIds, "custom-exercise");
    usedExerciseIds.add(id);
    const next = { ...exercise, id };
    merged.customExercises.push(next);
    customByName.set(normalize(next.name), next);
    exerciseRemap.set(exercise.id, id);
    addedCustomExercises += 1;
  }

  const remapExercise = (id) => exerciseRemap.get(id) ?? id;
  const usedRoutineIds = new Set((merged.routines ?? []).map((routine) => String(routine.id)));
  const routineByName = new Map((merged.routines ?? []).map((routine) => [normalize(routine.name), routine]));
  const routineRemap = new Map();
  let addedRoutines = 0;
  for (const routine of imported.routines) {
    const existingByName = routineByName.get(normalize(routine.name));
    if (existingByName) {
      routineRemap.set(routine.id, existingByName.id);
      report.duplicates += 1;
      continue;
    }
    const id = uniqueId(routine.id, usedRoutineIds, "routine");
    usedRoutineIds.add(id);
    const next = { ...routine, id, exercises: routine.exercises.map((entry) => ({ ...entry, exerciseId: remapExercise(entry.exerciseId) })) };
    merged.routines.push(next);
    routineByName.set(normalize(next.name), next);
    routineRemap.set(routine.id, id);
    addedRoutines += 1;
  }

  const existingWorkoutIds = new Set((merged.workouts ?? []).map((workout) => String(workout.id)));
  const existingWorkoutFingerprints = new Set((merged.workouts ?? []).map(workoutFingerprint));
  let addedWorkouts = 0;
  let addedSets = 0;
  for (const workout of imported.workouts) {
    const remapped = {
      ...workout,
      routineId: routineRemap.get(workout.routineId) ?? workout.routineId,
      exercises: workout.exercises.map((entry) => ({ ...entry, exerciseId: remapExercise(entry.exerciseId) })),
    };
    if (existingWorkoutIds.has(String(remapped.id)) || existingWorkoutFingerprints.has(workoutFingerprint(remapped))) {
      report.duplicates += 1;
      continue;
    }
    const id = uniqueId(remapped.id, existingWorkoutIds, "workout");
    existingWorkoutIds.add(id);
    const next = { ...remapped, id };
    existingWorkoutFingerprints.add(workoutFingerprint(next));
    merged.workouts.push(next);
    addedWorkouts += 1;
    addedSets += next.exercises.reduce((total, entry) => total + (entry.sets?.length ?? 0), 0);
  }

  const existingWeightIds = new Set((merged.bodyweight ?? []).map((entry) => String(entry.id)));
  const existingWeightFingerprints = new Set((merged.bodyweight ?? []).map(bodyweightFingerprint));
  let addedBodyweight = 0;
  for (const entry of imported.bodyweight) {
    if (existingWeightIds.has(String(entry.id)) || existingWeightFingerprints.has(bodyweightFingerprint(entry))) {
      report.duplicates += 1;
      continue;
    }
    const id = uniqueId(entry.id, existingWeightIds, "bodyweight");
    existingWeightIds.add(id);
    merged.bodyweight.push({ ...entry, id });
    existingWeightFingerprints.add(bodyweightFingerprint(entry));
    addedBodyweight += 1;
  }

  let addedAssignments = 0;
  for (const day of Object.keys(EMPTY_WEEK)) {
    const importedRoutineId = imported.weekPlan?.[day];
    if (!importedRoutineId) continue;
    const mapped = routineRemap.get(importedRoutineId) ?? importedRoutineId;
    if (!merged.weekPlan?.[day]) {
      merged.weekPlan[day] = mapped;
      addedAssignments += 1;
    } else if (merged.weekPlan[day] !== mapped) {
      report.conflicts += 1;
      report.warnings.push(`Se conservó la asignación existente de ${day}.`);
    }
  }
  for (const [date, routineId] of Object.entries(imported.dayOverrides ?? {})) {
    const mapped = routineRemap.get(routineId) ?? routineId;
    if (!(date in (merged.dayOverrides ?? {}))) merged.dayOverrides[date] = mapped;
    else if (merged.dayOverrides[date] !== mapped) report.conflicts += 1;
  }

  merged.workouts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  merged.bodyweight.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  merged.updatedAt = new Date().toISOString();

  return {
    state: merged,
    report: {
      ...report,
      workouts: addedWorkouts,
      sets: addedSets,
      customExercises: addedCustomExercises,
      routines: addedRoutines,
      assignments: addedAssignments,
      bodyweight: addedBodyweight,
    },
  };
}
