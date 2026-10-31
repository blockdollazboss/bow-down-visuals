import { useEffect, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Disc3, Loader2, Plus, Rocket, Trash2,
} from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import {
  ALBUMS_PATH,
  ALBUM_PUBLISH_COST_VB,
  ALBUM_PUBLISH_FEATURE,
  ALBUM_TYPE_OPTIONS,
  SONGS_PATH,
  albumFormReady,
  albumPath,
  albumPublicPath,
  albumPublishPath,
  albumTypeLabel,
  buildAlbumCreateBody,
  buildAlbumPatchBody,
  buildTracklistBody,
  moveTrackId,
  normalizeAlbumDetail,
  normalizeAlbums,
  normalizeLibrarySongs,
  type AlbumDetail,
  type AlbumForm,
  type AlbumSummary,
  type LibrarySong,
} from "@/lib/world/albums-desk";

/* ─── Albums & EPs, in-world (stack1100 world parity) ──────────────
   Album building at My Studio, on the albums router's own rails —
   the same endpoints the Songs page's Albums tab calls. Drafting
   is free: create, edit, and shape the tracklist (the PATCH takes
   the full replacement order, like the page's own chain — add,
   remove and reorder all ride it). Publishing is the one charge:
   300 Bucs, named on the button and in the credit confirmation;
   the rail refunds any failure after the charge and the desk
   surfaces its words. A published album's public link copies
   in the room. Delete is two-step, spoken in-world — the house
   pattern for destructive verbs. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const iconBtn = (isLight: boolean) =>
  `shrink-0 rounded-lg border p-2 transition bdv-touch-box disabled:opacity-40 ${
    isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/15 text-white/60 hover:text-white"
  }`;

const EMPTY_FORM: AlbumForm = { title: "", albumType: "album", releaseNotes: "", coverArtUrl: "" };

export function AlbumsDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [songs, setSongs] = useState<LibrarySong[]>([]);
  const [tick, setTick] = useState(0);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<AlbumForm>(EMPTY_FORM);
  const [createPicks, setCreatePicks] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [editForm, setEditForm] = useState<AlbumForm>(EMPTY_FORM);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      try {
        const res = await fetch(ALBUMS_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error(`albums ${res.status}`);
        const parsed = normalizeAlbums(await res.json());
        if (!parsed) throw new Error("albums shape");
        if (!cancelled) setAlbums(parsed);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* The library feeds the pickers; its failure only empties the
     picker (the album rails still stand) — never the whole desk. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(SONGS_PATH, { headers: await authHeaders() });
        if (!res.ok) return;
        const parsed = normalizeLibrarySongs(await res.json());
        if (!cancelled && parsed) setSongs(parsed);
      } catch {
        /* tolerant — pickers read empty */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function openAlbum(id: string) {
    setOpenId(id);
    setDetail(null);
    setDetailFailed(false);
    setError(null);
    setNote(null);
    setConfirmDelete(false);
    try {
      const res = await fetch(albumPath(id), { headers: await authHeaders() });
      if (!res.ok) throw new Error(`album ${res.status}`);
      const parsed = normalizeAlbumDetail(await res.json());
      if (!parsed) throw new Error("album shape");
      setDetail(parsed);
      setEditForm({
        title: parsed.title,
        albumType: parsed.albumType,
        releaseNotes: parsed.releaseNotes,
        coverArtUrl: parsed.coverArtUrl ?? "",
      });
    } catch {
      setDetailFailed(true);
    }
  }

  async function create() {
    if (!albumFormReady(createForm) || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(ALBUMS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildAlbumCreateBody(createForm, [...createPicks])),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't create the album (${res.status})`));
      const made = normalizeAlbumDetail(data);
      setCreateForm(EMPTY_FORM);
      setCreatePicks(new Set());
      setShowCreate(false);
      setTick((t) => t + 1);
      if (made) {
        setNote(`“${made.title}” is drafted — shape the tracklist, then publish when it's ready.`);
        void openAlbum(made.id);
      } else {
        setNote("Album drafted.");
      }
    } catch (err) {
      setError(plainErrorText(err, "Couldn't create the album — try again."));
    } finally {
      setCreating(false);
    }
  }

  async function patchTracks(ids: string[], busyKey: string) {
    if (!detail) return;
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(albumPath(detail.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildTracklistBody(ids)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't save the tracklist (${res.status})`));
      const byId = new Map(detail.tracks.map((t) => [t.songId, t]));
      const songById = new Map(songs.map((s) => [s.id, s]));
      setDetail({
        ...detail,
        tracks: ids.map((id) => byId.get(id) ?? { songId: id, title: songById.get(id)?.title ?? "Untitled song" }),
        trackCount: ids.length,
      });
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Couldn't save the tracklist — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdits() {
    if (!detail || !albumFormReady(editForm)) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(albumPath(detail.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildAlbumPatchBody(editForm)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't save (${res.status})`));
      setDetail({
        ...detail,
        title: editForm.title.trim(),
        albumType: editForm.albumType,
        releaseNotes: editForm.releaseNotes.trim(),
        coverArtUrl: editForm.coverArtUrl.trim() || null,
      });
      setNote("Saved.");
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Couldn't save — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!detail) return;
    setBusy("publish");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(albumPublishPath(detail.id), {
        method: "POST",
        headers: { ...(await authHeaders()) },
        overrideCost: ALBUM_PUBLISH_COST_VB,
        overrideFeature: ALBUM_PUBLISH_FEATURE,
      });
      if (!res) return; // declined the confirmation — nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't publish (${res.status})`));
      setNote("Published — your album has its public page. Copy the link below and share it anywhere.");
      await openAlbum(detail.id);
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Couldn't publish — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!detail) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(albumPath(detail.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't delete (${res.status})`));
      setOpenId(null);
      setDetail(null);
      setConfirmDelete(false);
      setNote("Album deleted. The songs themselves stay in your library.");
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Couldn't delete — try again."));
    } finally {
      setBusy(null);
    }
  }

  function copyPublicLink() {
    if (!detail?.slug) return;
    void navigator.clipboard
      ?.writeText(`${window.location.origin}${albumPublicPath(detail.slug)}`)
      .catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const formFields = (
    form: AlbumForm,
    setForm: (f: AlbumForm) => void,
    prefix: string,
  ) => (
    <div className="space-y-2">
      <input
        className={deskInputCls(isLight)}
        placeholder="Title"
        maxLength={120}
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        aria-label={`${prefix} title`}
      />
      <div className="flex flex-wrap gap-2">
        <select
          className={deskInputCls(isLight)}
          value={form.albumType}
          onChange={(e) => setForm({ ...form, albumType: e.target.value })}
          aria-label={`${prefix} type`}
        >
          {ALBUM_TYPE_OPTIONS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          className={deskInputCls(isLight)}
          placeholder="Cover art link (optional)"
          value={form.coverArtUrl}
          onChange={(e) => setForm({ ...form, coverArtUrl: e.target.value })}
          aria-label={`${prefix} cover art link`}
        />
      </div>
      <textarea
        className={deskInputCls(isLight)}
        placeholder="Release notes (optional)"
        rows={2}
        maxLength={2000}
        value={form.releaseNotes}
        onChange={(e) => setForm({ ...form, releaseNotes: e.target.value })}
        aria-label={`${prefix} release notes`}
      />
    </div>
  );

  return (
    <NativeCard isLight={isLight} title="Albums & EPs">
      <div data-testid="world-albums-desk" className="space-y-3">
        {error ? <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{error}</p> : null}
        {note ? <p className={`text-xs font-semibold ${strong}`}>{note}</p> : null}

        {openId === null ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-sm ${muted}`}>
                Bundle your songs into albums and EPs. Drafting is free — publishing costs{" "}
                {ALBUM_PUBLISH_COST_VB} Bucs and mints the public page.
              </p>
              <button type="button" className={goldBtn} onClick={() => setShowCreate((s) => !s)}>
                <Plus className="h-3.5 w-3.5" /> New album
              </button>
            </div>

            {showCreate ? (
              <div data-testid="world-albums-create" className="space-y-2">
                {formFields(createForm, setCreateForm, "New album")}
                {songs.length > 0 ? (
                  <div className="space-y-1">
                    <p className={`text-xs font-bold ${muted}`}>Start with songs (you can change the list after):</p>
                    {songs.slice(0, 30).map((s) => (
                      <label key={s.id} className={`flex cursor-pointer items-center gap-2 text-sm bdv-touch-target ${strong}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[#d4af37]"
                          checked={createPicks.has(s.id)}
                          onChange={(e) =>
                            setCreatePicks((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s.id);
                              else next.delete(s.id);
                              return next;
                            })
                          }
                        />
                        {s.title}
                      </label>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={goldBtn}
                  disabled={!albumFormReady(createForm) || creating}
                  onClick={() => void create()}
                >
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Draft it — free
                </button>
              </div>
            ) : null}

            {loadFailed ? (
              <NativeErrorState
                isLight={isLight}
                title="Your albums wouldn't open"
                message="Your albums are safe on the real rails — the shelf just didn't answer. Try again."
                onRetry={() => setTick((t) => t + 1)}
              />
            ) : albums === null ? (
              <NativeLoadingState isLight={isLight} message="Reading your albums…" />
            ) : albums.length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message="No albums yet."
                detail="Draft your first above — it stays private until you publish it."
              />
            ) : (
              albums.map((a) => (
                <div
                  key={a.id}
                  className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                    isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                  }`}
                >
                  <Disc3 className="h-4 w-4 text-[#d4af37]" />
                  <span className={`text-sm font-bold ${strong}`}>{a.title}</span>
                  <span className={`text-xs ${muted}`}>
                    {albumTypeLabel(a.albumType)} · {a.trackCount} track{a.trackCount === 1 ? "" : "s"} ·{" "}
                    {a.status === "published" ? "Published" : "Draft"}
                  </span>
                  <button type="button" className={chipBtn(isLight)} onClick={() => void openAlbum(a.id)}>
                    Open
                  </button>
                </div>
              ))
            )}
          </>
        ) : detailFailed ? (
          <div className="space-y-2">
            <button type="button" className={chipBtn(isLight)} onClick={() => setOpenId(null)}>
              <ArrowLeft className="h-3.5 w-3.5" /> All albums
            </button>
            <NativeErrorState
              isLight={isLight}
              title="That album wouldn't open"
              message="The album is safe — it just didn't answer. Try again."
              onRetry={() => openId && void openAlbum(openId)}
            />
          </div>
        ) : detail === null ? (
          <NativeLoadingState isLight={isLight} message="Opening the album…" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={chipBtn(isLight)} onClick={() => setOpenId(null)}>
                <ArrowLeft className="h-3.5 w-3.5" /> All albums
              </button>
              <span className={`text-sm font-black ${strong}`}>{detail.title}</span>
              <span className={`text-xs ${muted}`}>
                {albumTypeLabel(detail.albumType)} · {detail.status === "published" ? "Published" : "Draft"}
              </span>
            </div>

            {formFields(editForm, setEditForm, "Album")}
            <button
              type="button"
              className={chipBtn(isLight)}
              disabled={!albumFormReady(editForm) || busy !== null}
              onClick={() => void saveEdits()}
            >
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save the words — free
            </button>

            <div className="space-y-1.5">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Tracklist</p>
              {detail.tracks.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message="No tracks yet."
                  detail="Add songs from your library below — an album needs at least one to publish."
                />
              ) : (
                detail.tracks.map((t, i) => {
                  const ids = detail.tracks.map((x) => x.songId);
                  return (
                    <div
                      key={`${t.songId}-${i}`}
                      className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 ${
                        isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                      }`}
                    >
                      <span className={`w-5 text-xs font-black ${muted}`}>{i + 1}</span>
                      <span className={`flex-1 text-sm ${strong}`}>{t.title}</span>
                      <button
                        type="button"
                        className={iconBtn(isLight)}
                        aria-label={`Move ${t.title} up`}
                        disabled={i === 0 || busy !== null}
                        onClick={() => void patchTracks(moveTrackId(ids, i, -1), "tracks")}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className={iconBtn(isLight)}
                        aria-label={`Move ${t.title} down`}
                        disabled={i === detail.tracks.length - 1 || busy !== null}
                        onClick={() => void patchTracks(moveTrackId(ids, i, 1), "tracks")}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className={iconBtn(isLight)}
                        aria-label={`Remove ${t.title}`}
                        disabled={busy !== null}
                        onClick={() => void patchTracks(ids.filter((_, j) => j !== i), "tracks")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
              {songs.filter((s) => !detail.tracks.some((t) => t.songId === s.id)).length > 0 ? (
                <div className="space-y-1 pt-1">
                  <p className={`text-xs font-bold ${muted}`}>Add from your library:</p>
                  {songs
                    .filter((s) => !detail.tracks.some((t) => t.songId === s.id))
                    .slice(0, 30)
                    .map((s) => (
                      <div key={s.id} className="flex items-center gap-2">
                        <span className={`flex-1 text-sm ${strong}`}>{s.title}</span>
                        <button
                          type="button"
                          className={chipBtn(isLight)}
                          disabled={busy !== null}
                          onClick={() =>
                            void patchTracks([...detail.tracks.map((t) => t.songId), s.id], "tracks")
                          }
                        >
                          <Plus className="h-3.5 w-3.5" /> Add
                        </button>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {detail.status !== "published" ? (
                <button
                  type="button"
                  className={goldBtn}
                  disabled={detail.tracks.length === 0 || busy !== null}
                  onClick={() => void publish()}
                >
                  {busy === "publish" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="h-3.5 w-3.5" />
                  )}
                  Publish — {ALBUM_PUBLISH_COST_VB} Bucs
                </button>
              ) : detail.slug ? (
                <button type="button" className={chipBtn(isLight)} onClick={copyPublicLink}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Link copied" : "Copy the public link"}
                </button>
              ) : null}
              <button
                type="button"
                className={confirmDelete ? goldBtn : chipBtn(isLight)}
                disabled={busy !== null}
                onClick={() => void remove()}
              >
                {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {confirmDelete ? "Tap again to delete for good" : "Delete album"}
              </button>
            </div>
            {outOfCredits ? (
              <p className={`text-xs font-semibold ${strong}`}>
                Not enough Visual Bucs to publish — it costs {ALBUM_PUBLISH_COST_VB}. Top up at the
                Treasury; nothing was charged.
              </p>
            ) : null}
            {detail.status !== "published" && detail.tracks.length === 0 ? (
              <p className={`text-xs ${muted}`}>Add at least one song and the Publish button arms.</p>
            ) : null}
          </div>
        )}
      </div>
    </NativeCard>
  );
}
