import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: "OpenGym Coach",
    description: "Tu entrenamiento, tus datos y tu progreso en una app móvil conectada con ChatGPT.",
    applicationName: "OpenGym Coach",
    manifest: "/manifest.webmanifest",
    openGraph: {
      title: "OpenGym Coach",
      description: "Entrena con foco. Progresa con tus propios datos.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1664, height: 936, alt: "OpenGym Coach — Entrena con intención." }],
    },
    twitter: { card: "summary_large_image", images: [`${origin}/og.png`] },
  };
}

export const viewport: Viewport = {
  themeColor: "#161b18",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
