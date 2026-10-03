import { defineConfig } from "vitest/config";

// Plain Node tests for edge logic that does not need the Workers runtime.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
