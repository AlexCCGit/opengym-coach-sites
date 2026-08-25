import { env } from "cloudflare:workers";
import { authenticateRequest, unauthorizedResponse } from "../../../lib/auth";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return unauthorizedResponse(request);
  if (!auth.permissions.includes("gym:admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const result = await env.DB.prepare("SELECT user_id, revision, updated_at, length(state_json) AS storage_bytes FROM profile_state ORDER BY updated_at DESC LIMIT 200").all<{ user_id: string; revision: number; updated_at: string; storage_bytes: number }>();
  const profiles = result.results ?? [];
  return Response.json({ profiles, totals: { profiles: profiles.length, storageBytes: profiles.reduce((sum, profile) => sum + Number(profile.storage_bytes ?? 0), 0) } });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return unauthorizedResponse(request);
  if (!auth.permissions.includes("gym:admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await request.json() as { userId?: string };
  if (!userId) return Response.json({ error: "userId es obligatorio" }, { status: 400 });
  const result = await env.DB.prepare("DELETE FROM profile_state WHERE user_id = ?").bind(userId).run();
  return Response.json({ deleted: (result.meta.changes ?? 0) === 1 });
}
