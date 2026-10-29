/**
 * Dead locale-key guard (stack800 lane 3, item 7).
 *
 * Locale catalogs must not accumulate keys nothing renders — a dead
 * key looks like shipped copy and rots in ten languages (the case
 * that proved it: videoExport.ffmpegStartedLabel sat in all 10
 * catalogs after the fake-telemetry line it labelled was removed
 * from the export component).
 *
 * A key counts as REFERENCED when any of these holds in src (outside
 * the catalogs themselves):
 *  1. its full dotted path appears as a dotted token (a literal
 *     t("a.b.c"), a constant, a props value — quoting irrelevant);
 *  2. its parent path appears as an exact quoted string (a namespace
 *     read or a variable holding the namespace);
 *  3. a template-composition prefix covers it: source composes keys
 *     like t(`email-list.eng_${kind}`), so the static dotted prefix
 *     before the ${…} acquits every key under it.
 * The bias is deliberate: the guard may under-report, never accuse a
 * live key. (A sibling key being referenced does NOT acquit a key —
 * only the three uses above do.)
 *
 * Implementation note: the source is tokenized ONCE into Sets (a
 * substring scan per key over the whole tree is O(keys × tree) and
 * takes minutes; the token pass takes seconds).
 *
 * Usage: node scripts/check-dead-locale-keys.mjs [locale]
 * Prints the dead keys for the catalog (default en). The ratchet in
 * src/lib/__tests__/locale-dead-key-ratchet.json freezes today's
 * known-dead set: the guard test fails when a NEW dead key appears,
 * and the ratchet may only shrink.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOTTED_TOKEN = /[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_$-]+)+/g;
const QUOTED = /["'`]([^"'`\n]{1,160})["'`]/g;
const COMPOSITION = /[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.\$\{|[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+\$\{/g;

export function collectSourceIndex(srcDir) {
  const tokens = new Set();
  const quoted = new Set();
  const compositionPrefixes = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (p !== join(srcDir, "locales")) walk(p);
      } else if (/\.(ts|tsx)$/.test(name)) {
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(DOTTED_TOKEN)) tokens.add(m[0]);
        for (const m of text.matchAll(QUOTED)) quoted.add(m[1]);
        for (const m of text.matchAll(COMPOSITION)) {
          compositionPrefixes.add(m[0].replace(/\.\$\{$|\$\{$/, ""));
        }
      }
    }
  };
  walk(srcDir);
  return { tokens, quoted, compositionPrefixes };
}

export function localeLeafKeys(catalog, prefix = "", out = []) {
  for (const [k, v] of Object.entries(catalog)) {
    const q = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") localeLeafKeys(v, q, out);
    else out.push(q);
  }
  return out;
}

export function findDeadLocaleKeys(catalog, index) {
  const { tokens, quoted, compositionPrefixes } = index;
  const prefixes = [...compositionPrefixes];
  return localeLeafKeys(catalog)
    .filter((key) => {
      if (tokens.has(key)) return false;
      const parent = key.slice(0, key.lastIndexOf("."));
      if (parent && quoted.has(parent)) return false;
      if (prefixes.some((c) => key.startsWith(c))) return false;
      return true;
    })
    .sort();
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const srcDir = join(pkgDir, "src");
  const locale = process.argv[2] ?? "en";
  const catalog = JSON.parse(
    readFileSync(join(srcDir, "locales", `${locale}.json`), "utf8"),
  );
  const dead = findDeadLocaleKeys(catalog, collectSourceIndex(srcDir));
  console.log(JSON.stringify(dead, null, 1));
  console.error(`dead keys in ${locale}.json: ${dead.length}`);
}
