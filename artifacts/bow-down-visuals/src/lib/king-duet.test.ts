import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clipDuetsPath,
  fetchKingDuetRail,
  isKingFeatured,
  kingDuetProfileViewState,
  kingFeaturePath,
  kingFeatureRequest,
  normalizeKingDuetCandidates,
  normalizeKingDuetRail,
  withKingFeaturedAt,
} from "./king-duet";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const shortsSource = read("../pages/shorts.tsx");
const kingDuetLib = read("./king-duet.ts");
const artistPublicSource = read("../pages/artist-public.tsx");
const kingDuetPickSectionSource = read("../components/artist/KingDuetPickSection.tsx");

/* The rail payloads below mirror routes/shorts.ts exactly (verified
   against GET /shorts/king-duet and GET /videos/:id/duets at
   503c61f05): snake_case on the rail, stamp = king_featured_at. */

const railPayload = {
  event: { name: "Duet the King", pick_kind: "house_pick", note: "…" },
  king: { id: "prof-king", slug: "thy-cheat-code", display_name: "Thy Cheat Code", avatar_url: null },
  open_clips: [
    {
      id: "clip-1", title: "Crown check", video_url: "https://cdn/clip1.mp4", thumbnail_url: null,
      view_count: 1200, like_count: 300, duet_count: 2, duets_enabled: true,
      creator: { id: "prof-king", slug: "thy-cheat-code", display_name: "Thy Cheat Code", avatar_url: null, is_official: true },
      created_at: "2026-11-01T00:00:00.000Z",
    },
    {
      id: "clip-2", title: "No video row", video_url: null, thumbnail_url: null,
      view_count: 0, like_count: 0, duet_count: 0, duets_enabled: true, creator: null, created_at: "",
    },
  ],
  featured: [
    {
      id: "duet-9", title: "Fan went off", video_url: "https://cdn/duet9.mp4", thumbnail_url: "https://cdn/t.jpg",
      view_count: 42, like_count: 7, king_featured_at: "2026-11-02T10:00:00.000Z", created_at: "2026-11-01T12:00:00.000Z",
      pick_kind: "house_pick",
      creator: { id: "prof-fan", slug: "fan-one", display_name: "Fan One", avatar_url: null },
      duet_parent: { id: "clip-1", title: "Crown check", creator_slug: "thy-cheat-code", creator_name: "Thy Cheat Code" },
    },
  ],
};

describe("normalizeKingDuetRail — the panel reads the server's truth", () => {
  it("parses the rail into render-safe clips + featured picks", () => {
    const rail = normalizeKingDuetRail(railPayload);
    expect(rail.king?.slug).toBe("thy-cheat-code");
    /* the row with no video_url cannot render honestly — dropped */
    expect(rail.open_clips.map((c) => c.id)).toEqual(["clip-1"]);
    expect(rail.open_clips[0]!.duet_count).toBe(2);
    expect(rail.featured).toHaveLength(1);
    expect(rail.featured[0]!.creator?.display_name).toBe("Fan One");
    expect(rail.featured[0]!.duet_parent?.title).toBe("Crown check");
    expect(rail.featured[0]!.pick_kind).toBe("house_pick");
  });

  it("a garbage or partial payload normalizes to the honest empty rail", () => {
    expect(normalizeKingDuetRail(null)).toEqual({ king: null, open_clips: [], featured: [] });
    expect(normalizeKingDuetRail("nope")).toEqual({ king: null, open_clips: [], featured: [] });
    expect(normalizeKingDuetRail({ open_clips: "x" })).toEqual({ king: null, open_clips: [], featured: [] });
  });

  it("only an explicit false closes a clip's duet door (feed rule)", () => {
    const rail = normalizeKingDuetRail({
      open_clips: [
        { id: "a", video_url: "https://cdn/a.mp4", duets_enabled: false },
        { id: "b", video_url: "https://cdn/b.mp4" },
      ],
    });
    expect(rail.open_clips.map((c) => c.duets_enabled)).toEqual([false, true]);
  });
});

describe("normalizeKingDuetCandidates — pick candidates from the children rail", () => {
  it("reads items with their stamps; the children rail's creator rows are camelCase and still land", () => {
    const rows = normalizeKingDuetCandidates({
      parent_id: "clip-1",
      kind: "duet",
      items: [
        {
          id: "duet-9", title: "Fan went off", video_url: "https://cdn/duet9.mp4", thumbnail_url: null,
          view_count: 42, like_count: 7, created_at: "2026-11-01T12:00:00.000Z",
          king_featured_at: "2026-11-02T10:00:00.000Z",
          creator: { id: "prof-fan", slug: "fan-one", displayName: "Fan One", avatarUrl: null },
        },
        {
          id: "duet-10", title: "Second run", video_url: "https://cdn/duet10.mp4", thumbnail_url: null,
          view_count: 3, like_count: 0, created_at: "2026-11-01T13:00:00.000Z",
          king_featured_at: null,
          creator: { id: "prof-fan2", slug: "fan-two", display_name: "Fan Two", avatar_url: null },
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.creator?.display_name).toBe("Fan One");
    expect(isKingFeatured(rows[0]!)).toBe(true);
    expect(isKingFeatured(rows[1]!)).toBe(false);
  });

  it("no items key (or junk) reads as no candidates, never a crash", () => {
    expect(normalizeKingDuetCandidates(null)).toEqual([]);
    expect(normalizeKingDuetCandidates({})).toEqual([]);
    expect(normalizeKingDuetCandidates({ items: [{ id: "x" }] })).toEqual([]);
  });
});

describe("isKingFeatured — the stamp is the whole truth", () => {
  it("a non-empty stamp is a pick; null/empty is not", () => {
    expect(isKingFeatured({ king_featured_at: "2026-11-02T10:00:00.000Z" })).toBe(true);
    expect(isKingFeatured({ king_featured_at: null })).toBe(false);
    expect(isKingFeatured({ king_featured_at: "" })).toBe(false);
  });
});

describe("the write rail — paths and methods match routes/shorts.ts", () => {
  it("POST features and DELETE lifts, on the one king-feature path", () => {
    expect(kingFeaturePath("duet-9")).toBe("/api/videos/duet-9/king-feature");
    expect(kingFeatureRequest("duet-9", true)).toEqual({ path: "/api/videos/duet-9/king-feature", method: "POST" });
    expect(kingFeatureRequest("duet-9", false)).toEqual({ path: "/api/videos/duet-9/king-feature", method: "DELETE" });
  });

  it("ids are URL-encoded; candidates ride the children rail", () => {
    expect(kingFeaturePath("a b/c")).toBe("/api/videos/a%20b%2Fc/king-feature");
    expect(clipDuetsPath("clip-1")).toBe("/api/videos/clip-1/duets");
  });

  it("the rail is free: the seam carries no charge machinery at all", () => {
    expect(kingDuetLib).not.toContain("chargeCredits");
    expect(kingFeatureRequest("duet-9", true).path).not.toContain("credit");
  });
});

describe("withKingFeaturedAt — a confirmed write folds the server's stamp in", () => {
  const rows = [
    { id: "duet-9", king_featured_at: null as string | null },
    { id: "duet-10", king_featured_at: null as string | null },
  ];

  it("stamps only the written row, from the response value", () => {
    const next = withKingFeaturedAt(rows, "duet-9", "2026-11-02T10:00:00.000Z");
    expect(next[0]!.king_featured_at).toBe("2026-11-02T10:00:00.000Z");
    expect(next[1]!.king_featured_at).toBeNull();
    /* input untouched — a failed write simply never calls this */
    expect(rows[0]!.king_featured_at).toBeNull();
  });

  it("a lift folds null back in", () => {
    const picked = withKingFeaturedAt(rows, "duet-9", "2026-11-02T10:00:00.000Z");
    expect(withKingFeaturedAt(picked, "duet-9", null)[0]!.king_featured_at).toBeNull();
  });
});

describe("fetchKingDuetRail — the one read seam for display surfaces", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the public rail path and returns the normalized rail", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => railPayload }));
    vi.stubGlobal("fetch", fetchMock);
    const rail = await fetchKingDuetRail();
    expect(fetchMock).toHaveBeenCalledWith("/api/shorts/king-duet");
    expect(rail.featured).toHaveLength(1);
    expect(rail.featured[0]!.creator?.display_name).toBe("Fan One");
  });

  it("a non-OK response throws — a failed load stays a failure, never a fake-empty rail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(fetchKingDuetRail()).rejects.toThrow("500");
  });
});

describe("kingDuetProfileViewState — the pick on the King's profile (ruling #38)", () => {
  it("official profile + a pick exists → the section shows", () => {
    expect(kingDuetProfileViewState({ isOfficial: true, status: "ready", featuredCount: 1 })).toBe("picks");
    expect(kingDuetProfileViewState({ isOfficial: true, status: "ready", featuredCount: 3 })).toBe("picks");
  });

  it("non-official profile → no section, whatever the rail holds", () => {
    expect(kingDuetProfileViewState({ isOfficial: false, status: "ready", featuredCount: 1 })).toBe("hidden");
    expect(kingDuetProfileViewState({ isOfficial: false, status: "ready", featuredCount: 0 })).toBe("hidden");
    expect(kingDuetProfileViewState({ isOfficial: false, status: "loading", featuredCount: 0 })).toBe("hidden");
    /* not even an error shell leaks onto someone else's profile */
    expect(kingDuetProfileViewState({ isOfficial: false, status: "error", featuredCount: 0 })).toBe("hidden");
  });

  it("official profile with no pick → hidden, no hollow shell", () => {
    expect(kingDuetProfileViewState({ isOfficial: true, status: "ready", featuredCount: 0 })).toBe("hidden");
  });

  it("official profile still loading → loading (renders nothing yet)", () => {
    expect(kingDuetProfileViewState({ isOfficial: true, status: "loading", featuredCount: 0 })).toBe("loading");
  });

  it("a failed load on the official profile is its own error state — never a fake 'no pick'", () => {
    expect(kingDuetProfileViewState({ isOfficial: true, status: "error", featuredCount: 0 })).toBe("error");
  });
});

describe("artist-public.tsx — the King's profile carries the featured pick (ruling #38)", () => {
  it("the section is docked on the profile, gated on the official flag", () => {
    expect(artistPublicSource).toContain('import KingDuetPickSection from "@/components/artist/KingDuetPickSection"');
    expect(artistPublicSource).toContain("<KingDuetPickSection isOfficial={profile.is_official === true} />");
  });

  it("the section reads the same rail through the same normalizer seam as /shorts", () => {
    expect(kingDuetPickSectionSource).toContain("fetchKingDuetRail()");
    expect(kingDuetLib).toContain('fetch("/api/shorts/king-duet")');
    expect(kingDuetLib).toContain("normalizeKingDuetRail(await res.json())");
    expect(kingDuetPickSectionSource).toContain("kingDuetProfileViewState({");
  });

  it("a non-official profile never even fetches the rail", () => {
    expect(kingDuetPickSectionSource).toContain("if (!isOfficial) return;");
  });

  it("renders the /shorts featured-pick idiom: fan credited + linked, parent clip named, HOUSE PICK stamp", () => {
    expect(kingDuetPickSectionSource).toContain('data-testid="king-duet-profile-pick"');
    expect(kingDuetPickSectionSource).toContain("The King&apos;s featured pick");
    expect(kingDuetPickSectionSource).toContain("HOUSE PICK");
    expect(kingDuetPickSectionSource).toContain("href={`/shorts?start=${f.id}`}");
    expect(kingDuetPickSectionSource).toContain("href={`/artist/${f.creator?.slug ?? \"\"}`}");
    expect(kingDuetPickSectionSource).toContain("f.duet_parent");
  });

  it("failure is honest: a quiet error + retry state, and no fake-empty copy anywhere", () => {
    expect(kingDuetPickSectionSource).toContain('data-testid="king-duet-profile-error"');
    expect(kingDuetPickSectionSource).toContain("setRetryNonce((n) => n + 1)");
    expect(kingDuetPickSectionSource).not.toContain("No pick yet");
  });

  it("display only — setting/lifting the pick stays the /shorts house control", () => {
    expect(kingDuetPickSectionSource).not.toContain("kingFeatureRequest");
    expect(kingDuetPickSectionSource).not.toContain("king-feature");
  });

  it("themed in the profile's own tokens — no single-theme styling", () => {
    expect(kingDuetPickSectionSource).toContain("var(--ap-text)");
    expect(kingDuetPickSectionSource).toContain("var(--ap-card)");
    expect(kingDuetPickSectionSource).toContain("var(--ap-border)");
    expect(kingDuetPickSectionSource).not.toContain("bg-zinc-950");
    expect(kingDuetPickSectionSource).not.toContain("text-white");
  });
});

describe("shorts.tsx — the house control is wired to the rail, house-only", () => {
  it("the panel receives the house flag from the /me payload's is_official", () => {
    expect(shortsSource).toContain("setMyIsOfficial(data?.is_official === true)");
    expect(shortsSource).toContain("<KingDuetPanel isHouse={myIsOfficial} authHeaders={authHeaders} />");
  });

  it("writes go through the king-feature request seam with the viewer's auth", () => {
    expect(shortsSource).toContain("kingFeatureRequest(videoId, feature)");
    expect(shortsSource).toContain("headers: { ...(await authHeaders()) }");
    expect(shortsSource).toContain("clipDuetsPath(clipId)");
  });

  it("the controls render only for the house — fans keep the display-only panel", () => {
    expect(shortsSource).toContain('data-testid="king-pick-open"');
    expect(shortsSource).toContain('data-testid="king-pick-feature"');
    expect(shortsSource).toContain('data-testid="king-pick-remove"');
    expect(shortsSource).toContain('data-testid="king-pick-house-note"');
    const houseGates = shortsSource.match(/isHouse &&/g) ?? [];
    expect(houseGates.length).toBeGreaterThanOrEqual(4);
  });

  it("failure is honest: the error state is set from the rail's own words and no stamp folds before res.ok", () => {
    const setPickBody = shortsSource.slice(shortsSource.indexOf("async function setPick"));
    expect(setPickBody).toContain("setPickError");
    expect(setPickBody).toContain("The pick didn't land. Try again.");
    /* the failure return sits ahead of any state fold */
    expect(setPickBody.indexOf("if (!res.ok)")).toBeLessThan(setPickBody.indexOf("withKingFeaturedAt"));
    expect(shortsSource).toContain('data-testid="king-pick-error"');
  });

  it("success re-reads the rail — the featured list is the server's truth, not local state", () => {
    const setPickBody = shortsSource.slice(shortsSource.indexOf("async function setPick"));
    expect(setPickBody).toContain('apiGet("/api/shorts/king-duet")');
    expect(setPickBody).toContain("setPendingPickId(videoId)");
  });
});
