/* ─── Thy Books starter templates (frontend structure) ───────────────────
   STACK100 wave 2, item 14: the Books desk started every book from a
   blank page while every sibling creation surface had starters (song
   presets, podcast templates, store starters, Go Live scenes).

   A template here is STRUCTURE ONLY — a genre plus a chapter outline
   (front matter, chapters, back matter), each entry carrying one or two
   sentences of guidance for what belongs in it. Applying a template is
   free: the new-book flow creates the book on the ordinary book rail,
   then creates one chapter per outline entry on the ordinary chapter
   rail and stores the entry's guidance as that chapter's ai_notes (the
   editor shows it as the chapter's plan). No AI rail is called and
   nothing is charged — the priced rails stay exactly where they were
   (AI writing assist 100 VB, AI cover 200 VB, print, publish).

   The shapes below are pinned against the real rails by
   book-starter-templates.test.ts: chapter titles fit the server's
   CreateChapterSchema, guidance fits UpdateChapterSchema's ai_notes,
   and the genre fits CreateBookSchema. */

export type BookTemplateSectionKind = "front" | "chapter" | "back";

export interface BookTemplateChapter {
  title: string;
  kind: BookTemplateSectionKind;
  /* What belongs in this section — seeded into the chapter's ai_notes
     and shown in the editor as the chapter plan. */
  guidance: string;
}

export interface BookTemplate {
  id: string;
  /* Shelf name — the promise of the structure, in our own voice. */
  name: string;
  /* Pre-fills the new book's genre field (the author can still edit it). */
  genre: string;
  /* One-line shelf summary of the shape. */
  blurb: string;
  /* Who this structure serves — the shelf card's second line. */
  audience: string;
  chapters: BookTemplateChapter[];
}

export const BOOK_TEMPLATES: BookTemplate[] = [
  {
    id: "memoir",
    name: "Tell Your Story",
    genre: "Memoir",
    blurb: "A life in chapters — where you come from, what changed you, what you know now.",
    audience: "For anyone whose own story is the book.",
    chapters: [
      {
        title: "Preface — Why I'm Writing This",
        kind: "front",
        guidance:
          "One or two pages, straight to the reader: why this story, why now, and what you hope they carry away. Keep it honest and short — the story itself starts next.",
      },
      {
        title: "Where I Come From",
        kind: "chapter",
        guidance:
          "Set the scene of your beginnings: the place, the people, the household rules spoken and unspoken. Small details (a street, a smell, a saying) do more than big summaries.",
      },
      {
        title: "The Early Years",
        kind: "chapter",
        guidance:
          "Pick three or four vivid memories from childhood and tell them as scenes. Don't cover everything — the moments that still feel warm or sharp are the ones that matter.",
      },
      {
        title: "The People Who Shaped Me",
        kind: "chapter",
        guidance:
          "Portraits of the two or three people who made you who you are — what they taught you, what it cost, what you'd say to them now.",
      },
      {
        title: "The Turning Point",
        kind: "chapter",
        guidance:
          "The moment everything tilted: a loss, a chance, a door opening or closing. Slow down here — let the reader stand in the room where it happened.",
      },
      {
        title: "The Hard Season",
        kind: "chapter",
        guidance:
          "The stretch you'd rather skip is the chapter readers will thank you for. Tell what it took, what it taught, and what it left behind — plainly, without dressing it up.",
      },
      {
        title: "What I Built",
        kind: "chapter",
        guidance:
          "The work, the family, the thing with your name on it. Show the building, not just the finished picture — false starts included.",
      },
      {
        title: "What I Know Now",
        kind: "chapter",
        guidance:
          "Close the arc: the lessons you'd hand back to your younger self, and what you're still learning. End on the truest sentence you can write.",
      },
      {
        title: "Acknowledgments",
        kind: "back",
        guidance:
          "Thank the people who carried this book and this life — by name where you can. Short is fine; specific is everything.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, what you do, where you live, and where readers can find more of your work.",
      },
    ],
  },
  {
    id: "how-to-guide",
    name: "Teach What You Know",
    genre: "How-To Guide",
    blurb: "A clear path from problem to result — your method, in steps a beginner can follow.",
    audience: "For experts, coaches, and creators with a method worth teaching.",
    chapters: [
      {
        title: "Introduction — The Problem This Book Solves",
        kind: "front",
        guidance:
          "Name the reader's problem in their own words, promise the result this book delivers, and say plainly who this is for — and who it isn't.",
      },
      {
        title: "Start Where You Are",
        kind: "chapter",
        guidance:
          "Meet the beginner honestly: what they actually need before step one (usually less than they fear), and the mindset that makes the rest work.",
      },
      {
        title: "The Core Idea",
        kind: "chapter",
        guidance:
          "Your whole method on one page: the principle underneath every step. If the reader gets only this chapter, they should still walk away changed.",
      },
      {
        title: "Step One — Lay the Foundation",
        kind: "chapter",
        guidance:
          "The first move, in order, with nothing skipped. Assume the reader knows nothing you haven't told them; show a finished example of this step done right.",
      },
      {
        title: "Step Two — Do the Work",
        kind: "chapter",
        guidance:
          "The heart of the method. Break it into small actions, name the order, and flag the exact spot where most people quit — and what to do instead.",
      },
      {
        title: "Step Three — Make It Stick",
        kind: "chapter",
        guidance:
          "How the reader turns a one-time result into a habit or a system: routines, check-ins, and the simple tracking that keeps progress visible.",
      },
      {
        title: "Common Mistakes (and How to Dodge Them)",
        kind: "chapter",
        guidance:
          "The five traps you've seen again and again — what each one looks like from inside, why it happens, and the fix for each.",
      },
      {
        title: "Your First Seven Days",
        kind: "chapter",
        guidance:
          "A day-by-day starter plan that puts the whole method into one week. Small wins early; the reader should feel progress by day two.",
      },
      {
        title: "Resources & Tools",
        kind: "back",
        guidance:
          "The short list you'd hand a friend: tools, supplies, further reading. Only what you genuinely use — a trusted short list beats a long directory.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: your credentials for teaching this, what you do, and where readers can learn more from you.",
      },
    ],
  },
  {
    id: "poetry-collection",
    name: "Verses & Reflections",
    genre: "Poetry",
    blurb: "A collection in movements — poems gathered into parts that carry the reader somewhere.",
    audience: "For poets arranging finished pieces into a book with a heartbeat.",
    chapters: [
      {
        title: "Dedication",
        kind: "front",
        guidance:
          "A line or two for the person (or the season) these poems belong to. It can be a single sentence — dedications earn their power by being plain.",
      },
      {
        title: "A Note Before You Read",
        kind: "front",
        guidance:
          "A short welcome: how these poems came to be and how you'd like them read — aloud, slowly, in order, or dipped into. Optional, but readers love a door held open.",
      },
      {
        title: "Part One — Beginnings",
        kind: "chapter",
        guidance:
          "Open with your most welcoming poems — the ones that teach a stranger your voice. Place each poem on its own page break as you write.",
      },
      {
        title: "Part Two — Love & Longing",
        kind: "chapter",
        guidance:
          "The heart of the collection: desire, devotion, absence. Sequence so the temperature rises and falls instead of staying at one pitch.",
      },
      {
        title: "Part Three — Storms",
        kind: "chapter",
        guidance:
          "Grief, anger, faith under pressure — the heavy weather. Don't soften these to match the rest of the book; contrast is what makes a collection breathe.",
      },
      {
        title: "Part Four — Healing",
        kind: "chapter",
        guidance:
          "The turn toward repair: forgiveness, small mercies, mornings that feel possible again. Let the light arrive gradually, not all at once.",
      },
      {
        title: "Part Five — Home",
        kind: "chapter",
        guidance:
          "Close where the reader can rest: belonging, gratitude, the ordinary made holy. End the collection on the poem you'd read at your own table.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, where your poems have appeared, and where readers can find more of your work.",
      },
    ],
  },
  {
    id: "picture-book",
    name: "A Story to Read Aloud",
    genre: "Children's Picture Book",
    blurb: "One scene per spread — a small hero, a big problem, and a warm way home.",
    audience: "For storytellers writing a picture book, one spread at a time.",
    chapters: [
      {
        title: "Dedication Page",
        kind: "front",
        guidance:
          "A few warm words for the child (or the grown-up) this story is for. Picture-book dedications are tiny and treasured — keep yours to a line or two.",
      },
      {
        title: "Spread 1 — Meet the Hero",
        kind: "chapter",
        guidance:
          "Introduce your hero in one scene: who they are, where they live, and the one thing they love most. Keep the text short — a few lines the pictures can carry.",
      },
      {
        title: "Spread 2 — A Big Problem",
        kind: "chapter",
        guidance:
          "Trouble arrives, sized for small shoulders: something lost, broken, or scary. One clear problem — the whole story hangs on it.",
      },
      {
        title: "Spread 3 — The First Try",
        kind: "chapter",
        guidance:
          "Your hero tries to fix it the obvious way — and it doesn't work. A funny or gentle failure here makes the ending land.",
      },
      {
        title: "Spread 4 — Things Get Worse",
        kind: "chapter",
        guidance:
          "Raise the stakes one notch: the problem grows or a clock starts ticking. This is the spread young listeners lean in for.",
      },
      {
        title: "Spread 5 — A Friend Helps",
        kind: "chapter",
        guidance:
          "Someone shows up — a friend, a sibling, a kind stranger — with help, a clue, or just company. Picture books teach that nobody solves everything alone.",
      },
      {
        title: "Spread 6 — The Clever Idea",
        kind: "chapter",
        guidance:
          "Your hero thinks of the fix themselves, using something the reader saw earlier. Fair-play surprises make the best read-aloud gasps.",
      },
      {
        title: "Spread 7 — It Works!",
        kind: "chapter",
        guidance:
          "The plan succeeds — big feeling, big moment. Let this spread be the loudest, happiest page in the book.",
      },
      {
        title: "Spread 8 — Home Again",
        kind: "chapter",
        guidance:
          "Land softly: the hero home, the world right again, one quiet line that says what the story was really about. The last line is the one they'll ask for again.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Two or three friendly sentences about you — grown-ups read this page while choosing the book. Mention other stories you've written, if any.",
      },
    ],
  },
  {
    id: "cookbook",
    name: "From My Kitchen",
    genre: "Cookbook",
    blurb: "Your signature dishes, organized by course — every recipe with its story.",
    audience: "For home cooks and chefs whose recipes deserve a book of their own.",
    chapters: [
      {
        title: "Introduction — My Kitchen Story",
        kind: "front",
        guidance:
          "How you learned to cook, who taught you, and what your food stands for. Readers cook from people they trust — this chapter is where they meet you.",
      },
      {
        title: "How to Use This Cookbook",
        kind: "front",
        guidance:
          "Your conventions in one page: how measurements run, your must-have tools, and how each recipe is laid out (story, ingredients, steps, one hard-won tip).",
      },
      {
        title: "Breakfast & Brunch",
        kind: "chapter",
        guidance:
          "Your morning signatures. Write each recipe the same way: a short story or note, the ingredient list, numbered steps, and the one tip that makes it yours.",
      },
      {
        title: "Starters & Sides",
        kind: "chapter",
        guidance:
          "The openers and the supporting cast. Note which dishes pair together — readers plan whole meals from hints like that.",
      },
      {
        title: "The Mains",
        kind: "chapter",
        guidance:
          "Your centerpiece dishes, weeknight heroes first, showstoppers last. Include timing honestly — readers forgive a long recipe, never a wrong one.",
      },
      {
        title: "Sweets & Desserts",
        kind: "chapter",
        guidance:
          "The sweet finish: bakes, no-bakes, and the dessert everyone requests by name. Flag the make-ahead ones — hosts will thank you.",
      },
      {
        title: "Drinks & Sips",
        kind: "chapter",
        guidance:
          "What you pour: punches, coolers, warm drinks, and the house special. One line each on when it shines — cookouts, holidays, quiet nights.",
      },
      {
        title: "Pantry Staples & Swaps",
        kind: "back",
        guidance:
          "The ingredients you always keep, and your honest substitution chart for when the store is out of something. This page gets bookmarked — write it generously.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, where you cook, and where readers can find more of your recipes.",
      },
    ],
  },
  {
    id: "devotional",
    name: "Thirty Days of Faith & Focus",
    genre: "Devotional",
    blurb: "Four weeks of daily readings — a verse, a reflection, and a prompt for every day.",
    audience: "For writers of devotionals and guided journals, one week at a time.",
    chapters: [
      {
        title: "How to Use This Book",
        kind: "front",
        guidance:
          "Welcome the reader and set the rhythm: one entry a day, a few quiet minutes, a pen nearby. Tell them plainly what to do when they miss a day (keep going — grace covers gaps).",
      },
      {
        title: "Week One — Gratitude",
        kind: "chapter",
        guidance:
          "Seven daily entries on thankfulness. Keep one shape all week: a short reading or verse, a reflection of a few paragraphs, one prayer or journal prompt, and a single line to carry into the day.",
      },
      {
        title: "Week Two — Courage",
        kind: "chapter",
        guidance:
          "Seven daily entries on doing hard things afraid. Same daily shape as week one; let the reflections grow a little bolder as the week builds.",
      },
      {
        title: "Week Three — Forgiveness",
        kind: "chapter",
        guidance:
          "Seven daily entries on letting go — of others, and of yourself. Handle this week gently; end each day with a prompt that points at one small release.",
      },
      {
        title: "Week Four — Purpose",
        kind: "chapter",
        guidance:
          "Seven daily entries on calling and the work of your hands. Close the month by helping the reader name one next step they'll actually take.",
      },
      {
        title: "A Closing Blessing",
        kind: "back",
        guidance:
          "A short blessing over the reader to finish the book — the words you'd say if they were sitting across the table. A page is plenty.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, your ministry or work, and where readers can find more of your writing.",
      },
    ],
  },
];

export function bookTemplateById(id: string): BookTemplate | undefined {
  return BOOK_TEMPLATES.find((tp) => tp.id === id);
}

/* ── The seed: exactly what applying a template creates ── */

export interface BookChapterSeed {
  title: string;
  kind: BookTemplateSectionKind;
  position: number;
  /* Stored as the new chapter's ai_notes; the editor shows it as the
     chapter's plan until the author writes over the chapter. */
  aiNotes: string;
}

export interface BookTemplateSeed {
  /* Pre-fills the new book's genre field. */
  genre: string;
  chapters: BookChapterSeed[];
}

/* Pure and total: the seed IS the template's outline, in order, with
   positions 0..n-1 and each entry's guidance carried verbatim. The
   new-book flow creates exactly these chapters — nothing more,
   nothing renamed — and book-starter-templates.test.ts pins that. */
export function bookTemplateSeed(template: BookTemplate): BookTemplateSeed {
  return {
    genre: template.genre,
    chapters: template.chapters.map((c, i) => ({
      title: c.title,
      kind: c.kind,
      position: i,
      aiNotes: c.guidance,
    })),
  };
}
