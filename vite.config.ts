import { defineConfig } from "vite";
import { resolve } from "node:path";

const [owner, repository] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
if (process.env.GITHUB_ACTIONS === "true" && (!owner || !repository)) {
  throw new Error("GITHUB_REPOSITORY é necessário para configurar o GitHub Pages.");
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === "true" && repository.toLowerCase() !== `${owner.toLowerCase()}.github.io`
    ? `/${repository}/`
    : "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
        privacidade: resolve(__dirname, "privacidade.html"),
        termos: resolve(__dirname, "termos.html"),
      },
    },
  },
});
