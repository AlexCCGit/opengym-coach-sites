import { env } from "cloudflare:workers";
import { authenticateRequest, unauthorizedResponse } from "../../../lib/auth";
import { readProfile } from "../../../lib/profile-repository";
import { summarizeEffort, detectPersonalRecords } from "../../../lib/training-engine.mjs";
import { trainingStreak, weeklySummary } from "../../../lib/analytics.mjs";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth || !auth.permissions.includes("gym:read")) return unauthorizedResponse(request);
  const payload = await request.json() as { message?: string; history?: Array<{ role: string; content: string }> };
  const message = String(payload.message ?? "").trim().slice(0, 2_000);
  if (!message) return Response.json({ error: "message es obligatorio" }, { status: 400 });
  const { state } = await readProfile(auth.userId);
  const context = coachContext(state);
  if (!env.OPENAI_API_KEY) return Response.json({ answer: localCoach(message, context), mode: "local" });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL ?? "gpt-5.4",
      store: false,
      text: { verbosity: "low" },
      instructions: "Eres el coach de OpenGym. Responde en el idioma del usuario, de forma breve, basada únicamente en sus datos. No diagnostiques lesiones ni sustituyas consejo médico. Señala incertidumbre y da pasos concretos.",
      input: [...(payload.history ?? []).slice(-8), { role: "user", content: `Datos de entrenamiento:\n${JSON.stringify(context)}\n\nPregunta: ${message}` }],
    }),
  });
  if (!response.ok) return Response.json({ answer: localCoach(message, context), mode: "local", warning: "El Coach AI no estaba disponible" });
  const body = await response.json() as any;
  const answer = body.output?.flatMap((item: any) => item.content ?? []).find((content: any) => content.type === "output_text")?.text;
  return Response.json({ answer: answer ?? localCoach(message, context), mode: answer ? "ai" : "local" });
}

function coachContext(state: any) {
  const latest = [...state.workouts].sort((a: any, b: any) => b.date.localeCompare(a.date)).slice(0, 8);
  return { weekly: weeklySummary(state.workouts), streak: trainingStreak(state.workouts), effort: summarizeEffort(state.workouts), latest: latest.map((workout: any) => ({ date: workout.date, name: workout.name, durationSeconds: workout.durationSeconds, exercises: workout.exercises.map((entry: any) => ({ exerciseId: entry.exerciseId, sets: entry.sets })) })), recordsInLatest: latest[0] ? detectPersonalRecords(state.workouts.filter((workout: any) => workout.id !== latest[0].id), latest[0]).length : 0 };
}

function localCoach(message: string, context: any) {
  const question = message.toLowerCase();
  if (question.includes("descanso") || question.includes("fatiga")) return `Esta semana llevas ${context.weekly.workouts} sesiones y ${context.effort.hardSets} series duras. Si notas caída de rendimiento o dolor, prioriza recuperación y evita aumentar carga hoy.`;
  if (question.includes("progres") || question.includes("peso") || question.includes("carga")) return `Tu semana suma ${context.weekly.volume} kg·rep en ${context.weekly.sets} series. Mantén la progresión configurada y sube carga solo cuando completes todas las repeticiones objetivo con técnica estable.`;
  return `Veo ${context.weekly.workouts} sesiones en los últimos 7 días, ${context.weekly.sets} series y una racha de ${context.streak} días. Puedo ayudarte con progresión, fatiga, distribución semanal o lectura de tus marcas.`;
}
