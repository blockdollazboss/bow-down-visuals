import type { ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { NativeErrorState } from "./NativeStates";

/* ─── CreateDeskRunner — the Create Desk kit (NATIVE-PLAN §3.6) ─────
   The shared skeleton every Create Wing desk is built from:
   prompt → cost → run → poll → result. Purely presentational and
   controlled — it fetches nothing and polls nothing; the desk
   lane owns its endpoint, its polling, and its result card, and
   drives this kit through `state`. House law baked into the
   shape: the price in Visual Bucs is shown BEFORE anything runs
   (a null cost means "not priced yet" and the run stays shut). */

export type CreateDeskJobState = "idle" | "running" | "done" | "failed";

export interface CreateDeskRunnerProps {
  isLight: boolean;
  /** The desk's own words for what is being made (the prompt
   *  field's label, e.g. "Describe the song"). */
  promptLabel: string;
  prompt: string;
  onPromptChange: (value: string) => void;
  /** The price in Visual Bucs, shown before anything runs.
   *  Null = not priced yet; the Make button stays disabled. */
  costVisualBucs: number | null;
  state: CreateDeskJobState;
  /** The finished piece, rendered in-world when state is "done". */
  result?: ReactNode;
  /** Palace-language failure line for state "failed". */
  errorMessage?: string | null;
  onRun: () => void;
  runLabel?: string;
}

export function CreateDeskRunner({
  isLight,
  promptLabel,
  prompt,
  onPromptChange,
  costVisualBucs,
  state,
  result,
  errorMessage,
  onRun,
  runLabel = "Make it",
}: CreateDeskRunnerProps) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const running = state === "running";
  const canRun = !running && prompt.trim().length > 0 && costVisualBucs !== null;
  return (
    <div data-testid="world-native-create-runner" className="space-y-3">
      <label className="block">
        <span
          className={`mb-1 block text-xs font-black uppercase tracking-[0.14em] ${
            isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
          }`}
        >
          {promptLabel}
        </span>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          disabled={running}
          rows={3}
          className={`w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
            isLight
              ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
              : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
          }`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="world-native-create-cost" className={`text-xs font-semibold ${muted}`}>
          {costVisualBucs === null
            ? "Price shown before anything runs."
            : `Costs ${costVisualBucs.toLocaleString("en-US")} Visual Bucs — shown before anything runs.`}
        </span>
        <button
          type="button"
          data-testid="world-native-create-run"
          onClick={onRun}
          disabled={!canRun}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {running ? "Making it…" : runLabel}
        </button>
      </div>

      {state === "failed" && (
        <NativeErrorState
          isLight={isLight}
          title="The make didn't land"
          message={errorMessage ?? "Nothing was charged for a make that didn't finish. Try again."}
          onRetry={onRun}
        />
      )}
      {state === "done" && result ? (
        <div data-testid="world-native-create-result">{result}</div>
      ) : null}
    </div>
  );
}
