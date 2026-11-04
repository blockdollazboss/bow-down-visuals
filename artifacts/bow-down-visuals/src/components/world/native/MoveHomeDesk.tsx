import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Home, Loader2, Pencil, RotateCcw, SkipForward, Wand2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "@/components/world/native/NativeStates";
import {
  MOVE_HOME_ALL_SETTLED_COPY,
  MOVE_HOME_ANSWERS_PATH,
  MOVE_HOME_APPROVE_COPY,
  MOVE_HOME_BLOCKER_COPY,
  MOVE_HOME_PATH,
  MOVE_HOME_VERTICALS,
  buildMoveHomeAnswersPayload,
  moveHomeAllSettled,
  moveHomeAnswersDraftOf,
  moveHomeAnswersReady,
  moveHomeDraftCost,
  moveHomeDraftOf,
  moveHomeDraftPath,
  moveHomeStatusOfResponse,
  moveHomeStepPath,
  withLocale,
  type MoveHomeAnswersDraft,
  type MoveHomeStatusView,
  type MoveHomeStepKey,
  type MoveHomeStepView,
} from "@/lib/world/move-home-desk";

/* ─── Move-home desk — World parity wave #4b, census item 31 ─────
   The guided "move your home here" setup (pages/move-home.tsx),
   native in the My Studio stack on the page's own free rails
   (lib/world/move-home-desk carries the seam):
   - the intake answers form (the page's answers schema);
   - the draft run — free, pinned to the registry's cost-0 row;
   - the five steps with the RAIL's own titles, blurbs, statuses,
     and blockers; a blocked step shows its blocker and offers no
     approve the rail would refuse;
   - per-step previews + typed editors riding each step's own
     strict PATCH schema;
   - approve / skip / reopen, with what approve does per step
     stated in plain words before the click.
   Members only (every rail is requireAuth): guests get the
   square's usual sign-in line. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getAccessToken]);
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : [];
}

/* ─── Per-step preview lines (the draft's own words) ────────────── */

function previewLines(step: MoveHomeStepKey, draft: Record<string, unknown>): string[] {
  if (step === "profile") {
    return [
      s(draft["displayName"]) && `Name: ${s(draft["displayName"])}`,
      s(draft["bio"]),
      s(draft["slug"]) && `Page: /${s(draft["slug"])}`,
    ].filter(Boolean) as string[];
  }
  if (step === "store") {
    return arr(draft["products"]).map((p) => {
      const cents = typeof p["priceCents"] === "number" ? p["priceCents"] : 0;
      return `${s(p["title"]) || "Untitled"} — $${(cents / 100).toFixed(2)}`;
    });
  }
  if (step === "press_kit") {
    return [s(draft["artistName"]), s(draft["tagline"]), s(draft["bio"])].filter(Boolean);
  }
  if (step === "email_list") {
    return [
      s(draft["name"]) && `List: ${s(draft["name"])}`,
      s(draft["welcomeSubject"]) && `Welcome subject: ${s(draft["welcomeSubject"])}`,
      s(draft["welcomeBody"]),
    ].filter(Boolean) as string[];
  }
  return arr(draft["posts"]).map(
    (p) => `${s(p["accountLabel"]) || s(p["platform"])}: ${s(p["caption"]).slice(0, 140)}`,
  );
}

/* ─── Per-step editors — each rides its own PATCH schema ────────── */

interface EditorProps {
  isLight: boolean;
  draft: Record<string, unknown>;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onCancel: () => void;
}

function EditorShell({ isLight, busy, onSaveClick, onCancel, children }: {
  isLight: boolean;
  busy: boolean;
  onSaveClick: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 space-y-2" data-testid="world-move-home-editor">
      {children}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={goldBtn} disabled={busy} onClick={onSaveClick} data-testid="world-move-home-editor-save">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save edits
        </button>
        <button type="button" className={chipBtn(isLight)} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ProfileEditor({ isLight, draft, busy, onSave, onCancel }: EditorProps) {
  const links = rec(draft["socialLinks"]);
  const [displayName, setDisplayName] = useState(s(draft["displayName"]));
  const [bio, setBio] = useState(s(draft["bio"]));
  const [slug, setSlug] = useState(s(draft["slug"]));
  const [linksText, setLinksText] = useState(
    Object.entries(links).map(([k, v]) => `${k}: ${s(v)}`).join("\n"),
  );
  const save = () => {
    const socialLinks: Record<string, string> = {};
    for (const line of linksText.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key && value) socialLinks[key] = value;
      }
    }
    onSave({ displayName: displayName.trim(), bio: bio.trim(), slug: slug.trim(), socialLinks });
  };
  return (
    <EditorShell isLight={isLight} busy={busy} onSaveClick={save} onCancel={onCancel}>
      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} className={inputCls(isLight)} aria-label="Display name" placeholder="Display name" />
      <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={1200} rows={3} className={inputCls(isLight)} aria-label="Bio" placeholder="Bio" />
      <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={60} className={inputCls(isLight)} aria-label="Page address" placeholder="your-page-name" />
      <textarea value={linksText} onChange={(e) => setLinksText(e.target.value)} rows={2} className={inputCls(isLight)} aria-label="Social links, one per line as name: link" placeholder={"Social links, one per line:\ninstagram: https://…"} />
    </EditorShell>
  );
}

function StoreEditor({ isLight, draft, busy, onSave, onCancel }: EditorProps) {
  const [products, setProducts] = useState(() =>
    arr(draft["products"]).map((p) => ({
      kind: s(p["kind"]) === "digital" ? "digital" : "download",
      title: s(p["title"]),
      description: s(p["description"]),
      dollars: typeof p["priceCents"] === "number" ? String(p["priceCents"] / 100) : "",
      sourceTrackId: typeof p["sourceTrackId"] === "string" ? p["sourceTrackId"] : undefined,
      suggestedPrice: p["suggestedPrice"] === true,
    })),
  );
  const setP = (i: number, patch: Partial<(typeof products)[number]>) =>
    setProducts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const ready = products.length > 0 && products.every((p) => p.title.trim() && Number(p.dollars) > 0);
  const save = () =>
    onSave({
      products: products.map((p) => ({
        kind: p.kind,
        title: p.title.trim(),
        description: p.description.trim(),
        priceCents: Math.round(Number(p.dollars) * 100),
        ...(p.sourceTrackId ? { sourceTrackId: p.sourceTrackId } : {}),
        suggestedPrice: p.suggestedPrice,
      })),
    });
  return (
    <EditorShell isLight={isLight} busy={busy || !ready} onSaveClick={save} onCancel={onCancel}>
      {products.map((p, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-[#d4af37]/25 p-2.5">
          <input value={p.title} onChange={(e) => setP(i, { title: e.target.value })} maxLength={120} className={inputCls(isLight)} aria-label={`Product ${i + 1} title`} placeholder="Product title" />
          <textarea value={p.description} onChange={(e) => setP(i, { description: e.target.value })} maxLength={600} rows={2} className={inputCls(isLight)} aria-label={`Product ${i + 1} description`} placeholder="What the buyer gets" />
          <div className="flex gap-2">
            <input value={p.dollars} onChange={(e) => setP(i, { dollars: e.target.value })} inputMode="decimal" className={`${inputCls(isLight)} w-28`} aria-label={`Product ${i + 1} price in dollars`} placeholder="Price $" />
            <select value={p.kind} onChange={(e) => setP(i, { kind: e.target.value })} className={`${inputCls(isLight)} w-36`} aria-label={`Product ${i + 1} kind`}>
              <option value="download">Download</option>
              <option value="digital">Digital</option>
            </select>
          </div>
        </div>
      ))}
      <p className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>
        These save as shop drafts — nothing is for sale until you publish them in your shop.
      </p>
    </EditorShell>
  );
}

function PressKitEditor({ isLight, draft, busy, onSave, onCancel }: EditorProps) {
  const fields = ["artistName", "tagline", "genre", "location", "instagramUrl", "tiktokUrl", "youtubeUrl", "handle"] as const;
  const labels: Record<string, string> = {
    artistName: "Artist name", tagline: "Tagline", genre: "Genre", location: "Location",
    instagramUrl: "Instagram link", tiktokUrl: "TikTok link", youtubeUrl: "YouTube link", handle: "Handle",
  };
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries([...fields, "bio"].map((f) => [f, s(draft[f])])),
  );
  const save = () => onSave(Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim()])));
  return (
    <EditorShell isLight={isLight} busy={busy} onSaveClick={save} onCancel={onCancel}>
      {fields.map((f) => (
        <input key={f} value={vals[f] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f]: e.target.value }))} className={inputCls(isLight)} aria-label={labels[f]} placeholder={labels[f]} />
      ))}
      <textarea value={vals["bio"] ?? ""} onChange={(e) => setVals((v) => ({ ...v, bio: e.target.value }))} maxLength={3000} rows={4} className={inputCls(isLight)} aria-label="Press kit bio" placeholder="Bio" />
    </EditorShell>
  );
}

function EmailListEditor({ isLight, draft, busy, onSave, onCancel }: EditorProps) {
  const [name, setName] = useState(s(draft["name"]));
  const [description, setDescription] = useState(s(draft["description"]));
  const [subject, setSubject] = useState(s(draft["welcomeSubject"]));
  const [body, setBody] = useState(s(draft["welcomeBody"]));
  const save = () =>
    onSave({ name: name.trim(), description: description.trim(), welcomeSubject: subject.trim(), welcomeBody: body.trim() });
  return (
    <EditorShell isLight={isLight} busy={busy} onSaveClick={save} onCancel={onCancel}>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={inputCls(isLight)} aria-label="List name" placeholder="List name" />
      <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} className={inputCls(isLight)} aria-label="List description" placeholder="What subscribers get" />
      <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} className={inputCls(isLight)} aria-label="Welcome email subject" placeholder="Welcome email subject" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={4} className={inputCls(isLight)} aria-label="Welcome email body" placeholder="Welcome email" />
    </EditorShell>
  );
}

function LaunchPostsEditor({ isLight, draft, busy, onSave, onCancel }: EditorProps) {
  const [posts, setPosts] = useState(() =>
    arr(draft["posts"]).map((p) => ({
      platform: s(p["platform"]),
      accountId: s(p["accountId"]),
      accountLabel: s(p["accountLabel"]),
      caption: s(p["caption"]),
      hashtags: s(p["hashtags"]),
      mediaUrl: typeof p["mediaUrl"] === "string" ? p["mediaUrl"] : null,
      mediaType: s(p["mediaType"]) === "image" ? ("image" as const) : ("video" as const),
    })),
  );
  const setP = (i: number, patch: Partial<(typeof posts)[number]>) =>
    setPosts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const save = () =>
    onSave({
      posts: posts.map((p) => ({
        platform: p.platform,
        accountId: p.accountId,
        accountLabel: p.accountLabel,
        caption: p.caption.trim(),
        hashtags: p.hashtags.trim(),
        mediaUrl: p.mediaUrl,
        mediaType: p.mediaType,
      })),
    });
  return (
    <EditorShell isLight={isLight} busy={busy} onSaveClick={save} onCancel={onCancel}>
      {posts.map((p, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-[#d4af37]/25 p-2.5">
          <p className={`text-xs font-bold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            {p.accountLabel || p.platform} — the account stays as connected; edit the words.
          </p>
          <textarea value={p.caption} onChange={(e) => setP(i, { caption: e.target.value })} maxLength={2200} rows={3} className={inputCls(isLight)} aria-label={`Post ${i + 1} caption`} placeholder="Caption" />
          <input value={p.hashtags} onChange={(e) => setP(i, { hashtags: e.target.value })} maxLength={500} className={inputCls(isLight)} aria-label={`Post ${i + 1} hashtags`} placeholder="#hashtags" />
        </div>
      ))}
    </EditorShell>
  );
}

const EDITORS: Record<MoveHomeStepKey, (p: EditorProps) => React.ReactNode> = {
  profile: (p) => <ProfileEditor {...p} />,
  store: (p) => <StoreEditor {...p} />,
  press_kit: (p) => <PressKitEditor {...p} />,
  email_list: (p) => <EmailListEditor {...p} />,
  launch_posts: (p) => <LaunchPostsEditor {...p} />,
};

/* ─── The desk ──────────────────────────────────────────────────── */

export function MoveHomeDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const authHeaders = useAuthHeaders();
  const [status, setStatus] = useState<MoveHomeStatusView | null>(null);
  const [failed, setFailed] = useState(false);
  const [answers, setAnswers] = useState<MoveHomeAnswersDraft | null>(null);
  const [editing, setEditing] = useState<MoveHomeStepKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const noteCls = `text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const applyStatus = useCallback((view: MoveHomeStatusView) => {
    setStatus(view);
    setAnswers((cur) => cur ?? moveHomeAnswersDraftOf(view.answers));
  }, []);

  const load = useCallback(async () => {
    if (isGuest) return;
    setFailed(false);
    try {
      const res = await fetch(withLocale(MOVE_HOME_PATH, locale), { headers: await authHeaders() });
      if (!res.ok) throw new Error("move-home");
      const parsed = moveHomeStatusOfResponse(await res.json().catch(() => ({})));
      if (!parsed) throw new Error("move-home");
      applyStatus(parsed);
    } catch {
      setFailed(true);
    }
  }, [authHeaders, isGuest, locale, applyStatus]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<MoveHomeStatusView | null>, okNote: string) => {
    if (busy) return;
    setBusy(key);
    setNote(null);
    try {
      const view = await fn();
      if (view) applyStatus(view);
      setNote(okNote);
    } catch (err) {
      setNote(plainErrorText(err, "That didn't go through. Try again in a moment."));
    } finally {
      setBusy(null);
    }
  };

  const post = async (path: string, body?: unknown): Promise<MoveHomeStatusView> => {
    const res = await fetch(withLocale(path, locale), {
      method: "POST",
      headers: await authHeaders(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(apiErrorMessage(data, "That didn't go through."));
    const parsed = moveHomeStatusOfResponse(data);
    if (!parsed) throw new Error("That didn't go through.");
    return parsed;
  };

  const saveAnswers = () => {
    if (!answers) return;
    void run("answers", async () => {
      const res = await fetch(withLocale(MOVE_HOME_ANSWERS_PATH, locale), {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify(buildMoveHomeAnswersPayload(answers)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, "Your answers couldn't be saved."));
      /* The PUT answers rail returns no status body — re-read it. */
      const again = await fetch(withLocale(MOVE_HOME_PATH, locale), { headers: await authHeaders() });
      const parsed = moveHomeStatusOfResponse(await again.json().catch(() => ({})));
      if (!parsed) throw new Error("Your answers couldn't be saved.");
      return parsed;
    }, "Answers saved.");
  };

  const buildDrafts = () =>
    void run("draft", () => post("/api/move-home/draft"), "Drafts built — look each step over, edit anything, then approve the ones you like.");

  const saveStepEdit = (step: MoveHomeStepKey) => (payload: Record<string, unknown>) =>
    void run(`edit-${step}`, async () => {
      const res = await fetch(withLocale(moveHomeDraftPath(step), locale), {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, "Those edits couldn't be saved."));
      const parsed = moveHomeStatusOfResponse(data);
      if (!parsed) throw new Error("Those edits couldn't be saved.");
      setEditing(null);
      return parsed;
    }, "Edits saved — still a draft until you approve it.");

  const stepVerb = (step: MoveHomeStepView, verb: "approve" | "skip" | "reopen") =>
    void run(`${verb}-${step.key}`, () => post(moveHomeStepPath(step.key, verb)), {
      approve: `“${step.title}” is approved and live.`,
      skip: `“${step.title}” skipped — you can reopen it any time.`,
      reopen: `“${step.title}” is back as a draft.`,
    }[verb]);

  const setA = (patch: Partial<MoveHomeAnswersDraft>) => setAnswers((a) => (a ? { ...a, ...patch } : a));

  if (isGuest) {
    return (
      <div className="space-y-2" data-testid="world-move-home-desk">
        <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
          <Home className="h-4 w-4 text-[#d4af37]" /> Move your home here
        </p>
        <p className={`text-sm ${muted}`}>
          Members get the guided five-step move — profile, starter shop, press kit, email list, and launch posts, drafted for you free. Sign in to run yours.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="world-move-home-desk">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <Home className="h-4 w-4 text-[#d4af37]" /> Move your home here
      </p>
      <p className={`text-sm ${muted}`}>
        Five steps and your whole home base is set up — drafted from your answers, approved by you one step at a time.
        The whole move is free ({moveHomeDraftCost()} credits — it never charges).
      </p>

      {failed ? (
        <NativeErrorState
          isLight={isLight}
          title="Your move wouldn't load"
          message="Your setup progress couldn't be reached. Nothing changed — try again."
          onRetry={() => void load()}
        />
      ) : status === null || answers === null ? (
        <NativeLoadingState isLight={isLight} message="Loading your move…" />
      ) : (
        <>
          <p className={`text-xs ${muted}`} data-testid="world-move-home-context">
            {status.context.hasProfile
              ? `Profile: ${status.context.profileSlug ? `/${status.context.profileSlug}` : "set up"}`
              : "No profile yet — step one builds it"}
            {" · "}
            {status.context.trackCount} songs · {status.context.videoCount} videos
            {" · "}
            {status.context.connectedPlatforms.length > 0
              ? `Connected: ${status.context.connectedPlatforms.map((p) => p.label).join(", ")}`
              : "No social accounts connected yet"}
          </p>

          {moveHomeAllSettled(status) ? (
            <p className={noteCls} data-testid="world-move-home-done">{MOVE_HOME_ALL_SETTLED_COPY}</p>
          ) : null}

          {/* The intake answers. */}
          <div className={`rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`} data-testid="world-move-home-answers">
            <p className={`text-sm font-bold ${strong}`}>Your answers</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input value={answers.displayName} onChange={(e) => setA({ displayName: e.target.value })} maxLength={80} className={inputCls(isLight)} placeholder="Your artist / creator name" aria-label="Your name" data-testid="world-move-home-name" />
              <select value={answers.vertical} onChange={(e) => setA({ vertical: e.target.value })} className={inputCls(isLight)} aria-label="What you make" data-testid="world-move-home-vertical">
                {MOVE_HOME_VERTICALS.map((v) => (
                  <option key={v} value={v}>{v[0]!.toUpperCase() + v.slice(1)}</option>
                ))}
              </select>
              <input value={answers.genre} onChange={(e) => setA({ genre: e.target.value })} maxLength={60} className={inputCls(isLight)} placeholder="Genre / niche" aria-label="Genre" />
              <input value={answers.tagline} onChange={(e) => setA({ tagline: e.target.value })} maxLength={160} className={inputCls(isLight)} placeholder="Tagline" aria-label="Tagline" />
              <input value={answers.location} onChange={(e) => setA({ location: e.target.value })} maxLength={80} className={inputCls(isLight)} placeholder="Location" aria-label="Location" />
              <input value={answers.handle} onChange={(e) => setA({ handle: e.target.value })} maxLength={40} className={inputCls(isLight)} placeholder="Handle fans know you by" aria-label="Handle" />
            </div>
            <input value={answers.starterProductTitle} onChange={(e) => setA({ starterProductTitle: e.target.value })} maxLength={120} className={`${inputCls(isLight)} mt-2`} placeholder="First thing you'd sell (optional)" aria-label="Starter product" />
            <textarea value={answers.bioSeed} onChange={(e) => setA({ bioSeed: e.target.value })} maxLength={600} rows={3} className={`${inputCls(isLight)} mt-2`} placeholder="A few lines about you — your story, your sound, what fans get" aria-label="About you" />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={chipBtn(isLight)} disabled={busy !== null} onClick={saveAnswers} data-testid="world-move-home-save-answers">
                {busy === "answers" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save answers
              </button>
              <button type="button" className={goldBtn} disabled={busy !== null || !moveHomeAnswersReady(answers)} onClick={buildDrafts} data-testid="world-move-home-build">
                {busy === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Build my five drafts — free
              </button>
            </div>
            {status.copySource ? (
              <p className={`mt-2 text-xs ${muted}`}>
                Draft copy: {status.copySource === "ai" ? "written by the AI writer from your answers" : "assembled from your answers"} — edit any of it below.
              </p>
            ) : null}
          </div>

          {/* The five steps. */}
          <div className="space-y-2">
            {status.steps.map((step) => {
              const draft = moveHomeDraftOf(status, step.key);
              const lines = draft ? previewLines(step.key, draft) : [];
              return (
                <div key={step.key} className={`rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`} data-testid={`world-move-home-step-${step.key}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`text-sm font-bold ${strong}`}>{step.title}</p>
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${step.status === "approved" ? "bg-emerald-500/20 text-emerald-500" : step.status === "skipped" ? "bg-white/10 text-white/50" : step.blockedReason ? "bg-amber-500/20 text-amber-500" : "bg-[#d4af37]/20 text-[#d4af37]"}`}>
                      {step.blockedReason ? "Needs something first" : step.status === "pending" ? "Not drafted" : step.status === "drafted" ? "Draft ready" : step.status === "approved" ? "Live" : "Skipped"}
                    </span>
                  </div>
                  <p className={`mt-0.5 text-xs ${muted}`}>{step.blurb}</p>
                  {step.blockedReason ? (
                    <p className="mt-1.5 text-sm text-amber-500" data-testid={`world-move-home-blocker-${step.key}`}>
                      {MOVE_HOME_BLOCKER_COPY[step.blockedReason]}
                    </p>
                  ) : null}
                  {lines.length > 0 ? (
                    <div className={`mt-2 space-y-1 text-sm ${isLight ? "text-[#4d3f1c]" : "text-white/75"}`}>
                      {lines.slice(0, 6).map((line, i) => (
                        <p key={i} className="whitespace-pre-wrap break-words">{line}</p>
                      ))}
                    </div>
                  ) : null}
                  {step.status === "drafted" ? (
                    <p className={`mt-2 text-xs ${muted}`}>{MOVE_HOME_APPROVE_COPY[step.key]}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {step.status === "drafted" && draft ? (
                      <>
                        <button type="button" className={chipBtn(isLight)} disabled={busy !== null} aria-expanded={editing === step.key} onClick={() => setEditing(editing === step.key ? null : step.key)} data-testid={`world-move-home-edit-${step.key}`}>
                          <Pencil className="h-3.5 w-3.5" /> {editing === step.key ? "Close the editor" : "Edit the draft"}
                        </button>
                        <button type="button" className={goldBtn} disabled={busy !== null} onClick={() => stepVerb(step, "approve")} data-testid={`world-move-home-approve-${step.key}`}>
                          {busy === `approve-${step.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                        </button>
                        <button type="button" className={chipBtn(isLight)} disabled={busy !== null} onClick={() => stepVerb(step, "skip")} data-testid={`world-move-home-skip-${step.key}`}>
                          <SkipForward className="h-3.5 w-3.5" /> Skip
                        </button>
                      </>
                    ) : null}
                    {(step.status === "approved" || step.status === "skipped") ? (
                      <button type="button" className={chipBtn(isLight)} disabled={busy !== null} onClick={() => stepVerb(step, "reopen")} data-testid={`world-move-home-reopen-${step.key}`}>
                        <RotateCcw className="h-3.5 w-3.5" /> Reopen
                      </button>
                    ) : null}
                    {step.status === "pending" && !step.blockedReason ? (
                      <span className={`text-xs ${muted}`}>Builds with the draft run above.</span>
                    ) : null}
                  </div>
                  {editing === step.key && draft ? (
                    <div key={`${step.key}-${step.status}`}>
                      {EDITORS[step.key]({
                        isLight,
                        draft,
                        busy: busy === `edit-${step.key}`,
                        onSave: saveStepEdit(step.key),
                        onCancel: () => setEditing(null),
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {note ? <p className={noteCls} data-testid="world-move-home-note">{note}</p> : null}
          {status.steps.length === 0 ? (
            <NativeEmptyState isLight={isLight} message="No steps came back" detail="Your move couldn't be read. Try loading it again." />
          ) : null}
        </>
      )}
    </div>
  );
}
