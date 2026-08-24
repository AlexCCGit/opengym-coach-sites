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
  };
}
