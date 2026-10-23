/**
 * WalkInAsPicker — "Walk in as": choose who you are in the King's
 * Hall. A house guard (the palace guards — King Sharks of the hall,
 * never the King's own character; the male guard is the house
 * default, and with no pick at all the hall deals you one of the
 * two) or one of your Creative Vault characters — its portrait
 * stands in the hall on a gold-framed panel, and its lips move when
 * you talk. Signed-in members only; the world page renders this for
 * them alone.
 *
 * Honest states, no dead ends: a character with a living loop
 * but no portrait still stands — its tile is the loop itself,
 * moving; only a character with neither says so and sits out; an
 * empty vault links straight to the Creative Vault to make one;
 * a failed load keeps the house avatar walk-in working and says
 * what happened.
 *
 * Managing, not just picking: a member's OWN characters carry a
 * manage button that opens a strip under the row — rename and
 * remove, riding the vault's own rails (PUT / DELETE
 * /api/artist-vaults/:id). Team-shared characters get no button:
 * those verbs are the owner's alone.
 *
 * Creation + appearance (stack-100 #98): the strip also restyles —
 * portrait URL, look fields and theme — on the same PUT rail (the
 * host round-trips the full row, so untouched fields survive), and
 * a "New character" strip creates one on the vault's POST rail.
 * What still lives only in the Creative Vault: generating portraits
 * and living loops, identity photos and locked-regalia tooling —
 * the strip says so rather than faking them.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Sparkles, Check, Pencil, X, Trash2, Plus, Palette } from "lucide-react";
import { characterMonogram, type VaultCharacter, type VaultAppearance } from "@/lib/world/characters";
import { CHARACTER_THEMES } from "@/lib/character-themes";
import {
  HOUSE_GUARD_ID,
  HOUSE_GUARD_FEMALE_ID,
  guardCharacterUrl,
  type GuardVariant,
} from "@/lib/world/figure";

interface WalkInAsPickerProps {
  /** null while the vault read is in flight. */
  characters: VaultCharacter[] | null;
  loadFailed: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  isLight: boolean;
  /** Rename one of the member's own characters (the vault PUT rail).
   *  Omit both manage handlers and the picker is select-only. */
  onRename?: (id: string, newName: string) => Promise<void>;
  /** Remove one of the member's own characters (the vault DELETE
   *  rail — a soft delete: hidden everywhere, data kept). */
  onRemove?: (id: string) => Promise<void>;
  /** Create a new character (the vault POST rail, #98). Omit and
   *  the create tile keeps its Creative Vault link-out. */
  onCreate?: (input: { artistName: string; appearance: Partial<VaultAppearance> }) => Promise<void>;
  /** Read one character's stored appearance for the restyle form
   *  (the vault list read, #98). */
  onLoadAppearance?: (id: string) => Promise<{ name: string; appearance: VaultAppearance }>;
  /** Save an appearance edit (the vault PUT rail, full round-trip
   *  host-side, #98). Offered on own rows only, like rename. */
  onSaveAppearance?: (id: string, patch: Partial<VaultAppearance>) => Promise<void>;
}

/* The appearance fields the restyle/create strips edit — the
   character's look, in the vault form's own groupings. themeId is a
   select over CHARACTER_THEMES and renders separately. */
const APPEARANCE_TEXT_FIELDS: { key: keyof VaultAppearance; label: string; placeholder: string }[] = [
  { key: "referenceImageUrl", label: "Portrait image URL", placeholder: "https://… — the face the hall stands in" },
  { key: "artistType", label: "Type", placeholder: "Singer, rapper, producer…" },
  { key: "genre", label: "Genre", placeholder: "Hip-hop, R&B, soul…" },
  { key: "visualStyle", label: "Visual style", placeholder: "Luxury street royalty…" },
  { key: "hair", label: "Hair", placeholder: "Style, color, length…" },
  { key: "clothingStyle", label: "Clothing style", placeholder: "Signature outfits…" },
  { key: "jewelry", label: "Jewelry", placeholder: "Chains, crowns, pieces…" },
  { key: "tattoos", label: "Tattoos", placeholder: "Visible ink…" },
  { key: "brandColors", label: "Brand colors", placeholder: "Gold and black…" },
  { key: "voiceStyle", label: "Voice style", placeholder: "Deep, smooth, commanding…" },
  { key: "personality", label: "Personality", placeholder: "How they carry themselves…" },
  { key: "artistDescription", label: "Description", placeholder: "Who this character is…" },
];

type AppearanceDraft = Record<keyof VaultAppearance, string>;

function emptyAppearanceDraft(): AppearanceDraft {
  return {
    artistType: "", genre: "", voiceStyle: "", visualStyle: "", hair: "",
    tattoos: "", jewelry: "", clothingStyle: "", brandColors: "",
    themeId: "gold-royalty", personality: "", artistDescription: "",
    referenceImageUrl: "",
  };
}

function appearanceDraftFrom(a: VaultAppearance): AppearanceDraft {
  const draft = emptyAppearanceDraft();
  (Object.keys(draft) as (keyof VaultAppearance)[]).forEach((k) => {
    draft[k] = a[k] ?? "";
  });
  if (!draft.themeId) draft.themeId = "gold-royalty";
  return draft;
}

function AppearanceFields({
  draft, setDraft, isLight, testidPrefix,
}: {
  draft: AppearanceDraft;
  setDraft: (d: AppearanceDraft) => void;
  isLight: boolean;
  testidPrefix: string;
}) {
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none ${
    isLight
      ? "border-[#C9A84C]/50 bg-white text-[#2a1e07] focus:border-[#7A5A12]"
      : "border-white/15 bg-black/40 text-white focus:border-[#d4af37]/60"
  }`;
  const labelCls = `block text-[11px] font-black uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {APPEARANCE_TEXT_FIELDS.map((f) => (
        <label key={f.key} className={f.key === "referenceImageUrl" || f.key === "artistDescription" ? "sm:col-span-2" : ""}>
          <span className={labelCls}>{f.label}</span>
          <input
            value={draft[f.key]}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            placeholder={f.placeholder}
            className={`${inputCls} mt-1`}
            data-testid={`${testidPrefix}-${f.key}`}
            aria-label={f.label}
          />
        </label>
      ))}
      <label>
        <span className={labelCls}>Theme</span>
        <select
          value={draft.themeId}
          onChange={(e) => setDraft({ ...draft, themeId: e.target.value })}
          className={`${inputCls} mt-1`}
          data-testid={`${testidPrefix}-themeId`}
          aria-label="Theme"
        >
          {CHARACTER_THEMES.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default function WalkInAsPicker({ characters, loadFailed, selectedId, onSelect, isLight, onRename, onRemove, onCreate, onLoadAppearance, onSaveAppearance }: WalkInAsPickerProps) {
  const canManage = Boolean(onRename || onRemove);
  const [manageId, setManageId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  /* #98 restyle state: the loaded appearance draft for the managed
     character (null until "Restyle" opens and the row is read). */
  const [restyleOpen, setRestyleOpen] = useState(false);
  const [restyleDraft, setRestyleDraft] = useState<AppearanceDraft | null>(null);
  const [restyleLoading, setRestyleLoading] = useState(false);
  /* #98 create state. */
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDraft, setCreateDraft] = useState<AppearanceDraft>(() => emptyAppearanceDraft());
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const manageChar =
    manageId && characters ? (characters.find((c) => c.id === manageId && c.isOwn) ?? null) : null;

  const openManage = (c: VaultCharacter) => {
    setManageId(c.id);
    setDraftName(c.name);
    setConfirmingRemove(false);
    setManageError(null);
    setRestyleOpen(false);
    setRestyleDraft(null);
  };

  const closeManage = () => {
    setManageId(null);
    setConfirmingRemove(false);
    setManageError(null);
    setRestyleOpen(false);
    setRestyleDraft(null);
  };

  const openRestyle = async () => {
    if (!manageChar || !onLoadAppearance || restyleLoading) return;
    setRestyleLoading(true);
    setManageError(null);
    try {
      const { appearance } = await onLoadAppearance(manageChar.id);
      setRestyleDraft(appearanceDraftFrom(appearance));
      setRestyleOpen(true);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Couldn't read the character's look. Please try again.");
    } finally {
      setRestyleLoading(false);
    }
  };

  const saveRestyle = async () => {
    if (!manageChar || !onSaveAppearance || !restyleDraft || manageBusy) return;
    setManageBusy(true);
    setManageError(null);
    try {
      await onSaveAppearance(manageChar.id, { ...restyleDraft });
      closeManage();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Couldn't save the new look. Please try again.");
    } finally {
      setManageBusy(false);
    }
  };

  const submitCreate = async () => {
    if (!onCreate || createBusy || !createName.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await onCreate({ artistName: createName, appearance: { ...createDraft } });
      setCreateOpen(false);
      setCreateName("");
      setCreateDraft(emptyAppearanceDraft());
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't create the character. Please try again.");
    } finally {
      setCreateBusy(false);
    }
  };

  const saveRename = async () => {
    if (!manageChar || !onRename || manageBusy) return;
    setManageBusy(true);
    setManageError(null);
    try {
      await onRename(manageChar.id, draftName);
      closeManage();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Couldn't rename the character. Please try again.");
    } finally {
      setManageBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!manageChar || !onRemove || manageBusy) return;
    setManageBusy(true);
    setManageError(null);
    try {
      await onRemove(manageChar.id);
      closeManage();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Couldn't remove the character. Please try again.");
    } finally {
      setManageBusy(false);
    }
  };
  const tileBase =
    "group flex min-w-[148px] items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition";
  const tileIdle = isLight
    ? "border-[#C9A84C]/40 bg-white/50 hover:border-[#7A5A12]/60"
    : "border-white/10 bg-white/5 hover:border-[#d4af37]/50";
  const tileActive = isLight
    ? "border-[#7A5A12] bg-[#C9A84C]/15 ring-2 ring-[#C9A84C]/60"
    : "border-[#d4af37] bg-[#d4af37]/10 ring-2 ring-[#d4af37]/50";
  const nameCls = isLight ? "text-[#2a1e07]" : "text-white";
  const subCls = isLight ? "text-[#6B5B36]" : "text-white/45";

  return (
    <div
      className={`relative z-20 border-b px-4 py-3 ${isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"}`}
      data-testid="walk-in-as"
    >
      {/* The prompt in plain words — the owner walked past this row
          when it was a quiet utility strip, so it speaks up now:
          who you pick is who everyone inside sees. */}
      <p className={`mb-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        Pick who you stand in the hall as — <span className={isLight ? "text-[#2a1e07]" : "text-white/85"}>everyone inside sees this.</span>
      </p>
      <div className="flex items-center gap-3">
        <span className={`shrink-0 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          Walk in as
        </span>
        <div className="flex flex-1 items-center gap-2 overflow-x-auto pb-0.5">
          {/* The house guards — who you are with no vault pick. The
              male guard is the house default (this tile also stands
              for "no explicit pick", which the hall deals between
              the two guards); picking either tile explicitly makes
              that guard yours. */}
          {(
            [
              { id: HOUSE_GUARD_ID, variant: "male" as GuardVariant, name: "Palace Guard", testid: "walk-in-house" },
              { id: HOUSE_GUARD_FEMALE_ID, variant: "female" as GuardVariant, name: "Palace Guard — Female", testid: "walk-in-house-female" },
            ]
          ).map((guard) => {
            const selected =
              selectedId === guard.id || (guard.variant === "male" && selectedId === null);
            return (
              <button
                key={guard.id}
                type="button"
                onClick={() => onSelect(guard.id)}
                className={`${tileBase} ${selected ? tileActive : tileIdle}`}
                data-testid={guard.testid}
                aria-pressed={selected}
              >
                <img
                  src={guardCharacterUrl(import.meta.env.BASE_URL, guard.variant)}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-xl object-cover object-top"
                  loading="lazy"
                />
                <span className="min-w-0">
                  <span className={`flex items-center gap-1 text-sm font-bold ${nameCls}`}>
                    {guard.name}
                    {selected ? <Check className="h-4 w-4 shrink-0 text-[#d4af37]" /> : null}
                  </span>
                  <span className={`block truncate text-[11px] ${subCls}`}>The house default</span>
                </span>
              </button>
            );
          })}

          {characters === null && !loadFailed ? (
            <span className={`px-2 text-xs ${subCls}`}>Loading your characters…</span>
          ) : null}

          {loadFailed ? (
            <span className={`px-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
              Your characters couldn't load — the palace guard has you covered.
            </span>
          ) : null}

          {(characters ?? []).map((c) => {
            const selectable = Boolean(c.portraitUrl || c.loopUrl);
            /* Manage is the owner's verb: own rows only, and only
               when the host wired the vault rails in. The badge sits
               on the tile's corner so it never steals the tile's own
               tap (selecting who you stand as). */
            const manageBadge =
              canManage && c.isOwn ? (
                <button
                  type="button"
                  onClick={() => (manageId === c.id ? closeManage() : openManage(c))}
                  className={`absolute -right-1.5 -top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border shadow ${
                    isLight
                      ? "border-[#7A5A12]/60 bg-[#FBF6E9] text-[#7A5A12] hover:bg-[#F7ECD2]"
                      : "border-[#d4af37]/60 bg-[#171106] text-[#e8c86a] hover:bg-[#2a1e07]"
                  }`}
                  data-testid={`walk-in-manage-${c.id}`}
                  aria-label={`Manage ${c.name}`}
                  aria-expanded={manageId === c.id}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              ) : null;
            if (!selectable) {
              return (
                <div key={c.id} className="relative shrink-0">
                  {manageBadge}
                <div
                  className={`${tileBase} cursor-not-allowed opacity-60 ${tileIdle}`}
                  data-testid={`walk-in-character-${c.id}`}
                  title="This character has no portrait or living loop yet"
                >
                  {/* Nothing to stand as yet: a house placeholder —
                      the character's monogram on a gold disc — never
                      a broken-image glyph. */}
                  <span
                    aria-hidden
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-black ${
                      isLight
                        ? "bg-gradient-to-b from-[#e8c86a] to-[#C9A84C] text-[#2a1e07] ring-1 ring-[#7A5A12]/50"
                        : "bg-gradient-to-b from-[#e8c86a] to-[#b8860b] text-[#171106] ring-1 ring-[#d4af37]/60"
                    }`}
                  >
                    {characterMonogram(c.name)}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate text-xs font-bold ${nameCls}`}>{c.name}</span>
                    <span className={`block truncate text-[11px] ${subCls}`}>No portrait yet</span>
                  </span>
                </div>
                </div>
              );
            }
            return (
              <div key={c.id} className="relative shrink-0">
                {manageBadge}
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className={`${tileBase} ${selectedId === c.id ? tileActive : tileIdle}`}
                data-testid={`walk-in-character-${c.id}`}
                aria-pressed={selectedId === c.id}
              >
                {c.portraitUrl ? (
                  <img
                    src={c.portraitUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-xl object-cover"
                    loading="lazy"
                  />
                ) : (
                  /* Video-only character: the tile IS its living
                     portrait — the loop itself, moving — never a
                     dead tile. */
                  <video
                    src={c.loopUrl ?? undefined}
                    muted
                    loop
                    autoPlay
                    playsInline
                    preload="metadata"
                    className="h-12 w-12 shrink-0 rounded-xl object-cover"
                  />
                )}
                <span className="min-w-0">
                  <span className={`flex items-center gap-1 text-sm font-bold ${nameCls}`}>
                    <span className="truncate">{c.name}</span>
                    {selectedId === c.id ? <Check className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" /> : null}
                  </span>
                  <span className={`block truncate text-[11px] ${subCls}`}>
                    {c.portraitUrl ? "Creative Vault" : "Creative Vault · Living portrait"}
                  </span>
                </span>
              </button>
              </div>
            );
          })}

          {characters !== null && characters.length === 0 && !loadFailed ? (
            onCreate ? (
              <button
                type="button"
                onClick={() => { setCreateOpen(true); setCreateError(null); }}
                className={`${tileBase} ${tileIdle}`}
                data-testid="walk-in-create"
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isLight ? "bg-[#C9A84C]/20" : "bg-[#d4af37]/15"}`}>
                  <Sparkles className="h-5 w-5 text-[#d4af37]" />
                </span>
                <span className="min-w-0">
                  <span className={`block text-xs font-bold ${nameCls}`}>Create a character</span>
                  <span className={`block truncate text-[11px] ${subCls}`}>Right here — name it, style it</span>
                </span>
              </button>
            ) : (
              <Link
                href="/artist-vault"
                className={`${tileBase} ${tileIdle}`}
                data-testid="walk-in-create"
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isLight ? "bg-[#C9A84C]/20" : "bg-[#d4af37]/15"}`}>
                  <Sparkles className="h-5 w-5 text-[#d4af37]" />
                </span>
                <span className="min-w-0">
                  <span className={`block text-xs font-bold ${nameCls}`}>Create a character</span>
                  <span className={`block truncate text-[11px] ${subCls}`}>In the Creative Vault</span>
                </span>
              </Link>
            )
          ) : null}

          {onCreate && characters !== null && characters.length > 0 ? (
            <button
              type="button"
              onClick={() => { setCreateOpen((v) => !v); setCreateError(null); }}
              className={`${tileBase} ${tileIdle}`}
              data-testid="walk-in-create-new"
              aria-expanded={createOpen}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isLight ? "bg-[#C9A84C]/20" : "bg-[#d4af37]/15"}`}>
                <Plus className="h-5 w-5 text-[#d4af37]" />
              </span>
              <span className="min-w-0">
                <span className={`block text-xs font-bold ${nameCls}`}>New character</span>
                <span className={`block truncate text-[11px] ${subCls}`}>Make one, right here</span>
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {/* The create strip (#98) — a new character on the vault's
          POST rail, named and styled right here. It appears in the
          row the moment the host's re-read lands. */}
      {onCreate && createOpen ? (
        <div
          className={`mt-3 rounded-2xl border px-3 py-3 ${isLight ? "border-[#C9A84C]/50 bg-white/60" : "border-[#d4af37]/30 bg-white/5"}`}
          data-testid="walk-in-create-panel"
        >
          <div className="flex items-center gap-2">
            <span className={`flex-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              New character
            </span>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className={`flex h-6 w-6 items-center justify-center rounded-full ${isLight ? "text-[#6B5B36] hover:bg-[#C9A84C]/20" : "text-white/60 hover:bg-white/10"}`}
              data-testid="walk-in-create-close"
              aria-label="Close character creator"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <label className="mt-2 block">
            <span className={`block text-[11px] font-black uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Name</span>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              maxLength={80}
              placeholder="Who are they?"
              className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none ${isLight ? "border-[#C9A84C]/50 bg-white text-[#2a1e07] focus:border-[#7A5A12]" : "border-white/15 bg-black/40 text-white focus:border-[#d4af37]/60"}`}
              data-testid="walk-in-create-name"
              aria-label="New character name"
            />
          </label>
          <div className="mt-2">
            <AppearanceFields draft={createDraft} setDraft={setCreateDraft} isLight={isLight} testidPrefix="walk-in-create-field" />
          </div>
          <button
            type="button"
            onClick={() => void submitCreate()}
            disabled={createBusy || !createName.trim()}
            className="mt-3 rounded-xl bg-[#C9A84C] px-3 py-2 text-sm font-bold text-[#2a1e07] transition hover:bg-[#d4af37] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="walk-in-create-save"
          >
            {createBusy ? "Creating…" : "Create character"}
          </button>
          {createError ? (
            <p role="alert" className={`mt-2 text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{createError}</p>
          ) : null}
          <p className={`mt-2 text-[11px] ${subCls}`}>
            Born in your Creative Vault the moment you save. Generating a portrait or a living
            loop still happens in the Vault&rsquo;s studios — give it a portrait URL above and it
            can stand in the hall right away.
          </p>
        </div>
      ) : null}

      {/* The manage strip — rename / remove for the member's OWN
          character, on the vault's own rails. Only ever rendered for
          a row proven own (the server silently no-ops these verbs
          for anyone else); errors land here, never a fake success. */}
      {manageChar ? (
        <div
          className={`mt-3 rounded-2xl border px-3 py-3 ${isLight ? "border-[#C9A84C]/50 bg-white/60" : "border-[#d4af37]/30 bg-white/5"}`}
          data-testid={`walk-in-manage-panel-${manageChar.id}`}
        >
          <div className="flex items-center gap-2">
            <span className={`flex-1 truncate text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              Manage {manageChar.name}
            </span>
            <button
              type="button"
              onClick={closeManage}
              className={`flex h-6 w-6 items-center justify-center rounded-full ${isLight ? "text-[#6B5B36] hover:bg-[#C9A84C]/20" : "text-white/60 hover:bg-white/10"}`}
              data-testid="walk-in-manage-close"
              aria-label="Close character manager"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {onRename ? (
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveRename();
              }}
            >
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={80}
                className={`min-w-[180px] flex-1 rounded-xl border px-3 py-2 text-sm font-semibold outline-none ${
                  isLight
                    ? "border-[#C9A84C]/50 bg-white text-[#2a1e07] focus:border-[#7A5A12]"
                    : "border-white/15 bg-black/40 text-white focus:border-[#d4af37]/60"
                }`}
                data-testid="walk-in-rename-input"
                aria-label="Character name"
              />
              <button
                type="submit"
                disabled={manageBusy || !draftName.trim() || draftName.trim() === manageChar.name}
                className="rounded-xl bg-[#C9A84C] px-3 py-2 text-sm font-bold text-[#2a1e07] transition hover:bg-[#d4af37] disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="walk-in-rename-save"
              >
                {manageBusy ? "Saving…" : "Save name"}
              </button>
            </form>
          ) : null}

          {onRemove ? (
            confirmingRemove ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                  Remove {manageChar.name}? It's hidden everywhere — this can't be undone here.
                </span>
                <button
                  type="button"
                  onClick={() => void confirmRemove()}
                  disabled={manageBusy}
                  className="rounded-xl border border-red-400/60 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-500 transition hover:bg-red-500/25 disabled:opacity-50 dark:text-red-300"
                  data-testid="walk-in-remove-confirm"
                >
                  {manageBusy ? "Removing…" : "Yes, remove"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(false)}
                  disabled={manageBusy}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#C9A84C]/50 text-[#6B5B36]" : "border-white/15 text-white/70"}`}
                  data-testid="walk-in-remove-keep"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirmingRemove(true);
                  setManageError(null);
                }}
                className={`mt-2 inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                  isLight
                    ? "border-red-700/40 text-red-800 hover:bg-red-500/10"
                    : "border-red-400/40 text-red-300 hover:bg-red-500/10"
                }`}
                data-testid={`walk-in-remove-${manageChar.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove character
              </button>
            )
          ) : null}

          {/* Restyle (#98) — the look itself, on the same PUT rail.
              The form opens from the character's stored row, read
              fresh by the host; saving round-trips every field, so
              what you don't touch doesn't change. */}
          {onLoadAppearance && onSaveAppearance ? (
            restyleOpen && restyleDraft ? (
              <div className="mt-3" data-testid="walk-in-restyle-panel">
                <AppearanceFields draft={restyleDraft} setDraft={setRestyleDraft} isLight={isLight} testidPrefix="walk-in-restyle-field" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveRestyle()}
                    disabled={manageBusy}
                    className="rounded-xl bg-[#C9A84C] px-3 py-2 text-sm font-bold text-[#2a1e07] transition hover:bg-[#d4af37] disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="walk-in-restyle-save"
                  >
                    {manageBusy ? "Saving…" : "Save the look"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRestyleOpen(false); setRestyleDraft(null); }}
                    disabled={manageBusy}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold ${isLight ? "border-[#C9A84C]/50 text-[#6B5B36]" : "border-white/15 text-white/70"}`}
                    data-testid="walk-in-restyle-cancel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void openRestyle()}
                disabled={restyleLoading || manageBusy}
                className={`mt-3 inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${isLight ? "border-[#7A5A12]/40 text-[#7A5A12] hover:bg-[#C9A84C]/15" : "border-[#d4af37]/40 text-[#e8c86a] hover:bg-[#d4af37]/10"}`}
                data-testid="walk-in-restyle-open"
              >
                <Palette className="h-3.5 w-3.5" /> {restyleLoading ? "Reading the look…" : "Restyle — portrait, look, theme"}
              </button>
            )
          ) : null}

          {manageError ? (
            <p role="alert" className={`mt-2 text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>
              {manageError}
            </p>
          ) : null}

          <p className={`mt-2 text-[11px] ${subCls}`}>
            {onSaveAppearance
              ? "Generating portraits and living loops still happens in the Creative Vault's studios — everything about the look itself saves right here."
              : "Portrait, look and voice are edited in the Creative Vault — this only renames or removes."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
