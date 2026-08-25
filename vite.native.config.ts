import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "native",
  publicDir: "../public",
  plugins: [react()],
  build: { outDir: "../native-dist", emptyOutDir: true },
});
