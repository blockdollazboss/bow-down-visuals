/**
 * PublishDesk — the My Studio board's native Publish desk
 * (stack1600 world parity wave #4, desk #99, census item B14).
 *
 * The /publish page's own surface, where you stand: your tracks
 * and videos on the /api/publish rails — upload a finished file
 * (or link one), save it as a draft or put it live on your
 * profile, edit its details, take it down, delete it — no tab
 * out, no "finish on the website". The desk and the page are
 * two faces of ONE library: a row saved here is the page's row.
 *
 * Money honesty: publishing your own content is FREE on the
 * rails and free here — no Visual Bucs, no spend confirmation,
 * because the rail charges none. The one dollar figure in the
 * flow is a track's download price, which is the member's own
 * price for their buyers, and the desk labels it that way.
 *
 * Honest states: the two shelves settle independently (one
 * rejected shelf never discards the other — the page's S27-44
 * rule), a failed shelf is an error with a retry rather than an
 * empty shelf, and a member with no creator profile gets the
 * in-world creation card (#48) instead of a dead end.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import {
  EMPTY_PUBLISH_DRAFT,
  PUBLISH_ARTWORK_MAX_BYTES,
  PUBLISH_GENRES,
  PUBLISH_PROFILES_PATH,
  PUBLISH_TRACKS_PATH,
  PUBLISH_VIDEOS_PATH,
  PUBLISH_UPLOAD_PATH,
  PUBLISH_VERTICALS,
  PUBLISH_VERTICAL_LABELS,
  buildPublishStateBody,
  buildTrackPayload,
  buildVideoPayload,
  draftForVertical,
  draftOfItem,
  parsePublishProfiles,
  parsePublishTracks,
  parsePublishVideos,
  publishArtworkFileError,
  publishCollectionPath,
  publishDurationLabel,
  publishDraftError,
  publishItemOfSaveResponse,
  publishItemPath,
  publishMediaFileError,
  publishPriceLabel,
  publishUploadOfResponse,
  withPublishItemState,
  withoutPublishItem,
  type PublishDraft,
  type PublishItem,
  type PublishKind,
  type PublishProfile,
  type PublishUpload,
  type PublishVertical,
} from "@/lib/world/publish-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";
import { CreatorProfileCreateCard } from "./CreatorProfileCreate";

const PUB_VERTICAL_KEY: Partial<Record<string, string>> = {
  music: "pubVerticalMusic",
  video: "pubVerticalVideo",
  gaming: "pubVerticalGaming",
  podcast: "pubVerticalPodcast",
  film: "pubVerticalFilm",
  influencer: "pubVerticalInfluencer",
  education: "pubVerticalEducation",
  other: "pubVerticalOther",
  comedy: "pubVerticalComedy",
};

export function PublishDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const deskHeaders = useDeskAuthHeaders();
  const displayTitle = (title: string) =>
    title === "Untitled" ? t("worldDeskRemainder.pubUntitled") : title;
  const draftErrorStrings = {
    titleRequired: t("worldDeskRemainder.pubErrTitleRequired"),
    titleTooLong: t("worldDeskRemainder.pubErrTitleTooLong"),
    audioMissing: t("worldDeskRemainder.pubErrAudioMissing"),
    videoMissing: t("worldDeskRemainder.pubErrVideoMissing"),
    mediaLinkTooLong: t("worldDeskRemainder.pubErrMediaLinkTooLong"),
    genreTooLong: t("worldDeskRemainder.pubErrGenreTooLong"),
    isrcTooLong: t("worldDeskRemainder.pubErrIsrcTooLong"),
    tagsTooMany: (max: number) => t("worldDeskRemainder.pubErrTagsTooMany", { max }),
    descriptionTooLong: t("worldDeskRemainder.pubErrDescriptionTooLong"),
    seasonInvalid: t("worldDeskRemainder.pubErrSeasonInvalid"),
    episodeInvalid: t("worldDeskRemainder.pubErrEpisodeInvalid"),
  };
  const fileErrorStrings = {
    dropAudio: t("worldDeskRemainder.pubErrDropAudio"),
    dropVideo: t("worldDeskRemainder.pubErrDropVideo"),
    typeUnsupported: t("worldDeskRemainder.pubErrFileTypeUnsupported"),
    fileTooBig: t("worldDeskRemainder.pubErrFileTooBig"),
    artworkNotImage: t("worldDeskRemainder.pubErrArtworkNotImage"),
    artworkTooBig: t("worldDeskRemainder.pubErrArtworkTooBig"),
  };
  const priceLabelStrings = {
    free: t("worldDeskRemainder.pubPriceFree"),
    download: (amount: string) => t("worldDeskRemainder.pubPriceDownload", { amount }),
  };

  const [profiles, setProfiles] = useState<PublishProfile[] | null>(null);
  const [profilesFailed, setProfilesFailed] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);

  const [tracks, setTracks] = useState<PublishItem[] | null>(null);
  const [tracksFailed, setTracksFailed] = useState(false);
  const [videos, setVideos] = useState<PublishItem[] | null>(null);
  const [videosFailed, setVideosFailed] = useState(false);

  const [draft, setDraft] = useState<PublishDraft>(EMPTY_PUBLISH_DRAFT);
  const [editing, setEditing] = useState<PublishItem | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [artworkRef, setArtworkRef] = useState<string | null>(null);
  const [artUploading, setArtUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const mediaInputRef = useRef<HTMLInputElement>(null);
  const artInputRef = useRef<HTMLInputElement>(null);

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

  /* ── Loads ─────────────────────────────────────────────────── */

  const loadProfiles = useCallback(async () => {
    setProfilesFailed(false);
    try {
      const headers = await deskHeaders();
      const res = await fetch(PUBLISH_PROFILES_PATH, { headers });
      if (!res.ok) throw new Error("profiles failed");
      const parsed = parsePublishProfiles(await res.json().catch(() => null));
      setProfiles(parsed);
      setProfileId((prev) =>
        prev && parsed.some((p) => p.id === prev) ? prev : (parsed[0]?.id ?? null),
      );
    } catch {
      setProfilesFailed(true);
    }
  }, [deskHeaders]);

  const loadShelf = useCallback(
    async (kind: PublishKind) => {
      if (kind === "track") setTracksFailed(false);
      else setVideosFailed(false);
      try {
        const headers = await deskHeaders();
        const res = await fetch(kind === "track" ? PUBLISH_TRACKS_PATH : PUBLISH_VIDEOS_PATH, {
          headers,
        });
        if (!res.ok) throw new Error("shelf failed");
        const data = await res.json().catch(() => null);
        if (kind === "track") setTracks(parsePublishTracks(data));
        else setVideos(parsePublishVideos(data));
      } catch {
        if (kind === "track") setTracksFailed(true);
        else setVideosFailed(true);
      }
    },
    [deskHeaders],
  );

  useEffect(() => {
    void loadProfiles();
    void loadShelf("track");
    void loadShelf("video");
  }, [loadProfiles, loadShelf]);

  /* ── Uploads ───────────────────────────────────────────────── */

  const uploadFile = useCallback(
    async (f: File): Promise<PublishUpload> => {
      const headers = await deskHeaders();
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(PUBLISH_UPLOAD_PATH, { method: "POST", headers, body: fd });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldDeskRemainder.pubUploadFailedStatus", { status: res.status })));
      const up = publishUploadOfResponse(data);
      if (!up) throw new Error(t("worldDeskRemainder.pubUploadUnusable"));
      return up;
    },
    [deskHeaders, t],
  );

  function probeDuration(f: File, kind: PublishKind) {
    try {
      const url = URL.createObjectURL(f);
      const el = document.createElement(kind === "track" ? "audio" : "video");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        if (Number.isFinite(el.duration)) setDurationSec(Math.round(el.duration));
        URL.revokeObjectURL(url);
      };
      el.onerror = () => URL.revokeObjectURL(url);
      el.src = url;
    } catch {
      /* duration is a bonus — the rail takes the row without it */
    }
  }

  function pickMedia(f: File | undefined | null) {
    if (!f) return;
    const err = publishMediaFileError(f, draft.kind, fileErrorStrings);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setFile(f);
    probeDuration(f, draft.kind);
  }

  async function pickArtwork(f: File | undefined | null) {
    if (!f) return;
    const err = publishArtworkFileError(f, fileErrorStrings);
    if (err) {
      setFormError(err);
      return;
    }
    setArtUploading(true);
    setFormError(null);
    try {
      const up = await uploadFile(f);
      setArtworkRef(up.ref);
      setDraft((prev) => ({ ...prev, artworkUrl: up.url }));
    } catch (e) {
      setFormError(plainErrorText(e, t("worldDeskRemainder.pubArtworkFailed")));
    } finally {
      setArtUploading(false);
    }
  }

  /* ── Composer ──────────────────────────────────────────────── */

  function patchDraft(patch: Partial<PublishDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function resetComposer() {
    setDraft(EMPTY_PUBLISH_DRAFT);
    setEditing(null);
    setFile(null);
    setDurationSec(null);
    setArtworkRef(null);
    setFormError(null);
  }

  function pickKind(kind: PublishKind) {
    if (editing) return; // a saved row's kind is its identity
    setFile(null);
    setDurationSec(null);
    patchDraft({ kind });
  }

  function pickCategory(v: PublishVertical) {
    if (editing) {
      patchDraft({ category: v });
      return;
    }
    setDraft((prev) => {
      const next = draftForVertical(prev, v);
      if (next.kind !== prev.kind) {
        setFile(null);
        setDurationSec(null);
      }
      return next;
    });
  }

  function startEdit(item: PublishItem) {
    setEditing(item);
    setDraft(draftOfItem(item));
    setFile(null);
    setDurationSec(item.durationSec);
    setArtworkRef(null);
    setConfirmDeleteId(null);
    setFormError(null);
    setNote(null);
  }

  async function save() {
    if (saving) return;
    const targetProfileId = editing ? editing.profileId : profileId;
    if (!targetProfileId) {
      setFormError(t("worldDeskRemainder.pubNoProfile"));
      return;
    }
    const problem = publishDraftError(draft, { hasFile: file !== null, editing: editing !== null }, draftErrorStrings);
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    setFormError(null);
    setNote(null);
    try {
      let mediaUrl: string | null = draft.mediaUrl.trim() || null;
      if (file) {
        const up = await uploadFile(file);
        /* Save the permanent ref, not the 24h signed URL — the
           page's discipline, and the rail mirrors again anyway. */
        mediaUrl = up.ref ?? up.url;
      }
      const artworkUrl = artworkRef ?? (draft.artworkUrl.trim() || null);
      const body =
        draft.kind === "track"
          ? buildTrackPayload(draft, targetProfileId, mediaUrl, artworkUrl, durationSec)
          : buildVideoPayload(draft, targetProfileId, mediaUrl, artworkUrl, durationSec, editing !== null);
      const url = editing ? publishItemPath(editing) : publishCollectionPath(draft.kind);
      const headers = { ...(await deskHeaders()), "Content-Type": "application/json" };
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldDeskRemainder.pubSaveFailedStatus", { status: res.status })));
      const saved = publishItemOfSaveResponse(draft.kind, data);
      if (!saved) throw new Error(t("worldDeskRemainder.pubSaveUnusable"));
      setNote(
        saved.isPublished
          ? t("worldDeskRemainder.pubNowLive", { title: displayTitle(saved.title) })
          : t("worldDeskRemainder.pubNowDraft", { title: displayTitle(saved.title) }),
      );
      resetComposer();
      void loadShelf(saved.kind);
    } catch (e) {
      setFormError(plainErrorText(e, t("worldDeskRemainder.pubSaveFailed")));
    } finally {
      setSaving(false);
    }
  }

  /* ── Row actions ───────────────────────────────────────────── */

  async function toggleState(item: PublishItem) {
    if (togglingId) return;
    setTogglingId(item.id);
    setNote(null);
    try {
      const headers = { ...(await deskHeaders()), "Content-Type": "application/json" };
      const res = await fetch(publishItemPath(item), {
        method: "PUT",
        headers,
        body: JSON.stringify(buildPublishStateBody(!item.isPublished)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldDeskRemainder.pubToggleFailedStatus", { status: res.status })));
      const apply = (items: PublishItem[] | null) =>
        items ? withPublishItemState(items, item.id, !item.isPublished) : items;
      if (item.kind === "track") setTracks(apply);
      else setVideos(apply);
      if (editing?.id === item.id) {
        setEditing({ ...item, isPublished: !item.isPublished });
        patchDraft({ publishNow: !item.isPublished });
      }
    } catch (e) {
      setNote(plainErrorText(e, t("worldDeskRemainder.pubToggleFailed")));
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteItem(item: PublishItem) {
    if (confirmDeleteId !== item.id) {
      setConfirmDeleteId(item.id);
      return;
    }
    setDeletingId(item.id);
    setNote(null);
    try {
      const headers = await deskHeaders();
      const res = await fetch(publishItemPath(item), { method: "DELETE", headers });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(apiErrorMessage(data, t("worldDeskRemainder.pubDeleteFailedStatus", { status: res.status })));
      }
      if (item.kind === "track") setTracks((prev) => (prev ? withoutPublishItem(prev, item.id) : prev));
      else setVideos((prev) => (prev ? withoutPublishItem(prev, item.id) : prev));
      if (editing?.id === item.id) resetComposer();
      setNote(t("worldDeskRemainder.pubDeleted", { title: displayTitle(item.title) }));
    } catch (e) {
      setNote(plainErrorText(e, t("worldDeskRemainder.pubDeleteFailed")));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  /* ── Render ────────────────────────────────────────────────── */

  const shelvesLoading = tracks === null && videos === null && !tracksFailed && !videosFailed;
  const bothEmpty =
    tracks !== null && videos !== null && tracks.length === 0 && videos.length === 0;

  function shelfBlock(kind: PublishKind, items: PublishItem[] | null, failed: boolean) {
    if (failed) {
      return (
        <div data-testid={`world-publish-desk-${kind === "track" ? "tracks" : "videos"}-failed`}>
          <p className={errCls}>
            {t("worldDeskRemainder.pubShelfFailed", { kind: kind === "track" ? t("worldDeskRemainder.pubTracksWord") : t("worldDeskRemainder.pubVideosWord") })}
          </p>
          <button type="button" className={`mt-2 ${chipCls(false)}`} onClick={() => void loadShelf(kind)}>
            {t("worldDeskRemainder.pubTryAgain")}
          </button>
        </div>
      );
    }
    if (items === null) {
      return <p className={`text-sm ${muted}`}>{t("worldDeskRemainder.pubShelfLoading", { kind: kind === "track" ? t("worldDeskRemainder.pubTracksWord") : t("worldDeskRemainder.pubVideosWord") })}</p>;
    }
    if (items.length === 0) {
      return (
        <p className={`text-sm ${muted}`}>
          {t("worldDeskRemainder.pubShelfEmpty", { kind: kind === "track" ? t("worldDeskRemainder.pubTracksWord") : t("worldDeskRemainder.pubVideosWord") })}
        </p>
      );
    }
    return (
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li
            key={item.id}
            className={`rounded-xl border px-3 py-2 ${cardCls}`}
            data-testid={`world-publish-desk-item-${item.id}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-sm font-bold ${strong}`}>{displayTitle(item.title)}</span>
              <span className={chipCls(item.isPublished)}>{item.isPublished ? t("worldDeskRemainder.pubLive") : t("worldDeskRemainder.pubDraft")}</span>
              {item.genre ? <span className={`text-xs ${muted}`}>{item.genre}</span> : null}
              {item.kind === "video" && item.season ? (
                <span className={`text-xs ${muted}`}>
                  {t("worldDeskRemainder.pubSeason", { season: item.season })}
                  {item.episode ? t("worldDeskRemainder.pubEpisodeSuffix", { episode: item.episode }) : ""}
                </span>
              ) : null}
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  className={chipCls(false)}
                  data-testid={`world-publish-desk-toggle-${item.id}`}
                  disabled={togglingId !== null}
                  onClick={() => void toggleState(item)}
                >
                  {togglingId === item.id ? t("worldDeskRemainder.pubWorking") : item.isPublished ? t("worldDeskRemainder.pubTakeDown") : t("worldDeskRemainder.pubPublish")}
                </button>
                <button
                  type="button"
                  className={chipCls(false)}
                  data-testid={`world-publish-desk-edit-${item.id}`}
                  onClick={() => startEdit(item)}
                >
                  {t("worldDeskRemainder.pubEdit")}
                </button>
                <button
                  type="button"
                  className={chipCls(confirmDeleteId === item.id)}
                  data-testid={`world-publish-desk-delete-${item.id}`}
                  disabled={deletingId !== null}
                  onClick={() => void deleteItem(item)}
                >
                  {deletingId === item.id
                    ? t("worldDeskRemainder.pubDeleting")
                    : confirmDeleteId === item.id
                      ? item.isPublished
                        ? t("worldDeskRemainder.pubLiveTapDelete")
                        : t("worldDeskRemainder.pubTapAgainDelete")
                      : t("worldDeskRemainder.pubDelete")}
                </button>
              </span>
            </div>
            <p className={`mt-0.5 text-xs ${muted}`}>
              {[
                publishDurationLabel(item.durationSec),
                item.kind === "track" ? publishPriceLabel(item.downloadPriceCents, priceLabelStrings) : "",
                item.kind === "track" && item.isrc ? `ISRC ${item.isrc}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {item.kind === "video" && item.description ? (
              <p className={`mt-0.5 text-xs ${muted}`}>{item.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  const genreOptions =
    draft.genre && !(PUBLISH_GENRES as readonly string[]).includes(draft.genre)
      ? [draft.genre, ...PUBLISH_GENRES]
      : [...PUBLISH_GENRES];

  return (
    <div className="space-y-3" data-testid="world-publish-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>{t("worldDeskRemainder.pubTitle")}</p>
        <p className={`text-xs ${muted}`}>
          {t("worldDeskRemainder.pubIntro")}
        </p>
      </div>

      {profilesFailed ? (
        <div data-testid="world-publish-desk-profiles-failed">
          <p className={errCls}>{t("worldDeskRemainder.pubProfileFailed")}</p>
          <button type="button" className={`mt-2 ${chipCls(false)}`} onClick={() => void loadProfiles()}>
            {t("worldDeskRemainder.pubTryAgain")}
          </button>
        </div>
      ) : profiles !== null && profiles.length === 0 ? (
        <div data-testid="world-publish-desk-no-profile">
          <CreatorProfileCreateCard isLight={isLight} compact onCreated={() => void loadProfiles()} />
        </div>
      ) : profiles !== null && profiles.length > 1 && !editing ? (
        <label className={`block text-xs ${muted}`}>
          {t("worldDeskRemainder.pubPublishingTo")}
          <select
            data-testid="world-publish-desk-profile"
            aria-label={t("worldDeskRemainder.pubProfileAria")}
            className={`${inputCls} mt-1`}
            value={profileId ?? ""}
            onChange={(e) => setProfileId(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName ?? p.slug}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {shelvesLoading ? (
        <p className={`text-sm ${muted}`} data-testid="world-publish-desk-loading">
          {t("worldDeskRemainder.pubLibraryLoading")}
        </p>
      ) : (
        <>
          {bothEmpty && !tracksFailed && !videosFailed ? (
            <p className={`text-sm ${muted}`} data-testid="world-publish-desk-empty">
              {t("worldDeskRemainder.pubLibraryEmpty")}
            </p>
          ) : null}
          <div className="space-y-2">
            <p className={`text-sm font-bold ${strong}`}>{t("worldDeskRemainder.pubTracksHeading")}</p>
            {shelfBlock("track", tracks, tracksFailed)}
          </div>
          <div className="space-y-2">
            <p className={`text-sm font-bold ${strong}`}>{t("worldDeskRemainder.pubVideosHeading")}</p>
            {shelfBlock("video", videos, videosFailed)}
          </div>
        </>
      )}

      {note ? <p className={`text-xs font-semibold ${strong}`}>{note}</p> : null}

      <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-publish-desk-composer">
        <p className={`text-sm font-bold ${strong}`}>
          {editing ? t("worldDeskRemainder.pubEditTitle", { title: displayTitle(editing.title) }) : t("worldDeskRemainder.pubNewTitle")}
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            className={chipCls(draft.kind === "track")}
            data-testid="world-publish-desk-kind-track"
            disabled={editing !== null}
            onClick={() => pickKind("track")}
          >
            {t("worldDeskRemainder.pubKindTrack")}
          </button>
          <button
            type="button"
            className={chipCls(draft.kind === "video")}
            data-testid="world-publish-desk-kind-video"
            disabled={editing !== null}
            onClick={() => pickKind("video")}
          >
            {t("worldDeskRemainder.pubKindVideo")}
          </button>
          <select
            data-testid="world-publish-desk-category"
            aria-label={t("worldDeskRemainder.pubCategoryAria")}
            className={`${inputCls} w-auto`}
            value={draft.category}
            onChange={(e) => pickCategory(e.target.value as PublishVertical)}
          >
            {PUBLISH_VERTICALS.map((v) => (
              <option key={v} value={v}>
                {PUB_VERTICAL_KEY[v] ? t(`worldDeskRemainder.${PUB_VERTICAL_KEY[v]}`) : PUBLISH_VERTICAL_LABELS[v]}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-2 grid gap-2">
          <input
            data-testid="world-publish-desk-title"
            aria-label={t("worldDeskRemainder.pubTitleAria")}
            className={inputCls}
            value={draft.title}
            maxLength={160}
            onChange={(e) => patchDraft({ title: e.target.value })}
            placeholder={draft.kind === "track" ? t("worldDeskRemainder.pubTrackTitlePlaceholder") : t("worldDeskRemainder.pubVideoTitlePlaceholder")}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={chipCls(false)} onClick={() => mediaInputRef.current?.click()}>
              {file ? t("worldDeskRemainder.pubChangeFile") : draft.kind === "track" ? t("worldDeskRemainder.pubUploadAudio") : t("worldDeskRemainder.pubUploadVideo")}
            </button>
            <input
              ref={mediaInputRef}
              data-testid="world-publish-desk-file"
              type="file"
              className="hidden"
              accept={draft.kind === "track" ? "audio/*" : "video/*"}
              onChange={(e) => {
                pickMedia(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {file ? (
              <>
                <span className={`text-xs ${muted}`}>
                  {file.name}
                  {durationSec ? t("worldDeskRemainder.pubFileSeconds", { seconds: durationSec }) : ""}
                </span>
                <button
                  type="button"
                  className={chipCls(false)}
                  onClick={() => {
                    setFile(null);
                    setDurationSec(editing?.durationSec ?? null);
                  }}
                >
                  {t("worldDeskRemainder.pubRemove")}
                </button>
              </>
            ) : (
              <span className={`text-xs ${muted}`}>{t("worldDeskRemainder.pubOrPasteLink")}</span>
            )}
          </div>
          {!file ? (
            <input
              data-testid="world-publish-desk-media-url"
              aria-label={draft.kind === "track" ? t("worldDeskRemainder.pubAudioLinkAria") : t("worldDeskRemainder.pubVideoLinkAria")}
              className={inputCls}
              value={draft.mediaUrl}
              onChange={(e) => patchDraft({ mediaUrl: e.target.value })}
              placeholder={draft.kind === "track" ? t("worldDeskRemainder.pubAudioLinkPlaceholder") : t("worldDeskRemainder.pubVideoLinkPlaceholder")}
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={chipCls(false)}
              disabled={artUploading}
              onClick={() => artInputRef.current?.click()}
            >
              {artUploading
                ? t("worldDeskRemainder.pubUploadingArt")
                : draft.kind === "track"
                  ? t("worldDeskRemainder.pubUploadArtwork")
                  : t("worldDeskRemainder.pubUploadThumbnail")}
            </button>
            <input
              ref={artInputRef}
              data-testid="world-publish-desk-artwork-file"
              type="file"
              className="hidden"
              accept="image/*"
              onChange={(e) => {
                void pickArtwork(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <input
              data-testid="world-publish-desk-artwork-url"
              aria-label={draft.kind === "track" ? t("worldDeskRemainder.pubArtworkLinkAria") : t("worldDeskRemainder.pubThumbnailLinkAria")}
              className={`${inputCls} min-w-40 flex-1`}
              value={draft.artworkUrl}
              onChange={(e) => {
                setArtworkRef(null);
                patchDraft({ artworkUrl: e.target.value });
              }}
              placeholder={
                draft.kind === "track" ? t("worldDeskRemainder.pubArtworkLinkPlaceholder") : t("worldDeskRemainder.pubThumbnailLinkPlaceholder")
              }
            />
          </div>

          {draft.kind === "track" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                data-testid="world-publish-desk-genre"
                aria-label={t("worldDeskRemainder.pubGenreAria")}
                className={inputCls}
                value={draft.genre}
                onChange={(e) => patchDraft({ genre: e.target.value })}
              >
                <option value="">{t("worldDeskRemainder.pubPickGenre")}</option>
                {genreOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <input
                data-testid="world-publish-desk-isrc"
                aria-label="ISRC"
                className={inputCls}
                value={draft.isrc}
                maxLength={32}
                onChange={(e) => patchDraft({ isrc: e.target.value })}
                placeholder={t("worldDeskRemainder.pubIsrcPlaceholder")}
              />
              <input
                data-testid="world-publish-desk-tags"
                aria-label={t("worldDeskRemainder.pubTagsAria")}
                className={inputCls}
                value={draft.tagsInput}
                onChange={(e) => patchDraft({ tagsInput: e.target.value })}
                placeholder={t("worldDeskRemainder.pubTagsPlaceholder")}
              />
              <input
                data-testid="world-publish-desk-price"
                aria-label={t("worldDeskRemainder.pubPriceAria")}
                className={inputCls}
                value={draft.priceDollars}
                inputMode="decimal"
                onChange={(e) => patchDraft({ priceDollars: e.target.value })}
                placeholder={t("worldDeskRemainder.pubPricePlaceholder")}
              />
            </div>
          ) : (
            <div className="grid gap-2">
              <textarea
                data-testid="world-publish-desk-description"
                aria-label={t("worldDeskRemainder.pubDescription")}
                className={inputCls}
                value={draft.description}
                rows={3}
                maxLength={2000}
                onChange={(e) => patchDraft({ description: e.target.value })}
                placeholder={t("worldDeskRemainder.pubDescription")}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  data-testid="world-publish-desk-season"
                  aria-label={t("worldDeskRemainder.pubSeasonAria")}
                  className={inputCls}
                  value={draft.season}
                  inputMode="numeric"
                  onChange={(e) => patchDraft({ season: e.target.value })}
                  placeholder={t("worldDeskRemainder.pubSeasonPlaceholder")}
                />
                <input
                  data-testid="world-publish-desk-episode"
                  aria-label={t("worldDeskRemainder.pubEpisode")}
                  className={inputCls}
                  value={draft.episode}
                  inputMode="numeric"
                  onChange={(e) => patchDraft({ episode: e.target.value })}
                  placeholder={t("worldDeskRemainder.pubEpisode")}
                />
              </div>
              <input
                data-testid="world-publish-desk-alt-text"
                aria-label={t("worldDeskRemainder.pubAltTextAria")}
                className={inputCls}
                value={draft.thumbnailAltText}
                onChange={(e) => patchDraft({ thumbnailAltText: e.target.value })}
                placeholder={t("worldDeskRemainder.pubAltTextPlaceholder")}
              />
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={chipCls(draft.publishNow)}
            data-testid="world-publish-desk-live"
            aria-pressed={draft.publishNow}
            onClick={() => patchDraft({ publishNow: !draft.publishNow })}
          >
            {draft.publishNow ? t("worldDeskRemainder.pubLiveOnProfile") : t("worldDeskRemainder.pubKeepDraft")}
          </button>
          <button
            type="button"
            className={goldBtn}
            data-testid="world-publish-desk-save"
            disabled={saving || artUploading}
            onClick={() => void save()}
          >
            {saving
              ? t("worldDeskRemainder.pubSaving")
              : editing
                ? t("worldDeskRemainder.pubSaveChanges")
                : draft.publishNow
                  ? t("worldDeskRemainder.pubPublishGoLive")
                  : t("worldDeskRemainder.pubSaveDraft")}
          </button>
          {editing ? (
            <button type="button" className={chipCls(false)} onClick={resetComposer}>
              {t("worldDeskRemainder.pubCancelEditing")}
            </button>
          ) : null}
        </div>
        {formError ? <p className={`mt-2 ${errCls}`}>{formError}</p> : null}
        <p className={`mt-2 text-xs ${muted}`}>
          {t("worldDeskRemainder.pubFooter", { artworkMb: PUBLISH_ARTWORK_MAX_BYTES / (1024 * 1024) })}
        </p>
      </div>
    </div>
  );
}
