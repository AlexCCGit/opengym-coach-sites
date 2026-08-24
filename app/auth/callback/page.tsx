"use client";

import { useEffect, useState } from "react";

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export default function AuthCallback() {
  const [message, setMessage] = useState("Completando el acceso seguro…");

  useEffect(() => {
    async function finish() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const verifier = sessionStorage.getItem("opengym_verifier");
      const expectedState = sessionStorage.getItem("opengym_oauth_state");
      if (!code || !state || state !== expectedState || !verifier) throw new Error("La respuesta de acceso no es válida");

      const config = await fetch("/api/config/").then((response) => response.json());
      const response = await fetch(`https://${config.auth0Domain}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: config.auth0ClientId,
          code,
          code_verifier: verifier,
          redirect_uri: `${window.location.origin}/auth/callback/`,
        }),
      });
      if (!response.ok) throw new Error("No se pudo completar el acceso");
      const tokens = await response.json();
      localStorage.setItem("opengym_access_token", tokens.access_token);
      localStorage.setItem("opengym_expires_at", String(Date.now() + Number(tokens.expires_in ?? 3600) * 1000));
      sessionStorage.removeItem("opengym_verifier");
      sessionStorage.removeItem("opengym_oauth_state");
      window.location.replace("/");
    }
    finish().catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo iniciar sesión"));
  }, []);

  return <main className="auth-screen"><div className="auth-mark">OG</div><h1>{message}</h1><a href="/">Volver al inicio</a></main>;
}

export { base64Url };
