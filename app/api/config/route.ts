import { getAuthConfig } from "../../../lib/auth";

export async function GET(request: Request) {
  const config = getAuthConfig(request);
  return Response.json({
    authMode: config.mode,
    auth0Domain: config.domain,
    auth0ClientId: config.clientId,
    audience: config.audience,
    scopes: ["openid", "profile", "email", "gym:read", "gym:write", "gym:admin"],
  });
}
