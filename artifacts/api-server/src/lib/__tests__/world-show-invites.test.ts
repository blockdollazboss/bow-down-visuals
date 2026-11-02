/**
 * Unit pins for invite-to-a-show's pure half (lib/world-show-invites,
 * stack1300 Ring 3.8):
 *  - the show's standing is judged from its own row: scheduled or
 *    live with the window still open stands; cancelled and over
 *    are their own words, never one lumped refusal;
 *  - the create decider's order is the room invites' order: the
 *    pick, then the door (a show missing OR not the caller's is
 *    one closed 404), then self, then membership, then the show's
 *    standing, then the standing rows;
 *  - the respond decider: only the invitee, only while pending;
 *    an accept needs the show to still stand (a cancelled or
 *    finished show closes the invite), a decline is always the
 *    invitee's to give;
 *  - the DTO carries the show's identity (event id, title, kind,
 *    room, window) off the row itself;
 *  - both bells ride the social category through the one event
 *    door, and a failing ping never fails the invite.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SHOW_INVITE_ACCEPTED,
  SHOW_INVITE_PENDING,
  __setShowInviteEventNotifier,
  buildShowInviteAcceptedEvent,
  buildShowInviteEvent,
  decideShowInviteCreate,
  decideShowInviteRespond,
  notifyShowInviteAccepted,
  notifyShowInviteCreated,
  showInviteDto,
  showKindLabel,
  showStandingFor,
} from "../world-show-invites";

const HOST = "00000000-0000-4000-8000-0000000000a1";
const MEMBER = "00000000-0000-4000-8000-0000000000b2";
const STRANGER = "00000000-0000-4000-8000-0000000000e5";
const NOW = new Date("2026-11-06T18:00:00.000Z");
const FUTURE = new Date("2026-11-06T20:00:00.000Z");
const PAST = new Date("2026-11-06T16:00:00.000Z");

const standingEvent = { hostUserId: HOST, status: "scheduled", endsAt: FUTURE };
const memberProfile = { userId: MEMBER, displayName: "Member Mel" };

function createInput(over: Record<string, unknown> = {}) {
  return {
    event: standingEvent,
    callerUserId: HOST,
    inviteeUserId: MEMBER,
    inviteeProfile: memberProfile,
    existingPending: false,
    existingAccepted: false,
    now: NOW,
    ...over,
  } as Parameters<typeof decideShowInviteCreate>[0];
}

describe("showStandingFor", () => {
  it("a scheduled show whose window is still open stands", () => {
    expect(showStandingFor({ status: "scheduled", endsAt: FUTURE }, NOW)).toBe("standing");
  });
  it("a live show stands — it is the one a friend should be summoned to", () => {
    expect(showStandingFor({ status: "live", endsAt: FUTURE }, NOW)).toBe("standing");
  });
  it("a cancelled show reads cancelled, in its own word", () => {
    expect(showStandingFor({ status: "cancelled", endsAt: FUTURE }, NOW)).toBe("cancelled");
  });
  it("a done show is over; a window already closed is over; no row is over", () => {
    expect(showStandingFor({ status: "done", endsAt: FUTURE }, NOW)).toBe("over");
    expect(showStandingFor({ status: "scheduled", endsAt: PAST }, NOW)).toBe("over");
    expect(showStandingFor(null, NOW)).toBe("over");
  });
});

describe("decideShowInviteCreate", () => {
  it("a clean pick by the host for a standing show is ok", () => {
    expect(decideShowInviteCreate(createInput())).toEqual({ ok: true });
  });
  it("an unnamed pick refuses first — before the door is even checked", () => {
    const d = decideShowInviteCreate(createInput({ inviteeUserId: "  ", event: null }));
    expect(d).toMatchObject({ ok: false, status: 400 });
  });
  it("a missing show and somebody else's show are the same closed 404", () => {
    expect(decideShowInviteCreate(createInput({ event: null }))).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(
      decideShowInviteCreate(createInput({ callerUserId: STRANGER })),
    ).toMatchObject({ ok: false, status: 404 });
  });
  it("the door closes before the show's standing is spoken of", () => {
    const d = decideShowInviteCreate(
      createInput({
        callerUserId: STRANGER,
        event: { hostUserId: HOST, status: "cancelled", endsAt: FUTURE },
      }),
    );
    expect(d).toMatchObject({ ok: false, status: 404 });
  });
  it("inviting yourself refuses in plain words", () => {
    const d = decideShowInviteCreate(createInput({ inviteeUserId: HOST }));
    expect(d).toMatchObject({ ok: false, status: 400 });
    if (!d.ok) expect(d.error).toContain("your own show");
  });
  it("a non-member pick refuses — an invite names a member", () => {
    const d = decideShowInviteCreate(createInput({ inviteeProfile: null }));
    expect(d).toMatchObject({ ok: false, status: 404 });
    if (!d.ok) expect(d.error).toContain("isn't a member");
  });
  it("a cancelled show and an over show refuse in their own words", () => {
    const cancelled = decideShowInviteCreate(
      createInput({ event: { hostUserId: HOST, status: "cancelled", endsAt: FUTURE } }),
    );
    expect(cancelled).toMatchObject({ ok: false, status: 409 });
    if (!cancelled.ok) expect(cancelled.error).toContain("cancelled");
    const over = decideShowInviteCreate(
      createInput({ event: { hostUserId: HOST, status: "done", endsAt: FUTURE } }),
    );
    expect(over).toMatchObject({ ok: false, status: 409 });
    if (!over.ok) expect(over.error).toContain("over");
  });
  it("an accepted member is already coming; a pending invite is already out", () => {
    const accepted = decideShowInviteCreate(createInput({ existingAccepted: true }));
    expect(accepted).toMatchObject({ ok: false, status: 409 });
    if (!accepted.ok) expect(accepted.error).toContain("already coming");
    const pending = decideShowInviteCreate(createInput({ existingPending: true }));
    expect(pending).toMatchObject({ ok: false, status: 409 });
    if (!pending.ok) expect(pending.error).toContain("already out");
  });
});

describe("decideShowInviteRespond", () => {
  const invite = { inviteeUserId: MEMBER, status: "pending" };
  const respond = (over: Record<string, unknown> = {}) =>
    decideShowInviteRespond({
      invite,
      callerUserId: MEMBER,
      answer: SHOW_INVITE_ACCEPTED,
      eventStanding: "standing",
      ...over,
    } as Parameters<typeof decideShowInviteRespond>[0]);

  it("the invitee may accept a standing show, and may always decline", () => {
    expect(respond()).toEqual({ ok: true });
    expect(respond({ answer: "declined", eventStanding: "cancelled" })).toEqual({ ok: true });
    expect(respond({ answer: "declined", eventStanding: "over" })).toEqual({ ok: true });
  });
  it("somebody else's invite — or a missing one — is a closed 404", () => {
    expect(respond({ callerUserId: STRANGER })).toMatchObject({ ok: false, status: 404 });
    expect(respond({ invite: null })).toMatchObject({ ok: false, status: 404 });
  });
  it("an answered invite has nothing left to decide", () => {
    expect(
      respond({ invite: { inviteeUserId: MEMBER, status: "accepted" } }),
    ).toMatchObject({ ok: false, status: 409 });
  });
  it("accepting a cancelled or finished show refuses — the invite closed with it", () => {
    const cancelled = respond({ eventStanding: "cancelled" });
    expect(cancelled).toMatchObject({ ok: false, status: 409 });
    if (!cancelled.ok) expect(cancelled.error).toContain("cancelled");
    const over = respond({ eventStanding: "over" });
    expect(over).toMatchObject({ ok: false, status: 409 });
    if (!over.ok) expect(over.error).toContain("over");
  });
});

describe("showInviteDto", () => {
  const row = {
    id: "invite-1",
    eventId: "event-9",
    eventTitle: "Big Night",
    eventKind: "stage_show",
    roomId: "world:kings-hall",
    startsAt: new Date("2026-11-06T19:00:00.000Z"),
    endsAt: FUTURE,
    inviterUserId: HOST,
    inviteeUserId: MEMBER,
    status: "pending",
    createdAt: NOW,
    respondedAt: null,
  };
  it("carries the show's identity off the row — the right show id, kind, room and window", () => {
    const dto = showInviteDto(row, { displayName: "Host Harriet", avatarUrl: null });
    expect(dto).toMatchObject({
      id: "invite-1",
      eventId: "event-9",
      eventTitle: "Big Night",
      eventKind: "stage_show",
      roomId: "world:kings-hall",
      startsAt: "2026-11-06T19:00:00.000Z",
      endsAt: FUTURE.toISOString(),
      hostName: "Host Harriet",
      status: SHOW_INVITE_PENDING,
      respondedAt: null,
    });
  });
  it("a host profile gone away reads as a plain creator — never a fabricated name", () => {
    expect(showInviteDto(row, null).hostName).toBe("A creator");
  });
  it("an unknown status reads as still-waiting, never as an answer nobody gave", () => {
    expect(showInviteDto({ ...row, status: "??" }, null).status).toBe(SHOW_INVITE_PENDING);
    expect(showInviteDto({ ...row, status: "accepted" }, null).status).toBe(SHOW_INVITE_ACCEPTED);
  });
});

describe("the bells", () => {
  afterEach(() => __setShowInviteEventNotifier(null));

  it("the invite bell names the host, the show, its kind and its room, under social", () => {
    const ev = buildShowInviteEvent({
      inviteeUserId: MEMBER,
      inviterName: "Host Harriet",
      eventTitle: "Big Night",
      eventKind: "stage_show",
      roomLabel: "the Throne Hall",
    });
    expect(ev.userId).toBe(MEMBER);
    expect(ev.category).toBe("social");
    expect(ev.kind).toBe("show_invite");
    expect(ev.title).toContain("Host Harriet");
    expect(ev.title).toContain("Big Night");
    expect(ev.body).toContain("A stage show");
    expect(ev.body).toContain("the Throne Hall");
    expect(ev.link).toBe("/world");
  });
  it("the accepted bell tells the host, naming the show", () => {
    const ev = buildShowInviteAcceptedEvent({
      inviterUserId: HOST,
      inviteeName: "Member Mel",
      eventTitle: "Big Night",
    });
    expect(ev.userId).toBe(HOST);
    expect(ev.category).toBe("social");
    expect(ev.kind).toBe("show_invite_accepted");
    expect(ev.title).toContain("Member Mel");
    expect(ev.title).toContain("Big Night");
  });
  it("kind labels speak the calendar's words, with an honest default", () => {
    expect(showKindLabel("listening_party")).toBe("A listening party");
    expect(showKindLabel("office_hours")).toBe("Office hours");
    expect(showKindLabel("something-new")).toBe("A palace show");
  });
  it("the notify wrappers deliver through the seam — and a failing ping never fails the invite", async () => {
    const seen: unknown[] = [];
    __setShowInviteEventNotifier(async (input) => {
      seen.push(input);
    });
    await notifyShowInviteCreated({
      inviteeUserId: MEMBER,
      inviterName: "Host Harriet",
      eventTitle: "Big Night",
      eventKind: "stage_show",
      roomLabel: "the Throne Hall",
    });
    await notifyShowInviteAccepted({
      inviterUserId: HOST,
      inviteeName: "Member Mel",
      eventTitle: "Big Night",
    });
    expect(seen).toHaveLength(2);
    __setShowInviteEventNotifier(async () => {
      throw new Error("push is down");
    });
    await expect(
      notifyShowInviteCreated({
        inviteeUserId: MEMBER,
        inviterName: "Host Harriet",
        eventTitle: "Big Night",
        eventKind: "stage_show",
        roomLabel: "the Throne Hall",
      }),
    ).resolves.toBeUndefined();
  });
});
