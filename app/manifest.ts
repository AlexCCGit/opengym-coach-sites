import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenGym Coach",
    short_name: "OpenGym",
    description: "Entrenamiento y progreso con datos propios.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f3ee",
    theme_color: "#161b18",
    lang: "es",
    orientation: "portrait-primary",
    categories: ["fitness", "health", "sports"],
    icons: [
      { src: "/og.png", sizes: "1664x936", type: "image/png", purpose: "any" },
      { src: "/og.png", sizes: "1664x936", type: "image/png", purpose: "maskable" },
    ],
  };
}
