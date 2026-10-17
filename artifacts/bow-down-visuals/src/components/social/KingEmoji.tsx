import { useEffect, useRef, useState } from "react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  KING_EMOJI,
  KING_GIFS,
  kingEmojiUrl,
  kingGifUrl,
  kingToken,
  parseKingTokens,
  REACTION_ART,
  type KingArtTheme,
  type KingGifDef,
} from "@/lib/king-emoji";

/* ─── The King's emoji/GIF set — shared React surface ────────────────────
   One art map, one token renderer, one picker tray, reused by posts,
   stream chat, the palace say box and DMs. Theme follows the site's own
   light/dark switch: light theme serves the cream-robed King's set,
   dark theme the black-robed King's set. */

export function useKingArtTheme(): KingArtTheme {
  return useIsLightTheme() ? "light" : "dark";
}

/** A single sticker, inline-sized by the caller's className. */
export function KingSticker({
  code,
  theme,
  className,
}: {
  code: string;
  theme?: KingArtTheme;
  className?: string;
}) {
  const hookTheme = useKingArtTheme();
  const url = kingEmojiUrl(code, theme ?? hookTheme);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={`:${code}:`}
      title={`:${code}:`}
      draggable={false}
      className={className ?? "inline-block h-[1.4em] w-[1.4em] object-contain align-[-0.3em]"}
    />
  );
}

/** The custom art for one of the five server reaction keys. */
export function ReactionSticker({
  reaction,
  theme,
  className,
}: {
  reaction: string;
  theme?: KingArtTheme;
  className?: string;
}) {
  const hookTheme = useKingArtTheme();
  const art = (REACTION_ART as Record<string, { code: string; label: string }>)[reaction];
  if (!art) return null;
  const url = kingEmojiUrl(art.code, theme ?? hookTheme);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={art.label}
      title={art.label}
      draggable={false}
      className={className ?? "inline-block h-6 w-6 object-contain"}
    />
  );
}

/**
 * Renders a message body with King shortcodes lit up: `:king-laugh:`
 * becomes the sticker inline at text height, `:gif-king-bow:` the
 * animated GIF on its own line. Everything else — including unknown
 * `:codes:` — stays literal text. No wrapper element: the caller owns
 * the paragraph/bubble so each surface keeps its own typography.
 */
export function KingTokenText({
  body,
  theme,
  stickerClassName,
  gifClassName,
}: {
  body: string;
  theme?: KingArtTheme;
  stickerClassName?: string;
  gifClassName?: string;
}) {
  const hookTheme = useKingArtTheme();
  const t = theme ?? hookTheme;
  const parts = parseKingTokens(body);
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") return <span key={i}>{p.value}</span>;
        if (p.type === "emoji") {
          return <KingSticker key={i} code={p.code} theme={t} className={stickerClassName} />;
        }
        const url = kingGifUrl(p.code, t);
        if (!url) return <span key={i}>{`:${p.code}:`}</span>;
        return (
          <img
            key={i}
            src={url}
            alt={`:${p.code}:`}
            title={`:${p.code}:`}
            draggable={false}
            className={
              gifClassName ??
              "my-1 block max-h-40 w-auto max-w-full rounded-xl border border-[#C9A84C]/30 object-contain"
            }
          />
        );
      })}
    </>
  );
}

/* ─── The picker tray ────────────────────────────────────────────────────
   One tray for every composer: the 12 stickers + the GIF shelf.
   Picking a sticker hands the host its `:code:` token (the host writes
   it into its draft as text). Picking a GIF calls `onPickGif` first —
   a host with an image-attachment path (the post Composer) claims it
   there and returns true; otherwise the GIF rides as a `:gif-…:` token
   in the text, which every renderer in this file lights up. */

export function EmojiTray({
  onPickToken,
  onPickGif,
  tone,
  buttonClassName,
  buttonLabel = "King emoji & GIFs",
}: {
  onPickToken: (token: string) => void;
  onPickGif?: (gif: KingGifDef) => boolean;
  /** Panel tone; defaults to the live site theme. */
  tone?: KingArtTheme;
  buttonClassName?: string;
  buttonLabel?: string;
}) {
  const theme = useKingArtTheme();
  const panelTone = tone ?? theme;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open ]);

  const isLight = panelTone === "light";
  const panelCls = isLight
    ? "border-[#C9A84C]/50 bg-[#FCF7EA] text-[#2A1E07] shadow-[0_18px_50px_rgba(122,90,18,0.25)]"
    : "border-[#C9A84C]/40 bg-[#14100a] text-white shadow-[0_18px_50px_rgba(0,0,0,0.6)]";
  const subCls = isLight ? "text-[#6B5B36]" : "text-white/45";

  function pickGif(gif: KingGifDef) {
    if (onPickGif && onPickGif(gif)) {
      setOpen(false);
      return;
    }
    onPickToken(kingToken(gif.code));
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={buttonLabel}
        aria-expanded={open}
        title={buttonLabel}
        data-testid="king-emoji-tray-button"
        className={
          buttonClassName ??
          "rounded-full p-1.5 transition hover:scale-110 hover:bg-[#d4af37]/10"
        }
      >
        <img
          src={kingEmojiUrl("king-laugh", theme) ?? ""}
          alt=""
          draggable={false}
          className="h-6 w-6 object-contain"
        />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={buttonLabel}
          data-testid="king-emoji-tray"
          className={`absolute bottom-full left-0 z-40 mb-2 w-[300px] rounded-2xl border p-3 ${panelCls}`}
        >
          <p className={`text-[10px] font-black uppercase tracking-widest ${subCls}`}>
            King Emoji
          </p>
          <div className="mt-2 grid grid-cols-6 gap-1">
            {KING_EMOJI.map((e) => (
              <button
                key={e.code}
                type="button"
                title={`:${e.code}:`}
                aria-label={e.label}
                data-testid={`king-emoji-pick-${e.code}`}
                onClick={() => {
                  onPickToken(kingToken(e.code));
                  setOpen(false);
                }}
                className="rounded-xl p-1 transition hover:scale-110 hover:bg-[#d4af37]/15"
              >
                <img
                  src={kingEmojiUrl(e.code, theme) ?? ""}
                  alt={e.label}
                  draggable={false}
                  className="h-9 w-9 object-contain"
                />
              </button>
            ))}
          </div>
          <p className={`mt-3 text-[10px] font-black uppercase tracking-widest ${subCls}`}>
            King GIFs
          </p>
          <div className="mt-2 flex gap-2">
            {KING_GIFS.map((g) => (
              <button
                key={g.code}
                type="button"
                title={g.label}
                aria-label={g.label}
                data-testid={`king-gif-pick-${g.code}`}
                onClick={() => pickGif(g)}
                className="overflow-hidden rounded-xl border border-[#C9A84C]/30 transition hover:scale-[1.04] hover:border-[#C9A84C]/70"
              >
                <img
                  src={kingGifUrl(g.code, theme) ?? ""}
                  alt={g.label}
                  draggable={false}
                  className="h-16 w-16 object-cover"
                />
              </button>
            ))}
          </div>
          <p className={`mt-2.5 text-[10px] leading-snug ${subCls}`}>
            Stickers ride as text — <span className="font-mono">:king-laugh:</span> — and light
            up anywhere King chat travels.
          </p>
        </div>
      )}
    </div>
  );
}
