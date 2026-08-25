export const MODES = ["reps", "time", "cardio"];
export const PROGRESSION_POLICIES = ["off", "linear", "greyskull", "double", "time"];

export function exerciseMode(exercise) {
  const mode = exercise?.measurement ?? exercise?.mode ?? "reps";
  return MODES.includes(mode) ? mode : "reps";
}

export function normalizeEffort(set) {
  if (Number.isFinite(Number(set?.rir))) return clamp(Number(set.rir), 0, 10);
  if (Number.isFinite(Number(set?.rpe))) return clamp(10 - Number(set.rpe), 0, 10);
  return null;
}

export function summarizeEffort(workouts) {
  const completed = (workouts ?? []).flatMap((workout) => workout.exercises ?? [])
    .flatMap((exercise) => exercise.sets ?? []).filter((set) => set.completed !== false);
  const values = completed.map(normalizeEffort).filter((value) => value != null);
  const histogram = { easy: 0, productive: 0, hard: 0, failure: 0 };
  for (const value of values) {
    if (value === 0) histogram.failure += 1;
    else if (value <= 2) histogram.hard += 1;
    else if (value <= 4) histogram.productive += 1;
    else histogram.easy += 1;
  }
  return {
    trackedSets: values.length,
    totalSets: completed.length,
    coverage: completed.length ? values.length / completed.length : 0,
    averageRir: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    hardSets: values.filter((value) => value <= 2).length,
    histogram,
  };
}

export function supersetUnits(entries) {
  const units = [];
  const groups = new Map();
  for (const entry of entries ?? []) {
    if (!entry.supersetGroup) {
      units.push([entry]);
      continue;
    }
    if (!groups.has(entry.supersetGroup)) {
      const unit = [];
      groups.set(entry.supersetGroup, unit);
      units.push(unit);
    }
    groups.get(entry.supersetGroup).push(entry);
  }
  return units;
}

export function recommendProgression({ policy = "off", mode = "reps", previousSets = [], targetReps = 10, targetSeconds = 30, increment = 2.5, stalls = 0 }) {
  const completed = previousSets.filter((set) => set.completed !== false);
  const last = completed.at(-1) ?? {};
  const weight = Number(last.weight ?? 0);
  const reps = Number(last.reps ?? 0);
  const seconds = Number(last.seconds ?? 0);
  const result = { policy, weight, reps: targetReps, seconds: targetSeconds, deload: false, reason: "Sin progresión automática" };

  if (policy === "off" || !completed.length) return result;
  if (stalls >= 3 && weight > 0) {
    return { ...result, weight: roundTo(weight * 0.9, increment), deload: true, reason: "Descarga del 10 % tras tres estancamientos" };
  }
  if (mode === "time" || policy === "time") {
    const hit = completed.every((set) => Number(set.seconds ?? 0) >= targetSeconds);
    return { ...result, seconds: hit ? targetSeconds + 5 : Math.max(seconds, targetSeconds), reason: hit ? "Objetivo temporal superado" : "Repite el objetivo temporal" };
  }
  if (policy === "double") {
    const min = Math.max(1, targetReps - 2);
    const hitTop = completed.every((set) => Number(set.reps ?? 0) >= targetReps);
    return { ...result, weight: hitTop ? weight + increment : weight, reps: hitTop ? min : Math.max(min, reps + 1), reason: hitTop ? "Rango completo: aumenta carga" : "Progresa dentro del rango" };
  }
  const targetHit = completed.every((set) => Number(set.reps ?? 0) >= targetReps);
  if (policy === "greyskull") {
    const amrap = Number(last.reps ?? 0);
    const jump = amrap >= targetReps * 2 ? increment * 2 : increment;
    return { ...result, weight: targetHit ? weight + jump : weight, reason: targetHit ? (jump > increment ? "AMRAP duplicó el objetivo" : "Objetivo Greyskull superado") : "Repite la carga" };
  }
  return { ...result, weight: targetHit ? weight + increment : weight, reason: targetHit ? "Objetivo lineal superado" : "Repite la carga" };
}

export function detectPersonalRecords(workouts, candidate) {
  const best = new Map();
  for (const workout of workouts ?? []) for (const entry of workout.exercises ?? []) for (const set of entry.sets ?? []) {
    const score = setScore(set);
    if (score > (best.get(entry.exerciseId) ?? -Infinity)) best.set(entry.exerciseId, score);
  }
  const records = [];
  for (const entry of candidate?.exercises ?? []) for (const set of entry.sets ?? []) {
    if (set.completed === false) continue;
    const score = setScore(set);
    if (score > (best.get(entry.exerciseId) ?? -Infinity)) {
      best.set(entry.exerciseId, score);
      records.push({ exerciseId: entry.exerciseId, setId: set.id, score });
    }
  }
  return records;
}

export function updateProgressionState(current = {}, workout) {
  const next = { ...current };
  for (const entry of workout?.exercises ?? []) {
    const prescription = entry.progression;
    if (!prescription || prescription.policy === "off") continue;
    const completed = (entry.sets ?? []).filter((set) => set.completed !== false);
    const hit = completed.length > 0 && completed.every((set) => {
      if (prescription.policy === "time") return Number(set.seconds ?? 0) >= Number(prescription.seconds ?? 0);
      return Number(set.reps ?? 0) >= Number(prescription.reps ?? 0);
    });
    const previous = next[entry.exerciseId] ?? { stalls: 0, sessions: 0 };
    next[entry.exerciseId] = { stalls: hit ? 0 : previous.stalls + 1, sessions: previous.sessions + 1, lastCompletedAt: workout.date, lastTargetHit: hit };
  }
  return next;
}

function setScore(set) {
  if (set.minutes != null || set.speed != null) return Number(set.minutes ?? 0) * Math.max(1, Number(set.speed ?? 1));
  if (set.seconds != null && set.reps == null) return Number(set.seconds ?? 0) * Math.max(1, Number(set.weight ?? 1));
  return Number(set.weight ?? 0) * (1 + Number(set.reps ?? 0) / 30);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;
const roundTo = (value, step) => Math.round(value / step) * step;
