/* Podcast Studio helpers — cost estimation mirrors the backend
   (see api-server/src/routes/generate/podcast.ts). Keep WORDS_PER_MINUTE,
   SECONDS_PER_BLOCK and PODCAST_CREDITS_PER_10MIN in sync with the server. */

export const WORDS_PER_MINUTE = 150;
export const SECONDS_PER_BLOCK = 600;
export const PODCAST_CREDITS_PER_10MIN = 300;
export const MAX_SCRIPT_CHARS = 36_000;

export type PodcastMode = "script" | "topic" | "video" | "dialogue";
export type PodcastFormat = "single" | "dual";

export interface PodcastEstimate {
  wordCount: number;
  estimatedSeconds: number;
  billableBlocks: number;
  credits: number;
}

export function estimatePodcastCost(script: string): PodcastEstimate {
  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.ceil((wordCount / WORDS_PER_MINUTE) * 60);
  const billableBlocks = Math.max(1, Math.ceil(estimatedSeconds / SECONDS_PER_BLOCK));
  return {
    wordCount,
    estimatedSeconds,
    billableBlocks,
    credits: billableBlocks * PODCAST_CREDITS_PER_10MIN,
  };
}

/** Rough estimate for topic mode before the AI script exists (~8-10 min). */
export function estimateTopicModeCost(): PodcastEstimate {
  return estimatePodcastCost(new Array(1350).fill("word").join(" "));
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatTimestamp(totalSeconds: number): string {
  return formatDuration(totalSeconds);
}

export interface PodcastChapter {
  title: string;
  startSeconds: number;
}

/* ── Multi-speaker dialogue (ElevenLabs text-to-dialogue) ────────────────
   Mirrors api-server/src/routes/generate/podcast-dialogue.ts — keep
   DIALOGUE_CREDITS_PER_10MIN and the tag format in sync with the server. */

/**
 * APPROVED — owner ruling 2026-11-02: 300 Visual Bucs per 10 minutes of
 * finished dialogue audio (server gate: DIALOGUE_PRICING_APPROVED = true).
 */
export const DIALOGUE_CREDITS_PER_10MIN = 300;
export const DIALOGUE_SECONDS_PER_BLOCK = 600;
export const MAX_DIALOGUE_SPEAKERS = 8;

/** `NAME: line` — same tag format the server parses. */
const DIALOGUE_TAG_RE = /^([A-Za-z][A-Za-z0-9 _-]{0,29}):\s*(.+)$/;

/** Speaker names in first-appearance order. */
export function parseDialogueSpeakers(script: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of script.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^#{1,3}\s+/.test(line)) continue;
    const m = line.match(DIALOGUE_TAG_RE);
    if (!m || !m[2]!.trim()) continue;
    const name = m[1]!.trim();
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  return order;
}

/** Lines that carry no speaker tag (the server drops them — warn the user). */
export function countUntaggedDialogueLines(script: string): number {
  let n = 0;
  for (const rawLine of script.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^#{1,3}\s+/.test(line)) continue;
    const m = line.match(DIALOGUE_TAG_RE);
    if (!m || !m[2]!.trim()) n++;
  }
  return n;
}

export interface DialogueEstimate extends PodcastEstimate {
  turnCount: number;
  speakerCount: number;
}

export function estimateDialogueCost(script: string): DialogueEstimate {
  const speakers = parseDialogueSpeakers(script);
  const base = estimatePodcastCost(script);
  const turnCount = script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && DIALOGUE_TAG_RE.test(l)).length;
  return {
    ...base,
    credits: Math.max(1, Math.ceil(base.estimatedSeconds / DIALOGUE_SECONDS_PER_BLOCK)) * DIALOGUE_CREDITS_PER_10MIN,
    turnCount,
    speakerCount: speakers.length,
  };
}

/** Prefilled sample so the dialogue flow works in one tap (simple default). */
export const SAMPLE_DIALOGUE = `ALEX: Welcome back to Creator Cheat Code, the show where we turn content into cash.
JORDAN: And today we're talking about the one thing every creator gets wrong — the first three seconds.
ALEX: Exactly. If your hook doesn't stop the scroll, nothing else matters. Not the edit, not the lighting.
JORDAN: So what's the fix? Give it to me straight.
ALEX: Lead with the payoff. Tell them what they'll get before you tell them who you are.
JORDAN: That's free game right there. Try it on your next upload and watch the retention graph.`;

/* ── Episode templates — the starter-structure registry ────────────────
   Stack-100 A7 (org/design strategy order, owner Nov 2: maximum
   templates and presets). Every sibling creation surface got starters
   in the org waves (song presets, lip-sync starters, store starters,
   Go Live scenes) — the Podcast desk started from a blank page on
   every episode. This registry is its starter shelf.

   A template is ONLY a prefill. Applying one sets exactly the fields
   its `description` states — fields the existing Podcast form already
   exposes:
     - the input mode (Script or Dialogue);
     - the host format for Script templates (`format`);
     - the script / dialogue script text, seeded with the template's
       segment structure: one `# Heading` per segment (the server's
       parser turns `# Heading` lines into chapter markers and never
       speaks them) plus one spoken starter line per segment for the
       creator to edit or replace.

   A template NEVER:
     - charges anything (picking one is a local form change only —
       producing an episode keeps charging on its existing rail, at
       its existing price, only when the creator presses Produce);
     - submits a job, calls an API, or touches credits;
     - touches the episode title, description, voices, or music bed —
       those stay the creator's own.

   Per-segment `guidance` is the plan for that segment: it renders on
   the shelf card's rundown, never inside the seeded script — the
   script carries headings and spoken starter lines only, so nothing
   instructional can be read aloud by accident.
------------------------------------------------------------------------ */

export type PodcastSegmentKind = "intro" | "hook" | "segment" | "interview" | "outro";

export const PODCAST_SEGMENT_KIND_LABELS: Record<PodcastSegmentKind, string> = {
  intro: "Intro",
  hook: "Hook",
  segment: "Segment",
  interview: "Interview",
  outro: "Outro",
};

export interface PodcastTemplateStarterLine {
  /** Speaker tag the line belongs to (a name from the template's
   *  `speakers` for Dialogue templates; "HOST" for Script templates,
   *  where the line is seeded untagged and read by the host voice). */
  speaker: string;
  /** The spoken starter line, seeded verbatim for the creator to edit. */
  line: string;
}

export interface PodcastTemplateSegment {
  kind: PodcastSegmentKind;
  /** Segment name — becomes the seeded script's `# Heading` chapter. */
  title: string;
  /** What to do in this segment, in plain words. Shelf-only: it is
   *  never written into the seeded script. */
  guidance: string;
  /** Suggested minutes for the segment (a planning guide, not a cap). */
  minutes: number;
  /** Spoken starter lines the apply seeds under this segment's heading. */
  starterLines: PodcastTemplateStarterLine[];
}

export type PodcastTemplateId =
  | "interview"
  | "solo-commentary"
  | "news-roundup"
  | "story-episode"
  | "panel-discussion"
  | "listener-qa"
  | "deep-dive-explainer"
  | "audio-diary"
  | "review-desk";

export interface PodcastEpisodeTemplate {
  id: PodcastTemplateId;
  /** Starter name — a suggested use, never an outcome promise. */
  name: string;
  /** Who the starter is aimed at, in plain words. */
  tagline: string;
  /** What applying actually sets — mirrors the prefill exactly. */
  description: string;
  /** The Podcast form mode the starter selects. */
  mode: "script" | "dialogue";
  /** The host format a Script starter selects. Dialogue starters are
   *  multi-voice by construction and carry null — applying one never
   *  touches the format control (it does not apply in Dialogue mode). */
  format: PodcastFormat | null;
  /** The speaker tags a Dialogue starter seeds, in first-appearance
   *  order (the desk auto-assigns a voice to each). Empty for Script
   *  starters, whose seeded lines are untagged host lines. */
  speakers: string[];
  segments: PodcastTemplateSegment[];
}

export const PODCAST_EPISODE_TEMPLATES: PodcastEpisodeTemplate[] = [
  {
    id: "interview",
    name: "Interview",
    tagline: "One guest, one great conversation",
    description:
      "Switches to Dialogue mode and seeds the dialogue script with a six-segment interview structure — HOST and GUEST starter lines written in. Title, description, voices and music bed stay yours.",
    mode: "dialogue",
    format: null,
    speakers: ["HOST", "GUEST"],
    segments: [
      {
        kind: "intro",
        title: "Intro",
        guidance:
          "Welcome listeners back, name the guest and what they're known for, and promise the one big thing this conversation delivers.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "Welcome back to the show. Today's guest is [guest name] — [what they're known for] — and by the end of this conversation you'll know [the one big takeaway]. Let's get into it.",
          },
        ],
      },
      {
        kind: "hook",
        title: "The Hook",
        guidance:
          "Tease the single most surprising moment from the conversation, so listeners stay to hear it in context.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "Later in this conversation, [guest name] reveals [the surprising moment] — and you do not want to miss how that plays out.",
          },
        ],
      },
      {
        kind: "interview",
        title: "The Warm-Up",
        guidance:
          "Start easy: how the guest got started, and the moment everything changed for them.",
        minutes: 5,
        starterLines: [
          {
            speaker: "HOST",
            line: "Take me back to the beginning — how did you get started, and when did you know this was the thing?",
          },
          {
            speaker: "GUEST",
            line: "It started when [their origin moment] — and honestly, I almost didn't stick with it.",
          },
        ],
      },
      {
        kind: "interview",
        title: "The Deep Dive",
        guidance:
          "The main interview. Follow the answers, not just your question list — the follow-up question is where the gold is.",
        minutes: 15,
        starterLines: [
          {
            speaker: "HOST",
            line: "Let's go deeper on [the main topic]. Walk me through exactly how you do it, step by step.",
          },
          {
            speaker: "GUEST",
            line: "The first thing most people get wrong is [the common mistake] — here's what actually works.",
          },
        ],
      },
      {
        kind: "interview",
        title: "Rapid Fire",
        guidance:
          "Short questions, fast answers. Keep it light and quick — one line each way, no long stories.",
        minutes: 5,
        starterLines: [
          {
            speaker: "HOST",
            line: "Rapid fire — short questions, first answer that comes to mind. Ready? [Question one]?",
          },
          { speaker: "GUEST", line: "[Quick answer]." },
        ],
      },
      {
        kind: "outro",
        title: "Outro",
        guidance:
          "Thank the guest, tell listeners where to find them, and finish with one clear call to action.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "That's our show. Find [guest name] at [their link], follow the podcast so you never miss an episode, and we'll see you next time.",
          },
        ],
      },
    ],
  },
  {
    id: "solo-commentary",
    name: "Solo Commentary",
    tagline: "Just you and a strong point of view",
    description:
      "Switches to Script mode with a solo host and seeds the script with a six-segment commentary structure — a chapter heading and a spoken starter line per segment. Title, description, voice and music bed stay yours.",
    mode: "script",
    format: "single",
    speakers: [],
    segments: [
      {
        kind: "hook",
        title: "The Hook",
        guidance:
          "Open with the boldest version of your take — the first two lines decide whether anyone keeps listening.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "Nobody is telling you the truth about [your topic] — so I will.",
          },
        ],
      },
      {
        kind: "intro",
        title: "Intro",
        guidance:
          "Say who you are, what this show does, and exactly what this episode delivers.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "Welcome to [show name], I'm [your name], and today we're breaking down [the topic] — what works, what doesn't, and what to do instead.",
          },
        ],
      },
      {
        kind: "segment",
        title: "The Main Take",
        guidance:
          "Make your central argument, and prove it with one concrete example or story.",
        minutes: 8,
        starterLines: [
          {
            speaker: "HOST",
            line: "Here's my take: [your position]. And let me show you what I mean — [your example].",
          },
        ],
      },
      {
        kind: "segment",
        title: "The Other Side",
        guidance:
          "Make the strongest counter-argument honestly before you answer it — it's what makes your take believable.",
        minutes: 5,
        starterLines: [
          {
            speaker: "HOST",
            line: "Now, the other side will tell you [the counter-argument] — and they're not entirely wrong. Here's where it falls apart: [your answer].",
          },
        ],
      },
      {
        kind: "segment",
        title: "The Takeaway",
        guidance:
          "Land the episode on the one action a listener can take today.",
        minutes: 3,
        starterLines: [
          {
            speaker: "HOST",
            line: "If you take one thing from this episode, make it this: [the action]. Do it today, not someday.",
          },
        ],
      },
      {
        kind: "outro",
        title: "Outro",
        guidance:
          "Close with the call to action — follow, share with one person, and tease the next episode.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "That's it for today. Follow the show, share this with one person who needs it, and next time we're talking about [next topic].",
          },
        ],
      },
    ],
  },
  {
    id: "news-roundup",
    name: "News Roundup",
    tagline: "The week's stories, in order",
    description:
      "Switches to Script mode with a solo host and seeds the script with a six-segment roundup structure — biggest story first, then what it all means. Title, description, voice and music bed stay yours.",
    mode: "script",
    format: "single",
    speakers: [],
    segments: [
      {
        kind: "intro",
        title: "Intro",
        guidance:
          "Set the promise: what this roundup covers and how fast you'll get through it.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "Welcome to [show name] — here's everything that actually matters in [your world] this week, fast.",
          },
        ],
      },
      {
        kind: "segment",
        title: "Story One",
        guidance:
          "The biggest story first: what happened, why it matters, and your one-line verdict.",
        minutes: 4,
        starterLines: [
          {
            speaker: "HOST",
            line: "First up: [the headline]. Here's what happened — [the facts]. Why it matters: [the impact].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Story Two",
        guidance:
          "Same shape, second story. Facts first, verdict last — keep the pace up.",
        minutes: 4,
        starterLines: [
          {
            speaker: "HOST",
            line: "Next: [the headline]. What we know so far — [the facts]. My verdict: [your take].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Story Three",
        guidance:
          "The third story — the one your listeners are most likely to have missed.",
        minutes: 4,
        starterLines: [
          {
            speaker: "HOST",
            line: "And one you might have missed: [the headline]. [The facts] — and here's the part nobody's talking about: [the angle].",
          },
        ],
      },
      {
        kind: "segment",
        title: "What It Means",
        guidance:
          "Connect the dots across the stories. The pattern is the value only you can add.",
        minutes: 3,
        starterLines: [
          {
            speaker: "HOST",
            line: "Put it together and a pattern shows up: [the pattern]. Here's what I'd watch next: [what to watch].",
          },
        ],
      },
      {
        kind: "outro",
        title: "Outro",
        guidance:
          "Wrap in one breath: where to follow for the next roundup, and when it lands.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "That's the week. Follow [show name] so next week's roundup finds you — see you then.",
          },
        ],
      },
    ],
  },
  {
    id: "story-episode",
    name: "Story Episode",
    tagline: "A narrative in three acts",
    description:
      "Switches to Script mode with a solo host and seeds the script with a six-segment story structure — cold open, three acts, payoff. Title, description, voice and music bed stay yours.",
    mode: "script",
    format: "single",
    speakers: [],
    segments: [
      {
        kind: "hook",
        title: "Cold Open",
        guidance:
          "Start inside the most dramatic moment of the story, mid-action — then rewind and tell it properly.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "It was [the dramatic moment] — and [the main character] had no idea everything was about to change.",
          },
        ],
      },
      {
        kind: "intro",
        title: "Intro",
        guidance:
          "Name the show, set the scene, and tell listeners whose story this is.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "Welcome to [show name]. Today's story is about [who or what] — and it starts long before that moment.",
          },
        ],
      },
      {
        kind: "segment",
        title: "Act One — The Setup",
        guidance:
          "The world before everything changed: who they were, what they wanted, what stood in the way.",
        minutes: 7,
        starterLines: [
          {
            speaker: "HOST",
            line: "Back then, [the main character] was [their starting point] — and all they wanted was [the goal].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Act Two — The Turn",
        guidance:
          "The complication: the setback, the discovery, or the choice that changes everything.",
        minutes: 7,
        starterLines: [
          {
            speaker: "HOST",
            line: "Then came the moment nobody planned for: [the turn]. Nothing was the same after that.",
          },
        ],
      },
      {
        kind: "segment",
        title: "Act Three — The Payoff",
        guidance:
          "Pay off the cold open: how it ends, and what it cost or earned them.",
        minutes: 5,
        starterLines: [
          {
            speaker: "HOST",
            line: "Which brings us back to [the dramatic moment]. Here's how it actually ended: [the resolution].",
          },
        ],
      },
      {
        kind: "outro",
        title: "Outro",
        guidance:
          "One line on what the story means, then the call to action and a tease of the next story.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "That's the story. Follow [show name] for the next one — and next time, it's about [next story].",
          },
        ],
      },
    ],
  },
  {
    id: "panel-discussion",
    name: "Panel Discussion",
    tagline: "A host and two voices going back and forth",
    description:
      "Switches to Dialogue mode and seeds the dialogue script with a five-segment panel structure — HOST, PANELIST 1 and PANELIST 2 starter lines written in. Title, description, voices and music bed stay yours.",
    mode: "dialogue",
    format: null,
    speakers: ["HOST", "PANELIST 1", "PANELIST 2"],
    segments: [
      {
        kind: "intro",
        title: "Intro",
        guidance:
          "Introduce the topic, then each panelist in one line — who they are and where they stand.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "Welcome to [show name]. Today the panel takes on [the topic]. With me: [panelist one] and [panelist two] — let's get into it.",
          },
        ],
      },
      {
        kind: "segment",
        title: "Topic One",
        guidance:
          "Pose the first question to one panelist, then bring the second in to agree, push back, or add what's missing.",
        minutes: 10,
        starterLines: [
          {
            speaker: "HOST",
            line: "Topic one: [the first topic]. [Panelist one], you first — where do you land?",
          },
          {
            speaker: "PANELIST 1",
            line: "For me it's simple: [their position] — because [the reason].",
          },
          {
            speaker: "PANELIST 2",
            line: "I see it differently: [their position]. The part everyone's missing is [the angle].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Topic Two",
        guidance:
          "Second question — lead with the panelist who spoke least on topic one, so the voices stay balanced.",
        minutes: 10,
        starterLines: [
          {
            speaker: "HOST",
            line: "Topic two: [the second topic]. [Panelist two], start us off this time.",
          },
          {
            speaker: "PANELIST 2",
            line: "This one comes down to [their position].",
          },
          {
            speaker: "PANELIST 1",
            line: "I'll grant that — but the real question is [the follow-up].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Hot Takes",
        guidance:
          "One bold take per panelist, no hedging. Keep it fast — the disagreement is the fun.",
        minutes: 5,
        starterLines: [
          { speaker: "HOST", line: "Hot takes — one each, no hedging. Go." },
          { speaker: "PANELIST 1", line: "Mine: [bold take one]." },
          { speaker: "PANELIST 2", line: "Mine: [bold take two] — and I'll defend it." },
        ],
      },
      {
        kind: "outro",
        title: "Outro",
        guidance:
          "Thank the panel, recap the one moment listeners will argue about, and give the call to action.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "That's the panel. Tell us whose take you agree with, follow [show name], and we'll be back with the next one.",
          },
        ],
      },
    ],
  },
  {
    id: "listener-qa",
    name: "Listener Q&A",
    tagline: "Your audience asks, you answer",
    description:
      "Switches to Script mode with a solo host and seeds the script with a six-segment Q&A structure — each question read in the listener's words, then answered. Title, description, voice and music bed stay yours.",
    mode: "script",
    format: "single",
    speakers: [],
    segments: [
      {
        kind: "intro",
        title: "Intro",
        guidance:
          "Tell listeners this episode is theirs: how the questions came in and how to send the next ones.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "Welcome to [show name] — this episode belongs to you. You sent the questions, I'm answering them. Let's start.",
          },
        ],
      },
      {
        kind: "segment",
        title: "Question One",
        guidance:
          "Read the question in the listener's own words and credit them by name before you answer.",
        minutes: 5,
        starterLines: [
          {
            speaker: "HOST",
            line: "First one comes from [listener name]: '[their question]' — great question. Here's my answer: [the answer].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Question Two",
        guidance:
          "Same shape. If the honest answer is 'it depends', say what it depends on.",
        minutes: 5,
        starterLines: [
          {
            speaker: "HOST",
            line: "Next, [listener name] asks: '[their question]' — [the answer].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Question Three",
        guidance:
          "Save a question with a story in it for here — answer it with the example, not just the rule.",
        minutes: 5,
        starterLines: [
          {
            speaker: "HOST",
            line: "[Listener name] wants to know: '[their question]' — let me answer that with a story: [the example].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Rapid Fire",
        guidance:
          "Clear the small questions fast: read each one, answer in a line or two, keep moving.",
        minutes: 3,
        starterLines: [
          {
            speaker: "HOST",
            line: "Rapid fire to finish: [listener name] asks [short question] — [short answer]. And [listener name] asks [short question] — [short answer].",
          },
        ],
      },
      {
        kind: "outro",
        title: "Outro",
        guidance:
          "Thank everyone who asked, and tell listeners exactly where to send questions for the next Q&A.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "That's your questions answered. Send the next round to [where to send them], follow the show, and I'll see you in the next episode.",
          },
        ],
      },
    ],
  },
  {
    id: "deep-dive-explainer",
    name: "Deep-Dive Explainer",
    tagline: "One topic, taken all the way down",
    description:
      "Switches to Script mode with a solo host and seeds the script with an eight-segment explainer structure — a cold-open question, three chapters that go deeper each time, a myth check and a recap. Title, description, voice and music bed stay yours.",
    mode: "script",
    format: "single",
    speakers: [],
    segments: [
      {
        kind: "hook",
        title: "The Big Question",
        guidance:
          "Open with the one question this episode answers — the version of it people actually ask, in their words.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "Why does [the topic] actually work the way it does? Today we go all the way down — no shortcuts.",
          },
        ],
      },
      {
        kind: "intro",
        title: "Intro",
        guidance:
          "Name the show and the promise: one topic, fully explained, in plain words.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "Welcome to [show name], I'm [your name] — and today we're explaining [the topic] from the ground up.",
          },
        ],
      },
      {
        kind: "segment",
        title: "Chapter One — The Ground Floor",
        guidance:
          "Start with what everyone can see: the basics, the vocabulary, the simple version that's actually true.",
        minutes: 6,
        starterLines: [
          {
            speaker: "HOST",
            line: "Chapter one: the ground floor. At its simplest, [the topic] is [the simple true version].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Chapter Two — How It Really Works",
        guidance:
          "Go one level deeper: the mechanism. Use one concrete example and follow it all the way through.",
        minutes: 7,
        starterLines: [
          {
            speaker: "HOST",
            line: "Chapter two: how it really works. Follow this example — [the example] — and watch what happens step by step.",
          },
        ],
      },
      {
        kind: "segment",
        title: "Chapter Three — The Deep Water",
        guidance:
          "The part most explainers skip: the edge cases, the trade-offs, and what the experts argue about.",
        minutes: 6,
        starterLines: [
          {
            speaker: "HOST",
            line: "Chapter three: the deep water. Here's where it gets interesting — [the complication most people never hear about].",
          },
        ],
      },
      {
        kind: "segment",
        title: "The Myth Check",
        guidance:
          "Take the most repeated claim about this topic and test it honestly — keep what's true, correct what isn't.",
        minutes: 4,
        starterLines: [
          {
            speaker: "HOST",
            line: "Myth check. You've probably heard that [the common claim]. Here's what's actually true: [the correction].",
          },
        ],
      },
      {
        kind: "segment",
        title: "The Recap",
        guidance:
          "Rebuild the whole explanation in under two minutes — if a listener remembers nothing else, they remember this.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "So, the whole thing in one breath: [the one-paragraph version of the explanation].",
          },
        ],
      },
      {
        kind: "outro",
        title: "Outro",
        guidance:
          "Close with the question the episode opened with — answered — and invite the next topic suggestion.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "That's [the topic], all the way down. What should we take apart next? Send it in, follow the show, and I'll see you in the next deep dive.",
          },
        ],
      },
    ],
  },
  {
    id: "audio-diary",
    name: "Audio Diary",
    tagline: "A few honest minutes, on a rhythm",
    description:
      "Switches to Script mode with a solo host and seeds the script with a six-segment diary structure — today's moment, the lesson inside it, and tomorrow's intention, built to run daily or weekly. Title, description, voice and music bed stay yours.",
    mode: "script",
    format: "single",
    speakers: [],
    segments: [
      {
        kind: "intro",
        title: "Opening the Diary",
        guidance:
          "Date the entry out loud and say where you're recording from — the diary feeling lives in those small specifics.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "Dear diary — it's [today's date], I'm [where you are], and here's today's entry.",
          },
        ],
      },
      {
        kind: "segment",
        title: "Today's Moment",
        guidance:
          "Tell the one moment from today that stuck — small is fine. Tell it like it happened, in order.",
        minutes: 3,
        starterLines: [
          {
            speaker: "HOST",
            line: "Today, the moment that stuck was [the moment] — here's exactly how it went.",
          },
        ],
      },
      {
        kind: "segment",
        title: "What It Taught Me",
        guidance:
          "Pull the one lesson out of the moment. One is enough — the diary is a rhythm, not a lecture.",
        minutes: 3,
        starterLines: [
          {
            speaker: "HOST",
            line: "What it taught me: [the lesson]. I didn't see it that way this morning.",
          },
        ],
      },
      {
        kind: "segment",
        title: "The Honest Part",
        guidance:
          "Say the part you'd usually leave out — the doubt, the mess, the unfinished bit. That's why listeners come back.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "The honest part? [The thing you're still figuring out]. It's not wrapped up, and that's where it stands.",
          },
        ],
      },
      {
        kind: "segment",
        title: "Tomorrow's Intention",
        guidance:
          "Set one small intention for tomorrow — small enough that future-you can actually keep it.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "Tomorrow's intention is simple: [the one small intention]. That's the whole list.",
          },
        ],
      },
      {
        kind: "outro",
        title: "Closing the Diary",
        guidance:
          "Close the entry the same way every time — a diary needs a ritual ending listeners can count on.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "That's today's entry. Same time [tomorrow / next week] — until then, [your sign-off].",
          },
        ],
      },
    ],
  },
  {
    id: "review-desk",
    name: "Review Desk",
    tagline: "Test it properly, then give the verdict",
    description:
      "Switches to Script mode with a solo host and seeds the script with a seven-segment review structure — first impressions, a real deep test, a scored verdict, and who it's actually for. Title, description, voice and music bed stay yours.",
    mode: "script",
    format: "single",
    speakers: [],
    segments: [
      {
        kind: "hook",
        title: "The Verdict Tease",
        guidance:
          "Tease the verdict without giving it away — the one surprise from testing that decides everything.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "I tested [the thing] properly — and one thing surprised me enough to change the whole verdict.",
          },
        ],
      },
      {
        kind: "intro",
        title: "What's on the Desk",
        guidance:
          "Name what's being reviewed, what it costs, and exactly how you tested it — the method is what makes a verdict believable.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "Welcome to the Review Desk. Today: [the thing], which costs [the price] — and I tested it by [how you tested it].",
          },
        ],
      },
      {
        kind: "segment",
        title: "First Impressions",
        guidance:
          "The out-of-the-box truth: what it feels like in the first hour, before habit smooths the edges.",
        minutes: 4,
        starterLines: [
          {
            speaker: "HOST",
            line: "First impressions: [what stood out first] — and the first annoyance showed up fast: [the annoyance].",
          },
        ],
      },
      {
        kind: "segment",
        title: "The Deep Test",
        guidance:
          "The real work: push it on the jobs it promises to do, and note exactly where it holds and where it breaks.",
        minutes: 8,
        starterLines: [
          {
            speaker: "HOST",
            line: "Now the deep test. I put it through [the main job it promises] — here's where it held up, and here's where it broke: [the findings].",
          },
        ],
      },
      {
        kind: "segment",
        title: "The Scorecard",
        guidance:
          "Score the same categories every review, out loud, with one line of why for each — consistency is what makes scores comparable.",
        minutes: 3,
        starterLines: [
          {
            speaker: "HOST",
            line: "The scorecard: [category one] — [score] out of ten, because [the reason]. [Category two] — [score], because [the reason].",
          },
        ],
      },
      {
        kind: "segment",
        title: "Who It's For",
        guidance:
          "Say plainly who should buy it, who should skip it, and what they should get instead.",
        minutes: 2,
        starterLines: [
          {
            speaker: "HOST",
            line: "So who is this for? If you're [the right buyer], it's a yes. If you're [the wrong buyer], skip it — get [the alternative] instead.",
          },
        ],
      },
      {
        kind: "outro",
        title: "Outro",
        guidance:
          "Land the verdict in one sentence, then tell listeners what lands on the desk next.",
        minutes: 1,
        starterLines: [
          {
            speaker: "HOST",
            line: "Final verdict: [the one-sentence verdict]. Next on the desk: [the next thing]. Follow the show so you don't miss it.",
          },
        ],
      },
    ],
  },
];

export function getPodcastEpisodeTemplate(id: string): PodcastEpisodeTemplate | null {
  return PODCAST_EPISODE_TEMPLATES.find((tpl) => tpl.id === id) ?? null;
}

/** Total suggested minutes across a template's segments. */
export function podcastTemplateMinutes(template: PodcastEpisodeTemplate): number {
  return template.segments.reduce((sum, s) => sum + s.minutes, 0);
}

/**
 * One-line summary of exactly what a template seeds, built from its
 * own structure (never hand-written per template), e.g.
 * "6 segments · ~30 min of structure · 2 voices".
 * The shelf card renders this so the label always matches the prefill.
 */
export function podcastTemplateSummary(template: PodcastEpisodeTemplate): string {
  const parts = [
    `${template.segments.length} segments`,
    `~${podcastTemplateMinutes(template)} min of structure`,
  ];
  parts.push(
    template.mode === "dialogue"
      ? `${template.speakers.length} voices`
      : "Solo host",
  );
  return parts.join(" · ");
}

/**
 * The seeded script text for a template, in the exact shape the
 * existing rails parse:
 *   - one `# Heading` line per segment (chapter marker on the Script
 *     rail, ignored-as-structure on the Dialogue rail — never spoken);
 *   - Script templates: each starter line untagged (the host reads it);
 *   - Dialogue templates: each starter line tagged `SPEAKER: line`,
 *     the tag format both dialogue parsers already understand.
 * Guidance is NOT included — it lives on the shelf card's rundown.
 */
export function buildPodcastTemplateScript(template: PodcastEpisodeTemplate): string {
  const blocks = template.segments.map((segment) => {
    const lines = segment.starterLines.map((l) =>
      template.mode === "dialogue" ? `${l.speaker}: ${l.line}` : l.line,
    );
    return [`# ${segment.title}`, ...lines].join("\n");
  });
  return blocks.join("\n\n");
}

/** The form prefill a template applies — the exact object the Podcast
 *  desk's apply handler consumes. */
export interface PodcastTemplatePrefill {
  mode: "script" | "dialogue";
  /** Host format to select, or null to leave the control untouched. */
  format: PodcastFormat | null;
  /** Script text to seed, or null when the template is a Dialogue one. */
  script: string | null;
  /** Dialogue script to seed, or null when the template is a Script one. */
  dialogueScript: string | null;
}

/**
 * Apply a starter template: a pure prefill. Returns exactly the form
 * fields the template sets — the episode title, description, voices
 * and music bed are never part of it, and nothing is submitted or
 * charged. This is the exact function the Podcast desk calls.
 */
export function podcastTemplatePrefill(
  template: PodcastEpisodeTemplate,
): PodcastTemplatePrefill {
  const seeded = buildPodcastTemplateScript(template);
  return {
    mode: template.mode,
    format: template.format,
    script: template.mode === "script" ? seeded : null,
    dialogueScript: template.mode === "dialogue" ? seeded : null,
  };
}
