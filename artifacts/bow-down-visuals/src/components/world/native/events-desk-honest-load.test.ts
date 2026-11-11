/**
 * EventsDesk — honest load standard (deep-pins tranche 4,
 * batch E). The public list is the collection load: a non-ok
 * answer and an unparseable one both throw into the failed
 * state, and the render runs failed-with-retry → loading →
 * honestly-empty → loaded, so a failed read never paints as an
 * empty slate. RSVP truth comes from the rail's status alone —
 * rsvpLanded (201 new, or 409 already-on-the-list) is the only
 * way the row dresses as joined, the count moves only on the
 * 201, and anything else throws into the row error; cancelling
 * throws on non-ok before any local state moves. Create is
 * gated by eventCreateReady before any call, throws on non-ok,
 * and only then clears the form and reloads the list.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./EventsDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the list load — failure is its own state, never the empty slate", () => {
  it("non-ok and unparseable answers throw; the events are set only from the parse", () => {
    const body = slice(src, "useEffect(() => {\n    let cancelled = false;", "async function rsvp(ev: WorldEvent) {");
    expect(body).toContain("if (!res.ok) throw new Error(`events ${res.status}`);");
    expect(body).toContain("if (!parsed) throw new Error(\"events shape\");");
    expect(body.indexOf("setEvents(parsed);")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
    expect(body).toContain("setLoadFailed(true);");
  });

  it("renders failed+retry → loading → empty → rows, in that order", () => {
    const body = slice(src, "{loadFailed ? (", "</NativeCard>");
    expect(body.indexOf("{loadFailed ? (")).toBeLessThan(body.indexOf(") : events === null ? ("));
    expect(body.indexOf(") : events === null ? (")).toBeLessThan(body.indexOf(") : events.length === 0 ? ("));
    expect(body).toContain("onRetry={() => setTick((n) => n + 1)}");
    expect(body).toContain("<NativeLoadingState");
    expect(body).toContain("<NativeEmptyState");
  });
});

describe("RSVP, cancel and create — state moves only on the rail's answer", () => {
  it("RSVP lands only via rsvpLanded; the count moves only on 201; anything else throws to the row error", () => {
    const body = slice(src, "async function rsvp(ev: WorldEvent) {", "async function unrsvp(ev: WorldEvent) {");
    expect(body).toContain("if (rsvpLanded(res.status)) {");
    expect(body).toContain("if (res.status === 201) {");
    expect(body).toContain("rsvpCount: e.rsvpCount + 1");
    expect(body).toContain("} else {");
    expect(body).toContain("throw new Error(apiErrorMessage(data, t(\"worldSocialDesk.eventsRsvpFailedStatus\", { status: res.status })));");
    expect(body).toContain("setRowError(plainErrorText(err, t(\"worldSocialDesk.eventsRsvpError\")));");
  });

  it("cancel throws on non-ok before the row or the count move", () => {
    const body = slice(src, "async function unrsvp(ev: WorldEvent) {", "async function create() {");
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"worldSocialDesk.eventsCancelFailedStatus\", { status: res.status })));");
    expect(body.indexOf("setOnList((m) => ({ ...m, [ev.id]: false }));")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
  });

  it("create is form-gated before the call and clears + reloads only after an ok answer", () => {
    const body = slice(src, "async function create() {", "return (\n    <NativeCard");
    expect(body).toContain("if (!eventCreateReady(form)) return;");
    expect(body.indexOf("if (!eventCreateReady(form)) return;")).toBeLessThan(body.indexOf("const res = await fetch(EVENTS_PATH, {"));
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"worldSocialDesk.eventsCreateFailedStatus\", { status: res.status })));");
    expect(body.indexOf("setForm(EMPTY_FORM);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body.indexOf("setTick((n) => n + 1);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body).toContain("setCreateError(plainErrorText(err, t(\"worldSocialDesk.eventsCreateError\")));");
  });
});
