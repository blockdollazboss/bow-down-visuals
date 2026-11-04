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
import { useAuth } from "@/contexts/AuthContext";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import {
  CATALOG_APPROVE_BATCH_PATH,
  CATALOG_FETCH_PATH,
  CATALOG_PATH,
  CATALOG_PLATFORM_LABELS,
  CATALOG_PRESIGN_PATH,
  CATALOG_SCAN_PATH,
  CATALOG_STATUS_LABELS,
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
  type CatalogUploadFile,
} from "@/lib/world/catalog-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

interface UploadRow {
  name: string;
  state: "uploading" | "registering" | "home" | "failed";
}

export function CatalogImportDesk({ isLight }: { isLight: boolean }) {
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
      setError(plainErrorText(e, "That didn't land. Try again in a moment."));
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
    if (!res.ok) throw new Error(apiErrorMessage(data, "That didn't land. Try again in a moment."));
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
      `Bringing in ${ids.length} piece${ids.length === 1 ? "" : "s"} — watch them land below.`,
    );
  };

  const rebuild = (item: CatalogItem) =>
    void run(`rebuild-${item.id}`, () => post(catalogItemPath(item.id, "rebuild"), {}));

  const approve = (item: CatalogItem) =>
    void run(
      `approve-${item.id}`,
      () => post(catalogItemPath(item.id, "approve"), buildApprovePayload(edits[item.id] ?? null)),
      item.kind === "audio"
        ? "Home — find it in your songs."
        : "Home — find it on your profile's videos.",
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
          setNotice(`Approved ${ok} of ${ready.length} — the rest keep their drafts for your word.`);
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
        setNotice(`${done.length} upload${done.length === 1 ? "" : "s"} home — find them in the waiting list.`);
      } catch (e) {
        setError(plainErrorText(e, "The uploads landed but registering them failed. Try again in a moment."));
      }
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (loadFailed) {
    return (
      <div className="space-y-3" data-testid="world-catalog-desk">
        <p className={`text-base font-black ${strong}`}>Catalog Import</p>
        <p className={errCls} data-testid="world-catalog-desk-failed">
          Your import list wouldn&rsquo;t load. Give it another shot.
        </p>
        <button type="button" className={chipCls(false)} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="space-y-3" data-testid="world-catalog-desk">
        <p className={`text-base font-black ${strong}`}>Catalog Import</p>
        <p className={`text-sm ${muted}`}>Reading your import list…</p>
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
        <p className={`text-base font-black ${strong}`}>Catalog Import</p>
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
        <p className={`text-sm font-bold ${strong}`}>Your connected accounts</p>
        {state.accounts.length === 0 ? (
          <p className={`mt-1 text-sm ${muted}`}>
            No accounts connected yet — connect one in your account settings and it can be scanned
            here.
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
                <span className={`text-xs ${muted}`}>{account.itemCount} listed</span>
                {account.note ? <span className={`w-full text-xs ${muted}`}>{account.note}</span> : null}
                {account.state === "ready" && account.accountId ? (
                  <button
                    type="button"
                    data-testid={`world-catalog-desk-scan-${account.accountId}`}
                    className={`ml-auto ${chipCls(false)}`}
                    disabled={busy !== null}
                    onClick={() => scan(account)}
                  >
                    {busy === `scan-${account.accountId}` ? "Scanning…" : "Scan for my posts"}
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
          <p className={`text-sm font-bold ${strong}`}>On the platform</p>
          {picked.size > 0 ? (
            <button
              type="button"
              data-testid="world-catalog-desk-fetch-picked"
              className={`ml-auto ${goldBtn}`}
              disabled={busy !== null}
              onClick={fetchPicked}
            >
              {busy === "fetch-selected" ? "Bringing in…" : `Bring home the picked (${picked.size})`}
            </button>
          ) : null}
        </div>
        {platform.length === 0 ? (
          <p className={`mt-1 text-sm ${muted}`}>
            Nothing waiting on a platform — scan an account above, or upload files below.
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
                        aria-label={`Pick ${item.title} to bring home`}
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
                      {CATALOG_STATUS_LABELS[item.status]}
                    </span>
                    <span className={`text-xs ${muted}`}>
                      {item.platform
                        ? (CATALOG_PLATFORM_LABELS[item.platform] ?? item.platform)
                        : "Your upload"}
                      {item.kind === "audio" ? " · audio" : " · video"}
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
                          {busy === `fetch-${item.id}` ? "Bringing in…" : item.status === "failed" ? "Retry" : "Bring in"}
                        </button>
                      ) : null}
                      {item.status !== "fetching" ? (
                        <button
                          type="button"
                          className={chipCls(false)}
                          disabled={busy !== null}
                          onClick={() => dismiss(item)}
                        >
                          Dismiss
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
        <p className={`mt-1 text-xs ${muted}`}>Tip: tick several, then bring them home together.</p>
      </section>

      {/* ── Upload ──────────────────────────────────────────────── */}
      <section className={`rounded-xl border p-3 ${cardCls}`}>
        <p className={`text-sm font-bold ${strong}`}>Upload files</p>
        <p className={`mt-0.5 text-xs ${muted}`}>
          Videos and audio from your device join the same pipeline — home first, details rebuilt,
          your word before anything goes public.
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
          {busy === "upload" ? "Uploading…" : "Choose files"}
        </button>
        {uploads.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {uploads.map((row, i) => (
              <li key={i} className={`text-xs ${muted}`}>
                {row.name} —{" "}
                {row.state === "home"
                  ? "home ✓"
                  : row.state === "failed"
                    ? "didn't land — try it again"
                    : row.state === "registering"
                      ? "almost there…"
                      : "uploading…"}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ── Waiting for your word ───────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-bold ${strong}`}>Waiting for your word</p>
          {readyCount > 0 ? (
            <button
              type="button"
              data-testid="world-catalog-desk-approve-all"
              className={`ml-auto ${goldBtn}`}
              disabled={busy !== null}
              onClick={approveAll}
            >
              {busy === "approve-all" ? "Approving…" : `Approve all ready (${readyCount})`}
            </button>
          ) : null}
        </div>
        {waiting.length === 0 ? (
          <p className={`mt-1 text-sm ${muted}`}>
            Nothing waiting — bring pieces home and their rebuilt details land here for your word.
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
                    <span className={chipCls(false)}>{CATALOG_STATUS_LABELS[item.status]}</span>
                    <span className="ml-auto flex gap-1.5">
                      <button
                        type="button"
                        data-testid={`world-catalog-desk-rebuild-${item.id}`}
                        className={chipCls(false)}
                        disabled={busy !== null}
                        onClick={() => rebuild(item)}
                      >
                        {busy === `rebuild-${item.id}`
                          ? "Rebuilding…"
                          : draft
                            ? "Rebuild the details again"
                            : "Rebuild the details"}
                      </button>
                      <button
                        type="button"
                        data-testid={`world-catalog-desk-approve-${item.id}`}
                        className={goldBtn}
                        disabled={busy !== null}
                        onClick={() => approve(item)}
                      >
                        {busy === `approve-${item.id}` ? "Approving…" : "Approve — put it home"}
                      </button>
                      <button
                        type="button"
                        className={chipCls(false)}
                        disabled={busy !== null}
                        onClick={() => dismiss(item)}
                      >
                        Dismiss
                      </button>
                    </span>
                  </div>
                  {draft && itemEdits ? (
                    <div className="mt-2 space-y-2" data-testid={`world-catalog-desk-draft-${item.id}`}>
                      <p className={`text-xs ${muted}`}>
                        {draft.source === "ai"
                          ? "Draft written by the rebuild — check it before you approve."
                          : "Draft assembled from what came home — check it before you approve."}
                      </p>
                      <label className={`block text-xs ${muted}`}>
                        Title
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
                        Description
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
                        Tags (comma-separated, up to 8)
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
                          Series: <span className={`font-bold ${strong}`}>{draft.series.name}</span> —
                          season {draft.series.season}, episode {draft.series.episode}
                        </p>
                      ) : null}
                      {draft.chapters.length > 0 ? (
                        <p className={`text-xs ${muted}`}>
                          Chapters:{" "}
                          {draft.chapters
                            .map((c) => `${Math.floor(c.atSec / 60)}:${String(c.atSec % 60).padStart(2, "0")} ${c.label}`)
                            .join(" · ")}
                        </p>
                      ) : null}
                      {draft.captions ? (
                        <p className={`text-xs italic ${muted}`}>
                          Captions: “{draft.captions.slice(0, 300)}”
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className={`mt-1 text-xs ${muted}`}>
                      No draft yet — rebuild the details and they&rsquo;ll be here for your word.
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
          <p className={`text-sm font-bold ${strong}`}>Home</p>
          <ul className="mt-1 space-y-1">
            {approved.map((item) => (
              <li key={item.id} className={`text-sm ${muted}`}>
                ✓ {item.title}
                <span className="text-xs">
                  {" "}
                  — {item.targetKind === "song" ? "in your songs" : "on your profile's videos"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
