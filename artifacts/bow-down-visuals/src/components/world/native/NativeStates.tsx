import { AlertTriangle, Loader2 } from "lucide-react";

/* ─── Native honest states (NATIVE-PLAN §3.0) ───────────────────────
   Loading, empty, and failed states for native surfaces, in palace
   language with a retry — the standard the custom panels already
   set (PanelBoundary's "This desk wouldn't open in the palace",
   the Treasury's "The vault ledger wouldn't open"). A native lane
   renders these instead of a spinner div or a silent blank: the
   walker is always told what happened and what still stands. */

export function NativeLoadingState({
  isLight,
  message = "Opening the desk…",
}: {
  isLight: boolean;
  message?: string;
}) {
  return (
    <p
      data-testid="world-native-loading"
      className={`inline-flex items-center gap-2 px-1 py-3 text-sm ${
        isLight ? "text-[#6B5B36]" : "text-white/55"
      }`}
    >
      <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {message}
    </p>
  );
}

export function NativeEmptyState({
  isLight,
  message,
  detail,
}: {
  isLight: boolean;
  message: string;
  detail?: string;
}) {
  return (
    <div data-testid="world-native-empty" className="px-1 py-3">
      <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>{message}</p>
      {detail ? (
        <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>{detail}</p>
      ) : null}
    </div>
  );
}

export function NativeErrorState({
  isLight,
  title = "This desk wouldn't open in the palace",
  message,
  onRetry,
}: {
  isLight: boolean;
  title?: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      data-testid="world-native-error"
      className="flex flex-col items-start gap-2 px-1 py-3"
    >
      <p
        className={`inline-flex items-center gap-2 text-sm font-bold ${
          isLight ? "text-[#2a1e07]" : "text-white"
        }`}
      >
        <AlertTriangle className="h-4 w-4 text-[#d4af37]" /> {title}
      </p>
      <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
      >
        Try again
      </button>
    </div>
  );
}
