import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { stripeWebhookHandler } from "./lib/stripe-webhook";

const app: Express = express();

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
app.use(cors());

// Stripe webhook MUST be registered before express.json() so the raw Buffer body is preserved.
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

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
  app.use(express.static(frontendDist));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.path === "/api" || req.path.startsWith("/api/")) {
      return next();
    }
    /* Unknown client-side route — serve index.html with 404 so crawlers and
       HTTP clients see "not found" while the client router still renders the
       app (e.g. a 404 page) in the browser. Prerendered routes are served by
       express.static with 200 and never reach this handler. */
    res.status(404).sendFile(path.join(frontendDist, "index.html"), (err) => {
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
    /* Never echo raw error text to clients in production — info disclosure. */
    res.status(500).json({
      error: isProd ? "Internal server error" : (err instanceof Error ? err.message : "Internal server error"),
    });
  }
});

export default app;
