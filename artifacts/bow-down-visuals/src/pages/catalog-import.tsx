import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Library, Loader2, CheckCircle2, ScanSearch, UploadCloud, Sparkles, Ban,
  ArrowRight, ExternalLink, RefreshCw, X, Film, Music2, Settings2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Bring Your Catalog Home — the back-catalog migration assistant ────
   Move Home drafts the home; this brings the body of work that already
   exists. From the creator's ALREADY-connected accounts only, it lists
   what isn't home yet and the creator picks what crosses over; bulk
   upload of their own files is the door that always works. Then the AI
   rebuild drafts back what re-uploading used to lose — titles,
   descriptions, captions, chapters, series grouping — and NOTHING goes
   live until the creator approves each piece. Free, always.
   The honesty is the product: your work moves, your followers don't —
   no platform lets anyone take an audience, and this page never says
   otherwise. Where a platform won't hand over a file, the item says so
   in plain words instead of being scraped around. */

type ItemStatus = "listed" | "fetching" | "here" | "ready" | "approved" | "blocked" | "failed" | "dismissed";

interface DraftNote { part: string; state: "done" | "skipped"; reason?: string }
interface ImportDraft {
  title: string;
  description: string;
  tags: string[];
  captions: string | null;
  chapters: Array<{ atSec: number; label: string }>;
  series: { name: string; season: number; episode: number } | null;
  notes: DraftNote[];
  source: "ai" | "assembled";
}

interface ImportItem {
  id: string;
  sourceKind: "connected" | "upload";
  platform: string | null;
  socialAccountId: string | null;
  kind: "video" | "audio";
  title: string;
  originalUrl: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  status: ItemStatus;
  statusNote: string | null;
  draft: ImportDraft | null;
  targetKind: "profile_video" | "song" | null;
}

interface AccountView {
  accountId: string | null;
  platform: string;
  username: string | null;
  state: "ready" | "blocked" | "link-only";
  note: string | null;
  itemCount: number;
}

interface CatalogState {
  accounts: AccountView[];
  items: ImportItem[];
  honesty: { movesLine: string; tiktokBlocked: string; linkOnly: string; noFileUrl: string };
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  listed: "On the platform",
  fetching: "Bringing in…",
  here: "Home — needs its details",
  ready: "Draft ready for your word",
  approved: "Home",
  blocked: "Platform won't hand it over",
  failed: "Bring-in didn't land",
  dismissed: "Dismissed",
};

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  twitter: "X",
  twitch: "Twitch",
};

export default function CatalogImport() {
  usePageTitle(
    "Bring Your Catalog Home",
    "Bring your existing videos and songs home to Bow Down Visuals: pick from your connected Instagram and Facebook catalogs or bulk-upload your own files, let Thy Cheat Code rebuild the titles, captions and series grouping re-uploading would lose, and approve each piece before it goes live.",
  );
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [data, setData] = useState<CatalogState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, { title: string; description: string; tags: string }>>({});
  const [uploads, setUploads] = useState<Array<{ name: string; state: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const card = isLight
    ? "rounded-2xl border border-[#C9A84C]/50 bg-[#F7ECD2]"
    : "rounded-2xl border border-primary/25 bg-zinc-950";
  const sub = isLight ? "text-zinc-600" : "text-zinc-400";
  const head = isLight ? "text-zinc-900" : "text-white";
  const input =
    "w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors " +
    (isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-zinc-900 placeholder:text-zinc-400 focus:border-[#C9A84C]"
      : "border-white/10 bg-white/[0.04] text-white placeholder:text-zinc-500 focus:border-primary/50");
  const chip = (tone: "gold" | "dim" | "bad") =>
    "rounded-full border px-2.5 py-0.5 text-[11px] font-bold " +
    (tone === "gold"
      ? "border-primary/40 bg-primary/[0.08] text-primary"
      : tone === "bad"
        ? "border-red-500/40 bg-red-500/[0.08] text-red-300"
        : isLight
          ? "border-[#C9A84C]/40 text-zinc-600"
          : "border-white/10 text-zinc-400");

  const call = useCallback(
    async (method: string, path: string, body?: unknown): Promise<any> => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json.error ?? "Something went wrong. Try again.");
      return json;
    },
    [getAccessToken],
  );

  const refresh = useCallback(async () => {
    const d = (await call("GET", "/api/catalog-import")) as CatalogState;
    setData(d);
    setEdits((prev) => {
      const next = { ...prev };
      for (const it of d.items) {
        if (it.draft && !next[it.id]) {
          next[it.id] = { title: it.draft.title, description: it.draft.description, tags: it.draft.tags.join(", ") };
        }
      }
      return next;
    });
    return d;
  }, [call]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const d = (await call("GET", "/api/catalog-import")) as CatalogState;
        if (!cancelled) {
          setData(d);
          const seeded: Record<string, { title: string; description: string; tags: string }> = {};
          for (const it of d.items) {
            if (it.draft) seeded[it.id] = { title: it.draft.title, description: it.draft.description, tags: it.draft.tags.join(", ") };
          }
          setEdits(seeded);
        }
      } catch {
        if (!cancelled) setLoadError("Your catalog wouldn't load. Refresh to try again.");
      }
    })();
    return () => { cancelled = true; };
  }, [user, call]);

  const run = async (label: string, fn: () => Promise<void>, success: string) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy("");
    }
  };

  const scan = (account: AccountView) =>
    run(`scan-${account.accountId}`, async () => {
      const r = await call("POST", "/api/catalog-import/scan", { accountId: account.accountId });
      await refresh();
      setNotice(
        r.listed > 0
          ? `Found ${r.listed} new ${r.listed === 1 ? "piece" : "pieces"} on ${PLATFORM_LABEL[account.platform] ?? account.platform}${r.skippedNonVideo ? ` (${r.skippedNonVideo} photo posts aren't part of a catalog move)` : ""}. Pick what comes home below.`
          : `Nothing new there — everything on that account is already home or already listed.`,
      );
    }, "");

  const fetchSelected = () =>
    run("fetch-selected", async () => {
      const ids = [...selected];
      const r = await call("POST", "/api/catalog-import/fetch", { itemIds: ids });
      setSelected(new Set());
      await refresh();
      const okCount = (r.results as any[]).filter((x) => x.ok).length;
      setNotice(`${okCount} of ${ids.length} brought home. Anything the platform wouldn't hand over says why on its card.`);
    }, "");

  const fetchOne = (item: ImportItem) =>
    run(`fetch-${item.id}`, async () => {
      await call("POST", `/api/catalog-import/items/${item.id}/fetch`);
      await refresh();
    }, "Brought home. Rebuild its details below, then approve it.");

  const dismiss = (item: ImportItem) =>
    run(`dismiss-${item.id}`, async () => {
      await call("POST", `/api/catalog-import/items/${item.id}/dismiss`);
      await refresh();
    }, "Dismissed — it won't come back on the next scan.");

  const rebuild = (item: ImportItem) =>
    run(`rebuild-${item.id}`, async () => {
      await call("POST", `/api/catalog-import/items/${item.id}/rebuild`);
      await refresh();
    }, "Draft rebuilt. Read it over — nothing is live until you approve it.");

  const approve = (item: ImportItem) =>
    run(`approve-${item.id}`, async () => {
      const e = edits[item.id];
      await call("POST", `/api/catalog-import/items/${item.id}/approve`, e
        ? { title: e.title, description: e.description, tags: e.tags.split(",").map((t) => t.trim()).filter(Boolean) }
        : {});
      await refresh();
    }, item.kind === "audio" ? "Home — it's in your song library." : "Home — it's live on your profile.");

  const approveAllReady = () =>
    run("approve-all", async () => {
      const ready = (data?.items ?? []).filter((i) => i.status === "ready");
      const r = await call("POST", "/api/catalog-import/approve", { itemIds: ready.map((i) => i.id) });
      await refresh();
      const okCount = (r.results as any[]).filter((x) => x.ok).length;
      setNotice(`${okCount} of ${ready.length} approved home. Anything that couldn't land says why on its card.`);
    }, "");

  const onFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    const list = [...files].slice(0, 200);
    setError("");
    setNotice("");
    const rows = list.map((f) => ({ name: f.name, state: "Uploading…" }));
    setUploads(rows);
    const done: Array<{ key: string; filename: string; kind: "video" | "audio"; contentType: string }> = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      const kind: "video" | "audio" = f.type.startsWith("audio/") ? "audio" : "video";
      const safe = f.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);
      const key = `${user.id}/catalog-import/${crypto.randomUUID()}-${safe}`;
      try {
        const presign = await call("POST", "/api/r2/presign-upload", { key, contentType: f.type || (kind === "audio" ? "audio/mpeg" : "video/mp4") });
        const put = await fetch(presign.uploadUrl, { method: "PUT", body: f, headers: { "Content-Type": f.type } });
        if (!put.ok) throw new Error("upload failed");
        done.push({ key, filename: f.name, kind, contentType: f.type });
        rows[i] = { name: f.name, state: "Uploaded — registering…" };
      } catch {
        rows[i] = { name: f.name, state: "Didn't upload — try it again" };
      }
      setUploads([...rows]);
    }
    if (done.length > 0) {
      try {
        await call("POST", "/api/catalog-import/uploads", { files: done });
        setUploads(rows.map((r) => (r.state.startsWith("Uploaded") ? { ...r, state: "Home — waiting below for its details" } : r)));
        await refresh();
        setNotice(`${done.length} ${done.length === 1 ? "file" : "files"} home. Rebuild their details below, then approve each one.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Registration stumbled. Refresh — the files are in your storage.");
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <Library className="mx-auto h-10 w-10 text-primary" />
        <h1 className={`mt-4 text-2xl font-black ${head}`}>Bring Your Catalog Home</h1>
        <p className={`mt-2 text-sm ${sub}`}>Sign in to bring your existing work home — your business lives here.</p>
        <Link href="/login?next=/catalog-import" className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black">
          Sign in <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <p className={`text-sm font-semibold ${head}`}>{loadError}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const listedItems = data.items.filter((i) => ["listed", "blocked", "failed", "fetching"].includes(i.status));
  const waitingItems = data.items.filter((i) => i.status === "here" || i.status === "ready");
  const homeItems = data.items.filter((i) => i.status === "approved");
  const readyCount = waitingItems.filter((i) => i.status === "ready").length;
  const selectable = listedItems.filter((i) => i.status === "listed" || i.status === "failed");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 md:px-6">
      {/* ── Header ── */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25">
          <Library className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className={`text-2xl font-black md:text-3xl ${head}`}>Bring Your Catalog Home</h1>
          <p className={`mt-1 max-w-xl text-sm ${sub}`}>
            {data.honesty.movesLine}{" "}
            <span className="font-semibold text-primary">Free — bringing your work home never costs credits.</span>
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-sm font-semibold text-red-300">{error}</div>
      )}
      {notice && !error && (
        <div className="mt-5 rounded-2xl border border-primary/30 bg-primary/[0.07] px-4 py-3 text-sm font-semibold text-primary">{notice}</div>
      )}

      {/* ── Connected accounts ── */}
      <section className={`mt-6 p-5 ${card}`}>
        <h2 className={`flex items-center gap-2 text-base font-black ${head}`}>
          <ScanSearch className="h-4 w-4 text-primary" /> Your connected accounts
        </h2>
        <p className={`mt-1 text-xs ${sub}`}>
          Only accounts you connected yourself can be read — and only your own posts on them. What each
          platform actually allows is stated on its card, never dressed up.
        </p>
        {data.accounts.length === 0 && (
          <div className="mt-4">
            <p className={`text-sm ${sub}`}>No socials connected yet. Connect Instagram or Facebook first, then come back and scan.</p>
            <Link href="/settings" className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black">
              <Settings2 className="h-4 w-4" /> Connect an account in Settings
            </Link>
          </div>
        )}
        <div className="mt-4 space-y-3">
          {data.accounts.map((a) => (
            <div key={`${a.platform}-${a.accountId ?? a.username ?? ""}`} className={`flex flex-wrap items-start gap-3 rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-black ${head}`}>
                  {PLATFORM_LABEL[a.platform] ?? a.platform}
                  {a.username ? <span className={`ml-2 text-xs font-semibold ${sub}`}>@{a.username}</span> : null}
                </p>
                {a.state === "ready" && (
                  <p className={`mt-1 text-xs ${sub}`}>
                    {a.itemCount > 0 ? `${a.itemCount} ${a.itemCount === 1 ? "piece" : "pieces"} in your import list.` : "Ready when you are — scan to see what's not home yet."}
                  </p>
                )}
                {a.state !== "ready" && a.note && (
                  <p className={`mt-1 flex items-start gap-1.5 text-xs ${sub}`}>
                    <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" /> {a.note}
                  </p>
                )}
              </div>
              {a.state === "ready" ? (
                <button
                  onClick={() => scan(a)}
                  disabled={busy === `scan-${a.accountId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
                >
                  {busy === `scan-${a.accountId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                  Scan my posts
                </button>
              ) : (
                <span className={chip("bad")}>{a.state === "link-only" ? "Display link only" : "Can't read a catalog"}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Still on the platform ── */}
      {listedItems.length > 0 && (
        <section className={`mt-6 p-5 ${card}`}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className={`flex flex-1 items-center gap-2 text-base font-black ${head}`}>
              <Film className="h-4 w-4 text-primary" /> Still on the platform
            </h2>
            {selected.size > 0 && (
              <button
                onClick={fetchSelected}
                disabled={busy === "fetch-selected"}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
              >
                {busy === "fetch-selected" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                Bring in selected ({selected.size})
              </button>
            )}
          </div>
          <p className={`mt-1 text-xs ${sub}`}>Pick what crosses over. Nothing comes home until you pick it — and nothing is published until you approve it further down.</p>
          <div className="mt-4 space-y-2">
            {listedItems.map((item) => (
              <div key={item.id} className={`flex items-start gap-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/[0.03]"}`}>
                {(item.status === "listed" || item.status === "failed") && (
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-[#C9A84C]"
                    checked={selected.has(item.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(item.id); else next.delete(item.id);
                      setSelected(next);
                    }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-bold ${head}`}>{item.title}</p>
                  <p className={`mt-0.5 flex flex-wrap items-center gap-2 text-xs ${sub}`}>
                    <span>{item.platform ? PLATFORM_LABEL[item.platform] ?? item.platform : "Upload"}</span>
                    <span className={chip(item.status === "blocked" || item.status === "failed" ? "bad" : "dim")}>{STATUS_LABEL[item.status]}</span>
                    {item.originalUrl && (
                      <a className="inline-flex items-center gap-1 font-semibold text-primary" href={item.originalUrl} target="_blank" rel="noreferrer">
                        View original <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </p>
                  {item.statusNote && <p className="mt-1 text-xs text-red-300">{item.statusNote}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {(item.status === "listed" || item.status === "failed") && (
                    <button
                      onClick={() => fetchOne(item)}
                      disabled={busy === `fetch-${item.id}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50"
                    >
                      {busy === `fetch-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                      {item.status === "failed" ? "Retry" : "Bring in"}
                    </button>
                  )}
                  {item.status !== "fetching" && (
                    <button
                      onClick={() => dismiss(item)}
                      disabled={busy === `dismiss-${item.id}`}
                      className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${isLight ? "border-[#C9A84C]/40 text-zinc-600" : "border-white/10 text-zinc-400"}`}
                    >
                      <X className="h-3.5 w-3.5" /> Dismiss
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {selectable.length > 0 && selected.size === 0 && (
            <p className={`mt-3 text-xs ${sub}`}>Tip: tick several and bring them in together.</p>
          )}
        </section>
      )}

      {/* ── Bulk upload ── */}
      <section className={`mt-6 p-5 ${card}`}>
        <h2 className={`flex items-center gap-2 text-base font-black ${head}`}>
          <UploadCloud className="h-4 w-4 text-primary" /> Bulk upload — the door that always works
        </h2>
        <p className={`mt-1 text-xs ${sub}`}>
          For everything a platform won't hand over — TikTok, YouTube, anywhere — upload the original files
          yourself, as many at once as you like. Only upload your own work.
        </p>
        <input ref={fileRef} type="file" multiple accept="video/*,audio/*" className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <button
          onClick={() => fileRef.current?.click()}
          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm font-bold ${isLight ? "border-[#C9A84C]/60 text-zinc-700" : "border-primary/40 text-zinc-200"}`}
        >
          <UploadCloud className="h-5 w-5 text-primary" /> Choose video & audio files
        </button>
        {uploads.length > 0 && (
          <div className="mt-3 space-y-1">
            {uploads.map((u, i) => (
              <p key={i} className={`flex items-center gap-2 text-xs ${sub}`}>
                {u.state.startsWith("Home") ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : u.state.includes("Didn't") ? <Ban className="h-3.5 w-3.5 text-red-300" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span className="font-semibold">{u.name}</span> — {u.state}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* ── Home, waiting for your word ── */}
      {waitingItems.length > 0 && (
        <section className={`mt-6 p-5 ${card}`}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className={`flex flex-1 items-center gap-2 text-base font-black ${head}`}>
              <Sparkles className="h-4 w-4 text-primary" /> Home — waiting for your word
            </h2>
            {readyCount > 1 && (
              <button
                onClick={approveAllReady}
                disabled={busy === "approve-all"}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
              >
                {busy === "approve-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve all ready ({readyCount})
              </button>
            )}
          </div>
          <p className={`mt-1 text-xs ${sub}`}>
            These files are on Bow Down storage, but nothing is published yet. Rebuild the details re-uploading
            would have cost you — then approve each piece, or the whole ready batch at once.
          </p>
          <div className="mt-4 space-y-3">
            {waitingItems.map((item) => {
              const e = edits[item.id];
              return (
                <div key={item.id} className={`rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="h-14 w-24 shrink-0 rounded-lg object-cover" />}
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-black ${head}`}>{item.title}</p>
                      <p className={`mt-0.5 flex flex-wrap items-center gap-2 text-xs ${sub}`}>
                        {item.kind === "audio" ? <Music2 className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
                        <span>{item.platform ? PLATFORM_LABEL[item.platform] ?? item.platform : "Your upload"}</span>
                        <span className={chip("gold")}>{STATUS_LABEL[item.status]}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => rebuild(item)}
                        disabled={busy === `rebuild-${item.id}`}
                        className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${isLight ? "border-[#C9A84C]/50 text-zinc-700" : "border-primary/40 text-primary"}`}
                      >
                        {busy === `rebuild-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {item.draft ? "Rebuild again" : "Rebuild the details"}
                      </button>
                      <button
                        onClick={() => approve(item)}
                        disabled={busy === `approve-${item.id}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50"
                      >
                        {busy === `approve-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Approve — put it home
                      </button>
                    </div>
                  </div>

                  {item.draft && e && (
                    <div className="mt-4 space-y-3">
                      <p className={`text-xs ${sub}`}>
                        {item.draft.source === "ai"
                          ? "Drafted by Thy Cheat Code from your original words and the transcript — your facts only, nothing invented."
                          : "Assembled from your own original title and caption — the AI polish didn't answer, so nothing was dressed up as more than it is."}
                      </p>
                      <label className="block">
                        <span className={`mb-1 block text-xs font-bold ${sub}`}>Title</span>
                        <input className={input} value={e.title} onChange={(ev) => setEdits({ ...edits, [item.id]: { ...e, title: ev.target.value } })} />
                      </label>
                      <label className="block">
                        <span className={`mb-1 block text-xs font-bold ${sub}`}>Description</span>
                        <textarea className={input} rows={3} value={e.description} onChange={(ev) => setEdits({ ...edits, [item.id]: { ...e, description: ev.target.value } })} />
                      </label>
                      <label className="block">
                        <span className={`mb-1 block text-xs font-bold ${sub}`}>Tags (comma separated)</span>
                        <input className={input} value={e.tags} onChange={(ev) => setEdits({ ...edits, [item.id]: { ...e, tags: ev.target.value } })} />
                      </label>
                      {item.draft.series && (
                        <p className={`text-xs ${sub}`}>
                          Series: <span className="font-bold text-primary">{item.draft.series.name}</span> — season {item.draft.series.season}, episode {item.draft.series.episode}. Approving files it into that series on your profile.
                        </p>
                      )}
                      {item.draft.chapters.length > 0 && (
                        <p className={`text-xs ${sub}`}>
                          Chapters: {item.draft.chapters.map((c) => `${Math.floor(c.atSec / 60)}:${String(c.atSec % 60).padStart(2, "0")} ${c.label}`).join(" · ")}
                        </p>
                      )}
                      {item.draft.captions && (
                        <p className={`line-clamp-3 text-xs italic ${sub}`}>Captions: “{item.draft.captions.slice(0, 300)}”</p>
                      )}
                      <ul className={`space-y-1 text-xs ${sub}`}>
                        {item.draft.notes.map((n) => (
                          <li key={n.part} className="flex items-start gap-1.5">
                            {n.state === "done" ? (
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                            ) : (
                              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
                            )}
                            <span>
                              <span className="font-bold capitalize">{n.part}</span>
                              {n.state === "skipped" && n.reason ? <> — {n.reason}</> : " — rebuilt"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Home ── */}
      {homeItems.length > 0 && (
        <section className={`mt-6 p-5 ${card}`}>
          <h2 className={`flex items-center gap-2 text-base font-black ${head}`}>
            <CheckCircle2 className="h-4 w-4 text-primary" /> Home
          </h2>
          <div className="mt-3 space-y-2">
            {homeItems.map((item) => (
              <p key={item.id} className={`flex flex-wrap items-center gap-2 text-sm ${sub}`}>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                <span className={`font-bold ${head}`}>{item.draft?.title ?? item.title}</span>
                <span>— {item.targetKind === "song" ? "in your song library" : "live on your profile"}</span>
              </p>
            ))}
          </div>
          <p className={`mt-3 text-xs ${sub}`}>
            Your audience finds this work through your one home link now — and your{" "}
            <Link className="font-semibold text-primary underline underline-offset-2" href="/email-list">email list</Link>{" "}
            is how they become yours for good.
          </p>
        </section>
      )}
    </div>
  );
}
