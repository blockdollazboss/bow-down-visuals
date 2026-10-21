/**
 * Public email tracking endpoints (migration 0188), mounted at
 * /api/email-track. No auth — these are hit by mail clients and
 * browsers from inside a delivered email — so they are deliberately
 * narrow:
 *
 *   GET  /o/:token.gif   tracking pixel. Records an open when the
 *                        token resolves to a delivery; ALWAYS serves
 *                        the GIF (an unknown token must never break
 *                        an email render).
 *   GET  /c/:token       click redirect. The token resolves to a
 *                        link row whose target URL was stored at send
 *                        time — the request carries no destination,
 *                        so this can never be an open redirect.
 *                        Records the click, then 302s.
 *   GET  /u/:token       unsubscribe confirmation page.
 *   POST /u/:token       one-click unsubscribe (also the target of
 *                        List-Unsubscribe-Post). Suppression is
 *                        absolute: the address is excluded from every
 *                        future audience, segment or not.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  emailCampaignDeliveriesTable,
  emailCampaignLinksTable,
  emailCampaignsTable,
  emailSubscribersTable,
} from "@workspace/db";
import { TRACKING_PIXEL_GIF, recordEngagement } from "../lib/email-tracking";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(publicApiLimiter);

async function campaignListId(campaignId: string): Promise<string | null> {
  const [row] = await db
    .select({ listId: emailCampaignsTable.listId })
    .from(emailCampaignsTable)
    .where(eq(emailCampaignsTable.id, campaignId))
    .limit(1);
  return row?.listId ?? null;
}

async function deliveryByToken(token: string) {
  const [row] = await db
    .select()
    .from(emailCampaignDeliveriesTable)
    .where(eq(emailCampaignDeliveriesTable.token, token))
    .limit(1);
  return row ?? null;
}

router.get("/o/:token", async (req: Request, res: Response) => {
  const token = String(req.params["token"] ?? "").replace(/\.gif$/i, "");
  try {
    const delivery = await deliveryByToken(token);
    if (delivery) {
      const listId = await campaignListId(delivery.campaignId);
      if (listId) {
        await recordEngagement({
          deliveryId: delivery.id,
          campaignId: delivery.campaignId,
          subscriberId: delivery.subscriberId,
          listId,
          kind: "open",
          source: "pixel",
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "[email-track] pixel record failed");
  }
  res.set({
    "Content-Type": "image/gif",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.send(TRACKING_PIXEL_GIF);
});

router.get("/c/:token", async (req: Request, res: Response) => {
  const token = String(req.params["token"] ?? "");
  const [link] = await db
    .select()
    .from(emailCampaignLinksTable)
    .where(eq(emailCampaignLinksTable.token, token))
    .limit(1);
  if (!link) {
    res.status(404).send("Link not found.");
    return;
  }
  try {
    const [delivery] = await db
      .select()
      .from(emailCampaignDeliveriesTable)
      .where(eq(emailCampaignDeliveriesTable.id, link.deliveryId))
      .limit(1);
    if (delivery) {
      const listId = await campaignListId(delivery.campaignId);
      if (listId) {
        await recordEngagement({
          deliveryId: delivery.id,
          campaignId: delivery.campaignId,
          subscriberId: delivery.subscriberId,
          listId,
          kind: "click",
          linkId: link.id,
          source: "redirect",
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "[email-track] click record failed");
  }
  res.redirect(302, link.targetUrl);
});

function unsubPage(title: string, body: string, formToken?: string): string {
  const form = formToken
    ? `<form method="POST" action="/api/email-track/u/${formToken}"><button type="submit" style="background:#d4af37;color:#111;border:0;padding:12px 22px;border-radius:8px;font-weight:700;cursor:pointer;">Unsubscribe me</button></form>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} — Bow Down Visuals</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0c0a08;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="max-width:420px;text-align:center;padding:24px;"><h1 style="font-size:22px;">${title}</h1><p style="color:#bbb;line-height:1.5;">${body}</p>${form}</div></body></html>`;
}

router.get("/u/:token", async (req: Request, res: Response) => {
  const delivery = await deliveryByToken(String(req.params["token"] ?? ""));
  if (!delivery) {
    res.status(404).send(unsubPage("Link not found", "This unsubscribe link doesn't match any email we sent."));
    return;
  }
  res.send(unsubPage("Unsubscribe?", "One click and this creator's list will never email this address again — no segment, no campaign, no exception.", delivery.token));
});

async function doUnsubscribe(req: Request, res: Response) {
  const delivery = await deliveryByToken(String(req.params["token"] ?? ""));
  if (!delivery) {
    res.status(404).send(unsubPage("Link not found", "This unsubscribe link doesn't match any email we sent."));
    return;
  }
  await db
    .update(emailSubscribersTable)
    .set({ unsubscribedAt: new Date() })
    .where(and(eq(emailSubscribersTable.id, delivery.subscriberId), isNull(emailSubscribersTable.unsubscribedAt)));
  res.send(unsubPage("You're unsubscribed", "Done. This address will not receive another email from this list."));
}

router.post("/u/:token", doUnsubscribe);

export default router;
