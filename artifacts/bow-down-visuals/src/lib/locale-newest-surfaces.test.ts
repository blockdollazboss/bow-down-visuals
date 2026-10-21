/**
 * locale-newest-surfaces.test.ts — wave-3/4 newest surfaces speak all 10
 * languages (Stack-20 locale-parity lane, Oct 21 2026).
 *
 * History: the newest surfaces shipped English-first and the catalogs
 * silently fell back — the email automations/segments block existed only
 * in en.json, djSets / tutorials / command / smartClips likewise, and
 * playlistPitch existed in only 5 of 10 catalogs (hi/it/ja/ko/pt had
 * none of it). This test pins the repaired state: every key of the
 * wave-3/4 surface blocks must exist, non-empty, in EVERY catalog, with
 * the en placeholder shape ({{...}} tokens) preserved exactly.
 *
 * The required set is DERIVED from en.json at runtime (whole namespaces
 * + block prefixes), so adding a key to one of these blocks in en
 * without translating it fails this suite from now on.
 *
 * Known deliberate exception: socialProof.headlinePrefix may be empty
 * in ja/ko — the headline composes prefix + count + word + tail, and in
 * those languages the count leads, so the prefix slot is legitimately
 * blank (the words live in headlineCreatorsWord/headlineTail).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ALL = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

type Catalog = Record<string, unknown>;

function load(locale: string): Catalog {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Catalog;
}

function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

const CATALOGS: Record<string, Record<string, string>> = {};
for (const l of ALL) CATALOGS[l] = flat(load(l));
const EN = CATALOGS.en!;

/* Whole namespaces that are wave-3/4 surfaces end to end. */
const WHOLE_NAMESPACES = ["tutorials", "command", "djSets", "smartClips", "socialProof", "playlistPitch"] as const;
/* Block prefixes inside older, larger namespaces. */
const BLOCK_PREFIXES = [
  "wave9.cameraMovePlanner.",
  "artistVault.identity",
  "beats.template",
  "myShop.discount",
] as const;
/* The wave-3 email block: tags + segments + campaign send + automations
   (migration-era keys under email-list, added after the base catalog). */
const EMAIL_LIST_BLOCK = [
  "tags", "add_tag", "tag_name_placeholder",
  "segments", "segment_name_placeholder", "create_segment",
  "manual_tags_all", "automatic_tags_all", "sources_any",
  "engagement_label", "eng_any", "eng_opened", "eng_clicked",
  "eng_engaged", "eng_none",
  "at_presave", "at_member", "at_buyer", "at_opened", "at_clicked",
  "at_engaged", "members_word", "segments_suppression_note",
  "send_a_campaign", "audience", "whole_list", "use_ai_draft",
  "send_campaign_btn", "campaign_history",
  "automations", "automations_intro", "automations_loading",
  "automation_on", "automation_off", "automation_off_note",
  "automation_save", "automation_saved", "automations_delay_label",
  "automations_last_checked", "automations_never_checked",
  "automations_sent_word", "automations_skipped_word",
  "automations_no_provider_word",
  "no_campaigns_yet", "delivered_word", "opens_word", "clicks_word",
  "opens_total", "clicks_total", "save_tags",
  "campaign_sent_msg", "campaign_failed_msg", "tag_subscribers_hint",
] as const;
/* One-off newest-surface keys in older namespaces. */
const SINGLES = [
  "academy.tabTutorials",
  "stems.midi",
  "stems.midiTitle",
  "stems.errorMidi",
  "repurpose.modeSmart",
  "myProjects.failedOpenHubProject",
  "presave.tracklistTitle",
  "beats.customLicensesHeading",
  "beats.retry",
] as const;

function requiredKeys(): string[] {
  const keys = new Set<string>();
  for (const k of Object.keys(EN)) {
    if (WHOLE_NAMESPACES.some((ns) => k === ns || k.startsWith(`${ns}.`))) keys.add(k);
    if (BLOCK_PREFIXES.some((p) => k.startsWith(p))) keys.add(k);
  }
  for (const k of EMAIL_LIST_BLOCK) keys.add(`email-list.${k}`);
  for (const k of SINGLES) keys.add(k);
  return [...keys].sort();
}

const REQUIRED = requiredKeys();
const tokens = (s: string): string[] => [...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
const MAY_BE_EMPTY = new Set(["socialProof.headlinePrefix"]);

describe("wave-3/4 newest surfaces — full parity in all 10 catalogs", () => {
  it("the required set is the size the parity lane audited (500 keys)", () => {
    expect(REQUIRED.length).toBe(500);
  });

  it.each(ALL)("%s carries every newest-surface key", (locale) => {
    const cat = CATALOGS[locale]!;
    const missing = REQUIRED.filter((k) => !(k in cat));
    expect(missing, `${locale} is missing: ${missing.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it.each(ALL)("%s values are non-empty (headlinePrefix word-order slot aside)", (locale) => {
    const cat = CATALOGS[locale]!;
    const empty = REQUIRED.filter(
      (k) => typeof cat[k] !== "string" || (cat[k]!.trim() === "" && !MAY_BE_EMPTY.has(k)),
    );
    expect(empty, `${locale} has empty values: ${empty.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it.each(ALL)("%s preserves the en placeholder shape on every key", (locale) => {
    const cat = CATALOGS[locale]!;
    const bad = REQUIRED.filter(
      (k) => k in cat && JSON.stringify(tokens(cat[k]!)) !== JSON.stringify(tokens(EN[k]!)),
    );
    expect(bad, `${locale} placeholder drift: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it("playlistPitch exists in the five catalogs that once had none of it", () => {
    for (const locale of ["hi", "it", "ja", "ko", "pt"] as const) {
      const count = Object.keys(CATALOGS[locale]!).filter((k) => k.startsWith("playlistPitch.")).length;
      expect(count, `${locale} playlistPitch count`).toBe(120);
    }
  });
});
