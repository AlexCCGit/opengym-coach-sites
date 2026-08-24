import { env } from "cloudflare:workers";

export type AuthContext = { userId: string; permissions: string[]; email?: string };

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
};

const decodeJsonPart = (value: string) => JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));

export function getAuthConfig(request?: Request) {
  const domain = env.AUTH0_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? "";
  const audience = env.AUTH0_AUDIENCE ?? (request ? `${new URL(request.url).origin}/mcp/` : "");
  return {
    mode: env.AUTH_MODE ?? (domain ? "auth0" : "demo"),
    domain,
    clientId: env.AUTH0_CLIENT_ID ?? "",
    audience,
    issuer: domain ? `https://${domain}/` : "",
  };
}

export async function authenticateRequest(request: Request): Promise<AuthContext | null> {
  const config = getAuthConfig(request);
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (config.mode === "demo") {
    if (!token || token === "demo") return { userId: "demo-local", permissions: ["gym:read", "gym:write"] };
  }
  if (!token || !config.domain || !config.audience) return null;

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
    const header = decodeJsonPart(encodedHeader);
    const payload = decodeJsonPart(encodedPayload);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    if (payload.iss !== config.issuer || Number(payload.exp ?? 0) <= Math.floor(Date.now() / 1000)) return null;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(config.audience)) return null;

    const jwks = await fetch(`${config.issuer}.well-known/jwks.json`).then((response) => response.json()) as { keys?: JsonWebKey[] };
    const jwk = jwks.keys?.find((candidate: any) => candidate.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!valid || typeof payload.sub !== "string") return null;
    const permissions = Array.isArray(payload.permissions)
      ? payload.permissions.map(String)
      : String(payload.scope ?? "").split(/\s+/).filter(Boolean);
    return { userId: payload.sub, permissions, email: payload.email };
  } catch {
    return null;
  }
}

export function unauthorizedResponse(request: Request) {
  const metadata = `${new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp/`;
  return Response.json(
    { error: "unauthorized", message: "Se necesita un token OAuth válido" },
    { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata}"` } },
  );
}
