/**
 * chat-doors-wiring.test.ts — source pins for Tier 1 doors in the Thy
 * Cheat Code chat drawer (Cloud Operator Phase 2, Lane C).
 *
 * The contract pinned here:
 *  (a) doors arrive ONLY from the server's reply payload, parsed by
 *      the lib/chat-doors seam on success — error replies and the
 *      drawer's own canned answers never grow buttons;
 *  (b) a door is stored on the assistant message it rode in on, and
 *      the request history mapping is untouched (role + content only —
 *      doors never ride back to the server);
 *  (c) the door row renders under the assistant bubble, beside the
 *      speak control; each button follows its door with the door's
 *      EXACT path — an open door just navigates, a guide door also
 *      arms the guide-arrival starter in the seam, which is the only
 *      place "thy-tour:start" is dispatched from;
 *  (d) the existing surfaces are untouched: the mic seam, the speak
 *      button, the single /api/free-chat request, the typing path.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chat = readFileSync(new URL("./ThyCheatCodeChat.tsx", import.meta.url), "utf8");
const seam = readFileSync(new URL("../lib/chat-doors.ts", import.meta.url), "utf8");

describe("chat doors wiring — doors come from the reply payload, parsed by the seam", () => {
  it("the drawer imports the door seam and types messages with optional doors", () => {
    expect(chat).toContain('from "@/lib/chat-doors"');
    expect(chat).toContain("parseChatDoors");
    expect(chat).toContain("startGuideOnArrival");
    expect(chat).toContain("doors?: ChatDoor[]");
  });

  it("send() attaches parsed doors to the assistant reply — success path only", () => {
    expect(chat).toContain("const doors = res.ok ? parseChatDoors(data) : [];");
    expect(chat).toContain("...(doors.length ? { doors } : {})");
  });

  it("the request history mapping is unchanged — doors never ride back", () => {
    expect(chat).toContain(
      "history: history.map((m) => ({ role: m.role, content: m.content }))",
    );
    expect(chat.split('fetch("/api/free-chat"').length - 1).toBe(1);
  });
});

describe("chat doors wiring — the row under the bubble follows the door", () => {
  it("renders a button per door, only when the message carries doors", () => {
    expect(chat).toContain("m.doors && m.doors.length > 0");
    expect(chat).toContain("m.doors.map((door)");
    expect(chat).toContain("onClick={() => followDoor(door)}");
    expect(chat).toContain("{door.label}");
    /* guide doors wear the host's own walk-through iconography */
    expect(chat).toContain("Footprints");
    expect(chat).toContain("DoorOpen");
  });

  it("the door row sits under the assistant bubble, after the speak control", () => {
    const speakAt = chat.indexOf("<ChatSpeakButton");
    const doorsAt = chat.indexOf("m.doors && m.doors.length > 0");
    expect(speakAt).toBeGreaterThan(-1);
    expect(doorsAt).toBeGreaterThan(speakAt);
  });

  it("followDoor closes the drawer and navigates to the door's exact path", () => {
    const follow = chat.slice(
      chat.indexOf("const followDoor"),
      chat.indexOf("/* Voice input (lib/chat-voice transport)"),
    );
    expect(follow).toContain("setOpen(false)");
    expect(follow).toContain("navigate(door.path)");
    expect(follow).toContain('if (door.kind === "guide") startGuideOnArrival(door.path);');
  });

  it("the seam is the only dispatcher of the tour event, on arrival only", () => {
    expect(chat).not.toContain("thy-tour:start");
    expect(seam).toContain('new CustomEvent("thy-tour:start")');
    expect(seam).toContain("doorBase(window.location.pathname) === target");
    /* the tour never starts on the wrong page: giving up is silent */
    expect(seam).toContain("GUIDE_MAX_TRIES");
  });
});

describe("chat doors wiring — the existing surfaces are untouched", () => {
  it("mic, speak, and typing wiring all still stand", () => {
    expect(chat).toContain("<ChatVoiceButton");
    expect(chat).toContain("onTranscript={handleVoiceFinal}");
    expect(chat).toContain("<ChatSpeakButton");
    expect(chat).toContain('if (e.key === "Enter") send(input)');
    expect(chat).toContain('aria-label="Send message"');
  });
});
