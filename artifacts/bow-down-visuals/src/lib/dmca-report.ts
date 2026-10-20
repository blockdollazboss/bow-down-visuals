/* ─── DMCA takedown report — the copyright page's wire to the intake ──────
   The public intake POST /api/dmca/report (api-server routes/creator-platform)
   has existed since the admin DMCA bench landed, but nothing on the site
   ever called it — the copyright page was informational only, so the
   endpoint was reachable solely by direct API call. This module is the
   page's seam to it: the payload builder validates against the SAME
   contract the server's zod schema enforces (dmcaReportSchema), and the
   submit helper treats a report as filed ONLY when the server answers
   201 { ok: true, id } — every other outcome is an error the form shows,
   never a success. The intake is public on purpose: rights holders
   reporting infringement may not have an account, so no auth header is
   ever attached here. */

/** The good-faith statement the reporter affirms. Sent verbatim as
    agree_under_penalty — the server requires the value to affirm the
    statement (it must match /yes|true|agree/i). */
export const DMCA_AGREE_STATEMENT = "yes, I agree";

/** Raw form state, exactly as the page's inputs hold it: URL lists are
    one-per-line text, the agreement is the checkbox. */
export interface DmcaReportForm {
  reporterName: string;
  reporterEmail: string;
  reporterOrg: string;
  infringingUrlsText: string;
  originalUrlsText: string;
  description: string;
  agreed: boolean;
}

/** The exact wire shape POST /api/dmca/report accepts — no other fields. */
export interface DmcaReportPayload {
  reporter_name: string;
  reporter_email: string;
  reporter_org?: string;
  infringing_urls: string[];
  original_urls: string[];
  description: string;
  agree_under_penalty: string;
}

export type DmcaPayloadResult =
  | { ok: true; payload: DmcaReportPayload }
  | { ok: false; error: string };

/** Split a one-per-line (or comma-separated) link box into clean URLs. */
export function parseUrlList(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate the form against the intake's contract and build the payload.
 * The server stays the authority (its 400 message is surfaced verbatim by
 * submitDmcaReport); this client pass exists so a reporter hears about a
 * fixable problem instantly instead of after a round trip.
 */
export function buildDmcaReportPayload(form: DmcaReportForm): DmcaPayloadResult {
  const reporter_name = form.reporterName.trim();
  if (reporter_name.length < 1 || reporter_name.length > 120) {
    return { ok: false, error: "Add your full name — the report has to say who's filing it." };
  }

  const reporter_email = form.reporterEmail.trim();
  if (reporter_email.length > 200 || !EMAIL_SHAPE.test(reporter_email)) {
    return { ok: false, error: "Add a valid email address — that's how the review team reaches you about this report." };
  }

  const reporter_org = form.reporterOrg.trim();
  if (reporter_org.length > 200) {
    return { ok: false, error: "That organization name is too long — keep it under 200 characters." };
  }

  const infringing_urls = parseUrlList(form.infringingUrlsText);
  if (infringing_urls.length < 1) {
    return { ok: false, error: "Add at least one link to the content you're reporting." };
  }
  if (infringing_urls.length > 25) {
    return { ok: false, error: "One report can carry up to 25 links — trim the list or file a second report." };
  }
  if (infringing_urls.some((u) => u.length > 500 || !isUrl(u))) {
    return { ok: false, error: "Every reported link has to be a full URL (starting with https://). Check the list and try again." };
  }

  const original_urls = parseUrlList(form.originalUrlsText);
  if (original_urls.length > 25) {
    return { ok: false, error: "One report can carry up to 25 links to your original work — trim the list or file a second report." };
  }
  if (original_urls.some((u) => u.length > 500 || !isUrl(u))) {
    return { ok: false, error: "Every link to your original work has to be a full URL (starting with https://). Check the list and try again." };
  }

  const description = form.description.trim();
  if (description.length < 20) {
    return { ok: false, error: "Describe the infringement in a sentence or two (at least 20 characters) — what the work is and how it's being used." };
  }
  if (description.length > 5000) {
    return { ok: false, error: "That description is too long — keep it under 5,000 characters." };
  }

  if (!form.agreed) {
    return { ok: false, error: "You have to agree to the good-faith statement — under penalty of perjury, no shortcuts." };
  }

  return {
    ok: true,
    payload: {
      reporter_name,
      reporter_email,
      ...(reporter_org ? { reporter_org } : {}),
      infringing_urls,
      original_urls,
      description,
      agree_under_penalty: DMCA_AGREE_STATEMENT,
    },
  };
}

export type DmcaSubmitResult =
  | { status: "success"; id: string }
  | { status: "error"; error: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * File the report. Success is ONLY a server-confirmed filing: HTTP ok with
 * { ok: true, id }. A validation failure never reaches the network; a
 * server refusal surfaces the server's own message; a network failure is
 * a plain retryable error. Nothing in here can turn a failure into a
 * success.
 */
export async function submitDmcaReport(
  form: DmcaReportForm,
  fetchFn: FetchLike = fetch,
): Promise<DmcaSubmitResult> {
  const built = buildDmcaReportPayload(form);
  if (!built.ok) {
    return { status: "error", error: built.error };
  }
  try {
    const res = await fetchFn("/api/dmca/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(built.payload),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && data.ok === true && typeof data.id === "string") {
      return { status: "success", id: data.id };
    }
    return {
      status: "error",
      error:
        typeof data.error === "string" && data.error
          ? data.error
          : "The report didn't go through. Try again.",
    };
  } catch {
    return { status: "error", error: "The report didn't go through. Check your connection and try again." };
  }
}
