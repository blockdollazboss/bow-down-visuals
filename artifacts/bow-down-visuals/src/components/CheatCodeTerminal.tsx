import { useEffect, useRef, useState } from "react";
import { X, Terminal, ChevronRight } from "lucide-react";

/**
 * Hidden cheat-code terminal easter egg for the sign-in page.
 * Trigger: type the Konami code (↑↑↓↓←→←→BA) or type "cheatcode" anywhere on the page.
 * Pure fun — grants nothing real, just Thy Cheat Code flavor.
 */

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
const WORD_TRIGGER = "cheatcode";

const RESPONSES: Record<string, string[]> = {
  help: [
    "Available codes:",
    "  BOWDOWN -- show respect",
    "  SHARK -- summon the King",
    "  CREDITS -- nice try",
    "  THRONE -- claim your seat",
    "  HELP -- this list",
  ],
  bowdown: ["*the Shark King nods approvingly*", "You know the drill. Now sign in, creator."],
  shark: ["THY CHEAT CODE HAS ENTERED THE CHAT", "The King Shark sees all. Especially your drafts."],
  credits: ["Nice try.", "Credits are earned, creator --", "not typed into a terminal at 2am.", "(Respect the hustle though.)"],
  throne: ["The throne is already yours.", "You just have to sign in to sit in it."],
};

function lookup(code: string): string[] {
  const key = code.trim().toLowerCase();
  if (!key) return [];
  if (RESPONSES[key]) return RESPONSES[key];
  return [`"${code.trim()}" -- unknown code.`, 'Type HELP for the list. The King is judging you.'];
}

export function CheatCodeTerminal({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([
    "THY CHEAT CODE TERMINAL v1.0",
    "Hidden entry unlocked.",
    'Type HELP and hit enter.',
    "",
  ]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = input;
    if (!code.trim()) return;
    setLines((prev) => [...prev, `> ${code}`, ...lookup(code), ""]);
    setInput("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-none border-4 border-yellow-500 bg-black overflow-hidden"
        style={{ boxShadow: "8px 8px 0 rgba(0,0,0,0.8), 0 0 40px rgba(234,179,8,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b-4 border-yellow-500/40 bg-yellow-500/10">
          <div className="flex items-center gap-2 text-yellow-400">
            <Terminal className="h-4 w-4" />
            <span className="pixel-display text-[10px] tracking-widest">CHEAT CODE ENTRY</span>
          </div>
          <button onClick={onClose} className="text-yellow-500/60 hover:text-yellow-400 transition-colors" aria-label="Close terminal">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="h-72 overflow-y-auto px-4 py-3 pixel-display text-[10px] leading-[1.8]">
          {lines.map((line, i) => (
            <div key={i} className={line.startsWith(">") ? "text-yellow-300" : "text-yellow-100/80"}>
              {line === "" ? "\u00A0" : line}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={submit} className="flex items-center gap-2 px-4 py-3 border-t-4 border-yellow-500/40 bg-yellow-500/10">
          <ChevronRight className="h-4 w-4 text-yellow-400 shrink-0" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="enter code..."
            className="flex-1 bg-transparent pixel-display text-[10px] text-yellow-100 placeholder:text-yellow-500/30 outline-none"
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
          />
        </form>
      </div>
    </div>
  );
}

/** Hook: listens for Konami code or typing "cheatcode" to unlock the terminal. */
export function useCheatCodeUnlock(onUnlock: () => void) {
  const seqRef = useRef<string[]>([]);
  const wordRef = useRef("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      /* Don't hijack typing inside real inputs — except allow the word trigger when not in a field. */
      const inField = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      seqRef.current = [...seqRef.current, key].slice(-KONAMI.length);
      if (seqRef.current.join(",") === KONAMI.join(",")) {
        seqRef.current = [];
        wordRef.current = "";
        onUnlock();
        return;
      }

      if (!inField && e.key.length === 1) {
        wordRef.current = (wordRef.current + e.key.toLowerCase()).slice(-WORD_TRIGGER.length);
        if (wordRef.current === WORD_TRIGGER) {
          wordRef.current = "";
          seqRef.current = [];
          onUnlock();
        }
      } else if (inField) {
        wordRef.current = "";
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onUnlock]);
}
