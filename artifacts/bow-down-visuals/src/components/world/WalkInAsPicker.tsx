/**
 * WalkInAsPicker — "Walk in as": choose who you are in the King's
 * Hall. The house default (the palace guard — a King Shark of the
 * hall, never the King's own character) or one of your Creative
 * Vault characters — its portrait stands in the hall on a gold-framed
 * panel, and its lips move when you talk. Signed-in members only;
 * the world page renders this for them alone.
 *
 * Honest states, no dead ends: characters without a portrait can't
 * stand in the hall yet and say so; an empty vault links straight to
 * the Creative Vault to make one; a failed load keeps the house
 * avatar walk-in working and says what happened.
 */
import { Link } from "wouter";
import { Crown, Sparkles, Check } from "lucide-react";
import { characterMonogram, type VaultCharacter } from "@/lib/world/characters";

interface WalkInAsPickerProps {
  /** null while the vault read is in flight. */
  characters: VaultCharacter[] | null;
  loadFailed: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  isLight: boolean;
}

export default function WalkInAsPicker({ characters, loadFailed, selectedId, onSelect, isLight }: WalkInAsPickerProps) {
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
          {/* The house default — who you are with no pick: the
              palace guard, standing life-size in the hall. */}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`${tileBase} ${selectedId === null ? tileActive : tileIdle}`}
            data-testid="walk-in-house"
            aria-pressed={selectedId === null}
          >
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${isLight ? "bg-[#C9A84C]/20" : "bg-[#d4af37]/15"}`}>
              <Crown className="h-6 w-6 text-[#d4af37]" />
            </span>
            <span className="min-w-0">
              <span className={`flex items-center gap-1 text-sm font-bold ${nameCls}`}>
                Palace Guard
                {selectedId === null ? <Check className="h-4 w-4 text-[#d4af37]" /> : null}
              </span>
              <span className={`block truncate text-[11px] ${subCls}`}>The house default</span>
            </span>
          </button>

          {characters === null && !loadFailed ? (
            <span className={`px-2 text-xs ${subCls}`}>Loading your characters…</span>
          ) : null}

          {loadFailed ? (
            <span className={`px-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
              Your characters couldn't load — the palace guard has you covered.
            </span>
          ) : null}

          {(characters ?? []).map((c) =>
            c.portraitUrl ? (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className={`${tileBase} ${selectedId === c.id ? tileActive : tileIdle}`}
                data-testid={`walk-in-character-${c.id}`}
                aria-pressed={selectedId === c.id}
              >
                <img
                  src={c.portraitUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                  loading="lazy"
                />
                <span className="min-w-0">
                  <span className={`flex items-center gap-1 text-sm font-bold ${nameCls}`}>
                    <span className="truncate">{c.name}</span>
                    {selectedId === c.id ? <Check className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" /> : null}
                  </span>
                  <span className={`block truncate text-[11px] ${subCls}`}>Creative Vault</span>
                </span>
              </button>
            ) : (
              <div
                key={c.id}
                className={`${tileBase} cursor-not-allowed opacity-60 ${tileIdle}`}
                data-testid={`walk-in-character-${c.id}`}
                title="This character has no portrait yet"
              >
                {/* No portrait yet: a house placeholder — the
                    character's monogram on a gold disc — never a
                    broken-image glyph. */}
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
            ),
          )}

          {characters !== null && characters.length === 0 && !loadFailed ? (
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
