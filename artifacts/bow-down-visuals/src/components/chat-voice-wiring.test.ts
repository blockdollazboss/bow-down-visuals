/**
 * chat-voice-wiring.test.ts — source pins for voice input in the Thy
 * Cheat Code chat drawer (Stack-4, operator voice transport).
 *
 * The contract pinned here:
 *  (a) the mic in the chat input row is ChatVoiceButton (lib/chat-voice
 *      seam) — the old silent-failure VoiceInputButton is no longer
 *      wired into the chat surface;
 *  (b) a finished transcript is sent through the SAME send() the typed
 *      path uses — the drawer still contains exactly one chat request
 *      (POST /api/free-chat with the unchanged {message, history}
 *      payload), so a spoken message is byte-identical to a typed one;
 *  (c) the typing path is untouched (same input, same Enter handler);
 *  (d) the BROWSER transport makes NO network calls of its own; the
 *      only network call the seam can ever make is the server fallback
 *      (wave-2 #9) — POST /api/chat/voice/transcribe, which is FREE
 *      (CHAT_VOICE_TRANSCRIBE_CREDITS = 0) and fires only where the
 *      browser recognizer is absent. The charged song-file rail
 *      (/api/transcribe) is never touched, and no credit code rides
 *      along with a voice message on either transport;
 *  (e) voice OUT is wired ONLY through its own rail: the per-reply
 *      ChatSpeakButton → POST /api/chat/speak (see
 *      chat-speak-wiring.test.ts). No browser speech synthesis and no
 *      call to the charged voiceover rail anywhere in the chat
 *      surface.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chat = readFileSync(new URL("./ThyCheatCodeChat.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("./ChatVoiceButton.tsx", import.meta.url), "utf8");
const seam = readFileSync(new URL("../lib/chat-voice.ts", import.meta.url), "utf8");

describe("chat voice wiring — the mic is in the chat surface", () => {
  it("the drawer renders ChatVoiceButton in the input row, wired to the voice handlers", () => {
    expect(chat).toContain('import { ChatVoiceButton } from "@/components/ChatVoiceButton"');
    expect(chat).toContain("<ChatVoiceButton");
    expect(chat).toContain("onTranscript={handleVoiceFinal}");
    expect(chat).toContain("onInterim={handleVoiceInterim}");
    expect(chat).toContain("onNoteChange={setVoiceNote}");
    expect(chat).toContain("disabled={loading}");
  });

  it("the old silent-failure VoiceInputButton is no longer wired into the chat", () => {
    expect(chat).not.toContain("VoiceInputButton");
  });

  it("the button drives the lib/chat-voice seam and shows every state", () => {
    expect(button).toContain("createChatVoiceSession");
    expect(button).toContain('from "@/lib/chat-voice"');
    /* listening / transcribing / idle iconography + honest labels */
    expect(button).toContain("MicOff");
    expect(button).toContain("Loader2");
    expect(button).toContain("Stop listening");
    expect(button).toContain("Voice input — speak your message");
    /* unsupported browsers get an explanation, not a vanishing mic */
    expect(button).toContain('setError("unsupported")');
  });
});

describe("chat voice wiring — spoken == typed, byte-identical request path", () => {
  it("the finished transcript goes through the same send() as typing", () => {
    const finalHandler = chat.slice(
      chat.indexOf("const handleVoiceFinal"),
      chat.indexOf("/* Event bus:"),
    );
    expect(finalHandler).toContain("send(text)");
    /* a reply in flight never swallows the transcript — it waits in the box */
    expect(finalHandler).toContain("if (loading)");
    expect(finalHandler).toContain("setInput(text)");
  });

  it("the drawer still makes exactly one chat request, with the unchanged payload", () => {
    expect(chat.split('fetch("/api/free-chat"').length - 1).toBe(1);
    expect(chat).toContain("message: trimmed");
    expect(chat).toContain(
      "history: history.map((m) => ({ role: m.role, content: m.content }))",
    );
  });

  it("the typing path is untouched", () => {
    expect(chat).toContain('if (e.key === "Enter") send(input)');
    expect(chat).toContain('aria-label="Chat message"');
    expect(chat).toContain('aria-label="Send message"');
    expect(chat).toContain("onClick={() => send(input)}");
  });

  it("the voice status line renders under the input bar", () => {
    expect(chat).toContain('role="status"');
    expect(chat).toContain("voiceNote.text");
  });
});

describe("chat voice wiring — no charges on the mic seam", () => {
  it("the seam's only endpoint is the FREE fallback; the charged song rail is never touched", () => {
    expect(seam).toContain('CHAT_VOICE_TRANSCRIBE_PATH = "/api/chat/voice/transcribe"');
    expect(seam).toContain("CHAT_VOICE_TRANSCRIBE_CREDITS = 0");
    expect(seam).not.toContain("chargeCredits");
    expect(seam).not.toContain('"/api/transcribe"');
    expect(seam).toContain("SpeechRecognition");
    /* browser-first: the recognizer is decided before the fallback */
    expect(seam.indexOf("getChatVoiceRecognitionCtor")).toBeLessThan(
      seam.indexOf("createServerChatVoiceSession"),
    );
  });

  it("the button wires the fallback fetch with the spend confirmation explicitly skipped", () => {
    expect(button).toContain("skipConfirm: true");
    expect(button).toContain("fetchImpl: transcribeFetch");
  });

  it("the mic button carries no speaker control — voice-out is the sibling ChatSpeakButton", () => {
    expect(button).not.toContain("Volume2");
    expect(chat).toContain("<ChatSpeakButton");
    for (const src of [chat, button, seam]) {
      expect(src).not.toContain("speechSynthesis");
      expect(src).not.toContain('"/api/voiceover');
    }
  });
});
