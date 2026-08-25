export function activityHeatmap(workouts, days = 365, now = new Date()) {
  const end = startOfDay(now);
  const counts = new Map();
  const minutes = new Map();
  for (const workout of workouts ?? []) {
    const key = String(workout.date ?? "").slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    minutes.set(key, (minutes.get(key) ?? 0) + Math.max(1, Math.round(Number(workout.durationSeconds ?? 0) / 60)));
  }
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end.getTime() - (days - index - 1) * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    return { date: key, count: counts.get(key) ?? 0, minutes: minutes.get(key) ?? 0 };
  });
}

export function trainingStreak(workouts, now = new Date()) {
  const days = new Set((workouts ?? []).map((workout) => String(workout.date ?? "").slice(0, 10)));
  let cursor = startOfDay(now);
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor = new Date(cursor.getTime() - 86_400_000);
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) { streak += 1; cursor = new Date(cursor.getTime() - 86_400_000); }
  return streak;
}

export function weeklySummary(workouts, now = new Date()) {
  const since = now.getTime() - 7 * 86_400_000;
  const recent = (workouts ?? []).filter((workout) => new Date(workout.date).getTime() >= since);
  let sets = 0, volume = 0, cardioMinutes = 0, durationSeconds = 0;
  for (const workout of recent) {
    durationSeconds += Number(workout.durationSeconds ?? 0);
    for (const entry of workout.exercises ?? []) for (const set of entry.sets ?? []) {
      if (set.completed === false) continue;
      sets += 1;
      volume += Number(set.weight ?? 0) * Number(set.reps ?? 0);
      cardioMinutes += Number(set.minutes ?? 0);
    }
  }
  return { workouts: recent.length, sets, volume: Math.round(volume), cardioMinutes: Math.round(cardioMinutes * 10) / 10, durationMinutes: Math.round(durationSeconds / 60) };
}

export function muscleFrequency(state, days = 28, now = new Date()) {
  const exerciseMap = new Map([...state.exercises, ...state.customExercises].map((exercise) => [exercise.id, exercise]));
  const since = now.getTime() - days * 86_400_000;
  const result = {};
  for (const workout of state.workouts ?? []) {
    if (new Date(workout.date).getTime() < since) continue;
    for (const entry of workout.exercises ?? []) {
      const exercise = exerciseMap.get(entry.exerciseId);
      const muscles = [exercise?.muscle, exercise?.mainMuscle, ...(exercise?.secondaryMuscles ?? [])].filter(Boolean);
      for (const muscle of new Set(muscles)) result[muscle] = (result[muscle] ?? 0) + 1;
    }
  }
  return result;
}

const startOfDay = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
