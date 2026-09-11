import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(process.cwd()) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // `app/**` is in the list because the session mirror's route handler is load-bearing for page access,
    // and the only way to check what it actually sends is to call it.
    include: ["components/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}", "app/**/*.test.{ts,tsx}"],
  },
});
