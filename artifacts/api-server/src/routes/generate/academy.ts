import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";
import {
  ACADEMY_COURSES,
  getAcademyCourse,
  getAcademyLesson,
} from "../../lib/academy-courses";

const router = Router();

/* 1 credit per AI academy call — env-overridable without a deploy.
   Each call is a single medium-length GPT-6 Sol completion (a fraction of
   a cent in provider fees), so 1 credit holds a deep margin while staying
   an impulse buy — and honors the standing rule that every AI feature
   costs a fee. Browsing the catalog and lesson metadata is free (pure UI). */
const ACADEMY_CREDIT_COST = Number(process.env["ACADEMY_CREDIT_COST"]) || 1;
export { ACADEMY_CREDIT_COST };

const LEVELS = ["beginner", "intermediate", "advanced"] as const;
const PLATFORMS = ["youtube", "tiktok", "instagram", "twitch", "x"] as const;

/* Text model: centralized in getTextModel() (default gpt-6-sol,
   env-overridable via OPENAI_TEXT_MODEL). GPT-6 rejects `max_tokens` —
   always use `max_completion_tokens`. */

function outOfCreditsJson() {
  return {
    error: "out_of_credits",
    message: "You're out of credits — top up to keep learning.",
  };
}

async function refundOnFailure(userId: string, action: string): Promise<void> {
  try {
    await refundCredits(userId, ACADEMY_CREDIT_COST, {
      action: `${action} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    /* Logged inside refundCredits; don't mask the original failure. */
    void refundErr;
  }
}

/* ─── POST /api/academy/learning-path ────────────────────────────────────
   AI learning path generator: goals + niche + level + platforms → a
   personalized course path through the catalog. Paid: 1 credit.
   → 200 { path[], weeklyPlan[], firstStep, creditsUsed, creditsRemaining } */
const learningPathSchema = z.object({  goals: z.string().min(4, "Tell us your goal.").max(500),
  niche: z.string().min(1, "Niche is required.").max(120),
  level: z.enum(LEVELS),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform.").max(5),
  hoursPerWeek: z.number().int().min(1).max(80).optional().default(5),
});
export { learningPathSchema };

router.post("/academy/learning-path", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = learningPathSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid learning path request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < ACADEMY_CREDIT_COST) {
    res.status(402).json(outOfCreditsJson());
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, ACADEMY_CREDIT_COST, {
      action: "Academy Learning Path",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json(outOfCreditsJson());
      return;
    }
    throw err;
  }

  const { goals, niche, level, platforms, hoursPerWeek } = parsed.data;
  const catalog = ACADEMY_COURSES.map(
    (c) => `- ${c.id}: "${c.title}" (${c.level}, ${c.duration}) — ${c.tagline}`,
  ).join("\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are the head instructor of the Bow Down Visuals Creator Academy — ` +
            `a no-fluff coach for independent content creators. A creator gives you ` +
            `their goals, niche, experience level, platforms, and weekly hours. You ` +
            `build them a personalized learning path using ONLY the courses in the ` +
            `catalog below — never invent courses. Order the path for maximum ` +
            `impact given their level (beginners start with foundations, advanced ` +
            `creators skip to systems). Be specific: tie each recommendation to ` +
            `their stated goal. The weekly plan should fit their hours. ` +
            `Return ONLY JSON: {"path": [{"courseId": "<catalog id>", "title": "<catalog title>", ` +
            `"why": "<one sentence tied to their goal>", "order": <1-based>}], ` +
            `"weeklyPlan": ["<week 1 focus>", "<week 2 focus>", "<week 3 focus>", "<week 4 focus>"], ` +
            `"firstStep": "<the single most impactful first action, one sentence>"}`,
        },
        {
          role: "user",
          content:
            `Build my learning path.\n` +
            `Goals: ${goals.trim()}\n` +
            `Niche: ${niche.trim()}\n` +
            `Level: ${level}\n` +
            `Platforms: ${platforms.join(", ")}\n` +
            `Hours per week: ${hoursPerWeek}\n\n` +
            `Course catalog:\n${catalog}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    interface PathItem { courseId?: unknown; title?: unknown; why?: unknown; order?: unknown }
    let path: { courseId: string; title: string; why: string; order: number }[] = [];
    let weeklyPlan: string[] = [];
    let firstStep = "";
    try {
      const j = JSON.parse(raw) as { path?: unknown; weeklyPlan?: unknown; firstStep?: unknown };
      if (Array.isArray(j.path)) {
        path = (j.path as PathItem[])
          .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
          .map((p, i) => {
            const courseId = String(p["courseId"] ?? "").trim();
            const course = getAcademyCourse(courseId);
            return {
              courseId,
              title: course ? course.title : String(p["title"] ?? "").trim(),
              why: String(p["why"] ?? "").trim(),
              order: typeof p["order"] === "number" ? Math.round(p["order"]) : i + 1,
            };
          })
          /* Only real catalog courses — the model must not invent any. */
          .filter((p) => getAcademyCourse(p.courseId) && p.why)
          .slice(0, 6);
      }
      if (Array.isArray(j.weeklyPlan)) {
        weeklyPlan = j.weeklyPlan
          .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
          .map((w) => w.trim())
          .slice(0, 8);
      }
      if (typeof j.firstStep === "string" && j.firstStep.trim()) {
        firstStep = j.firstStep.trim();
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (path.length === 0 || !firstStep) {
      throw new Error("Model returned no usable learning path");
    }

    res.json({ path, weeklyPlan, firstStep, creditsUsed: ACADEMY_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refundOnFailure(req.userId!, "Academy Learning Path");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[academy] OpenAI rate limit / quota");
      res.status(503).json({ error: "The academy is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[academy] learning-path generation failed");
    res.status(502).json({ error: "The academy hiccupped — your credit was refunded, try again." });
  }
});

/* ─── POST /api/academy/ask ──────────────────────────────────────────────
   AI "ask the coach" Q&A, grounded in a course topic. Paid: 1 credit.
   → 200 { answer, courseTitle, creditsUsed, creditsRemaining } */
const askSchema = z.object({
  courseId: z.string().min(1, "Course is required.").max(80),
  question: z.string().min(4, "Ask a real question.").max(1000),
});
export { askSchema };

router.post("/academy/ask", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = askSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid coach question.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const course = getAcademyCourse(parsed.data.courseId);
  if (!course) {
    res.status(404).json({ error: "Unknown course." });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < ACADEMY_CREDIT_COST) {
    res.status(402).json(outOfCreditsJson());
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, ACADEMY_CREDIT_COST, {
      action: "Academy Ask the Coach",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json(outOfCreditsJson());
      return;
    }
    throw err;
  }

  const lessonList = course.lessons.map((l) => `- ${l.title}: ${l.summary}`).join("\n");
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are the head instructor of the Bow Down Visuals Creator Academy, ` +
            `answering a student's question about the course "${course.title}". ` +
            `Course description: ${course.description} ` +
            `The course covers:\n${lessonList}\n` +
            `Answer directly and practically — specific tactics over vague advice, ` +
            `no "post consistently" fluff. Keep it under 250 words. If the question ` +
            `is outside this course's topic, answer briefly anyway and point them ` +
            `to the course lesson it relates to. Return ONLY JSON: ` +
            `{"answer": "<your answer, plain text, newlines allowed>"}`,
        },
        {
          role: "user",
          content: `Course: ${course.title}\nQuestion: ${parsed.data.question.trim()}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let answer = "";
    try {
      const j = JSON.parse(raw) as { answer?: unknown };
      if (typeof j.answer === "string" && j.answer.trim()) answer = j.answer.trim();
    } catch {
      /* fall through */
    }
    if (!answer) {
      throw new Error("Model returned no usable answer");
    }

    res.json({
      answer,
      courseTitle: course.title,
      creditsUsed: ACADEMY_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, "Academy Ask the Coach");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[academy] OpenAI rate limit / quota");
      res.status(503).json({ error: "The coach is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[academy] ask-the-coach failed");
    res.status(502).json({ error: "The coach hiccupped — your credit was refunded, try again." });
  }
});

/* ─── POST /api/academy/lesson ───────────────────────────────────────────
   AI-generated lesson content on demand (1 credit/lesson) — the
   "everything AI-powered" rule means lessons are taught by the model,
   not shipped as static text.
   → 200 { lesson { title, minutes, sections[], takeaways[], actionStep },
             creditsUsed, creditsRemaining } */
const lessonSchema = z.object({
  courseId: z.string().min(1, "Course is required.").max(80),
  lessonId: z.string().min(1, "Lesson is required.").max(80),
});
export { lessonSchema };

router.post("/academy/lesson", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = lessonSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid lesson request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const found = getAcademyLesson(parsed.data.courseId, parsed.data.lessonId);
  if (!found) {
    res.status(404).json({ error: "Unknown course or lesson." });
    return;
  }
  const { course, lesson } = found;

  const balance = req.userCredits ?? 0;
  if (balance < ACADEMY_CREDIT_COST) {
    res.status(402).json(outOfCreditsJson());
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, ACADEMY_CREDIT_COST, {
      action: "Academy Lesson",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json(outOfCreditsJson());
      return;
    }
    throw err;
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are the head instructor of the Bow Down Visuals Creator Academy — ` +
            `a no-fluff coach for independent content creators. Teach the lesson ` +
            `below as a tight, practical lesson: specific tactics, real examples, ` +
            `zero vague "post consistently" filler. Write for a ${course.level} ` +
            `creator. Keep each section body to 2-4 sentences. ` +
            `Return ONLY JSON: {"sections": [{"heading": "...", "body": "..."}, ` +
            `{"heading": "...", "body": "..."}, {"heading": "...", "body": "..."}], ` +
            `"takeaways": ["<key point>", "<key point>", "<key point>"], ` +
            `"actionStep": "<one concrete thing to do today, one sentence>"}`,
        },
        {
          role: "user",
          content:
            `Course: ${course.title} (${course.level})\n` +
            `Lesson: ${lesson.title}\n` +
            `About this lesson: ${lesson.summary}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1800,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    interface RawSection { heading?: unknown; body?: unknown }
    let sections: { heading: string; body: string }[] = [];
    let takeaways: string[] = [];
    let actionStep = "";
    try {
      const j = JSON.parse(raw) as { sections?: unknown; takeaways?: unknown; actionStep?: unknown };
      if (Array.isArray(j.sections)) {
        sections = (j.sections as RawSection[])
          .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
          .map((s) => ({
            heading: String(s["heading"] ?? "").trim(),
            body: String(s["body"] ?? "").trim(),
          }))
          .filter((s) => s.heading && s.body)
          .slice(0, 6);
      }
      if (Array.isArray(j.takeaways)) {
        takeaways = j.takeaways
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 5);
      }
      if (typeof j.actionStep === "string" && j.actionStep.trim()) {
        actionStep = j.actionStep.trim();
      }
    } catch {
      /* fall through */
    }
    if (sections.length === 0 || !actionStep) {
      throw new Error("Model returned no usable lesson");
    }

    res.json({
      lesson: {
        courseId: course.id,
        courseTitle: course.title,
        lessonId: lesson.id,
        title: lesson.title,
        minutes: lesson.minutes,
        sections,
        takeaways,
        actionStep,
      },
      creditsUsed: ACADEMY_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, "Academy Lesson");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[academy] OpenAI rate limit / quota");
      res.status(503).json({ error: "The academy is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[academy] lesson generation failed");
    res.status(502).json({ error: "The lesson failed to generate — your credit was refunded, try again." });
  }
});

export default router;
