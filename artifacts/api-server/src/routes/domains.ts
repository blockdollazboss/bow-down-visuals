import { Router } from "express";
import { z } from "zod";
import { promises as dns } from "node:dns";
import { randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { customDomainsTable, creatorProfilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";

const router = Router();

/* ── Custom domains — Worker 10: creator "own website" flagship ─────────────
   Every creator gets <slug>.bowdownvisuals.com FREE (resolved by convention,
   no row needed — see GET /api/domains/resolve). The paid tier connects their
   OWN domain: they add a CNAME + a TXT proof-of-ownership record at their DNS
   provider, hit "Check now", and we flip the row to active.

   CONFIG — read this before prod:
   - DOMAINS_CNAME_TARGET: the CNAME target we tell creators to point at.
     DEFAULT is the placeholder "cname.bowdownvisuals.com". On Render, when you
     add the wildcard custom domain *.bowdownvisuals.com (see report: the
     Render dashboard step) Render shows the real target — set this env var to
     that value. Until then the DNS instructions page shows the placeholder and
     says plainly "we're wiring this up".
   - MAIN_SITE_DOMAIN: the main app domain (default "bowdownvisuals.com").
     Used to reject main-domain claims and to derive the *.domain subdomain
     convention in /resolve.

   SSL: Render provisions certificates automatically for every custom domain
   added on the service (including the wildcard). We state "we handle SSL
   automatically" in the UI copy — no cert work in code.
*/

const CNAME_TARGET = process.env["DOMAINS_CNAME_TARGET"] ?? "cname.bowdownvisuals.com";
const MAIN_DOMAIN = (process.env["MAIN_SITE_DOMAIN"] ?? "bowdownvisuals.com").toLowerCase();
const VERIFY_TXT_PREFIX = "_bdv-verify";

/* ── Zod schemas ───────────────────────────────────────────────────────────── */

const HOSTNAME_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME_RE = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})*\\.[a-z]{2,}$`);

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(253)
  .regex(HOSTNAME_RE, "That doesn't look like a valid domain (e.g. yourname.com).")
  .refine((h) => h !== MAIN_DOMAIN && h !== `www.${MAIN_DOMAIN}`, {
    message: "That's the main Bow Down Visuals domain — pick your own domain.",
  })
  .refine((h) => !h.endsWith(`.${MAIN_DOMAIN}`), {
    message: `*.${MAIN_DOMAIN} addresses are already yours free — no setup needed. This is for your OWN domain (yourname.com).`,
  });

const createDomainSchema = z.object({ hostname: hostnameSchema });
const domainIdSchema = z.object({ id: z.string().uuid("Invalid domain id.") });
const resolveQuerySchema = z.object({
  host: z.string().trim().toLowerCase().min(1).max(253),
});

type DomainRow = typeof customDomainsTable.$inferSelect;

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function normalizeHost(raw: string): string {
  // Strip port (dev) and trailing dot; lowercase.
  return raw.trim().toLowerCase().split(":")[0]!.replace(/\.$/, "");
}

function dnsInstructions(hostname: string, token: string) {
  return {
    cname: {
      type: "CNAME",
      host: hostname,
      target: CNAME_TARGET,
      note:
        "Point this CNAME at your DNS provider. " +
        "If your provider asks for the host as '@' or blank for an apex domain, " +
        "use their CNAME-flattening / ANAME / ALIAS option pointing at the same target.",
    },
    txt: {
      type: "TXT",
      host: `${VERIFY_TXT_PREFIX}.${hostname}`,
      value: `bdv-verify=${token}`,
      note: "Proves you own the domain. This record can stay forever — it also lets us re-check if you move DNS providers.",
    },
    ssl_note: "We handle SSL automatically — your site gets HTTPS the moment the domain goes live. No certificates to buy or install. 🦈",
    placeholder_warning:
      CNAME_TARGET === "cname.bowdownvisuals.com"
        ? "Heads up: the platform CNAME target is still the placeholder — our crew is wiring up the real target. Your TXT record already proves ownership; we'll flip you live the moment the target is ready."
        : null,
  };
}

function publicDomain(row: DomainRow) {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    is_primary: row.isPrimary,
    verified_at: row.verifiedAt,
    created_at: row.createdAt,
  };
}

/** The caller's creator profile — domains belong to profiles, not bare users. */
async function myProfile(userId: string) {
  const [profile] = await db
    .select({ id: creatorProfilesTable.id, slug: creatorProfilesTable.slug })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return profile ?? null;
}

/* ── Rate limiters ─────────────────────────────────────────────────────────── */

const createLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  message: { error: "Easy, shark — 10 new domains per hour is plenty. 🦈" },
});

const verifyLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip ?? "unknown"}|${req.params["id"] ?? "?"}`,
  message: { error: "DNS needs a minute to catch up — try again shortly. 🦈" },
});

const resolveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many lookups — slow down a touch." },
});

/* ── POST /api/domains — claim a domain (auth) ─────────────────────────────── */

router.post("/domains", requireAuth, createLimiter, async (req, res) => {
  const parsed = createDomainSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid hostname." });
    return;
  }
  const { hostname } = parsed.data;

  const profile = await myProfile(req.userId!);
  if (!profile) {
    res.status(404).json({ error: "Build your creator page first — domains attach to a profile. 🦈" });
    return;
  }

  // Hostname taken (by anyone)? Never leak whose.
  const [taken] = await db
    .select({ id: customDomainsTable.id })
    .from(customDomainsTable)
    .where(eq(customDomainsTable.hostname, hostname))
    .limit(1);
  if (taken) {
    res.status(409).json({ error: "That domain is already claimed on Bow Down Visuals." });
    return;
  }

  const token = randomBytes(24).toString("hex");
  let row: DomainRow;
  try {
    [row] = await db
      .insert(customDomainsTable)
      .values({ profileId: profile.id, hostname, verificationToken: token, status: "pending" })
      .returning();
  } catch (err) {
    // Race on the UNIQUE(hostname): same 409, no leak.
    res.status(409).json({ error: "That domain is already claimed on Bow Down Visuals." });
    return;
  }

  res.status(201).json({
    domain: publicDomain(row!),
    dns: dnsInstructions(hostname, token),
    message: "Claimed! Add the two DNS records below, then hit Check now. 🦈",
  });
});

/* ── GET /api/domains/mine — my domains (auth) ─────────────────────────────── */

router.get("/domains/mine", requireAuth, async (req, res) => {
  const profile = await myProfile(req.userId!);
  if (!profile) {
    res.json({ domains: [], free_subdomain: null });
    return;
  }
  const rows = await db
    .select()
    .from(customDomainsTable)
    .where(eq(customDomainsTable.profileId, profile.id));

  res.json({
    // The token goes back to the OWNER only — they need it for the TXT record.
    domains: rows.map((r) => ({ ...publicDomain(r), verification_token: r.verificationToken })),
    free_subdomain: `${profile.slug}.${MAIN_DOMAIN}`,
  });
});

/* ── POST /api/domains/:id/verify — server-side DNS check (auth) ─────────────
   Passes when the CNAME resolves to our target AND/OR the TXT record contains
   the verification token. On failure we return EXACTLY what DNS told us so the
   UI can show "we see X, expected Y". */

interface DnsEvidence {
  cname: string[] | null;
  txt: string[];
  errors: Record<string, string>;
}

async function collectDnsEvidence(hostname: string): Promise<DnsEvidence> {
  const evidence: DnsEvidence = { cname: null, txt: [], errors: {} };
  try {
    const targets = await dns.resolveCname(hostname);
    evidence.cname = targets.map((t) => t.toLowerCase().replace(/\.$/, ""));
  } catch (err) {
    evidence.errors["cname"] = (err as NodeJS.ErrnoException).code ?? "LOOKUP_FAILED";
  }
  try {
    const records = await dns.resolveTxt(`${VERIFY_TXT_PREFIX}.${hostname}`);
    evidence.txt = records.flat().map((s) => s.trim());
  } catch (err) {
    evidence.errors["txt"] = (err as NodeJS.ErrnoException).code ?? "LOOKUP_FAILED";
  }
  return evidence;
}

router.post("/domains/:id/verify", requireAuth, verifyLimiter, async (req, res) => {
  const idParsed = domainIdSchema.safeParse(req.params);
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid domain id." });
    return;
  }
  const profile = await myProfile(req.userId!);
  if (!profile) {
    res.status(404).json({ error: "No creator profile on this account." });
    return;
  }
  const [row] = await db
    .select()
    .from(customDomainsTable)
    .where(and(eq(customDomainsTable.id, idParsed.data.id), eq(customDomainsTable.profileId, profile.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Domain not found." });
    return;
  }

  if (row.status === "active") {
    res.json({ ok: true, already_active: true, domain: publicDomain(row) });
    return;
  }

  await db
    .update(customDomainsTable)
    .set({ status: "verifying" })
    .where(eq(customDomainsTable.id, row.id));

  const evidence = await collectDnsEvidence(row.hostname);
  const expectedTarget = CNAME_TARGET.toLowerCase().replace(/\.$/, "");
  const cnameOk = evidence.cname?.includes(expectedTarget) ?? false;
  const txtOk = evidence.txt.some((t) => t.includes(row.verificationToken));
  const passed = cnameOk || txtOk;

  const expected = {
    cname_target: CNAME_TARGET,
    txt_host: `${VERIFY_TXT_PREFIX}.${row.hostname}`,
    txt_contains: "your verification token",
  };

  if (!passed) {
    await db
      .update(customDomainsTable)
      .set({ status: "pending" })
      .where(eq(customDomainsTable.id, row.id));
    res.status(200).json({
      ok: false,
      status: "pending",
      expected,
      found: evidence,
      message:
        "Not seeing it yet — DNS can take a few minutes (sometimes up to an hour). " +
        "Double-check the records match exactly, then hit Check now again. 🦈",
    });
    return;
  }

  // First verified domain for this profile becomes the primary automatically —
  // never gates anything, it's just the canonical one.
  const [existingPrimary] = await db
    .select({ id: customDomainsTable.id })
    .from(customDomainsTable)
    .where(and(eq(customDomainsTable.profileId, profile.id), eq(customDomainsTable.isPrimary, true)))
    .limit(1);

  const [updated] = await db
    .update(customDomainsTable)
    .set({
      status: "active",
      verifiedAt: new Date(),
      isPrimary: existingPrimary ? row.isPrimary : true,
    })
    .where(eq(customDomainsTable.id, row.id))
    .returning();

  res.json({
    ok: true,
    status: "active",
    domain: publicDomain(updated!),
    checks: { cname: cnameOk, txt: txtOk },
    site_url: `https://${row.hostname}`,
    message: `Your site is live at ${row.hostname} — SSL handled automatically. Now go price your first product. 🦈`,
  });
});

/* ── DELETE /api/domains/:id — release a domain (auth) ─────────────────────── */

router.delete("/domains/:id", requireAuth, async (req, res) => {
  const idParsed = domainIdSchema.safeParse(req.params);
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid domain id." });
    return;
  }
  const profile = await myProfile(req.userId!);
  if (!profile) {
    res.status(404).json({ error: "No creator profile on this account." });
    return;
  }
  const [deleted] = await db
    .delete(customDomainsTable)
    .where(and(eq(customDomainsTable.id, idParsed.data.id), eq(customDomainsTable.profileId, profile.id)))
    .returning({ id: customDomainsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Domain not found." });
    return;
  }
  res.json({ ok: true, message: "Domain released. Your free subdomain still works. 🦈" });
});

/* ── GET /api/domains/resolve?host= — PUBLIC site-mode lookup ────────────────
   Returns ONLY the profile slug (never other creators' data). The frontend
   then loads the public profile through the normal public profile endpoint.
   Two paths:
   1. custom_domains row with status='active' for this exact hostname, joined
      to a PUBLIC creator_profiles row.
   2. <slug>.bowdownvisuals.com convention → slug, confirmed against a PUBLIC
      creator_profiles row (so unclaimed slugs don't site-mode). */

router.get("/domains/resolve", resolveLimiter, async (req, res) => {
  const parsed = resolveQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing ?host=" });
    return;
  }
  const host = normalizeHost(parsed.data.host);
  if (!host || host === MAIN_DOMAIN || host === `www.${MAIN_DOMAIN}` || host === "localhost") {
    res.json({ slug: null, source: "main" });
    return;
  }

  // 1. Paid custom domain.
  const [custom] = await db
    .select({ slug: creatorProfilesTable.slug })
    .from(customDomainsTable)
    .innerJoin(creatorProfilesTable, eq(customDomainsTable.profileId, creatorProfilesTable.id))
    .where(
      and(
        eq(customDomainsTable.hostname, host),
        eq(customDomainsTable.status, "active"),
        eq(creatorProfilesTable.isPublic, true),
      ),
    )
    .limit(1);
  if (custom) {
    res.json({ slug: custom.slug, source: "custom" });
    return;
  }

  // 2. Free <slug>.bowdownvisuals.com convention.
  const suffix = `.${MAIN_DOMAIN}`;
  if (host.endsWith(suffix)) {
    const slug = host.slice(0, -suffix.length);
    if (/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
      const [profile] = await db
        .select({ slug: creatorProfilesTable.slug })
        .from(creatorProfilesTable)
        .where(and(eq(creatorProfilesTable.slug, slug), eq(creatorProfilesTable.isPublic, true)))
        .limit(1);
      res.json({ slug: profile?.slug ?? null, source: profile ? "subdomain" : null });
      return;
    }
  }

  res.json({ slug: null, source: null });
});

export default router;
