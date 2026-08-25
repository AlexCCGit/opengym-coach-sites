import { env } from "cloudflare:workers";

export async function ensureAdminSchema() {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS profile_control (user_id TEXT PRIMARY KEY, disabled INTEGER NOT NULL DEFAULT 0, invited INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS profile_activity (user_id TEXT PRIMARY KEY, status TEXT NOT NULL, routine_name TEXT, started_at TEXT, last_seen_at TEXT NOT NULL)`),
  ]);
}

export async function isProfileDisabled(userId: string) {
  await ensureAdminSchema();
  const row = await env.DB.prepare("SELECT disabled FROM profile_control WHERE user_id = ?").bind(userId).first<{ disabled: number }>();
  return Boolean(row?.disabled);
}

export async function mayCreateProfile(userId: string) {
  await ensureAdminSchema();
  if (userId === "demo-local") return true;
  const setting = await env.DB.prepare("SELECT value FROM app_setting WHERE key = 'invite_only'").first<{ value: string }>();
  if (setting?.value !== "true") return true;
  const control = await env.DB.prepare("SELECT invited FROM profile_control WHERE user_id = ?").bind(userId).first<{ invited: number }>();
  return Boolean(control?.invited);
}

export async function setProfileControl(userId: string, patch: { disabled?: boolean; invited?: boolean }) {
  await ensureAdminSchema();
  const current = await env.DB.prepare("SELECT disabled, invited FROM profile_control WHERE user_id = ?").bind(userId).first<{ disabled: number; invited: number }>();
  const disabled = patch.disabled == null ? Number(current?.disabled ?? 0) : Number(patch.disabled);
  const invited = patch.invited == null ? Number(current?.invited ?? 0) : Number(patch.invited);
  await env.DB.prepare("INSERT INTO profile_control (user_id, disabled, invited, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET disabled = excluded.disabled, invited = excluded.invited, updated_at = excluded.updated_at")
    .bind(userId, disabled, invited, new Date().toISOString()).run();
}

export async function setInviteOnly(enabled: boolean) {
  await ensureAdminSchema();
  await env.DB.prepare("INSERT INTO app_setting (key, value, updated_at) VALUES ('invite_only', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(String(enabled), new Date().toISOString()).run();
}

export async function recordActivity(userId: string, status: "training" | "idle", routineName?: string) {
  await ensureAdminSchema();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO profile_activity (user_id, status, routine_name, started_at, last_seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, routine_name = excluded.routine_name, started_at = CASE WHEN excluded.status = 'training' AND profile_activity.status != 'training' THEN excluded.started_at ELSE profile_activity.started_at END, last_seen_at = excluded.last_seen_at")
    .bind(userId, status, routineName ?? null, status === "training" ? now : null, now).run();
}
