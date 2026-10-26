import { useEffect, useState } from "react";
import {
  LayoutTemplate, Sparkles, ArrowUp, ArrowDown, Eye, EyeOff, X, Plus,
  Check, AlertTriangle, RotateCcw, Crown, Wand2, Trash2, Rocket,
} from "lucide-react";
import {
  fetchMyTemplateState,
  pickTemplateDraft,
  saveDraftLayout,
  runAiDesigner,
  approveTemplateDraft,
  discardTemplateDraft,
  fetchMyLayout,
  fetchMyThemeSettings,
  templateShelfOrder,
  draftChanges,
  draftSummary,
  moveBlock,
  toggleBlockVisibility,
  removeBlock,
  addBlock,
  addableBlockTypes,
  type ProfileTemplateStateDto,
  type ProfileBlockDto,
  type ProfileBlockTypeDef,
} from "@/lib/profile-website";
import { THEME_PRESETS } from "@/lib/artist-profiles";

/* ─── Profile templates — the shelf, the bounded designer, the gate ──────
   Docked in profile setup beside the layout editor (no standalone page).
   LEVEL 1: pick one of the six designed templates — Stage, Booth,
   Gallery, Broadcast, Press Kit, After Dark. LEVEL 2: the designer
   (Thy Cheat Code) may ONLY rearrange, add, or subtract categories —
   never freeform code, never a layout outside the templates. LEVEL 3:
   restyle the draft's colorway + fonts inside the template's language.
   EVERYTHING lands as a DRAFT: the live page does not change until the
   creator presses "Approve & publish" — and the button first reads back
   exactly what approving will change. */

export default function ProfileTemplateStudio() {
  const [state, setState] = useState<ProfileTemplateStateDto | null>(null);
  const [blockTypes, setBlockTypes] = useState<ProfileBlockTypeDef[]>([]);
  const [colorways, setColorways] = useState<Array<{ id: string; name: string }>>([]);
  const [fonts, setFonts] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [addType, setAddType] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const [tpl, layout, theme] = await Promise.all([
          fetchMyTemplateState(),
          fetchMyLayout(),
          fetchMyThemeSettings(),
        ]);
        if (cancelled) return;
        setState(tpl);
        setBlockTypes(layout.blockTypes);
        setColorways(theme.colorways);
        setFonts(theme.fonts);
        setDraftDirty(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError((err as Error).message || "Couldn't load your profile templates. Check your connection and try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  const act = async (key: string, fn: () => Promise<ProfileTemplateStateDto>, ok?: string) => {
    setBusy(key);
    setActionError(null);
    setNotice(null);
    try {
      const next = await fn();
      setState(next);
      setDraftDirty(false);
      if (ok) setNotice(ok);
    } catch (err) {
      setActionError((err as Error).message || "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const draft = state?.draft ?? null;
  const editDraft = (layout: ProfileBlockDto[], extra?: Partial<Pick<NonNullable<typeof draft>, "colorway" | "headingFont" | "bodyFont">>) => {
    if (!state || !draft) return;
    setState({ ...state, draft: { ...draft, layout, ...extra } });
    setDraftDirty(true);
    setNotice(null);
  };

  const saveDraftEdits = async () => {
    if (!draft) return;
    await act("save-draft", () =>
      saveDraftLayout({
        layout: draft.layout,
        colorway: draft.colorway,
        headingFont: draft.headingFont,
        bodyFont: draft.bodyFont,
      }),
    );
  };

  const shelf = state ? templateShelfOrder(state.templates, state.recommendedTemplateId) : [];
  const liveName = state?.liveTemplateId
    ? state.templates.find((t) => t.id === state.liveTemplateId)?.name ?? state.liveTemplateId
    : null;
  const changes = state && draft ? draftChanges(state.layout, draft.layout) : null;
  const addable = draft ? addableBlockTypes(draft.layout, blockTypes) : [];
  const colorwayName = (id: string) => colorways.find((c) => c.id === id)?.name;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="profile-template-studio">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/70">
        <LayoutTemplate className="h-4 w-4 text-amber-400" /> Profile templates
      </div>
      <p className="mb-3 text-xs text-white/40">
        Six designed templates — one page system underneath them all, so your content, store,
        memberships and domain carry across any switch untouched. Thy Cheat Code can design
        inside a template for you: rearrange, add, or remove categories only — never freeform
        code. Nothing goes live until you approve it.
      </p>

      {loadError && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <p className="text-sm text-white/70">{loadError}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {!loadError && state === null && (
        <p className="py-4 text-center text-sm text-white/40">Loading your templates…</p>
      )}

      {state !== null && (
        <>
          <p className="mb-3 text-xs text-white/50" data-testid="template-live-line">
            Live now:{" "}
            <span className="font-bold text-amber-200">
              {liveName ?? (state.isDefault ? "The Grand Stage default (Stage)" : "Your own arrangement")}
            </span>
            {draft && <span className="text-white/40"> — a draft is waiting below; your live page hasn't changed.</span>}
          </p>

          {/* ── The shelf ── */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shelf.map((t) => {
              const preset = THEME_PRESETS.find((p) => p.themeId === t.colorway);
              const isLive = state.liveTemplateId === t.id;
              const isDraft = draft?.templateId === t.id;
              return (
                <div
                  key={t.id}
                  className={`flex flex-col rounded-lg border p-3 ${
                    isDraft ? "border-amber-400/60 bg-amber-400/5" : "border-white/10 bg-black/30"
                  }`}
                  data-testid={`template-card-${t.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">{t.name}</span>
                    {t.id === "stage" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                        <Crown className="h-3 w-3" /> Flagship
                      </span>
                    )}
                    {state.recommendedTemplateId === t.id && (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/60">
                        Fits your lane
                      </span>
                    )}
                    {isLive && (
                      <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                        Live
                      </span>
                    )}
                  </div>
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-white/45">{t.tagline}</p>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/35">
                    {t.layout.filter((b) => b.visible).map((b) => b.title).join(" → ")}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                      {preset && (
                        <span className="flex -space-x-1">
                          <span className="h-3 w-3 rounded-full border border-black/40" style={{ backgroundColor: preset.colors.background }} />
                          <span className="h-3 w-3 rounded-full border border-black/40" style={{ backgroundColor: preset.colors.primary }} />
                          <span className="h-3 w-3 rounded-full border border-black/40" style={{ backgroundColor: preset.colors.accent }} />
                        </span>
                      )}
                      {colorwayName(t.colorway) ?? t.colorway} · {t.headingFont}
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void act("pick", () => pickTemplateDraft(t.id), `Draft started from ${t.name} — your live page hasn't changed.`)}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-40"
                    >
                      {isDraft ? "Restart draft" : "Use as draft"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── The designer ── */}
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
            <Sparkles className="h-4 w-4 shrink-0 text-amber-400" />
            <p className="min-w-0 flex-1 text-xs text-white/55">
              <span className="font-bold text-white/80">Design it for me.</span>{" "}
              Thy Cheat Code reads your lane and what your page actually holds, then rearranges,
              adds, or removes categories — as a draft you approve. It never publishes on its own.
            </p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act("ai", () => runAiDesigner(), "Designer draft ready — read it below, then approve when it looks right.")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2 text-xs font-bold text-black transition hover:scale-[1.02] disabled:opacity-40"
              data-testid="template-ai-design"
            >
              <Wand2 className="h-3.5 w-3.5" /> {busy === "ai" ? "Designing…" : "Design it for me"}
            </button>
          </div>

          {actionError && <p className="mt-3 text-xs font-semibold text-red-300">{actionError}</p>}
          {notice && (
            <p className="mt-3 flex items-start gap-1.5 text-xs font-semibold text-emerald-300">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notice}
            </p>
          )}

          {/* ── The draft ── */}
          {draft && (
            <div className="mt-4 border-t border-white/10 pt-4" data-testid="template-draft-panel">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold uppercase tracking-widest text-white/70">Draft</span>
                <span className="text-xs font-semibold text-amber-200">
                  {draftSummary(draft, state.templates, colorwayName)}
                </span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50">
                  {draft.source === "ai" ? "By Thy Cheat Code" : draft.source === "manual" ? "Your edits" : "From the shelf"}
                </span>
              </div>
              <p className="mb-3 text-xs text-white/40">
                This draft is NOT live. Rearrange it, restyle it, or throw it away — your page
                keeps wearing the saved look until you approve.
              </p>

              {draft.ops.length > 0 && (
                <ul className="mb-3 space-y-1 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2">
                  {draft.ops.map((op, i) => (
                    <li key={i} className="text-xs text-amber-100/80">• {op}</li>
                  ))}
                </ul>
              )}

              <ul className="space-y-1.5">
                {draft.layout.map((b, i) => (
                  <li
                    key={b.type}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                      b.visible ? "border-white/10 bg-black/30" : "border-white/5 bg-black/20 opacity-60"
                    }`}
                  >
                    <span className="w-6 shrink-0 text-center text-[11px] font-black text-amber-300/80">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{b.title}</span>
                    <button type="button" aria-label={`Move ${b.title} up`} disabled={i === 0}
                      onClick={() => editDraft(moveBlock(draft.layout, b.type, -1))}
                      className="rounded p-1.5 text-white/60 transition hover:text-amber-300 disabled:opacity-25">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={`Move ${b.title} down`} disabled={i === draft.layout.length - 1}
                      onClick={() => editDraft(moveBlock(draft.layout, b.type, 1))}
                      className="rounded p-1.5 text-white/60 transition hover:text-amber-300 disabled:opacity-25">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={`${b.visible ? "Hide" : "Show"} ${b.title}`}
                      onClick={() => editDraft(toggleBlockVisibility(draft.layout, b.type))}
                      className="rounded p-1.5 text-white/60 transition hover:text-amber-300">
                      {b.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <button type="button" aria-label={`Remove ${b.title}`}
                      onClick={() => editDraft(removeBlock(draft.layout, b.type))}
                      className="rounded p-1.5 text-white/60 transition hover:text-red-300">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>

              {addable.length > 0 && (
                <div className="mt-3 flex gap-2">
                  <select
                    value={addType}
                    onChange={(e) => setAddType(e.target.value)}
                    aria-label="Category to add to the draft"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="">Add a category…</option>
                    {addable.map((d) => (
                      <option key={d.type} value={d.type}>{d.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!addType}
                    onClick={() => {
                      const def = blockTypes.find((d) => d.type === addType);
                      if (def) editDraft(addBlock(draft.layout, def));
                      setAddType("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" /> Add
                  </button>
                </div>
              )}

              {/* Restyle — inside the template's language: registry keys only. */}
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-white/50">Colorway</span>
                  <select
                    value={draft.colorway}
                    onChange={(e) => editDraft(draft.layout, { colorway: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none"
                  >
                    {colorways.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-white/50">Heading font</span>
                  <select
                    value={draft.headingFont}
                    onChange={(e) => editDraft(draft.layout, { headingFont: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none"
                  >
                    {fonts.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-white/50">Body font</span>
                  <select
                    value={draft.bodyFont}
                    onChange={(e) => editDraft(draft.layout, { bodyFont: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none"
                  >
                    {fonts.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
              </div>

              {changes && (changes.added.length > 0 || changes.removed.length > 0 || changes.reordered) && (
                <p className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/60" data-testid="template-draft-changes">
                  Approving will:{" "}
                  {[
                    changes.added.length ? `add ${changes.added.join(", ")}` : null,
                    changes.removed.length ? `remove ${changes.removed.join(", ")}` : null,
                    changes.reordered ? "reorder your categories" : null,
                  ].filter(Boolean).join(" · ")}
                  {" "}— and restyle the page to the draft's colorway and fonts.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null || !draftDirty}
                  onClick={() => void saveDraftEdits()}
                  className="rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-40"
                >
                  {busy === "save-draft" ? "Saving draft…" : "Save draft edits"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null || draftDirty}
                  onClick={() => void act("approve", () => approveTemplateDraft(), "Published — your page wears the new template now.")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-5 py-2 text-sm font-bold text-black transition hover:scale-[1.02] disabled:opacity-40"
                  data-testid="template-approve"
                >
                  <Rocket className="h-4 w-4" /> {busy === "approve" ? "Publishing…" : "Approve & publish"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act("discard", () => discardTemplateDraft(), "Draft discarded — your live page never changed.")}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white/50 transition hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" /> Discard draft
                </button>
                {draftDirty && <span className="text-xs text-white/35">Unsaved draft edits — save them before approving.</span>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
