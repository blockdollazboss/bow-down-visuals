import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
    // Router modules throw at import time when DATABASE_URL is unset
    // (fail-loud boot check in lib/payment-record.ts). Tests only inspect
    // module behavior with mocked DB access, so a dummy value keeps them
    // self-sufficient.
    // ELEVENLABS_API_KEY must be non-empty or the voice routes 503 before
    // any logic under test runs; the value is never used (HTTP is mocked).
    // Unit tests never touch a real database: importing @workspace/db
    // requires DATABASE_URL at module load, but the pool only connects on
    // first query, which tests never issue.
    env: {
      DATABASE_URL: "postgres://localhost:5432/bowdown_test",
      ELEVENLABS_API_KEY: "test-key",
    },
    setupFiles: ["src/lib/__tests__/setup.ts"],
  },
});
