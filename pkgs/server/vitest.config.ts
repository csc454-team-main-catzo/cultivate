import { defineConfig } from "vitest/config";
import tsconfig from "./tsconfig.json" with { type: "json" };

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
  },
  resolve: {
    extensions: [".ts"],
  },
  esbuild: {
    target: tsconfig.compilerOptions?.target ?? "ESNext",
  },
});
