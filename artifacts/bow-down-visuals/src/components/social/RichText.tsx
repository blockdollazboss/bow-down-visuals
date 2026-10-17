import { Link } from "wouter";
import { kingGifUrl, parseKingTokens } from "@/lib/king-emoji";
import { KingSticker, useKingArtTheme } from "./KingEmoji";

/* Renders post bodies with the link graph baked in:
   @handle → /artist/:slug   ·   #tag → /hashtag/:tag
   :king-laugh: → the King's sticker, inline at text height
   :gif-king-bow: → the King's GIF, on its own line
   Unknown :codes: stay literal text, untouched. */
export function RichText({ body, className }: { body: string; className?: string }) {
  const theme = useKingArtTheme();
  type Part =
    | string
    | { mention: string }
    | { tag: string }
    | { king: string }
    | { kingGif: string };
  const parts: Part[] = [];
  const re = /(^|[\s(])(@[a-z0-9][a-z0-9-]{1,38}[a-z0-9]|#[A-Za-z0-9_]{2,40})/gi;
  let last = 0;
  let m: RegExpExecArray | null;

  /* Plain-text runs between links go through the King tokenizer, so a
     shortcode lights up wherever it lands in the body — the two
     tokenizers never compete (a shortcode holds no @ or #). */
  const pushText = (text: string) => {
    if (!text) return;
    for (const kp of parseKingTokens(text)) {
      if (kp.type === "text") {
        if (kp.value) parts.push(kp.value);
      } else if (kp.type === "emoji") {
        parts.push({ king: kp.code });
      } else {
        parts.push({ kingGif: kp.code });
      }
    }
  };

  while ((m = re.exec(body)) !== null) {
    const token = m[2];
    const idx = (m.index ?? 0) + m[1].length;
    if (idx > last) pushText(body.slice(last, idx));
    if (token.startsWith("@")) parts.push({ mention: token.slice(1).toLowerCase() });
    else parts.push({ tag: token.slice(1).toLowerCase() });
    last = idx + token.length;
  }
  if (last < body.length) pushText(body.slice(last));
  return (
    <p className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : "mention" in p ? (
          <Link key={i} href={`/artist/${p.mention}`} className="text-[#d4af37] hover:underline font-medium">
            @{p.mention}
          </Link>
        ) : "tag" in p ? (
          <Link key={i} href={`/hashtag/${p.tag}`} className="text-[#d4af37] hover:underline font-medium">
            #{p.tag}
          </Link>
        ) : "king" in p ? (
          <KingSticker key={i} code={p.king} theme={theme} />
        ) : (
          <img
            key={i}
            src={kingGifUrl(p.kingGif, theme) ?? ""}
            alt={`:${p.kingGif}:`}
            title={`:${p.kingGif}:`}
            draggable={false}
            className="my-1.5 block max-h-44 w-auto max-w-full rounded-xl border border-[#C9A84C]/30 object-contain"
          />
        ),
      )}
    </p>
  );
}
