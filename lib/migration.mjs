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

const LEGACY_LATEST_ROUTINE_ID = "gym-coach-latest";

const muscleFromLegacy = (exercise) => {
  const value = normalize(`${exercise?.group ?? ""} ${exercise?.name ?? exercise?.exerciseName ?? ""}`);
  if (/abdominal|core|plancha/.test(value)) return "core";
  if (/femoral/.test(value)) return "hamstrings";
  if (/abduccion/.test(value)) return "abductors";
  if (/triceps/.test(value)) return "triceps";
  if (/pierna|rodilla|sentadilla|prensa/.test(value)) return "quads";
  if (/biceps|curl/.test(value)) return "biceps";
  if (/hombro|lateral/.test(value)) return "shoulders";
  if (/encogimiento/.test(value)) return "traps";
  if (/pecho|mariposa/.test(value)) return "chest";
  if (/remo|jalon|espalda|polea/.test(value)) return "back";
  return "other";
};

const legacyPlan = (exercise) => ({
  sourceId: exercise?.id == null ? null : String(exercise.id),
  group: exercise?.group ?? null,
  weight: Number(exercise?.weight ?? 0),
  minReps: exercise?.min == null ? null : Number(exercise.min),
  maxReps: exercise?.max == null ? null : Number(exercise.max),
  increment: exercise?.inc == null ? null : Number(exercise.inc),
  rir: exercise?.rir == null ? null : Number(exercise.rir),
  pain: exercise?.pain == null ? null : Number(exercise.pain),
  technique: exercise?.tech ?? null,
});

const latestHistory = (source) => [...(source?.history ?? source?.workouts ?? source?.sessions ?? [])]
  .filter((workout) => workout?.date ?? workout?.startedAt)
  .sort((a, b) => String(b.date ?? b.startedAt).localeCompare(String(a.date ?? a.startedAt)))[0] ?? null;

const legacyWorkoutId = (workout) => {
  if (workout?.id != null) return String(workout.id);
  const date = String(workout?.date ?? workout?.startedAt ?? "unknown-date").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `legacy-${date || "unknown-date"}`;
};

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
  const report = { workouts: 0, exercises: 0, sets: 0, customExercises: 0, updatedExercises: 0, routines: 0, updatedRoutines: 0, assignments: 0, bodyweight: 0, duplicates: 0, conflicts: 0, dropped: 0, warnings: [] };

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
        const measurement = legacyExercise?.measurement ?? (legacyExercise?.metric === "time" || legacyExercise?.sets?.some((set) => set?.minutes != null || set?.seconds != null) ? "time" : "reps");
        exercise = {
          id,
          name,
          muscle: legacyExercise?.muscle ?? muscleFromLegacy(legacyExercise),
          measurement,
          weightMode: legacyExercise?.weightMode ?? (measurement === "time" ? "none" : "standard"),
          description: legacyExercise?.description ?? "Importado desde Gym Coach",
          legacyPlan: legacyPlan(legacyExercise),
        };
        state.customExercises.push(exercise);
        report.customExercises += 1;
        report.warnings.push(`Ejercicio personalizado creado: ${name}`);
      }
    }
    return exercise;
  };

  // La lista superior de Gym Coach contiene el plan vigente, incluso para
  // ejercicios que todavía no aparecen en el historial exportado.
  for (const legacyExercise of source?.exercises ?? []) resolveExercise(legacyExercise);

  for (const legacyWorkout of source?.workouts ?? source?.sessions ?? source?.history ?? []) {
    const migratedWorkout = {
      id: legacyWorkoutId(legacyWorkout),
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
        const rawSet = typeof set === "number" ? { reps: set } : (set ?? {});
        const migrated = {
          id: String(rawSet.id ?? `${migratedWorkout.id}-${exercise.id}-${index + 1}`),
          completed: rawSet.completed ?? true,
          notes: rawSet.notes ?? legacyExercise.notes ?? "",
        };
        if (exercise.measurement === "time" || rawSet.seconds != null || rawSet.minutes != null) {
          migrated.seconds = rawSet.seconds != null
            ? Number(rawSet.seconds)
            : Math.round(Number(rawSet.minutes ?? rawSet.reps ?? 0) * 60);
          if (rawSet.weight != null || legacyExercise.weight != null) migrated.weight = Number(rawSet.weight ?? legacyExercise.weight);
        } else {
          migrated.weight = Number(rawSet.weight ?? legacyExercise.weight ?? 0);
          migrated.reps = Number(rawSet.reps ?? 0);
          if (rawSet.rir != null) migrated.rir = Number(rawSet.rir);
          if (rawSet.rpe != null) migrated.rpe = Number(rawSet.rpe);
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

  const latest = latestHistory(source);
  if (latest?.exercises?.length) {
    const date = String(latest.date ?? latest.startedAt);
    state.routines.push({
      id: LEGACY_LATEST_ROUTINE_ID,
      name: "Último entrenamiento de Gym Coach",
      color: "amber",
      progression: "off",
      increment: 2.5,
      timeIncrement: 5,
      importedFrom: "gym-coach-latest",
      sourceDate: date,
      exercises: latest.exercises.map((legacyExercise) => {
        const exercise = resolveExercise(legacyExercise);
        const timed = exercise.measurement === "time";
        const sets = legacyExercise.sets ?? [];
        const lastSet = typeof sets.at(-1) === "number" ? { reps: sets.at(-1) } : (sets.at(-1) ?? {});
        return {
          exerciseId: exercise.id,
          targetSets: Math.max(1, sets.length || 3),
          targetReps: timed ? undefined : Number(legacyExercise.max ?? lastSet.reps ?? 10),
          minReps: timed ? undefined : Number(legacyExercise.min ?? Math.max(1, Number(lastSet.reps ?? 10) - 2)),
          targetSeconds: timed ? (lastSet.seconds != null ? Number(lastSet.seconds) : Math.round(Number(lastSet.minutes ?? lastSet.reps ?? legacyExercise.min ?? 0) * 60)) : undefined,
          increment: Number(legacyExercise.inc ?? (timed ? 5 : 2.5)),
          progression: timed ? "time" : "double",
          supersetGroup: null,
        };
      }),
    });
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
  let updatedExercises = 0;
  for (const exercise of imported.customExercises) {
    const existing = (merged.customExercises ?? []).find((entry) => entry.id === exercise.id) ?? customByName.get(normalize(exercise.name));
    if (existing) {
      exerciseRemap.set(exercise.id, existing.id);
      const nextPlan = exercise.legacyPlan;
      if (nextPlan && JSON.stringify(existing.legacyPlan ?? null) !== JSON.stringify(nextPlan)) {
        existing.legacyPlan = nextPlan;
        if (!existing.muscle || existing.muscle === "other") existing.muscle = exercise.muscle;
        if (!existing.measurement) existing.measurement = exercise.measurement;
        if (!existing.weightMode) existing.weightMode = exercise.weightMode;
        updatedExercises += 1;
      }
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
  let updatedRoutines = 0;
  for (const routine of imported.routines) {
    const existingById = (merged.routines ?? []).find((entry) => entry.id === routine.id);
    const existingByName = routineByName.get(normalize(routine.name));
    const existing = existingById ?? existingByName;
    if (existing) {
      routineRemap.set(routine.id, existing.id);
      if (routine.importedFrom === "gym-coach-latest" && existing.importedFrom === "gym-coach-latest") {
        Object.assign(existing, routine, {
          id: existing.id,
          exercises: routine.exercises.map((entry) => ({ ...entry, exerciseId: remapExercise(entry.exerciseId) })),
        });
        updatedRoutines += 1;
        continue;
      }
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
      updatedExercises,
      routines: addedRoutines,
      updatedRoutines,
      assignments: addedAssignments,
      bodyweight: addedBodyweight,
    },
  };
}
