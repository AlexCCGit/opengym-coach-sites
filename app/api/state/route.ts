import { authenticateRequest, unauthorizedResponse } from "../../../lib/auth";
import { readProfile, writeProfile } from "../../../lib/profile-repository";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth || !auth.permissions.includes("gym:read")) return unauthorizedResponse(request);
  const record = await readProfile(auth.userId);
  return Response.json(record, { headers: { ETag: `"${record.revision}"` } });
}

export async function PUT(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth || !auth.permissions.includes("gym:write")) return unauthorizedResponse(request);
  const payload = await request.json() as { state?: Record<string, any>; revision?: number };
  const headerRevision = Number((request.headers.get("if-match") ?? "").replace(/\D/g, ""));
  const expectedRevision = Number.isInteger(payload.revision) ? payload.revision! : headerRevision;
  if (!payload.state || !Number.isInteger(expectedRevision)) {
    return Response.json({ error: "state y revision son obligatorios" }, { status: 400 });
  }

  const result = await writeProfile(auth.userId, expectedRevision, payload.state);
  if (!result.ok) {
    return Response.json(
      { error: "revision_conflict", revision: result.revision, state: result.state },
      { status: 409, headers: { ETag: `"${result.revision}"` } },
    );
  }
  return Response.json(result, { headers: { ETag: `"${result.revision}"` } });
}
