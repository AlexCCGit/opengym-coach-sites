export const EXERCISE_DATA_URL = "https://cdn.jsdelivr.net/gh/alexpcosta/opengym@main/frontend/src/lib/exercises-data.js";
export const EXERCISE_IMAGE_BASE = "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/";
export const EXERCISE_GIF_BASE = "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/gifs/";

export function parseExerciseModule(source) {
  const prefix = "export const EXDB=";
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error("Formato de biblioteca no reconocido");
  const json = source.slice(start + prefix.length).trim().replace(/;\s*$/, "");
  const rows = JSON.parse(json);
  if (!Array.isArray(rows)) throw new Error("La biblioteca no contiene ejercicios");
  return rows.map(mapExercise);
}

export function mapExercise(row) {
  return {
    id: `open-${row.id}`,
    sourceId: row.id,
    name: row.n,
    bodyPart: row.bp,
    equipment: row.eq,
    muscle: row.tg,
    mainMuscle: row.mg,
    secondaryMuscles: row.sm ?? [],
    instructions: row.st ?? [],
    imageUrl: row.img ? `${EXERCISE_IMAGE_BASE}${row.img}` : null,
    gifUrl: row.gif ? `${EXERCISE_GIF_BASE}${row.gif}` : null,
    measurement: row.bp === "cardio" ? "cardio" : "reps",
    weightMode: row.eq === "body weight" ? "none" : "standard",
  };
}

export async function fetchExerciseCatalog(fetcher = fetch) {
  const response = await fetcher(EXERCISE_DATA_URL);
  if (!response.ok) throw new Error(`No se pudo cargar la biblioteca (${response.status})`);
  return parseExerciseModule(await response.text());
}

export function filterExercises(exercises, { query = "", equipment = "all", bodyPart = "all" } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return (exercises ?? []).filter((exercise) => {
    const matchesText = !needle || [exercise.name, exercise.muscle, exercise.mainMuscle, exercise.equipment].some((value) => String(value ?? "").toLocaleLowerCase().includes(needle));
    return matchesText && (equipment === "all" || exercise.equipment === equipment) && (bodyPart === "all" || exercise.bodyPart === bodyPart);
  });
}
