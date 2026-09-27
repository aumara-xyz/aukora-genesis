import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["test/**/*.test.{ts,js}", "demo/**/*.demo.test.{ts,js}"] } });
