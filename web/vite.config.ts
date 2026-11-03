import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Caminhos relativos: o mesmo build funciona em https://pharol.aphago.com.br/ e em https://prosbusi.github.io/aphago-dash/
export default defineConfig({
  plugins: [react()],
  base: "./",
});
