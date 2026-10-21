/**
 * move-home.ts — the "Move Home" concierge (competitor-study/
 * social-platforms.md candidate C2).
 *
 * Platforms give a creator an audience but no home. Bow Down already
 * has every piece of the home — Grand Stage profile, store, press kit,
 * email list, launch posts — but a migrating creator had to discover
 * and assemble each piece alone. Move Home packages them into one
 * guided, resumable checklist:
 *
 *   intake answers → ONE drafting pass → per-step approval → applied.
 *
 * The drafting pass reads ONLY what is real:
 *   - the creator's own intake answers (their words),
 *   - their existing on-platform content (profile tracks/videos),
 *   - their ALREADY-connected social accounts (social_accounts rows —
 *     platform + username only; tokens are never read here).
 * Nothing is ever "imported" from a platform that isn't connected,
 * and no follower counts, sales, or history are invented.
 *
 * EVERYTHING lands as drafts in move_home_progress. A draft is inert:
 * not public, not sellable, not sendable. The only door out is the
 * creator's explicit per-step approval (POST /move-home/steps/:step/
 * approve), which applies that one draft to its real rail at that
 * moment. The flow itself is FREE — no credits code is imported here,
 * and charged follow-ons (scheduling a drafted post, regenerating a
 * press-kit AI bio) ride their own rails with their own prices and
 * confirmations, outside this flow.
 */
import { and, asc, eq, ne } from "drizzle-orm";
import {
  db,
  moveHomeProgressTable,
  creatorProfilesTable,
  socialAccountsTable,
  profileTracksTable,
  profileVideosTable,
  pressKitsTable,
  emailListsTable,
  storeProductsTable,
  scheduledPostsTable,
  pressKitHandleSchema,
  type MoveHomeAnswers,
  type MoveHomeDrafts,
  type MoveHomeLaunchPostDraft,
  type MoveHomeProgress,
  type MoveHomeStepKey,
  type MoveHomeStepState,
} from "@workspace/db";
import { ensureKingsWelcome } from "./kings-welcome";
import { getOpenAI, getTextModel } from "./ai-clients";
import { logger } from "./logger";

export const MOVE_HOME_STEPS: Array<{
  key: MoveHomeStepKey;
  title: string;
  blurb: string;
}> = [
  {
    key: "profile",
    title: "Your Grand Stage profile",
    blurb:
      "Your home page — name, bio, lane, and the social links from the accounts you've actually connected.",
  },
  {
    key: "store",
    title: "Your starter store",
    blurb:
      "Your first products, drafted from your own catalog — live in your store the moment you approve them.",
  },
  {
    key: "press_kit",
    title: "Your press kit",
    blurb:
      "A shareable EPK — bio, top tracks, and your connected socials — drafted from your profile.",
  },
  {
    key: "email_list",
    title: "Your email list + welcome",
    blurb:
      "The audience you own. A fan list with a welcome email, ready before your first fan lands.",
  },
  {
    key: "launch_posts",
    title: "Your launch posts",
    blurb:
      "Announcement drafts for each connected social, saved to your Post Scheduler as drafts — you pick when they fire.",
  },
];

export const MOVE_HOME_STEP_KEYS = MOVE_HOME_STEPS.map((s) => s.key);

const VERTICALS = [
  "music",
  "video",
  "gaming",
  "podcast",
  "film",
  "tv",
  "influencer",
  "education",
  "other",
] as const;

export class MoveHomeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "MoveHomeError";
  }
}

/* ─── Context: only what is real ─────────────────────────────────────── */

export interface MoveHomeAccount {
  platform: "instagram" | "tiktok" | "facebook";
  accountId: string;
  username: string | null;
  pageId: string | null;
  pageName: string | null;
  label: string;
  profileUrl: string | null;
}

export interface MoveHomeContext {
  profile: {
    id: string;
    slug: string;
    displayName: string;
    bio: string;
    vertical: string;
    socialLinks: Record<string, string>;
    avatarUrl: string | null;
    bannerUrl: string | null;
  } | null;
  accounts: MoveHomeAccount[];
  tracks: Array<{
    id: string;
    title: string;
    audioUrl: string;
    artworkUrl: string | null;
    downloadPriceCents: number;
    isPublished: boolean;
  }>;
  videos: Array<{ id: string; title: string; videoUrl: string; thumbnailUrl: string | null }>;
}

function accountLabel(a: {
  platform: string;
  username: string | null;
  page_id: string | null;
  page_name: string | null;
}): { label: string; profileUrl: string | null } {
  if (a.platform === "instagram") {
    const u = (a.username ?? "").replace(/^@/, "");
    return {
      label: u ? `Instagram · @${u}` : "Instagram",
      profileUrl: u ? `https://instagram.com/${u}` : null,
    };
  }
  if (a.platform === "tiktok") {
    const u = (a.username ?? "").replace(/^@/, "");
    return {
      label: u ? `TikTok · @${u}` : "TikTok",
      profileUrl: u ? `https://www.tiktok.com/@${u}` : null,
    };
  }
  /* facebook */
  return {
    label: a.page_name ? `Facebook · ${a.page_name}` : "Facebook Page",
    profileUrl: a.page_id ? `https://www.facebook.com/${a.page_id}` : null,
  };
}

export async function loadMoveHomeContext(userId: string): Promise<MoveHomeContext> {
  const [profile] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);

  const accountRows = await db
    .select()
    .from(socialAccountsTable)
    .where(eq(socialAccountsTable.user_id, userId))
    .orderBy(asc(socialAccountsTable.created_at));

  const accounts: MoveHomeAccount[] = [];
  const seenPlatforms = new Set<string>();
  for (const row of accountRows) {
    const platform = row.platform as MoveHomeAccount["platform"];
    if (platform !== "instagram" && platform !== "tiktok" && platform !== "facebook") continue;
    if (seenPlatforms.has(platform)) continue;
    seenPlatforms.add(platform);
    const { label, profileUrl } = accountLabel(row);
    accounts.push({
      platform,
      accountId: row.id,
      username: row.username,
      pageId: row.page_id,
      pageName: row.page_name,
      label,
      profileUrl,
    });
  }

  let tracks: MoveHomeContext["tracks"] = [];
  let videos: MoveHomeContext["videos"] = [];
  if (profile) {
    const trackRows = await db
      .select()
      .from(profileTracksTable)
      .where(eq(profileTracksTable.profileId, profile.id))
      .orderBy(asc(profileTracksTable.createdAt));
    tracks = trackRows.map((t) => ({
      id: t.id,
      title: t.title,
      audioUrl: t.audioUrl,
      artworkUrl: t.artworkUrl,
      downloadPriceCents: t.downloadPriceCents,
      isPublished: t.isPublished,
    }));
    const videoRows = await db
      .select()
      .from(profileVideosTable)
      .where(eq(profileVideosTable.profileId, profile.id))
      .orderBy(asc(profileVideosTable.createdAt));
    videos = videoRows.map((v) => ({
      id: v.id,
      title: v.title,
      videoUrl: v.videoUrl,
      thumbnailUrl: v.thumbnailUrl,
    }));
  }

  return {
    profile: profile
      ? {
          id: profile.id,
          slug: profile.slug,
          displayName: profile.displayName,
          bio: profile.bio,
          vertical: profile.vertical,
          socialLinks: profile.socialLinks ?? {},
          avatarUrl: profile.avatarUrl,
          bannerUrl: profile.bannerUrl,
        }
      : null,
    accounts,
    tracks,
    videos,
  };
}

/* ─── Draft building (pure — pinned by unit tests) ───────────────────── */

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "creator";
}

const LANE_NOUN: Record<string, string> = {
  music: "artist",
  video: "video creator",
  gaming: "streamer",
  podcast: "podcaster",
  film: "filmmaker",
  tv: "show creator",
  influencer: "creator",
  education: "educator",
  other: "creator",
};

function clean(s: string | undefined | null): string {
  return (s ?? "").trim();
}

export function buildDrafts(
  answers: MoveHomeAnswers,
  ctx: MoveHomeContext,
): { drafts: MoveHomeDrafts; blocked: Partial<Record<MoveHomeStepKey, MoveHomeStepState["blockedReason"]>> } {
  const blocked: Partial<Record<MoveHomeStepKey, MoveHomeStepState["blockedReason"]>> = {};

  const displayName =
    clean(answers.displayName) ||
    ctx.profile?.displayName ||
    ctx.accounts[0]?.username?.replace(/^@/, "") ||
    "New Creator";
  const vertical = (VERTICALS as readonly string[]).includes(clean(answers.vertical))
    ? clean(answers.vertical)
    : (ctx.profile?.vertical ?? "music");
  const genre = clean(answers.genre);
  const laneNoun = LANE_NOUN[vertical] ?? "creator";
  const slug = ctx.profile?.slug ?? slugify(clean(answers.handle) || displayName);
  const homePath = `/artist/${slug}`;

  /* Social links: existing profile links, then the creator's own typed
     links, then URLs derived from CONNECTED accounts only. A platform
     that isn't connected contributes nothing — never an "import". */
  const socialLinks: Record<string, string> = { ...(ctx.profile?.socialLinks ?? {}) };
  for (const [k, v] of Object.entries(answers.socialLinks ?? {})) {
    if (clean(v)) socialLinks[k] = clean(v);
  }
  for (const a of ctx.accounts) {
    if (a.profileUrl) socialLinks[a.platform] = a.profileUrl;
  }

  const connectedNames = ctx.accounts.map((a) =>
    a.platform === "instagram" ? "Instagram" : a.platform === "tiktok" ? "TikTok" : "Facebook",
  );
  const bioSeed = clean(answers.bioSeed);
  const bio =
    bioSeed ||
    [
      `${displayName} is a ${genre ? `${genre} ` : ""}${laneNoun} building a home for everything they make${clean(answers.location) ? ` — based in ${clean(answers.location)}` : ""}.`,
      connectedNames.length
        ? `You may know the work from ${connectedNames.join(", ")} — now it all lives in one place.`
        : "Everything lives here now — music, videos, store, and memberships, straight from the source.",
    ].join(" ");

  const profile: MoveHomeDrafts["profile"] = {
    slug,
    displayName,
    vertical,
    bio,
    socialLinks,
    updatesExisting: !!ctx.profile,
  };

  /* Store: real priced content first; a clearly-marked starter product
     (suggested price, edit-before-approve copy) when the catalog has
     nothing priced yet. */
  const pricedTracks = ctx.tracks
    .filter((t) => t.downloadPriceCents > 0)
    .sort((a, b) => Number(b.isPublished) - Number(a.isPublished))
    .slice(0, 3);
  const products: NonNullable<MoveHomeDrafts["store"]>["products"] = pricedTracks.map((t) => ({
    kind: "download" as const,
    title: t.title,
    description: `Official download of "${t.title}" by ${displayName} — yours from the source.`,
    priceCents: t.downloadPriceCents,
    sourceTrackId: t.id,
    suggestedPrice: false,
  }));
  if (products.length === 0) {
    products.push({
      kind: "digital",
      title: clean(answers.starterProductTitle) || `${displayName} — Supporter Pack`,
      description:
        "Starter product — edit this description to say exactly what buyers get before you approve it. Nothing goes on sale until you say so.",
      priceCents: 500,
      suggestedPrice: true,
    });
  }
  const store: MoveHomeDrafts["store"] = { products };
  if (!ctx.profile) blocked.store = "needs_profile";

  const pressKit: MoveHomeDrafts["press_kit"] = {
    handle: slug,
    artistName: displayName,
    tagline:
      clean(answers.tagline) ||
      (genre ? `${genre} ${laneNoun} — official press kit` : `${displayName} — official press kit`),
    bio,
    genre,
    location: clean(answers.location),
    instagramUrl: socialLinks["instagram"] ?? "",
    tiktokUrl: socialLinks["tiktok"] ?? "",
    youtubeUrl: socialLinks["youtube"] ?? "",
    topTracks: ctx.tracks.slice(0, 3).map((t) => ({ title: t.title, url: t.audioUrl })),
  };

  const emailList: MoveHomeDrafts["email_list"] = {
    name: `${displayName} — Inner Circle`,
    handle: slug,
    description: `First to hear new drops, shows, and exclusives from ${displayName}. No noise — just the good stuff.`,
    welcomeSubject: `You're in — welcome to ${displayName}'s inner circle`,
    welcomeBody: [
      `Welcome home.`,
      ``,
      `You just joined the list that hears everything first — new ${genre ? `${genre} ` : ""}drops, videos, shows, and store exclusives from ${displayName}, before anywhere else.`,
      ``,
      `Start here: bowdownvisuals.com${homePath}`,
      ``,
      `— ${displayName}`,
    ].join("\n"),
    updatesExisting: false /* resolved against the DB at draft time in runDrafting */,
  };

  /* Launch posts: one per CONNECTED account, media from the creator's
     own existing content. No account → no draft, honest blocker. */
  const media: { url: string; type: "video" | "image" } | null = ctx.videos[0]
    ? { url: ctx.videos[0].videoUrl, type: "video" }
    : ctx.tracks.find((t) => t.artworkUrl)
      ? { url: ctx.tracks.find((t) => t.artworkUrl)!.artworkUrl!, type: "image" }
      : ctx.profile?.bannerUrl
        ? { url: ctx.profile.bannerUrl, type: "image" }
        : ctx.profile?.avatarUrl
          ? { url: ctx.profile.avatarUrl, type: "image" }
          : null;

  const announcement =
    `I moved home. 🏠 Everything I make — ${vertical === "music" ? "music, videos" : "videos, work"}, store, memberships — now lives in one place I own: bowdownvisuals.com${homePath}. No algorithm between us. Come see the new home.`;
  const genreTag = genre ? ` #${genre.replace(/[^a-zA-Z0-9]+/g, "")}` : "";
  const posts: MoveHomeLaunchPostDraft[] = ctx.accounts.map((a) => ({
    platform: a.platform,
    accountId: a.accountId,
    accountLabel: a.label,
    caption:
      a.platform === "tiktok"
        ? `I moved home 🏠 Everything I make now lives in one place I own — link in bio. bowdownvisuals.com${homePath}`
        : announcement,
    hashtags: `#MovedHome #IndependentCreator${genreTag}`,
    mediaUrl: media?.url ?? null,
    mediaType: media?.type ?? "image",
  }));
  const launchPosts: MoveHomeDrafts["launch_posts"] = { posts };
  if (ctx.accounts.length === 0) blocked.launch_posts = "no_connected_accounts";
  else if (!media) blocked.launch_posts = "needs_media";

  return {
    drafts: { profile, store, press_kit: pressKit, email_list: emailList, launch_posts: launchPosts },
    blocked,
  };
}

/* ─── Optional AI polish ───────────────────────────────────────────────
   One AI pass may polish TEXT fields only (bio, tagline, welcome copy,
   captions). Structure — products, prices, handles, platforms,
   accounts, media — is never taken from model output, and the prompt
   forbids inventing followers, sales, awards, or imports. Any failure
   leaves the assembled drafts standing and copySource stays
   "assembled" — the flow never blocks on the AI rail. */

export type CopyPolish = (drafts: MoveHomeDrafts, ctx: MoveHomeContext) => Promise<MoveHomeDrafts | null>;

export const aiCopyPolish: CopyPolish = async (drafts, ctx) => {
  try {
    const client = getOpenAI();
    const connected = ctx.accounts.map((a) => a.platform).join(", ") || "none";
    const payload = {
      profileBio: drafts.profile?.bio ?? "",
      pressTagline: drafts.press_kit?.tagline ?? "",
      pressBio: drafts.press_kit?.bio ?? "",
      welcomeSubject: drafts.email_list?.welcomeSubject ?? "",
      welcomeBody: drafts.email_list?.welcomeBody ?? "",
      captions: (drafts.launch_posts?.posts ?? []).map((p) => ({ platform: p.platform, caption: p.caption })),
    };
    const completion = await client.chat.completions.create({
      model: getTextModel(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Thy Cheat Code, the host of Bow Down Visuals, polishing a creator's Move Home onboarding drafts. Rewrite the provided copy to sound confident, warm, and premium in the creator's voice. STRICT RULES: use only facts present in the input; the creator's connected platforms are listed — never mention any other platform, never claim content or followers were imported, never invent followers, sales, awards, or press. Keep every URL exactly as written. Return JSON with the same keys: profileBio, pressTagline, pressBio, welcomeSubject, welcomeBody, captions (array of {platform, caption} in the same order).",
        },
        {
          role: "user",
          content: JSON.stringify({ connectedPlatforms: connected, ...payload }),
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown, max: number) =>
      typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null;

    const out: MoveHomeDrafts = JSON.parse(JSON.stringify(drafts)) as MoveHomeDrafts;
    const bio = str(parsed.profileBio, 600);
    if (bio && out.profile) out.profile.bio = bio;
    const tagline = str(parsed.pressTagline, 160);
    if (tagline && out.press_kit) out.press_kit.tagline = tagline;
    const pressBio = str(parsed.pressBio, 1200);
    if (pressBio && out.press_kit) out.press_kit.bio = pressBio;
    const subject = str(parsed.welcomeSubject, 200);
    if (subject && out.email_list) out.email_list.welcomeSubject = subject;
    const body = str(parsed.welcomeBody, 3000);
    if (body && out.email_list) out.email_list.welcomeBody = body;
    if (Array.isArray(parsed.captions) && out.launch_posts) {
      parsed.captions.forEach((c, i) => {
        const caption = str((c as { caption?: unknown })?.caption, 2000);
        if (caption && out.launch_posts!.posts[i]) out.launch_posts!.posts[i].caption = caption;
      });
    }
    return out;
  } catch (err) {
    logger.warn({ err }, "[move-home] AI polish unavailable — assembled drafts stand");
    return null;
  }
};

/* ─── Progress state ─────────────────────────────────────────────────── */

const nowIso = () => new Date().toISOString();

export async function getOrCreateProgress(userId: string): Promise<MoveHomeProgress> {
  const [existing] = await db
    .select()
    .from(moveHomeProgressTable)
    .where(eq(moveHomeProgressTable.userId, userId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(moveHomeProgressTable)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(moveHomeProgressTable)
    .where(eq(moveHomeProgressTable.userId, userId))
    .limit(1);
  return row;
}

async function saveProgress(
  userId: string,
  patch: Partial<Pick<MoveHomeProgress, "answers" | "drafts" | "steps" | "completedAt">>,
): Promise<MoveHomeProgress> {
  const [row] = await db
    .update(moveHomeProgressTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(moveHomeProgressTable.userId, userId))
    .returning();
  return row;
}

function stepState(
  progress: MoveHomeProgress,
  key: MoveHomeStepKey,
): MoveHomeStepState {
  return progress.steps?.[key] ?? { status: "pending" };
}

function withStep(
  progress: MoveHomeProgress,
  key: MoveHomeStepKey,
  state: MoveHomeStepState,
): Partial<Record<MoveHomeStepKey, MoveHomeStepState>> {
  return { ...(progress.steps ?? {}), [key]: state };
}

function completionPatch(
  steps: Partial<Record<MoveHomeStepKey, MoveHomeStepState>>,
): { completedAt: Date | null } {
  const done = MOVE_HOME_STEP_KEYS.every((k) => {
    const s = steps[k]?.status;
    return s === "approved" || s === "skipped";
  });
  return { completedAt: done ? new Date() : null };
}

export interface MoveHomeStatus {
  answers: MoveHomeAnswers;
  drafts: MoveHomeDrafts;
  steps: Array<{
    key: MoveHomeStepKey;
    title: string;
    blurb: string;
    status: MoveHomeStepState["status"];
    blockedReason?: MoveHomeStepState["blockedReason"];
    appliedRef?: string;
  }>;
  completedAt: string | null;
  context: {
    hasProfile: boolean;
    profileSlug: string | null;
    connectedPlatforms: Array<{ platform: string; label: string }>;
    trackCount: number;
    videoCount: number;
  };
}

export async function getMoveHomeStatus(userId: string): Promise<MoveHomeStatus> {
  const [progress, ctx] = await Promise.all([
    getOrCreateProgress(userId),
    loadMoveHomeContext(userId),
  ]);
  return {
    answers: progress.answers ?? {},
    drafts: progress.drafts ?? {},
    steps: MOVE_HOME_STEPS.map((def) => {
      const state = stepState(progress, def.key);
      return {
        key: def.key,
        title: def.title,
        blurb: def.blurb,
        status: state.status,
        blockedReason: state.blockedReason,
        appliedRef: state.appliedRef,
      };
    }),
    completedAt: progress.completedAt ? progress.completedAt.toISOString() : null,
    context: {
      hasProfile: !!ctx.profile,
      profileSlug: ctx.profile?.slug ?? null,
      connectedPlatforms: ctx.accounts.map((a) => ({ platform: a.platform, label: a.label })),
      trackCount: ctx.tracks.length,
      videoCount: ctx.videos.length,
    },
  };
}

export async function saveAnswers(
  userId: string,
  answers: MoveHomeAnswers,
): Promise<MoveHomeProgress> {
  const progress = await getOrCreateProgress(userId);
  return saveProgress(userId, {
    answers: { ...(progress.answers ?? {}), ...answers },
  });
}

/** The one drafting pass. Refreshes drafts for every step that is not
    already approved; a skipped step keeps its decision but its draft
    still refreshes so a later reopen shows current copy. */
export async function runDrafting(
  userId: string,
  polish: CopyPolish | null = aiCopyPolish,
): Promise<MoveHomeStatus> {
  const progress = await getOrCreateProgress(userId);
  const ctx = await loadMoveHomeContext(userId);
  const { drafts, blocked } = buildDrafts(progress.answers ?? {}, ctx);

  /* Email step: does a list already exist for this creator? */
  const [existingList] = await db
    .select()
    .from(emailListsTable)
    .where(eq(emailListsTable.userId, userId))
    .orderBy(asc(emailListsTable.createdAt))
    .limit(1);
  if (drafts.email_list) {
    drafts.email_list.updatesExisting = !!existingList;
    if (existingList) {
      drafts.email_list.name = existingList.name;
      drafts.email_list.handle = existingList.handle;
    }
  }

  let finalDrafts = drafts;
  if (polish) {
    const polished = await polish(drafts, ctx);
    if (polished) {
      finalDrafts = polished;
      finalDrafts.copySource = "ai";
    } else {
      finalDrafts.copySource = "assembled";
    }
  }

  const steps = { ...(progress.steps ?? {}) };
  for (const key of MOVE_HOME_STEP_KEYS) {
    const current = steps[key];
    if (current?.status === "approved") continue;
    steps[key] = {
      status: current?.status === "skipped" ? "skipped" : "drafted",
      draftedAt: nowIso(),
      decidedAt: current?.decidedAt,
      blockedReason: blocked[key],
    };
  }

  await saveProgress(userId, {
    drafts: finalDrafts,
    steps,
    ...completionPatch(steps),
  });
  return getMoveHomeStatus(userId);
}

/** Creator edits to a single draft (validated in the route). Approved
    steps are sealed — their drafts no longer drive anything. */
export async function updateDraft(
  userId: string,
  key: MoveHomeStepKey,
  patch: Record<string, unknown>,
): Promise<MoveHomeStatus> {
  const progress = await getOrCreateProgress(userId);
  const state = stepState(progress, key);
  if (state.status === "approved") {
    throw new MoveHomeError(409, "STEP_SEALED", "That step is already approved and live — edit it in its own home from here.");
  }
  const drafts = { ...(progress.drafts ?? {}) } as Record<string, unknown>;
  const current = (drafts[key] ?? {}) as Record<string, unknown>;
  drafts[key] = { ...current, ...patch };
  await saveProgress(userId, { drafts: drafts as MoveHomeDrafts });
  return getMoveHomeStatus(userId);
}

export async function skipStep(userId: string, key: MoveHomeStepKey): Promise<MoveHomeStatus> {
  const progress = await getOrCreateProgress(userId);
  const state = stepState(progress, key);
  if (state.status === "approved") {
    throw new MoveHomeError(409, "STEP_SEALED", "That step is already approved and live — it can't be skipped now.");
  }
  const steps = withStep(progress, key, {
    ...state,
    status: "skipped",
    decidedAt: nowIso(),
    blockedReason: undefined,
  });
  await saveProgress(userId, { steps, ...completionPatch(steps) });
  return getMoveHomeStatus(userId);
}

export async function reopenStep(userId: string, key: MoveHomeStepKey): Promise<MoveHomeStatus> {
  const progress = await getOrCreateProgress(userId);
  const state = stepState(progress, key);
  if (state.status !== "skipped") return getMoveHomeStatus(userId);
  const steps = withStep(progress, key, {
    ...state,
    status: progress.drafts?.[key] ? "drafted" : "pending",
    decidedAt: undefined,
  });
  await saveProgress(userId, { steps, ...completionPatch(steps) });
  return getMoveHomeStatus(userId);
}

/* ─── Apply rails — the only way a draft goes live ───────────────────── */

async function applyProfile(userId: string, progress: MoveHomeProgress): Promise<string> {
  const draft = progress.drafts?.profile;
  if (!draft) throw new MoveHomeError(409, "NOT_DRAFTED", "Draft your home first — then approve this step.");
  const [existing] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);

  if (existing) {
    /* An existing profile keeps its slug — renaming a live home is the
       profile editor's job, not the concierge's. */
    await db
      .update(creatorProfilesTable)
      .set({
        displayName: draft.displayName,
        bio: draft.bio,
        vertical: draft.vertical,
        socialLinks: draft.socialLinks,
        updatedAt: new Date(),
      })
      .where(eq(creatorProfilesTable.id, existing.id));
    return existing.id;
  }

  const [slugTaken] = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.slug, draft.slug))
    .limit(1);
  if (slugTaken) {
    throw new MoveHomeError(
      409,
      "HANDLE_TAKEN",
      "That handle's already claimed — edit your draft's handle and approve again.",
    );
  }
  const [created] = await db
    .insert(creatorProfilesTable)
    .values({
      userId,
      slug: draft.slug,
      displayName: draft.displayName,
      bio: draft.bio,
      vertical: draft.vertical,
      socialLinks: draft.socialLinks,
      isPublic: true,
    })
    .returning();
  /* Same welcome the normal profile-creation door fires: Thy Cheat
     Code follows back. Idempotent, never throws. */
  await ensureKingsWelcome(userId);
  return created.id;
}

async function applyStore(userId: string, progress: MoveHomeProgress): Promise<string> {
  const draft = progress.drafts?.store;
  if (!draft) throw new MoveHomeError(409, "NOT_DRAFTED", "Draft your home first — then approve this step.");
  const [profile] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  if (!profile) {
    throw new MoveHomeError(
      409,
      "NEEDS_PROFILE",
      "Your store hangs on your profile — approve the profile step first, then this one.",
    );
  }
  const existing = await db
    .select({ title: storeProductsTable.title })
    .from(storeProductsTable)
    .where(eq(storeProductsTable.profileId, profile.id));
  const existingTitles = new Set(existing.map((p) => p.title.toLowerCase()));
  let firstId: string | null = null;
  for (const product of draft.products) {
    if (existingTitles.has(product.title.toLowerCase())) continue;
    const [row] = await db
      .insert(storeProductsTable)
      .values({
        profileId: profile.id,
        kind: product.kind,
        title: product.title,
        description: product.description,
        priceCents: product.priceCents,
        inventory: -1,
        mediaUrls: [],
        relatedLinks: [],
        isActive: true,
      })
      .returning();
    firstId = firstId ?? row.id;
    existingTitles.add(product.title.toLowerCase());
  }
  if (!firstId) {
    throw new MoveHomeError(
      409,
      "ALREADY_IN_STORE",
      "Everything in this draft is already in your store — edit the draft or skip this step.",
    );
  }
  return firstId;
}

async function applyPressKit(userId: string, progress: MoveHomeProgress): Promise<string> {
  const draft = progress.drafts?.press_kit;
  if (!draft) throw new MoveHomeError(409, "NOT_DRAFTED", "Draft your home first — then approve this step.");
  const parsed = pressKitHandleSchema.safeParse(draft.handle);
  if (!parsed.success) {
    throw new MoveHomeError(400, "BAD_HANDLE", "That press-kit handle doesn't work — edit the draft and try again.");
  }
  const values = {
    handle: draft.handle,
    artist_name: draft.artistName,
    tagline: draft.tagline || null,
    bio: draft.bio || null,
    genre: draft.genre || null,
    location: draft.location || null,
    instagram_url: draft.instagramUrl || null,
    tiktok_url: draft.tiktokUrl || null,
    youtube_url: draft.youtubeUrl || null,
    top_tracks: draft.topTracks,
    is_public: true,
    updated_at: new Date(),
  };
  const [existing] = await db
    .select()
    .from(pressKitsTable)
    .where(eq(pressKitsTable.user_id, userId))
    .limit(1);
  if (existing) {
    await db.update(pressKitsTable).set(values).where(eq(pressKitsTable.id, existing.id));
    return existing.id;
  }
  const [taken] = await db
    .select({ id: pressKitsTable.id })
    .from(pressKitsTable)
    .where(and(eq(pressKitsTable.handle, draft.handle), ne(pressKitsTable.user_id, userId)))
    .limit(1);
  if (taken) {
    throw new MoveHomeError(
      409,
      "HANDLE_TAKEN",
      "That press-kit handle is taken — edit your draft's handle and approve again.",
    );
  }
  const [created] = await db
    .insert(pressKitsTable)
    .values({ user_id: userId, ...values })
    .returning();
  return created.id;
}

async function applyEmailList(userId: string, progress: MoveHomeProgress): Promise<string> {
  const draft = progress.drafts?.email_list;
  if (!draft) throw new MoveHomeError(409, "NOT_DRAFTED", "Draft your home first — then approve this step.");
  const [existing] = await db
    .select()
    .from(emailListsTable)
    .where(eq(emailListsTable.userId, userId))
    .orderBy(asc(emailListsTable.createdAt))
    .limit(1);
  if (existing) {
    await db
      .update(emailListsTable)
      .set({
        description: draft.description,
        welcomeSubject: draft.welcomeSubject,
        welcomeBody: draft.welcomeBody,
      })
      .where(eq(emailListsTable.id, existing.id));
    return existing.id;
  }
  const [taken] = await db
    .select({ id: emailListsTable.id })
    .from(emailListsTable)
    .where(eq(emailListsTable.handle, draft.handle))
    .limit(1);
  if (taken) {
    throw new MoveHomeError(
      409,
      "HANDLE_TAKEN",
      "That list handle is taken — edit your draft's handle and approve again.",
    );
  }
  const [created] = await db
    .insert(emailListsTable)
    .values({
      userId,
      name: draft.name,
      handle: draft.handle,
      description: draft.description,
      welcomeSubject: draft.welcomeSubject,
      welcomeBody: draft.welcomeBody,
    })
    .returning();
  return created.id;
}

async function applyLaunchPosts(userId: string, progress: MoveHomeProgress): Promise<string> {
  const draft = progress.drafts?.launch_posts;
  if (!draft) throw new MoveHomeError(409, "NOT_DRAFTED", "Draft your home first — then approve this step.");
  if (draft.posts.length === 0) {
    throw new MoveHomeError(
      409,
      "NO_CONNECTED_ACCOUNTS",
      "No connected social accounts yet — connect Instagram, TikTok, or Facebook first, then re-draft.",
    );
  }
  const createdIds: string[] = [];
  for (const post of draft.posts) {
    /* Re-verify the account is still connected and still the caller's —
       a draft never outlives the connection it was drafted from. */
    const [account] = await db
      .select()
      .from(socialAccountsTable)
      .where(and(eq(socialAccountsTable.id, post.accountId), eq(socialAccountsTable.user_id, userId)))
      .limit(1);
    if (!account) continue;
    if (!post.mediaUrl) {
      throw new MoveHomeError(
        409,
        "NEEDS_MEDIA",
        "Your launch posts need one of your own images or videos — add media to the draft and approve again. Nothing posts without it.",
      );
    }
    const [row] = await db
      .insert(scheduledPostsTable)
      .values({
        user_id: userId,
        status: "draft",
        media_url: post.mediaUrl,
        media_type: post.mediaType,
        caption: post.caption,
        hashtags: post.hashtags,
        platforms: [post.platform],
        account_ids: { [post.platform]: post.accountId },
        credits_charged: 0,
      })
      .returning();
    createdIds.push(row.id);
  }
  if (createdIds.length === 0) {
    throw new MoveHomeError(
      409,
      "NO_CONNECTED_ACCOUNTS",
      "Those accounts aren't connected anymore — reconnect and re-draft.",
    );
  }
  return createdIds[0];
}

const APPLIERS: Record<MoveHomeStepKey, (userId: string, p: MoveHomeProgress) => Promise<string>> = {
  profile: applyProfile,
  store: applyStore,
  press_kit: applyPressKit,
  email_list: applyEmailList,
  launch_posts: applyLaunchPosts,
};

/** The approval door. One step, one explicit call, applied to its real
    rail. Approving an already-approved step is a no-op read — a step
    can never be applied twice. */
export async function approveStep(userId: string, key: MoveHomeStepKey): Promise<MoveHomeStatus> {
  const progress = await getOrCreateProgress(userId);
  const state = stepState(progress, key);
  if (state.status === "approved") return getMoveHomeStatus(userId);
  if (state.status !== "drafted") {
    throw new MoveHomeError(409, "NOT_DRAFTED", "Draft your home first — approval only works on a drafted step.");
  }
  const appliedRef = await APPLIERS[key](userId, progress);
  const fresh = await getOrCreateProgress(userId);
  const steps = withStep(fresh, key, {
    status: "approved",
    draftedAt: state.draftedAt,
    decidedAt: nowIso(),
    appliedRef,
  });
  await saveProgress(userId, { steps, ...completionPatch(steps) });
  return getMoveHomeStatus(userId);
}
