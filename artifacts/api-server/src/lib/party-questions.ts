/**
 * party-questions.ts — the Party Games trivia bank (v1).
 *
 * House rules for this file:
 *  - Real questions with one unambiguously correct answer each.
 *  - House voice where it fits (the palace, the crown, the studio) —
 *    knowledge first, flavor second.
 *  - NO other-company names anywhere: no rival platforms, no labels,
 *    no gear brands. Questions test music, the creator craft, and
 *    general knowledge — never somebody else's trademark.
 *  - The bank is validated by tests (party-bank integrity): unique
 *    ids and prompts, exactly 4 distinct choices, a valid answer
 *    index, and every category carrying at least 10 questions.
 *
 * The server NEVER sends `answer` to a client before the reveal —
 * the room engine (lib/party-rooms.ts) strips it from question frames.
 */

export const PARTY_CATEGORIES = ["music", "creator", "general"] as const;
export type PartyCategory = (typeof PARTY_CATEGORIES)[number];

export interface PartyQuestion {
  id: string;
  category: PartyCategory;
  prompt: string;
  choices: [string, string, string, string];
  /** Index into choices of the correct answer. Server-only until reveal. */
  answer: number;
}

export const PARTY_QUESTIONS: PartyQuestion[] = [
  /* ── Music ─────────────────────────────────────────────────────────── */
  {
    id: "m01",
    category: "music",
    prompt: "How many notes are in one octave of a major scale, counting the top note that repeats the first?",
    choices: ["Seven", "Eight", "Twelve", "Five"],
    answer: 1,
  },
  {
    id: "m02",
    category: "music",
    prompt: "In 4/4 time, how many quarter-note beats fit in one measure?",
    choices: ["Three", "Six", "Four", "Eight"],
    answer: 2,
  },
  {
    id: "m03",
    category: "music",
    prompt: "A standard piano has how many keys?",
    choices: ["88", "76", "96", "84"],
    answer: 0,
  },
  {
    id: "m04",
    category: "music",
    prompt: "Which of these is the lowest-sounding standard string on a six-string guitar in standard tuning?",
    choices: ["The high E string", "The A string", "The G string", "The low E string"],
    answer: 3,
  },
  {
    id: "m05",
    category: "music",
    prompt: "What does BPM stand for in music production?",
    choices: ["Bass per measure", "Beats per minute", "Bars per melody", "Bytes per mix"],
    answer: 1,
  },
  {
    id: "m06",
    category: "music",
    prompt: "Which instrument family does the saxophone belong to?",
    choices: ["Brass", "Strings", "Woodwind", "Percussion"],
    answer: 2,
  },
  {
    id: "m07",
    category: "music",
    prompt: "A song's chorus is best described as what?",
    choices: [
      "The repeated main section everyone remembers",
      "The quiet intro before the beat drops",
      "The spoken bridge near the end",
      "The final fading note",
    ],
    answer: 0,
  },
  {
    id: "m08",
    category: "music",
    prompt: "If a track plays at 120 BPM, how long does one beat last?",
    choices: ["One second", "Two seconds", "A quarter second", "Half a second"],
    answer: 3,
  },
  {
    id: "m09",
    category: "music",
    prompt: "In sheet music, a sharp sign (#) does what to a note?",
    choices: ["Lowers it a half step", "Raises it a half step", "Doubles its length", "Makes it silent"],
    answer: 1,
  },
  {
    id: "m10",
    category: "music",
    prompt: "Which drum in a standard kit is played with a foot pedal and anchors the low pulse?",
    choices: ["Snare", "Hi-hat", "Kick drum", "Floor tom"],
    answer: 2,
  },
  {
    id: "m11",
    category: "music",
    prompt: "A cappella singing means singing…",
    choices: ["In a cathedral", "Very quietly", "Without instrumental backing", "In harmony only"],
    answer: 2,
  },
  {
    id: "m12",
    category: "music",
    prompt: "How many strings does a standard violin have?",
    choices: ["Four", "Five", "Six", "Three"],
    answer: 0,
  },

  /* ── Creator craft ─────────────────────────────────────────────────── */
  {
    id: "c01",
    category: "creator",
    prompt: "In video, what does 'B-roll' mean?",
    choices: [
      "The backup camera battery",
      "Supplementary footage cut over the main shot",
      "A blooper reel",
      "The second take of a scene",
    ],
    answer: 1,
  },
  {
    id: "c02",
    category: "creator",
    prompt: "A video recorded at 24 frames per second is prized because it looks…",
    choices: ["More like cinema film", "Sharper on phones", "Smaller in file size", "Brighter in daylight"],
    answer: 0,
  },
  {
    id: "c03",
    category: "creator",
    prompt: "On a live stream, the 'chat delay' viewers feel mostly comes from…",
    choices: [
      "The host reading slowly",
      "The time video takes to travel and be processed",
      "Viewers typing speed",
      "The channel's follower count",
    ],
    answer: 1,
  },
  {
    id: "c04",
    category: "creator",
    prompt: "What is a thumbnail's main job on a video page?",
    choices: [
      "To store the video file",
      "To prove the video is long",
      "To earn the click honestly",
      "To hide the title",
    ],
    answer: 2,
  },
  {
    id: "c05",
    category: "creator",
    prompt: "Three-point lighting uses a key light, a fill light, and a…?",
    choices: ["Strobe light", "Back light", "Candle light", "Ring light only"],
    answer: 1,
  },
  {
    id: "c06",
    category: "creator",
    prompt: "In audio recording, 'gain' set too high usually causes…",
    choices: ["A warmer tone", "Clipping and distortion", "Free reverb", "A longer recording"],
    answer: 1,
  },
  {
    id: "c07",
    category: "creator",
    prompt: "A creator's 'hook' in the first seconds of a video should do what?",
    choices: [
      "List every sponsor",
      "Ask viewers to leave",
      "Show the credits",
      "Give viewers a reason to stay",
    ],
    answer: 3,
  },
  {
    id: "c08",
    category: "creator",
    prompt: "What does a pop filter protect a recording from?",
    choices: ["Sunlight glare", "Harsh breath blasts on the mic", "Background music", "Dust in the lens"],
    answer: 1,
  },
  {
    id: "c09",
    category: "creator",
    prompt: "Here in the palace, a creator's profile page doubles as their…?",
    choices: ["Mailbox", "Website and store in one", "Alarm clock", "Photo frame"],
    answer: 1,
  },
  {
    id: "c10",
    category: "creator",
    prompt: "'Going live' to an empty room is still worth it early on because…",
    choices: [
      "The replay can still find its audience",
      "Nobody can ever find it later",
      "It deletes itself in an hour",
      "It only counts if a crowd watches live",
    ],
    answer: 0,
  },
  {
    id: "c11",
    category: "creator",
    prompt: "In editing, a 'jump cut' is…",
    choices: [
      "A cut that skips forward in the same shot",
      "A cut to a different camera only",
      "A cut made by mistake",
      "The final cut of the video",
    ],
    answer: 0,
  },
  {
    id: "c12",
    category: "creator",
    prompt: "The golden rule of posting consistently is to pick a schedule you can…?",
    choices: ["Change every day", "Actually keep", "Copy from a rival", "Keep secret"],
    answer: 1,
  },

  /* ── General ───────────────────────────────────────────────────────── */
  {
    id: "g01",
    category: "general",
    prompt: "How many sides does a hexagon have?",
    choices: ["Five", "Seven", "Six", "Eight"],
    answer: 2,
  },
  {
    id: "g02",
    category: "general",
    prompt: "Which planet is known as the Red Planet?",
    choices: ["Venus", "Mars", "Jupiter", "Mercury"],
    answer: 1,
  },
  {
    id: "g03",
    category: "general",
    prompt: "What is the largest ocean on Earth?",
    choices: ["Atlantic", "Indian", "Arctic", "Pacific"],
    answer: 3,
  },
  {
    id: "g04",
    category: "general",
    prompt: "How many minutes are in three and a half hours?",
    choices: ["210", "190", "230", "200"],
    answer: 0,
  },
  {
    id: "g05",
    category: "general",
    prompt: "Which of these animals is a marsupial?",
    choices: ["Koala", "Panda", "Hedgehog", "Otter"],
    answer: 0,
  },
  {
    id: "g06",
    category: "general",
    prompt: "Water is made of hydrogen and which other element?",
    choices: ["Carbon", "Nitrogen", "Oxygen", "Helium"],
    answer: 2,
  },
  {
    id: "g07",
    category: "general",
    prompt: "A shark's skeleton is mostly made of what?",
    choices: ["Solid bone", "Cartilage", "Keratin", "Coral"],
    answer: 1,
  },
  {
    id: "g08",
    category: "general",
    prompt: "If the King deals you 4 gold coins a day for a week, how many coins do you hold?",
    choices: ["24", "28", "21", "32"],
    answer: 1,
  },
  {
    id: "g09",
    category: "general",
    prompt: "Which color do you get by mixing blue and yellow paint?",
    choices: ["Purple", "Orange", "Green", "Brown"],
    answer: 2,
  },
  {
    id: "g10",
    category: "general",
    prompt: "How many continents are there on Earth?",
    choices: ["Five", "Six", "Seven", "Eight"],
    answer: 2,
  },
  {
    id: "g11",
    category: "general",
    prompt: "Which is the fastest land animal?",
    choices: ["Lion", "Cheetah", "Racehorse", "Greyhound"],
    answer: 1,
  },
  {
    id: "g12",
    category: "general",
    prompt: "A dozen crowns plus half a dozen crowns makes how many crowns?",
    choices: ["16", "20", "24", "18"],
    answer: 3,
  },
];

/** Questions for one category, in bank order. */
export function questionsForCategory(category: PartyCategory): PartyQuestion[] {
  return PARTY_QUESTIONS.filter((q) => q.category === category);
}

/** Bank self-check used by the integrity tests (and cheap to re-run
 *  anywhere): every question well-formed, ids/prompts unique, each
 *  category carrying at least 10 questions, at least 30 overall. */
export function validateQuestionBank(bank: PartyQuestion[] = PARTY_QUESTIONS): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const prompts = new Set<string>();
  const perCategory = new Map<PartyCategory, number>();
  for (const q of bank) {
    if (ids.has(q.id)) problems.push(`duplicate id ${q.id}`);
    ids.add(q.id);
    const promptKey = q.prompt.trim().toLowerCase();
    if (prompts.has(promptKey)) problems.push(`duplicate prompt ${q.id}`);
    prompts.add(promptKey);
    if (q.choices.length !== 4) problems.push(`${q.id}: needs exactly 4 choices`);
    if (new Set(q.choices).size !== q.choices.length) problems.push(`${q.id}: choices must be distinct`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      problems.push(`${q.id}: answer index out of range`);
    }
    if (!PARTY_CATEGORIES.includes(q.category)) problems.push(`${q.id}: unknown category`);
    perCategory.set(q.category, (perCategory.get(q.category) ?? 0) + 1);
  }
  for (const cat of PARTY_CATEGORIES) {
    if ((perCategory.get(cat) ?? 0) < 10) problems.push(`category ${cat} has fewer than 10 questions`);
  }
  if (bank.length < 30) problems.push("bank has fewer than 30 questions");
  return problems;
}
