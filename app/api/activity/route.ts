import { authenticateRequest, unauthorizedResponse } from "../../../lib/auth";
import { recordActivity } from "../../../lib/admin-repository";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth || !auth.permissions.includes("gym:write")) return unauthorizedResponse(request);
  const body = await request.json() as { status?: string; routineName?: string };
  if (body.status !== "training" && body.status !== "idle") return Response.json({ error: "status inválido" }, { status: 400 });
  await recordActivity(auth.userId, body.status, String(body.routineName ?? "").slice(0, 120));
  return Response.json({ ok: true });
}
