/**
 * Email campaign sender — unit tests (all DB/provider access stubbed
 * through EmailSenderDeps, mirroring the scheduler-jobs test pattern).
 *
 * Covers: campaign success, partial per-recipient failure (batch
 * survives), all-fail → honest "failed", no-provider → fail-closed,
 * per-recipient exception isolation, server-owned status transitions,
 * the welcome-sequence trigger (steps + timing), delivery skip rules,
 * and the route contract (clients can never stamp "sent").
 */
import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  drainEmailQueue,
  queueWelcomeSequence,
  welcomeStepContent,
  welcomeStepTimes,
  buildEmailHtml,
  listUnsubscribeHeaders,
  unsubscribeUrlFor,
  type EmailSenderDeps,
} from "../email-campaign-sender";
import type {
  EmailCampaign,
  EmailList,
  EmailSequenceDelivery,
  EmailSubscriber,
} from "@workspace/db";

const ANCHOR = new Date("2026-10-20T12:00:00.000Z");

function makeList(patch: Partial<EmailList> = {}): EmailList {
  return {
    id: "list-1",
    userId: "user-1",
    name: "House List",
    handle: "house",
    description: null,
    welcomeSubject: "Welcome!",
    welcomeBody: "Step one body.",
    welcome2Subject: null,
    welcome2Body: null,
    welcome3Subject: null,
    welcome3Body: null,
    createdAt: ANCHOR,
    ...patch,
  } as EmailList;
}

function makeSub(patch: Partial<EmailSubscriber> = {}): EmailSubscriber {
  return {
    id: "sub-1",
    listId: "list-1",
    email: "fan@example.com",
    name: "Fan",
    source: "landing",
    confirmed: true,
    opens: 0,
    unsubscribeToken: "tok123tok123tok123",
    unsubscribedAt: null,
    subscribedAt: ANCHOR,
    ...patch,
  } as EmailSubscriber;
}

function makeCampaign(patch: Partial<EmailCampaign> = {}): EmailCampaign {
  return {
    id: "camp-1",
    listId: "list-1",
    subject: "Big news",
    body: "Hello world.",
    kind: "campaign",
    status: "sending",
    sentAt: null,
    recipientCount: 0,
    openCount: 0,
    createdAt: ANCHOR,
    ...patch,
  } as EmailCampaign;
}

function baseDeps(over: EmailSenderDeps = {}): Required<EmailSenderDeps> {
  return {
    claimQueuedCampaigns: async () => [],
    claimDueDeliveries: async () => [],
    loadList: async () => makeList(),
    loadActiveSubscribers: async () => [makeSub()],
    loadSubscriber: async () => makeSub(),
    recordSend: async () => undefined,
    updateCampaign: async () => undefined,
    updateDelivery: async () => undefined,
    insertDelivery: async () => undefined,
    send: async () => ({ sent: true, id: "msg-1" }),
    isConfigured: () => true,
    now: () => ANCHOR,
    baseUrl: () => "https://bowdownvisuals.com",
    ...over,
  } as Required<EmailSenderDeps>;
}

describe("welcome sequence timing + templates", () => {
  it("step 1 fires on signup, step 2 at +24h, step 3 at +72h after step 2 (+96h)", () => {
    const times = welcomeStepTimes(ANCHOR);
    expect(times[1]!.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(times[2]!.toISOString()).toBe("2026-10-21T12:00:00.000Z");
    expect(times[3]!.toISOString()).toBe("2026-10-24T12:00:00.000Z");
  });

  it("templates come from the list's stored fields; missing step = null", () => {
    const list = makeList();
    expect(welcomeStepContent(list, 1)).toEqual({ subject: "Welcome!", body: "Step one body." });
    expect(welcomeStepContent(list, 2)).toBeNull();
    expect(welcomeStepContent(list, 3)).toBeNull();
  });

  it("queues only the steps the list has templates for, at the right times", async () => {
    const inserted: Array<{ step: number; scheduledFor: Date }> = [];
    const deps = baseDeps({
      insertDelivery: async (row) => {
        inserted.push({ step: row.step, scheduledFor: row.scheduledFor });
      },
    });
    const queued = await queueWelcomeSequence(makeList(), makeSub(), deps);
    expect(queued).toEqual([1]);
    expect(inserted).toEqual([{ step: 1, scheduledFor: ANCHOR }]);
  });

  it("queues all three steps when all templates exist", async () => {
    const inserted: Array<{ step: number; scheduledFor: Date }> = [];
    const deps = baseDeps({
      insertDelivery: async (row) => {
        inserted.push({ step: row.step, scheduledFor: row.scheduledFor });
      },
    });
    const list = makeList({
      welcome2Subject: "Day two",
      welcome2Body: "Body two.",
      welcome3Subject: "Day five",
      welcome3Body: "Body three.",
    });
    const queued = await queueWelcomeSequence(list, makeSub(), deps);
    expect(queued).toEqual([1, 2, 3]);
    expect(inserted.map((r) => r.scheduledFor.toISOString())).toEqual([
      "2026-10-20T12:00:00.000Z",
      "2026-10-21T12:00:00.000Z",
      "2026-10-24T12:00:00.000Z",
    ]);
  });
});

describe("campaign sending", () => {
  it("sends per-recipient, stamps sent + recipientCount, carries List-Unsubscribe", async () => {
    const updates: Array<Partial<EmailCampaign>> = [];
    const sends: Array<Record<string, unknown>> = [];
    const mail: Array<Record<string, unknown>> = [];
    const deps = baseDeps({
      claimQueuedCampaigns: async () => [makeCampaign()],
      loadActiveSubscribers: async () => [
        makeSub(),
        makeSub({ id: "sub-2", email: "two@example.com" }),
      ],
      updateCampaign: async (_id, patch) => {
        updates.push(patch);
      },
      recordSend: async (row) => {
        sends.push(row as unknown as Record<string, unknown>);
      },
      send: async (opts) => {
        mail.push(opts as unknown as Record<string, unknown>);
        return { sent: true, id: "msg-x" };
      },
    });
    const out = await drainEmailQueue(deps);
    expect(out.campaigns).toEqual({ delivered: 2, attempted: 2 });
    expect(updates).toEqual([{ status: "sent", sentAt: ANCHOR, recipientCount: 2 }]);
    expect(sends).toHaveLength(2);
    expect(sends.every((s) => s.status === "sent" && s.providerId === "msg-x")).toBe(true);
    const headers = mail[0]!["headers"] as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toContain("/api/email-list/unsubscribe/tok123tok123tok123");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(String(mail[0]!["html"])).toContain("/api/email-list/unsubscribe/tok123tok123tok123");
  });

  it("partial failure: one bad address fails its row, the batch still completes as sent", async () => {
    const updates: Array<Partial<EmailCampaign>> = [];
    const sends: Array<Record<string, unknown>> = [];
    const deps = baseDeps({
      claimQueuedCampaigns: async () => [makeCampaign()],
      loadActiveSubscribers: async () => [
        makeSub(),
        makeSub({ id: "sub-2", email: "bad@example.com" }),
      ],
      updateCampaign: async (_id, patch) => {
        updates.push(patch);
      },
      recordSend: async (row) => {
        sends.push(row as unknown as Record<string, unknown>);
      },
      send: async (opts) =>
        opts.to === "bad@example.com"
          ? { sent: false, reason: "provider-error" }
          : { sent: true, id: "msg-1" },
    });
    const out = await drainEmailQueue(deps);
    expect(out.campaigns).toEqual({ delivered: 1, attempted: 2 });
    expect(updates).toEqual([{ status: "sent", sentAt: ANCHOR, recipientCount: 1 }]);
    expect(sends.map((s) => s.status).sort()).toEqual(["failed", "sent"]);
  });

  it("a throwing recipient is isolated — recorded failed, batch continues", async () => {
    const sends: Array<Record<string, unknown>> = [];
    const deps = baseDeps({
      claimQueuedCampaigns: async () => [makeCampaign()],
      loadActiveSubscribers: async () => [
        makeSub(),
        makeSub({ id: "sub-2", email: "two@example.com" }),
      ],
      recordSend: async (row) => {
        sends.push(row as unknown as Record<string, unknown>);
      },
      send: async (opts) => {
        if (opts.to === "fan@example.com") throw new Error("boom");
        return { sent: true, id: "msg-2" };
      },
    });
    const out = await drainEmailQueue(deps);
    expect(out.campaigns.delivered).toBe(1);
    expect(sends.map((s) => s.status).sort()).toEqual(["failed", "sent"]);
  });

  it("all recipients failing marks the campaign failed — never a fake sent", async () => {
    const updates: Array<Partial<EmailCampaign>> = [];
    const deps = baseDeps({
      claimQueuedCampaigns: async () => [makeCampaign()],
      updateCampaign: async (_id, patch) => {
        updates.push(patch);
      },
      send: async () => ({ sent: false, reason: "provider-error" }),
    });
    await drainEmailQueue(deps);
    expect(updates).toEqual([{ status: "failed", recipientCount: 0 }]);
  });

  it("no provider configured fails closed: campaign failed, send never called", async () => {
    const updates: Array<Partial<EmailCampaign>> = [];
    const send = vi.fn(async () => ({ sent: true, id: "x" }));
    const deps = baseDeps({
      claimQueuedCampaigns: async () => [makeCampaign()],
      updateCampaign: async (_id, patch) => {
        updates.push(patch);
      },
      isConfigured: () => false,
      send,
    });
    await drainEmailQueue(deps);
    expect(send).not.toHaveBeenCalled();
    expect(updates).toEqual([{ status: "failed" }]);
  });

  it("an empty list completes honestly as sent with zero recipients", async () => {
    const updates: Array<Partial<EmailCampaign>> = [];
    const deps = baseDeps({
      claimQueuedCampaigns: async () => [makeCampaign()],
      loadActiveSubscribers: async () => [],
      updateCampaign: async (_id, patch) => {
        updates.push(patch);
      },
    });
    const out = await drainEmailQueue(deps);
    expect(out.campaigns).toEqual({ delivered: 0, attempted: 0 });
    expect(updates).toEqual([{ status: "sent", sentAt: ANCHOR, recipientCount: 0 }]);
  });
});

describe("welcome deliveries", () => {
  function makeDelivery(patch: Partial<EmailSequenceDelivery> = {}): EmailSequenceDelivery {
    return {
      id: "del-1",
      listId: "list-1",
      subscriberId: "sub-1",
      step: 2,
      status: "sending",
      scheduledFor: ANCHOR,
      sentAt: null,
      error: null,
      createdAt: ANCHOR,
      ...patch,
    } as EmailSequenceDelivery;
  }

  it("sends a due step from the stored template and stamps it sent", async () => {
    const updates: Array<Partial<EmailSequenceDelivery>> = [];
    const deps = baseDeps({
      claimDueDeliveries: async () => [makeDelivery()],
      loadList: async () =>
        makeList({ welcome2Subject: "Day two", welcome2Body: "Body two." }),
      updateDelivery: async (_id, patch) => {
        updates.push(patch);
      },
    });
    const out = await drainEmailQueue(deps);
    expect(out.deliveries).toBe(1);
    expect(updates).toEqual([{ status: "sent", sentAt: ANCHOR, error: null }]);
  });

  it("skips a delivery whose subscriber unsubscribed before it came due", async () => {
    const updates: Array<Partial<EmailSequenceDelivery>> = [];
    const send = vi.fn(async () => ({ sent: true, id: "x" }));
    const deps = baseDeps({
      claimDueDeliveries: async () => [makeDelivery()],
      loadList: async () => makeList({ welcome2Subject: "S", welcome2Body: "B" }),
      loadSubscriber: async () => makeSub({ unsubscribedAt: ANCHOR }),
      updateDelivery: async (_id, patch) => {
        updates.push(patch);
      },
      send,
    });
    await drainEmailQueue(deps);
    expect(send).not.toHaveBeenCalled();
    expect(updates[0]!.status).toBe("skipped");
  });

  it("skips a step the list never templated", async () => {
    const updates: Array<Partial<EmailSequenceDelivery>> = [];
    const deps = baseDeps({
      claimDueDeliveries: async () => [makeDelivery({ step: 3 })],
      updateDelivery: async (_id, patch) => {
        updates.push(patch);
      },
    });
    await drainEmailQueue(deps);
    expect(updates).toEqual([{ status: "skipped", error: "no-template" }]);
  });
});

describe("email html + headers", () => {
  it("escapes the body and always appends the unsubscribe footer", () => {
    const html = buildEmailHtml("Hi", "<script>alert(1)</script>\n\nSecond para", "https://x.test/api/email-list/unsubscribe/abc");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Second para");
    expect(html).toContain("https://x.test/api/email-list/unsubscribe/abc");
  });

  it("builds RFC 8058 one-click headers", () => {
    expect(unsubscribeUrlFor("https://x.test/", "tok")).toBe("https://x.test/api/email-list/unsubscribe/tok");
    expect(listUnsubscribeHeaders("https://x.test/u")).toEqual({
      "List-Unsubscribe": "<https://x.test/u>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("route + sender contract (source)", () => {
  const routeSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "routes", "generate", "email-list.ts"),
    "utf8",
  );
  const senderSrc = fs.readFileSync(path.join(__dirname, "..", "email-campaign-sender.ts"), "utf8");

  it("clients cannot set campaign status to sent — only draft or queued", () => {
    expect(routeSrc).toContain('z.enum(["draft", "queued"])');
    expect(routeSrc).not.toContain('z.enum(["draft", "queued", "sent"])');
  });

  it("the subscribe route triggers the welcome sequence for new subscribers", () => {
    expect(routeSrc).toContain("queueWelcomeSequence(list, subscriber)");
  });

  it("a public token unsubscribe route exists (GET page + POST one-click)", () => {
    expect(routeSrc).toContain('router.get("/email-list/unsubscribe/:token"');
    expect(routeSrc).toContain('router.post("/email-list/unsubscribe/:token"');
  });

  it("the sender never writes open-tracking numbers (opens stay honestly untracked)", () => {
    expect(senderSrc).not.toMatch(/openCount\s*[:=]/);
    expect(senderSrc).not.toMatch(/opens\s*:/);
  });
});
