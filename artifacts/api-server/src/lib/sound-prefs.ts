/* ─── Signature-sound preferences (Stack-200 UPGRADES 183) ──────────────
   Per-account on/off for the owner's signature sounds, stored in
   sound_prefs (migration 0242) and read by the site's single sound
   engine. The wire shape is snake_case, matching retention_prefs.

   Defaults are ALL ON: an account with no row yet hears the sounds,
   and the first PATCH creates the row. The engine — never a call
   site — enforces the gates (master off = total silence; a kind off
   = that kind silent; a device/browser mute outranks every switch). */

import { db, soundPrefsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface SoundPrefsWire {
  master_enabled: boolean;
  notifications_enabled: boolean;
  messages_enabled: boolean;
  success_stings_enabled: boolean;
  errors_enabled: boolean;
  ringtone_enabled: boolean;
}

export const DEFAULT_SOUND_PREFS: SoundPrefsWire = {
  master_enabled: true,
  notifications_enabled: true,
  messages_enabled: true,
  success_stings_enabled: true,
  errors_enabled: true,
  ringtone_enabled: true,
};

export type SoundPrefsPatch = Partial<SoundPrefsWire>;

/** Storage seam: the drizzle store in production, an in-memory store
 *  in tests — the read/merge/write rules live in the functions below
 *  and are identical against either. */
export interface SoundPrefsStore {
  getRow(userId: string): Promise<SoundPrefsWire | null>;
  upsertRow(userId: string, prefs: SoundPrefsWire): Promise<void>;
}

export const drizzleSoundPrefsStore: SoundPrefsStore = {
  async getRow(userId) {
    const rows = await db
      .select()
      .from(soundPrefsTable)
      .where(eq(soundPrefsTable.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      master_enabled: row.masterEnabled,
      notifications_enabled: row.notificationsEnabled,
      messages_enabled: row.messagesEnabled,
      success_stings_enabled: row.successStingsEnabled,
      errors_enabled: row.errorsEnabled,
      ringtone_enabled: row.ringtoneEnabled,
    };
  },
  async upsertRow(userId, prefs) {
    await db
      .insert(soundPrefsTable)
      .values({
        userId,
        masterEnabled: prefs.master_enabled,
        notificationsEnabled: prefs.notifications_enabled,
        messagesEnabled: prefs.messages_enabled,
        successStingsEnabled: prefs.success_stings_enabled,
        errorsEnabled: prefs.errors_enabled,
        ringtoneEnabled: prefs.ringtone_enabled,
      })
      .onConflictDoUpdate({
        target: soundPrefsTable.userId,
        set: {
          masterEnabled: prefs.master_enabled,
          notificationsEnabled: prefs.notifications_enabled,
          messagesEnabled: prefs.messages_enabled,
          successStingsEnabled: prefs.success_stings_enabled,
          errorsEnabled: prefs.errors_enabled,
          ringtoneEnabled: prefs.ringtone_enabled,
          updatedAt: new Date(),
        },
      });
  },
};

/** The account's prefs — the all-on default when no row exists yet. */
export async function getSoundPrefs(
  store: SoundPrefsStore,
  userId: string,
): Promise<SoundPrefsWire> {
  const row = await store.getRow(userId);
  return row ?? { ...DEFAULT_SOUND_PREFS };
}

/** Merge a partial patch over the current prefs (or the default) and
 *  persist the full row. Returns the persisted prefs. */
export async function setSoundPrefs(
  store: SoundPrefsStore,
  userId: string,
  patch: SoundPrefsPatch,
): Promise<SoundPrefsWire> {
  const current = await getSoundPrefs(store, userId);
  const next: SoundPrefsWire = {
    master_enabled: patch.master_enabled ?? current.master_enabled,
    notifications_enabled: patch.notifications_enabled ?? current.notifications_enabled,
    messages_enabled: patch.messages_enabled ?? current.messages_enabled,
    success_stings_enabled: patch.success_stings_enabled ?? current.success_stings_enabled,
    errors_enabled: patch.errors_enabled ?? current.errors_enabled,
    ringtone_enabled: patch.ringtone_enabled ?? current.ringtone_enabled,
  };
  await store.upsertRow(userId, next);
  return next;
}
