import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck, Gift, Loader2, Music4, Play, Stamp, AlertTriangle, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisualBucsIcon } from "@/components/VisualBucsIcon";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Your Own Tag (#159 delta) ─────────────────────────────────────────
   The lifecycle that turns a one-off tag download into THE creator's
   signature tag: make a free draft (spoken, from the studio form above,
   or the two-second sonic logo), listen, then approve it by ear. The
   first approval is the house gift; later replacements cost the tag
   price. The approved tag sounds on the creator's profile and stamps
   their video exports automatically (toggleable). */

interface TagRow {
  id: string;
  kind: "spoken" | "sonic";
  text: string | null;
  voice: string | null;
  preset: string | null;
  format: string;
  audioUrl: string | null;
  status: string;
  stampEnabled: boolean;
  priceCharged: number;
  createdAt: string;
  approvedAt: string | null;
}

interface MineResponse {
  active: TagRow | null;
  drafts: TagRow[];
  stampEnabled: boolean;
  giftAvailable: boolean;
  price: number;
}

interface DraftResponse {
  tag?: TagRow;
  previewUrl?: string;
  priceToApprove?: number;
  error?: string;
}

interface ApproveResponse {
  tag?: TagRow;
  priceCharged?: number;
  giftApplied?: boolean;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

export function YourOwnTag(props: {
  text: string;
  voice: string;
  preset: string;
  format: "mp3" | "wav";
}) {
  const { refreshProfile, getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [mine, setMine] = useState<MineResponse | null>(null);
  const [kind, setKind] = useState<"spoken" | "sonic">("spoken");
  const [drafting, setDrafting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/producer-tag/mine", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setMine((await res.json()) as MineResponse);
    } catch {
      /* section is additive — failing to load leaves the studio as-is */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  async function makeDraft() {
    if (drafting) return;
    if (kind === "spoken" && !props.text.trim()) {
      setError("Write your tag text in the studio above first — the draft speaks those words.");
      return;
    }
    setDrafting(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/producer-tag/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          kind,
          text: props.text.trim() || undefined,
          voice: props.voice,
          preset: props.preset,
          format: props.format,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as DraftResponse;
      if (!res.ok || !data.tag) {
        setError(data.error || "The draft couldn't be made. Nothing was charged — drafts are free.");
        return;
      }
      setNotice("Draft ready — give it a listen below, then approve it by ear.");
      await loadMine();
    } catch {
      setError("Network hiccup — the draft wasn't made.");
    } finally {
      setDrafting(false);
    }
  }

  async function approve(tag: TagRow) {
    if (approvingId) return;
    setApprovingId(tag.id);
    setError(null);
    setNotice(null);
    try {
      const res = await confirmedFetch("/api/producer-tag/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId: tag.id }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as ApproveResponse;
      if (!res.ok || !data.tag) {
        setError(data.message || data.error || "Approval didn't go through.");
        return;
      }
      setNotice(
        data.giftApplied
          ? "That's your tag now — on the house. 🎁 It sounds on your profile and stamps your exports."
          : "That's your tag now. It sounds on your profile and stamps your exports.",
      );
      refreshProfile();
      await loadMine();
    } catch {
      setError("Network hiccup — approval didn't go through.");
    } finally {
      setApprovingId(null);
    }
  }

  async function toggleStamp(next: boolean) {
    if (toggling) return;
    setToggling(true);
    setError(null);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/producer-tag/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ stampEnabled: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "The toggle didn't save.");
        return;
      }
      await loadMine();
    } catch {
      setError("Network hiccup — the toggle didn't save.");
    } finally {
      setToggling(false);
    }
  }

  const approveCost = (tag: TagRow) =>
    mine?.giftAvailable ? 0 : (mine?.price ?? 100);

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.07] to-transparent p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center">
          <BadgeCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-white font-bold text-lg leading-tight">Your Own Tag</h3>
          <p className="text-white/50 text-sm">
            One signature tag that sounds on your profile and stamps every export.
          </p>
        </div>
      </div>

      {mine?.giftAvailable && (
        <p className="text-sm text-primary bg-primary/10 border border-primary/25 rounded-xl px-4 py-3 flex items-start gap-2">
          <Gift className="w-4 h-4 mt-0.5 shrink-0" />
          Your first tag is the house gift — approve it free. Replacements later cost{" "}
          {(mine?.price ?? 100).toLocaleString("en-US")} Visual Bucs.
        </p>
      )}

      {/* ── Active tag ── */}
      {mine?.active ? (
        <div className="rounded-xl bg-black/40 border border-primary/30 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-white font-bold truncate">
              {mine.active.kind === "sonic" ? "Your sonic logo" : `“${mine.active.text ?? "Your tag"}”`}
            </p>
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary shrink-0">
              {mine.active.kind === "sonic" ? "Sonic · 2s" : "Spoken tag"}
            </span>
          </div>
          {mine.active.audioUrl && <audio src={mine.active.audioUrl} controls className="w-full" />}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2.5 cursor-pointer">
            <span className="flex items-center gap-2 text-sm text-white/80">
              <Stamp className="w-4 h-4 text-primary" />
              Stamp my tag onto video exports
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={mine.stampEnabled}
              disabled={toggling}
              onClick={() => void toggleStamp(!mine.stampEnabled)}
              className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ${
                mine.stampEnabled ? "bg-primary" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                  mine.stampEnabled ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </label>
          <p className="text-xs text-white/40">
            It plays on your public profile, right under your name — and when stamping is on,
            exports open with it.
          </p>
        </div>
      ) : (
        <p className="text-sm text-white/50">
          No tag yet. Make a draft, listen to it, and approve the one that sounds like you.
        </p>
      )}

      {/* ── New draft ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 p-1 rounded-xl bg-white/[0.04] border border-white/10">
          <button
            type="button"
            onClick={() => setKind("spoken")}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
              kind === "spoken" ? "bg-primary text-black" : "text-white/60 hover:text-white"
            }`}
          >
            <Play className="w-3.5 h-3.5" /> Spoken tag
          </button>
          <button
            type="button"
            onClick={() => setKind("sonic")}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
              kind === "sonic" ? "bg-primary text-black" : "text-white/60 hover:text-white"
            }`}
          >
            <Music4 className="w-3.5 h-3.5" /> Sonic logo · 2s
          </button>
        </div>
        <Button
          onClick={() => void makeDraft()}
          disabled={drafting}
          className="h-10 rounded-xl bg-primary text-black font-bold hover:bg-primary/90 disabled:opacity-50"
        >
          {drafting ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Making draft…</>
          ) : (
            <>Audition a draft — free</>
          )}
        </Button>
        <span className="text-xs text-white/40">
          {kind === "sonic"
            ? "A two-second musical logo in the house sound — no words."
            : "Uses the words, voice and flavor set in the studio above."}
        </span>
      </div>

      {/* ── Drafts awaiting the ear ── */}
      {mine && mine.drafts.length > 0 && (
        <div className="space-y-2">
          <p className="text-white/70 text-sm font-semibold">Drafts — approve by ear</p>
          {mine.drafts.map((tag) => (
            <div key={tag.id} className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-white text-sm font-semibold truncate">
                  {tag.kind === "sonic" ? "Sonic logo draft" : `“${tag.text ?? "Tag draft"}”`}
                </p>
                <span className="text-[11px] text-white/40 shrink-0">
                  {new Date(tag.createdAt).toLocaleDateString()}
                </span>
              </div>
              {tag.audioUrl && <audio src={tag.audioUrl} controls className="w-full" />}
              <Button
                onClick={() => void approve(tag)}
                disabled={approvingId !== null}
                className="w-full h-10 rounded-xl bg-primary text-black font-bold hover:bg-primary/90 disabled:opacity-50"
              >
                {approvingId === tag.id ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Approving…</>
                ) : approveCost(tag) === 0 ? (
                  <><Gift className="w-4 h-4 mr-2" /> Make it my tag — free (house gift)</>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" /> Make it my tag —{" "}
                    {approveCost(tag).toLocaleString("en-US")} <VisualBucsIcon className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      {notice && (
        <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
