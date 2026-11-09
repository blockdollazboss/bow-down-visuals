/**
 * scheduler-publish — Stack-400 census B item B-12.
 * The Scheduler Desk handled accounts/auth/scheduling but had no
 * publish action: the four social publish rails (POST
 * /api/social/{platform}/publish, 100 Visual Bucs each) were only
 * reachable from the 2D post modals. These tests pin the desk seam:
 * registry prices, payloads byte-identical to the modals', the
 * scheduler worker's caption composition, the modals' idempotencyKey
 * discipline, and the response reading (402 / 409 / drift) the
 * modals established.
 */
import { describe, expect, it } from "vitest";
import { getCreditCost } from "../credit-costs";
import {
  SOCIAL_PUBLISH_COST_VISUAL_BUCS,
  SOCIAL_PUBLISH_PATHS,
  SOCIAL_PUBLISH_X_TEXT_LIMIT,
  buildSocialPublishPayload,
  classifySocialPublishResponse,
  loadSocialPublishKey,
  parseSocialPublishResult,
  retireSocialPublishKey,
  schedulerPublishText,
  socialPublishCost,
  socialPublishStorageKey,
  validateSocialPublish,
  type SchedulerAccount,
  type SchedulerComposeDraft,
  type SchedulerPlatformKey,
} from "./scheduler-desk";

const PLATFORMS: SchedulerPlatformKey[] = ["instagram", "facebook", "tiktok", "x"];

const ACCOUNTS: SchedulerAccount[] = [
  { id: "a-ig", platform: "instagram", label: "@king", expired: false },
  { id: "a-fb", platform: "facebook", label: "King Page", expired: false },
  { id: "a-tt", platform: "tiktok", label: "@kingtt", expired: false },
  { id: "a-x", platform: "x", label: "@kingx", expired: false },
  { id: "a-x-old", platform: "x", label: "@oldx", expired: true },
];

function draft(over: Partial<SchedulerComposeDraft> = {}): SchedulerComposeDraft {
  return {
    mediaUrl: "https://cdn.example/clip.mp4",
    mediaType: "video",
    caption: "New clip out",
    hashtags: "#bdv",
    platforms: ["instagram"],
    accountIds: {},
    whenLocal: "2026-10-23T18:30",
    ...over,
  };
}

describe("prices — the registry rows the 2D modals read", () => {
  it("every publish rail is registered at 100 Visual Bucs", () => {
    for (const platform of PLATFORMS) {
      const path = SOCIAL_PUBLISH_PATHS[platform];
      expect(path).toBe(`/api/social/${platform}/publish`);
      expect(getCreditCost(path)?.cost).toBe(100);
      expect(socialPublishCost(platform)).toBe(100);
    }
    expect(SOCIAL_PUBLISH_COST_VISUAL_BUCS).toBe(100);
  });
});

describe("publish text — the scheduler worker's fullCaption composition", () => {
  it("joins trimmed caption and hashtags with a newline", () => {
    expect(schedulerPublishText(draft())).toBe("New clip out\n#bdv");
    expect(schedulerPublishText(draft({ caption: "  spaced  ", hashtags: " #a #b " }))).toBe(
      "spaced\n#a #b",
    );
  });
  it("handles either side empty", () => {
    expect(schedulerPublishText(draft({ hashtags: "" }))).toBe("New clip out");
    expect(schedulerPublishText(draft({ caption: "" }))).toBe("#bdv");
    expect(schedulerPublishText(draft({ caption: " ", hashtags: "" }))).toBe("");
  });
});

describe("validation — refusals in words, never a silent no-op", () => {
  it("needs a live account first, per platform", () => {
    expect(validateSocialPublish("instagram", draft(), [])).toBe(
      "Connect your Instagram account first — publishing needs an account to post through.",
    );
    const expiredOnly: SchedulerAccount[] = [
      { id: "a-tt-old", platform: "tiktok", label: "@old", expired: true },
    ];
    expect(validateSocialPublish("tiktok", draft(), expiredOnly)).toContain("TikTok");
  });
  it("video rails need a video: no media, then image, refused in words", () => {
    expect(validateSocialPublish("facebook", draft({ mediaUrl: "" }), ACCOUNTS)).toBe(
      "Add the video this post carries first.",
    );
    expect(validateSocialPublish("instagram", draft({ mediaType: "image" }), ACCOUNTS)).toBe(
      "Instagram publishes video — this post carries an image.",
    );
  });
  it("X is text-first: empty text refused, 280 cap refused with the count, never truncated", () => {
    expect(
      validateSocialPublish("x", draft({ caption: "", hashtags: "", mediaUrl: "" }), ACCOUNTS),
    ).toBe("Write the post text first.");
    const long = draft({ caption: "a".repeat(281), hashtags: "", mediaUrl: "" });
    expect(validateSocialPublish("x", long, ACCOUNTS)).toBe(
      `X posts cap at 280 characters — this one is ${SOCIAL_PUBLISH_X_TEXT_LIMIT + 1}.`,
    );
    const atCap = draft({ caption: "a".repeat(280), hashtags: "", mediaUrl: "" });
    expect(validateSocialPublish("x", atCap, ACCOUNTS)).toBeNull();
    expect(validateSocialPublish("x", draft({ mediaUrl: "" }), ACCOUNTS)).toBeNull();
  });
  it("a valid video draft passes on every rail; desk-passed strings win over defaults", () => {
    for (const platform of PLATFORMS) {
      expect(validateSocialPublish(platform, draft(), ACCOUNTS)).toBeNull();
    }
    expect(
      validateSocialPublish("instagram", draft({ mediaUrl: "" }), ACCOUNTS, {
        needMedia: "CUSTOM",
      }),
    ).toBe("CUSTOM");
  });
});

describe("payloads — byte-identical to the 2D modals'", () => {
  it("instagram / tiktok / facebook send { accountId, videoUrl, caption, idempotencyKey }", () => {
    for (const platform of ["instagram", "tiktok", "facebook"] as const) {
      expect(buildSocialPublishPayload(platform, draft(), ACCOUNTS, "key-12345678")).toEqual({
        accountId: `a-${platform === "instagram" ? "ig" : platform === "tiktok" ? "tt" : "fb"}`,
        videoUrl: "https://cdn.example/clip.mp4",
        caption: "New clip out\n#bdv",
        idempotencyKey: "key-12345678",
      });
    }
  });
  it("X is text-first: text always, videoUrl only for a video, imageUrl only for an image", () => {
    expect(buildSocialPublishPayload("x", draft({ mediaUrl: "" }), ACCOUNTS, "k")).toEqual({
      accountId: "a-x",
      text: "New clip out\n#bdv",
      idempotencyKey: "k",
    });
    expect(buildSocialPublishPayload("x", draft(), ACCOUNTS, "k")).toEqual({
      accountId: "a-x",
      text: "New clip out\n#bdv",
      videoUrl: "https://cdn.example/clip.mp4",
      idempotencyKey: "k",
    });
    expect(buildSocialPublishPayload("x", draft({ mediaType: "image" }), ACCOUNTS, "k")).toEqual({
      accountId: "a-x",
      text: "New clip out\n#bdv",
      imageUrl: "https://cdn.example/clip.mp4",
      idempotencyKey: "k",
    });
  });
  it("the composer's explicit account pick wins; no live account → null", () => {
    const picked = draft({ accountIds: { x: "a-x-old" } });
    /* the expired pick falls back to the first live account, like the desk's selects */
    expect(buildSocialPublishPayload("x", picked, ACCOUNTS, "k")?.accountId).toBe("a-x");
    expect(buildSocialPublishPayload("instagram", draft(), [])).toBeNull();
  });
});

describe("idempotency keys — the modals' discipline", () => {
  function fakeStorage() {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  }
  it("one key per intent: minted once, persisted, reused across retries and caches", () => {
    const storage = fakeStorage();
    let n = 0;
    const mint = () => `minted-${++n}-uuid`;
    const cache = new Map<string, string>();
    const first = loadSocialPublishKey("instagram", "https://v/1.mp4", storage, cache, mint);
    expect(first).toBe("minted-1-uuid");
    expect(loadSocialPublishKey("instagram", "https://v/1.mp4", storage, cache, mint)).toBe(first);
    /* a fresh component (new cache) still reuses the persisted key */
    expect(loadSocialPublishKey("instagram", "https://v/1.mp4", storage, new Map(), mint)).toBe(
      first,
    );
    expect(n).toBe(1);
  });
  it("slots are per platform + media; X text-only keys on text-only; retire frees the slot", () => {
    expect(socialPublishStorageKey("x", "")).toBe("world-publish-key:x:text-only");
    expect(socialPublishStorageKey("tiktok", " https://v/1.mp4 ")).toBe(
      "world-publish-key:tiktok:https://v/1.mp4",
    );
    const storage = fakeStorage();
    const cache = new Map<string, string>();
    const a = loadSocialPublishKey("instagram", "https://v/1.mp4", storage, cache, () => "key-a-0001");
    const b = loadSocialPublishKey("facebook", "https://v/1.mp4", storage, cache, () => "key-b-0002");
    expect(a).not.toBe(b);
    retireSocialPublishKey("instagram", "https://v/1.mp4", storage, cache);
    expect(
      loadSocialPublishKey("instagram", "https://v/1.mp4", storage, cache, () => "key-c-0003"),
    ).toBe("key-c-0003");
  });
  it("without storage the in-memory cache still holds the discipline", () => {
    const cache = new Map<string, string>();
    let n = 0;
    const mint = () => `mem-${++n}`;
    const first = loadSocialPublishKey("x", "", null, cache, mint);
    expect(loadSocialPublishKey("x", "", null, cache, mint)).toBe(first);
    expect(n).toBe(1);
  });
});

describe("result reading — every rail's shape, null on drift", () => {
  it("instagram / facebook / x success shapes", () => {
    expect(
      parseSocialPublishResult({
        mediaId: "m1",
        permalink: "https://instagram.com/reel/m1",
        creditsUsed: 100,
        creditsRemaining: 900,
      }),
    ).toEqual({
      mediaId: "m1",
      permalink: "https://instagram.com/reel/m1",
      creditsUsed: 100,
      creditsRemaining: 900,
      deliveredToDrafts: false,
      deduped: false,
    });
    expect(parseSocialPublishResult({ videoId: "v9", permalink: "https://fb/v9" })?.mediaId).toBe(
      "v9",
    );
    expect(parseSocialPublishResult({ tweetId: "t7", permalink: null })?.mediaId).toBe("t7");
  });
  it("tiktok fresh success: sent to drafts, no permalink — still a result", () => {
    const r = parseSocialPublishResult({
      publishId: "p1",
      status: "sent_to_tiktok_inbox",
      message: "Your video was sent to your TikTok drafts. Open TikTok to finish posting.",
      creditsUsed: 100,
      creditsRemaining: 800,
    });
    expect(r?.mediaId).toBe("p1");
    expect(r?.permalink).toBeNull();
    expect(r?.deliveredToDrafts).toBe(true);
  });
  it("a stored replay reads with deduped set", () => {
    const r = parseSocialPublishResult({
      mediaId: "m1",
      permalink: null,
      creditsUsed: 100,
      creditsRemaining: 900,
      deduped: true,
    });
    expect(r?.deduped).toBe(true);
    expect(r?.deliveredToDrafts).toBe(false);
  });
  it("drift reads as null — never a painted success", () => {
    expect(parseSocialPublishResult(null)).toBeNull();
    expect(parseSocialPublishResult({})).toBeNull();
    expect(parseSocialPublishResult({ ok: true })).toBeNull();
    expect(parseSocialPublishResult("posted")).toBeNull();
  });
});

describe("outcome classification — the modals' answer handling", () => {
  it("402 and out_of_credits bodies are the top-up state", () => {
    expect(classifySocialPublishResponse(402, { error: "out_of_credits" }, "FB").kind).toBe(
      "out-of-credits",
    );
    expect(classifySocialPublishResponse(200, { error: "out_of_credits" }, "FB").kind).toBe(
      "out-of-credits",
    );
  });
  it("409 publish_in_progress is a notice, not an error; other 409s fail", () => {
    expect(
      classifySocialPublishResponse(409, { error: "publish_in_progress" }, "FB").kind,
    ).toBe("in-progress");
    expect(classifySocialPublishResponse(409, { error: "other" }, "FB")).toEqual({
      kind: "failed",
      message: "FB",
    });
  });
  it("2xx parses or fails honestly; other statuses carry the rail's message or the fallback", () => {
    const ok = classifySocialPublishResponse(
      200,
      { mediaId: "m1", permalink: null, creditsUsed: 100 },
      "FB",
    );
    expect(ok.kind).toBe("ok");
    expect(classifySocialPublishResponse(200, { weird: true }, "FB")).toEqual({
      kind: "failed",
      message: "FB",
    });
    expect(classifySocialPublishResponse(500, { message: "rail said no" }, "FB")).toEqual({
      kind: "failed",
      message: "rail said no",
    });
    expect(classifySocialPublishResponse(500, {}, "FB")).toEqual({
      kind: "failed",
      message: "FB",
    });
  });
});
