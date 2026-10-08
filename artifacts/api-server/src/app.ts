import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { embedPageRouter } from "./routes/embed";
import { logger } from "./lib/logger";
import { stripeWebhookHandler } from "./lib/stripe-webhook";
import { stagingGate } from "./lib/staging-gate";
import { ogPreviewMiddleware } from "./lib/og-preview";
import { getWaitlistInvitePublic } from "./routes/waitlist";

const app: Express = express();

/* Security headers (manual implementation — no helmet dependency).
   CSP is permissive for the Vite SPA bundle while blocking common injection vectors. */
app.use((_req, res, next) => {
  /* Embed pages (/embed/*) must be frameable on ANY site — they carry no
     auth, set no cookies, and are the product's billboard. Skip
     X-Frame-Options there and relax CSP (no frame-ancestors restriction). */
  const isEmbed = _req.path.startsWith("/embed/");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!isEmbed) {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
  }
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    isEmbed
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https: blob:",
          "connect-src 'self'",
          "media-src 'self' https: blob: data:",
          "font-src 'self' data: https:",
        ].join("; ")
      : [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' https://js.stripe.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https: blob:",
          "connect-src 'self' https://*.supabase.co https://api.stripe.com wss://*.supabase.co",
          "frame-src https://js.stripe.com",
          "font-src 'self' data: https:",
          "media-src 'self' https: blob:",
        ].join("; ")
  );
  next();
});

/**
 * Global rate limiter: backstop for all routes.
 * 300 requests per minute per IP — generous for real users,
 * stops runaway scripts and hammering. Tighter per-route limits
 * (publicApiLimiter: 30/min) apply on abuse-prone endpoints.
 */
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a minute." },
});
app.use(globalLimiter);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin: [
    "https://bowdownvisuals.com",
    "https://www.bowdownvisuals.com",
    "https://bow-down-visuals-staging.onrender.com",
    "capacitor://localhost",
    "http://localhost",
  ],
  credentials: true,
}));

// Stripe webhook MUST be registered before express.json() so the raw Buffer body is preserved.
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));

// Staging password wall. Active only when STAGING_PASSWORD is set
// (staging service); production never sets it, so this is a no-op there.
app.use(stagingGate);

/* Dynamic OG/Twitter link previews for shareable public URLs.
   Bot-only: matches scraper User-Agents on shareable routes (/track/:id,
   /watch/:id, /artist/:slug, …) and answers with per-entity og:* tags +
   JSON-LD. Humans pass through to the SPA untouched. Must run before the
   static/SPA fallback below. */
app.use(ogPreviewMiddleware());

app.use("/api", router);

/* ── Embeddable player pages (virality) — registered BEFORE the SPA fallback
   so /embed/* serves the tiny standalone HTML, not index.html. */
app.use(embedPageRouter);

/* ── Shareable waitlist position pages with real OG tags ───────────────────
   /invite/:code is a client-side route (invite.tsx). Crawlers and link
   unfurlers don't run the SPA's JS, so they get a bot-only HTML page here
   with live OG tags (rank, invite count). Humans fall through to the SPA
   fallback below, which serves index.html and renders the interactive page. */
const INVITE_BOT_UA =
  /twitterbot|facebookexternalhit|slackbot|discordbot|whatsapp|telegrambot|linkedinbot|embedly|quora link preview|redditbot|applebot|googlebot|bingbot|pinterest|tumblr/i;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}

app.get("/invite/:code", async (req: Request, res: Response, next: NextFunction) => {
  const ua = req.get("user-agent") ?? "";
  if (!INVITE_BOT_UA.test(ua)) return next();
  try {
    const data = await getWaitlistInvitePublic(String(req.params["code"] ?? ""));
    if (!data) {
      res.status(404).send("Invite not found.");
      return;
    }
    const host = req.get("host") ?? "bowdownvisuals.com";
    const proto = req.get("x-forwarded-proto") ?? req.protocol;
    const pageUrl = `${proto}://${host}/invite/${data.code}`;
    const title = `#${data.position} on the Bow Down Visuals waitlist — skip the line with me`;
    const description =
      `${data.invitesCount} ${data.invitesCount === 1 ? "friend has" : "friends have"} joined through this link. ` +
      `Invite 3 friends to jump ${data.position} spots in the waitlist queue and unlock early access.`;
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
      `<title>${escapeHtml(title)}</title>` +
      `<meta name="description" content="${escapeHtml(description)}" />` +
      `<meta property="og:site_name" content="Bow Down Visuals" />` +
      `<meta property="og:title" content="${escapeHtml(title)}" />` +
      `<meta property="og:description" content="${escapeHtml(description)}" />` +
      `<meta property="og:type" content="website" />` +
      `<meta property="og:url" content="${escapeHtml(pageUrl)}" />` +
      `<meta property="og:image" content="${proto}://${host}/opengraph.jpg" />` +
      `<meta property="og:image:width" content="1200" />` +
      `<meta property="og:image:height" content="630" />` +
      `<meta name="twitter:card" content="summary_large_image" />` +
      `<meta name="twitter:title" content="${escapeHtml(title)}" />` +
      `<meta name="twitter:description" content="${escapeHtml(description)}" />` +
      `<meta name="twitter:image" content="${proto}://${host}/opengraph.jpg" />` +
      `<link rel="canonical" href="${escapeHtml(pageUrl)}" />` +
      `<meta name="theme-color" content="#d4af37" /></head><body>` +
      `<p>Redirecting to Bow Down Visuals…</p>` +
      `<script>window.location.replace(${JSON.stringify(`/invite/${data.code}`)});</script>` +
      `</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).send(html);
  } catch (err) {
    logger.warn({ err }, "invite OG route failed");
    next();
  }
});

/* ── Serve the frontend SPA (single-service deployment) ───────────────────
   The Vite build outputs to artifacts/bow-down-visuals/dist/public.
   When present, serve it statically and fall back to index.html for
   non-API routes so client-side routing works. /api/* is never intercepted,
   so API 404s stay JSON. */
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDist =
  process.env["FRONTEND_DIST"] ??
  path.resolve(serverDir, "../../bow-down-visuals/dist/public");

if (fs.existsSync(path.join(frontendDist, "index.html"))) {
  /* Cache policy: index.html must always revalidate (it references the
     hashed asset filenames), while Vite's hashed JS/CSS/assets are
     immutable and cacheable for a year. Without this, a browser can sit
     on a stale index.html and never pick up a new deploy. */
  app.use(
    express.static(frontendDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (/[.-][0-9a-f]{8,}\.[^.]+$/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  /* Known client-side routes (mirrors the route map in
     artifacts/bow-down-visuals/src — the SPA's router). These serve
     index.html with 200 so crawlers, link unfurlers, and uptime monitors
     see real pages. Anything else falls through to the 404 handler below,
     where the client router renders the app's own 404 page. */
  const CLIENT_ROUTES = new Set([
    "/",
    "/pricing",
    "/waitlist",
    "/beta-access",
    "/contact",
    "/terms",
    "/privacy",
    "/refund-policy",
    "/randomizer",
    "/hooks",
    "/coach",
    "/dashboard",
    "/choose-artist",
    "/my-projects",
    "/artist-vault",
    "/make-song",
    "/make-video",
    "/song-and-video",
    "/create",
    "/promo-clip",
    "/thumbnail",
    "/video-editor",
    "/credit-history",
    "/my-clips",
    "/admin",
    "/songs",
    "/login",
    "/signup",
    "/live-shopping",
  ]);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.path === "/api" || req.path.startsWith("/api/")) {
      return next();
    }
    const normalized = req.path.endsWith("/") && req.path.length > 1
      ? req.path.slice(0, -1)
      : req.path;
    const status = CLIENT_ROUTES.has(normalized) || normalized.startsWith("/invite/") ? 200 : 404;
    /* Serve index.html with 200 for known pages, 404 for unknown routes —
       the client router renders the app (or its 404 page) in both cases.
       Never cache it: it points at the hashed asset filenames. */
    res.set("Cache-Control", "no-cache");
    res.status(status).sendFile(path.join(frontendDist, "index.html"), (err) => {
      if (err) {
        next(err);
      }
    });
  });
  logger.info({ frontendDist }, "Serving frontend static files");
} else {
  logger.warn({ frontendDist }, "Frontend dist not found — serving API only");
}

/* ── 404 handler — always JSON, never HTML ── */
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

/* ── Global JSON error handler ──────────────────────────────────────────────
   Express 5 propagates uncaught async errors to this handler.
   Without it, Express's default handler returns an HTML error page.
   The 4-parameter signature is required for Express to treat this as an
   error-handling middleware. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const isProd = process.env["NODE_ENV"] === "production";
  const status = (err as { status?: number } | null)?.status;
  const type = (err as { type?: string } | null)?.type;

  /* Malformed JSON bodies arrive here as a body-parser SyntaxError — surface
     a clean 400 instead of the default 500. */
  const isJsonParseError =
    (err instanceof SyntaxError && status === 400) ||
    (status === 400 && type === "entity.parse.failed");
  if (isJsonParseError) {
    logger.warn({ err }, "[app] malformed JSON body");
    if (!res.headersSent) {
      res.status(400).json({ error: "Invalid JSON" });
    }
    return;
  }

  logger.error({ err }, "[app] unhandled route error");
  if (!res.headersSent) {
    /* Respect status codes from known error types (e.g., CreditsDisabledError). */
    const errStatus = (err as { status?: number } | null)?.status;
    const errName = err instanceof Error ? err.name : null;
    if (errStatus === 403 && errName === "CreditsDisabledError") {
      res.status(403).json({
        error: "credits_disabled",
        message: "Credit spending is temporarily disabled. Please try again later.",
      });
      return;
    }
    /* Never echo raw error text to clients in production — info disclosure. */
    res.status(500).json({
      error: isProd ? "Internal server error" : (err instanceof Error ? err.message : "Internal server error"),
    });
  }
});

export default app;
