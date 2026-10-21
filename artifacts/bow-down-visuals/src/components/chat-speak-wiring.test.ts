/**
 * chat-speak-wiring.test.ts — source pins for voice OUT in the Thy
 * Cheat Code chat drawer (operator voice-out; owner ruling Oct 20,
 * 2026: build his real voice, spoken replies cost a small Visual
 * Bucs price each — 100 VB, server-priced).
 *
 * The contract pinned here:
 *  (a) the toggle lives in the drawer header, is a real pressed-state
 *      toggle, and persists through the lib/chat-speak preference
 *      helpers (default OFF);
 *  (b) every assistant reply gains the ChatSpeakButton control only
 *      when the toggle is on;
 *  (c) the price the user sees comes from the server status payload
 *      (speakStatus.creditCost) — no price literal exists in the
 *      speak component, and the spend confirmation is fed the same
 *      server figure (overrideCost);
 *  (d) the not-ready honesty is wired: the casting copy rides the
 *      control and the toggle, and nothing speaks through the
 *      browser's speechSynthesis or the voiceover generation rail.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chat = readFileSync(new URL("./ThyCheatCodeChat.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("./ChatSpeakButton.tsx", import.meta.url), "utf8");
const seam = readFileSync(new URL("../lib/chat-speak.ts", import.meta.url), "utf8");

describe("chat speak wiring — the toggle", () => {
  it("the drawer header carries a pressed-state voice-out toggle", () => {
    expect(chat).toContain("aria-pressed={voiceOut}");
    expect(chat).toContain("onClick={toggleVoiceOut}");
    expect(chat).toContain("Volume2");
    expect(chat).toContain("VolumeX");
  });

  it("the preference persists through the seam helpers and starts from them", () => {
    expect(chat).toContain("useState<boolean>(() => loadChatSpeakEnabled())");
    expect(chat).toContain("saveChatSpeakEnabled(next)");
    expect(seam).toContain('CHAT_SPEAK_PREF_KEY = "bdv-chat-voice-out"');
  });

  it("readiness and price are read from the server on open", () => {
    expect(chat).toContain("fetchChatSpeakStatus()");
    expect(chat).toContain("chatSpeakView(speakStatus, speakStatusFailed)");
    expect(seam).toContain('CHAT_SPEAK_STATUS_PATH = "/api/chat/speak/status"');
    expect(seam).toContain('CHAT_SPEAK_PATH = "/api/chat/speak"');
  });
});

describe("chat speak wiring — the per-reply control", () => {
  it("assistant replies gain the speak control only when the toggle is on", () => {
    expect(chat).toContain('import { ChatSpeakButton } from "@/components/ChatSpeakButton"');
    expect(chat).toContain("{voiceOut && (");
    expect(chat).toContain("<ChatSpeakButton");
    expect(chat).toContain("text={m.content}");
    expect(chat).toContain("view={speakView}");
    expect(chat).toContain("onNote={setVoiceNote}");
  });

  it("the control's price is the server's figure, end to end", () => {
    /* drawer passes the status payload's price down */
    expect(chat).toContain("creditCost={speakStatus?.creditCost ?? 0}");
    /* the button labels itself with that figure */
    expect(button).toContain("Speak · ${creditCost} VB");
    expect(button).toContain("Try again · ${creditCost} VB");
    /* and the spend confirmation is fed the same server figure */
    expect(button).toContain("overrideCost: creditCost");
    /* no price is hardcoded anywhere in the speak component */
    expect(button).not.toContain("100");
  });

  it("a successful speak is replayable for free", () => {
    expect(button).toContain("Listen again");
    expect(button).toContain("Replay — no charge");
    expect(button).toContain("urlRef");
  });
});

describe("chat speak wiring — honesty rails", () => {
  it("the not-ready state explains itself and charges nothing", () => {
    expect(button).toContain("CHAT_SPEAK_CASTING_COPY");
    expect(button).toContain("Voice still being cast");
    expect(seam).toContain("still being cast");
    expect(seam).toContain("Nothing is charged until then");
  });

  it("failures surface the server's own message on the status line", () => {
    expect(button).toContain("chatSpeakErrorNote");
    expect(button).toContain("err instanceof Error");
    expect(seam).toContain('data["message"]');
  });

  it("nothing speaks through browser synthesis or the voiceover rail", () => {
    for (const src of [chat, button, seam]) {
      expect(src).not.toContain("speechSynthesis");
      expect(src).not.toContain('"/api/voiceover');
    }
  });

  it("the speak request carries an idempotency key per reply", () => {
    expect(button).toContain("newChatSpeakKey()");
    expect(seam).toContain("idempotencyKey");
    expect(seam).toContain("JSON.stringify({ text, idempotencyKey })");
  });
});
