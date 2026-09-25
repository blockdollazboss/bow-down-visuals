import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
    /* Unit tests never touch a real database, but importing @workspace/db
       requires DATABASE_URL at module load. A dummy value is enough — the
       pool only connects on first query, which tests never issue. */
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    },
  },
});
