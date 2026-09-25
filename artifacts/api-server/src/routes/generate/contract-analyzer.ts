import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── Contract Analyzer ──────────────────────────────────────────────────
   AI contract review for creators: paste a record deal, brand deal, sync
   license, management agreement, or any creator contract and GPT-6 Sol
   returns a plain-English breakdown — risk score, red flags, key terms,
   negotiation leverage, and missing protections.

   Honest framing: this is an AI reading, not legal advice. Every analysis
   ends with "have an entertainment lawyer review before signing." */

const router = Router();

/* 3 credits per analysis — env-overridable. One structured GPT-6 completion. */
const CONTRACT_ANALYSIS_CREDITS = Number(process.env["CONTRACT_ANALYSIS_CREDIT_COST"]) || 3;
export { CONTRACT_ANALYSIS_CREDITS };

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

export const analyzeSchema = z.object({
  contractText: z
    .string()
    .min(200, "Paste at least a few paragraphs of the contract.")
    .max(60000, "Contract is too long — paste up to ~60k characters."),
  contractType: z.enum(CONTRACT_TYPES).default("other"),
  context: z.string().max(1000).optional().default(""),
});

export type AnalyzeInput = z.infer<typeof analyzeSchema>;

const SYSTEM_PROMPT = `You are an expert entertainment-contract analyst working for an AI creator platform. Your job is to read a creator's contract and explain it in plain English — no legalese.

You are NOT a lawyer and your output is NOT legal advice. You MUST include the disclaimer that the creator should have an entertainment lawyer review before signing.

Analyze the contract and return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "riskScore": <0-100, higher = riskier for the creator>,
  "riskLevel": "<low|moderate|high|severe>",
  "summary": "<3-5 sentence plain-English summary of what this contract actually does>",
  "redFlags": [
    { "title": "<short flag name>", "severity": "<low|medium|high|critical>", "explanation": "<plain-English why this hurts the creator>", "clause": "<the concerning language, quoted or paraphrased>" }
  ],
  "keyTerms": [
    { "term": "<e.g. Payment, Term Length, Territory>", "value": "<what the contract says>", "assessment": "<good|neutral|concerning>" }
  ],
  "negotiationTips": ["<concrete, actionable tip the creator can use in negotiation>"],
  "missingProtections": ["<standard protection this contract lacks, e.g. audit rights, reversion clause>"],
  "favorableTerms": ["<terms that are actually good for the creator — be honest when the deal is fair>"]
}

Rules:
- Be brutally honest. Creators get exploited; your loyalty is to them.
- Flag: perpetuity / life-of-copyright grants, 360-deal rights grabs, recoupment traps, vague payment terms, unilateral termination, broad morality clauses, no audit rights, work-for-hire on creative output, exclusivity without minimums.
- Praise fair terms when you see them — don't manufacture outrage.
- Key terms to extract: payment/compensation, term length, territory, exclusivity, rights granted, termination, payment timing, audit rights, governing law.
- Negotiation tips must be specific ("ask for a 3-year term with an option, not 5 years firm") not generic ("negotiate better terms").
- If the text is too garbled or not a contract, set riskScore 0, riskLevel "low", and explain in summary that you couldn't parse it.`;

router.post("/analyze", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { contractText, contractType, context } = parsed.data;

  let charged = false;
  try {
    await chargeCredits(req.userId!, CONTRACT_ANALYSIS_CREDITS, {
      action: "Contract Analysis",
    });
    charged = true;

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Contract type: ${CONTRACT_TYPE_LABELS[contractType]}\n${context ? `Creator context: ${context}\n` : ""}\nContract text:\n${contractText}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let analysis: Record<string, unknown>;
    try {
      analysis = JSON.parse(raw);
    } catch {
      throw new Error("AI returned unparseable analysis");
    }

    res.json({
      analysis,
      contractType,
      creditsCharged: CONTRACT_ANALYSIS_CREDITS,
      disclaimer:
        "This is an AI reading, not legal advice. Have an entertainment lawyer review before signing anything.",
    });
  } catch (err) {
    if (charged) {
      try {
        await refundCredits(req.userId!, CONTRACT_ANALYSIS_CREDITS, {
          action: "Contract Analysis (refund: analysis failed)",
        });
      } catch (refundErr) {
        logger.error({ err: refundErr }, "[contract-analyzer] refund failed");
      }
    }
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits" });
      return;
    }
    logger.error({ err }, "[contract-analyzer] analysis failed");
    res.status(500).json({ error: "analysis_failed" });
  }
});

export default router;
