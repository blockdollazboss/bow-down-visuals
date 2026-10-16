import { useEffect, useState } from "react";
import {
  LayoutDashboard, ArrowUp, ArrowDown, Eye, EyeOff, X, Plus, Check,
  AlertTriangle, RotateCcw, Palette,
} from "lucide-react";
import {
  fetchMyLayout,
  saveMyLayout,
  fetchMyThemeSettings,
  saveMyThemeSettings,
  moveBlock,
  toggleBlockVisibility,
  retitleBlock,
  removeBlock,
  addBlock,
  addableBlockTypes,
  layoutSummary,
  type ProfileBlockDto,
  type ProfileBlockTypeDef,
  type ProfileThemeSettingsDto,
} from "@/lib/profile-website";
import { THEME_PRESETS } from "@/lib/artist-profiles";

/* ─── Page layout + look — profile settings editor ────────────────────────
   The block editor over the profile-as-website layout: reorder, show /
   hide, retitle, add and remove blocks from the registry — the exact
   list the public page renders, in the exact order. Untouched profiles
   open on the Grand Stage default (The Stage → The Front Row → Music →
   Videos → Store → Memberships); saving makes the arrangement the
   owner's own. Below it, the look: colorway + fonts by KEY — Royal Gold
   is the house colorway — resolved server-side into the profile theme.
   Load and save failures are honest states with retry, never a silent
   no-op; a successful save reads the stored order back to the owner. */

export default function ProfileLayoutEditor() {
  const [blocks, setBlocks] = useState<ProfileBlockDto[] | null>(null);
  const [blockTypes, setBlockTypes] = useState<ProfileBlockTypeDef[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSummary, setSavedSummary] = useState<string | null>(null);
  const [addType, setAddType] = useState("");

  const [theme, setTheme] = useState<ProfileThemeSettingsDto | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeSaved, setThemeSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const dto = await fetchMyLayout();
        if (!cancelled) {
          setBlocks(dto.layout);
          setBlockTypes(dto.blockTypes);
          setIsDefault(dto.isDefault);
          setDirty(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            (err as Error).message || "Couldn't load your page layout. Check your connection and try again.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dto = await fetchMyThemeSettings();
        if (!cancelled) setTheme(dto);
      } catch (err) {
        if (!cancelled) {
          setThemeError((err as Error).message || "Couldn't load your theme settings.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  const edit = (next: ProfileBlockDto[]) => {
    setBlocks(next);
    setDirty(true);
    setSavedSummary(null);
    setSaveError(null);
  };

  const save = async () => {
    if (!blocks) return;
    setSaving(true);
    setSaveError(null);
    try {
      const dto = await saveMyLayout(blocks);
      setBlocks(dto.layout);
      setIsDefault(dto.isDefault);
      setDirty(false);
      setSavedSummary(layoutSummary(dto.layout));
    } catch (err) {
      setSaveError((err as Error).message || "Couldn't save your layout. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const saveTheme = async () => {
    if (!theme) return;
    setThemeSaving(true);
    setThemeError(null);
    setThemeSaved(false);
    try {
      const dto = await saveMyThemeSettings({
        colorway: theme.colorway,
        headingFont: theme.headingFont,
        bodyFont: theme.bodyFont,
      });
      setTheme(dto);
      setThemeSaved(true);
    } catch (err) {
      setThemeError((err as Error).message || "Couldn't save your look. Try again.");
    } finally {
      setThemeSaving(false);
    }
  };

  const addable = blocks ? addableBlockTypes(blocks, blockTypes) : [];
  const labelFor = (type: string) =>
    blockTypes.find((d) => d.type === type)?.label ?? type;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="profile-layout-editor">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/70">
        <LayoutDashboard className="h-4 w-4 text-amber-400" /> Page layout
      </div>
      <p className="mb-3 text-xs text-white/40">
        Your page, block by block — reorder, rename, show or hide. New pages open on the Grand Stage:
        The Stage, The Front Row, Music, Videos, Store, Memberships. Make it yours and save.
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

      {!loadError && blocks === null && (
        <p className="py-4 text-center text-sm text-white/40">Loading your layout…</p>
      )}

      {blocks !== null && (
        <>
          {isDefault && !dirty && (
            <p className="mb-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              You're on the Grand Stage default order. Any change you save becomes your own arrangement.
            </p>
          )}
          <ul className="space-y-1.5">
            {blocks.map((b, i) => (
              <li
                key={b.type}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                  b.visible ? "border-white/10 bg-black/30" : "border-white/5 bg-black/20 opacity-60"
                }`}
              >
                <span className="w-6 shrink-0 text-center text-[11px] font-black text-amber-300/80">
                  {i + 1}
                </span>
                <span className="hidden w-28 shrink-0 truncate text-[11px] font-bold uppercase tracking-wider text-white/40 sm:block">
                  {labelFor(b.type)}
                </span>
                <input
                  value={b.title}
                  maxLength={80}
                  onChange={(e) => edit(retitleBlock(blocks, b.type, e.target.value))}
                  aria-label={`Title for the ${labelFor(b.type)} block`}
                  className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm font-semibold text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                />
                <button
                  type="button"
                  onClick={() => edit(moveBlock(blocks, b.type, -1))}
                  disabled={i === 0}
                  aria-label={`Move ${b.title || labelFor(b.type)} up`}
                  className="rounded p-1.5 text-white/60 transition hover:text-amber-300 disabled:opacity-25"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => edit(moveBlock(blocks, b.type, 1))}
                  disabled={i === blocks.length - 1}
                  aria-label={`Move ${b.title || labelFor(b.type)} down`}
                  className="rounded p-1.5 text-white/60 transition hover:text-amber-300 disabled:opacity-25"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => edit(toggleBlockVisibility(blocks, b.type))}
                  aria-label={`${b.visible ? "Hide" : "Show"} the ${labelFor(b.type)} block`}
                  className="rounded p-1.5 text-white/60 transition hover:text-amber-300"
                >
                  {b.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => edit(removeBlock(blocks, b.type))}
                  aria-label={`Remove the ${labelFor(b.type)} block`}
                  className="rounded p-1.5 text-white/60 transition hover:text-red-300"
                >
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
                aria-label="Block to add"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="">Add a block…</option>
                {addable.map((d) => (
                  <option key={d.type} value={d.type}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!addType}
                onClick={() => {
                  const def = blockTypes.find((d) => d.type === addType);
                  if (def) edit(addBlock(blocks, def));
                  setAddType("");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>
          )}

          {saveError && <p className="mt-3 text-xs font-semibold text-red-300">{saveError}</p>}
          {savedSummary && (
            <p className="mt-3 flex items-start gap-1.5 text-xs font-semibold text-emerald-300">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Layout saved: {savedSummary}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              className="rounded-lg bg-amber-400 px-5 py-2 text-sm font-bold text-black transition hover:scale-[1.02] disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save layout"}
            </button>
            <span className="text-xs text-white/35">
              {dirty ? "Unsaved changes — your live page still shows the saved order." : "Your live page renders exactly this order."}
            </span>
          </div>
        </>
      )}

      {/* ── The look ── */}
      <div className="mt-6 border-t border-white/10 pt-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/70">
          <Palette className="h-4 w-4 text-amber-400" /> The look
        </div>
        <p className="mb-3 text-xs text-white/40">
          Pick a colorway and your fonts. Royal Gold is the house look — golden black marble, bronze light.
        </p>

        {themeError && <p className="mb-3 text-xs font-semibold text-red-300">{themeError}</p>}
        {!theme && !themeError && (
          <p className="py-2 text-sm text-white/40">Loading your look…</p>
        )}

        {theme && (
          <>
            <div className="flex flex-wrap gap-2">
              {theme.colorways.map((c) => {
                const preset = THEME_PRESETS.find((p) => p.themeId === c.id);
                const selected = theme.colorway === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setTheme({ ...theme, colorway: c.id });
                      setThemeSaved(false);
                    }}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                      selected
                        ? "border-amber-400 bg-amber-400/15 text-amber-200"
                        : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
                    }`}
                    aria-pressed={selected}
                  >
                    {preset && (
                      <span className="flex -space-x-1">
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-black/40"
                          style={{ backgroundColor: preset.colors.background }}
                        />
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-black/40"
                          style={{ backgroundColor: preset.colors.primary }}
                        />
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-black/40"
                          style={{ backgroundColor: preset.colors.accent }}
                        />
                      </span>
                    )}
                    {c.name}
                    {c.id === "royal-gold" && <span className="text-[10px] uppercase tracking-wider text-amber-300/70">House</span>}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-white/50">Heading font</span>
                <select
                  value={theme.headingFont}
                  onChange={(e) => {
                    setTheme({ ...theme, headingFont: e.target.value });
                    setThemeSaved(false);
                  }}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none"
                >
                  {theme.fonts.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-white/50">Body font</span>
                <select
                  value={theme.bodyFont}
                  onChange={(e) => {
                    setTheme({ ...theme, bodyFont: e.target.value });
                    setThemeSaved(false);
                  }}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none"
                >
                  {theme.fonts.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void saveTheme()}
                disabled={themeSaving}
                className="rounded-lg bg-amber-400 px-5 py-2 text-sm font-bold text-black transition hover:scale-[1.02] disabled:opacity-40"
              >
                {themeSaving ? "Saving…" : "Save look"}
              </button>
              {themeSaved && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                  <Check className="h-3.5 w-3.5" /> Look saved — your page wears it now.
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
