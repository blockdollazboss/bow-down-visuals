import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Publish desk — component source pins (stack1600 wave 4, item 25,
 * desk #99). Same pattern as the sibling desk suites: the desk's
 * honest states and rail usage are pinned in the source so a
 * later edit can't quietly hollow them out.
 */

const desk = readFileSync(
  resolve(process.cwd(), "src/components/world/native/PublishDesk.tsx"),
  "utf-8",
);
const panel = readFileSync(
  resolve(process.cwd(), "src/components/world/StationPanel.tsx"),
  "utf-8",
);
const seam = readFileSync(resolve(process.cwd(), "src/lib/world/publish-desk.ts"), "utf-8");

describe("publish desk — mounted at the My Studio board, after Setlist", () => {
  it("the panel lazy-loads the desk and renders it in a DeskDoor", () => {
    expect(panel).toContain(
      'import("@/components/world/native/PublishDesk").then((m) => ({ default: m.PublishDesk }))',
    );
    expect(panel).toContain("<PublishDesk isLight={isLight} />");
    expect(panel).toContain("desk #99");
    const setlistIdx = panel.indexOf("<SetlistDesk isLight={isLight} />");
    const publishIdx = panel.indexOf("<PublishDesk isLight={isLight} />");
    expect(setlistIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(setlistIdx);
  });

  it("rides useDeskAuthHeaders like the sibling desks", () => {
    expect(desk).toContain("useDeskAuthHeaders");
    expect(desk).toContain("deskHeaders()");
  });
});

describe("publish desk — each action drives its rail", () => {
  it("loads profiles and both shelves from the seam's paths", () => {
    expect(desk).toContain("fetch(PUBLISH_PROFILES_PATH");
    expect(desk).toContain("PUBLISH_TRACKS_PATH");
    expect(desk).toContain("PUBLISH_VIDEOS_PATH");
  });

  it("the upload is multipart FormData, field name 'file', to the seam's upload path", () => {
    expect(desk).toContain("new FormData()");
    expect(desk).toContain('fd.append("file", f)');
    expect(desk).toContain("fetch(PUBLISH_UPLOAD_PATH, { method: \"POST\"");
    // The save stores the permanent ref, not the 24h signed URL.
    expect(desk).toContain("up.ref ?? up.url");
  });

  it("create posts to the collection, edit PUTs to the item, toggle PUTs the one-field body, delete DELETEs", () => {
    expect(desk).toContain("publishCollectionPath(draft.kind)");
    expect(desk).toContain("publishItemPath(editing)");
    expect(desk).toContain('method: editing ? "PUT" : "POST"');
    expect(desk).toContain("buildPublishStateBody(!item.isPublished)");
    expect(desk).toContain('method: "DELETE"');
    expect(desk).toContain("buildTrackPayload(");
    expect(desk).toContain("buildVideoPayload(");
  });

  it("no hard-coded rail paths in the component — everything rides the seam", () => {
    // Code only — the header comment may name the rails in prose.
    const code = desk.replace(/^\/\*\*[\s\S]*?\*\//, "");
    expect(code).not.toContain("/api/");
  });
});

describe("publish desk — free means free (no spend machinery, ever)", () => {
  it("neither the desk nor the seam carries pricing/confirm machinery", () => {
    for (const src of [desk, seam]) {
      expect(src).not.toContain("useConfirmedApi");
      expect(src).not.toContain("confirmedFetch");
      expect(src).not.toContain("overrideCost");
      expect(src).not.toContain("getCreditCost");
      expect(src).not.toContain("CreditConfirm");
    }
    // The fee string that exists names the member's OWN price.
    expect(desk).toContain("your price for your buyers");
    expect(desk).toContain("Publishing is free — no Visual Bucs");
  });
});

describe("publish desk — honest states", () => {
  it("testids pin the desk's states and parts", () => {
    for (const id of [
      "world-publish-desk",
      "world-publish-desk-profiles-failed",
      "world-publish-desk-no-profile",
      "world-publish-desk-loading",
      "world-publish-desk-empty",
      "world-publish-desk-composer",
      "world-publish-desk-title",
      "world-publish-desk-file",
      "world-publish-desk-media-url",
      "world-publish-desk-artwork-file",
      "world-publish-desk-artwork-url",
      "world-publish-desk-save",
      "world-publish-desk-live",
      "world-publish-desk-kind-track",
      "world-publish-desk-kind-video",
      "world-publish-desk-category",
      "world-publish-desk-genre",
    ]) {
      expect(desk, id).toContain(id);
    }
    expect(desk).toContain('world-publish-desk-${kind === "track" ? "tracks" : "videos"}-failed');
    expect(desk).toContain("world-publish-desk-item-${item.id}");
    expect(desk).toContain("world-publish-desk-toggle-${item.id}");
    expect(desk).toContain("world-publish-desk-edit-${item.id}");
    expect(desk).toContain("world-publish-desk-delete-${item.id}");
  });

  it("each shelf fails on its own, with a retry — a failure never reads as an empty shelf", () => {
    expect(desk).toContain("wouldn&rsquo;t load. Give it another shot.");
    expect(desk).toContain("void loadShelf(kind)");
    // The empty state is a distinct sentence from any failure copy.
    expect(desk).toContain("Nothing here yet");
    expect(desk).toContain("No {kind === \"track\" ? \"tracks\" : \"videos\"} yet");
  });

  it("the shelves settle independently (the page's S27-44 discipline)", () => {
    expect(desk).toContain("loadShelf(\"track\")");
    expect(desk).toContain("loadShelf(\"video\")");
    expect(desk).toContain("tracksFailed");
    expect(desk).toContain("videosFailed");
  });

  it("no profile is a door, not a dead end — the in-world creation card", () => {
    expect(desk).toContain("CreatorProfileCreateCard");
    expect(desk).toContain("onCreated={() => void loadProfiles()}");
  });

  it("delete is two-step inline — and a live row warns before the second tap", () => {
    expect(desk).toContain("Tap again to delete");
    expect(desk).toContain("Live — tap again to delete");
    expect(desk).toContain("confirmDeleteId");
  });
});

describe("publish desk — world law (no pull-ups, touch targets, both themes)", () => {
  it("no links out and no page pull-ups", () => {
    expect(desk).not.toContain("<a ");
    expect(desk).not.toContain("window.open");
    expect(desk).not.toContain('"/publish"');
  });

  it("touch targets and both theme branches", () => {
    expect(desk).toContain("bdv-touch-target");
    expect(desk).toContain("isLight ?");
  });
});
