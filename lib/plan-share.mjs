export function buildPlanBundle(state) {
  const referenced = new Set(state.routines.flatMap((routine) => routine.exercises.flatMap((entry) => [entry.exerciseId, ...(entry.substitutionExerciseIds ?? [])])));
  return { format: "opengym-plan", version: 1, routines: state.routines, weekPlan: state.weekPlan, customExercises: state.customExercises.filter((exercise) => referenced.has(exercise.id)) };
}

export function encodePlanBundle(bundle) {
  return toBase64Url(JSON.stringify(bundle));
}

export function decodePlanBundle(encoded) {
  const bundle = JSON.parse(fromBase64Url(encoded));
  if (bundle?.format !== "opengym-plan" || !Array.isArray(bundle.routines)) throw new Error("Plan no válido");
  return bundle;
}

export function mergePlanBundle(state, bundle, replaceSchedule = false) {
  const parsed = typeof bundle === "string" ? decodePlanBundle(bundle) : bundle;
  const idMap = new Map(parsed.routines.map((routine) => [routine.id, `shared-${cryptoId()}-${routine.id}`]));
  const routines = parsed.routines.map((routine) => ({ ...routine, id: idMap.get(routine.id), name: state.routines.some((current) => current.name === routine.name) ? `${routine.name} (compartida)` : routine.name }));
  const weekPlan = replaceSchedule ? Object.fromEntries(Object.entries(parsed.weekPlan ?? {}).map(([day, id]) => [day, id ? idMap.get(id) ?? null : null])) : state.weekPlan;
  return { ...state, routines: [...state.routines, ...routines], customExercises: [...state.customExercises, ...(parsed.customExercises ?? []).filter((exercise) => !state.customExercises.some((current) => current.id === exercise.id))], weekPlan };
}

export function printablePlanHtml(state) {
  const exercises = new Map([...state.exercises, ...state.customExercises].map((exercise) => [exercise.id, exercise.name]));
  const cards = state.routines.map((routine) => `<section><h2>${escape(routine.name)}</h2><ol>${routine.exercises.map((entry) => { const alternatives = (entry.substitutionExerciseIds ?? []).map((id) => exercises.get(id) ?? id); return `<li><strong>${escape(exercises.get(entry.exerciseId) ?? entry.exerciseId)}</strong> · ${Number(entry.targetSets ?? 3)} × ${Number(entry.targetReps ?? entry.targetSeconds ?? 0)}${entry.targetSeconds ? " s" : " reps"}${entry.supersetGroup ? ` · superserie ${escape(entry.supersetGroup)}` : ""}${alternatives.length ? ` · alternativas: ${alternatives.map(escape).join(", ")}` : ""}</li>`; }).join("")}</ol></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Plan OpenGym</title><style>body{font:16px system-ui;max-width:760px;margin:40px auto;color:#171c19}h1{font-size:40px}section{break-inside:avoid;border-top:2px solid #171c19;margin-top:24px}li{padding:6px 0}@media print{button{display:none}}</style></head><body><h1>Plan OpenGym</h1>${cards}<button onclick="print()">Guardar como PDF</button></body></html>`;
}

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const toBase64Url = (value) => btoa(encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (value) => decodeURIComponent(atob(value.replace(/-/g, "+").replace(/_/g, "/")).split("").map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
const cryptoId = () => Math.random().toString(36).slice(2, 9);
