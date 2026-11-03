/**
 * DjDesk — the My Studio board's native DJ Set Prep desk
 * (stack1500 world parity wave #3, census item 29).
 *
 * Your set, prepped without leaving the World: read your songs'
 * tempo and key (free — the analyzer runs on our side), pack
 * them into crates, let the harmonic orderer propose a blending
 * set order with its transition notes, take the order or keep
 * yours, and export the crate to Rekordbox XML or M3U for the
 * booth.
 *
 * Every rail is free (the analyze registry row is cost 0), so
 * the desk rides plain authed fetches like the website page.
 * States stay honest: an unanalyzed track says so (never zeros),
 * a failed analysis names the track, an empty crate can't
 * export (the rail refuses and the desk says why first).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DJ_ANALYZE_PATH,
  DJ_CRATES_PATH,
  DJ_LIBRARY_PATH,
  analysisLine,
  analyzeOutcomesOf,
  applyAnalyzeOutcomes,
  buildAnalyzePayload,
  chunkSongIds,
  crateOfResponse,
  crateSongIds,
  cratesOfResponse,
  djCratePath,
  djExportPath,
  djProposePath,
  durationLabel,
  libraryOfResponse,
  moved,
  proposalOfResponse,
  withAdded,
  withoutId,
  type DjCrate,
  type DjExportFormat,
  type DjLibraryTrack,
  type DjProposal,
} from "@/lib/world/dj-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

export function DjDesk({ isLight }: { isLight: boolean }) {
  const deskHeaders = useDeskAuthHeaders();
  const [tracks, setTracks] = useState<DjLibraryTrack[] | null>(null);
  const [crates, setCrates] = useState<DjCrate[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [analyzing, setAnalyzing] = useState<ReadonlySet<string>>(new Set());
  const [analyzeNote, setAnalyzeNote] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newCrateName, setNewCrateName] = useState("");
  const [crateBusy, setCrateBusy] = useState(false);
  const [crateError, setCrateError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DjProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const headers = await deskHeaders();
      const [libRes, crateRes] = await Promise.all([
        fetch(DJ_LIBRARY_PATH, { headers }),
        fetch(DJ_CRATES_PATH, { headers }),
      ]);
      if (!libRes.ok || !crateRes.ok) throw new Error("load failed");
      const lib = libraryOfResponse(await libRes.json().catch(() => ({})));
      const list = cratesOfResponse(await crateRes.json().catch(() => ({})));
      if (!lib || !list) throw new Error("load failed");
      setTracks(lib);
      setCrates(list);
    } catch {
      setLoadFailed(true);
    }
  }, [deskHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => crates?.find((c) => c.id === selectedId) ?? crates?.[0] ?? null,
    [crates, selectedId],
  );
  const unanalyzed = useMemo(() => (tracks ?? []).filter((t) => !t.analysis), [tracks]);
  const titleById = useMemo(
    () => new Map((tracks ?? []).map((t) => [t.id, t.title])),
    [tracks],
  );

  async function analyze(ids: string[], force = false) {
    if (ids.length === 0) return;
    setAnalyzeNote(null);
    setAnalyzing((prev) => new Set([...prev, ...ids]));
    try {
      const headers = await deskHeaders();
      const failedTitles: string[] = [];
      for (const chunk of chunkSongIds(ids)) {
        const res = await fetch(DJ_ANALYZE_PATH, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(buildAnalyzePayload(chunk, force)),
        });
        if (!res.ok) throw new Error("analyze failed");
        const outcomes = analyzeOutcomesOf(await res.json().catch(() => ({})));
        if (!outcomes) throw new Error("analyze failed");
        for (const o of outcomes) {
          if (o.status === "failed") failedTitles.push(titleById.get(o.songId) ?? "A track");
        }
        setTracks((prev) => (prev ? applyAnalyzeOutcomes(prev, outcomes) : prev));
      }
      if (failedTitles.length > 0) {
        setAnalyzeNote(`Could not analyze: ${failedTitles.join(", ")}. The rest landed fine.`);
      }
    } catch {
      setAnalyzeNote("The analyzer didn't answer. Your tracks are unchanged — try again in a moment.");
    } finally {
      setAnalyzing((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }

  async function patchCrate(crateId: string, body: { name?: string; songIds?: string[] }) {
    const headers = await deskHeaders();
    const res = await fetch(djCratePath(crateId), {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("save failed");
    const crate = crateOfResponse(await res.json().catch(() => ({})));
    if (!crate) throw new Error("save failed");
    setCrates((prev) => (prev ?? []).map((c) => (c.id === crate.id ? crate : c)));
    return crate;
  }

  async function createCrate() {
    const name = newCrateName.trim();
    if (!name || crateBusy) return;
    setCrateBusy(true);
    setCrateError(null);
    try {
      const headers = await deskHeaders();
      const res = await fetch(DJ_CRATES_PATH, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("create failed");
      const crate = crateOfResponse(await res.json().catch(() => ({})));
      if (!crate) throw new Error("create failed");
      setCrates((prev) => [...(prev ?? []), crate]);
      setSelectedId(crate.id);
      setNewCrateName("");
    } catch {
      setCrateError("The crate couldn't be made. Try again in a moment.");
    } finally {
      setCrateBusy(false);
    }
  }

  async function mutateSelected(songIds: string[]) {
    if (!selected || crateBusy) return;
    setCrateBusy(true);
    setCrateError(null);
    try {
      await patchCrate(selected.id, { songIds });
      setProposal(null);
    } catch {
      setCrateError("That change didn't save — the crate is unchanged. Try again in a moment.");
    } finally {
      setCrateBusy(false);
    }
  }

  async function propose() {
    if (!selected || proposing) return;
    setProposing(true);
    setCrateError(null);
    try {
      const headers = await deskHeaders();
      const res = await fetch(djProposePath(selected.id), { method: "POST", headers });
      if (!res.ok) throw new Error("propose failed");
      const next = proposalOfResponse(await res.json().catch(() => ({})));
      if (!next) throw new Error("propose failed");
      setProposal(next);
    } catch {
      setCrateError("An order couldn't be worked out. Try again in a moment.");
    } finally {
      setProposing(false);
    }
  }

  async function deleteSelected() {
    if (!selected || crateBusy) return;
    setCrateBusy(true);
    setCrateError(null);
    try {
      const headers = await deskHeaders();
      const res = await fetch(djCratePath(selected.id), { method: "DELETE", headers });
      if (!res.ok) throw new Error("delete failed");
      setCrates((prev) => (prev ?? []).filter((c) => c.id !== selected.id));
      setSelectedId(null);
      setProposal(null);
      setConfirmingDelete(false);
    } catch {
      setCrateError("The crate couldn't be deleted. Try again in a moment.");
    } finally {
      setCrateBusy(false);
    }
  }

  async function exportCrate(format: DjExportFormat) {
    if (!selected || selected.tracks.length === 0) return;
    setCrateError(null);
    try {
      const headers = await deskHeaders();
      const res = await fetch(djExportPath(selected.id, format), { headers });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = format === "rekordbox" ? "crate.rekordbox.xml" : "crate.m3u";
      a.click();
      URL.revokeObjectURL(href);
    } catch {
      setCrateError("The export didn't land. Try again in a moment.");
    }
  }

  if (loadFailed) {
    return (
      <div className="space-y-3" data-testid="world-dj-desk">
        <p className={`text-base font-black ${strong}`}>DJ Set Prep</p>
        <p className={errCls} data-testid="world-dj-desk-failed">
          Your tracks wouldn&rsquo;t load. Give it another shot.
        </p>
        <button type="button" className={chipCls(false)} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="world-dj-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>DJ Set Prep</p>
        <p className={`text-xs ${muted}`}>
          Tempo + key on your own songs, crates that blend, exports for the booth — all free.
        </p>
      </div>

      {/* ── Library ─────────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-bold ${strong}`}>Your tracks</p>
          {unanalyzed.length > 0 ? (
            <button
              type="button"
              data-testid="world-dj-desk-analyze-all"
              className={`ml-auto ${chipCls(false)}`}
              disabled={analyzing.size > 0}
              onClick={() => void analyze(unanalyzed.map((t) => t.id))}
            >
              Analyze all new ({unanalyzed.length})
            </button>
          ) : null}
        </div>
        {tracks === null ? (
          <p className={`mt-2 text-sm ${muted}`}>Loading your library…</p>
        ) : tracks.length === 0 ? (
          <p className={`mt-2 text-sm ${muted}`} data-testid="world-dj-desk-empty">
            No songs yet — make one at the Song Desk in the Create Wing and it lands here ready to
            prep.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {tracks.map((track) => {
              const inCrate = selected ? crateSongIds(selected).includes(track.id) : false;
              return (
                <li
                  key={track.id}
                  className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${cardCls}`}
                >
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-bold ${strong}`}>{track.title}</p>
                    <p className={`text-xs ${muted}`}>
                      {analysisLine(track.analysis)}
                      {durationLabel(track.durationSec) ? ` · ${durationLabel(track.durationSec)}` : ""}
                    </p>
                  </div>
                  <span className="ml-auto flex gap-1.5">
                    {!track.analysis ? (
                      <button
                        type="button"
                        data-testid={`world-dj-desk-analyze-${track.id}`}
                        className={chipCls(false)}
                        disabled={analyzing.has(track.id)}
                        onClick={() => void analyze([track.id])}
                      >
                        {analyzing.has(track.id) ? "Analyzing…" : "Analyze"}
                      </button>
                    ) : null}
                    {selected ? (
                      <button
                        type="button"
                        data-testid={`world-dj-desk-add-${track.id}`}
                        className={chipCls(inCrate)}
                        disabled={inCrate || crateBusy}
                        onClick={() => void mutateSelected(withAdded(crateSongIds(selected), track.id))}
                      >
                        {inCrate ? "In the crate" : `Add to ${selected.name}`}
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {analyzeNote ? <p className={`mt-2 ${errCls}`}>{analyzeNote}</p> : null}
      </section>

      {/* ── Crates ──────────────────────────────────────────────── */}
      <section>
        <p className={`text-sm font-bold ${strong}`}>Your crates</p>
        <div className="mt-2 flex gap-2">
          <input
            data-testid="world-dj-desk-crate-name"
            className={inputCls}
            value={newCrateName}
            maxLength={80}
            onChange={(e) => setNewCrateName(e.target.value)}
            placeholder="Name a new crate — Friday headline set…"
          />
          <button
            type="button"
            data-testid="world-dj-desk-crate-create"
            className={goldBtn}
            disabled={crateBusy || !newCrateName.trim()}
            onClick={() => void createCrate()}
          >
            Create
          </button>
        </div>
        {crates && crates.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Crates">
            {crates.map((crate) => (
              <button
                key={crate.id}
                type="button"
                role="tab"
                aria-selected={selected?.id === crate.id}
                data-testid={`world-dj-desk-crate-${crate.id}`}
                className={chipCls(selected?.id === crate.id)}
                onClick={() => {
                  setSelectedId(crate.id);
                  setProposal(null);
                  setConfirmingDelete(false);
                }}
              >
                {crate.name} ({crate.tracks.length})
              </button>
            ))}
          </div>
        ) : crates !== null ? (
          <p className={`mt-2 text-sm ${muted}`}>No crates yet — name your first one above.</p>
        ) : null}
        {crateError ? <p className={`mt-2 ${errCls}`}>{crateError}</p> : null}

        {selected ? (
          <div className={`mt-3 rounded-xl border p-3 ${cardCls}`} data-testid="world-dj-desk-crate-detail">
            <div className="flex flex-wrap items-center gap-2">
              <p className={`text-sm font-bold ${strong}`}>{selected.name}</p>
              <span className={`text-xs ${muted}`}>{selected.tracks.length} tracks</span>
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  data-testid="world-dj-desk-propose"
                  className={chipCls(false)}
                  disabled={proposing || selected.tracks.length < 2}
                  onClick={() => void propose()}
                >
                  {proposing ? "Working…" : "Propose my order"}
                </button>
                <button
                  type="button"
                  data-testid="world-dj-desk-export-rekordbox"
                  className={chipCls(false)}
                  disabled={selected.tracks.length === 0}
                  onClick={() => void exportCrate("rekordbox")}
                >
                  Rekordbox XML
                </button>
                <button
                  type="button"
                  data-testid="world-dj-desk-export-m3u"
                  className={chipCls(false)}
                  disabled={selected.tracks.length === 0}
                  onClick={() => void exportCrate("m3u")}
                >
                  M3U
                </button>
                <button
                  type="button"
                  data-testid="world-dj-desk-delete"
                  className={chipCls(confirmingDelete)}
                  aria-pressed={confirmingDelete}
                  disabled={crateBusy}
                  onClick={() => {
                    if (confirmingDelete) void deleteSelected();
                    else setConfirmingDelete(true);
                  }}
                >
                  {confirmingDelete ? "Tap again to delete" : "Delete crate"}
                </button>
              </span>
            </div>

            {selected.tracks.length === 0 ? (
              <p className={`mt-2 text-sm ${muted}`}>
                This crate is empty — add tracks from your library above. An empty crate can&rsquo;t
                be ordered or exported.
              </p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {selected.tracks.map((track, i) => {
                  const ids = crateSongIds(selected);
                  return (
                    <li
                      key={track.songId}
                      className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5"
                    >
                      <span className={`text-xs font-black ${muted}`}>{i + 1}</span>
                      <span className={`text-sm font-bold ${strong}`}>{track.title}</span>
                      <span className={`text-xs ${muted}`}>
                        {track.bpm !== null ? `${Math.round(track.bpm)} BPM` : ""}
                        {track.camelot ? ` · ${track.camelot}` : ""}
                        {track.keyLabel ? ` (${track.keyLabel})` : ""}
                        {track.bpm === null && !track.camelot ? "Not analyzed yet" : ""}
                      </span>
                      <span className="ml-auto flex gap-1.5">
                        <button
                          type="button"
                          aria-label={`Move ${track.title} up`}
                          className={chipCls(false)}
                          disabled={crateBusy || i === 0}
                          onClick={() => void mutateSelected(moved(ids, i, -1))}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${track.title} down`}
                          className={chipCls(false)}
                          disabled={crateBusy || i === ids.length - 1}
                          onClick={() => void mutateSelected(moved(ids, i, 1))}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          data-testid={`world-dj-desk-remove-${track.songId}`}
                          className={chipCls(false)}
                          disabled={crateBusy}
                          onClick={() => void mutateSelected(withoutId(ids, track.songId))}
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            {proposal ? (
              <div className={`mt-3 rounded-xl border p-3 ${cardCls}`} data-testid="world-dj-desk-proposal">
                <p className={`text-sm font-bold ${strong}`}>The order that blends</p>
                <ol className="mt-1.5 space-y-1">
                  {proposal.order.map((songId, i) => {
                    const handoff = proposal.transitions.find((t) => t.fromSongId === songId);
                    return (
                      <li key={songId} className={`text-sm ${muted}`}>
                        <span className={`font-bold ${strong}`}>{i + 1}. {titleById.get(songId) ?? "Track"}</span>
                        {handoff && handoff.note ? <span> — blends out: {handoff.note}</span> : null}
                      </li>
                    );
                  })}
                </ol>
                {proposal.unanalyzed.length > 0 ? (
                  <p className={`mt-2 text-xs ${muted}`}>
                    {proposal.unanalyzed.length} track(s) have no tempo or key yet — they were
                    placed by what is known. Analyze them and propose again for a tighter blend.
                  </p>
                ) : null}
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    data-testid="world-dj-desk-apply-proposal"
                    className={goldBtn}
                    disabled={crateBusy}
                    onClick={() => void mutateSelected(proposal.order)}
                  >
                    Use this order
                  </button>
                  <button
                    type="button"
                    className={chipCls(false)}
                    onClick={() => setProposal(null)}
                  >
                    Keep mine
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
