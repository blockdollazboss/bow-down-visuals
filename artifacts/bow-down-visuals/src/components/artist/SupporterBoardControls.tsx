import { useEffect, useState } from "react";
import { Trophy, AlertTriangle, RotateCcw, Check } from "lucide-react";
import {
  fetchMySupporterSettings,
  saveMySupporterSettings,
  SUPPORTER_BOARD_COPY,
} from "@/lib/supporter-board";

/* ─── Top Supporters — creator controls (profile setup, Wave-4 #49 + N6) ─
   Docked in profile setup right under the Front Row picker: the board
   on/off switch (off hides the board everywhere, standings included)
   and the N6 perks text — the perks the creator promises their board,
   stated in the creator's OWN plain words (600-char cap, enforced
   server-side too; the house invents no perks and no prices).
   Recognition only — no charge, no Visual Bucs move through here.
   Load/save failures are honest states; a 503 from the provisional
   migration says plainly that nothing was saved. */

const PERKS_MAX = 600;

export default function SupporterBoardControls() {
  const [enabled, setEnabled] = useState(true);
  const [perksText, setPerksText] = useState("");
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const s = await fetchMySupporterSettings();
        if (!cancelled) {
          setEnabled(s.enabled);
          setPerksText(s.perksText);
          setReady(s.ready);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Your supporter board settings couldn't load — try again.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  const save = async () => {
    setSaving(true);
    setSavedMessage(null);
    setSaveError(null);
    try {
      const saved = await saveMySupporterSettings({ enabled, perksText });
      setEnabled(saved.enabled);
      setPerksText(saved.perksText);
      setSavedMessage(saved.enabled ? "Saved — your board is live on your profile." : "Saved — your board is off and hidden everywhere.");
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setSaveError(
        status === 503
          ? "Supporter recognition is almost ready — the final setup step hasn't landed yet, so nothing was saved."
          : "Couldn't save — nothing was changed. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="supporter-board-controls">
      <div className="mb-1 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-white/50">Top Supporters board</h3>
      </div>
      <p className="mb-3 text-xs text-white/40">
        Your top supporters, ranked on your profile from real support only — tips, purchases, paid
        memberships, and ticketed shows. Recognition only: nothing is charged and no Visual Bucs move.
      </p>

      {loading && <p className="text-sm text-white/40">Loading your board settings…</p>}

      {loadError && (
        <div className="flex flex-col items-start gap-2">
          <p className="inline-flex items-center gap-2 text-sm text-amber-300">
            <AlertTriangle className="h-4 w-4" /> {loadError}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {!ready && (
            <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              Supporter recognition is almost ready — the final setup step hasn't landed yet, so saving
              is paused. Your board still ranks with the default settings (on, no perks).
            </p>
          )}
          <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
            <span className="text-sm text-white">
              Show my Top Supporters board
              <span className="block text-xs text-white/40">
                Off hides the board everywhere — visitors and supporters' own standings included.
              </span>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-amber-400"
              data-testid="supporter-board-enabled"
            />
          </label>

          <label className="mb-1 block text-xs text-white/50" htmlFor="supporter-perks">
            {SUPPORTER_BOARD_COPY.perksHeading}
          </label>
          <textarea
            id="supporter-perks"
            value={perksText}
            onChange={(e) => setPerksText(e.target.value.slice(0, PERKS_MAX))}
            rows={3}
            maxLength={PERKS_MAX}
            placeholder="e.g. Front Row supporters get a shout-out on my Friday live and first word on new drops."
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
            data-testid="supporter-board-perks"
          />
          <p className="mb-3 text-right text-[11px] text-white/30">
            {perksText.length}/{PERKS_MAX} — your words, printed on the board exactly as written.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !ready}
              className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
              data-testid="supporter-board-save"
            >
              {saving ? "Saving…" : "Save board settings"}
            </button>
            {savedMessage && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
                <Check className="h-3.5 w-3.5" /> {savedMessage}
              </span>
            )}
            {saveError && <span className="text-xs font-semibold text-red-300">{saveError}</span>}
          </div>
        </>
      )}
    </div>
  );
}
