/* public-routes.ts — the access law in one screen (Lane 1, access lockdown).
 *
 * Owner law (Oct 17, 18:17 EDT): everything is locked behind the sign-in
 * screen besides the home screen and the Virtual World. Owner ruling
 * (18:18 EDT): creator profiles stay public storefronts. The audit
 * (~/workspace/access-lockdown/AUDIT.md §1.1, §1.6, §4.1, §4.5) turned
 * that law into the set below, and the owner approved recommendations
 * D1–D5 as defaults (18:25 EDT):
 *
 *   D1 creator media landings are PUBLIC (the profile principle applied
 *      to the profile's contents — shared links must not hit a wall);
 *   D2 fan-funnel landings are PUBLIC (conversion pages; their action
 *      steps already gate);
 *   D3 the shops cluster is PUBLIC to browse (buying stays gated);
 *   D4 the discovery / marketing / SEO family LOCKS, with /charts and
 *      /shorts as the §1.6 exceptions that stay public;
 *   D5 marketplace directories are PUBLIC to browse (actions gated).
 *
 * This module is the single allowlist the GuestGate (Lane 2) consults:
 * a path is public iff `isPublicPath` says so — default-deny. A route
 * added tomorrow is locked until it is deliberately added here AND
 * classified in ROUTE_MATRIX below; the census test
 * (public-routes.test.ts) fails the build until both happen.
 *
 * Patterns are wouter-style: exact literal segments plus `:param`
 * segments, each `:param` matching exactly one non-empty segment.
 * Segment-exact matching is what keeps the close neighbours apart:
 * `/tips/:handle` is public while `/tips` is locked, `/shop/:slug` is
 * public while `/store/buy/:kind/:id` is locked, and `/memberships`
 * is public with no deeper public path under it.
 */

export const PUBLIC_ROUTES: readonly string[] = [
  // By law, by ruling, or by necessity (audit §1.1).
  "/",
  "/world",
  "/artist/:slug",
  "/login",
  "/signup",
  "/reset-password",
  "/qr-login",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/review/:token",
  "/sync-one-sheet/:token",
  "/store/success",
  // Shops cluster — browse (D3, audit §1.6).
  "/storefronts",
  "/shop/:slug",
  "/storefront/product/:id",
  // §1.6 exceptions to the D4 discovery lock.
  "/charts",
  "/shorts",
  "/press/:handle",
  // Creator media landings (D1).
  "/track/:id",
  "/watch/:id",
  "/playlist/:id",
  "/live/:id",
  "/live/guest/:token",
  "/premiere/:id",
  "/sound/:id",
  "/hashtag/:tag",
  "/albums/:slug",
  "/plan/:slug",
  "/photo-preset/:slug",
  "/collection/:slug",
  // Fan-funnel landings (D2).
  "/presave/:slug",
  "/unlock/:slug",
  "/splits/:slug",
  "/join/:handle",
  "/bio/:slug",
  "/c/:slug",
  "/tips/:handle",
  // The app's download home (owner order, Stack-100 #3): a guest must
  // be able to land on it and download straight from the page — the
  // D2 conversion logic; the app itself signs in after install.
  "/app",
  // Marketplace browse (D5).
  "/beats",
  "/shoutouts",
  "/memberships",
  "/contests",
  "/winners",
  "/challenge/:slug",
  "/challenge/:slug/winners",
];

/** Split a path or pattern into segments; the root path has none. */
function splitSegments(path: string): string[] {
  if (path === "/") return [];
  return path.slice(1).split("/");
}

/** Match one pattern against already-split path segments. */
function patternMatches(pattern: string, pathSegments: string[]): boolean {
  const patternSegments = splitSegments(pattern);
  if (patternSegments.length !== pathSegments.length) return false;
  for (let i = 0; i < patternSegments.length; i += 1) {
    const want = patternSegments[i];
    const got = pathSegments[i];
    if (want.startsWith(":")) {
      if (got.length === 0) return false;
    } else if (want !== got) {
      return false;
    }
  }
  return true;
}

/**
 * Is `pathname` on the public allowlist?
 *
 * Pure and segment-exact: the pattern and the path must have the same
 * number of segments, literal segments must be equal, and a `:param`
 * segment matches any single non-empty segment. A single trailing
 * slash is tolerated (except on the root, which matches only "/").
 * Query strings and hashes are ignored if a caller passes them, so
 * both a bare wouter location and a full href can be judged. Anything
 * malformed (no leading slash, empty segments, protocol-relative
 * "//…") is not public — default-deny.
 */
export function isPublicPath(pathname: string): boolean {
  if (typeof pathname !== "string" || pathname.length === 0) return false;
  let path = pathname;
  const queryAt = path.search(/[?#]/);
  if (queryAt !== -1) path = path.slice(0, queryAt);
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/") return PUBLIC_ROUTES.includes("/");
  const segments = splitSegments(path);
  if (segments.some((segment) => segment.length === 0)) return false;
  return PUBLIC_ROUTES.some((pattern) => patternMatches(pattern, segments));
}

/* ------------------------------------------------------------------ */
/* Route-disposition matrix — the census the test consumes.            */
/*                                                                     */
/* Every route declared in App.tsx (both Switches) appears exactly     */
/* once, in App.tsx order. Dispositions:                               */
/*   "public"   — on the allowlist above; guests render it.            */
/*   "locked"   — members only; the gate bounces guests to             */
/*                /login?next=… (audit §4.2).                          */
/*   "redirect" — an alias; `redirectTo` is the target exactly as      */
/*                written in App.tsx (query included) and              */
/*                `targetDisposition` classifies the RESOLVED target   */
/*                per audit §1.5: a redirect is public iff its target  */
/*                is public. (Every current alias targets a locked     */
/*                route, so every targetDisposition below is            */
/*                "locked" — the field exists so a future alias to a   */
/*                public target is classified, not assumed.)          */
/* The catch-all 404 route (`<Route component={NotFound} />`, no       */
/* path) is declared last under CATCH_ALL_PATH: "locked", because the  */
/* gate runs before the 404 for guests — a guest typing a nonsense     */
/* URL gets the sign-in screen, while members still get the real 404   */
/* (audit §4.3).                                                       */
/* ------------------------------------------------------------------ */

export type RouteDisposition = "public" | "locked" | "redirect";

export interface RouteMatrixEntry {
  path: string;
  disposition: RouteDisposition;
  /** Redirect entries only: the target exactly as written in App.tsx. */
  redirectTo?: string;
  /** Redirect entries only: disposition of the resolved target. */
  targetDisposition?: "public" | "locked";
}

/** The path key for App.tsx's path-less catch-all (404) route. */
export const CATCH_ALL_PATH = "*";

export const ROUTE_MATRIX: readonly RouteMatrixEntry[] = [
  { path: "/login", disposition: "public" },
  { path: "/signup", disposition: "public" },
  { path: "/qr-login", disposition: "public" },
  { path: "/reset-password", disposition: "public" },
  { path: "/pricing", disposition: "locked" },
  { path: "/creator-pricing", disposition: "locked" },
  { path: "/waitlist", disposition: "redirect", redirectTo: "/beta-access", targetDisposition: "locked" },
  { path: "/extension", disposition: "locked" },
  { path: "/download", disposition: "locked" },
  { path: "/app", disposition: "public" },
  { path: "/templates", disposition: "locked" },
  { path: "/templates/videos", disposition: "locked" },
  { path: "/templates/thumbnails", disposition: "locked" },
  { path: "/templates/hooks", disposition: "locked" },
  { path: "/templates/captions", disposition: "locked" },
  { path: "/tools", disposition: "locked" },
  { path: "/tools/ai-thumbnail-maker", disposition: "locked" },
  { path: "/tools/ai-hook-generator", disposition: "locked" },
  { path: "/tools/ai-music-video-maker", disposition: "locked" },
  { path: "/tools/ai-caption-generator", disposition: "locked" },
  { path: "/tools/ai-clip-maker", disposition: "locked" },
  { path: "/tools/ai-song-maker", disposition: "locked" },
  { path: "/for", disposition: "locked" },
  { path: "/for/youtubers", disposition: "locked" },
  { path: "/for/podcasters", disposition: "locked" },
  { path: "/for/streamers", disposition: "locked" },
  { path: "/for/musicians", disposition: "locked" },
  { path: "/for/tiktokers", disposition: "locked" },
  { path: "/for/educators", disposition: "locked" },
  { path: "/genres/hip-hop", disposition: "locked" },
  { path: "/genres/pop", disposition: "locked" },
  { path: "/genres/edm", disposition: "locked" },
  { path: "/genres/rock", disposition: "locked" },
  { path: "/genres/rnb", disposition: "locked" },
  { path: "/genres/lofi", disposition: "locked" },
  { path: "/genres/country", disposition: "locked" },
  { path: "/genres/trap", disposition: "locked" },
  { path: "/charts", disposition: "public" },
  { path: "/search", disposition: "locked" },
  { path: "/browse", disposition: "locked" },
  { path: "/vertical/:vertical", disposition: "locked" },
  { path: "/genres", disposition: "locked" },
  { path: "/genre/:genre", disposition: "locked" },
  { path: "/showcase", disposition: "locked" },
  { path: "/showcase/:slug", disposition: "locked" },
  { path: "/albums/:slug", disposition: "public" },
  { path: "/plan/:slug", disposition: "public" },
  { path: "/beta-access", disposition: "locked" },
  { path: "/invite/:code", disposition: "locked" },
  { path: "/contact", disposition: "locked" },
  { path: "/terms", disposition: "public" },
  { path: "/privacy", disposition: "public" },
  { path: "/refund-policy", disposition: "public" },
  { path: "/randomizer", disposition: "redirect", redirectTo: "/hooks?tab=dice", targetDisposition: "locked" },
  { path: "/hooks", disposition: "locked" },
  { path: "/sounds", disposition: "redirect", redirectTo: "/audio-studio?tab=sounds", targetDisposition: "locked" },
  { path: "/shorts", disposition: "public" },
  { path: "/sound/:id", disposition: "public" },
  { path: "/challenge/:slug/winners", disposition: "public" },
  { path: "/winners", disposition: "public" },
  { path: "/challenge/:slug", disposition: "public" },
  { path: "/hashtag/:tag", disposition: "public" },
  { path: "/artist/:slug", disposition: "public" },
  { path: "/photo-preset/:slug", disposition: "public" },
  { path: "/collection/:slug", disposition: "public" },
  { path: "/track/:id", disposition: "public" },
  { path: "/watch/:id", disposition: "public" },
  { path: "/live/:id", disposition: "public" },
  { path: "/live/guest/:token", disposition: "public" },
  { path: "/premiere/:id", disposition: "public" },
  { path: "/broadcast", disposition: "redirect", redirectTo: "/go-live", targetDisposition: "locked" },
  { path: "/playlist/:id", disposition: "public" },
  { path: "/comment-replies", disposition: "redirect", redirectTo: "/community?tab=replies", targetDisposition: "locked" },
  { path: "/cursor-lab", disposition: "locked" },
  { path: "/tour", disposition: "locked" },
  { path: "/coach", disposition: "locked" },
  { path: "/brand-deals", disposition: "locked" },
  { path: "/distribute", disposition: "locked" },
  { path: "/tips", disposition: "locked" },
  { path: "/beats", disposition: "public" },
  { path: "/memberships", disposition: "public" },
  { path: "/shoutouts", disposition: "public" },
  { path: "/referrals", disposition: "locked" },
  { path: "/team", disposition: "locked" },
  { path: "/press-kit", disposition: "locked" },
  { path: "/email-list", disposition: "locked" },
  { path: "/collabs", disposition: "locked" },
  { path: "/contests", disposition: "public" },
  { path: "/arcade", disposition: "locked" },
  { path: "/party", disposition: "locked" },
  { path: "/storefronts", disposition: "public" },
  { path: "/my-shop", disposition: "locked" },
  { path: "/earnings", disposition: "locked" },
  { path: "/brand-calculator", disposition: "locked" },
  { path: "/academy", disposition: "locked" },
  { path: "/content-calendar", disposition: "redirect", redirectTo: "/scheduler?tab=calendar", targetDisposition: "locked" },
  { path: "/sponsors", disposition: "redirect", redirectTo: "/brand-deals?tab=marketplace", targetDisposition: "locked" },
  { path: "/shows", disposition: "redirect", redirectTo: "/go-live?tab=shows", targetDisposition: "locked" },
  { path: "/presave/:slug", disposition: "public" },
  { path: "/unlock/:slug", disposition: "public" },
  { path: "/splits/:slug", disposition: "public" },
  { path: "/upscale", disposition: "redirect", redirectTo: "/video-editor?tab=upscale", targetDisposition: "locked" },
  { path: "/scheduler", disposition: "locked" },
  { path: "/home", disposition: "locked" },
  { path: "/trending", disposition: "locked" },
  { path: "/remix", disposition: "locked" },
  { path: "/saved", disposition: "locked" },
  { path: "/post/:id", disposition: "locked" },
  { path: "/tips/:handle", disposition: "public" },
  { path: "/shop/:slug", disposition: "public" },
  { path: "/storefront/product/:id", disposition: "public" },
  { path: "/interview-prep", disposition: "locked" },
  { path: "/watermark-removal", disposition: "redirect", redirectTo: "/video-editor?tab=upscale", targetDisposition: "locked" },
  { path: "/audio-cleanup", disposition: "redirect", redirectTo: "/audio-studio?tab=cleanup", targetDisposition: "locked" },
  { path: "/setlist", disposition: "locked" },
  { path: "/analytics", disposition: "redirect", redirectTo: "/analytics-hub?tab=connected", targetDisposition: "locked" },
  { path: "/import", disposition: "locked" },
  { path: "/logo-maker", disposition: "redirect", redirectTo: "/branding-kit?tab=logo", targetDisposition: "locked" },
  { path: "/branding-kit", disposition: "locked" },
  { path: "/virality-check", disposition: "redirect", redirectTo: "/analytics-hub?tab=virality", targetDisposition: "locked" },
  { path: "/analytics-hub", disposition: "locked" },
  { path: "/intros-outros", disposition: "redirect", redirectTo: "/branding-kit?tab=intros", targetDisposition: "locked" },
  { path: "/stream-pack", disposition: "redirect", redirectTo: "/branding-kit?tab=stream", targetDisposition: "locked" },
  { path: "/copyright", disposition: "locked" },
  { path: "/llc-guide", disposition: "locked" },
  { path: "/press/:handle", disposition: "public" },
  { path: "/join/:handle", disposition: "public" },
  { path: "/features", disposition: "locked" },
  { path: "/promote", disposition: "locked" },
  { path: "/guides", disposition: "redirect", redirectTo: "/academy?tab=guides", targetDisposition: "locked" },
  { path: "/clip-maker", disposition: "redirect", redirectTo: "/video-editor?tab=repurpose", targetDisposition: "locked" },
  { path: "/branding-shop", disposition: "redirect", redirectTo: "/branding-kit?tab=shop", targetDisposition: "locked" },
  { path: "/nfc-cards", disposition: "locked" },
  { path: "/jewelry-shop", disposition: "locked" },
  { path: "/c/:slug", disposition: "public" },
  { path: "/bio/:slug", disposition: "public" },
  { path: "/review/:token", disposition: "public" },
  { path: "/sync-one-sheet/:token", disposition: "public" },
  { path: "/groups", disposition: "locked" },
  { path: "/groups/:slug", disposition: "locked" },
  { path: "/events", disposition: "locked" },
  { path: "/events/:id", disposition: "locked" },
  { path: "/explore", disposition: "locked" },
  { path: "/video-editor", disposition: "locked" },
  { path: "/", disposition: "public" },
  { path: "/dashboard", disposition: "locked" },
  { path: "/choose-artist", disposition: "locked" },
  { path: "/my-projects", disposition: "locked" },
  { path: "/generations", disposition: "redirect", redirectTo: "/my-projects?tab=history", targetDisposition: "locked" },
  { path: "/artist-vault", disposition: "locked" },
  { path: "/make-song", disposition: "redirect", redirectTo: "/create?panel=song", targetDisposition: "locked" },
  { path: "/make-video", disposition: "redirect", redirectTo: "/create?panel=video", targetDisposition: "locked" },
  { path: "/video-studio", disposition: "redirect", redirectTo: "/video-editor", targetDisposition: "locked" },
  { path: "/song-and-video", disposition: "redirect", redirectTo: "/create?panel=song-video", targetDisposition: "locked" },
  { path: "/create", disposition: "locked" },
  { path: "/promo-clip", disposition: "redirect", redirectTo: "/video-editor?tab=promo-clips", targetDisposition: "locked" },
  { path: "/thumbnail", disposition: "redirect", redirectTo: "/thumbnail-studio?tab=generate", targetDisposition: "locked" },
  { path: "/thumbnails", disposition: "redirect", redirectTo: "/thumbnail-studio?tab=library", targetDisposition: "locked" },
  { path: "/credit-history", disposition: "locked" },
  { path: "/settings", disposition: "locked" },
  { path: "/my-clips", disposition: "redirect", redirectTo: "/my-projects?tab=myclips", targetDisposition: "locked" },
  { path: "/admin", disposition: "locked" },
  { path: "/songs", disposition: "redirect", redirectTo: "/my-projects?tab=songs", targetDisposition: "locked" },
  { path: "/locations", disposition: "redirect", redirectTo: "/video-editor?tab=locations", targetDisposition: "locked" },
  { path: "/thumbnail-maker", disposition: "redirect", redirectTo: "/thumbnail-studio?tab=generate", targetDisposition: "locked" },
  { path: "/thumbnail-studio", disposition: "locked" },
  { path: "/carousel-maker", disposition: "locked" },
  { path: "/books", disposition: "locked" },
  { path: "/library", disposition: "locked" },
  { path: "/cartoon-studio", disposition: "redirect", redirectTo: "/create?panel=cartoon", targetDisposition: "locked" },
  { path: "/merch", disposition: "redirect", redirectTo: "/branding-kit?tab=shop&subtab=merch", targetDisposition: "locked" },
  { path: "/playlist-pitch", disposition: "redirect", redirectTo: "/label-pitch?mode=playlists", targetDisposition: "locked" },
  { path: "/label-pitch", disposition: "locked" },
  { path: "/channel-audit", disposition: "redirect", redirectTo: "/analytics-hub?tab=channel-audit", targetDisposition: "locked" },
  { path: "/contracts", disposition: "locked" },
  { path: "/movies", disposition: "locked" },
  { path: "/website-builder", disposition: "locked" },
  { path: "/detector", disposition: "locked" },
  { path: "/sponsorship-outreach", disposition: "redirect", redirectTo: "/brand-deals?tab=pitch", targetDisposition: "locked" },
  { path: "/release-checklist", disposition: "redirect", redirectTo: "/distribute?tab=plan", targetDisposition: "locked" },
  { path: "/go-live", disposition: "locked" },
  { path: "/go-live/controller", disposition: "locked" },
  { path: "/world", disposition: "public" },
  { path: "/discord-bot", disposition: "redirect", redirectTo: "/go-live?tab=discord", targetDisposition: "locked" },
  { path: "/jewelry", disposition: "redirect", redirectTo: "/branding-kit?tab=jewelry", targetDisposition: "locked" },
  { path: "/gamers", disposition: "redirect", redirectTo: "/go-live?tab=gamers", targetDisposition: "locked" },
  { path: "/caption-styler", disposition: "redirect", redirectTo: "/hooks?tab=styler", targetDisposition: "locked" },
  { path: "/cover-art", disposition: "redirect", redirectTo: "/create?panel=coverart", targetDisposition: "locked" },
  { path: "/lyric-video", disposition: "redirect", redirectTo: "/video-editor?tab=lyric-video", targetDisposition: "locked" },
  { path: "/translate", disposition: "redirect", redirectTo: "/video-editor?tab=translate", targetDisposition: "locked" },
  { path: "/script-writer", disposition: "redirect", redirectTo: "/hooks?tab=scripts", targetDisposition: "locked" },
  { path: "/repurpose", disposition: "redirect", redirectTo: "/video-editor?tab=repurpose", targetDisposition: "locked" },
  { path: "/trends", disposition: "redirect", redirectTo: "/scheduler?tab=trends", targetDisposition: "locked" },
  { path: "/feed", disposition: "redirect", redirectTo: "/home?view=drops", targetDisposition: "locked" },
  { path: "/thumbnail-test", disposition: "redirect", redirectTo: "/thumbnail-studio?tab=abtest", targetDisposition: "locked" },
  { path: "/audio-studio", disposition: "locked" },
  { path: "/ai-audio", disposition: "redirect", redirectTo: "/audio-studio?tab=aiaudio", targetDisposition: "locked" },
  { path: "/vocal-removal", disposition: "redirect", redirectTo: "/audio-studio?tab=stems&mode=vocals", targetDisposition: "locked" },
  { path: "/voiceover", disposition: "redirect", redirectTo: "/audio-studio?tab=voiceover", targetDisposition: "locked" },
  { path: "/sponsors/post", disposition: "locked" },
  { path: "/sponsors/dashboard", disposition: "locked" },
  { path: "/sponsors/:id", disposition: "locked" },
  { path: "/titles", disposition: "redirect", redirectTo: "/hooks?tab=titles", targetDisposition: "locked" },
  { path: "/community", disposition: "locked" },
  { path: "/mastering", disposition: "redirect", redirectTo: "/audio-studio?tab=master&mode=quick", targetDisposition: "locked" },
  { path: "/mix-master", disposition: "redirect", redirectTo: "/audio-studio?tab=master", targetDisposition: "locked" },
  { path: "/stems", disposition: "redirect", redirectTo: "/audio-studio?tab=stems", targetDisposition: "locked" },
  { path: "/sfx", disposition: "redirect", redirectTo: "/audio-studio?tab=aiaudio&sub=sfx", targetDisposition: "locked" },
  { path: "/samples", disposition: "redirect", redirectTo: "/audio-studio?tab=aiaudio&sub=samples", targetDisposition: "locked" },
  { path: "/podcast", disposition: "redirect", redirectTo: "/audio-studio?tab=podcast", targetDisposition: "locked" },
  { path: "/beat-maker", disposition: "redirect", redirectTo: "/audio-studio?tab=aiaudio&sub=beats", targetDisposition: "locked" },
  { path: "/hub", disposition: "redirect", redirectTo: "/create?panel=hub", targetDisposition: "locked" },
  { path: "/messages", disposition: "locked" },
  { path: "/live-shopping", disposition: "locked" },
  { path: "/royalties", disposition: "redirect", redirectTo: "/coach?tab=money&view=royalties", targetDisposition: "locked" },
  { path: "/store/buy/:kind/:id", disposition: "locked" },
  { path: "/store/success", disposition: "public" },
  { path: "/my-music", disposition: "locked" },
  { path: "/move-home", disposition: "locked" },
  { path: "/catalog-import", disposition: "locked" },
  { path: "/artist-setup", disposition: "locked" },
  { path: "/publish", disposition: "locked" },
  { path: "/creator/domains", disposition: "locked" },
  { path: "/store/dashboard", disposition: "locked" },
  { path: "/music-sales", disposition: "redirect", redirectTo: "/store/dashboard?view=digital", targetDisposition: "locked" },
  { path: "/storefronts/builder", disposition: "locked" },
  { path: CATCH_ALL_PATH, disposition: "locked" },
];

/**
 * The disposition a visitor effectively meets for a matrix entry:
 * plain entries carry their own; a redirect carries its target's.
 */
export function effectiveDisposition(
  entry: RouteMatrixEntry,
): "public" | "locked" {
  if (entry.disposition === "redirect") {
    return entry.targetDisposition ?? "locked";
  }
  return entry.disposition;
}

/**
 * Resolve a redirect alias to its target, per ROUTE_MATRIX — the
 * ordering half of the access law (fix, 2026-10-18).
 *
 * The GuestGate wraps both Switches, so it judges the raw location
 * before the router's own `<Redirect>` route for an alias can render.
 * An alias path is not on the allowlist (its disposition lives on its
 * target), so without this step a guest hitting an alias was bounced
 * to /login?next=<alias> and the alias never resolved. The gate now
 * consults this resolver first: an alias hands the visitor to its
 * target, and the gate re-judges THERE — a locked target bounces to
 * /login?next=<target>, a public target renders.
 *
 * Single-hop by construction: the visitor is sent to the target
 * exactly as written in App.tsx (query included), and the target is
 * judged on arrival; if a future alias ever points at another alias,
 * the same step simply runs again at the new location. The census
 * test pins that no current alias targets another alias.
 *
 * Matching mirrors `isPublicPath` exactly: query/hash ignored, one
 * trailing slash tolerated, segment-exact with `:param` support, and
 * anything malformed (no leading slash, empty segments,
 * protocol-relative "//…") resolves to null — never to a target.
 */
export function resolveRouteRedirect(pathname: string): string | null {
  if (typeof pathname !== "string" || pathname.length === 0) return null;
  let path = pathname;
  const queryAt = path.search(/[?#]/);
  if (queryAt !== -1) path = path.slice(0, queryAt);
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/") return null;
  const segments = splitSegments(path);
  if (segments.some((segment) => segment.length === 0)) return null;
  for (const entry of ROUTE_MATRIX) {
    if (entry.disposition !== "redirect" || !entry.redirectTo) continue;
    if (patternMatches(entry.path, segments)) return entry.redirectTo;
  }
  return null;
}
