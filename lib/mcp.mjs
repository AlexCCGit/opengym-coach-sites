import { getEstimatedOneRepMaxes, getMuscleBalance } from "./domain.mjs";

export const MCP_TOOL_NAMES = [
  "list_routines",
  "get_routine",
  "get_week_plan",
  "list_workouts",
  "get_workout",
  "get_bodyweight",
  "get_estimated_1rm",
  "get_muscle_balance",
  "log_workout",
  "update_workout",
  "add_bodyweight",
  "edit_routine",
  "assign_weekday",
  "override_day",
  "upsert_custom_exercise",
];

const WRITE_TOOLS = new Set(MCP_TOOL_NAMES.slice(8));
const objectSchema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: true });
const string = { type: "string" };
const number = { type: "number" };

export const MCP_TOOLS = [
  tool("list_routines", "Lista las rutinas del usuario", objectSchema()),
  tool("get_routine", "Obtiene una rutina por id", objectSchema({ routineId: string }, ["routineId"])),
  tool("get_week_plan", "Obtiene el plan semanal y sus cambios puntuales", objectSchema()),
  tool("list_workouts", "Lista entrenamientos, del más reciente al más antiguo", objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100 } })),
  tool("get_workout", "Obtiene un entrenamiento por id", objectSchema({ workoutId: string }, ["workoutId"])),
  tool("get_bodyweight", "Lista el historial de peso corporal", objectSchema()),
  tool("get_estimated_1rm", "Calcula el mejor 1RM estimado por ejercicio", objectSchema({ exerciseId: string })),
  tool("get_muscle_balance", "Calcula el volumen acumulado por grupo muscular", objectSchema()),
  tool("log_workout", "Registra un entrenamiento completo", objectSchema({ workout: { type: "object" } }, ["workout"])),
  tool("update_workout", "Corrige un entrenamiento o añade una serie omitida", objectSchema({ workoutId: string, patch: { type: "object" } }, ["workoutId", "patch"])),
  tool("add_bodyweight", "Registra una medida de peso corporal", objectSchema({ weight: number, date: string }, ["weight"])),
  tool("edit_routine", "Crea o actualiza una rutina", objectSchema({ routine: { type: "object" } }, ["routine"])),
  tool("assign_weekday", "Asigna una rutina a un día de la semana", objectSchema({ weekday: string, routineId: { type: ["string", "null"] } }, ["weekday"])),
  tool("override_day", "Cambia solo una fecha concreta sin alterar el plan semanal", objectSchema({ date: string, routineId: { type: ["string", "null"] } }, ["date"])),
  tool("upsert_custom_exercise", "Crea o actualiza un ejercicio personalizado", objectSchema({ exercise: { type: "object" } }, ["exercise"])),
];

function tool(name, description, inputSchema) {
  return { name, description, inputSchema };
}

const success = (id, value) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id, code, message, data) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
const toolResult = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
  isError: false,
});

export async function handleMcpMessage(message, context, repository) {
  const id = message?.id ?? null;
  if (message?.jsonrpc !== "2.0" || typeof message?.method !== "string") {
    return failure(id, -32600, "Invalid Request");
  }

  if (message.method === "initialize") {
    return success(id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "OpenGym Coach", version: "1.0.0" },
      instructions: "Consulta y actualiza únicamente los datos de entrenamiento del usuario autenticado.",
    });
  }
  if (message.method === "notifications/initialized") return null;
  if (message.method === "ping") return success(id, {});
  if (!context.permissions?.includes("gym:read")) return failure(id, -32003, "Se requiere gym:read");
  if (message.method === "tools/list") return success(id, { tools: MCP_TOOLS });
  if (message.method !== "tools/call") return failure(id, -32601, "Method not found");

  const name = message.params?.name;
  const args = message.params?.arguments ?? {};
  if (!MCP_TOOL_NAMES.includes(name)) return failure(id, -32602, `Herramienta desconocida: ${name}`);
  if (WRITE_TOOLS.has(name) && !context.permissions.includes("gym:write")) {
    return failure(id, -32003, "Se requiere gym:write");
  }

  try {
    const record = await repository.read(context.userId);
    const result = WRITE_TOOLS.has(name)
      ? await runWriteTool(name, args, record, repository, context.userId)
      : runReadTool(name, args, record);
    return success(id, toolResult(result));
  } catch (error) {
    return failure(id, -32000, error instanceof Error ? error.message : "Error de herramienta");
  }
}

function runReadTool(name, args, record) {
  const { state, revision } = record;
  if (name === "list_routines") return { routines: state.routines, revision };
  if (name === "get_routine") return { routine: required(state.routines.find((entry) => entry.id === args.routineId), "Rutina no encontrada"), revision };
  if (name === "get_week_plan") return { weekPlan: state.weekPlan, dayOverrides: state.dayOverrides, revision };
  if (name === "list_workouts") {
    const limit = Math.max(1, Math.min(100, Number(args.limit ?? 20)));
    return { workouts: [...state.workouts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit), revision };
  }
  if (name === "get_workout") return { workout: required(state.workouts.find((entry) => entry.id === args.workoutId), "Entrenamiento no encontrado"), revision };
  if (name === "get_bodyweight") return { bodyweight: state.bodyweight, revision };
  if (name === "get_estimated_1rm") {
    const estimates = getEstimatedOneRepMaxes(state);
    return { estimates: args.exerciseId ? { [args.exerciseId]: estimates[args.exerciseId] ?? null } : estimates, revision };
  }
  if (name === "get_muscle_balance") return { muscleBalance: getMuscleBalance(state), revision };
  throw new Error("Herramienta de lectura no implementada");
}

async function runWriteTool(name, args, record, repository, userId) {
  const state = structuredClone(record.state);
  if (name === "log_workout") {
    const workout = { ...args.workout, id: args.workout.id ?? crypto.randomUUID(), date: args.workout.date ?? new Date().toISOString() };
    state.workouts.push(workout);
  } else if (name === "update_workout") {
    const index = state.workouts.findIndex((entry) => entry.id === args.workoutId);
    if (index < 0) throw new Error("Entrenamiento no encontrado");
    state.workouts[index] = { ...state.workouts[index], ...args.patch, id: state.workouts[index].id };
  } else if (name === "add_bodyweight") {
    state.bodyweight.push({ id: crypto.randomUUID(), date: args.date ?? new Date().toISOString(), weight: Number(args.weight) });
  } else if (name === "edit_routine") {
    const routine = { ...args.routine, id: args.routine.id ?? crypto.randomUUID() };
    const index = state.routines.findIndex((entry) => entry.id === routine.id);
    if (index < 0) state.routines.push(routine); else state.routines[index] = routine;
  } else if (name === "assign_weekday") {
    state.weekPlan[args.weekday] = args.routineId ?? null;
  } else if (name === "override_day") {
    state.dayOverrides[args.date] = args.routineId ?? null;
  } else if (name === "upsert_custom_exercise") {
    const exercise = { ...args.exercise, id: args.exercise.id ?? crypto.randomUUID() };
    const index = state.customExercises.findIndex((entry) => entry.id === exercise.id);
    if (index < 0) state.customExercises.push(exercise); else state.customExercises[index] = exercise;
  }
  state.updatedAt = new Date().toISOString();

  const written = await repository.write(record.revision, state, userId);
  if (!written.ok) throw new Error(`Conflicto de revisión; revisión actual ${written.revision}`);
  return { revision: written.revision, state: written.state };
}

function required(value, message) {
  if (value == null) throw new Error(message);
  return value;
}
