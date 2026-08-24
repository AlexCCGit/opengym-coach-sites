import { createInitialState } from "./domain.mjs";

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const stableId = (name) => `custom-${normalize(name).replace(/\s+/g, "-") || "exercise"}`;

export function migrateGymCoachState(source, userId) {
  const state = createInitialState(userId);
  state.workouts = [];
  state.bodyweight = [];
  state.customExercises = [];

  const byName = new Map(state.exercises.map((exercise) => [normalize(exercise.name), exercise]));
  const aliases = new Map([
    ["plancha", "plank"],
    ["sentadilla isometrica en pared", "wall-sit"],
    ["triceps en polea con barra pushdown", "bar-pushdown"],
    ["triceps con cuerda por encima de la cabeza", "rope-overhead"],
    ["encogimientos de hombros con mancuernas", "dumbbell-shrug"],
  ]);
  const byId = new Map(state.exercises.map((exercise) => [exercise.id, exercise]));
  const report = { workouts: 0, exercises: 0, sets: 0, customExercises: 0, dropped: 0, warnings: [] };

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
      const normalizedName = normalize(legacyExercise.name ?? legacyExercise.exerciseName);
      const directId = legacyExercise.exerciseId && byId.get(String(legacyExercise.exerciseId));
      const aliasId = aliases.get(normalizedName);
      let exercise = directId ?? byName.get(normalizedName) ?? (aliasId ? byId.get(aliasId) : null);

      if (!exercise) {
        const name = String(legacyExercise.name ?? legacyExercise.exerciseName ?? "Ejercicio sin nombre");
        const id = stableId(name);
        exercise = state.customExercises.find((entry) => entry.id === id);
        if (!exercise) {
          exercise = {
            id,
            name,
            muscle: legacyExercise.muscle ?? "other",
            measurement: legacyExercise.measurement ?? (legacyExercise.sets?.some((set) => set.minutes != null || set.seconds != null) ? "time" : "reps"),
            weightMode: legacyExercise.weightMode ?? "standard",
            description: legacyExercise.description ?? "Importado desde Gym Coach",
          };
          state.customExercises.push(exercise);
          report.customExercises += 1;
          report.warnings.push(`Ejercicio personalizado creado: ${name}`);
        }
      }

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

  state.bodyweight = (source?.bodyweight ?? source?.bodyWeight ?? []).map((entry, index) => ({
    id: String(entry.id ?? `imported-weight-${index + 1}`),
    date: entry.date ?? "1970-01-01T00:00:00.000Z",
    weight: Number(entry.weight ?? entry.value ?? 0),
  }));
  state.updatedAt = source?.exportedAt ?? state.workouts.at(-1)?.date ?? "1970-01-01T00:00:00.000Z";

  return { state, report };
}
