import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, contractGenerationsTable } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { isMissingSchemaError } from "../../lib/pg-errors";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";

/* ─── Contract Generator ─────────────────────────────────────────────────
   The drafting twin of the Contract Analyzer (contract-analyzer.ts):
   pick one of the analyzer's 7 contract types, fill in the deal —
   parties, payment, term, territory, exclusivity, rights granted,
   termination — and GPT-6 Sol drafts a complete starting contract the
   creator can take to the table, then hand straight back into the
   analyzer with one tap ("Analyze my draft").

   Owner ruling (Nov 7, 2026): "Build it — contract generation too."
   Build-ready spec: ~/workspace/contract-generator-spec-2026-11-07.md.

   Honest framing is the analyzer's, verbatim — never invented here:
   this is an AI draft, not legal advice. Every draft carries the
   disclaimer up top and the response repeats it, and the system
   prompt carries the analyzer's own framing line. No copy anywhere
   in this rail implies attorney drafting.

   Charging mirrors the analyzer exactly: charge-before-generate with
   auto-refund on failure — plus the house exactly-once key, so a
   double-tap or retry of one ask can never charge twice (a refunded
   failure voids its key, so the next ask charges fresh).

   Stored results (Stack400 C-02/C-33): every successful generation
   is persisted in contract_generations keyed by that same charge
   key, and a replayed submit is answered from the stored row — the
   SAME draft the member already paid for — instead of running the
   provider again for a different draft. The price was ruled 300 by
   the owner (Nov 8, 2026, matching the analyzer); it lives in ONE
   env-overridable constant, and the price the surfaces show comes
   from this rail's status endpoint, never a hardcoded figure. */

const router = Router();

/* Env-overridable — default 300, the analyzer-matching recommendation.
   One structured GPT-6 completion per draft. */
const CONTRACT_GENERATION_CREDITS = Number(process.env["CONTRACT_GENERATION_CREDIT_COST"]) || 300;
export { CONTRACT_GENERATION_CREDITS };

/* The analyzer's 7 contract types, byte-for-byte (contract-analyzer.ts).
   The generator drafts from the same family the analyzer reads. */
const CONTRACT_TYPES = [
  "record-deal",
  "brand-deal",
  "sync-license",
  "management",
  "publishing",
  "distribution",
  "other",
] as const;
type ContractType = (typeof CONTRACT_TYPES)[number];

const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  "record-deal": "Record Deal",
  "brand-deal": "Brand / Sponsorship Deal",
  "sync-license": "Sync License",
  "management": "Management Agreement",
  "publishing": "Publishing Deal",
  "distribution": "Distribution Deal",
  "other": "Other Contract",
};

export { CONTRACT_TYPES, CONTRACT_TYPE_LABELS };

/* The analyzer's response disclaimer, verbatim (contract-analyzer.ts).
   Reused — never reworded — so every legal line on this surface is
   the house's settled copy. */
export const CONTRACT_DISCLAIMER =
  "This is an AI reading, not legal advice. Have an entertainment lawyer review before signing anything.";

export const generateSchema = z.object({
  contractType: z.enum(CONTRACT_TYPES).default("other"),
  creatorName: z
    .string()
    .trim()
    .min(1, "Name the creator (you or your act).")
    .max(200, "Creator name is too long."),
  counterpartyName: z
    .string()
    .trim()
    .min(1, "Name the other side (label, brand, company, or person).")
    .max(200, "Counterparty name is too long."),
  paymentTerms: z.string().max(2000).optional().default(""),
  term: z.string().max(1000).optional().default(""),
  territory: z.string().max(1000).optional().default(""),
  exclusivity: z.string().max(1000).optional().default(""),
  rightsGranted: z.string().max(2000).optional().default(""),
  termination: z.string().max(2000).optional().default(""),
  context: z.string().max(1000).optional().default(""),
  /* One key per user intent (the thumbnail/persona pattern): the
     surfaces mint it when a draft is asked for and keep it across a
     retry of that same ask, so a double-tap or a network retry can
     never charge twice for one draft. A refunded failure voids the
     key (below), so the next, genuinely-new ask charges fresh. */
  idempotencyKey: z.string().max(128).optional(),
});

export type GenerateInput = z.infer<typeof generateSchema>;

/* ── Stored results (Stack400 C-02 / C-33) ────────────────────────
   RESPONSE SHAPE CONTRACT — read by the FE surfaces today and by
   lane s400-post-assist's C-36 helper copy at the join:

   - A FRESH success answers the bare body, with NO `replayed` field:
       { generation: { title, draft, summary },
         contractType, creditsCharged, disclaimer }
   - A REPLAY answers the stored body VERBATIM plus exactly one
     added top-level field:  replayed: true.

   Nothing else differs — same draft bytes, same creditsCharged, same
   disclaimer — so one paid intent can never surface two different
   contracts, and copy keyed on `replayed` can honestly say "this is
   the draft you already made for this request".

   Both reads and writes are FAIL-OPEN against a lagging database:
   if the contract_generations table is not there yet (migration
   0329 not applied), the rail generates exactly as it did before
   C-02 — a stored result is an upgrade, never a gate on a paid ask. */
export interface StoredContractResult {
  generation: { title: string; draft: string; summary: string };
  contractType: string;
  creditsCharged: number;
  disclaimer: string;
}

async function findStoredGeneration(
  idempotencyKey: string,
  userId: string,
): Promise<StoredContractResult | null> {
  try {
    const [row] = await db
      .select({
        userId: contractGenerationsTable.userId,
        result: contractGenerationsTable.result,
      })
      .from(contractGenerationsTable)
      .where(eq(contractGenerationsTable.idempotencyKey, idempotencyKey))
      .limit(1);
    /* The key is user-scoped by construction; a row naming another
       user is never served (defense in depth, not an expected path). */
    if (!row || row.userId !== userId || !row.result) return null;
    return row.result;
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err, idempotencyKey },
        "[contract-generator] stored-result lookup failed — generating fresh (fail-open)",
      );
    }
    return null;
  }
}

async function storeGeneration(
  idempotencyKey: string,
  userId: string,
  contractType: string,
  result: StoredContractResult,
): Promise<void> {
  try {
    await db
      .insert(contractGenerationsTable)
      .values({ userId, idempotencyKey, contractType, result })
      .onConflictDoNothing({ target: contractGenerationsTable.idempotencyKey });
  } catch (err) {
    /* Never fail a paid, successful generation over its bookkeeping:
       the member holds their draft; the worst case is a later replay
       generating fresh (the pre-C-02 behavior). Log loudly. */
    logger.error(
      { err, idempotencyKey },
      "[contract-generator] failed to store the generation result — a replay of this intent would generate fresh",
    );
  }
}

/* In-flight generations, per idempotency key (Stack400 C-01/C-33).
   The durable stored row answers a replay that arrives AFTER a
   generation lands; this map answers the twin that arrives WHILE it
   is still running — the twin waits for the one generation instead
   of starting a second provider call. In-process by design (the
   same pattern as the multi-ratio export dedup): a cross-process
   twin still resolves through the ledger race fix (C-01) and the
   stored-row checks — never a double charge, never a false 500.
   Entries are removed the moment the generation settles. */
const inflightGenerations = new Map<string, Promise<StoredContractResult>>();

const SYSTEM_PROMPT = `You are an expert entertainment-contract drafter working for an AI creator platform. Your job is to turn a creator's deal points into a complete, plainly-written starting contract they can take into a negotiation.

You are NOT a lawyer and your output is NOT legal advice. The draft MUST open with the disclaimer that this is an AI-generated draft, not legal advice, and that the creator should have an entertainment lawyer review before signing.

Draft the contract and return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "title": "<the contract's title, e.g. 'Brand Sponsorship Agreement'>",
  "draft": "<the complete contract text, with numbered sections and headings, ready to copy>",
  "summary": "<1-2 plain sentences: what was drafted and which blanks still need filling>"
}

Rules:
- Use ONLY the deal points given. NEVER invent money amounts, percentages, dates, or names that were not provided — where a deal point is missing or vague, leave a clear bracketed blank like [______] for the creator to fill in.
- Cover, in order: the parties, what each side gives and gets (rights granted), payment and payment timing, term length, territory, exclusivity, termination (how either side can end it), and signature blocks for both parties.
- Write in plain, professional contract language a creator can actually read — no fake legalese, no Latin filler.
- Do NOT include one-sided traps: no perpetuity grabs, no hidden 360 rights, no unilateral-everything clauses. Draft the fair version of the deal described; if a given deal point is itself one-sided, draft it as given but flag it in the summary.
- The disclaimer at the top of the draft is part of the draft text, before the title's first section.`;

/* GET /api/contracts/generate/status — the price + template list the
   surfaces render. The displayed price is THIS value (the same
   constant the rail charges), so display and charge cannot drift. */
router.get("/generate/status", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    creditCost: CONTRACT_GENERATION_CREDITS,
    contractTypes: CONTRACT_TYPES.map((key) => ({ key, label: CONTRACT_TYPE_LABELS[key] })),
    disclaimer: CONTRACT_DISCLAIMER,
  });
});

router.post("/generate", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;

  /* Exactly-once: a stable key for (user, this rail, this intent) —
     the client's per-intent key when it sent one, else a hash of the
     deal points themselves. A replayed charge under a landed key is
     suppressed by the ledger, so one draft is never charged twice. */
  const { idempotencyKey: _clientKey, ...dealIntent } = input;
  const idempotencyKey = buildChargeIdempotencyKey(
    "contract_generation",
    req.userId!,
    input.idempotencyKey,
    dealIntent,
  );

  /* C-02: a stored result under this key means this exact intent was
     already paid for and answered — serve the stored draft verbatim.
     No charge, no provider call (C-33): one paid intent, one draft. */
  const prior = await findStoredGeneration(idempotencyKey, req.userId!);
  if (prior) {
    logger.info(
      { userId: req.userId, idempotencyKey },
      "[contract-generator] replay served from the stored result",
    );
    res.json({ ...prior, replayed: true });
    return;
  }

  /* A twin of this exact intent is generating right now: wait for
     its result instead of paying the provider twice for one draft. */
  const twinInFlight = inflightGenerations.get(idempotencyKey);
  if (twinInFlight) {
    const twinResult = await twinInFlight.catch(() => null);
    if (twinResult) {
      res.json({ ...twinResult, replayed: true });
      return;
    }
    /* The twin failed; its charge is refunded and its key voided by
       its own failure path below — fall through and run this request
       as the fresh attempt it now is. */
  }

  let settleInflight!: {
    resolve: (r: StoredContractResult) => void;
    reject: (e: unknown) => void;
  };
  const inflightPromise = new Promise<StoredContractResult>((resolve, reject) => {
    settleInflight = { resolve, reject };
  });
  /* A rejection with no waiter attached must never surface unhandled. */
  inflightPromise.catch(() => {});
  inflightGenerations.set(idempotencyKey, inflightPromise);
  const clearInflight = () => {
    if (inflightGenerations.get(idempotencyKey) === inflightPromise) {
      inflightGenerations.delete(idempotencyKey);
    }
  };

  let charged = false;
  try {
    await chargeCredits(
      req.userId!,
      CONTRACT_GENERATION_CREDITS,
      {
        action: "Contract Generation",
      },
      { idempotencyKey },
    );
    charged = true;

    /* The charge may have been a suppressed replay (or the C-01
       concurrent-replay outcome) whose twin has since finished: if
       its draft is stored by now, serve it instead of generating a
       second, different draft for the same paid intent. */
    const landed = await findStoredGeneration(idempotencyKey, req.userId!);
    if (landed) {
      settleInflight.resolve(landed);
      clearInflight();
      res.json({ ...landed, replayed: true });
      return;
    }

    const dealPoints = [
      `Contract type: ${CONTRACT_TYPE_LABELS[input.contractType]}`,
      `Creator: ${input.creatorName}`,
      `Other party: ${input.counterpartyName}`,
      input.paymentTerms ? `Payment (amount and timing): ${input.paymentTerms}` : "Payment (amount and timing): [not specified — leave bracketed blanks]",
      input.term ? `Term: ${input.term}` : "Term: [not specified — leave a bracketed blank]",
      input.territory ? `Territory: ${input.territory}` : "Territory: [not specified — leave a bracketed blank]",
      input.exclusivity ? `Exclusivity: ${input.exclusivity}` : "Exclusivity: [not specified — leave a bracketed blank]",
      input.rightsGranted ? `Rights granted: ${input.rightsGranted}` : "Rights granted: [not specified — leave bracketed blanks]",
      input.termination ? `Termination: ${input.termination}` : "Termination: [not specified — leave a bracketed blank]",
      input.context ? `Extra context: ${input.context}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Draft this contract from these deal points:\n\n${dealPoints}` },
      ],
      response_format: { type: "json_object" },
      /* A full contract draft runs longer than an analysis — the
         analyzer's 4k budget would cut drafts off mid-clause. */
      max_tokens: 8000,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let generation: { title?: unknown; draft?: unknown; summary?: unknown };
    try {
      generation = JSON.parse(raw);
    } catch {
      throw new Error("AI returned unparseable generation");
    }
    const draft = typeof generation.draft === "string" ? generation.draft.trim() : "";
    if (!draft) {
      throw new Error("AI returned an empty draft");
    }
    const title =
      typeof generation.title === "string" && generation.title.trim()
        ? generation.title.trim()
        : CONTRACT_TYPE_LABELS[input.contractType];
    const summary = typeof generation.summary === "string" ? generation.summary.trim() : "";

    /* The framing rides EVERY draft, deterministically: if the model
       didn't open with the not-legal-advice line, the rail prepends
       the house disclaimer verbatim — a generated contract never
       leaves without it. */
    const framedDraft = /not legal advice/i.test(draft)
      ? draft
      : `${CONTRACT_DISCLAIMER}\n\n${draft}`;

    const responseBody: StoredContractResult = {
      generation: { title, draft: framedDraft, summary },
      contractType: input.contractType,
      creditsCharged: CONTRACT_GENERATION_CREDITS,
      disclaimer: CONTRACT_DISCLAIMER,
    };
    /* C-02: persist BEFORE answering, so any replay from this moment
       on is served this exact draft. The write is fail-open (see
       storeGeneration) — a storage hiccup never fails the paid ask. */
    await storeGeneration(idempotencyKey, req.userId!, input.contractType, responseBody);
    settleInflight.resolve(responseBody);
    clearInflight();
    res.json(responseBody);
  } catch (err) {
    if (charged) {
      /* A concurrent twin may have finished and stored while this
         attempt failed: its draft is the paid answer for this intent —
         serve it and let the charge stand, instead of refunding a
         charge whose draft the member is about to receive. */
      const twin = await findStoredGeneration(idempotencyKey, req.userId!);
      if (twin) {
        settleInflight.resolve(twin);
        clearInflight();
        res.json({ ...twin, replayed: true });
        return;
      }
      try {
        await refundCredits(req.userId!, CONTRACT_GENERATION_CREDITS, {
          action: "Contract Generation (refund: generation failed)",
        });
        /* Void the charge's key so a retry charges again instead of
           being suppressed as a replay and running free (the refund
           already returned the money — the next ask is a new draft). */
        await voidChargeIdempotencyKey(idempotencyKey).catch((voidErr) =>
          logger.error({ err: voidErr }, "[contract-generator] idempotency void failed"),
        );
      } catch (refundErr) {
        logger.error({ err: refundErr }, "[contract-generator] refund failed");
      }
    }
    /* The refund (when any) has landed and the key is voided, so a
       twin waiting on this attempt may safely fall through and run
       as a fresh attempt — settle only now, never before. */
    settleInflight.reject(err);
    clearInflight();
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits" });
      return;
    }
    logger.error({ err }, "[contract-generator] generation failed");
    res.status(500).json({ error: "generation_failed" });
  }
});

export default router;
