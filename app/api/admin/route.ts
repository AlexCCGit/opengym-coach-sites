import { env } from "cloudflare:workers";
import { ensureAdminSchema, setInviteOnly, setProfileControl } from "../../../lib/admin-repository";
import { authenticateRequest, unauthorizedResponse } from "../../../lib/auth";

async function requireAdmin(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return { response: unauthorizedResponse(request), auth: null };
  if (!auth.permissions.includes("gym:admin")) return { response: Response.json({ error: "forbidden" }, { status: 403 }), auth: null };
  return { response: null, auth };
}

export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  await ensureAdminSchema();
  const result = await env.DB.prepare(`SELECT p.user_id, p.revision, p.updated_at, length(p.state_json) AS storage_bytes, p.state_json,
    coalesce(c.disabled, 0) AS disabled, coalesce(c.invited, 0) AS invited,
    a.status, a.routine_name, a.started_at, a.last_seen_at
    FROM profile_state p LEFT JOIN profile_control c ON c.user_id = p.user_id LEFT JOIN profile_activity a ON a.user_id = p.user_id
    ORDER BY p.updated_at DESC LIMIT 200`).all<any>();
  const invite = await env.DB.prepare("SELECT value FROM app_setting WHERE key = 'invite_only'").first<{ value: string }>();
  const now = Date.now();
  const profiles = (result.results ?? []).map((row: any) => {
    const state = safelyParse(row.state_json);
    const recentWorkouts = [...(state.workouts ?? [])].sort((a: any, b: any) => String(b.date).localeCompare(String(a.date))).slice(0, 10).map((workout: any) => ({ id: workout.id, date: workout.date, name: workout.name, durationSeconds: workout.durationSeconds, sets: (workout.exercises ?? []).reduce((sum: number, entry: any) => sum + (entry.sets?.length ?? 0), 0) }));
    const active = row.status === "training" && now - new Date(row.last_seen_at).getTime() < 5 * 60_000;
    return { user_id: row.user_id, revision: row.revision, updated_at: row.updated_at, storage_bytes: row.storage_bytes, disabled: Boolean(row.disabled), invited: Boolean(row.invited), active, activity: active ? { routineName: row.routine_name, startedAt: row.started_at, lastSeenAt: row.last_seen_at } : null, workoutCount: state.workouts?.length ?? 0, recentWorkouts };
  });
  return Response.json({ profiles, inviteOnly: invite?.value === "true", totals: { profiles: profiles.length, active: profiles.filter((profile: any) => profile.active).length, disabled: profiles.filter((profile: any) => profile.disabled).length, storageBytes: profiles.reduce((sum: number, profile: any) => sum + Number(profile.storage_bytes ?? 0), 0) } });
}

export async function PATCH(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  const body = await request.json() as { userId?: string; disabled?: boolean; invited?: boolean; inviteOnly?: boolean };
  if (typeof body.inviteOnly === "boolean") await setInviteOnly(body.inviteOnly);
  if (body.userId) {
    if (body.userId === access.auth!.userId && body.disabled === true) return Response.json({ error: "No puedes desactivar tu propia cuenta administradora" }, { status: 400 });
    await setProfileControl(body.userId, { disabled: body.disabled, invited: body.invited });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  const { userId } = await request.json() as { userId?: string };
  if (!userId) return Response.json({ error: "userId es obligatorio" }, { status: 400 });
  if (userId === access.auth!.userId) return Response.json({ error: "No puedes eliminar tu propia cuenta administradora" }, { status: 400 });
  const result = await env.DB.prepare("DELETE FROM profile_state WHERE user_id = ?").bind(userId).run();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM profile_control WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM profile_activity WHERE user_id = ?").bind(userId),
  ]);
  return Response.json({ deleted: (result.meta.changes ?? 0) === 1 });
}

function safelyParse(value: string) {
  try { return JSON.parse(value); } catch { return {}; }
}
