/**
 * CatalogImportDesk — the My Studio board's native Catalog
 * Import desk (stack1500 world parity wave #3, census item 11).
 *
 * Bring your catalog home without leaving the World: scan a
 * connected account for your own posts, pick what comes home,
 * upload files into the same pipeline, watch the rebuild
 * restore the details re-uploading loses, and approve each
 * piece onto your profile.
 *
 * Everything is free; the desk rides plain authed fetches and
 * re-reads the state after every action — the page's own
 * refresh discipline. The rail's honesty lines render verbatim
 * (followers do not transfer; a blocked platform says why on
 * the item itself, in its statusNote). Blocked and failed rows
 * stay visible with their notes and their retry — never
 * vanished, never dressed up.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import {
  CATALOG_APPROVE_BATCH_PATH,
  CATALOG_FETCH_PATH,
  CATALOG_PATH,
  CATALOG_PLATFORM_LABELS,
  CATALOG_PRESIGN_PATH,
  CATALOG_SCAN_PATH,
  CATALOG_UPLOADS_PATH,
  approvedItems,
  batchApprovedCount,
  buildApprovePayload,
  buildFetchPayload,
  buildScanPayload,
  buildUploadsPayload,
  catalogItemPath,
  catalogStateOf,
  catalogUploadKey,
  catalogUploadKind,
  editsFromDraft,
  platformItems,
  readyItems,
  waitingItems,
  type CatalogAccount,
  type CatalogApproveEdits,
  type CatalogItem,
  type CatalogState,
  type CatalogStatus,
  type CatalogUploadFile,
} from "@/lib/world/catalog-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

/** Catalog keys for the seam's status labels — the website's own
 *  status words, shared with the 2D import page's catalog
 *  (catalogImport.status*); the seam keeps the English labels as
 *  defaults for its other callers. */
const STATUS_LABEL_KEYS: Record<CatalogStatus, string> = {
  listed: "catalogImport.statusListed",
  fetching: "catalogImport.statusFetching",
  here: "catalogImport.statusHere",
  ready: "catalogImport.statusReady",
  approved: "catalogImport.statusApproved",
  blocked: "catalogImport.statusBlocked",
  failed: "catalogImport.statusFailed",
  dismissed: "catalogImport.statusDismissed",
};

interface UploadRow {
  name: string;
  state: "uploading" | "registering" | "home" | "failed";
}

export function CatalogImportDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const deskHeaders = useDeskAuthHeaders();
  const { user } = useAuth();
  const [state, setState] = useState<CatalogState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, CatalogApproveEdits>>({});
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

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
    try {
      const headers = await deskHeaders();
      const res = await fetch(CATALOG_PATH, { headers });
      if (!res.ok) throw new Error("load failed");
      const parsed = catalogStateOf(await res.json().catch(() => ({})));
      if (!parsed) throw new Error("load failed");
      setState(parsed);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [deskHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  /** One action + the page's refresh discipline: re-read the
   *  state after, whatever the action answered. */
  async function run(key: string, action: () => Promise<unknown>, okNotice?: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      if (okNotice) setNotice(okNotice);
    } catch (e) {
      setError(plainErrorText(e, t("worldCatalogLibrary.importActionError")));
    } finally {
      setBusy(null);
    }
  }

  async function post(path: string, body: unknown): Promise<unknown> {
    const headers = await deskHeaders();
    const res = await fetch(path, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.importActionError")));
    return data;
  }

  const scan = (account: CatalogAccount) =>
    void run(`scan-${account.accountId}`, () => post(CATALOG_SCAN_PATH, buildScanPayload(account.accountId!)));

  const fetchOne = (item: CatalogItem) =>
    void run(`fetch-${item.id}`, () => post(CATALOG_FETCH_PATH, buildFetchPayload([item.id])));

  const fetchPicked = () => {
    const ids = [...picked];
    if (ids.length === 0) return;
    void run(
      "fetch-selected",
      async () => {
        await post(CATALOG_FETCH_PATH, buildFetchPayload(ids));
        setPicked(new Set());
      },
      t(ids.length === 1 ? "worldCatalogLibrary.importFetchNoticeOne" : "worldCatalogLibrary.importFetchNoticeMany", { count: ids.length }),
    );
  };

  const rebuild = (item: CatalogItem) =>
    void run(`rebuild-${item.id}`, () => post(catalogItemPath(item.id, "rebuild"), {}));

  const approve = (item: CatalogItem) =>
    void run(
      `approve-${item.id}`,
      () => post(catalogItemPath(item.id, "approve"), buildApprovePayload(edits[item.id] ?? null)),
      item.kind === "audio"
        ? t("worldCatalogLibrary.importApproveAudioNotice")
        : t("worldCatalogLibrary.importApproveVideoNotice"),
    );

  const dismiss = (item: CatalogItem) =>
    void run(`dismiss-${item.id}`, () => post(catalogItemPath(item.id, "dismiss"), {}));

  const approveAll = () => {
    if (!state) return;
    const ready = readyItems(state);
    if (ready.length === 0) return;
    void run(
      "approve-all",
      async () => {
        const data = await post(CATALOG_APPROVE_BATCH_PATH, buildFetchPayload(ready.map((i) => i.id)));
        const ok = batchApprovedCount(data);
        if (ok !== null) {
          setNotice(t("worldCatalogLibrary.importApproveAllNotice", { ok, total: ready.length }));
        }
      },
      undefined,
    );
  };

  async function onFiles(files: FileList | null) {
    if (!files || !user || busy) return;
    const list = [...files].slice(0, 200);
    setError(null);
    setNotice(null);
    setBusy("upload");
    const rows: UploadRow[] = list.map((f) => ({ name: f.name, state: "uploading" }));
    setUploads(rows);
    const done: CatalogUploadFile[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      const kind = catalogUploadKind(f.type);
      const key = catalogUploadKey(user.id, crypto.randomUUID(), f.name);
      try {
        const presign = (await post(CATALOG_PRESIGN_PATH, {
          key,
          contentType: f.type || (kind === "audio" ? "audio/mpeg" : "video/mp4"),
        })) as { uploadUrl?: string };
        if (!presign.uploadUrl) throw new Error("no upload url");
        const put = await fetch(presign.uploadUrl, {
          method: "PUT",
          body: f,
          headers: { "Content-Type": f.type },
        });
        if (!put.ok) throw new Error("upload failed");
        done.push({ key, filename: f.name, kind, contentType: f.type });
        rows[i] = { name: f.name, state: "registering" };
      } catch {
        rows[i] = { name: f.name, state: "failed" };
      }
      setUploads([...rows]);
    }
    if (done.length > 0) {
      try {
        await post(CATALOG_UPLOADS_PATH, buildUploadsPayload(done));
        setUploads(rows.map((r) => (r.state === "registering" ? { ...r, state: "home" as const } : r)));
        await load();
        setNotice(t(done.length === 1 ? "worldCatalogLibrary.importUploadsHomeOne" : "worldCatalogLibrary.importUploadsHomeMany", { count: done.length }));
      } catch (e) {
        setError(plainErrorText(e, t("worldCatalogLibrary.importRegisterError")));
      }
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (loadFailed) {
    return (
      <div className="space-y-3" data-testid="world-catalog-desk">
        <p className={`text-base font-black ${strong}`}>{t("worldCatalogLibrary.importTitle")}</p>
        <p className={errCls} data-testid="world-catalog-desk-failed">
          {t("worldCatalogLibrary.importLoadError")}
        </p>
        <button type="button" className={chipCls(false)} onClick={() => void load()}>
          {t("worldCatalogLibrary.sharedTryAgain")}
        </button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="space-y-3" data-testid="world-catalog-desk">
        <p className={`text-base font-black ${strong}`}>{t("worldCatalogLibrary.importTitle")}</p>
        <p className={`text-sm ${muted}`}>{t("worldCatalogLibrary.importLoading")}</p>
      </div>
    );
  }

  const platform = platformItems(state);
  const waiting = waitingItems(state);
  const approved = approvedItems(state);
  const readyCount = readyItems(state).length;

  return (
    <div className="space-y-4" data-testid="world-catalog-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>{t("worldCatalogLibrary.importTitle")}</p>
        {state.honesty.movesLine ? (
          <p className={`text-xs ${muted}`} data-testid="world-catalog-desk-honesty">
            {state.honesty.movesLine}
          </p>
        ) : null}
      </div>
      {notice ? (
        <p className={`text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{notice}</p>
      ) : null}
      {error ? <p className={errCls}>{error}</p> : null}

      {/* ── Accounts ──────────────────────────────────────────── */}
      <section>
        <p className={`text-sm font-bold ${strong}`}>{t("catalogImport.accountsTitle")}</p>
        {state.accounts.length === 0 ? (
          <p className={`mt-1 text-sm ${muted}`}>
            {t("worldCatalogLibrary.importNoAccounts")}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {state.accounts.map((account, i) => (
              <li
                key={`${account.platform}-${account.accountId ?? i}`}
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${cardCls}`}
              >
                <span className={`text-sm font-bold ${strong}`}>
                  {CATALOG_PLATFORM_LABELS[account.platform] ?? account.platform}
                  {account.username ? ` · @${account.username}` : ""}
                </span>
                <span className={`text-xs ${muted}`}>{t("worldCatalogLibrary.importListedCount", { count: account.itemCount })}</span>
                {account.note ? <span className={`w-full text-xs ${muted}`}>{account.note}</span> : null}
                {account.state === "ready" && account.accountId ? (
                  <button
                    type="button"
                    data-testid={`world-catalog-desk-scan-${account.accountId}`}
                    className={`ml-auto ${chipCls(false)}`}
                    disabled={busy !== null}
                    onClick={() => scan(account)}
                  >
                    {busy === `scan-${account.accountId}` ? t("worldCatalogLibrary.importScanning") : t("worldCatalogLibrary.importScan")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── On the platform ─────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-bold ${strong}`}>{t("worldCatalogLibrary.importPlatformTitle")}</p>
          {picked.size > 0 ? (
            <button
              type="button"
              data-testid="world-catalog-desk-fetch-picked"
              className={`ml-auto ${goldBtn}`}
              disabled={busy !== null}
              onClick={fetchPicked}
            >
              {busy === "fetch-selected" ? t("worldCatalogLibrary.importBringingIn") : t("worldCatalogLibrary.importFetchPicked", { count: picked.size })}
            </button>
          ) : null}
        </div>
        {platform.length === 0 ? (
          <p className={`mt-1 text-sm ${muted}`}>
            {t("worldCatalogLibrary.importPlatformEmpty")}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {platform.map((item) => {
              const canFetch = item.status === "listed" || item.status === "failed";
              return (
                <li key={item.id} className={`rounded-xl border px-3 py-2 ${cardCls}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {canFetch ? (
                      <input
                        type="checkbox"
                        aria-label={t("worldCatalogLibrary.importPickAria", { title: item.title })}
                        data-testid={`world-catalog-desk-pick-${item.id}`}
                        checked={picked.has(item.id)}
                        onChange={(e) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                      />
                    ) : null}
                    <span className={`text-sm font-bold ${strong}`}>{item.title}</span>
                    <span className={chipCls(item.status === "blocked" || item.status === "failed")}>
                      {t(STATUS_LABEL_KEYS[item.status])}
                    </span>
                    <span className={`text-xs ${muted}`}>
                      {item.platform
                        ? (CATALOG_PLATFORM_LABELS[item.platform] ?? item.platform)
                        : t("catalogImport.yourUpload")}
                      {item.kind === "audio" ? t("worldCatalogLibrary.importKindAudio") : t("worldCatalogLibrary.importKindVideo")}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      {canFetch ? (
                        <button
                          type="button"
                          data-testid={`world-catalog-desk-fetch-${item.id}`}
                          className={chipCls(false)}
                          disabled={busy !== null}
                          onClick={() => fetchOne(item)}
                        >
                          {busy === `fetch-${item.id}` ? t("worldCatalogLibrary.importBringingIn") : item.status === "failed" ? t("catalogImport.retry") : t("catalogImport.bringIn")}
                        </button>
                      ) : null}
                      {item.status !== "fetching" ? (
                        <button
                          type="button"
                          className={chipCls(false)}
                          disabled={busy !== null}
                          onClick={() => dismiss(item)}
                        >
                          {t("catalogImport.dismiss")}
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {item.statusNote ? <p className={`mt-1 text-xs ${muted}`}>{item.statusNote}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className={`mt-1 text-xs ${muted}`}>{t("worldCatalogLibrary.importTip")}</p>
      </section>

      {/* ── Upload ──────────────────────────────────────────────── */}
      <section className={`rounded-xl border p-3 ${cardCls}`}>
        <p className={`text-sm font-bold ${strong}`}>{t("worldCatalogLibrary.importUploadTitle")}</p>
        <p className={`mt-0.5 text-xs ${muted}`}>
          {t("worldCatalogLibrary.importUploadIntro")}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,audio/*"
          multiple
          className="hidden"
          data-testid="world-catalog-desk-file-input"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <button
          type="button"
          data-testid="world-catalog-desk-choose"
          className={`mt-2 ${goldBtn}`}
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "upload" ? t("worldCatalogLibrary.importUploading") : t("worldCatalogLibrary.importChooseFiles")}
        </button>
        {uploads.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {uploads.map((row, i) => (
              <li key={i} className={`text-xs ${muted}`}>
                {row.name} —{" "}
                {row.state === "home"
                  ? t("worldCatalogLibrary.importUploadHome")
                  : row.state === "failed"
                    ? t("worldCatalogLibrary.importUploadFailed")
                    : row.state === "registering"
                      ? t("worldCatalogLibrary.importUploadRegistering")
                      : t("worldCatalogLibrary.importUploadUploading")}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ── Waiting for your word ───────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-bold ${strong}`}>{t("worldCatalogLibrary.importWaitingTitle")}</p>
          {readyCount > 0 ? (
            <button
              type="button"
              data-testid="world-catalog-desk-approve-all"
              className={`ml-auto ${goldBtn}`}
              disabled={busy !== null}
              onClick={approveAll}
            >
              {busy === "approve-all" ? t("worldCatalogLibrary.importApproving") : t("catalogImport.approveAllReady", { count: readyCount })}
            </button>
          ) : null}
        </div>
        {waiting.length === 0 ? (
          <p className={`mt-1 text-sm ${muted}`}>
            {t("worldCatalogLibrary.importWaitingEmpty")}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {waiting.map((item) => {
              const draft = item.draft;
              const itemEdits = edits[item.id] ?? (draft ? editsFromDraft(draft) : null);
              return (
                <li key={item.id} className={`rounded-xl border p-3 ${cardCls}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-bold ${strong}`}>{item.title}</span>
                    <span className={chipCls(false)}>{t(STATUS_LABEL_KEYS[item.status])}</span>
                    <span className="ml-auto flex gap-1.5">
                      <button
                        type="button"
                        data-testid={`world-catalog-desk-rebuild-${item.id}`}
                        className={chipCls(false)}
                        disabled={busy !== null}
                        onClick={() => rebuild(item)}
                      >
                        {busy === `rebuild-${item.id}`
                          ? t("worldCatalogLibrary.importRebuilding")
                          : draft
                            ? t("worldCatalogLibrary.importRebuildAgain")
                            : t("catalogImport.rebuildDetails")}
                      </button>
                      <button
                        type="button"
                        data-testid={`world-catalog-desk-approve-${item.id}`}
                        className={goldBtn}
                        disabled={busy !== null}
                        onClick={() => approve(item)}
                      >
                        {busy === `approve-${item.id}` ? t("worldCatalogLibrary.importApproving") : t("catalogImport.approvePutHome")}
                      </button>
                      <button
                        type="button"
                        className={chipCls(false)}
                        disabled={busy !== null}
                        onClick={() => dismiss(item)}
                      >
                        {t("catalogImport.dismiss")}
                      </button>
                    </span>
                  </div>
                  {draft && itemEdits ? (
                    <div className="mt-2 space-y-2" data-testid={`world-catalog-desk-draft-${item.id}`}>
                      <p className={`text-xs ${muted}`}>
                        {draft.source === "ai"
                          ? t("worldCatalogLibrary.importDraftAi")
                          : t("worldCatalogLibrary.importDraftAssembled")}
                      </p>
                      <label className={`block text-xs ${muted}`}>
                        {t("catalogImport.titleLabel")}
                        <input
                          className={`${inputCls} mt-1`}
                          value={itemEdits.title}
                          maxLength={200}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, [item.id]: { ...itemEdits, title: e.target.value } }))
                          }
                        />
                      </label>
                      <label className={`block text-xs ${muted}`}>
                        {t("catalogImport.descriptionLabel")}
                        <textarea
                          className={`${inputCls} mt-1`}
                          rows={2}
                          maxLength={2000}
                          value={itemEdits.description}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, [item.id]: { ...itemEdits, description: e.target.value } }))
                          }
                        />
                      </label>
                      <label className={`block text-xs ${muted}`}>
                        {t("worldCatalogLibrary.importTagsLabel")}
                        <input
                          className={`${inputCls} mt-1`}
                          value={itemEdits.tagsInput}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, [item.id]: { ...itemEdits, tagsInput: e.target.value } }))
                          }
                        />
                      </label>
                      {draft.series ? (
                        <p className={`text-xs ${muted}`}>
                          {t("worldCatalogLibrary.importSeriesPrefix")}{" "}
                          <span className={`font-bold ${strong}`}>{draft.series.name}</span>
                          {t("worldCatalogLibrary.importSeriesRest", { season: draft.series.season, episode: draft.series.episode })}
                        </p>
                      ) : null}
                      {draft.chapters.length > 0 ? (
                        <p className={`text-xs ${muted}`}>
                          {t("catalogImport.chaptersLine", {
                            chapters: draft.chapters
                              .map((c) => `${Math.floor(c.atSec / 60)}:${String(c.atSec % 60).padStart(2, "0")} ${c.label}`)
                              .join(" · "),
                          })}
                        </p>
                      ) : null}
                      {draft.captions ? (
                        <p className={`text-xs italic ${muted}`}>
                          {t("catalogImport.captionsPreview", { text: draft.captions.slice(0, 300) })}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className={`mt-1 text-xs ${muted}`}>
                      {t("worldCatalogLibrary.importNoDraft")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Home ────────────────────────────────────────────────── */}
      {approved.length > 0 ? (
        <section data-testid="world-catalog-desk-approved">
          <p className={`text-sm font-bold ${strong}`}>{t("catalogImport.homeTitle")}</p>
          <ul className="mt-1 space-y-1">
            {approved.map((item) => (
              <li key={item.id} className={`text-sm ${muted}`}>
                ✓ {item.title}
                <span className="text-xs">
                  {item.targetKind === "song" ? t("worldCatalogLibrary.importHomeSongSuffix") : t("worldCatalogLibrary.importHomeVideoSuffix")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
