/* ─── Creator live prefs (UPGRADE deltas #172 / #166) ──────────────────
   Per-creator automation switches for the live surfaces, stored in
   creator_live_prefs (provisional migration 0294_live_stage_upgrades).
   The sound_prefs pattern: one row per account, snake_case wire, and
   NO row = the all-on defaults below.

   Every automated behavior the house runs on a creator's stream
   carries its own user-facing on/off here (the automated-behavior
   law): Auto-Highlights' end-of-stream cuts (#172) and each Stage
   Manager co-host action (#166) gate on these switches — the libs
   read them, never a call site's guess. The Stage Manager's link
   rules also live here: the creator's own keyword → link pairs the
   co-host drops into chat when a keyword is mentioned. */

import { db, creatorLivePrefsTable, type StageManagerLinkRule } from "@workspace/db";
import { eq } from "drizzle-orm";

export type { StageManagerLinkRule };

export interface LivePrefsWire {
  auto_highlights_enabled: boolean;
  stage_manager_enabled: boolean;
  stage_manager_pin_enabled: boolean;
  stage_manager_links_enabled: boolean;
  stage_manager_sting_enabled: boolean;
  stage_manager_flags_enabled: boolean;
  stage_manager_link_rules: StageManagerLinkRule[];
}

export const DEFAULT_LIVE_PREFS: LivePrefsWire = {
  auto_highlights_enabled: true,
  stage_manager_enabled: true,
  stage_manager_pin_enabled: true,
  stage_manager_links_enabled: true,
  stage_manager_sting_enabled: true,
  stage_manager_flags_enabled: true,
  stage_manager_link_rules: [],
};

export type LivePrefsPatch = Partial<LivePrefsWire>;

/* ── Link rules ──────────────────────────────────────────────────────────
   Creator-authored, so they are sanitized at the write seam: at most
   MAX_LINK_RULES rules, short keywords/labels, http(s) URLs only, no
   duplicates (first rule for a keyword wins — matching is
   first-match in the Stage Manager). Anything malformed is dropped,
   never stored and never thrown back as a 500. */
export const MAX_LINK_RULES = 10;

export function sanitizeLinkRules(raw: unknown): StageManagerLinkRule[] {
  if (!Array.isArray(raw)) return [];
  const out: StageManagerLinkRule[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const keyword = typeof o["keyword"] === "string" ? o["keyword"].trim().toLowerCase() : "";
    const label = typeof o["label"] === "string" ? o["label"].trim() : "";
    const url = typeof o["url"] === "string" ? o["url"].trim() : "";
    if (keyword.length < 2 || keyword.length > 40) continue;
    if (label.length < 1 || label.length > 60) continue;
    if (url.length < 8 || url.length > 500) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    out.push({ keyword, label, url });
    if (out.length >= MAX_LINK_RULES) break;
  }
  return out;
}

/** Storage seam: the drizzle store in production, an in-memory store
 *  in tests — the read/merge/write rules are identical either way. */
export interface LivePrefsStore {
  getRow(userId: string): Promise<LivePrefsWire | null>;
  upsertRow(userId: string, prefs: LivePrefsWire): Promise<void>;
}

export const drizzleLivePrefsStore: LivePrefsStore = {
  async getRow(userId) {
    const rows = await db
      .select()
      .from(creatorLivePrefsTable)
      .where(eq(creatorLivePrefsTable.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      auto_highlights_enabled: row.autoHighlightsEnabled,
      stage_manager_enabled: row.stageManagerEnabled,
      stage_manager_pin_enabled: row.stageManagerPinEnabled,
      stage_manager_links_enabled: row.stageManagerLinksEnabled,
      stage_manager_sting_enabled: row.stageManagerStingEnabled,
      stage_manager_flags_enabled: row.stageManagerFlagsEnabled,
      stage_manager_link_rules: sanitizeLinkRules(row.stageManagerLinkRules),
    };
  },
  async upsertRow(userId, prefs) {
    await db
      .insert(creatorLivePrefsTable)
      .values({
        userId,
        autoHighlightsEnabled: prefs.auto_highlights_enabled,
        stageManagerEnabled: prefs.stage_manager_enabled,
        stageManagerPinEnabled: prefs.stage_manager_pin_enabled,
        stageManagerLinksEnabled: prefs.stage_manager_links_enabled,
        stageManagerStingEnabled: prefs.stage_manager_sting_enabled,
        stageManagerFlagsEnabled: prefs.stage_manager_flags_enabled,
        stageManagerLinkRules: prefs.stage_manager_link_rules,
      })
      .onConflictDoUpdate({
        target: creatorLivePrefsTable.userId,
        set: {
          autoHighlightsEnabled: prefs.auto_highlights_enabled,
          stageManagerEnabled: prefs.stage_manager_enabled,
          stageManagerPinEnabled: prefs.stage_manager_pin_enabled,
          stageManagerLinksEnabled: prefs.stage_manager_links_enabled,
          stageManagerStingEnabled: prefs.stage_manager_sting_enabled,
          stageManagerFlagsEnabled: prefs.stage_manager_flags_enabled,
          stageManagerLinkRules: prefs.stage_manager_link_rules,
          updatedAt: new Date(),
        },
      });
  },
};

/** The account's live prefs — the all-on default when no row exists. */
export async function getLivePrefs(
  store: LivePrefsStore,
  userId: string,
): Promise<LivePrefsWire> {
  const row = await store.getRow(userId);
  return row ?? { ...DEFAULT_LIVE_PREFS, stage_manager_link_rules: [] };
}

/** Merge a partial patch over the current prefs (or the default) and
 *  persist the full row. Link rules are replaced wholesale when the
 *  patch carries them (the desk edits the whole list at once) and are
 *  always sanitized before they are stored. */
export async function setLivePrefs(
  store: LivePrefsStore,
  userId: string,
  patch: LivePrefsPatch,
): Promise<LivePrefsWire> {
  const current = await getLivePrefs(store, userId);
  const next: LivePrefsWire = {
    auto_highlights_enabled: patch.auto_highlights_enabled ?? current.auto_highlights_enabled,
    stage_manager_enabled: patch.stage_manager_enabled ?? current.stage_manager_enabled,
    stage_manager_pin_enabled: patch.stage_manager_pin_enabled ?? current.stage_manager_pin_enabled,
    stage_manager_links_enabled: patch.stage_manager_links_enabled ?? current.stage_manager_links_enabled,
    stage_manager_sting_enabled: patch.stage_manager_sting_enabled ?? current.stage_manager_sting_enabled,
    stage_manager_flags_enabled: patch.stage_manager_flags_enabled ?? current.stage_manager_flags_enabled,
    stage_manager_link_rules:
      patch.stage_manager_link_rules !== undefined
        ? sanitizeLinkRules(patch.stage_manager_link_rules)
        : current.stage_manager_link_rules,
  };
  await store.upsertRow(userId, next);
  return next;
}
