import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ListVideo, Swords } from "lucide-react";

/* ─── Creator tools on the watch page (upg-player lane) ───
   Docks the owner side of #174 Thumbnail Duels + N5 Auto Chapters onto
   the video's own page. The owner endpoints 404 for anyone who doesn't
   own the item, so this whole block renders only for the creator. */

interface ChaptersRecord {
  chapters: Array<{ title: string; startSec: number; endSec: number }>;
  summary: string;
  status: string;
}

interface DuelRecord {
  id: string;
  status: string;
  winner: string | null;
  cover_a_url: string;
  cover_b_url: string;
}

interface DuelResults {
  viewsA: number; viewsB: number; clicksA: number; clicksB: number;
  totalViews: number; totalClicks: number; targetViews: number;
  clickRateA: number; clickRateB: number;
}

export function ShowcaseVideoTools({ itemId }: { itemId: string }) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [isOwner, setIsOwner] = useState(false);
  const [chapters, setChapters] = useState<ChaptersRecord | null>(null);
  const [duel, setDuel] = useState<DuelRecord | null>(null);
  const [results, setResults] = useState<DuelResults | null>(null);
  const [busy, setBusy] = useState("");
  const [coverB, setCoverB] = useState("");
  const [targetViews, setTargetViews] = useState(100);
  const [editRows, setEditRows] = useState<Array<{ title: string; startSec: number }>>([]);
  const [editSummary, setEditSummary] = useState("");

  const authFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getAccessToken();
    if (!token) return null;
    return fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
  }, [getAccessToken]);

  const load = useCallback(async () => {
    const [cRes, dRes] = await Promise.all([
      authFetch(`/api/showcase-items/${itemId}/auto-chapters`),
      authFetch(`/api/showcase-items/${itemId}/duel`),
    ]);
    if (!cRes || cRes.status === 404) { setIsOwner(false); return; }
    setIsOwner(true);
    if (cRes.ok) {
      const d = await cRes.json().catch(() => ({}));
      setChapters(d.autoChapters ?? null);
      if (d.autoChapters) {
        setEditRows(d.autoChapters.chapters.map((c: { title: string; startSec: number }) => ({ title: c.title, startSec: c.startSec })));
        setEditSummary(d.autoChapters.summary ?? "");
      }
    }
    if (dRes?.ok) {
      const d = await dRes.json().catch(() => ({}));
      setDuel(d.duel ?? null);
      setResults(d.results ?? null);
    }
  }, [authFetch, itemId]);

  useEffect(() => { void load(); }, [load]);

  async function act(key: string, path: string, init?: RequestInit, okMsg?: string) {
    setBusy(key);
    try {
      const res = await authFetch(path, init);
      const data = await res?.json().catch(() => ({}));
      if (!res || !res.ok) throw new Error(data?.error || "Something went wrong.");
      if (okMsg) toast({ title: okMsg });
      await load();
    } catch (err) {
      toast({ title: "That didn't work", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy("");
    }
  }

  if (!isOwner) return null;

  return (
    <div className="rounded-2xl border border-[#c9a84c]/25 bg-white/[0.03] p-5 mb-8 space-y-8">
      <p className="text-xs font-bold uppercase tracking-wider text-[#e8c86a]">Creator tools</p>

      {/* ── N5 Auto Chapters ── */}
      <div>
        <p className="flex items-center gap-2 text-sm font-bold text-white mb-2">
          <ListVideo className="h-4 w-4 text-[#e8c86a]" /> Auto Chapters
        </p>
        {!chapters ? (
          <>
            <p className="text-sm text-white/50 mb-3">
              Chapters + a summary, generated from your video's own words. They start as a private
              draft — nothing shows on this page until you approve it.
            </p>
            <Button
              size="sm"
              disabled={busy === "gen"}
              onClick={() => void act("gen", `/api/showcase-items/${itemId}/auto-chapters/generate`, { method: "POST" }, "Draft chapters created")}
              className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-xs"
            >
              {busy === "gen" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}
              Generate chapters — 150 Visual Bucs
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-white/50">
              Status:{" "}
              <span className="font-bold text-white">
                {chapters.status === "approved" ? "Live on this page" : chapters.status === "off" ? "Off — hidden" : "Draft — only you can see it"}
              </span>
              {chapters.status !== "off" && " · Editing returns a live set to draft."}
            </p>
            <div className="space-y-2">
              {editRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={row.startSec}
                    onChange={(e) => setEditRows((rows) => rows.map((r, j) => (j === i ? { ...r, startSec: Number(e.target.value) || 0 } : r)))}
                    className="w-24 rounded-lg bg-white/[0.05] border border-white/10 px-2 py-1.5 text-sm text-white focus:border-[#e8c86a]/50 focus:outline-none"
                    aria-label={`Chapter ${i + 1} start (seconds)`}
                  />
                  <input
                    value={row.title}
                    maxLength={80}
                    onChange={(e) => setEditRows((rows) => rows.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)))}
                    className="flex-1 rounded-lg bg-white/[0.05] border border-white/10 px-3 py-1.5 text-sm text-white focus:border-[#e8c86a]/50 focus:outline-none"
                    aria-label={`Chapter ${i + 1} title`}
                  />
                </div>
              ))}
            </div>
            <textarea
              value={editSummary}
              maxLength={600}
              rows={2}
              onChange={(e) => setEditSummary(e.target.value)}
              placeholder="Watch-page summary"
              className="w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none resize-none"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy === "save"} onClick={() => void act("save", `/api/showcase-items/${itemId}/auto-chapters`, { method: "PATCH", body: JSON.stringify({ chapters: editRows, summary: editSummary }) }, "Edits saved")} className="border-white/15 text-white/70 text-xs">
                {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save edits"}
              </Button>
              {chapters.status === "draft" && (
                <Button size="sm" disabled={busy === "approve"} onClick={() => void act("approve", `/api/showcase-items/${itemId}/auto-chapters/approve`, { method: "POST" }, "Chapters are live")} className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-xs">
                  Approve — show on this page
                </Button>
              )}
              {chapters.status === "approved" && (
                <Button size="sm" variant="outline" disabled={busy === "off"} onClick={() => void act("off", `/api/showcase-items/${itemId}/auto-chapters/off`, { method: "POST" }, "Chapters hidden")} className="border-white/15 text-white/70 text-xs">
                  Turn off
                </Button>
              )}
              {chapters.status === "off" && (
                <Button size="sm" variant="outline" disabled={busy === "on"} onClick={() => void act("on", `/api/showcase-items/${itemId}/auto-chapters/on`, { method: "POST" }, "Back to draft — approve to show")} className="border-white/15 text-white/70 text-xs">
                  Turn back on
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy === "gen"} onClick={() => void act("gen", `/api/showcase-items/${itemId}/auto-chapters/generate`, { method: "POST" }, "Fresh draft created")} className="text-white/50 text-xs">
                Regenerate — 150 Visual Bucs
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── #174 Thumbnail Duel ── */}
      <div>
        <p className="flex items-center gap-2 text-sm font-bold text-white mb-2">
          <Swords className="h-4 w-4 text-[#e8c86a]" /> Thumbnail Duel
        </p>
        {!duel || duel.status === "cancelled" ? (
          <div className="space-y-3">
            <p className="text-sm text-white/50">
              Pit your current cover (A) against a challenger (B). The showcase serves both in
              rotation and counts real views and clicks — the winner takes over as your thumbnail
              automatically.
            </p>
            <input
              value={coverB}
              onChange={(e) => setCoverB(e.target.value)}
              placeholder="Challenger cover image URL (cover B)"
              maxLength={2048}
              className="w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <label className="text-xs text-white/50">
                Views before a winner can be called{" "}
                <input
                  type="number"
                  min={20}
                  max={10000}
                  value={targetViews}
                  onChange={(e) => setTargetViews(Number(e.target.value) || 100)}
                  className="ml-1 w-24 rounded-lg bg-white/[0.05] border border-white/10 px-2 py-1.5 text-sm text-white focus:border-[#e8c86a]/50 focus:outline-none"
                />
              </label>
              <Button
                size="sm"
                disabled={busy === "duel" || !coverB.trim()}
                onClick={() => void act("duel", `/api/showcase-items/${itemId}/duel`, { method: "POST", body: JSON.stringify({ coverBUrl: coverB.trim(), targetViews }) }, "Duel started")}
                className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-xs"
              >
                {busy === "duel" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}
                Start duel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-white/50">
              Status: <span className="font-bold text-white">{duel.status === "running" ? "Running" : `Resolved — cover ${(duel.winner ?? "").toUpperCase()} won and is now your thumbnail`}</span>
            </p>
            {results && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/10 p-3">
                  <p className="text-xs font-bold text-white/50 mb-1">COVER A {duel.winner === "a" ? "👑" : ""}</p>
                  <p className="text-white">{results.viewsA} views · {results.clicksA} clicks</p>
                  <p className="text-white/40 text-xs">{results.clickRateA}% click rate</p>
                </div>
                <div className="rounded-xl border border-white/10 p-3">
                  <p className="text-xs font-bold text-white/50 mb-1">COVER B {duel.winner === "b" ? "👑" : ""}</p>
                  <p className="text-white">{results.viewsB} views · {results.clicksB} clicks</p>
                  <p className="text-white/40 text-xs">{results.clickRateB}% click rate</p>
                </div>
              </div>
            )}
            {results && duel.status === "running" && (
              <p className="text-xs text-white/40">{results.totalViews} of {results.targetViews} views counted so far.</p>
            )}
            {duel.status === "running" && (
              <Button size="sm" variant="outline" disabled={busy === "cancel"} onClick={() => void act("cancel", `/api/showcase-items/${itemId}/duel/cancel`, { method: "POST" }, "Duel cancelled")} className="border-white/15 text-white/70 text-xs">
                Cancel duel
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
