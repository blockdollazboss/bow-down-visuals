/**
 * chat-speak-bench-components — Stack 400 world parity
 * (census B-08) source-contract pins. The bench must stack
 * at the My Studio board (the in-World Thy/operator surface)
 * as an ({ isLight }) bench, read readiness + price from the
 * server's status, run the speak through the confirmed spend
 * seam with the SERVER's figure (charged only when it
 * plays), reuse the drawer's seam whole (status view,
 * playback coordinator, per-intent key), and branch its
 * surfaces on isLight with the NativeStates trio wired.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/ChatSpeakBench.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the bench shape + the My Studio board mount", () => {
  it("is a named ({ isLight }) bench rooted at its testid", () => {
    expect(bench).toContain("export function ChatSpeakBench({ isLight }: { isLight: boolean })");
    expect(bench).toContain('data-testid="world-chat-speak-bench"');
  });

  it("StationPanel stacks it at the my-studio board behind a DeskDoor", () => {
    expect(panel).toContain('const ChatSpeakBench = lazy(() => import("@/components/world/native/ChatSpeakBench")');
    expect(panel).toContain("<ChatSpeakBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:chat-speak`}');
  });
});

describe("charged only when it plays — the confirmed seam at the server's figure", () => {
  it("the price comes from the status read, never a client constant", () => {
    expect(bench).toContain("fetchChatSpeakStatus");
    expect(bench).toContain("const cost = status?.creditCost ?? 0;");
    expect(bench).toContain("overrideCost: cost");
  });

  it("the speak runs the drawer's request through confirmedFetch", () => {
    expect(bench).toContain("requestChatSpeak(speakFetch, text.trim(), keyRef.current)");
    expect(bench).toContain("overrideFeature: WORLD_SPEAK_FEATURE");
    expect(bench).toContain("confirmedFetch(input, {");
  });

  it("one key per intent — a new text resets key and cached audio", () => {
    expect(bench).toContain("newChatSpeakKey()");
    expect(bench).toContain("keyRef.current = null;");
    expect(bench).toContain("urlRef.current = null;");
  });

  it("a successful speak plays through the one-voice coordinator; replay is local", () => {
    expect(bench).toContain("playChatSpeakAudio(url)");
    expect(bench).toContain("if (urlRef.current) {");
    expect(bench).toContain("speakOutcomeOf(result)");
  });
});

describe("the honest states — casting is words, not a dead control", () => {
  it("the casting branch shows the drawer's own copy and no speak button", () => {
    expect(bench).toContain('data-testid="world-chat-speak-casting"');
    expect(bench).toContain("CHAT_SPEAK_CASTING_COPY");
    expect(bench).toContain('view === "casting"');
  });

  it("the view verdict is the drawer's own, and the trio is wired", () => {
    expect(bench).toContain("chatSpeakView(status, statusFailed)");
    expect(bench).toContain("NativeLoadingState");
    expect(bench).toContain("NativeErrorState");
    expect(bench).toContain("CHAT_SPEAK_UNAVAILABLE_COPY");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
    expect(bench).toContain('isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"');
  });
});
