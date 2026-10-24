import { useEffect, useState } from "react";
import {
  BookOpen, Loader2, AlertTriangle, CheckCircle2, Flag, FileText, Pencil, Plus, Trash2, X,
} from "lucide-react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { fetchReleaseOptions } from "./SplitsOverview";
import {
  PUBLISHING_COPY,
  PUBLISHING_SPLITS_MINE_PATH,
  PUBLISHING_SPLITS_PATH,
  publishingActionPath,
  publishingSheetPath,
  publishingStateLabel,
  publishingViewerActions,
  writerSplitValidationError,
  writerStatusLabel,
  type PublishingRegistrationItem,
} from "@/lib/publishing-splits";

/* ─── Publishing (songwriter) splits registry — docked in the Money
   Tracker's Splits view, directly under the master-side Splits
   Overview, because a song pays two royalties and the two ledgers
   belong side by side: the overview above divides the RECORDING's
   logged income; this registry records who WROTE the song.
   HONESTY: this is a records layer. It collects and pays nothing —
   the panel carries the partner-gated collection label verbatim. */

interface MineData {
  registrations: PublishingRegistrationItem[];
  registry_ready: boolean;
  collection_status: string;
  collection_notice: string;
  registry_note: string;
}

interface SongOption {
  id: string;
  title: string;
}

interface WriterRow {
  name: string;
  profileId: string;
  sharePct: string;
}

const EMPTY_ROW: WriterRow = { name: "", profileId: "", sharePct: "" };

export default function PublishingSplitsPanel() {
  const isLight = useIsLightTheme();
  const { confirmedFetch } = useConfirmedApi();
  const [data, setData] = useState<MineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ code: string; text: string } | null>(null);
  const [disputeNote, setDisputeNote] = useState<Record<string, string>>({});

  /* register / amend form */
  const [showForm, setShowForm] = useState(false);
  const [amendId, setAmendId] = useState<string | null>(null);
  const [songKind, setSongKind] = useState<"release" | "song">("release");
  const [songId, setSongId] = useState("");
  const [releases, setReleases] = useState<SongOption[]>([]);
  const [songs, setSongs] = useState<SongOption[]>([]);
  const [rows, setRows] = useState<WriterRow[]>([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch(PUBLISHING_SPLITS_MINE_PATH, { skipConfirm: true });
      if (!res) return;
      const json = (await res.json().catch(() => ({}))) as MineData & { error?: string };
      if (!res.ok) throw new Error(json.error || "Couldn't load the publishing splits registry.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the publishing splits registry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openForm(item?: PublishingRegistrationItem) {
    setFormError(null);
    setSheet(null);
    if (item) {
      setAmendId(item.id);
      setSongKind(item.song_kind);
      setSongId(item.song_id);
      setRows(
        item.writers.map((w) => ({
          name: w.name,
          profileId: w.profile_id ?? "",
          sharePct: String(w.share_pct),
        })),
      );
    } else {
      setAmendId(null);
      setSongId("");
      setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]);
      if (releases.length === 0) setReleases(await fetchReleaseOptions(confirmedFetch));
      if (songs.length === 0) {
        try {
          const res = await confirmedFetch("/api/songs", { skipConfirm: true });
          if (res && res.ok) {
            const json = (await res.json().catch(() => ({}))) as { songs?: SongOption[] };
            setSongs((json.songs ?? []).map((s) => ({ id: s.id, title: s.title })));
          }
        } catch {
          /* the release list alone still lets the form work */
        }
      }
    }
    setShowForm(true);
  }

  async function submitForm() {
    const writers = rows
      .filter((r) => r.name.trim() !== "" || r.sharePct.trim() !== "")
      .map((r) => ({
        name: r.name.trim(),
        profile_id: r.profileId.trim() === "" ? null : r.profileId.trim(),
        share_pct: Number(r.sharePct),
      }));
    const validation = writerSplitValidationError(
      writers.map((w) => ({ name: w.name, sharePct: w.share_pct })),
    );
    if (!amendId && !songId) {
      setFormError("Pick the song these splits belong to.");
      return;
    }
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const path = amendId ? publishingActionPath(amendId, "amend") : PUBLISHING_SPLITS_PATH;
      const body = amendId ? { writers } : { song_kind: songKind, song_id: songId, writers };
      const res = await confirmedFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        skipConfirm: true,
      });
      if (!res) return;
      const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.message || json.error || "Couldn't save the registration.");
      setShowForm(false);
      setAmendId(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save the registration.");
    } finally {
      setSaving(false);
    }
  }

  async function act(item: PublishingRegistrationItem, action: "confirm" | "dispute") {
    setBusyId(item.id);
    setActionError(null);
    try {
      const res = await confirmedFetch(publishingActionPath(item.id, action), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "dispute" ? { note: disputeNote[item.id] ?? "" } : {}),
        skipConfirm: true,
      });
      if (!res) return;
      const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.message || json.error || `Couldn't ${action} the share.`);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Couldn't ${action} the share.`);
    } finally {
      setBusyId(null);
    }
  }

  async function openSheet(item: PublishingRegistrationItem) {
    setBusyId(item.id);
    setActionError(null);
    try {
      const res = await confirmedFetch(publishingSheetPath(item.id), { skipConfirm: true });
      if (!res) return;
      const json = (await res.json().catch(() => ({}))) as { sheet_code?: string; sheet_text?: string; error?: string };
      if (!res.ok || !json.sheet_text) throw new Error(json.error || "Couldn't build the split sheet.");
      setSheet({ code: json.sheet_code ?? "", text: json.sheet_text });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't build the split sheet.");
    } finally {
      setBusyId(null);
    }
  }

  function downloadSheet() {
    if (!sheet) return;
    const blob = new Blob([sheet.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet.code || "split-sheet"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const songOptions = songKind === "release" ? releases : songs;

  return (
    <div className={`mt-6 rounded-3xl border p-5 md:p-6 ${cardCls}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-black text-white">
            <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" /> Songwriter splits — publishing registry
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/50">
            The splits above divide a recording. This registry records the other half: who{" "}
            <em>wrote</em> each song, and what share of the songwriting is theirs. Writers on Bow Down
            Visuals can confirm or dispute their own share.
          </p>
        </div>
        <button
          onClick={() => openForm()}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-4 py-2.5 text-sm font-black text-black transition hover:scale-[1.03]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Register a song
        </button>
      </div>

      {/* The honesty banner — the registry collects nothing today. */}
      <p className="mt-4 rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3 text-xs leading-relaxed text-white/60">
        {PUBLISHING_COPY.registryOnly}{" "}
        <b className="text-white/85">Status: {PUBLISHING_COPY.collectionNotice}</b>
      </p>

      {data && !data.registry_ready && (
        <p className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-200/90">
          The registry is still being switched on — registration opens as soon as its storage lands.
          Nothing you prepare here is lost or charged.
        </p>
      )}

      {actionError && (
        <p className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-xs text-red-200">
          {actionError}
        </p>
      )}

      {/* ── register / amend form ── */}
      {showForm && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-white">
              {amendId ? "Revise songwriter splits" : "Register a song's songwriter splits"}
            </p>
            <button onClick={() => { setShowForm(false); setAmendId(null); }} className="text-white/50 hover:text-white" aria-label="Close form">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {amendId ? (
            <p className="mt-1 text-xs text-white/45">
              Revising resets every linked writer (except you) to awaiting confirmation and clears any
              dispute — new shares need fresh confirmation. {PUBLISHING_COPY.disputeRule}
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs text-white/55">
                Song comes from
                <select
                  value={songKind}
                  onChange={(e) => { setSongKind(e.target.value as "release" | "song"); setSongId(""); }}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-sm text-white"
                >
                  <option value="release">My releases (Distribute)</option>
                  <option value="song">My song library</option>
                </select>
              </label>
              <label className="text-xs text-white/55">
                Song
                <select
                  value={songId}
                  onChange={(e) => setSongId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-sm text-white"
                >
                  <option value="">Pick one of your songs…</option>
                  {songOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="mt-3 space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                <input
                  value={row.name}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                  placeholder="Songwriter name"
                  className="rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-white/30"
                />
                <input
                  value={row.profileId}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, profileId: e.target.value } : r)))}
                  placeholder="Creator profile ID (optional — links their account)"
                  className="hidden rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-white/30 sm:block"
                />
                <input
                  value={row.sharePct}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, sharePct: e.target.value } : r)))}
                  placeholder="%"
                  inputMode="decimal"
                  className="w-24 rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-white/30"
                />
                <button
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="text-white/40 hover:text-red-300"
                  aria-label="Remove songwriter"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setRows([...rows, { ...EMPTY_ROW }])}
              className="rounded-xl border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-white"
            >
              + Add songwriter
            </button>
            <span className="text-xs text-white/40">
              Shares must total exactly 100%. Link a writer's creator profile ID so they can confirm or
              dispute their share — name-only writers are recorded as not on Bow Down Visuals.
            </span>
          </div>
          {formError && <p className="mt-3 text-xs font-semibold text-red-300">{formError}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={submitForm}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-5 py-2.5 text-sm font-black text-black transition hover:scale-[1.03] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {amendId ? "Save revised splits" : "Register splits"}
            </button>
            <span className="self-center text-[11px] text-white/40">{PUBLISHING_COPY.collectionNotice}</span>
          </div>
        </div>
      )}

      {/* ── split sheet viewer ── */}
      {sheet && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-bold text-white">
              <FileText className="h-4 w-4 text-primary" aria-hidden="true" /> Split sheet {sheet.code}
            </p>
            <div className="flex gap-2">
              <button
                onClick={downloadSheet}
                className="rounded-xl border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-white"
              >
                Download .txt
              </button>
              <button onClick={() => setSheet(null)} className="text-white/50 hover:text-white" aria-label="Close split sheet">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-black/60 p-4 text-xs leading-relaxed text-white/75">
            {sheet.text}
          </pre>
        </div>
      )}

      {/* ── registrations ── */}
      {loading ? (
        <div className="mt-5 flex items-center justify-center gap-2 p-8 text-sm text-white/50">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          Loading the registry…
        </div>
      ) : error ? (
        <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-red-400" aria-hidden="true" />
          <p className="mt-2 text-sm text-white/70">{error}</p>
          <button
            onClick={load}
            className="mt-3 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-2 text-sm font-bold text-primary transition hover:bg-primary/20"
          >
            Try again
          </button>
        </div>
      ) : !data || data.registrations.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-white/15 px-4 py-6 text-center text-sm text-white/45">
          No songs registered yet. Register a song you wrote on and its songwriter splits live here —
          yours to read back any time, with every writer's confirmation on record.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {data.registrations.map((item) => {
            const actions = publishingViewerActions(item);
            return (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-white">{item.song_title || "Untitled song"}</p>
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold ${
                      item.state === "disputed"
                        ? "border-red-500/40 text-red-300"
                        : item.state === "confirmed"
                          ? "border-emerald-500/40 text-emerald-300"
                          : "border-white/15 text-white/60"
                    }`}
                  >
                    {publishingStateLabel(item.state)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-white/40">
                  {item.is_owner ? "Registered by you" : "You're a songwriter on this song"}
                  {item.my_share_pct !== null ? ` · your share ${item.my_share_pct}%` : ""} ·{" "}
                  {item.collection_notice}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.writers.map((w, i) => (
                    <span
                      key={`${w.name}-${i}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-white/70"
                    >
                      <b className="text-white">{w.name}</b>
                      <span className="font-black text-primary">{w.share_pct}%</span>
                      <span className={w.confirmation_status === "disputed" ? "text-red-300" : "text-white/45"}>
                        {writerStatusLabel(w.confirmation_status)}
                      </span>
                    </span>
                  ))}
                </div>
                {item.writers.some((w) => w.confirmation_status === "disputed" && w.dispute_note) && (
                  <div className="mt-3 space-y-1">
                    {item.writers
                      .filter((w) => w.confirmation_status === "disputed" && w.dispute_note)
                      .map((w, i) => (
                        <p key={i} className="flex items-start gap-1.5 text-xs text-red-200/80">
                          <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {w.name}: {w.dispute_note}
                        </p>
                      ))}
                    <p className="text-[11px] text-white/40">{PUBLISHING_COPY.disputeRule}</p>
                  </div>
                )}

                {/* my writer actions */}
                {(actions.includes("confirm") || actions.includes("dispute")) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {actions.includes("confirm") && (
                      <button
                        onClick={() => act(item, "confirm")}
                        disabled={busyId === item.id}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Confirm my {item.my_share_pct}%
                      </button>
                    )}
                    {actions.includes("dispute") && (
                      <>
                        <input
                          value={disputeNote[item.id] ?? ""}
                          onChange={(e) => setDisputeNote({ ...disputeNote, [item.id]: e.target.value })}
                          placeholder="Why is this share wrong? (optional)"
                          className="min-w-48 flex-1 rounded-xl border border-white/15 bg-black/50 px-3 py-1.5 text-xs text-white placeholder:text-white/30"
                        />
                        <button
                          onClick={() => act(item, "dispute")}
                          disabled={busyId === item.id}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                        >
                          <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Dispute my share
                        </button>
                      </>
                    )}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => openSheet(item)}
                    disabled={busyId === item.id}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-50"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Split sheet
                  </button>
                  {actions.includes("amend") && (
                    <button
                      onClick={() => openForm(item)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-white"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Revise splits
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
