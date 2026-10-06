import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "../../packages/tool-telemetry/src/schema.ts",
  out: "./migrations",
});
