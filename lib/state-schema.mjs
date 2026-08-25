export const CURRENT_SCHEMA_VERSION = 2;

const WEEK = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
};

const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "lime",
  bodyMap: "male",
  restSeconds: 90,
  sound: true,
  keepAwake: true,
  promptBodyweight: true,
  gifSize: "full",
  effortTracking: "rir",
  reminder: { enabled: false, time: "08:00", timezone: null },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export function normalizeState(source, userId = source?.userId ?? "demo-user") {
  const input = source && typeof source === "object" ? source : {};
  const profile = input.profile && typeof input.profile === "object" ? input.profile : {};
  const settings = input.settings && typeof input.settings === "object" ? input.settings : {};

  return {
    ...clone(input),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    userId: String(input.userId ?? userId),
    profile: {
      locale: "es",
      weightUnit: "kg",
      dumbbellWeightIsPerHand: true,
      targetWeight: null,
      ...clone(profile),
    },
    settings: {
      ...clone(DEFAULT_SETTINGS),
      ...clone(settings),
      reminder: {
        ...clone(DEFAULT_SETTINGS.reminder),
        ...clone(settings.reminder ?? input.reminder ?? {}),
      },
    },
    exercises: Array.isArray(input.exercises) ? clone(input.exercises) : [],
    customExercises: Array.isArray(input.customExercises) ? clone(input.customExercises) : [],
    routines: Array.isArray(input.routines) ? input.routines.map(normalizeRoutine) : [],
    weekPlan: { ...WEEK, ...clone(input.weekPlan ?? input.week ?? {}) },
    dayOverrides: { ...clone(input.dayOverrides ?? input.dayPlan ?? {}) },
    workouts: Array.isArray(input.workouts) ? input.workouts.map(normalizeWorkout) : [],
    bodyweight: Array.isArray(input.bodyweight) ? clone(input.bodyweight) : [],
    progression: { ...clone(input.progression ?? {}) },
    coach: input.coach ?? null,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

function normalizeRoutine(routine) {
  return {
    progression: "off",
    increment: 2.5,
    timeIncrement: 5,
    ...clone(routine),
    exercises: Array.isArray(routine?.exercises)
      ? routine.exercises.map((entry) => ({
          progression: "off",
          supersetGroup: null,
          ...clone(entry),
        }))
      : [],
  };
}

function normalizeWorkout(workout) {
  return {
    ...clone(workout),
    exercises: Array.isArray(workout?.exercises)
      ? workout.exercises.map((entry) => ({
          ...clone(entry),
          sets: Array.isArray(entry?.sets)
            ? entry.sets.map((set) => ({ completed: true, ...clone(set) }))
            : [],
        }))
      : [],
  };
}

export function exportPortableState(state) {
  const normalized = normalizeState(state);
  return {
    format: "opengym-coach",
    version: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    state: normalized,
  };
}

export function importPortableState(payload, userId) {
  const source = payload?.format === "opengym-coach" ? payload.state : payload;
  return normalizeState(source, userId);
}
