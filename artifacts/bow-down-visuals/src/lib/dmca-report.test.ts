import { describe, it, expect, vi } from "vitest";
import {
  DMCA_AGREE_STATEMENT,
  buildDmcaReportPayload,
  parseUrlList,
  submitDmcaReport,
  type DmcaReportForm,
} from "./dmca-report";

/* The copyright page's takedown form is the FIRST frontend caller of
   POST /api/dmca/report — before it, the public intake was reachable only
   by direct API call while the admin DMCA queue waited for reports.
   These pins hold the wire contract (the exact field set the server's
   dmcaReportSchema accepts — mirrored from the API's own route-test
   payload) and the honesty law: only a server-confirmed 201
   { ok: true, id } is a success; every refusal, malformed answer, and
   network failure is an error, and a form that fails the shared contract
   never reaches the network at all. */

const validForm: DmcaReportForm = {
  reporterName: "Visiting Rights Holder",
  reporterEmail: "rights@example.test",
  reporterOrg: "",
  infringingUrlsText: "https://bowdownvisuals.com/track/taken",
  originalUrlsText: "https://example.test/mine",
  description: "This track is my recording, uploaded without permission.",
  agreed: true,
};

describe("parseUrlList", () => {
  it("splits one-per-line text, trims, and drops blanks", () => {
    expect(parseUrlList("  https://a.test/1 \n\nhttps://a.test/2\n")).toEqual([
      "https://a.test/1",
      "https://a.test/2",
    ]);
  });

  it("also accepts comma-separated links", () => {
    expect(parseUrlList("https://a.test/1, https://a.test/2")).toEqual([
      "https://a.test/1",
      "https://a.test/2",
    ]);
  });

  it("an empty box parses to an empty list", () => {
    expect(parseUrlList("")).toEqual([]);
    expect(parseUrlList("  \n ")).toEqual([]);
  });
});

describe("buildDmcaReportPayload — the intake's exact contract", () => {
  it("builds exactly the field set the server schema accepts", () => {
    const built = buildDmcaReportPayload(validForm);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.payload).sort()).toEqual(
      [
        "reporter_name",
        "reporter_email",
        "infringing_urls",
        "original_urls",
        "description",
        "agree_under_penalty",
      ].sort(),
    );
    expect(built.payload).toEqual({
      reporter_name: "Visiting Rights Holder",
      reporter_email: "rights@example.test",
      infringing_urls: ["https://bowdownvisuals.com/track/taken"],
      original_urls: ["https://example.test/mine"],
      description: "This track is my recording, uploaded without permission.",
      agree_under_penalty: DMCA_AGREE_STATEMENT,
    });
  });

  it("includes reporter_org only when one was given", () => {
    const withOrg = buildDmcaReportPayload({ ...validForm, reporterOrg: "  Rights Co. " });
    expect(withOrg.ok).toBe(true);
    if (withOrg.ok) expect(withOrg.payload.reporter_org).toBe("Rights Co.");

    const blankOrg = buildDmcaReportPayload({ ...validForm, reporterOrg: "   " });
    expect(blankOrg.ok).toBe(true);
    if (blankOrg.ok) expect("reporter_org" in blankOrg.payload).toBe(false);
  });

  it("the agreement value is the affirmed statement the server's check accepts", () => {
    // The server refuses unless agree_under_penalty matches /yes|true|agree/i.
    expect(DMCA_AGREE_STATEMENT).toMatch(/yes|true|agree/i);
  });

  it("trims the text fields before they ride", () => {
    const built = buildDmcaReportPayload({
      ...validForm,
      reporterName: "  Visiting Rights Holder  ",
      description: "  This track is my recording, uploaded without permission.  ",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.reporter_name).toBe("Visiting Rights Holder");
    expect(built.payload.description).toBe(
      "This track is my recording, uploaded without permission.",
    );
  });
});

describe("buildDmcaReportPayload — refusals mirror the server's rules", () => {
  const cases: [string, Partial<DmcaReportForm>][] = [
    ["no name", { reporterName: "   " }],
    ["an invalid email", { reporterEmail: "not-an-email" }],
    ["no infringing link", { infringingUrlsText: "" }],
    ["an infringing link that isn't a URL", { infringingUrlsText: "some track page" }],
    ["an original-work link that isn't a URL", { originalUrlsText: "my website" }],
    ["a description under the 20-character floor", { description: "they stole it" }],
    ["the good-faith box unchecked", { agreed: false }],
  ];
  for (const [name, patch] of cases) {
    it(`refuses ${name}`, () => {
      const built = buildDmcaReportPayload({ ...validForm, ...patch });
      expect(built.ok).toBe(false);
      if (!built.ok) expect(built.error.length).toBeGreaterThan(0);
    });
  }
});

describe("submitDmcaReport — failure can never read as success", () => {
  it("posts the exact payload to the public intake, with no auth header", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, id: "report-123" }),
    }));
    const result = await submitDmcaReport(validForm, fetchFn);
    expect(result).toEqual({ status: "success", id: "report-123" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/dmca/report");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      reporter_name: "Visiting Rights Holder",
      reporter_email: "rights@example.test",
      infringing_urls: ["https://bowdownvisuals.com/track/taken"],
      original_urls: ["https://example.test/mine"],
      description: "This track is my recording, uploaded without permission.",
      agree_under_penalty: DMCA_AGREE_STATEMENT,
    });
  });

  it("a server refusal is an error carrying the server's message — not a success", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "You have to agree to the good-faith statement." }),
    }));
    const result = await submitDmcaReport(validForm, fetchFn);
    expect(result).toEqual({
      status: "error",
      error: "You have to agree to the good-faith statement.",
    });
  });

  it("a 500 with no readable body is still an error", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    }));
    const result = await submitDmcaReport(validForm, fetchFn);
    expect(result.status).toBe("error");
  });

  it("an ok-looking answer without a report id is an error, never a success", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false }),
    }));
    const result = await submitDmcaReport(validForm, fetchFn);
    expect(result.status).toBe("error");
  });

  it("a network failure is a retryable error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await submitDmcaReport(validForm, fetchFn);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error).toMatch(/try again/i);
  });

  it("an invalid form never reaches the network", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, id: "should-never-happen" }),
    }));
    const result = await submitDmcaReport({ ...validForm, agreed: false }, fetchFn);
    expect(result.status).toBe("error");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
