/**
 * Admin page — honest load states (Stack-400 pin batch, the "empty
 * lie" family). The page is a stack of list sections — Jackpot
 * events, Spotlight inbox, Contact inbox, DMCA reports, Pitch & Fix
 * queue, Content reports, the removal panel's recent list, and the
 * Bow Race — and every one carries the same honest machine: the
 * loader records a dedicated load-error state on failure (never
 * acting only on res.ok in silence), the section renders loading →
 * error panel with a retry → the empty copy, in that order, so a
 * failed load can never read as an empty inbox. (User Management
 * is a lookup action, not a list load, and is out of scope.)
 * The inbox error copy is hardcoded English literals; the empty
 * copies and the Pitch & Fix / removal / Bow Race copy go through
 * admin.* keys, pinned for all 10 catalogs below.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source:
 * one slice per section, from its function header to the next.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./admin.tsx");

function slice(from: string, to: string): string {
  const a = page.indexOf(from);
  expect(a, `marker ${from}`).toBeGreaterThan(-1);
  const b = page.indexOf(to, a);
  expect(b, `end marker ${to}`).toBeGreaterThan(a);
  return page.slice(a, b);
}

const jackpot = slice("function JackpotAdmin(", "function SpotlightInbox(");
const spotlight = slice("function SpotlightInbox(", "function ContactInbox(");
const contact = slice("function ContactInbox(", "function DmcaReportsInbox(");
const dmca = slice("function DmcaReportsInbox(", "function PitchFixInbox(");
const pitchFix = slice("function PitchFixInbox(", "function ContentReportsInbox(");
const reports = slice("function ContentReportsInbox(", "function ContentRemovalPanel(");
const removal = slice("function ContentRemovalPanel(", "function UserManagement(");

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

/* The four inboxes + jackpot share one shape; each is asserted with
   its own verbatim strings inside its own slice. */
const INBOXES: Array<{
  name: string;
  section: string;
  success: string;
  failureCopy: string;
  emptyKey: string;
  emptyGate: string;
}> = [
  {
    name: "jackpot events",
    section: jackpot,
    success: "setEvents(data.events ?? []);",
    failureCopy: "Couldn't load jackpot events.",
    emptyKey: 't("admin.jackpot.noEvents")',
    emptyGate: "events.length === 0 ? (",
  },
  {
    name: "spotlight inquiries",
    section: spotlight,
    success: "if (res.ok) setInquiries(data.inquiries ?? []);",
    failureCopy: "Couldn't load spotlight inquiries.",
    emptyKey: 't("admin.spotlight.empty")',
    emptyGate: "inquiries.length === 0 ? (",
  },
  {
    name: "contact messages",
    section: contact,
    success: "if (res.ok) setMessages(data.messages ?? []);",
    failureCopy: "Couldn't load contact messages.",
    emptyKey: 't("admin.contact.empty")',
    emptyGate: "messages.length === 0 ? (",
  },
  {
    name: "dmca takedown reports",
    section: dmca,
    success: "if (res.ok) setReports(data.reports ?? []);",
    failureCopy: "Couldn't load takedown reports.",
    emptyKey: 't("admin.dmca.empty")',
    emptyGate: "reports.length === 0 ? (",
  },
  {
    name: "content reports",
    section: reports,
    success: "if (res.ok) setReports(data.reports ?? []);",
    failureCopy: "Couldn't load content reports.",
    emptyKey: 't("admin.reports.empty")',
    emptyGate: "reports.length === 0 ? (",
  },
];

describe.each(INBOXES)("$name — failure never reads as empty", ({ section, success, failureCopy, emptyKey, emptyGate }) => {
  it("failure records the load-error state; success records the rows", () => {
    expect(section).toContain("setLoadError(true);");
    expect(section).toContain(success);
    expect(section).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("renders loading → load-error panel (own copy) → empty, in that order", () => {
    expect(section).toContain(failureCopy);
    expect(section).toContain(emptyKey);
    const loadingAt = section.indexOf("loading ? (");
    const errAt = section.indexOf("loadError ? (");
    const emptyAt = section.indexOf(emptyGate);
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("jackpot + spotlight retries are wired to their real reloads", () => {
  it("jackpot retry restarts the load through the retry nonce", () => {
    expect(jackpot).toContain("onClick={() => { setLoading(true); setRetryNonce((n) => n + 1); }}");
  });

  it("spotlight retry restarts the load through the retry nonce", () => {
    expect(spotlight).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });
});

describe("pitch & fix queue — failure never reads as empty", () => {
  it("the loader throws on a non-ok response and records the error in its catch", () => {
    expect(pitchFix).toContain('if (!res.ok) throw new Error("queue failed");');
    expect(pitchFix).toContain("setRows(data.submissions ?? []);");
    expect(pitchFix).toContain("setLoadError(true);");
  });

  it("renders loading → load-error panel with retry → empty, in that order", () => {
    expect(pitchFix).toContain('t("admin.pitchFix.loading")');
    expect(pitchFix).toContain('t("admin.pitchFix.loadErrorTitle")');
    expect(pitchFix).toContain('t("admin.pitchFix.loadError")');
    expect(pitchFix).toContain('t("admin.pitchFix.retry")');
    expect(pitchFix).toContain("onClick={() => void load()}");
    const errAt = pitchFix.indexOf("loadError ? (");
    const emptyAt = pitchFix.indexOf("rows.length === 0 ? (");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("removal panel recent list — failure never reads as nothing-removed", () => {
  it("the loader records the recent-error state on a non-ok response or a throw", () => {
    expect(removal).toContain("if (res.ok) setRecent(data.content ?? []);");
    expect(removal).toContain("else setRecentError(true);");
    expect(removal).toContain("const [recentError, setRecentError] = useState(false);");
  });

  it("renders loading → recent-error with retry → empty, in that order", () => {
    expect(removal).toContain('t("admin.removal.recentLoadError")');
    expect(removal).toContain('t("admin.removal.recentEmpty")');
    expect(removal).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    const loadingAt = removal.indexOf("recentLoading ? (");
    const errAt = removal.indexOf("recentError ? (");
    const emptyAt = removal.indexOf("recent.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("bow race — failure never reads as no-race-yet", () => {
  const loadAt = page.indexOf("const loadBowRace = useCallback(async () => {");
  const loader = page.slice(loadAt, page.indexOf("}, [authHeaders]);", loadAt));

  it("the loader records the bow load error on a non-ok response or a throw", () => {
    expect(loader).toContain("setBowLoadError(true);");
    expect(loader).toContain("setBowHistory(data.history ?? []);");
    expect(page).toContain("const [bowLoadError, setBowLoadError] = useState(false);");
  });

  it("renders the error panel with a retry, and the no-race copy only in the settled branch", () => {
    expect(page).toContain("Couldn't load the Bow Race.");
    expect(page).toContain("onClick={() => setBowRetryNonce((n) => n + 1)}");
    const errAt = page.indexOf("bowLoadError ? (");
    const emptyAt = page.indexOf('t("admin.noRaceYet")');
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the admin honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of [
      "admin.jackpot.noEvents",
      "admin.spotlight.empty",
      "admin.contact.empty",
      "admin.dmca.empty",
      "admin.reports.empty",
      "admin.pitchFix.loading",
      "admin.pitchFix.loadErrorTitle",
      "admin.pitchFix.loadError",
      "admin.pitchFix.retry",
      "admin.pitchFix.empty",
      "admin.removal.recentLoadError",
      "admin.removal.recentEmpty",
      "admin.noRaceYet",
    ]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
