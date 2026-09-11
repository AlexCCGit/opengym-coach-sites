const nowIso = () => new Date().toISOString();

export function createInitialState(userId) {
  const exercises = [
    { id: "lat-pulldown", name: "Jalón al pecho", muscle: "back", measurement: "reps", weightMode: "stack" },
    { id: "seated-row", name: "Remo sentado", muscle: "back", measurement: "reps", weightMode: "stack" },
    { id: "dumbbell-curl", name: "Curl con mancuernas", muscle: "biceps", measurement: "reps", weightMode: "per-dumbbell" },
    { id: "bar-pushdown", name: "Tríceps en polea con barra (pushdown)", muscle: "triceps", measurement: "reps", weightMode: "stack" },
    { id: "rope-overhead", name: "Tríceps con cuerda por encima de la cabeza", muscle: "triceps", measurement: "reps", weightMode: "stack" },
    { id: "dumbbell-shrug", name: "Encogimientos de hombros con mancuernas", muscle: "traps", measurement: "reps", weightMode: "per-dumbbell" },
    { id: "plank", name: "Plancha", muscle: "core", measurement: "time", weightMode: "none", tracksReps: true, defaultRir: 2 },
    { id: "wall-sit", name: "Sentadilla isométrica en pared", muscle: "quads", measurement: "time", weightMode: "none" },
  ];

  const workout = {
    id: "workout-demo-1",
    routineId: "routine-pull-a",
    name: "Tirón A",
    date: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    durationSeconds: 2_940,
    notes: "Sesión inicial de ejemplo",
    exercises: [
      {
        exerciseId: "lat-pulldown",
        sets: [
          { id: "set-1", weight: 52.5, reps: 10, rir: 2, completed: true },
          { id: "set-2", weight: 52.5, reps: 9, rir: 1, completed: true },
          { id: "set-3", weight: 50, reps: 10, rir: 1, completed: true },
        ],
      },
      {
        exerciseId: "dumbbell-curl",
        sets: [
          { id: "set-4", weight: 12, reps: 10, rir: 2, completed: true },
          { id: "set-5", weight: 12, reps: 9, rir: 1, completed: true },
        ],
      },
    ],
  };

  return {
    schemaVersion: 2,
    userId,
    profile: { locale: "es", weightUnit: "kg", dumbbellWeightIsPerHand: true, targetWeight: null },
    settings: {
      theme: "dark", accent: "lime", bodyMap: "male", restSeconds: 90,
      sound: true, keepAwake: true, promptBodyweight: true, gifSize: "full", effortTracking: "rir",
      reminder: { enabled: false, time: "08:00", timezone: null },
    },
    exercises,
    customExercises: [],
    routines: [
      {
        id: "routine-pull-a",
        name: "Tirón A",
        color: "lime",
        exercises: [
          { exerciseId: "lat-pulldown", targetSets: 3, targetReps: 10, progression: "linear", supersetGroup: null },
          { exerciseId: "seated-row", targetSets: 3, targetReps: 10, progression: "double", supersetGroup: null },
          { exerciseId: "dumbbell-curl", targetSets: 3, targetReps: 10, progression: "double", supersetGroup: "arms-a" },
          { exerciseId: "dumbbell-shrug", targetSets: 3, targetReps: 12, progression: "linear", supersetGroup: "arms-a" },
        ],
      },
      {
        id: "routine-core",
        name: "Core y estabilidad",
        color: "violet",
        exercises: [
          { exerciseId: "plank", targetSets: 3, targetSeconds: 45, progression: "time", supersetGroup: null },
          { exerciseId: "wall-sit", targetSets: 3, targetSeconds: 60, progression: "time", supersetGroup: null },
        ],
      },
    ],
    weekPlan: {
      monday: "routine-pull-a",
      tuesday: null,
      wednesday: "routine-core",
      thursday: null,
      friday: "routine-pull-a",
      saturday: null,
      sunday: null,
    },
    dayOverrides: {},
    workouts: [workout],
    bodyweight: [
      { id: "bodyweight-1", date: new Date(Date.now() - 7 * 86_400_000).toISOString(), weight: 78.4 },
      { id: "bodyweight-2", date: nowIso(), weight: 78.1 },
    ],
    progression: {},
    coach: null,
    updatedAt: nowIso(),
  };
}

export function estimateOneRepMax({ weight, reps }) {
  const numericWeight = Number(weight);
  const numericReps = Number(reps);
  if (numericWeight <= 0 || numericReps <= 0 || numericReps > 12) return null;
  return Math.round(numericWeight * (1 + numericReps / 30) * 10) / 10;
}

export function prefillExercise(state, exerciseId) {
  for (const workout of [...state.workouts].sort((a, b) => b.date.localeCompare(a.date))) {
    const previous = workout.exercises.find((entry) => entry.exerciseId === exerciseId);
    if (previous) {
      return {
        exerciseId,
        sets: previous.sets.map((set, index) => ({
          ...set,
          id: `set-${Date.now()}-${index}`,
          completed: false,
        })),
      };
    }
  }
  return { exerciseId, sets: [{ id: `set-${Date.now()}-0`, weight: 0, reps: 10, completed: false }] };
}

export function getMuscleBalance(state) {
  const balance = { chest: 0, back: 0, shoulders: 0, biceps: 0, triceps: 0, traps: 0, core: 0, quads: 0 };
  const exerciseMap = new Map([...state.exercises, ...state.customExercises].map((exercise) => [exercise.id, exercise]));
  for (const workout of state.workouts) {
    for (const logged of workout.exercises) {
      const exercise = exerciseMap.get(logged.exerciseId);
      if (!exercise || !(exercise.muscle in balance)) continue;
      for (const set of logged.sets) {
        if (exercise.measurement === "time") {
          balance[exercise.muscle] += Number(set.seconds ?? 0);
        } else {
          balance[exercise.muscle] += Number(set.weight ?? 0) * Number(set.reps ?? 0);
        }
      }
    }
  }
  return balance;
}

export function getExercise(state, exerciseId) {
  const exercise = [...state.exercises, ...state.customExercises].find((entry) => entry.id === exerciseId) ?? null;
  if (!exercise) return null;
  return exerciseId === "plank" ? { ...exercise, measurement: "time", weightMode: "none", tracksReps: true, defaultRir: 2 } : exercise;
}

export function getEstimatedOneRepMaxes(state) {
  const best = {};
  for (const workout of state.workouts) {
    for (const logged of workout.exercises) {
      for (const set of logged.sets) {
        const estimate = estimateOneRepMax(set);
        if (estimate != null && estimate > (best[logged.exerciseId] ?? 0)) best[logged.exerciseId] = estimate;
      }
    }
  }
  return best;
}

export function getOneRepMaxHistory(state, exerciseId) {
  const history = [];
  let best = 0;
  for (const workout of [...state.workouts].sort((a, b) => a.date.localeCompare(b.date))) {
    const logged = workout.exercises.find((entry) => entry.exerciseId === exerciseId);
    if (!logged) continue;
    let sessionBest = null;
    let sourceSet = null;
    for (const set of logged.sets ?? []) {
      if (set.completed === false) continue;
      const estimate = estimateOneRepMax(set);
      if (estimate != null && (sessionBest == null || estimate > sessionBest)) {
        sessionBest = estimate;
        sourceSet = { weight: Number(set.weight), reps: Number(set.reps), id: set.id ?? null };
      }
    }
    if (sessionBest == null) continue;
    best = Math.max(best, sessionBest);
    history.push({ date: workout.date, estimate: sessionBest, best, sourceSet, workoutId: workout.id });
  }
  return history;
}

export function weightForTargetOneRepMax(oneRepMax, reps) {
  const numericMax = Number(oneRepMax);
  const numericReps = Number(reps);
  if (numericMax <= 0 || numericReps < 1 || numericReps > 12) return null;
  return Math.round(numericMax / (1 + numericReps / 30) * 10) / 10;
}
