import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
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
  const msg = err instanceof Error ? err.message : "Internal server error";
  logger.error({ err }, "[app] unhandled route error");
  if (!res.headersSent) {
    res.status(500).json({ error: msg });
  }
});

export default app;
