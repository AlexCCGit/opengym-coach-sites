import { muscleFrequency } from "./analytics.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function planFingerprint(state) {
  return JSON.stringify({ routines: state.routines ?? [], weekPlan: state.weekPlan ?? {}, dayOverrides: state.dayOverrides ?? {} });
}

export function designPlanProposal(state, intake = {}) {
  const days = Math.max(1, Math.min(7, Number(intake.days ?? 3)));
  const available = [...(state.exercises ?? []), ...(state.customExercises ?? [])]
    .filter((exercise) => !intake.equipment?.length || intake.equipment.includes(exercise.equipment) || exercise.weightMode === "none");
  const pool = available.length ? available : [...(state.exercises ?? []), ...(state.customExercises ?? [])];
  const routines = Array.from({ length: days }, (_, dayIndex) => ({
    id: `coach-${cryptoId()}-${dayIndex}`,
    name: `${intake.goal || "Plan completo"} ${dayIndex + 1}`,
    color: ["lime", "violet", "amber", "blue", "green", "pink", "cyan"][dayIndex],
    progression: intake.experience === "beginner" ? "linear" : "double",
    exercises: pool.filter((_, index) => index % days === dayIndex).slice(0, 6).map((exercise) => ({
      exerciseId: exercise.id,
      targetSets: intake.sessionMinutes && Number(intake.sessionMinutes) <= 35 ? 2 : 3,
      targetReps: exercise.measurement === "reps" ? 10 : undefined,
      targetSeconds: exercise.measurement === "time" ? 30 : undefined,
      progression: exercise.measurement === "time" ? "time" : intake.experience === "beginner" ? "linear" : "double",
      supersetGroup: null,
    })),
  })).filter((routine) => routine.exercises.length);
  const weekPlan = Object.fromEntries(DAYS.map((day) => [day, null]));
  const spacing = 7 / Math.max(1, routines.length);
  routines.forEach((routine, index) => { weekPlan[DAYS[Math.floor(index * spacing)]] = routine.id; });
  return proposal(state, "replace-plan", "Activar el plan diseñado", `Plan de ${routines.length} días adaptado al objetivo, experiencia y tiempo indicados.`, { routines, weekPlan });
}

export function reviewPlan(state) {
  const suggestions = [];
  for (const routine of state.routines ?? []) for (const entry of routine.exercises ?? []) {
    const progress = state.progression?.[entry.exerciseId];
    if (Number(progress?.stalls ?? 0) >= 3 && Number(entry.targetSets ?? 3) > 1) {
      suggestions.push(proposal(state, "update-entry", `Reducir una serie en ${exerciseName(state, entry.exerciseId)}`, "Tres sesiones estancadas sugieren bajar fatiga sin borrar el historial.", { routineId: routine.id, exerciseId: entry.exerciseId, patch: { targetSets: Number(entry.targetSets ?? 3) - 1 } }));
    }
  }
  const frequency = muscleFrequency(state, 28);
  const untrained = ["chest", "back", "shoulders", "biceps", "triceps", "core", "quads", "hamstrings", "glutes"].filter((muscle) => !frequency[muscle]);
  const targetRoutine = [...(state.routines ?? [])].sort((a, b) => a.exercises.length - b.exercises.length)[0];
  for (const muscle of untrained.slice(0, 2)) {
    const exercise = [...(state.exercises ?? []), ...(state.customExercises ?? [])].find((item) => item.muscle === muscle || item.mainMuscle === muscle);
    if (exercise && targetRoutine && !targetRoutine.exercises.some((entry) => entry.exerciseId === exercise.id)) {
      suggestions.push(proposal(state, "add-exercise", `Añadir ${exercise.name}`, `${muscle} no registra trabajo en los últimos 28 días.`, { routineId: targetRoutine.id, entry: { exerciseId: exercise.id, targetSets: 2, targetReps: exercise.measurement === "reps" ? 10 : undefined, targetSeconds: exercise.measurement === "time" ? 30 : undefined, progression: exercise.measurement === "time" ? "time" : "double", supersetGroup: null } }));
    }
  }
  if (!suggestions.length) suggestions.push(proposal(state, "note", "Mantener el plan", "No hay estancamientos repetidos ni huecos musculares evidentes en los datos disponibles.", {}));
  return suggestions;
}

export function applyCoachSuggestions(state, suggestionIds) {
  const pending = state.coach?.suggestions ?? [];
  const selected = pending.filter((item) => suggestionIds.includes(item.id) && item.status === "pending");
  if (!selected.length) return state;
  let next = clone(state);
  const baseFingerprint = planFingerprint(state);
  const snapshot = { routines: clone(state.routines), weekPlan: clone(state.weekPlan), dayOverrides: clone(state.dayOverrides), createdAt: new Date().toISOString() };
  for (const item of selected) {
    if (item.baseFingerprint !== baseFingerprint && item.type !== "note") continue;
    next = applyOne(next, item);
  }
  const applied = new Set(selected.map((item) => item.id));
  next.coach = { ...(next.coach ?? {}), suggestions: pending.map((item) => applied.has(item.id) ? { ...item, status: "applied" } : item), undoSnapshot: snapshot, lastReviewWorkoutCount: state.workouts?.length ?? 0, updatedAt: new Date().toISOString() };
  return next;
}

export function dismissCoachSuggestion(state, suggestionId) {
  return { ...state, coach: { ...(state.coach ?? {}), suggestions: (state.coach?.suggestions ?? []).map((item) => item.id === suggestionId ? { ...item, status: "declined" } : item) } };
}

export function undoCoachChanges(state) {
  const snapshot = state.coach?.undoSnapshot;
  if (!snapshot) return state;
  return { ...state, routines: clone(snapshot.routines), weekPlan: clone(snapshot.weekPlan), dayOverrides: clone(snapshot.dayOverrides), coach: { ...state.coach, undoSnapshot: null, updatedAt: new Date().toISOString() } };
}

function applyOne(state, item) {
  if (item.type === "replace-plan") return { ...state, routines: clone(item.payload.routines), weekPlan: clone(item.payload.weekPlan), dayOverrides: {} };
  if (item.type === "update-entry") return { ...state, routines: state.routines.map((routine) => routine.id !== item.payload.routineId ? routine : ({ ...routine, exercises: routine.exercises.map((entry) => entry.exerciseId === item.payload.exerciseId ? { ...entry, ...item.payload.patch } : entry) })) };
  if (item.type === "add-exercise") return { ...state, routines: state.routines.map((routine) => routine.id !== item.payload.routineId ? routine : ({ ...routine, exercises: [...routine.exercises, clone(item.payload.entry)] })) };
  return state;
}

function proposal(state, type, title, reason, payload) {
  return { id: cryptoId(), type, title, reason, payload, status: "pending", baseFingerprint: planFingerprint(state), createdAt: new Date().toISOString() };
}

function exerciseName(state, id) {
  return [...(state.exercises ?? []), ...(state.customExercises ?? [])].find((exercise) => exercise.id === id)?.name ?? id;
}

function cryptoId() {
  return globalThis.crypto?.randomUUID?.() ?? `coach-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
