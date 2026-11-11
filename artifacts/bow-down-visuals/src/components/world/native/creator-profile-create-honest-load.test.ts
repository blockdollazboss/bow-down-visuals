/**
 * CreatorProfileCreate (World native) — honest load
 * standard (deep-pins tranche 5). A five-state load:
 * loading, hidden (401/403 — a guest at a board: this card
 * isn't theirs, so it renders nothing rather than an
 * error), create (404 — no profile yet, the honest empty
 * that IS the create form; also an unparseable body),
 * has (a parsed profile), and failed (any other non-ok or
 * a throw). The live slug check is sequenced (a stale
 * answer never overwrites the current handle's state) and
 * a failed check lands on an honest "didn't answer"
 * message kind — never on available. Create: a 409 re-runs
 * the check so the form says the handle went; an ok answer
 * whose body won't parse is its own named state
 * (profileCreatedUnread — created but unread), never a
 * fake "has".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CreatorProfileCreate.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the me load — five states, each earned", () => {
  it("404 → create; 401/403 → hidden; unparseable → create; parsed → has; the rest → failed", () => {
    expect(src).toContain('const [state, setState] = useState<"loading" | "hidden" | "has" | "create" | "failed">("loading");');
    const body = slice(src, 'const res = await fetch("/api/creator-profiles/me", { headers: await authHeaders() });', "/* Prefill from the signed-in member");
    expect(body).toContain("if (res.status === 404) {");
    expect(body).toContain('setState("create");');
    expect(body).toContain("if (res.status === 401 || res.status === 403) {");
    expect(body).toContain('setState("hidden");');
    expect(body).toContain('if (!res.ok) throw new Error("me");');
    expect(body).toContain("const profile = parseMyCreatorProfile(await res.json().catch(() => null));");
    expect(body).toContain('setState("has");');
    expect(body.indexOf('if (!res.ok) throw new Error("me");')).toBeLessThan(body.indexOf("setMine(profile);"));
    const catchPart = slice(body, "} catch {", "return () => {");
    expect(catchPart).toContain('if (!cancelled) setState("failed");');
    expect(catchPart).not.toContain("setMine");
    expect(src).toContain('if (state === "hidden") return null;');
  });
});

describe("the slug check — sequenced, and failure never reads as available", () => {
  it("a stale sequence is dropped; !ok and throws land on the didn't-answer message", () => {
    const body = slice(src, "const timer = setTimeout(async () => {", "const create = async () => {");
    expect(body).toContain("if (seq !== checkSeq.current) return;");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setSlugCheck({ kind: "invalid", slug: candidate, message: t("worldCreatorRooms.profileCheckDidntAnswer") });');
    expect(body).toContain("setSlugCheck(parseSlugCheck(await res.json().catch(() => null), candidate, strings));");
    expect(body.indexOf("if (!res.ok) {")).toBeLessThan(
      body.indexOf("setSlugCheck(parseSlugCheck(await res.json().catch(() => null), candidate, strings));"),
    );
    const catchPart = slice(body, "} catch {", "}, 350);");
    expect(catchPart).toContain("profileCheckDidntAnswer");
    expect(catchPart).not.toContain("available");
  });
});

describe("create — outcomes named exactly", () => {
  it("!ok is the server's line (+ a re-check on 409); an unparseable success is created-unread; has needs the parsed profile", () => {
    const body = slice(src, "const create = async () => {", "if (state === \"hidden\") return null;");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain("setError(creatorProfileErrorLine(data, t(\"worldCreatorRooms.profileCreateFallback\")));");
    expect(body).toContain("if (res.status === 409) {");
    expect(body).toContain('setSlugCheck({ kind: "taken", slug: normalizeCreatorSlug(slug) });');
    expect(body).toContain("const profile = parseMyCreatorProfile(data);");
    expect(body).toContain('setError(t("worldCreatorRooms.profileCreatedUnread"));');
    expect(body).toContain('setState("has");');
    expect(body).toContain("onCreated?.(profile);");
    expect(body.indexOf("const profile = parseMyCreatorProfile(data);")).toBeLessThan(body.indexOf('setState("has");'));
    expect(body).toContain('if (!profile) {\n        setError(t("worldCreatorRooms.profileCreatedUnread"));\n        return;\n      }');
    expect(body.indexOf('setError(t("worldCreatorRooms.profileCreatedUnread"));')).toBeLessThan(body.indexOf("setMine(profile);"));
  });
});
