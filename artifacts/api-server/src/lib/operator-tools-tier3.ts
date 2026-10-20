/* ─── Cloud Operator Phase 2, Lane E — Tier 3 charged tools ──────────
   The operator's paying hands. Every handler here runs the SAME rail
   the pages call, AS the member, through the rail's own exported
   core (lib/rail-core): the rail's charge is the ONLY charge, its
   refund behavior is unchanged, and its result is what the executor
   audits and reports. The executor's confirmation + daily cap +
   single-use consumption wrap every call; where a rail accepts a
   client idempotency key, the confirmation's key rides along as the
   second wall against a double charge.

   Arguments come from the member's message (the model copies them
   into the marker). Each tool's validateArgs runs at PROPOSAL time:
   a missing or wrong detail proposes nothing and asks — the
   operator never invents a prompt, a length, or a product. The
   normalized args are baked into the pending row, so what was
   confirmed is exactly what runs. Handlers re-check their money
   invariants defensively before calling the rail.

   Deliberately NOT here (design §1 + lane brief): track publishing
   (its price constant is unverified) and spoken replies (they ride
   their own rail, routes/chat-speak.ts, outside the executor). */

import { and, eq } from "drizzle-orm";
import { bioPagesTable, db, ugcAdsTable } from "@workspace/db";
import { getCreditBalance } from "./credits";
import { logger } from "./logger";
import { railFailure, type RailCoreDeps, type RailCoreResult } from "./rail-core";
import type {
  OperatorArgsVerdict,
  OperatorTool,
  OperatorToolContext,
  ToolRunResult,
} from "./operator-tools";
import {
  clampLengthMs,
  creditCostForLength,
  runGenerateMusicAudio,
} from "../routes/generate/music-audio";
import {
  runPollRunwayClip,
  runSubmitRunwayClip,
} from "../routes/generate/runway-clip";
import { runSaveGeneratedClip } from "../routes/generated-clips";
import { PUBLISH_COST, runPublishBioPage } from "../routes/bio-pages";
import { BRAND_KIT_COST, runGenerateBrandKit } from "../routes/generate/brand-kit";
import { HEADSHOT_CREDITS, runGenerateHeadshot } from "../routes/generate/headshot-studio";
import {
  STREAM_PACK_ASSETS,
  STREAM_PACK_CREDIT_COST,
  runGenerateStreamPack,
} from "../routes/generate/stream-pack";
import { GEN45_CREDIT_COST } from "../routes/generate/clip-pricing";
import {
  UGC_STYLES,
  UGC_PERSONA_CREDIT_COST,
  UGC_VIDEO_CREDIT_COST,
  normalizeScript,
  runCreateUgcAd,
  runGenerateUgcAd,
  runGenerateUgcPersona,
} from "../routes/ugc-ads";

type Handler = OperatorTool["handler"];
type Validator = NonNullable<OperatorTool["validateArgs"]>;

/* ── Small shared helpers ───────────────────────────────────────────── */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** The rail-call identity for one operator action: the member
    themself, with a FRESH balance read standing in for the
    req.userCredits requireAuth stamps on real requests. */
async function railDeps(ctx: OperatorToolContext): Promise<RailCoreDeps> {
  return {
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    userCredits: await getCreditBalance(ctx.userId),
    log: logger,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ── Songs (duration-tiered: three tools, one per tier) ─────────────── */

function songValidator(tierPriceVb: number): Validator {
  return async ({ args }) => {
    const prompt = str(args["prompt"]);
    if (!prompt) {
      return {
        ok: false,
        askText:
          "What's the song about? Give me the subject or the story in your words and I'll set it up — I won't invent one for you. 🦈",
      };
    }
    const lengthSeconds = num(args["lengthSeconds"]);
    if (lengthSeconds === undefined || lengthSeconds <= 0) {
      return {
        ok: false,
        askText:
          `How long should the song be? Up to 1 minute is ${creditCostForLength(60_000)} Visual Bucs, ` +
          `up to 3 minutes is ${creditCostForLength(180_000)}, and up to 5 minutes is ${creditCostForLength(300_000)}. 🦈`,
      };
    }
    const ms = clampLengthMs(lengthSeconds);
    const cost = creditCostForLength(ms);
    if (cost !== tierPriceVb) {
      return {
        ok: false,
        askText:
          `A ${Math.round(ms / 1000)}-second song runs ${cost} Visual Bucs — that's a different length tier. ` +
          `Ask me for that length and I'll put the right price in front of you before anything runs. 🦈`,
      };
    }
    const normalized: Record<string, unknown> = {
      prompt,
      lengthSeconds: ms / 1000,
    };
    const songTitle = str(args["songTitle"]);
    if (songTitle) normalized["songTitle"] = songTitle;
    const lyrics = str(args["lyrics"]);
    if (lyrics) normalized["lyrics"] = lyrics;
    if (args["instrumental"] === true) normalized["instrumental"] = true;
    return { ok: true, args: normalized };
  };
}

function songHandler(tierPriceVb: number): Handler {
  return async (ctx) => {
    const prompt = str(ctx.args["prompt"]) ?? "";
    const ms = clampLengthMs(num(ctx.args["lengthSeconds"]) ?? 0);
    const cost = creditCostForLength(ms);
    /* Defensive: the confirmed tier is the charged tier. If the args
       no longer map to this tool's price, refuse BEFORE the rail —
       never charge a price the member didn't confirm. */
    if (cost !== tierPriceVb) {
      throw new Error(
        `Song length (${Math.round(ms / 1000)}s) prices at ${cost} Visual Bucs, not the confirmed ${tierPriceVb} — refused before the rail.`,
      );
    }
    const body: Record<string, unknown> = {
      prompt,
      lengthSeconds: ms / 1000,
    };
    const songTitle = str(ctx.args["songTitle"]);
    if (songTitle) body["songTitle"] = songTitle;
    const lyrics = str(ctx.args["lyrics"]);
    if (lyrics) body["lyrics"] = lyrics;
    if (ctx.args["instrumental"] === true) body["instrumental"] = true;

    const result = await runGenerateMusicAudio(await railDeps(ctx), body);
    if (result.status !== 200) {
      throw railFailure(result, "Song generation failed.");
    }
    return {
      summary: `Made a song (${Math.round(ms / 1000)} seconds)`,
      target: typeof result.body?.songId === "string" ? result.body.songId : null,
      priceCharged: cost,
      replyText:
        "Done — your song is made and saved in your song library, ready to play, share, or build on. 🦈",
    };
  };
}

/* ── Gen 4.5 video (job-based rail) ─────────────────────────────────── */

/** Completion driver for an operator-started runway clip. The rail
    charges ONLY on success, inside its own poll handler — this
    driver simply polls that exact handler (as the member) until the
    task lands, then saves the clip into the member's library through
    the generated-clips rail, so an operator-started video finishes
    the same way a page-started one does. Exported for tests. */
export async function driveOperatorVideoTask(input: {
  userId: string;
  taskId: string;
  prompt: string;
  intervalMs?: number;
  maxAttempts?: number;
}): Promise<"saved" | "failed" | "timeout"> {
  const intervalMs = input.intervalMs ?? 15_000;
  const maxAttempts = input.maxAttempts ?? 80; // ~20 minutes at 15s
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(intervalMs);
    let result: RailCoreResult;
    try {
      result = await runPollRunwayClip(
        {
          userId: input.userId,
          userCredits: await getCreditBalance(input.userId),
          log: logger,
        },
        input.taskId,
      );
    } catch {
      continue; // transient poll error — keep driving, bounded
    }
    const b = (result.body ?? {}) as Record<string, unknown>;
    if (result.status >= 500) continue;
    if (b["status"] === "processing") continue;
    if (b["status"] === "succeeded") {
      const videoUrl =
        typeof b["storageRef"] === "string"
          ? b["storageRef"]
          : typeof b["url"] === "string"
            ? b["url"]
            : null;
      if (!videoUrl) return "failed";
      const save = await runSaveGeneratedClip(
        { userId: input.userId, userCredits: 0, log: logger },
        {
          videoUrl,
          runwayJobId: input.taskId,
          title: input.prompt.slice(0, 80) || "Operator video",
          prompt: input.prompt,
        },
      );
      return save.status < 300 ? "saved" : "failed";
    }
    /* failed / cancelled / anything else terminal: the rail charged
       nothing for a failed task — that is its own rule. */
    return "failed";
  }
  return "timeout";
}

const videoValidator: Validator = async ({ args }) => {
  const prompt = str(args["prompt"]);
  if (!prompt) {
    return {
      ok: false,
      askText:
        "What should the video show? Describe the scene in your words and I'll set it up — I won't invent one for you. 🦈",
    };
  }
  return { ok: true, args: { prompt } };
};

const videoHandler: Handler = async (ctx) => {
  const prompt = str(ctx.args["prompt"]) ?? "";
  const result = await runSubmitRunwayClip(await railDeps(ctx), {
    promptText: prompt,
    model: "gen4.5",
  });
  if (result.status !== 200) {
    throw railFailure(result, "Video generation could not be started.");
  }
  const taskId = result.body?.taskId;
  if (typeof taskId !== "string" || !taskId) {
    throw new Error("The video rail started no task — nothing was charged.");
  }
  /* The rail is job-based: it charges on success, inside its poll
     handler. Drive it to completion in the background so the clip
     actually lands in the member's library; the reply says exactly
     that much and no more. */
  void driveOperatorVideoTask({ userId: ctx.userId, taskId, prompt }).catch((err) =>
    logger.error({ err, taskId }, "[operator] video completion driver failed"),
  );
  return {
    summary: "Started a Gen 4.5 video",
    target: taskId,
    /* Nothing has been charged yet — the rail charges on success.
       Reporting the registry price here would write a lie into the
       audit; the charge, when it lands, is in the credit ledger. */
    priceCharged: 0,
    replyText:
      `Your video is generating now. The ${GEN45_CREDIT_COST} Visual Bucs land only when it finishes — ` +
      `if it fails, nothing is charged. When it's ready it'll be in your video library and generation history. 🦈`,
  };
};

/* ── Bio publish ────────────────────────────────────────────────────── */

const bioValidator: Validator = async ({ userId, args }) => {
  const rows = await db
    .select()
    .from(bioPagesTable)
    .where(eq(bioPagesTable.userId, userId));
  const pageArg = str(args["page"]);
  if (pageArg) {
    const wanted = pageArg.toLowerCase();
    const page = rows.find(
      (r) =>
        r.id === pageArg ||
        r.slug.toLowerCase() === wanted ||
        (r.displayName ?? "").toLowerCase() === wanted,
    );
    if (!page) {
      return {
        ok: false,
        askText: `I couldn't find a bio page matching "${pageArg}" on your account — check the name and ask me again. 🦈`,
      };
    }
    if (page.isPublished) {
      return {
        ok: false,
        askText: `Your "${page.displayName || page.slug}" bio page is already published — it's live. 🦈`,
      };
    }
    return { ok: true, args: { pageId: page.id } };
  }
  const drafts = rows.filter((r) => !r.isPublished);
  if (drafts.length === 0) {
    return {
      ok: false,
      askText:
        rows.length > 0
          ? "All your bio pages are already published — there's nothing waiting to go live. 🦈"
          : "You don't have a bio page yet — build one on the Bio Page page first, and then I can publish it for you. 🦈",
    };
  }
  if (drafts.length > 1) {
    const names = drafts.map((r) => `"${r.displayName || r.slug}"`).join(", ");
    return {
      ok: false,
      askText: `You have ${drafts.length} unpublished bio pages: ${names}. Which one should I publish? Name it and ask me again. 🦈`,
    };
  }
  return { ok: true, args: { pageId: drafts[0]!.id } };
};

const bioHandler: Handler = async (ctx) => {
  const pageId = str(ctx.args["pageId"]) ?? "";
  const result = await runPublishBioPage(await railDeps(ctx), pageId);
  if (result.status !== 200) {
    throw railFailure(result, "Publishing the bio page failed.");
  }
  return {
    summary: `Published bio page ${result.body?.slug ?? pageId}`,
    target: typeof result.body?.slug === "string" ? result.body.slug : pageId,
    priceCharged: PUBLISH_COST,
    replyText: `Published — your bio page is live at ${result.body?.url ?? "your bio page"}. 🦈`,
  };
};

/* ── Brand kit ──────────────────────────────────────────────────────── */

const brandKitValidator: Validator = async ({ args }) => {
  const brandName = str(args["brandName"]);
  if (!brandName) {
    return {
      ok: false,
      askText: "What's the brand or artist name for the kit? Tell me and I'll set it up. 🦈",
    };
  }
  const vibe = str(args["vibe"]);
  if (!vibe || vibe.length < 3) {
    return {
      ok: false,
      askText:
        "What vibe should the kit carry — regal and gold, raw street, clean and minimal? A few words is plenty. 🦈",
    };
  }
  const normalized: Record<string, unknown> = { brandName, vibe };
  const industry = str(args["industry"]);
  if (industry) normalized["industry"] = industry;
  return { ok: true, args: normalized };
};

const brandKitHandler: Handler = async (ctx) => {
  const brandName = str(ctx.args["brandName"]) ?? "";
  const body: Record<string, unknown> = {
    brandName,
    vibe: str(ctx.args["vibe"]) ?? "",
  };
  const industry = str(ctx.args["industry"]);
  if (industry) body["industry"] = industry;
  const result = await runGenerateBrandKit(await railDeps(ctx), body);
  if (result.status !== 200) {
    throw railFailure(result, "Brand kit generation failed.");
  }
  return {
    summary: `Made a brand kit for ${brandName}`,
    target: brandName,
    priceCharged: BRAND_KIT_COST,
    replyText: result.body?.saved
      ? `Done — your brand kit for ${brandName} is made and saved to your brand record, ready to carry across your pages. 🦈`
      : `Done — your brand kit for ${brandName} is made. It couldn't be saved to your profile just now, so grab it from the Brand Kit page to keep it. 🦈`,
  };
};

/* ── Headshot ───────────────────────────────────────────────────────── */

const HEADSHOT_PRESET_IDS = ["studio", "stage", "street", "luxury"] as const;

const headshotValidator: Validator = async ({ args }) => {
  const preset = str(args["preset"]);
  if (preset && !(HEADSHOT_PRESET_IDS as readonly string[]).includes(preset)) {
    return {
      ok: false,
      askText:
        "That look isn't one of the headshot presets — pick studio, stage, street, or luxury, or describe the look in your own words. 🦈",
    };
  }
  const promptText = str(args["promptText"]);
  const ref = str(args["referenceImageUrl"]);
  const normalized: Record<string, unknown> = {
    mode: promptText ? "manual" : preset ? "preset" : "autopilot",
  };
  if (preset) normalized["preset"] = preset;
  if (promptText) normalized["promptText"] = promptText;
  if (ref && /^https:\/\//i.test(ref)) normalized["referenceImageUrl"] = ref;
  return { ok: true, args: normalized };
};

const headshotHandler: Handler = async (ctx) => {
  const body: Record<string, unknown> = {
    mode: str(ctx.args["mode"]) ?? "autopilot",
  };
  const preset = str(ctx.args["preset"]);
  if (preset) body["preset"] = preset;
  const promptText = str(ctx.args["promptText"]);
  if (promptText) body["promptText"] = promptText;
  const ref = str(ctx.args["referenceImageUrl"]);
  if (ref) body["referenceImageUrl"] = ref;
  const result = await runGenerateHeadshot(await railDeps(ctx), body);
  if (result.status !== 200) {
    throw railFailure(result, "Headshot generation failed.");
  }
  return {
    summary: "Made a headshot",
    target: typeof result.body?.path === "string" ? result.body.path : null,
    priceCharged: HEADSHOT_CREDITS,
    replyText: `Your headshot is ready: ${result.body?.url ?? "check your library"}. 🦈`,
  };
};

/* ── Stream pack asset ──────────────────────────────────────────────── */

const streamPackValidator: Validator = async ({ args }) => {
  const assetKey = str(args["asset"]);
  if (!assetKey) {
    return {
      ok: false,
      askText:
        "Which stream graphic should I make — a starting-soon screen, be-right-back screen, ending screen, webcam frame, chat frame, an alert, or a panel? One per ask. 🦈",
    };
  }
  const asset = STREAM_PACK_ASSETS.find((a) => a.key === assetKey);
  if (!asset) {
    const labels = STREAM_PACK_ASSETS.map((a) => a.label).join(", ");
    return {
      ok: false,
      askText: `I don't have a stream graphic called "${assetKey}". The pack has: ${labels}. Which one? 🦈`,
    };
  }
  const channelName = str(args["channelName"]);
  if (!channelName) {
    return {
      ok: false,
      askText: "What channel name should the graphic carry? Tell me and I'll set it up. 🦈",
    };
  }
  const normalized: Record<string, unknown> = { asset: assetKey, channelName };
  const theme = str(args["theme"]);
  if (theme) normalized["theme"] = theme;
  return { ok: true, args: normalized };
};

const streamPackHandler: Handler = async (ctx) => {
  const body: Record<string, unknown> = {
    asset: str(ctx.args["asset"]) ?? "",
    channelName: str(ctx.args["channelName"]) ?? "",
  };
  const theme = str(ctx.args["theme"]);
  if (theme) body["theme"] = theme;
  const result = await runGenerateStreamPack(await railDeps(ctx), body);
  if (result.status !== 200) {
    throw railFailure(result, "Stream graphic generation failed.");
  }
  const label =
    typeof result.body?.label === "string" ? result.body.label : "stream graphic";
  return {
    summary: `Made a stream graphic (${label})`,
    target: typeof result.body?.asset === "string" ? result.body.asset : null,
    priceCharged: STREAM_PACK_CREDIT_COST,
    replyText: `Done — your ${label} graphic is made and saved in your stream pack library, ready to apply in the studio. 🦈`,
  };
};

/* ── UGC persona ────────────────────────────────────────────────────── */

const ugcPersonaValidator: Validator = async ({ args }) => {
  const description = str(args["description"]);
  if (!description || description.length < 10) {
    return {
      ok: false,
      askText:
        "Describe the persona — who are they, roughly how old, what's their vibe? A sentence or two in your words is plenty; I won't invent them for you. 🦈",
    };
  }
  return { ok: true, args: { description: description.slice(0, 400) } };
};

const ugcPersonaHandler: Handler = async (ctx) => {
  const body: Record<string, unknown> = {
    description: str(ctx.args["description"]) ?? "",
  };
  /* The rail accepts a client idempotency key: the confirmation's
     key rides in, so a re-run of this same confirmed action can
     never charge twice at the rail. */
  if (ctx.idempotencyKey) body["idempotencyKey"] = ctx.idempotencyKey;
  const result = await runGenerateUgcPersona(await railDeps(ctx), body);
  if (result.status !== 200) {
    throw railFailure(result, "Persona generation failed.");
  }
  return {
    summary: "Made a UGC persona",
    priceCharged: UGC_PERSONA_CREDIT_COST,
    idempotencyKey: ctx.idempotencyKey ?? null,
    replyText: `Your persona is ready: ${result.body?.personaUrl ?? "check Promote → UGC Product Ads"} — use them as the face of your product ads. 🦈`,
  };
};

/* ── UGC product ad video ───────────────────────────────────────────── */

type UgcAdRow = typeof ugcAdsTable.$inferSelect;

function ugcAdBlocker(ad: UgcAdRow): string | null {
  if (ad.status === "ready") {
    return `Your "${ad.productName}" ad is already generated — it's waiting in your UGC ads. 🦈`;
  }
  if (ad.status === "generating") {
    return `Your "${ad.productName}" ad is already generating — give it a moment and check your UGC ads. 🦈`;
  }
  if (!normalizeScript(ad.script)) {
    return `Your "${ad.productName}" ad needs a script first — give me a hook line, the spoken lines, and a call to action, or write it on the UGC Product Ads page. 🦈`;
  }
  return null;
}

const ugcVideoValidator: Validator = async ({ userId, args }) => {
  const adIdArg = str(args["adId"]);
  if (adIdArg) {
    const [ad] = await db
      .select()
      .from(ugcAdsTable)
      .where(and(eq(ugcAdsTable.id, adIdArg), eq(ugcAdsTable.userId, userId)))
      .limit(1);
    if (!ad) {
      return {
        ok: false,
        askText: "I couldn't find that ad on your account — check your UGC ads and ask me again. 🦈",
      };
    }
    const blocker = ugcAdBlocker(ad);
    if (blocker) return { ok: false, askText: blocker };
    return { ok: true, args: { adId: ad.id } };
  }

  /* A brand-new ad in the same ask: product + style + the member's
     own script must ALL be present — never an invented script. */
  const productName = str(args["productName"]);
  const style = str(args["style"]);
  const script = normalizeScript(args["script"]);
  if (args["productName"] !== undefined || args["style"] !== undefined || args["script"] !== undefined) {
    if (!productName) {
      return { ok: false, askText: "What's the product the ad is for? Name it and I'll set it up. 🦈" };
    }
    if (!style || !(UGC_STYLES as readonly string[]).includes(style)) {
      return {
        ok: false,
        askText: `Pick a style for the ad: ${UGC_STYLES.join(", ")}. Which one fits your product? 🦈`,
      };
    }
    if (!script) {
      return {
        ok: false,
        askText:
          "The ad needs your script — a hook line, the lines the persona speaks, and a call to action. Give me those in your words and I'll set it up; I won't write one and charge you for it sight unseen. 🦈",
      };
    }
    const normalized: Record<string, unknown> = { productName, style, script };
    const productBlurb = str(args["productBlurb"]);
    if (productBlurb) normalized["productBlurb"] = productBlurb;
    return { ok: true, args: normalized };
  }

  /* No details: find the member's one ad that's ready to generate. */
  const mine = await db
    .select()
    .from(ugcAdsTable)
    .where(eq(ugcAdsTable.userId, userId));
  const ready = mine.filter(
    (a) => (a.status === "draft" || a.status === "failed") && normalizeScript(a.script),
  );
  if (ready.length === 1) return { ok: true, args: { adId: ready[0]!.id } };
  if (ready.length > 1) {
    const names = ready.map((a) => `"${a.productName}"`).join(", ");
    return {
      ok: false,
      askText: `You have ${ready.length} ads ready to generate: ${names}. Which one should I run? Name it and ask me again. 🦈`,
    };
  }
  return {
    ok: false,
    askText:
      "You don't have a UGC ad ready to generate. Tell me the product, the style (unboxing, honest-review, problem-fix, or grwm), and your script — hook, spoken lines, call to action — or set the ad up on the UGC Product Ads page first and I'll generate it from there. 🦈",
  };
};

const ugcVideoHandler: Handler = async (ctx) => {
  const deps = await railDeps(ctx);
  let adId = str(ctx.args["adId"]);
  if (!adId) {
    /* Free first half: create the ad record through its own rail
       (brief/shop truth intact), then render it. Only the render
       charges. */
    const created = await runCreateUgcAd(deps, {
      productSource: "upload",
      productName: str(ctx.args["productName"]) ?? "",
      productBlurb: str(ctx.args["productBlurb"]),
      style: str(ctx.args["style"]) ?? "",
      script: ctx.args["script"] ?? null,
    });
    if (created.status !== 201) {
      throw railFailure(created, "Could not set that ad up.");
    }
    adId = created.body?.ad?.id;
    if (typeof adId !== "string" || !adId) {
      throw new Error("The ad was set up without an id — nothing was charged.");
    }
  }
  const genBody: Record<string, unknown> = {};
  if (ctx.idempotencyKey) genBody["idempotencyKey"] = ctx.idempotencyKey;
  const result = await runGenerateUgcAd(deps, adId, genBody);
  if (result.status !== 200) {
    throw railFailure(result, "The ad didn't generate.");
  }
  if (result.body?.alreadyGenerated) {
    return {
      summary: "UGC ad was already generated",
      target: adId,
      priceCharged: 0,
      replyText:
        "That ad was already generated — it's in your UGC ads, and nothing was charged again. 🦈",
    };
  }
  return {
    summary: "Generated a UGC product ad video",
    target: adId,
    priceCharged: UGC_VIDEO_CREDIT_COST,
    idempotencyKey: ctx.idempotencyKey ?? null,
    replyText:
      "Done — your product ad is rendered and saved in your UGC ads and your clip library. 🦈",
  };
};

/* ── The merged Lane E surface ──────────────────────────────────────── */

export const TIER3_HANDLERS: Record<string, Handler> = {
  "generate.song.short": songHandler(creditCostForLength(60_000)),
  "generate.song.standard": songHandler(creditCostForLength(180_000)),
  "generate.song.long": songHandler(creditCostForLength(300_000)),
  "generate.video": videoHandler,
  "bio.publish": bioHandler,
  "brandkit.generate": brandKitHandler,
  "headshot.generate": headshotHandler,
  "streampack.asset": streamPackHandler,
  "ugc.video": ugcVideoHandler,
  "ugc.persona": ugcPersonaHandler,
};

export const TIER3_VALIDATORS: Record<string, Validator> = {
  "generate.song.short": songValidator(creditCostForLength(60_000)),
  "generate.song.standard": songValidator(creditCostForLength(180_000)),
  "generate.song.long": songValidator(creditCostForLength(300_000)),
  "generate.video": videoValidator,
  "bio.publish": bioValidator,
  "brandkit.generate": brandKitValidator,
  "headshot.generate": headshotValidator,
  "streampack.asset": streamPackValidator,
  "ugc.video": ugcVideoValidator,
  "ugc.persona": ugcPersonaValidator,
};
