/* ─── Cloud Operator Phase 2, Lane D — Tier-2 free-write handlers ────
   Free, easily-undone writes, executed through Lane A's executor as
   the caller's own session. Every handler rides its rail's EXISTING
   write path — the extracted cores in the route modules, which the
   HTTP routes themselves now call — so validation, owner scoping,
   and semantics are the rail's, not a second implementation:

     drafts.reply            → routes/social.ts      savePostReplyDraft  (migration 0160 rail)
     drafts.dm               → routes/community.ts   saveDmDraft         (migration 0157 rail)
     posts.schedule          → routes/scheduler.ts   createLegacyScheduledPost
     storyboard.save         → routes/storyboards.ts appendStoryboardPanel / createStoryboardBoard (0163)
     settings.legacy-contact → routes/trust.ts       saveLegacyContact   (migration 0166 rail)

   THE HONESTY RULE (design §4): a handler RETURNS only when the rail
   actually saved, and the reply is composed from the saved row. Any
   other outcome — bad input, unknown target, a full board, a time
   that can't be pinned — THROWS, so the executor audits the action
   `failed` with the reason and the member hears a failure, never a
   "saved" that didn't happen. NO deletes exist at this tier in v1:
   both draft rails treat an empty body as a clear (= a delete), so
   the draft handlers refuse empty bodies before ever calling the
   rail — the operator saves words, he never clears them.

   MEMBER SCOPE: every core keys its write by ctx.userId and gates on
   the caller's ownership/participation/visibility first, so there is
   no argument a member can pass that writes onto another member's
   rows — the tests prove it per tool.

   IMPORT DISCIPLINE: the rail cores are loaded LAZILY (dynamic
   import inside each handler), never at this module's top level.
   The operator registry is imported by chat/admin surfaces whose
   test suites partially mock unrelated libraries (e.g. live-ws);
   statically importing the five route modules here dragged their
   whole import graphs into every one of those suites and broke
   collection (admin-content-removal, found in Lane D's full run).
   A route module now loads only when a Tier-2 tool actually runs. */

import { db, storyboardsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import type { OperatorTool } from "./operator-tools";

type Handler = OperatorTool["handler"];

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

/** The saved words, shown back short — the member sees what landed. */
function excerpt(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function firstIssue(issues: readonly { message: string }[], fallback: string): string {
  return issues[0]?.message ?? fallback;
}

const draftsDm: Handler = async (ctx) => {
  const conversationId = strArg(ctx.args, "conversationId") ?? "";
  const body = strArg(ctx.args, "body") ?? "";
  if (!conversationId) {
    throw new Error("I need to know which message thread that draft belongs to — name the thread and I'll save it there.");
  }
  if (!body.trim()) {
    throw new Error("There's no text to save — tell me the words and I'll draft them.");
  }
  const { saveDmDraft } = await import("../routes/community");
  const outcome = await saveDmDraft(ctx.userId, conversationId, { body });
  switch (outcome.kind) {
    case "saved":
      return {
        summary: "Saved a DM reply draft",
        target: conversationId,
        replyText: `Saved as your reply draft in that thread: “${excerpt(outcome.draft.body)}” — it's waiting in your Messages whenever you're ready to send it.`,
      };
    case "not_found":
      throw new Error("I couldn't find that message thread under your account — open the thread in Messages and try me again.");
    case "invalid":
      throw new Error(outcome.message);
    case "cleared":
      /* Unreachable — the empty-body guard above refuses first — but
         if the rail ever clears, the audit must not say "saved". */
      throw new Error("That came through empty, so nothing was saved.");
  }
};

const draftsReply: Handler = async (ctx) => {
  const postId = strArg(ctx.args, "postId") ?? "";
  const body = strArg(ctx.args, "body") ?? "";
  const tone = strArg(ctx.args, "tone");
  if (!postId) {
    throw new Error("I need to know which post that reply belongs to — point me at the post and I'll save it there.");
  }
  if (!body.trim()) {
    throw new Error("There's no text to save — tell me the words and I'll draft them.");
  }
  const { savePostReplyDraft } = await import("../routes/social");
  const outcome = await savePostReplyDraft(ctx.userId, postId, {
    body,
    ...(tone !== undefined ? { tone } : {}),
  });
  switch (outcome.kind) {
    case "saved":
      return {
        summary: "Saved a post reply draft",
        target: postId,
        replyText: `Saved as your reply draft on that post: “${excerpt(outcome.draft.body)}” — you'll find it under the post whenever you're ready to send it.`,
      };
    case "invalid_id":
    case "not_found":
      throw new Error("I couldn't find that post — it may have moved or come down. Point me at it again and I'll save your draft.");
    case "invalid":
      throw new Error(firstIssue(outcome.issues, "That draft didn't pass the composer's checks — nothing was saved."));
    case "cleared":
      throw new Error("That came through empty, so nothing was saved.");
  }
};

const SCHEDULE_PLATFORMS = ["instagram", "tiktok", "facebook"] as const;

const postsSchedule: Handler = async (ctx) => {
  const content = strArg(ctx.args, "content") ?? "";
  const mediaUrl = strArg(ctx.args, "mediaUrl") ?? "";
  const platform = strArg(ctx.args, "platform") ?? "";
  const scheduledAt = strArg(ctx.args, "scheduledAt") ?? "";
  const hashtags = strArg(ctx.args, "hashtags");
  if (!content.trim()) {
    throw new Error("I need the words for the post before I can schedule it — what should it say?");
  }
  if (!mediaUrl.trim()) {
    throw new Error("I need the media for the post — give me its link and I'll put it on the schedule.");
  }
  if (!(SCHEDULE_PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error("That scheduling rail posts to Instagram, TikTok, or Facebook — tell me which one and I'll set it up.");
  }
  /* TIME PINNING: the rail accepts an exact ISO datetime and nothing
     else — there is no relative-time parser in the scheduler to ride.
     An unpinnable time refuses here and asks, rather than guessing a
     fire time (design §1, Lane D). */
  const when = new Date(scheduledAt);
  if (!scheduledAt || Number.isNaN(when.getTime())) {
    throw new Error("I couldn't pin that time down — give me an exact date and time (like 2026-10-24T17:00:00Z) and I'll schedule it.");
  }
  if (when.getTime() <= Date.now()) {
    throw new Error("That time is already past — give me a future date and time and I'll schedule it.");
  }
  const { createLegacyScheduledPost } = await import("../routes/scheduler");
  const outcome = await createLegacyScheduledPost(ctx.userId, {
    content,
    mediaUrl,
    platform,
    scheduledAt,
    ...(hashtags !== undefined ? { hashtags } : {}),
  });
  if (outcome.kind === "invalid") {
    throw new Error(firstIssue(outcome.issues, "That post didn't pass the scheduler's checks — nothing was scheduled."));
  }
  const whenText = `${when.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC`;
  return {
    summary: `Scheduled a post for ${platform} at ${when.toISOString()}`,
    target: platform,
    replyText: `Done — your post is on the schedule for ${platform} at ${whenText}: “${excerpt(content, 80)}”. That's the schedule entry created; the site's job runner does the actual posting when that time comes.`,
  };
};

const storyboardSave: Handler = async (ctx) => {
  const title = strArg(ctx.args, "title");
  const notes = strArg(ctx.args, "notes");
  const imageUrl = strArg(ctx.args, "imageUrl");
  const imagePrompt = strArg(ctx.args, "imagePrompt");
  const hasContent = [title, notes, imageUrl, imagePrompt].some(
    (v) => v !== undefined && v.trim().length > 0,
  );
  if (!hasContent) {
    throw new Error("Tell me what to put on the panel — a title, a note, an image link, or an image idea — and I'll add it.");
  }
  const { appendStoryboardPanel, createStoryboardBoard } = await import("../routes/storyboards");

  /* Board resolution, owner-scoped throughout: an explicit boardId
     wins; a boardTitle matches one of the CALLER's boards by name
     (created if they don't have it yet); otherwise the caller's
     most recently touched board, or a fresh one. A foreign boardId
     falls through to the core's ownBoard gate and comes back
     not_found — it is never written. */
  let boardId = strArg(ctx.args, "boardId");
  const boardTitle = strArg(ctx.args, "boardTitle");
  if (!boardId) {
    if (boardTitle !== undefined && boardTitle.trim().length > 0) {
      const mine = await db
        .select()
        .from(storyboardsTable)
        .where(eq(storyboardsTable.userId, ctx.userId))
        .orderBy(desc(storyboardsTable.updatedAt));
      const wanted = boardTitle.trim().toLowerCase();
      const match = mine.find((b) => b.title.trim().toLowerCase() === wanted);
      boardId = match ? match.id : (await createStoryboardBoard(ctx.userId, boardTitle)).id;
    } else {
      const [latest] = await db
        .select()
        .from(storyboardsTable)
        .where(eq(storyboardsTable.userId, ctx.userId))
        .orderBy(desc(storyboardsTable.updatedAt))
        .limit(1);
      boardId = latest ? latest.id : (await createStoryboardBoard(ctx.userId)).id;
    }
  }

  const outcome = await appendStoryboardPanel(ctx.userId, boardId, {
    ...(title !== undefined ? { title } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
    ...(imagePrompt !== undefined ? { imagePrompt } : {}),
  });
  switch (outcome.kind) {
    case "added": {
      const panelLabel = outcome.panel.title.trim()
        ? outcome.panel.title
        : excerpt(outcome.panel.notes || outcome.panel.imagePrompt || "New panel", 60);
      return {
        summary: `Added a panel to storyboard “${outcome.board.title}”`,
        target: outcome.board.id,
        replyText: `Added to your storyboard “${outcome.board.title}” — panel ${outcome.board.panels.length}: “${excerpt(panelLabel, 80)}”. It's saved in your Storyboards, ready when you are.`,
      };
    }
    case "not_found":
      throw new Error("I couldn't find that storyboard under your account — name one of yours and I'll add to it.");
    case "invalid":
      throw new Error(firstIssue(outcome.issues, "That panel didn't pass the storyboard's checks — nothing was added."));
    case "full":
      throw new Error(`That storyboard is full — it already holds ${outcome.max} panels. Start a fresh board and I'll add it there.`);
  }
};

const legacyContact: Handler = async (ctx) => {
  const name = strArg(ctx.args, "name") ?? "";
  const email = strArg(ctx.args, "email") ?? "";
  const note = strArg(ctx.args, "note");
  if (!name.trim()) {
    throw new Error("I need the person's name to save them as your legacy contact — who should it be?");
  }
  if (!email.trim()) {
    throw new Error("I need their email address too — that's how they'd be reached.");
  }
  const { saveLegacyContact } = await import("../routes/trust");
  const outcome = await saveLegacyContact(ctx.userId, {
    name,
    email,
    ...(note !== undefined ? { note } : {}),
  });
  if (outcome.kind === "invalid") {
    throw new Error(firstIssue(outcome.issues, "That contact didn't pass the settings checks — nothing was saved."));
  }
  const { contact } = outcome;
  return {
    summary: outcome.created ? "Set legacy contact" : "Updated legacy contact",
    /* No audit target: the contact's email is private, and the admin
       bench displays targets. The member's own reply carries the
       details; the audit records WHAT happened, not WHO it names. */
    target: null,
    replyText: `${outcome.created ? "Saved" : "Updated"} — your legacy contact is ${contact.name} (${contact.email}). If anything ever happens to you, they're the one who can claim your catalog. You can change this any time in Settings.`,
  };
};

export const TIER2_HANDLERS: Record<string, Handler> = {
  "drafts.dm": draftsDm,
  "drafts.reply": draftsReply,
  "posts.schedule": postsSchedule,
  "storyboard.save": storyboardSave,
  "settings.legacy-contact": legacyContact,
};
