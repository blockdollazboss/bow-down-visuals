import { Link } from "wouter";

/* Renders post bodies with the link graph baked in:
   @handle → /artist/:slug   ·   #tag → /hashtag/:tag */
export function RichText({ body, className }: { body: string; className?: string }) {
  const parts: Array<string | { mention: string } | { tag: string }> = [];
  const re = /(^|[\s(])(@[a-z0-9][a-z0-9-]{1,38}[a-z0-9]|#[A-Za-z0-9_]{2,40})/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const token = m[2];
    const idx = (m.index ?? 0) + m[1].length;
    if (idx > last) parts.push(body.slice(last, idx));
    if (token.startsWith("@")) parts.push({ mention: token.slice(1).toLowerCase() });
    else parts.push({ tag: token.slice(1).toLowerCase() });
    last = idx + token.length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return (
    <p className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : "mention" in p ? (
          <Link key={i} href={`/artist/${p.mention}`} className="text-[#d4af37] hover:underline font-medium">
            @{p.mention}
          </Link>
        ) : (
          <Link key={i} href={`/hashtag/${p.tag}`} className="text-[#d4af37] hover:underline font-medium">
            #{p.tag}
          </Link>
        ),
      )}
    </p>
  );
}
