import { Router, type Request, type Response } from "express";
import { randomUUID, randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { publicApiLimiter } from "../lib/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { encryptToken, decryptToken, isSocialTokenKeyConfigured } from "../lib/social-crypto";
import {
  parseSpotifyItem, spotifyLibrarySaveUrl, spotifyConfigured, spotifyRedirectUri,
  buildSpotifyAuthUrl, buildLrc, validTimedLines, computeSplitStatements,
  PERMANENCE_COVERS, PERMANENCE_EXCLUDES, rosterCanViewReleases, gateUnlocked,
  type TimedLyricLine,
} from "../lib/distribution-legacy";

/* Stack 11 (in-house half) — Distribution & Legacy.
   Docking law: everything here serves the standalone release flow
   (/distribute), Business/Get Paid, Promote, or Settings. Nothing here is
   mounted inside any editor. No money moves; sandbox delivery labels in
   distribution.ts are untouched. */

const router = Router();
const APP_PUBLIC_URL = (process.env["APP_PUBLIC_URL"] ?? "https://bowdownvisuals.com").replace(/\/$/, "");

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}
function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : null;
}

interface OwnedRelease { id: string; user_id: string; title: string; artist_name: string; status: string; presave_slug: string | null; presave_platform_links: Record<string, string> | null }
async function getOwnedRelease(id: string, userId: string): Promise<OwnedRelease | null> {
  const r = await db.execute(sql`SELECT id, user_id, title, artist_name, status, presave_slug, presave_platform_links FROM distribution_releases WHERE id = ${id} AND user_id = ${userId} LIMIT 1`);
  return (r.rows[0] as unknown as OwnedRelease) ?? null;
}
async function getReleaseBySlug(slug: string): Promise<OwnedRelease | null> {
  const r = await db.execute(sql`SELECT id, user_id, title, artist_name, status, presave_slug, presave_platform_links FROM distribution_releases WHERE presave_slug = ${slug} LIMIT 1`);
  return (r.rows[0] as unknown as OwnedRelease) ?? null;
}

/* ═══ #1 Release landing content (the smartlink that persists) ═══════════ */
const SOCIAL_KEYS = new Set(["instagram", "tiktok", "youtube", "x", "website"]);
const landingBody = z.object({
  videoUrl: z.string().max(2000).optional(),
  storeUrl: z.string().max(2000).optional(),
  socialLinks: z.record(z.string(), z.string().max(2000)).optional(),
});

interface LandingRow { video_url: string | null; store_url: string | null; social_links: Record<string, string> | null }
const landingDto = (r: LandingRow | null) => ({
  videoUrl: r?.video_url ?? null,
  storeUrl: r?.store_url ?? null,
  socialLinks: r?.social_links ?? {},
});
async function loadLanding(releaseId: string): Promise<LandingRow | null> {
  const r = await db.execute(sql`SELECT video_url, store_url, social_links FROM release_landing_content WHERE release_id = ${releaseId} LIMIT 1`);
  return (r.rows[0] as unknown as LandingRow) ?? null;
}

router.put("/distribution/releases/:id/landing-content", requireAuth, async (req, res) => {
  try {
    const release = await getOwnedRelease(param(req, "id"), req.userId!);
    if (!release) { res.status(404).json({ error: "Release not found." }); return; }
    const parsed = landingBody.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: "Invalid landing content." }); return; }
    const socialLinks: Record<string, string> = {};
    if (parsed.data.socialLinks) {
      for (const [k, v] of Object.entries(parsed.data.socialLinks)) {
        const clean = cleanUrl(v);
        if (clean && SOCIAL_KEYS.has(k)) socialLinks[k] = clean;
      }
    }
    const videoUrl = parsed.data.videoUrl === undefined ? undefined : cleanUrl(parsed.data.videoUrl);
    const storeUrl = parsed.data.storeUrl === undefined ? undefined : cleanUrl(parsed.data.storeUrl);
    const existing = await loadLanding(release.id);
    const next = {
      videoUrl: videoUrl === undefined ? existing?.video_url ?? null : videoUrl,
      storeUrl: storeUrl === undefined ? existing?.store_url ?? null : storeUrl,
      socialLinks: parsed.data.socialLinks === undefined ? existing?.social_links ?? {} : socialLinks,
    };
    if (existing) {
      await db.execute(sql`UPDATE release_landing_content SET video_url = ${next.videoUrl}, store_url = ${next.storeUrl}, social_links = ${JSON.stringify(next.socialLinks)}::jsonb, updated_at = now() WHERE release_id = ${release.id}`);
    } else {
      await db.execute(sql`INSERT INTO release_landing_content (id, release_id, user_id, video_url, store_url, social_links) VALUES (${randomUUID()}, ${release.id}, ${req.userId!}, ${next.videoUrl}, ${next.storeUrl}, ${JSON.stringify(next.socialLinks)}::jsonb)`);
    }
    res.json({ landing: next, persistsAfterRelease: true });
  } catch (err) { logger.error({ err }, "[stack11] landing save failed"); res.status(500).json({ error: "Couldn't save the landing content." }); }
});

router.get("/distribution/releases/:id/landing-content", requireAuth, async (req, res) => {
  try {
    const release = await getOwnedRelease(param(req, "id"), req.userId!);
    if (!release) { res.status(404).json({ error: "Release not found." }); return; }
    res.json({ landing: landingDto(await loadLanding(release.id)), persistsAfterRelease: true });
  } catch (err) { logger.error({ err }, "[stack11] landing load failed"); res.status(500).json({ error: "Couldn't load the landing content." }); }
});

/* ═══ #2 Spotify-account pre-save ════════════════════════════════════════
   OAuth rides the house social plumbing: tokens land in social_accounts
   (platform 'spotify'), AES-256-GCM encrypted via social-crypto, and the
   state map follows the social.ts in-memory pattern. The save itself is
   the platform's library API — a presave_account_actions row is written
   ONLY after that API answers success. Where no parseable track/album
   link exists, or the fan hasn't connected, the API says so and the
   landing keeps its follow/email capture as the headline action. */
interface PendingSpotify { userId: string; expiresAt: number; returnSlug: string | null }
const pendingSpotify = new Map<string, PendingSpotify>();
function mintState(userId: string, returnSlug: string | null): string {
  const state = randomBytes(24).toString("hex");
  pendingSpotify.set(state, { userId, expiresAt: Date.now() + 10 * 60 * 1000, returnSlug });
  return state;
}
function consumeState(state: string): PendingSpotify | null {
  const e = pendingSpotify.get(state);
  pendingSpotify.delete(state);
  if (!e || e.expiresAt < Date.now()) return null;
  return e;
}

router.get("/distribution/spotify/auth-url", requireAuth, (req, res) => {
  if (!spotifyConfigured() || !isSocialTokenKeyConfigured()) {
    res.status(503).json({ error: "not_configured", message: "Account pre-save isn't configured yet — fans can still pre-save by email on the landing page." });
    return;
  }
  const rawReturn = typeof req.query["returnTo"] === "string" ? req.query["returnTo"] : "";
  const returnSlug = /^[a-z0-9-]{1,60}$/i.test(rawReturn) ? rawReturn : null;
  res.json({ authUrl: buildSpotifyAuthUrl(process.env["SPOTIFY_CLIENT_ID"]!, mintState(req.userId!, returnSlug)) });
});

router.get("/distribution/spotify/callback", async (req, res) => {
  const fail = (reason: string) => res.redirect(`${APP_PUBLIC_URL}/presave?spotify=error&reason=${encodeURIComponent(reason)}`);
  const { code, state } = req.query as { code?: string; state?: string };
  if (typeof code !== "string" || typeof state !== "string") { fail("missing_params"); return; }
  const pending = consumeState(state);
  if (!pending) { fail("bad_state"); return; }
  const userId = pending.userId;
  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${process.env["SPOTIFY_CLIENT_ID"]}:${process.env["SPOTIFY_CLIENT_SECRET"]}`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: spotifyRedirectUri() }).toString(),
    });
    if (!tokenRes.ok) { fail("token_exchange_failed"); return; }
    const tok = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    const meRes = await fetch("https://api.spotify.com/v1/me", { headers: { authorization: `Bearer ${tok.access_token}` } });
    const me = meRes.ok ? ((await meRes.json()) as { id?: string; display_name?: string }) : {};
    const encrypted = encryptToken(tok.access_token);
    const refreshEncrypted = tok.refresh_token ? encryptToken(tok.refresh_token) : null;
    const expiresAt = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null;
    await db.execute(sql`DELETE FROM social_accounts WHERE user_id = ${userId} AND platform = 'spotify'`);
    await db.execute(sql`
      INSERT INTO social_accounts (id, user_id, platform, provider_user_id, username, access_token_encrypted, refresh_token_encrypted, token_expires_at)
      VALUES (${randomUUID()}, ${userId}, 'spotify', ${me.id ?? null}, ${me.display_name ?? null}, ${encrypted}, ${refreshEncrypted}, ${expiresAt})
    `);
    res.redirect(pending.returnSlug ? `${APP_PUBLIC_URL}/presave/${pending.returnSlug}?spotify=connected` : `${APP_PUBLIC_URL}/presave?spotify=connected`);
  } catch (err) { logger.warn({ err }, "[stack11] spotify callback failed"); fail("oauth_failed"); }
});

router.get("/distribution/spotify/status", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`SELECT username FROM social_accounts WHERE user_id = ${req.userId!} AND platform = 'spotify' LIMIT 1`);
    const row = r.rows[0] as { username: string | null } | undefined;
    res.json({ configured: spotifyConfigured(), connected: Boolean(row), username: row?.username ?? null });
  } catch (err) { logger.error({ err }, "[stack11] spotify status failed"); res.status(500).json({ error: "Couldn't check the account connection." }); }
});

router.post("/distribution/presave/:slug/account-presave", requireAuth, async (req, res) => {
  try {
    const release = await getReleaseBySlug(param(req, "slug"));
    if (!release) { res.status(404).json({ error: "Pre-save link not found." }); return; }
    const links = release.presave_platform_links ?? {};
    const item = parseSpotifyItem(links["spotify"]);
    if (!item) {
      /* The platform API can only save a track/album it can identify.
         No id → no account action is claimed; email/follow stays. */
      res.status(409).json({ error: "account_presave_unavailable", message: "This release doesn't have a Spotify track or album link yet, so there's nothing to save to your library. You can still pre-save by email.", fallback: "email" });
      return;
    }
    const acct = await db.execute(sql`SELECT access_token_encrypted FROM social_accounts WHERE user_id = ${req.userId!} AND platform = 'spotify' LIMIT 1`);
    const acctRow = acct.rows[0] as { access_token_encrypted: string | null } | undefined;
    if (!acctRow?.access_token_encrypted) {
      res.status(409).json({ error: "spotify_not_connected", message: "Connect your Spotify account first — then this saves the release straight to your library.", connectRequired: true });
      return;
    }
    let accessToken: string;
    try { accessToken = decryptToken(acctRow.access_token_encrypted); }
    catch { res.status(503).json({ error: "not_configured", message: "Account pre-save isn't configured yet — pre-save by email instead." }); return; }
    const saveRes = await fetch(spotifyLibrarySaveUrl(item), { method: "PUT", headers: { authorization: `Bearer ${accessToken}` } });
    if (!saveRes.ok) {
      if (saveRes.status === 401 || saveRes.status === 403) {
        res.status(409).json({ error: "spotify_reconnect", message: "Your Spotify connection needs a refresh — reconnect and try again. Nothing was saved.", connectRequired: true });
        return;
      }
      res.status(502).json({ error: "spotify_save_failed", message: "Spotify didn't confirm the save, so we didn't record one. Try again." });
      return;
    }
    await db.execute(sql`
      INSERT INTO presave_account_actions (id, release_id, user_id, platform, item_kind, item_id, status)
      VALUES (${randomUUID()}, ${release.id}, ${req.userId!}, 'spotify', ${item.kind}, ${item.id}, 'saved')
      ON CONFLICT (release_id, user_id, platform) DO NOTHING
    `);
    res.json({ saved: true, platform: "spotify", itemKind: item.kind, itemId: item.id, actionLabel: `Saved to your Spotify library` });
  } catch (err) { logger.error({ err }, "[stack11] account presave failed"); res.status(500).json({ error: "Couldn't complete the account pre-save." }); }
});

/* Descriptor the public landing uses to decide its headline action. */
export function accountPresaveDescriptor(platformLinks: Record<string, string> | null | undefined) {
  const item = parseSpotifyItem(platformLinks?.["spotify"]);
  return item
    ? { platform: "spotify" as const, supported: true, itemKind: item.kind, actionLabel: "Save on Spotify" }
    : { platform: "spotify" as const, supported: false, reason: "No Spotify track or album link on this release yet — email pre-save is the action.", actionLabel: null };
}

/* ═══ #3 Splits accounting depth: per-payee statements ══════════════════ */
router.get("/distribution/splits/statements", requireAuth, async (req, res) => {
  try {
    const periodStart = typeof req.query["periodStart"] === "string" ? req.query["periodStart"] : undefined;
    const periodEnd = typeof req.query["periodEnd"] === "string" ? req.query["periodEnd"] : undefined;
    const relRes = await db.execute(sql`SELECT id, title FROM distribution_releases WHERE user_id = ${req.userId!}`);
    const releases = (relRes.rows as Array<{ id: string; title: string }>).map((r) => ({ id: r.id, title: r.title }));
    const entRes = await db.execute(sql`SELECT song_title, platform, period_start, period_end, gross_amount FROM royalty_entries WHERE user_id = ${req.userId!} ORDER BY period_start ASC LIMIT 5000`);
    const entries = (entRes.rows as Array<{ song_title: string; platform: string; period_start: string; period_end: string; gross_amount: string }>)
      .map((e) => ({ songTitle: e.song_title, platform: e.platform, periodStart: String(e.period_start).slice(0, 10), periodEnd: String(e.period_end).slice(0, 10), grossAmount: e.gross_amount }));
    let splits: Array<{ releaseId: string; payeeName: string; sharePct: number; effectiveFrom: string; supersededAt: string | null }> = [];
    if (releases.length) {
      const spRes = await db.execute(sql`SELECT release_id, payee_name, share_pct, effective_from, superseded_at FROM distribution_royalty_splits WHERE user_id = ${req.userId!}`);
      splits = (spRes.rows as Array<{ release_id: string; payee_name: string; share_pct: string; effective_from: string; superseded_at: string | null }>)
        .map((s) => ({ releaseId: s.release_id, payeeName: s.payee_name, sharePct: Number(s.share_pct), effectiveFrom: String(s.effective_from), supersededAt: s.superseded_at ? String(s.superseded_at) : null }));
    }
    const result = computeSplitStatements(releases, entries, splits, { periodStart, periodEnd });
    res.json({
      statements: result.statements,
      unallocated: result.unallocated,
      matchedEntryCount: result.matchedEntryCount,
      recordedEntryCount: entries.length,
      /* Fake-zero discipline: no recorded entries → hasData false and the
         UI shows an empty state, never a statement full of $0.00 rows. */
      hasData: result.matchedEntryCount > 0,
      period: { periodStart: periodStart ?? null, periodEnd: periodEnd ?? null },
      note: "Read-only accounting from the royalties you imported or logged and the split agreements in effect for each period. No money moves here.",
    });
  } catch (err) { logger.error({ err }, "[stack11] split statements failed"); res.status(500).json({ error: "Couldn't build the split statements." }); }
});

/* ═══ #4a Lyrics package step ═══════════════════════════════════════════ */
const lyricsBody = z.object({
  lyrics: z.string().max(20000).optional().default(""),
  timedLines: z.array(z.object({ text: z.string().max(500), start: z.number().min(0), end: z.number().min(0) })).max(500).optional().default([]),
});
interface LyricsRow { lyrics: string; timed_lines: TimedLyricLine[] | null }
function lyricsDto(release: OwnedRelease, row: LyricsRow | null) {
  const lines = validTimedLines(row?.timed_lines ?? []);
  return {
    lyrics: row?.lyrics ?? "",
    timedLines: lines,
    lrc: buildLrc(lines, { title: release.title, artist: release.artist_name }),
    step: { name: "Lyrics", complete: Boolean((row?.lyrics ?? "").trim()) },
    deliveredWithReleasePackage: true,
  };
}
async function loadLyrics(releaseId: string): Promise<LyricsRow | null> {
  const r = await db.execute(sql`SELECT lyrics, timed_lines FROM release_lyrics_packages WHERE release_id = ${releaseId} LIMIT 1`);
  return (r.rows[0] as unknown as LyricsRow) ?? null;
}
router.put("/distribution/releases/:id/lyrics-package", requireAuth, async (req, res) => {
  try {
    const release = await getOwnedRelease(param(req, "id"), req.userId!);
    if (!release) { res.status(404).json({ error: "Release not found." }); return; }
    const parsed = lyricsBody.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: "Invalid lyrics package." }); return; }
    const lines = validTimedLines(parsed.data.timedLines);
    const existing = await loadLyrics(release.id);
    if (existing) {
      await db.execute(sql`UPDATE release_lyrics_packages SET lyrics = ${parsed.data.lyrics}, timed_lines = ${JSON.stringify(lines)}::jsonb, updated_at = now() WHERE release_id = ${release.id}`);
    } else {
      await db.execute(sql`INSERT INTO release_lyrics_packages (id, release_id, user_id, lyrics, timed_lines) VALUES (${randomUUID()}, ${release.id}, ${req.userId!}, ${parsed.data.lyrics}, ${JSON.stringify(lines)}::jsonb)`);
    }
    res.json({ lyricsPackage: lyricsDto(release, await loadLyrics(release.id)) });
  } catch (err) { logger.error({ err }, "[stack11] lyrics save failed"); res.status(500).json({ error: "Couldn't save the lyrics package." }); }
});
router.get("/distribution/releases/:id/lyrics-package", requireAuth, async (req, res) => {
  try {
    const release = await getOwnedRelease(param(req, "id"), req.userId!);
    if (!release) { res.status(404).json({ error: "Release not found." }); return; }
    res.json({ lyricsPackage: lyricsDto(release, await loadLyrics(release.id)) });
  } catch (err) { logger.error({ err }, "[stack11] lyrics load failed"); res.status(500).json({ error: "Couldn't load the lyrics package." }); }
});

/* ═══ #4b Takedown / edit REQUEST flow ══════════════════════════════════ */
const changeBody = z.object({
  kind: z.enum(["takedown", "edit"]),
  reason: z.string().trim().min(1).max(500),
  details: z.string().max(4000).optional().default(""),
});
interface ChangeRow { id: string; release_id: string; kind: string; reason: string; details: string; status: string; created_at: string; updated_at: string }
const changeDto = (r: ChangeRow) => ({ id: r.id, releaseId: r.release_id, kind: r.kind, reason: r.reason, details: r.details, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });

router.post("/distribution/releases/:id/change-requests", requireAuth, async (req, res) => {
  try {
    const release = await getOwnedRelease(param(req, "id"), req.userId!);
    if (!release) { res.status(404).json({ error: "Release not found." }); return; }
    const parsed = changeBody.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: "A reason is required for a takedown or edit request." }); return; }
    const id = randomUUID();
    await db.execute(sql`INSERT INTO release_change_requests (id, release_id, user_id, kind, reason, details, status) VALUES (${id}, ${release.id}, ${req.userId!}, ${parsed.data.kind}, ${parsed.data.reason}, ${parsed.data.details}, 'requested')`);
    const r = await db.execute(sql`SELECT id, release_id, kind, reason, details, status, created_at, updated_at FROM release_change_requests WHERE id = ${id}`);
    res.status(201).json({ request: changeDto(r.rows[0] as unknown as ChangeRow), note: "Request recorded on our side. Stores honoring it waits for the delivery partner pipe — your release's delivery status stays labeled sandbox-simulated until then." });
  } catch (err) { logger.error({ err }, "[stack11] change request failed"); res.status(500).json({ error: "Couldn't file the request." }); }
});
router.get("/distribution/releases/:id/change-requests", requireAuth, async (req, res) => {
  try {
    const release = await getOwnedRelease(param(req, "id"), req.userId!);
    if (!release) { res.status(404).json({ error: "Release not found." }); return; }
    const r = await db.execute(sql`SELECT id, release_id, kind, reason, details, status, created_at, updated_at FROM release_change_requests WHERE release_id = ${release.id} ORDER BY created_at DESC`);
    res.json({ requests: (r.rows as unknown as ChangeRow[]).map(changeDto) });
  } catch (err) { logger.error({ err }, "[stack11] change list failed"); res.status(500).json({ error: "Couldn't load requests." }); }
});
router.patch("/distribution/change-requests/:id", requireAuth, async (req, res) => {
  try {
    const status = (req.body as { status?: string } | undefined)?.status;
    const r = await db.execute(sql`SELECT id, release_id, kind, reason, details, status, created_at, updated_at FROM release_change_requests WHERE id = ${param(req, "id")} AND user_id = ${req.userId!} LIMIT 1`);
    const row = r.rows[0] as unknown as ChangeRow | undefined;
    if (!row) { res.status(404).json({ error: "Request not found." }); return; }
    if (status === "sent_to_partner") {
      /* Honest state machine: there is no partner pipe yet, so nothing can
         truthfully be "sent" — refuse rather than fake the transition. */
      res.status(409).json({ error: "no_partner_pipe", message: "There's no delivery partner pipe yet, so this request can't be sent to stores. It stays on record here until the pipe exists." });
      return;
    }
    if (status !== "acknowledged" || row.status !== "requested") {
      res.status(400).json({ error: "Only a requested request can be marked acknowledged." });
      return;
    }
    await db.execute(sql`UPDATE release_change_requests SET status = 'acknowledged', updated_at = now() WHERE id = ${row.id}`);
    const u = await db.execute(sql`SELECT id, release_id, kind, reason, details, status, created_at, updated_at FROM release_change_requests WHERE id = ${row.id}`);
    res.json({ request: changeDto(u.rows[0] as unknown as ChangeRow) });
  } catch (err) { logger.error({ err }, "[stack11] change update failed"); res.status(500).json({ error: "Couldn't update the request." }); }
});

/* ═══ #5 Permanence elections (beside Stack 10 succession) ══════════════ */
const electionBody = z.object({ election: z.enum(["permanent", "standard"]) });
interface ElectionRow { id: string; release_id: string | null; scope: string; election: string; created_at: string; updated_at: string }
const electionDto = (r: ElectionRow) => ({ id: r.id, releaseId: r.release_id, scope: r.scope, election: r.election, createdAt: r.created_at, updatedAt: r.updated_at });

async function upsertElection(userId: string, scope: "release" | "catalog", releaseId: string | null, election: string) {
  if (scope === "catalog") {
    await db.execute(sql`DELETE FROM release_permanence_elections WHERE user_id = ${userId} AND scope = 'catalog'`);
    const id = randomUUID();
    await db.execute(sql`INSERT INTO release_permanence_elections (id, user_id, release_id, scope, election) VALUES (${id}, ${userId}, NULL, 'catalog', ${election})`);
    const r = await db.execute(sql`SELECT id, release_id, scope, election, created_at, updated_at FROM release_permanence_elections WHERE id = ${id}`);
    return r.rows[0] as unknown as ElectionRow;
  }
  const existing = await db.execute(sql`SELECT id FROM release_permanence_elections WHERE user_id = ${userId} AND release_id = ${releaseId} LIMIT 1`);
  if (existing.rows.length) {
    await db.execute(sql`UPDATE release_permanence_elections SET election = ${election}, updated_at = now() WHERE user_id = ${userId} AND release_id = ${releaseId}`);
  } else {
    await db.execute(sql`INSERT INTO release_permanence_elections (id, user_id, release_id, scope, election) VALUES (${randomUUID()}, ${userId}, ${releaseId}, 'release', ${election})`);
  }
  const r = await db.execute(sql`SELECT id, release_id, scope, election, created_at, updated_at FROM release_permanence_elections WHERE user_id = ${userId} AND release_id = ${releaseId} LIMIT 1`);
  return r.rows[0] as unknown as ElectionRow;
}

router.get("/distribution/permanence", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`SELECT id, release_id, scope, election, created_at, updated_at FROM release_permanence_elections WHERE user_id = ${req.userId!} ORDER BY created_at ASC`);
    const rows = r.rows as unknown as ElectionRow[];
    const rel = await db.execute(sql`SELECT id, title FROM distribution_releases WHERE user_id = ${req.userId!}`);
    const titles = new Map((rel.rows as Array<{ id: string; title: string }>).map((x) => [x.id, x.title]));
    res.json({
      catalog: rows.filter((x) => x.scope === "catalog").map(electionDto)[0] ?? null,
      releases: rows.filter((x) => x.scope === "release").map((x) => ({ ...electionDto(x), releaseTitle: x.release_id ? titles.get(x.release_id) ?? null : null })),
      covers: PERMANENCE_COVERS,
      excludes: PERMANENCE_EXCLUDES,
    });
  } catch (err) { logger.error({ err }, "[stack11] permanence load failed"); res.status(500).json({ error: "Couldn't load permanence settings." }); }
});
router.put("/distribution/permanence/catalog", requireAuth, async (req, res) => {
  const parsed = electionBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Pick a permanence election." }); return; }
  try { res.json({ election: electionDto(await upsertElection(req.userId!, "catalog", null, parsed.data.election)) }); }
  catch (err) { logger.error({ err }, "[stack11] catalog permanence failed"); res.status(500).json({ error: "Couldn't save the catalog election." }); }
});
router.put("/distribution/releases/:id/permanence", requireAuth, async (req, res) => {
  const parsed = electionBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Pick a permanence election." }); return; }
  try {
    const release = await getOwnedRelease(param(req, "id"), req.userId!);
    if (!release) { res.status(404).json({ error: "Release not found." }); return; }
    res.json({ election: electionDto(await upsertElection(req.userId!, "release", release.id, parsed.data.election)) });
  } catch (err) { logger.error({ err }, "[stack11] release permanence failed"); res.status(500).json({ error: "Couldn't save the release election." }); }
});

/* ═══ #7 Label roster v1 (distribution surface) ═════════════════════════
   PERMISSION RULE: the manager invites and sees roster status only. An
   artist's releases are visible to the manager READ-ONLY, and only after
   the artist (a) accepts the invite and (b) grants distribution access.
   No manager path edits, submits, splits, or deletes an artist release. */
interface RosterRow { id: string; manager_user_id: string; team_id: string | null; artist_user_id: string | null; artist_name: string; artist_email: string; status: string; distribution_access: boolean; created_at: string }
const rosterDto = (r: RosterRow) => ({ id: r.id, teamId: r.team_id, artistUserId: r.artist_user_id, artistName: r.artist_name, artistEmail: r.artist_email, status: r.status, distributionAccess: Boolean(r.distribution_access), createdAt: r.created_at });
const ROSTER_COLS = sql`id, manager_user_id, team_id, artist_user_id, artist_name, artist_email, status, distribution_access, created_at`;
async function getRosterRow(id: string): Promise<RosterRow | null> {
  const r = await db.execute(sql`SELECT ${ROSTER_COLS} FROM label_roster_members WHERE id = ${id} LIMIT 1`);
  return (r.rows[0] as unknown as RosterRow) ?? null;
}

router.get("/distribution/roster", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`SELECT ${ROSTER_COLS} FROM label_roster_members WHERE manager_user_id = ${req.userId!} ORDER BY created_at ASC`);
    res.json({ members: (r.rows as unknown as RosterRow[]).map(rosterDto), permissionRule: "You can invite artists and see roster status. An artist's releases become visible to you — read-only — only after they accept and grant distribution access. You can never edit, submit, or delete an artist's release." });
  } catch (err) { logger.error({ err }, "[stack11] roster load failed"); res.status(500).json({ error: "Couldn't load the roster." }); }
});

const inviteBody = z.object({ artistName: z.string().trim().max(120).optional().default(""), artistEmail: z.string().email().max(254), teamId: z.string().uuid().optional() });
router.post("/distribution/roster/invite", requireAuth, async (req, res) => {
  const parsed = inviteBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "An artist email is required." }); return; }
  try {
    if (parsed.data.teamId) {
      /* Roster slots can ride a team only when the manager runs that team
         (owner, or an active owner/admin member). */
      const t = await db.execute(sql`
        SELECT t.id FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ${req.userId!} AND tm.status = 'active'
        WHERE t.id = ${parsed.data.teamId} AND (t.owner_id = ${req.userId!} OR tm.role IN ('owner', 'admin')) LIMIT 1`);
      if (!t.rows.length) { res.status(403).json({ error: "You don't manage that team." }); return; }
    }
    const email = parsed.data.artistEmail.trim().toLowerCase();
    const existing = await db.execute(sql`SELECT ${ROSTER_COLS} FROM label_roster_members WHERE manager_user_id = ${req.userId!} AND artist_email = ${email} LIMIT 1`);
    if (existing.rows.length) {
      const row = existing.rows[0] as unknown as RosterRow;
      if (row.status !== "removed") { res.status(409).json({ error: "That artist is already on your roster." }); return; }
      await db.execute(sql`UPDATE label_roster_members SET status = 'invited', artist_name = ${parsed.data.artistName}, distribution_access = false, updated_at = now() WHERE id = ${row.id}`);
      res.status(201).json({ member: rosterDto((await getRosterRow(row.id))!) });
      return;
    }
    const id = randomUUID();
    await db.execute(sql`INSERT INTO label_roster_members (id, manager_user_id, team_id, artist_user_id, artist_name, artist_email, status, distribution_access) VALUES (${id}, ${req.userId!}, ${parsed.data.teamId ?? null}, NULL, ${parsed.data.artistName}, ${email}, 'invited', false)`);
    res.status(201).json({ member: rosterDto((await getRosterRow(id))!) });
  } catch (err) { logger.error({ err }, "[stack11] roster invite failed"); res.status(500).json({ error: "Couldn't add the artist." }); }
});

router.get("/distribution/roster/invites", requireAuth, async (req, res) => {
  try {
    const email = (req.userEmail ?? "").trim().toLowerCase();
    if (!email) { res.json({ invites: [] }); return; }
    const r = await db.execute(sql`SELECT ${ROSTER_COLS} FROM label_roster_members WHERE artist_email = ${email} AND status IN ('invited', 'accepted') ORDER BY created_at DESC`);
    res.json({ invites: (r.rows as unknown as RosterRow[]).map(rosterDto) });
  } catch (err) { logger.error({ err }, "[stack11] roster invites failed"); res.status(500).json({ error: "Couldn't load roster invites." }); }
});

router.post("/distribution/roster/invites/:id/respond", requireAuth, async (req, res) => {
  try {
    const row = await getRosterRow(param(req, "id"));
    const email = (req.userEmail ?? "").trim().toLowerCase();
    if (!row || row.artist_email !== email) { res.status(404).json({ error: "Roster invite not found." }); return; }
    const response = (req.body as { response?: string })?.response;
    const grant = (req.body as { distributionAccess?: boolean })?.distributionAccess === true;
    if (response === "decline") {
      await db.execute(sql`UPDATE label_roster_members SET status = 'declined', artist_user_id = ${req.userId!}, distribution_access = false, updated_at = now() WHERE id = ${row.id}`);
    } else if (response === "accept") {
      await db.execute(sql`UPDATE label_roster_members SET status = 'accepted', artist_user_id = ${req.userId!}, distribution_access = ${grant}, updated_at = now() WHERE id = ${row.id}`);
    } else { res.status(400).json({ error: "Respond with accept or decline." }); return; }
    res.json({ member: rosterDto((await getRosterRow(row.id))!) });
  } catch (err) { logger.error({ err }, "[stack11] roster respond failed"); res.status(500).json({ error: "Couldn't record your answer." }); }
});

router.post("/distribution/roster/invites/:id/access", requireAuth, async (req, res) => {
  try {
    const row = await getRosterRow(param(req, "id"));
    if (!row || row.artist_user_id !== req.userId || row.status !== "accepted") { res.status(404).json({ error: "Roster membership not found." }); return; }
    const grant = (req.body as { distributionAccess?: boolean })?.distributionAccess === true;
    await db.execute(sql`UPDATE label_roster_members SET distribution_access = ${grant}, updated_at = now() WHERE id = ${row.id}`);
    res.json({ member: rosterDto((await getRosterRow(row.id))!) });
  } catch (err) { logger.error({ err }, "[stack11] roster access failed"); res.status(500).json({ error: "Couldn't update distribution access." }); }
});

router.delete("/distribution/roster/:memberId", requireAuth, async (req, res) => {
  try {
    const row = await getRosterRow(param(req, "memberId"));
    if (!row || row.manager_user_id !== req.userId) { res.status(404).json({ error: "Roster member not found." }); return; }
    await db.execute(sql`UPDATE label_roster_members SET status = 'removed', distribution_access = false, updated_at = now() WHERE id = ${row.id}`);
    res.json({ member: rosterDto((await getRosterRow(row.id))!) });
  } catch (err) { logger.error({ err }, "[stack11] roster remove failed"); res.status(500).json({ error: "Couldn't remove the artist." }); }
});

router.get("/distribution/roster/:memberId/releases", requireAuth, async (req, res) => {
  try {
    const row = await getRosterRow(param(req, "memberId"));
    if (!row || row.manager_user_id !== req.userId) { res.status(404).json({ error: "Roster member not found." }); return; }
    if (!rosterCanViewReleases({ status: row.status, distributionAccess: Boolean(row.distribution_access) }) || !row.artist_user_id) {
      /* No grant → no release data at all, not even titles. */
      res.status(403).json({ error: "no_distribution_access", message: "This artist hasn't granted distribution access, so their releases aren't visible here.", releases: [] });
      return;
    }
    const r = await db.execute(sql`SELECT id, title, artist_name, status, release_date, release_type, created_at FROM distribution_releases WHERE user_id = ${row.artist_user_id} ORDER BY created_at DESC LIMIT 200`);
    res.json({ readOnly: true, releases: (r.rows as Array<{ id: string; title: string; artist_name: string; status: string; release_date: string | null; release_type: string | null; created_at: string }>).map((x) => ({ id: x.id, title: x.title, artistName: x.artist_name, status: x.status, releaseDate: x.release_date, releaseType: x.release_type ?? "single", createdAt: x.created_at })) });
  } catch (err) { logger.error({ err }, "[stack11] roster releases failed"); res.status(500).json({ error: "Couldn't load the artist's releases." }); }
});

/* ═══ #8 Generalized social-unlock gates (Promote) ══════════════════════ */
const gateBody = z.object({
  title: z.string().trim().min(1).max(200),
  action: z.enum(["follow", "share"]),
  targetProfileId: z.string().uuid().optional(),
  contentUrl: z.string().max(2000),
  contentLabel: z.string().max(200).optional().default(""),
});
interface GateRow { id: string; owner_user_id: string; slug: string; title: string; action: string; target_profile_id: string | null; content_url: string; content_label: string; active: boolean; created_at: string }
const GATE_COLS = sql`id, owner_user_id, slug, title, action, target_profile_id, content_url, content_label, active, created_at`;
async function getGateBySlug(slug: string): Promise<GateRow | null> {
  const r = await db.execute(sql`SELECT ${GATE_COLS} FROM social_unlock_gates WHERE slug = ${slug} LIMIT 1`);
  return (r.rows[0] as unknown as GateRow) ?? null;
}
/* Public DTO deliberately omits contentUrl — the URL is the prize and is
   only ever returned by the verified unlock call. */
const gatePublicDto = (g: GateRow) => ({ slug: g.slug, title: g.title, action: g.action, contentLabel: g.content_label, active: Boolean(g.active) });

router.post("/promote/unlock-gates", requireAuth, async (req, res) => {
  const parsed = gateBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Give the gate a title, an action, and a content link." }); return; }
  const contentUrl = cleanUrl(parsed.data.contentUrl);
  if (!contentUrl) { res.status(400).json({ error: "Content link must be a real http(s) URL." }); return; }
  try {
    if (parsed.data.action === "follow") {
      if (!parsed.data.targetProfileId) { res.status(400).json({ error: "A follow gate needs the profile fans must follow." }); return; }
      const p = await db.execute(sql`SELECT id FROM creator_profiles WHERE id = ${parsed.data.targetProfileId} LIMIT 1`);
      if (!p.rows.length) { res.status(400).json({ error: "That profile doesn't exist." }); return; }
    }
    const id = randomUUID();
    const slug = randomUUID().replace(/-/g, "").slice(0, 10);
    await db.execute(sql`INSERT INTO social_unlock_gates (id, owner_user_id, slug, title, action, target_profile_id, content_url, content_label, active) VALUES (${id}, ${req.userId!}, ${slug}, ${parsed.data.title}, ${parsed.data.action}, ${parsed.data.targetProfileId ?? null}, ${contentUrl}, ${parsed.data.contentLabel}, true)`);
    const r = await db.execute(sql`SELECT ${GATE_COLS} FROM social_unlock_gates WHERE id = ${id}`);
    const g = r.rows[0] as unknown as GateRow;
    res.status(201).json({ gate: { ...gatePublicDto(g), id: g.id, contentUrl: g.content_url, url: `${APP_PUBLIC_URL}/unlock/${g.slug}` } });
  } catch (err) { logger.error({ err }, "[stack11] gate create failed"); res.status(500).json({ error: "Couldn't create the gate." }); }
});

router.get("/promote/unlock-gates", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`SELECT ${GATE_COLS} FROM social_unlock_gates WHERE owner_user_id = ${req.userId!} ORDER BY created_at DESC`);
    const gates = r.rows as unknown as GateRow[];
    const out = [];
    for (const g of gates) {
      let unlockProofs = 0;
      try {
        if (g.action === "share") {
          const c = await db.execute(sql`SELECT COUNT(*) AS c FROM social_unlock_share_records WHERE gate_id = ${g.id}`);
          unlockProofs = Number((c.rows[0] as { c: string | number }).c ?? 0);
        } else if (g.target_profile_id) {
          const c = await db.execute(sql`SELECT COUNT(*) AS c FROM follows WHERE profile_id = ${g.target_profile_id}`);
          unlockProofs = Number((c.rows[0] as { c: string | number }).c ?? 0);
        }
      } catch { /* counts are best-effort on older installs */ }
      out.push({ ...gatePublicDto(g), id: g.id, contentUrl: g.content_url, unlockProofs });
    }
    res.json({ gates: out });
  } catch (err) { logger.error({ err }, "[stack11] gate list failed"); res.status(500).json({ error: "Couldn't load your gates." }); }
});

router.delete("/promote/unlock-gates/:id", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`SELECT id FROM social_unlock_gates WHERE id = ${param(req, "id")} AND owner_user_id = ${req.userId!} LIMIT 1`);
    if (!r.rows.length) { res.status(404).json({ error: "Gate not found." }); return; }
    await db.execute(sql`UPDATE social_unlock_gates SET active = false, updated_at = now() WHERE id = ${param(req, "id")}`);
    res.json({ deactivated: true });
  } catch (err) { logger.error({ err }, "[stack11] gate delete failed"); res.status(500).json({ error: "Couldn't deactivate the gate." }); }
});

router.get("/promote/unlock-gates/:slug", publicApiLimiter, async (req, res) => {
  try {
    const gate = await getGateBySlug(param(req, "slug"));
    if (!gate || !gate.active) { res.status(404).json({ error: "Unlock gate not found." }); return; }
    res.json({ gate: gatePublicDto(gate) });
  } catch (err) { logger.error({ err }, "[stack11] gate public failed"); res.status(500).json({ error: "Couldn't load the gate." }); }
});

router.post("/promote/unlock-gates/:slug/record-share", requireAuth, async (req, res) => {
  try {
    const gate = await getGateBySlug(param(req, "slug"));
    if (!gate || !gate.active) { res.status(404).json({ error: "Unlock gate not found." }); return; }
    if (gate.action !== "share") { res.status(400).json({ error: "This gate unlocks by following, not sharing." }); return; }
    const channel = typeof (req.body as { channel?: string })?.channel === "string" ? (req.body as { channel: string }).channel.slice(0, 40) : "";
    await db.execute(sql`INSERT INTO social_unlock_share_records (id, gate_id, user_id, channel) VALUES (${randomUUID()}, ${gate.id}, ${req.userId!}, ${channel}) ON CONFLICT (gate_id, user_id) DO NOTHING`);
    res.json({ recorded: true });
  } catch (err) { logger.error({ err }, "[stack11] gate share record failed"); res.status(500).json({ error: "Couldn't record your share." }); }
});

router.post("/promote/unlock-gates/:slug/unlock", requireAuth, async (req, res) => {
  try {
    const gate = await getGateBySlug(param(req, "slug"));
    if (!gate || !gate.active) { res.status(404).json({ error: "Unlock gate not found." }); return; }
    let isFollowing = false;
    let hasRecordedShare = false;
    if (gate.action === "follow" && gate.target_profile_id) {
      const f = await db.execute(sql`SELECT follower_user_id FROM follows WHERE follower_user_id = ${req.userId!} AND profile_id = ${gate.target_profile_id} LIMIT 1`);
      isFollowing = f.rows.length > 0;
    }
    if (gate.action === "share") {
      const s = await db.execute(sql`SELECT id FROM social_unlock_share_records WHERE gate_id = ${gate.id} AND user_id = ${req.userId!} LIMIT 1`);
      hasRecordedShare = s.rows.length > 0;
      if (!hasRecordedShare) {
        /* A recorded repost of the gate owner's content also counts — it is
           a share action in our own social graph, not a fan's say-so. */
        try {
          const rp = await db.execute(sql`
            SELECT r.user_id FROM reposts r JOIN profile_tracks pt ON pt.id = r.track_id JOIN creator_profiles cp ON cp.id = pt.profile_id
            WHERE r.user_id = ${req.userId!} AND cp.user_id = ${gate.owner_user_id} LIMIT 1`);
          hasRecordedShare = rp.rows.length > 0;
        } catch { /* repost graph unavailable — recorded gate shares still count */ }
      }
    }
    if (!gateUnlocked(gate.action, { isFollowing, hasRecordedShare })) {
      res.status(403).json({ error: "not_unlocked", message: gate.action === "follow" ? "Follow first — we check your follow before unlocking." : "Share first — the unlock opens once your share is recorded.", gate: gatePublicDto(gate) });
      return;
    }
    res.json({ unlocked: true, contentUrl: gate.content_url, contentLabel: gate.content_label });
  } catch (err) { logger.error({ err }, "[stack11] gate unlock failed"); res.status(500).json({ error: "Couldn't check the unlock." }); }
});

export default router;
