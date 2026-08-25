const normalizeHeader = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
const slug = (value) => String(value ?? "exercise").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

const first = (row, keys) => keys.map((key) => row[normalizeHeader(key)]).find((value) => value !== undefined && value !== "");
const number = (value) => value === undefined || value === "" ? undefined : Number(String(value).replace(",", "."));

export function detectCsvSource(rows) {
  const keys = new Set(Object.keys(rows[0] ?? {}));
  if (keys.has("workoutname") && keys.has("setorder")) return "strong";
  if (keys.has("exercisetitle") && keys.has("starttime")) return "hevy";
  if (keys.has("category") && (keys.has("weightkgs") || keys.has("weight"))) return "fitnotes";
  if (keys.has("startdate") && (keys.has("type") || keys.has("workoutactivitytype"))) return "apple-health";
  return "generic";
}

export function importWorkoutCsv(text, state) {
  const rows = parseCsv(text);
  const source = detectCsvSource(rows);
  const workouts = new Map();
  const known = new Map([...state.exercises, ...state.customExercises].map((exercise) => [exercise.name.toLowerCase(), exercise]));
  const custom = [];
  let sets = 0;
  for (const row of rows) {
    const date = first(row, ["date", "start_time", "startDate"]) ?? "1970-01-01T00:00:00.000Z";
    const workoutName = first(row, ["workout name", "title", "category", "workoutActivityType", "type"]) ?? `Importado de ${source}`;
    const exerciseName = first(row, ["exercise name", "exercise_title", "exercise", "activity"]) ?? workoutName;
    const key = `${date}|${workoutName}`;
    if (!workouts.has(key)) workouts.set(key, { id: `csv-${slug(key)}-${workouts.size + 1}`, routineId: null, name: workoutName, date: parseDate(date), durationSeconds: 0, notes: first(row, ["workout notes", "description"]) ?? "", exercises: [] });
    const workout = workouts.get(key);
    let exercise = known.get(exerciseName.toLowerCase());
    if (!exercise) {
      const id = `custom-${slug(exerciseName)}`;
      exercise = custom.find((entry) => entry.id === id) ?? { id, name: exerciseName, muscle: "other", bodyPart: "other", equipment: "imported", measurement: "reps", weightMode: "standard", description: `Importado de ${source}` };
      if (!custom.includes(exercise)) custom.push(exercise);
      known.set(exerciseName.toLowerCase(), exercise);
    }
    let logged = workout.exercises.find((entry) => entry.exerciseId === exercise.id);
    if (!logged) { logged = { exerciseId: exercise.id, sets: [] }; workout.exercises.push(logged); }
    const seconds = number(first(row, ["seconds", "duration_seconds", "time"]));
    const minutes = number(first(row, ["minutes", "duration_minutes"]));
    const speed = number(first(row, ["speed", "speed_kmh"]));
    const reps = number(first(row, ["reps", "repetitions"]));
    const set = { id: `csv-set-${sets + 1}`, completed: true, weight: number(first(row, ["weight", "weight_kg", "weight (kgs)", "weightkgs"])) ?? 0, notes: first(row, ["notes", "description"]) ?? "" };
    if (speed !== undefined || minutes !== undefined) { exercise.measurement = "cardio"; set.minutes = minutes ?? (seconds ?? 0) / 60; if (speed !== undefined) set.speed = speed; }
    else if (seconds !== undefined && reps === undefined) { exercise.measurement = "time"; set.seconds = seconds; }
    else set.reps = reps ?? 0;
    const rpe = number(first(row, ["rpe"]));
    if (rpe !== undefined) set.rpe = rpe;
    logged.sets.push(set); sets += 1;
  }
  const imported = [...workouts.values()];
  return { state: { ...state, customExercises: [...state.customExercises, ...custom.filter((exercise) => !state.customExercises.some((entry) => entry.id === exercise.id))], workouts: [...state.workouts, ...imported] }, report: { source, workouts: workouts.size, exercises: new Set(imported.flatMap((workout) => workout.exercises.map((entry) => entry.exerciseId))).size, sets, customExercises: custom.length, dropped: 0 } };
}

function parseDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "1970-01-01T00:00:00.000Z" : parsed.toISOString();
}
