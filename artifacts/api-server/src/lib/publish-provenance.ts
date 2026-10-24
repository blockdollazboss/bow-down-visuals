import type { ScheduledPostProvenance, SchedulerPlatform } from "@workspace/db";
import { aiDisclosureLine, type ProvenanceRecord } from "./provenance";

/* ─── Provenance in Publish/Scheduler (Stack-100 #3, wave 3) ─────────────
   The F7 provenance kit built records, licence certificates and export
   stamping, but the Publish/Scheduler flow never saw them. This module
   is the bridge: when a creator schedules (or publishes) an asset that
   has a provenance record, the record's id + a factual snapshot ride
   the scheduled_posts row (see ScheduledPostProvenance in @workspace/db)
   and the disclosure is delivered at fire time ONLY where the
   destination honestly accepts one:

   - Instagram / Facebook: their publish calls take caption /
     description text, so the disclosure line rides the caption. That
     is a real delivery — the text is part of the post.
   - TikTok: the connection here uploads to the creator's TikTok
     drafts/inbox (lib/social-tiktok uploadDraftToTikTok). That call
     accepts NO caption, NO metadata and NO AI-label field — the
     creator writes the caption inside TikTok. Sending a disclosure
     there is impossible, so nothing is faked: the UI says the
     disclosure stays on the asset's provenance record page, and the
     fire result records `disclosure: "record_only"`.

   No C2PA anything — signing stays deferred (needs a certificate the
   platform doesn't hold); this is the records/metadata layer only. */

/** How a platform will carry the AI disclosure for a linked post. */
export type DisclosureChannel = "caption" | "record_only" | "not_applicable";

/** Parse a library asset id ("gen:<uuid>" / "hub:<entryId>") — the same
 *  split the provenance doors use. Anything else is not a record id. */
export function parseProvenanceAssetId(
  raw: unknown,
): { kind: "gen" | "hub"; id: string; assetId: string } | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const idx = trimmed.indexOf(":");
  if (idx <= 0) return null;
  const kind = trimmed.slice(0, idx);
  const id = trimmed.slice(idx + 1);
  if ((kind !== "gen" && kind !== "hub") || !id || id.length > 200) return null;
  return { kind, id, assetId: `${kind}:${id}` };
}

/** The snapshot stamped on the scheduled post at schedule time. Built
 *  ONLY from the loaded provenance record — never from the media URL,
 *  never re-derived later. */
export function snapshotProvenanceForPublish(
  record: ProvenanceRecord,
  now: Date = new Date(),
): ScheduledPostProvenance {
  return {
    assetId: record.assetId,
    title: record.title,
    tool: record.createdWith.tool,
    model: record.createdWith.model,
    aiGenerated: record.aiGenerated,
    licence: record.licence,
    disclosureLine: record.aiGenerated ? aiDisclosureLine(record) : "",
    linkedAt: now.toISOString(),
  };
}

/** Where the disclosure honestly lands for one platform. A post with no
 *  provenance snapshot, or a record with no AI generation, has nothing
 *  to disclose anywhere — "not_applicable", never a fake delivery. */
export function disclosureChannelFor(
  platform: SchedulerPlatform,
  provenance: ScheduledPostProvenance | null | undefined,
): DisclosureChannel {
  if (!provenance || !provenance.aiGenerated) return "not_applicable";
  /* TikTok drafts accept no caption/label field in this integration. */
  if (platform === "tiktok") return "record_only";
  return "caption";
}

/** The per-platform delivery plan the publish UI shows BEFORE posting. */
export function disclosurePlanFor(
  platforms: readonly SchedulerPlatform[],
  provenance: ScheduledPostProvenance | null | undefined,
): Record<string, DisclosureChannel> {
  const plan: Record<string, DisclosureChannel> = {};
  for (const p of platforms) plan[p] = disclosureChannelFor(p, provenance);
  return plan;
}

/** The caption/description actually sent at fire time: the disclosure
 *  line appended for caption-channel platforms only. Idempotent — a
 *  caption that already carries the line is never doubled. TikTok and
 *  non-AI posts pass through untouched (nothing faked). */
export function captionWithDisclosure(
  caption: string,
  provenance: ScheduledPostProvenance | null | undefined,
  platform: SchedulerPlatform,
): string {
  if (disclosureChannelFor(platform, provenance) !== "caption") return caption;
  const line = provenance!.disclosureLine.trim();
  if (!line || caption.includes(line)) return caption;
  return [caption.trim(), line].filter(Boolean).join("\n\n");
}
