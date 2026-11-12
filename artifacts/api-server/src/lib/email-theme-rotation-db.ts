import { eq } from "drizzle-orm";
import { db, emailThemeRotationTable } from "@workspace/db";
import { logger } from "./logger";
import { isMissingSchemaError } from "./pg-errors";
import {
  setEmailThemeRotationStore,
  type EmailThemeRotationState,
  type EmailThemeRotationStore,
} from "./email-theme-rotation";

/**
 * The durable EmailThemeRotationStore (migration 0338, join21) —
 * the trailing step lib/email-theme-rotation.ts was built for.
 *
 * One row per customer in email_theme_rotation, keyed by the
 * rotation's normalized recipient address. Reads and writes go
 * through the seam only; no send path knows this file exists.
 * installDbEmailThemeRotationStore() plugs the store in at boot
 * (src/index.ts); before that call — and in tests that never make
 * it — the rotation runs on its in-memory default, exactly as the
 * email lane shipped it.
 *
 * FAIL-OPEN, like the seam itself: if the table is not there yet
 * (migration 0338 not applied on this database) a read resolves to
 * "no state" and a write no-ops, so a lagging database degrades to
 * the in-memory behavior — a customer's sequence may restart at
 * dark after a restart, but an email is never broken, blocked, or
 * left unthemed by bookkeeping. Other database errors are logged
 * and swallowed the same way.
 */
export function createDbEmailThemeRotationStore(
  dbHandle: typeof db = db,
): EmailThemeRotationStore {
  return {
    async get(
      recipientKey: string,
    ): Promise<EmailThemeRotationState | null> {
      try {
        const [row] = await dbHandle
          .select({
            nextTheme: emailThemeRotationTable.nextTheme,
            sentCount: emailThemeRotationTable.sentCount,
            updatedAt: emailThemeRotationTable.updatedAt,
          })
          .from(emailThemeRotationTable)
          .where(eq(emailThemeRotationTable.recipientEmail, recipientKey))
          .limit(1);
        if (!row) return null;
        return {
          nextTheme: row.nextTheme === "light" ? "light" : "dark",
          sentCount: row.sentCount,
          updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
        };
      } catch (err) {
        if (!isMissingSchemaError(err)) {
          logger.warn(
            { err, recipientKey },
            "[email-theme-rotation] durable read failed — treating as no state (fail-open)",
          );
        }
        return null;
      }
    },

    async set(
      recipientKey: string,
      state: EmailThemeRotationState,
    ): Promise<void> {
      try {
        const updatedAt = state.updatedAt
          ? new Date(state.updatedAt)
          : new Date();
        await dbHandle
          .insert(emailThemeRotationTable)
          .values({
            recipientEmail: recipientKey,
            nextTheme: state.nextTheme,
            sentCount: state.sentCount,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: emailThemeRotationTable.recipientEmail,
            set: {
              nextTheme: state.nextTheme,
              sentCount: state.sentCount,
              updatedAt,
            },
          });
      } catch (err) {
        if (!isMissingSchemaError(err)) {
          logger.warn(
            { err, recipientKey },
            "[email-theme-rotation] durable write failed — flip not persisted (fail-open)",
          );
        }
      }
    },
  };
}

/**
 * Boot wiring: swap the rotation's in-memory default store for the
 * durable one. Synchronous and side-effect-free until the first
 * email resolves a theme — the store itself is lazy per call.
 */
export function installDbEmailThemeRotationStore(): void {
  setEmailThemeRotationStore(createDbEmailThemeRotationStore());
}
