/**
 * Collabs browse + inbox — honest load states (Stack-400 pin batch,
 * the "empty lie" family). The page's third load, "my profile", is
 * pinned separately in collabs-my-profile-honest-load.test.ts and
 * is not re-pinned here.
 *
 * Browse and inbox each carry the same machine: the loader throws
 * on !res.ok; the catch records the section's load-error state —
 * but only when the section has never loaded (the loaded ref keeps
 * a failed reload from blanking rows already on screen). Each
 * section renders loading → error panel with a retry wired to the
 * real loader → the empty copy, in that order, so a failed first
 * load can never read as "no creators" or "no requests". The error
 * copy is hardcoded English literals; the empty copy goes through
 * collabs.* keys, pinned for all 10 catalogs below.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./collabs.tsx");
const browseAt = page.indexOf("async function loadBrowse()");
const browse = page.slice(browseAt, page.indexOf("async function loadMyProfile()", browseAt));
const inboxAt = page.indexOf("async function loadInbox()");
const inbox = page.slice(inboxAt, page.indexOf("useEffect(() => {", inboxAt));

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("browse — failure path", () => {
  it("the loader throws on a non-ok response and records the error only if browse never loaded", () => {
    expect(browse).toContain('if (!res.ok) throw new Error("browse load failed");');
    expect(browse).toContain("if (!browseLoadedRef.current) setBrowseLoadError(true);");
  });

  it("a successful load records the profiles and the loaded outcome; each attempt clears the error first", () => {
    expect(browse).toContain("setProfiles((data.profiles as CreatorProfile[]) ?? []);");
    expect(browse).toContain("browseLoadedRef.current = true;");
    expect(browse).toContain("setBrowseLoadError(false);");
    expect(browse.indexOf("setBrowseLoadError(false);")).toBeLessThan(browse.indexOf("throw new Error"));
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain("Couldn't load creators.");
    expect(page).toContain("onClick={() => loadBrowse()}");
  });

  it("the empty copy renders only after the loading and failure branches", () => {
    const loadingAt = page.indexOf("browseLoading ? (");
    const errAt = page.indexOf("browseLoadError ? (");
    const emptyAt = page.indexOf('t("collabs.emptyBrowse")');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("inbox — failure path", () => {
  it("the loader throws on a non-ok response and records the error only if the inbox never loaded", () => {
    expect(inbox).toContain('if (!res.ok) throw new Error("inbox load failed");');
    expect(inbox).toContain("if (!inboxLoadedRef.current) setInboxLoadError(true);");
  });

  it("a successful load records both lists and the loaded outcome", () => {
    expect(inbox).toContain("setReceived((data.received as InboxRequest[]) ?? []);");
    expect(inbox).toContain("setSent((data.sent as InboxRequest[]) ?? []);");
    expect(inbox).toContain("inboxLoadedRef.current = true;");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain("Couldn't load your inbox.");
    expect(page).toContain("onClick={() => loadInbox()}");
  });

  it("the empty copies render only after the loading and failure branches", () => {
    const loadingAt = page.indexOf("inboxLoading ? (");
    const errAt = page.indexOf("inboxLoadError ? (");
    const emptyAt = page.indexOf('t("collabs.emptyReceived")');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errAt);
    expect(page).toContain('t("collabs.emptySent")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the collabs honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["collabs.emptyBrowse", "collabs.emptyReceived", "collabs.emptySent"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
