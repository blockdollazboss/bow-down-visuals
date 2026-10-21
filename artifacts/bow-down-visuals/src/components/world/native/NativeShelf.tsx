import type { ReactNode } from "react";
import { ListMusic } from "lucide-react";

/* ─── NativeShelf — the Shelf pattern (NATIVE-PLAN §3.2) ────────────
   Your media, on a shelf, playable where you stand. A shelf is a
   stack of rows; each row carries artwork, a title, a detail line,
   and its actions in the action slot (Play it here, Put it on the
   jukebox, Share — the lane decides). The shelf owns the row
   ground; the lane owns the data and the player hand-off. */

export function NativeShelf({ children }: { children: ReactNode }) {
  return (
    <div data-testid="world-native-shelf" className="space-y-1.5">
      {children}
    </div>
  );
}

export interface NativeShelfRowProps {
  isLight: boolean;
  title: string;
  detail?: string;
  artworkUrl?: string | null;
  action?: ReactNode;
}

export function NativeShelfRow({ isLight, title, detail, artworkUrl, action }: NativeShelfRowProps) {
  return (
    <div
      data-testid="world-native-shelf-row"
      className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
        isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
      }`}
    >
      {artworkUrl ? (
        <img src={artworkUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#d4af37]/15">
          <ListMusic className="h-5 w-5 text-[#d4af37]" />
        </span>
      )}
      <span className="min-w-0">
        <span
          className={`block truncate text-sm font-black ${
            isLight ? "text-[#2a1e07]" : "text-white"
          }`}
        >
          {title}
        </span>
        {detail ? (
          <span
            className={`block truncate text-xs ${
              isLight ? "text-[#6B5B36]" : "text-white/50"
            }`}
          >
            {detail}
          </span>
        ) : null}
      </span>
      {action ? <span className="ml-auto inline-flex gap-1.5">{action}</span> : null}
    </div>
  );
}
