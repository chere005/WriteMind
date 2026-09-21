import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/renderer"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@writemind/core": path.resolve(import.meta.dirname, "../../packages/core/src/index.ts"),
      "@writemind/editor": path.resolve(import.meta.dirname, "../../packages/editor/src/index.ts"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "out/renderer"),
    emptyOutDir: true,
  },
  server: { port: 5173, strictPort: true },
})
