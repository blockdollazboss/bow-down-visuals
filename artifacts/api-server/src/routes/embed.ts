import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import {
  creatorProfilesTable,
  profileTracksTable,
  profileVideosTable,
  playlistsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";

/* ─── Embeddable players/widgets (virality wave) ─────────────────────────────
   Every embed is a billboard: a creator pastes our player on their blog or
   website and every visitor sees Bow Down Visuals branding plus a
   "create your own" CTA carrying the creator's ?ref= code.

   - GET /embed/track/:id, /embed/video/:id, /embed/playlist/:id,
     /embed/profile/:slug  → tiny standalone HTML pages (no SPA bundle,
     no app chrome, no login). Served by embedPageRouter, registered on the
     app BEFORE the SPA fallback in app.ts.
   - GET /api/embed/track/:id (etc.) → compact JSON the pages fetch.
   - GET /api/embed/refcode/:slug → the creator's public referral code.
   - GET /api/oembed?url=… → oEmbed 1.0 for rich pasting into other platforms.

   Security: embed pages carry NO X-Frame-Options and a relaxed CSP
   (frame-ancestors unrestricted) so any site can frame them. They make no
   authenticated requests and set no cookies — sandbox-friendly. */

export const embedApiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a minute." },
});

export const embedApiRouter = Router();
export const embedPageRouter = Router();

/** Normalize a stored media path to a playable URL (same-origin iframe). */
function mediaUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  if (/^(https?:|blob:|data:)/i.test(s)) return s;
  return s.startsWith("/") ? s : `/${s}`;
}

/** The creator's public referral code (codes are meant to be shared). */
async function refCodeForUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const rows = await db.execute(
      sql`SELECT code FROM referral_codes WHERE user_id = ${userId} LIMIT 1`,
    );
    const code = (rows as unknown as { code?: string }[])[0]?.code;
    return typeof code === "string" && code.length > 0 ? code.toUpperCase() : null;
  } catch {
    return null;
  }
}

async function publicProfileById(id: string) {
  const [row] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.id, id))
    .limit(1);
  return row && row.isPublic ? row : null;
}

async function publicProfileBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.slug, slug.toLowerCase()))
    .limit(1);
  return row && row.isPublic ? row : null;
}

interface EmbedTrackData {
  kind: "track";
  id: string;
  title: string;
  artist_name: string;
  artist_slug: string | null;
  artwork_url: string | null;
  audio_url: string;
  ref_code: string | null;
}

async function getEmbedTrack(id: string): Promise<EmbedTrackData | null> {
  const [t] = await db.select().from(profileTracksTable).where(eq(profileTracksTable.id, id)).limit(1);
  if (!t || !t.isPublished) return null;
  const profile = await publicProfileById(t.profileId);
  if (!profile) return null;
  return {
    kind: "track",
    id: t.id,
    title: t.title,
    artist_name: profile.displayName,
    artist_slug: profile.slug,
    artwork_url: t.artworkUrl,
    audio_url: mediaUrl(t.audioUrl),
    ref_code: await refCodeForUser(profile.userId),
  };
}

interface EmbedVideoData {
  kind: "video";
  id: string;
  title: string;
  artist_name: string;
  artist_slug: string | null;
  thumbnail_url: string | null;
  video_url: string;
  ref_code: string | null;
}

async function getEmbedVideo(id: string): Promise<EmbedVideoData | null> {
  const [v] = await db.select().from(profileVideosTable).where(eq(profileVideosTable.id, id)).limit(1);
  if (!v || !v.isPublished) return null;
  const profile = await publicProfileById(v.profileId);
  if (!profile) return null;
  return {
    kind: "video",
    id: v.id,
    title: v.title,
    artist_name: profile.displayName,
    artist_slug: profile.slug,
    thumbnail_url: v.thumbnailUrl,
    video_url: mediaUrl(v.videoUrl),
    ref_code: await refCodeForUser(profile.userId),
  };
}

interface EmbedPlaylistData {
  kind: "playlist";
  id: string;
  title: string;
  owner_name: string;
  cover_url: string | null;
  item_count: number;
  ref_code: string | null;
  items: Array<{ kind: "track" | "video"; id: string; title: string; thumb: string | null }>;
}

async function getEmbedPlaylist(id: string): Promise<EmbedPlaylistData | null> {
  const [pl] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, id)).limit(1);
  if (!pl || !pl.isPublic) return null;
  const owner = await publicProfileById(pl.ownerProfileId);
  if (!owner) return null;
  const refs = (pl.items ?? []).slice(0, 10);
  const items: EmbedPlaylistData["items"] = [];
  for (const r of refs) {
    try {
      if (r.kind === "track") {
        const [t] = await db.select().from(profileTracksTable).where(eq(profileTracksTable.id, r.id)).limit(1);
        if (t && t.isPublished) items.push({ kind: "track", id: t.id, title: t.title, thumb: t.artworkUrl });
      } else {
        const [v] = await db.select().from(profileVideosTable).where(eq(profileVideosTable.id, r.id)).limit(1);
        if (v && v.isPublished) items.push({ kind: "video", id: v.id, title: v.title, thumb: v.thumbnailUrl });
      }
    } catch { /* skip */ }
  }
  return {
    kind: "playlist",
    id: pl.id,
    title: pl.title,
    owner_name: owner.displayName,
    cover_url: pl.coverUrl ?? items[0]?.thumb ?? null,
    item_count: (pl.items ?? []).length,
    ref_code: await refCodeForUser(owner.userId),
    items,
  };
}

interface EmbedProfileData {
  kind: "profile";
  slug: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  ref_code: string | null;
  featured: { kind: "track" | "video"; id: string; title: string; media_url: string; thumb: string | null } | null;
}

async function getEmbedProfile(slug: string): Promise<EmbedProfileData | null> {
  const profile = await publicProfileBySlug(slug);
  if (!profile) return null;
  const [topTrack] = await db
    .select()
    .from(profileTracksTable)
    .where(and(eq(profileTracksTable.profileId, profile.id), eq(profileTracksTable.isPublished, true)))
    .orderBy(desc(profileTracksTable.playCount))
    .limit(1);
  let featured: EmbedProfileData["featured"] = null;
  if (topTrack) {
    featured = { kind: "track", id: topTrack.id, title: topTrack.title, media_url: mediaUrl(topTrack.audioUrl), thumb: topTrack.artworkUrl };
  } else {
    const [topVideo] = await db
      .select()
      .from(profileVideosTable)
      .where(and(eq(profileVideosTable.profileId, profile.id), eq(profileVideosTable.isPublished, true)))
      .orderBy(desc(profileVideosTable.viewCount))
      .limit(1);
    if (topVideo) {
      featured = { kind: "video", id: topVideo.id, title: topVideo.title, media_url: mediaUrl(topVideo.videoUrl), thumb: topVideo.thumbnailUrl };
    }
  }
  return {
    kind: "profile",
    slug: profile.slug,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    bio: profile.bio ? profile.bio.split("\n")[0]!.slice(0, 160) : null,
    ref_code: await refCodeForUser(profile.userId),
    featured,
  };
}

/* ── Compact JSON data endpoints (fetched by the embed pages) ─────────────── */

embedApiRouter.use(embedApiLimiter);

embedApiRouter.get("/embed/track/:id", async (req: Request, res: Response) => {
  const d = await getEmbedTrack(String(req.params["id"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

embedApiRouter.get("/embed/video/:id", async (req: Request, res: Response) => {
  const d = await getEmbedVideo(String(req.params["id"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

embedApiRouter.get("/embed/playlist/:id", async (req: Request, res: Response) => {
  const d = await getEmbedPlaylist(String(req.params["id"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

embedApiRouter.get("/embed/profile/:slug", async (req: Request, res: Response) => {
  const d = await getEmbedProfile(String(req.params["slug"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

/** GET /api/embed/refcode/:slug — a creator's public referral code for embed CTAs. */
embedApiRouter.get("/embed/refcode/:slug", async (req: Request, res: Response) => {
  const profile = await publicProfileBySlug(String(req.params["slug"]));
  if (!profile) { res.status(404).json({ error: "Not found." }); return; }
  res.json({ code: await refCodeForUser(profile.userId) });
});

/* ── oEmbed ───────────────────────────────────────────────────────────────── */

const OEMBED_MATCHERS: Array<{
  re: RegExp;
  embed: (m: RegExpMatchArray) => { kind: string; id: string; width: number; height: number };
}> = [
  { re: /\/track\/([A-Za-z0-9-]+)/, embed: (m) => ({ kind: "track", id: m[1]!, width: 420, height: 200 }) },
  { re: /\/watch\/([A-Za-z0-9-]+)/, embed: (m) => ({ kind: "video", id: m[1]!, width: 560, height: 360 }) },
  { re: /\/playlist\/([A-Za-z0-9-]+)/, embed: (m) => ({ kind: "playlist", id: m[1]!, width: 420, height: 430 }) },
  { re: /\/artist\/([A-Za-z0-9-]+)/, embed: (m) => ({ kind: "profile", id: m[1]!, width: 360, height: 480 }) },
];

embedApiRouter.get("/oembed", async (req: Request, res: Response) => {
  const url = String(req.query["url"] ?? "");
  if (!url) { res.status(400).json({ error: "Missing url parameter." }); return; }
  let parsed: URL;
  try { parsed = new URL(url); } catch { res.status(400).json({ error: "Invalid url." }); return; }
  const match = OEMBED_MATCHERS.map((m) => ({ m, hit: parsed.pathname.match(m.re) }))
    .find((x) => x.hit);
  if (!match || !match.hit) { res.status(404).json({ error: "No embeddable resource at that URL." }); return; }
  const e = match.m.embed(match.hit);
  const base = `${parsed.protocol}//${parsed.host}`;

  let title = "Bow Down Visuals";
  let author = "Bow Down Visuals";
  let thumbnail: string | null = null;
  try {
    if (e.kind === "track") {
      const d = await getEmbedTrack(e.id);
      if (d) { title = d.title; author = d.artist_name; thumbnail = d.artwork_url; }
    } else if (e.kind === "video") {
      const d = await getEmbedVideo(e.id);
      if (d) { title = d.title; author = d.artist_name; thumbnail = d.thumbnail_url; }
    } else if (e.kind === "playlist") {
      const d = await getEmbedPlaylist(e.id);
      if (d) { title = d.title; author = d.owner_name; thumbnail = d.cover_url; }
    } else {
      const d = await getEmbedProfile(e.id);
      if (d) { title = d.display_name; author = d.display_name; thumbnail = d.avatar_url; }
    }
  } catch { /* fall back to defaults */ }

  res.json({
    version: "1.0",
    type: "rich",
    provider_name: "Bow Down Visuals",
    provider_url: base,
    title,
    author_name: author,
    thumbnail_url: thumbnail,
    width: e.width,
    height: e.height,
    html: `<iframe src="${base}/embed/${e.kind}/${encodeURIComponent(e.id)}" width="${e.width}" height="${e.height}" frameborder="0" allow="autoplay; encrypted-media; fullscreen" loading="lazy" title="${title.replace(/"/g, "&quot;")} — Bow Down Visuals"></iframe>`,
  });
});

/* ── Embed HTML pages ───────────────────────────────────────────────────────
   One self-contained document per kind: inline CSS + vanilla JS, ~12KB,
   no SPA bundle, no login. Fetches its compact JSON and renders a gold/black
   luxury player with the "Made with Bow Down Visuals — create your own" CTA.
   The CTA carries ?ref= from the iframe URL (baked in by the Embed button),
   else the creator's code from the API. */

const EMBED_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#0a0805;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;overflow:hidden}
a{color:inherit;text-decoration:none}
.player{flex:1;display:flex;min-height:0;position:relative}
.brandbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid rgba(232,200,106,.25);background:rgba(0,0,0,.55);font-size:12px;color:rgba(255,255,255,.65)}
.brandbar .dot{width:8px;height:8px;border-radius:50%;background:#e8c86a;box-shadow:0 0 10px rgba(232,200,106,.9);flex-shrink:0}
.brandbar b{color:#e8c86a}
.cta{margin-left:auto;flex-shrink:0;background:#e8c86a;color:#000;font-weight:800;font-size:12px;padding:6px 12px;border-radius:999px;white-space:nowrap}
.cta:hover{background:#f5d67e}
.title{font-weight:800;font-size:15px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.artist{font-size:12px;color:rgba(255,255,255,.55);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.artist b{color:#e8c86a;font-weight:600}
audio{width:100%;accent-color:#e8c86a;outline:none}
video{width:100%;height:100%;object-fit:contain;background:#000}
.err{margin:auto;text-align:center;color:rgba(255,255,255,.5);font-size:13px;padding:20px}
.spin{width:34px;height:34px;border:3px solid rgba(232,200,106,.2);border-top-color:#e8c86a;border-radius:50%;margin:auto;animation:sp 1s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
`;

function embedShell(kind: string, id: string, inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Bow Down Visuals embed</title><style>${EMBED_CSS}</style></head>
<body>
<div class="player" id="player"><div class="spin"></div></div>
<div class="brandbar"><span class="dot"></span><span>Made with <b>Bow Down Visuals</b></span><a class="cta" id="cta" href="/signup" target="_blank" rel="noopener">Create your own →</a></div>
<script>
(function(){
var KIND=${JSON.stringify(kind)}, ID=${JSON.stringify(id)};
var ref=null;
try{var q=new URLSearchParams(location.search);var r=q.get("ref");if(r&&/^[A-Za-z0-9]{4,16}$/i.test(r))ref=r.toUpperCase();}catch(e){}
function setCta(apiRef){
  var code=ref||apiRef;
  var a=document.getElementById("cta");
  a.href=code?"/signup?ref="+encodeURIComponent(code):"/signup";
}
function err(msg){
  document.getElementById("player").innerHTML='<div class="err">'+msg+'<br/><br/><a style="color:#e8c86a;text-decoration:underline" href="/" target="_blank" rel="noopener">bowdownvisuals.com</a></div>';
}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
fetch("/api/embed/"+KIND+"/"+encodeURIComponent(ID),{headers:{"Accept":"application/json"}})
.then(function(r){if(!r.ok)throw 0;return r.json();})
.then(function(d){setCta(d.ref_code);${inner}})
.catch(function(){err("This embed is unavailable — it may have been removed.");});
})();
</script></body></html>`;
}

const TRACK_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";p.style.padding="14px";p.style.gap="10px";
p.innerHTML=
'<div style="display:flex;gap:12px;align-items:center;min-height:0">'+
(d.artwork_url?'<img src="'+esc(d.artwork_url)+'" alt="" style="width:84px;height:84px;border-radius:12px;object-fit:cover;border:1px solid rgba(232,200,106,.35);flex-shrink:0"/>':
'<div style="width:84px;height:84px;border-radius:12px;background:linear-gradient(135deg,rgba(232,200,106,.3),#000);border:1px solid rgba(232,200,106,.35);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:28px">🎵</div>')+
'<div style="min-width:0;flex:1"><div class="title">'+esc(d.title)+'</div><div class="artist">by <b>'+esc(d.artist_name)+'</b></div></div>'+
(d.artist_slug?'<a href="/artist/'+esc(d.artist_slug)+'" target="_blank" rel="noopener" style="font-size:12px;color:#e8c86a;border:1px solid rgba(232,200,106,.4);border-radius:999px;padding:5px 10px;flex-shrink:0">Profile</a>':"")+
'</div>'+
'<audio controls preload="metadata" src="'+esc(d.audio_url)+'"></audio>';`;

const VIDEO_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";
p.innerHTML=
'<video controls playsinline preload="metadata" '+(d.thumbnail_url?'poster="'+esc(d.thumbnail_url)+'" ':"")+'src="'+esc(d.video_url)+'"></video>'+
'<div style="padding:8px 12px 4px"><div class="title" style="font-size:13px">'+esc(d.title)+'</div><div class="artist">by <b>'+esc(d.artist_name)+'</b></div></div>';`;

const PLAYLIST_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";p.style.padding="12px";p.style.gap="8px";p.style.overflowY="auto";
var items=(d.items||[]).map(function(it,i){
var link=it.kind==="track"?"/track/"+it.id:"/watch/"+it.id;
return '<a href="'+link+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:6px;border-radius:10px;background:rgba(255,255,255,.03)">'+
'<span style="width:20px;text-align:center;font-size:11px;color:rgba(255,255,255,.35)">'+(i+1)+'</span>'+
(it.thumb?'<img src="'+esc(it.thumb)+'" alt="" style="width:38px;height:38px;border-radius:8px;object-fit:cover;flex-shrink:0"/>':
'<div style="width:38px;height:38px;border-radius:8px;background:rgba(232,200,106,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:15px">'+(it.kind==="video"?"🎬":"🎵")+'</div>')+
'<span style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">'+esc(it.title)+'</span></a>';
}).join("");
p.innerHTML=
'<div style="display:flex;gap:10px;align-items:center">'+
(d.cover_url?'<img src="'+esc(d.cover_url)+'" alt="" style="width:64px;height:64px;border-radius:12px;object-fit:cover;border:1px solid rgba(232,200,106,.35);flex-shrink:0"/>':
'<div style="width:64px;height:64px;border-radius:12px;background:linear-gradient(135deg,rgba(232,200,106,.3),#000);border:1px solid rgba(232,200,106,.35);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:24px">🎶</div>')+
'<div style="min-width:0"><div class="title">'+esc(d.title)+'</div><div class="artist">by <b>'+esc(d.owner_name)+'</b> · '+d.item_count+' items</div></div></div>'+
'<div style="display:flex;flex-direction:column;gap:4px;overflow-y:auto">'+items+'</div>';`;

const PROFILE_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";p.style.padding="14px";p.style.gap="10px";p.style.alignItems="center";p.style.textAlign="center";p.style.overflowY="auto";
var feat="";
if(d.featured){
feat='<div style="width:100%;background:rgba(255,255,255,.03);border:1px solid rgba(232,200,106,.25);border-radius:12px;padding:10px;text-align:left">'+
'<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#e8c86a;font-weight:700;margin-bottom:6px">Featured drop</div>'+
'<div class="title" style="font-size:13px">'+esc(d.featured.title)+'</div>'+
(d.featured.kind==="track"
?'<audio controls preload="metadata" src="'+esc(d.featured.media_url)+'" style="margin-top:8px"></audio>'
:'<a href="/watch/'+esc(d.featured.id)+'" target="_blank" rel="noopener" style="display:block;margin-top:8px;position:relative">'+
(d.featured.thumb?'<img src="'+esc(d.featured.thumb)+'" alt="" style="width:100%;border-radius:8px;display:block"/>':"")+
'<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><span style="width:44px;height:44px;border-radius:50%;background:#e8c86a;color:#000;display:flex;align-items:center;justify-content:center;font-size:18px">▶</span></span></a>')+
'</div>';
}
p.innerHTML=
(d.avatar_url?'<img src="'+esc(d.avatar_url)+'" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid #e8c86a"/>':
'<div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,rgba(232,200,106,.35),#000);border:2px solid #e8c86a;display:flex;align-items:center;justify-content:center;font-size:30px">🦈</div>')+
'<div><div class="title" style="font-size:17px">'+esc(d.display_name)+'</div>'+
(d.bio?'<div class="artist" style="white-space:normal;margin-top:4px">'+esc(d.bio)+'</div>':"")+'</div>'+
'<a href="/artist/'+esc(d.slug)+'" target="_blank" rel="noopener" style="font-size:13px;font-weight:700;color:#000;background:#e8c86a;border-radius:999px;padding:8px 18px">View full profile</a>'+
feat;`;

function sendEmbed(kind: string, id: string, js: string) {
  return (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    /* Embeds must be frameable anywhere — the global middleware skips
       X-Frame-Options/CSP for /embed/* (see app.ts). Cache briefly. */
    res.setHeader("Cache-Control", "public, max-age=120");
    res.send(embedShell(kind, id, js));
  };
}

embedPageRouter.get("/embed/track/:id", (req, res) => sendEmbed("track", String(req.params["id"]), TRACK_JS)(req, res));
embedPageRouter.get("/embed/video/:id", (req, res) => sendEmbed("video", String(req.params["id"]), VIDEO_JS)(req, res));
embedPageRouter.get("/embed/playlist/:id", (req, res) => sendEmbed("playlist", String(req.params["id"]), PLAYLIST_JS)(req, res));
embedPageRouter.get("/embed/profile/:slug", (req, res) => sendEmbed("profile", String(req.params["slug"]), PROFILE_JS)(req, res));

export default embedApiRouter;
