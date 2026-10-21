import { useEffect, useState } from "react";
import {
  GitBranch, Loader2, AlertTriangle, ChevronDown, ChevronUp,
  Plus, Trash2, Crown, ArrowRight, X,
} from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Wave 9A — Remix Chain (free version bookkeeping) ─────────────────────
   Dedup note: this is NOT SongReworkPanel (paid remix / section-replace
   regeneration — that flow creates new audio). Remix Chain is the free
   organizational layer on top: it registers the outputs of those paid flows
   (or uploads) as named versions in a tree (v1 → v2 → v3 branches), lets the
   creator label/note them, A/B compare any two, and promote one to master.
   Covers/mashups in the library already link by parent_song_id; this panel
   adds explicit version labels, notes, and the master promotion concept that
   the library cards don't have. */

export interface SongVersion {
  id: string;
  song_id: string | null;
  parent_version_id: string | null;
  label: string;
  notes: string;
  audio_url: string;
  promoted: boolean;
  created_at: string;
}

interface RemixChainProps {
  songId: string;
  songTitle: string;
  songAudioUrl: string;
}

interface StructureHandoff {
  structureId: string;
  name: string;
  songId: string | null;
}

export function RemixChain({ songId, songTitle, songAudioUrl }: RemixChainProps) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();

  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<SongVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [parentId, setParentId] = useState("");
  const [notes, setNotes] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [structureHandoff, setStructureHandoff] = useState<StructureHandoff | null>(null);
  const [versionSent, setVersionSent] = useState(false);

  async function authHeaders(): Promise<HeadersInit> {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/wave9a/versions?song_id=${encodeURIComponent(songId)}`, {
        headers: await authHeaders(),
      });
      const data = (await res.json()) as { versions?: SongVersion[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("wave9.remix.errorGeneric"));
      setVersions(data.versions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave9.remix.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && versions.length === 0 && !loading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  /* Consume a structure handoff from the Song Structure Builder. */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wave9a_structure_handoff");
      if (!raw) return;
      const h = JSON.parse(raw) as StructureHandoff;
      if (!h.songId || h.songId === songId) setStructureHandoff(h);
    } catch {
      /* ignore malformed handoff */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Tree depth for indentation */
  const depthOf = (v: SongVersion, chain: SongVersion[], seen: string[] = []): number => {
    if (!v.parent_version_id || seen.includes(v.id)) return 0;
    const parent = chain.find((x) => x.id === v.parent_version_id);
    return parent ? 1 + depthOf(parent, chain, [...seen, v.id]) : 0;
  };

  async function createVersion() {
    if (!label.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const finalNotes = structureHandoff
        ? `${t("wave9.remix.builtFromStructure")}: ${structureHandoff.name}${notes.trim() ? `\n${notes.trim()}` : ""}`
        : notes.trim();
      const res = await fetch("/api/wave9a/versions", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          song_id: songId,
          parent_version_id: parentId || null,
          label: label.trim(),
          notes: finalNotes,
          audio_url: audioUrl.trim() || songAudioUrl,
        }),
      });
      const data = (await res.json()) as { version?: SongVersion; error?: string };
      if (!res.ok || !data.version) throw new Error(data.error || t("wave9.remix.errorGeneric"));
      setVersions((vs) => [...vs, data.version!]);
      setLabel("");
      setParentId("");
      setNotes("");
      setAudioUrl("");
      setFormOpen(false);
      if (structureHandoff) {
        localStorage.removeItem("wave9a_structure_handoff");
        setStructureHandoff(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave9.remix.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function promote(id: string) {
    try {
      const res = await fetch(`/api/wave9a/versions/${id}`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ promoted: true }),
      });
      const data = (await res.json()) as { version?: SongVersion; error?: string };
      if (!res.ok || !data.version) throw new Error(data.error || t("wave9.remix.errorGeneric"));
      setVersions((vs) => vs.map((v) => (v.id === id ? data.version! : { ...v, promoted: false })));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave9.remix.errorGeneric"));
    }
  }

  async function remove(id: string) {
    try {
      await fetch(`/api/wave9a/versions/${id}`, { method: "DELETE", headers: await authHeaders() });
      setVersions((vs) => vs.filter((v) => v.id !== id));
    } catch {
      /* non-fatal */
    }
  }

  /* Handoff: send a version to the Music Studio (video editor music tab). */
  function sendToMusicStudio(v: SongVersion) {
    localStorage.setItem(
      "wave9a_version_handoff",
      JSON.stringify({
        versionId: v.id,
        label: v.label,
        notes: v.notes,
        audioUrl: v.audio_url || songAudioUrl,
        songId,
        songTitle,
        createdAt: new Date().toISOString(),
      })
    );
    setVersionSent(true);
  }

  const verA = versions.find((v) => v.id === compareA) ?? null;
  const verB = versions.find((v) => v.id === compareB) ?? null;

  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-black/40 overflow-hidden" data-testid="remix-chain">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors"
      >
        <GitBranch className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="flex-1 text-left text-xs font-black text-white/80">{t("wave9.remix.title")}</span>
        {versions.some((v) => v.promoted) && (
          <span className="inline-flex items-center gap-1 text-[10px] font-black text-primary">
            <Crown className="h-3 w-3" /> {t("wave9.remix.masterSet")}
          </span>
        )}
        {open ? <ChevronUp className="h-3.5 w-3.5 text-white/30 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-white/30 shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-white/[0.06]">
          {structureHandoff && (
            <div className="rounded-lg border border-primary/30 bg-primary/[0.06] p-2.5 text-[11px] text-white/70">
              {t("wave9.remix.handoffBanner", { name: structureHandoff.name })}
            </div>
          )}

          {loading ? (
            <p className="text-xs text-white/40 flex items-center gap-2 py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("wave9.remix.loading")}
            </p>
          ) : versions.length === 0 ? (
            <p className="text-[11px] text-white/35 py-1">{t("wave9.remix.empty")}</p>
          ) : (
            <div className="space-y-1.5">
              {versions.map((v) => {
                const depth = depthOf(v, versions);
                return (
                  <div
                    key={v.id}
                    className={`rounded-lg border bg-black/50 px-2.5 py-2 ${
                      v.promoted ? "border-primary/50" : "border-white/10"
                    }`}
                    style={{ marginLeft: depth * 14 }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-white flex-1 truncate">{v.label}</span>
                      {v.promoted && <Crown className="h-3.5 w-3.5 text-primary shrink-0" />}
                      <button
                        type="button"
                        onClick={() => void promote(v.id)}
                        disabled={v.promoted}
                        className="text-[10px] font-black uppercase tracking-wide text-primary hover:underline disabled:opacity-40 disabled:no-underline shrink-0"
                        title={t("wave9.remix.promote")}
                      >
                        {v.promoted ? t("wave9.remix.master") : t("wave9.remix.promote")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(v.id)}
                        className="text-white/25 hover:text-red-300 transition shrink-0"
                        aria-label={t("wave9.remix.remove")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {v.notes && <p className="mt-1 text-[11px] text-white/45 leading-snug whitespace-pre-wrap">{v.notes}</p>}
                    {(v.audio_url || songAudioUrl) && (
                      <audio controls src={v.audio_url || songAudioUrl} className="w-full h-7 mt-1.5" />
                    )}
                    <div className="mt-1.5 flex items-center gap-2">
                      <Link
                        href="/video-editor?tab=music"
                        onClick={() => sendToMusicStudio(v)}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                      >
                        {t("wave9.remix.sendToStudio")} <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {versionSent && <p className="text-[11px] text-emerald-300">{t("wave9.remix.sentHint")}</p>}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-400/10 p-2.5 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Compare two versions side-by-side */}
          {versions.length >= 2 && (
            <div className="rounded-lg border border-white/10 bg-black/30 p-2.5 space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-white/50">{t("wave9.remix.compareHeading")}</p>
              <div className="grid grid-cols-2 gap-2">
                {(["A", "B"] as const).map((slot) => (
                  <select
                    key={slot}
                    value={slot === "A" ? compareA : compareB}
                    onChange={(e) => (slot === "A" ? setCompareA(e.target.value) : setCompareB(e.target.value))}
                    className="rounded-lg bg-black/60 border border-white/10 px-2 py-2 text-xs text-white outline-none focus:border-primary/50"
                  >
                    <option value="">{t("wave9.remix.pickVersion", { slot })}</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>{v.label}</option>
                    ))}
                  </select>
                ))}
              </div>
              {(verA || verB) && (
                <div className="grid grid-cols-2 gap-2">
                  {[verA, verB].map((v, i) => (
                    <div key={i} className="rounded-lg border border-white/10 bg-black/40 p-2.5">
                      {v ? (
                        <>
                          <p className="text-xs font-black text-white truncate">{v.label}</p>
                          {v.notes && <p className="mt-1 text-[10px] text-white/40 leading-snug line-clamp-3">{v.notes}</p>}
                          {(v.audio_url || songAudioUrl) && (
                            <audio controls src={v.audio_url || songAudioUrl} className="w-full h-7 mt-1.5" />
                          )}
                        </>
                      ) : (
                        <p className="text-[10px] text-white/30">{t("wave9.remix.pickVersion", { slot: i === 0 ? "A" : "B" })}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* New version */}
          {formOpen ? (
            <div className="rounded-lg border border-primary/25 bg-primary/[0.04] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-black uppercase tracking-widest text-white/60">{t("wave9.remix.newHeading")}</p>
                <button type="button" onClick={() => setFormOpen(false)} className="text-white/40 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-primary/50"
                placeholder={t("wave9.remix.labelPlaceholder")}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="w-full rounded-lg bg-black/60 border border-white/10 px-3 py-2 text-xs text-white outline-none focus:border-primary/50"
              >
                <option value="">{t("wave9.remix.noParent")}</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {t("wave9.remix.branchFrom", { label: v.label })}
                  </option>
                ))}
              </select>
              <textarea
                className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-primary/50 min-h-[56px] resize-y"
                placeholder={t("wave9.remix.notesPlaceholder")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-primary/50"
                placeholder={t("wave9.remix.audioUrlPlaceholder")}
                value={audioUrl}
                onChange={(e) => setAudioUrl(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void createVersion()}
                disabled={!label.trim() || saving}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-black text-black hover:brightness-110 transition disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {t("wave9.remix.create")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 px-4 py-2.5 text-xs font-black text-white/55 hover:border-primary/40 hover:text-primary transition"
            >
              <Plus className="h-3.5 w-3.5" /> {t("wave9.remix.newVersion")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
