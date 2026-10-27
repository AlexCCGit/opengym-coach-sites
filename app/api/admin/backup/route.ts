import { authenticateRequest, getAuthConfig, unauthorizedResponse } from "../../../../lib/auth";
import { dumpDatabase, restoreDatabase, type DatabaseBackup } from "../../../../lib/backup-repository";

async function requireAdmin(request: Request) {
  if (getAuthConfig(request).mode !== "auth0") return Response.json({ error: "La copia completa requiere autenticación segura" }, { status: 403 });
  const auth = await authenticateRequest(request);
  if (!auth) return unauthorizedResponse(request);
  if (!auth.permissions.includes("gym:admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const backup = await dumpDatabase();
  return Response.json(backup, {
    headers: { "Content-Disposition": `attachment; filename="opengym-d1-${backup.exportedAt.slice(0, 10)}.json"`, "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const restored = await restoreDatabase(await request.json() as DatabaseBackup);
    return Response.json({ ok: true, restored });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo restaurar la copia" }, { status: 400 });
  }
}
