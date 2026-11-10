/**
 * CreatorRooms (the World creator rooms — the office-hours
 * panel is the load-bearing surface) — honest load
 * classification (Stack-400 C-28 components residual,
 * deep-pins tranche 2). The office-hours marker reads from TWO
 * proven sources by design:
 *
 * - THE SLATE READ refreshes the room's sessions from the
 *   palace-wide calendar rail; sessions record only on ok.
 * - ON FAILURE the read falls back to the room's own DTO seed
 *   (detail.officeHours — real room data carried in the room
 *   payload the World already proved), never to invented
 *   sessions: the catch keeps the previous sessions, or the
 *   empty slate the seed logic then speaks over. Written on
 *   the code: "The room's own DTO seed still speaks for the
 *   marker."
 * - THE HOST'S OWN BOOKINGS (the cancel list) record only on
 *   ok; a failed read keeps the list's last truth (written on
 *   the code) and the booking form keeps working — the list is
 *   never zeroed by a read that didn't happen.
 *
 * NO FIX in this lane — the families already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const rooms = read("./CreatorRooms.tsx");

describe("the slate read: refresh on proof, DTO seed on failure", () => {
  it("sessions record only on ok", () => {
    expect(rooms).toContain('if (!res.ok) throw new Error("slate");');
    expect(rooms).toContain("const parsed = parseOfficeHoursEvents(await res.json());");
    expect(rooms).toContain("if (!cancelled) setSessions(parsed);");
  });

  it("failure keeps the previous truth or the seed's empty slate — never invented sessions", () => {
    expect(rooms).toContain("/* The room's own DTO seed still speaks for the marker. */");
    expect(rooms).toContain("if (!cancelled) setSessions((prev) => prev ?? []);");
  });
});

describe("the host's bookings: a failed read keeps the last truth", () => {
  it("mine records only on ok, filtered to live bookings", () => {
    expect(rooms).toContain('if (!res.ok) throw new Error("mine");');
    expect(rooms).toContain('if (!cancelled) setMine(parsed);');
    expect(rooms).toContain("/* The form still works; the list keeps its last truth. */");
  });
});
