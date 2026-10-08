import { useMemo } from "react";

/* ─── Safe rich text — "about me" blocks ──────────────────────────────────
   Safe subset ONLY: bold, italic, links, lists. Zero dependencies: every
   input char is HTML-escaped FIRST, then the tiny markdown subset is applied
   on top of the escaped text. NO raw HTML, NO raw script — ever. */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineFormat(escaped: string): string {
  /* Links first: [text](https://…) — only http/https allowed. */
  let out = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow" class="ap-richlink">${text}</a>`
  );
  /* Bold **…**, then italic *…* / _…_. */
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  return out;
}

/** Render safe rich text to sanitized HTML. */
export function renderRichText(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length) {
      blocks.push(`<ul class="ap-richlist">${list.map((li) => `<li>${li}</li>`).join("")}</ul>`);
      list = [];
    }
  };

  for (const line of lines) {
    const m = line.match(/^\s*[-*•]\s+(.*)$/);
    if (m) {
      list.push(inlineFormat(escapeHtml(m[1]!)));
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    blocks.push(`<p class="ap-richpara">${inlineFormat(escapeHtml(line.trim()))}</p>`);
  }
  flushList();
  return blocks.join("");
}

export function RichText({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderRichText(source), [source]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
