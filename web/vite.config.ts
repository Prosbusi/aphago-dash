import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages publica em https://prosbusi.github.io/aphago-dash/
export default defineConfig({
  plugins: [react()],
  base: "/aphago-dash/",
});
