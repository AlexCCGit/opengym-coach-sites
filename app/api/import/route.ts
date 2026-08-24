import { authenticateRequest, unauthorizedResponse } from "../../../lib/auth";
import { migrateGymCoachState } from "../../../lib/migration.mjs";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth || !auth.permissions.includes("gym:write")) return unauthorizedResponse(request);
  const source = await request.json();
  return Response.json(migrateGymCoachState(source, auth.userId));
}
