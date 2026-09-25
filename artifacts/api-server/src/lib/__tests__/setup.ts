/**
 * Vitest setup: the api-server modules are safe to import without real
 * infrastructure, except `@workspace/db`, which throws at import time when
 * DATABASE_URL is unset (it is imported transitively via
 * lib/payment-record.ts ← lib/job-poller.ts). A dummy URL keeps the import
 * working; the pg Pool it creates connects lazily and is never touched —
 * every test below injects its DB through the modules' __set*Db seams.
 */
if (!process.env["DATABASE_URL"]) {
  process.env["DATABASE_URL"] = "postgres://test:test@127.0.0.1:5432/test";
}
