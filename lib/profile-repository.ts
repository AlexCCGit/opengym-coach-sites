import { env } from "cloudflare:workers";
import { createInitialState } from "./domain.mjs";
import { normalizeState } from "./state-schema.mjs";

type ProfileRecord = { revision: number; state: Record<string, any> };

async function ensureSchema() {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS profile_state (
    user_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`).run();
}

export async function readProfile(userId: string): Promise<ProfileRecord> {
  await ensureSchema();
  const row = await env.DB.prepare(
    "SELECT state_json, revision FROM profile_state WHERE user_id = ?",
  ).bind(userId).first<{ state_json: string; revision: number }>();

  if (row) return { revision: row.revision, state: normalizeState(JSON.parse(row.state_json), userId) };

  const state = createInitialState(userId);
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO profile_state (user_id, state_json, revision, updated_at) VALUES (?, ?, 1, ?)",
  ).bind(userId, JSON.stringify(state), timestamp).run();

  const inserted = await env.DB.prepare(
    "SELECT state_json, revision FROM profile_state WHERE user_id = ?",
  ).bind(userId).first<{ state_json: string; revision: number }>();
  if (!inserted) throw new Error("No se pudo crear el perfil");
  return { revision: inserted.revision, state: JSON.parse(inserted.state_json) };
}

export async function writeProfile(
  userId: string,
  expectedRevision: number,
  state: Record<string, any>,
) {
  const nextRevision = expectedRevision + 1;
  const normalized = normalizeState(state, userId);
  const result = await env.DB.prepare(
    "UPDATE profile_state SET state_json = ?, revision = ?, updated_at = ? WHERE user_id = ? AND revision = ?",
  ).bind(JSON.stringify(normalized), nextRevision, new Date().toISOString(), userId, expectedRevision).run();

  if ((result.meta.changes ?? 0) !== 1) {
    const current = await readProfile(userId);
    return { ok: false as const, revision: current.revision, state: current.state };
  }
  return { ok: true as const, revision: nextRevision, state: normalized };
}

export function profileRepository() {
  return {
    read: (userId: string) => readProfile(userId),
    write: (expectedRevision: number, state: Record<string, any>, userId: string) =>
      writeProfile(userId, expectedRevision, state),
  };
}
