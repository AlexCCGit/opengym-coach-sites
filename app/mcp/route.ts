import { authenticateRequest, unauthorizedResponse } from "../../lib/auth";
import { handleMcpMessage } from "../../lib/mcp.mjs";
import { profileRepository } from "../../lib/profile-repository";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return unauthorizedResponse(request);
  const message = await request.json();
  const response = await handleMcpMessage(message, auth, profileRepository());
  if (response == null) return new Response(null, { status: 202 });
  return Response.json(response, {
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": message?.params?.protocolVersion ?? "2025-06-18",
    },
  });
}

export async function GET() {
  return Response.json({ name: "OpenGym Coach MCP", transport: "streamable-http" });
}
