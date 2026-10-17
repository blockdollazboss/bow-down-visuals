import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Library, Loader2, Music2, RefreshCw } from "lucide-react";
import {
  fetchLibrarySongFile,
  fetchLibrarySongs,
  formatSongDuration,
  type LibrarySong,
} from "@/lib/song-library";

/* ─── Library song picker — Audio Studio's way back into the library ──────
   Sits beside a tool's upload zone (linkage fix, audit DE-6): instead of
   re-uploading a track they already own, the creator picks one of their
   library songs; the song's audio is fetched into a File for the zone's
   normal intake, and onPick also hands back the song so the caller can
   pass its id as sourceSongId — the finished output then lands in the
   library chained to the song it came from. */

interface LibrarySongPickerProps {
  getAccessToken: () => Promise<string | null>;
  onPick: (song: LibrarySong, file: File) => void;
  /** Button copy override (the mix panel adds stems, not a single input). */
  buttonLabel?: string;
  testId?: string;
}

export function LibrarySongPicker({ getAccessToken, onPick, buttonLabel, testId }: LibrarySongPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState<LibrarySong[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setSongs(await fetchLibrarySongs(getAccessToken));
    } catch {
      setSongs(null);
      setError(t("audioStudio.library.loadFailed", { defaultValue: "Couldn't load your song library — try again." }));
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && songs === null && !error) void load();
    if (next && error) void load();
  }

  async function pick(song: LibrarySong) {
    setPickingId(song.id);
    setPickError(null);
    try {
      const file = await fetchLibrarySongFile(song);
      onPick(song, file);
      setOpen(false);
    } catch {
      setPickError(t("audioStudio.library.pickFailed", { defaultValue: "Couldn't fetch that song's audio — try again or upload the file instead." }));
    } finally {
      setPickingId(null);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void toggle()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/60 transition hover:border-primary/50 hover:text-primary"
        data-testid={testId ?? "library-song-picker-toggle"}
      >
        <Library className="h-3.5 w-3.5" />
        {buttonLabel ?? t("audioStudio.library.pick", { defaultValue: "Pick from my song library" })}
      </button>
      {open && (
        <div className="mt-3 rounded-2xl border border-white/10 p-3">
          {error && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-1 font-bold text-white">
                <RefreshCw className="h-3 w-3" /> {t("audioStudio.library.retry", { defaultValue: "Retry" })}
              </button>
            </div>
          )}
          {!error && songs === null && (
            <p className="flex items-center gap-2 text-xs text-white/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("audioStudio.library.loading", { defaultValue: "Loading your library…" })}
            </p>
          )}
          {songs !== null && songs.length === 0 && (
            <p className="text-xs text-white/40">
              {t("audioStudio.library.empty", { defaultValue: "No songs in your library yet — finished studio work and generated songs land here." })}
            </p>
          )}
          {songs !== null && songs.length > 0 && (
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {songs.map((song) => {
                const duration = formatSongDuration(song.durationSec);
                return (
                  <button
                    key={song.id}
                    type="button"
                    disabled={pickingId !== null}
                    onClick={() => void pick(song)}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] px-3 py-2 text-left transition hover:border-primary/40 disabled:opacity-50"
                    data-testid={`library-song-${song.id}`}
                  >
                    {pickingId === song.id
                      ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      : <Music2 className="h-4 w-4 shrink-0 text-primary/70" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{song.title}</span>
                      <span className="block text-[11px] text-white/35">
                        {[song.source, duration].filter(Boolean).join(" · ") || " "}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {pickError && <p className="mt-2 text-xs text-red-300">{pickError}</p>}
        </div>
      )}
    </div>
  );
}
