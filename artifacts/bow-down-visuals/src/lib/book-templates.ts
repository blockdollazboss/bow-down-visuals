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
   and the genre fits CreateBookSchema.

   Stack-300 census-D additions: the shelf's first fiction starters
   (novel — one continuous arc; short-story-collection — discrete
   standalone stories, a different job from both) and guided-journal
   (the secular prompt journal — devotional is explicitly faith-based
   and workbook is skill exercises, so daily reflection prompts had
   no starter).

   Stack-400 census-D additions: the shelf's first script formats —
   screenplay (a scene-by-scene script scaffold: sluglines, action,
   dialogue) and comic-book-script (a panel-by-panel script scaffold).
   The eleven before them are written to be read as finished pages;
   these two are written to be produced. */

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
  {
    id: "workbook",
    name: "Learn by Doing",
    genre: "Workbook",
    blurb: "An interactive workbook — every lesson paired with exercises and a check-your-work chapter.",
    audience: "For teachers, coaches, and creators whose readers learn by doing.",
    chapters: [
      {
        title: "How This Workbook Works",
        kind: "front",
        guidance:
          "Set the contract with your reader: every lesson comes in three beats — learn it, practise it, check it. Say what they'll need (a pen, twenty honest minutes), and promise them this book works only if they write in it.",
      },
      {
        title: "Lesson One — The First Idea",
        kind: "chapter",
        guidance:
          "Teach the first concept the gentle way: one idea only, in plain words, with a fully worked example they can follow line by line. Resist adding the second idea — it has its own lesson.",
      },
      {
        title: "Exercises — Your First Reps",
        kind: "chapter",
        guidance:
          "Practice for lesson one, graded easy to hard: two warm-ups, three working problems, one stretch. Leave real writing space after each — white space is part of the teaching.",
      },
      {
        title: "Check Your Work — Lesson One",
        kind: "chapter",
        guidance:
          "Answers for the first exercises, with the reasoning shown — not just the result. Where a wrong answer is common, name what it usually means and which page to revisit.",
      },
      {
        title: "Lesson Two — Standing on Lesson One",
        kind: "chapter",
        guidance:
          "The second concept, taught entirely on top of the first: show the connection out loud, reuse lesson one's worked example, and extend it one careful step further.",
      },
      {
        title: "Exercises — Mixed Practice",
        kind: "chapter",
        guidance:
          "Practice that mixes both lessons without labelling which is which — the reader has to recognise the tool, not just use it. Keep the easy-to-hard ladder and the writing space.",
      },
      {
        title: "Check Your Work — Lesson Two",
        kind: "chapter",
        guidance:
          "Answers and reasoning for the mixed set. End this section with three questions readers ask themselves honestly — a self-check that tells them whether to move on or loop back.",
      },
      {
        title: "The Final Project",
        kind: "chapter",
        guidance:
          "One bigger piece of work that uses everything in the book, broken into milestones. Tell them what done looks like, how long to give it, and how to judge their own result kindly.",
      },
      {
        title: "Complete Answer Key",
        kind: "back",
        guidance:
          "Every exercise answer in one place, in book order, for readers who like to check at the end instead of along the way. Keep the explanations with the answers — the key is a teacher too.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, what you teach, and where readers can find your courses, videos, or next workbook.",
      },
    ],
  },
  {
    id: "lyric-book",
    name: "Words & Pictures",
    genre: "Lyric Book",
    blurb: "Your record as a book — full lyrics, photo plates, and the story behind the songs.",
    audience: "For recording artists giving fans the whole world of an album.",
    chapters: [
      {
        title: "A Note From the Artist",
        kind: "front",
        guidance:
          "One page in your own voice: what this record means to you and why these songs deserved a book. Fans keep lyric books forever — write the note you'd want found in twenty years.",
      },
      {
        title: "Song One — The Opener",
        kind: "chapter",
        guidance:
          "The full lyrics of the opening song, exactly as recorded — every ad-lib and repeat as sung. Note the writers under the title, and leave the facing page for a photo plate from the sessions.",
      },
      {
        title: "Song Two — Lyrics & Plate",
        kind: "chapter",
        guidance:
          "The second song's complete lyrics, with its writing credits. Pair it with one strong photo — stage, studio, or the road — and a line of caption saying where and when.",
      },
      {
        title: "Song Three — Lyrics & Plate",
        kind: "chapter",
        guidance:
          "The third song, same treatment: lyrics as recorded, credits beneath the title, a plate opposite. Duplicate this chapter for every remaining song on the record — the rhythm of the book is song, picture, song.",
      },
      {
        title: "The Photo Plates",
        kind: "chapter",
        guidance:
          "A run of full-page photographs with no lyrics at all: the studio days, the stage nights, the faces behind the record. Sequence them the way the album flows — quiet, loud, quiet.",
      },
      {
        title: "Liner Notes — The Story of This Record",
        kind: "chapter",
        guidance:
          "The chapter fans read first and collectors treasure: where the record was made, who played on it, the song that almost didn't make it, and the night it all came together. Tell it like a story, not a press release.",
      },
      {
        title: "Credits",
        kind: "back",
        guidance:
          "Every name, completely: songwriters, musicians, producers, engineers, mixers, photographers, designers. Check spellings twice — a credits page is a promise, and people keep it.",
      },
      {
        title: "About the Artist",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, the records before this one, and where fans can hear more and find you on tour.",
      },
    ],
  },
  {
    id: "novel",
    name: "Tell the Story Only You Can",
    genre: "Fiction",
    blurb: "A real story arc in eight chapters — an opening image, a darkest moment, and an ending that pays for all of it.",
    audience: "For fiction writers drafting a novel with a spine, not just a stack of scenes.",
    chapters: [
      {
        title: "Title Page & Dedication",
        kind: "front",
        guidance:
          "Your book's first impression: the title, your name, and a short dedication to the person (or the season) this story belongs to. It can be a single line — plain is powerful here.",
      },
      {
        title: "A Note Before You Begin",
        kind: "front",
        guidance:
          "A short, optional door-opener: what kind of story this is and anything you want the reader carrying into chapter one — and nothing that spoils the turn waiting at the middle.",
      },
      {
        title: "The Opening Image",
        kind: "chapter",
        guidance:
          "Show the hero's world as it is before the story happens: who they are, what an ordinary day holds, and the want they haven't admitted yet. This is the picture the ending gets measured against.",
      },
      {
        title: "The Inciting Incident",
        kind: "chapter",
        guidance:
          "The event that breaks the ordinary: an arrival, a loss, an offer, a discovery. By the end of this chapter, the hero's old life must be impossible to simply resume.",
      },
      {
        title: "The First Attempt",
        kind: "chapter",
        guidance:
          "The hero acts on the new situation with the tools they already have — and it half-works or half-fails. Show what they learn from the attempt; the story's rules get established here.",
      },
      {
        title: "Complications",
        kind: "chapter",
        guidance:
          "Everything gets harder: allies wobble, the opposition pushes back, and the cost of continuing rises. Give the hero a real reason to quit — then have them continue anyway.",
      },
      {
        title: "The Midpoint Turn",
        kind: "chapter",
        guidance:
          "Halfway through, everything changes — a revelation, a betrayal, a door that can't close again. Raise the stakes and change what the story is about underneath.",
      },
      {
        title: "The Darkest Moment",
        kind: "chapter",
        guidance:
          "The hero loses the thing they were protecting, or faces the truth they've been avoiding. Let it hurt on the page; the climb out only matters if the bottom is real.",
      },
      {
        title: "The Climax",
        kind: "chapter",
        guidance:
          "The final confrontation the whole book has been promising: the hero faces the central problem with nothing left to hide behind. Let who they've become decide it — not luck.",
      },
      {
        title: "The Resolution",
        kind: "chapter",
        guidance:
          "The new ordinary: show the world after the climax in a scene, not a summary. Echo the opening image so the reader can feel exactly how far the hero has travelled.",
      },
      {
        title: "Epilogue",
        kind: "back",
        guidance:
          "A short last look from a little distance — one scene or reflection that seals the story's meaning and lets the reader set the book down gently. A page or two is plenty.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, what you write, where you live, and where readers can find your next book.",
      },
    ],
  },
  {
    id: "short-story-collection",
    name: "Stories, Linked",
    genre: "Short Stories",
    blurb: "Five standalone stories under one cover — each complete alone, stronger together for the thread that links them.",
    audience: "For storytellers with finished tales that belong in one book.",
    chapters: [
      {
        title: "Preface — The Thread That Links Them",
        kind: "front",
        guidance:
          "Tell the reader what connects these stories — a place, a family, a question, a season of life — and how to read them: in order, or dipped into. Keep it to a page; the stories are the argument.",
      },
      {
        title: "The First Story",
        kind: "chapter",
        guidance:
          "Open with the story carried by a character: one person, one want, one pressure that won't let go. Choose your most welcoming tale — it teaches the reader how this book reads.",
      },
      {
        title: "The Second Story",
        kind: "chapter",
        guidance:
          "A story where the place does the pushing: a street, a house, a town that shapes what everyone in it can do. Let the setting act like a character with rules of its own.",
      },
      {
        title: "The Third Story",
        kind: "chapter",
        guidance:
          "A story built on a decision with no clean option: two goods pulling apart, or two losses. Stay with the moment of choosing, and with what it costs afterwards — that's the engine.",
      },
      {
        title: "The Fourth Story",
        kind: "chapter",
        guidance:
          "A story powered by something hidden: who knows it, who mustn't, and the scene where it almost surfaces. Keep the revelation earned — no twist the story hasn't paid for.",
      },
      {
        title: "The Last Story",
        kind: "chapter",
        guidance:
          "Close with a reunion: people — or a person and a place — meeting again after time has changed them. Placed last, it can quietly rhyme with the first story and tie off the thread.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, where your stories have appeared, and where readers can find more of your work.",
      },
    ],
  },
  {
    id: "guided-journal",
    name: "Six Weeks of Honest Pages",
    genre: "Journal",
    blurb: "A guided daily journal in six weekly runs — a theme, a handful of prompts, and room to answer honestly.",
    audience: "For journal-keepers and coaches building a daily reflection practice readers can actually keep.",
    chapters: [
      {
        title: "How to Use This Journal",
        kind: "front",
        guidance:
          "Set the rhythm plainly: one prompt a day, a few honest lines, and no guilt-catching-up when a day is missed. Tell the reader what to keep nearby — a pen, ten unhurried minutes — and that there are no wrong answers.",
      },
      {
        title: "Week One — Where You Stand",
        kind: "chapter",
        guidance:
          "Seven prompts that take stock: where the reader's time, energy, and attention actually go today. Start observational, not judgmental — a clear map before any plans.",
      },
      {
        title: "Week Two — The People Around You",
        kind: "chapter",
        guidance:
          "Seven prompts on the reader's people: who steadies them, who drains them, who they owe a word. One prompt should end in a small real action — a message sent, a thanks given.",
      },
      {
        title: "Week Three — What You're Carrying",
        kind: "chapter",
        guidance:
          "Seven prompts on the load: worries, unfinished business, old stories on repeat. Handle gently — the week's last prompt should help the reader set one thing down, even temporarily.",
      },
      {
        title: "Week Four — What You Want",
        kind: "chapter",
        guidance:
          "Seven prompts that turn from inventory to desire: what the reader wants more of, less of, and next. Keep them concrete — a want you can picture beats a virtue you can't.",
      },
      {
        title: "Week Five — What You're Learning",
        kind: "chapter",
        guidance:
          "Seven prompts on growth: recent lessons, mistakes that taught, a skill quietly improving. Ask for evidence from real days, not aspirations — learning leaves receipts.",
      },
      {
        title: "Week Six — Where You're Headed",
        kind: "chapter",
        guidance:
          "The closing run: seven prompts that draft a direction — the next season in one page, the first small step, and one thing the reader will refuse to carry forward.",
      },
      {
        title: "Looking Back",
        kind: "back",
        guidance:
          "A final reflection chapter: prompts that send the reader back through their own entries to find the patterns, the surprises, and the one sentence that sums up the six weeks. End by inviting a start date for the next run.",
      },
      {
        title: "About the Author",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, the practice behind this journal, and where readers can find more of your work.",
      },
    ],
  },
  {
    id: "screenplay",
    name: "Write It for the Screen",
    genre: "Screenplay",
    blurb: "A script, scene by scene — sluglines, action, and dialogue in standard screen format.",
    audience: "For writers building a film, short, or episode script in proper screenplay shape.",
    chapters: [
      {
        title: "Title Page",
        kind: "front",
        guidance:
          "The script's cover, and nothing more: the title in caps, \"written by\", your name, and your contact details. No artwork, no tagline, no logline — a title page this plain is the format working as intended.",
      },
      {
        title: "Logline & Story Notes",
        kind: "front",
        guidance:
          "Your working brief while you draft: the one-sentence logline, the genre and tone, the hero's want and need, and the ending you're writing toward. If a scene serves none of it, the scene goes — this page is how you know.",
      },
      {
        title: "Sequence One — The Ordinary World",
        kind: "chapter",
        guidance:
          "Open in screen format: slugline (INT./EXT., place, time of day), lean action lines, dialogue under character names. Show the hero inside their ordinary world, in action — a screenplay shows; it never summarizes. Keep description to what a camera can see.",
      },
      {
        title: "Sequence Two — The Inciting Incident",
        kind: "chapter",
        guidance:
          "The event that breaks the ordinary: an arrival, a loss, an offer, a discovery. End this run of scenes with the hero facing a door they can't un-open — by the last scene, resuming the old life has to be impossible.",
      },
      {
        title: "Act Two, Part One — Tests and Allies",
        kind: "chapter",
        guidance:
          "The hero enters the new world and learns its rules the hard way: first attempts, early wins that cost more than expected, allies met and enemies revealed. Every scene should turn — the hero leaves it with something gained, lost, or understood.",
      },
      {
        title: "The Midpoint Turn",
        kind: "chapter",
        guidance:
          "Halfway through, the story changes underneath: a revelation, a betrayal, a victory that turns out to be the trap. Raise the stakes and give the hero a deadline — from here the clock is part of every scene.",
      },
      {
        title: "Act Two, Part Two — The Squeeze",
        kind: "chapter",
        guidance:
          "Everything tightens: allies wobble, the opposition closes in, and the cost of continuing rises scene by scene. End on the darkest moment — the hero loses the thing they were protecting, or faces the truth they've been avoiding.",
      },
      {
        title: "Act Three — The Climax",
        kind: "chapter",
        guidance:
          "The confrontation the whole script has been promising, played in full scenes — not montage. Let who the hero has become decide the outcome: the final choice should be one only this hero, after everything above, would make.",
      },
      {
        title: "The Final Image",
        kind: "chapter",
        guidance:
          "The last scene, short and deliberate: the new ordinary, in a picture that echoes the opening image so the audience can feel exactly how far the hero has travelled. Then FADE OUT. — the two hardest-working words in the format.",
      },
      {
        title: "About the Writer",
        kind: "back",
        guidance:
          "Three to five sentences in the third person: who you are, what you write, any produced or optioned work, and where readers and producers can reach you. Plain and factual — credits speak louder than adjectives.",
      },
    ],
  },
  {
    id: "comic-book-script",
    name: "Panels, Pages, Cliffhangers",
    genre: "Comic Book Script",
    blurb: "A comic script page by page — every page broken into panels with art direction and dialogue.",
    audience: "For writers scripting a comic or graphic story for an artist (or themselves) to draw.",
    chapters: [
      {
        title: "Series Bible — The World in Brief",
        kind: "front",
        guidance:
          "The standing reference the whole script leans on: the world and its rules, each recurring character in two or three lines (look, voice, what they want), and the places that will repeat. Artists draw consistently from this page — write it once, write it clearly.",
      },
      {
        title: "Page One — The Splash",
        kind: "chapter",
        guidance:
          "One full-page panel: the image the whole issue is remembered by. Describe it like a poster — subject, setting, mood, the one detail that asks a question. Dialogue is usually none; a caption or a single line of SFX is plenty. This page sells the next twenty.",
      },
      {
        title: "Pages 2–3 — Meet the Hero",
        kind: "chapter",
        guidance:
          "Break each page into numbered panels: for every panel write what the artist draws (shot size, angle, action) and hang the dialogue, captions, and SFX under it. Two pages to establish the hero in their world, mid-action — who they are, shown, not told.",
      },
      {
        title: "Pages 4–6 — The Problem Lands",
        kind: "chapter",
        guidance:
          "The trouble arrives and gets a face. Keep panels small and quick as the pressure builds, and end page six on a page-turn beat — a reveal, a threat, a door opening — the image that makes a reader flip instead of putting the issue down.",
      },
      {
        title: "Pages 7–9 — The First Attempt",
        kind: "chapter",
        guidance:
          "The hero acts on the problem with the tools they already have — and it half-works. Vary your panel shapes with the energy: wide panels for space and calm, tight grids for speed. Let the failure land in a quiet panel; silence draws well.",
      },
      {
        title: "Pages 10–12 — The Turn",
        kind: "chapter",
        guidance:
          "The midpoint revelation, drawn big: the ally who isn't, the power that costs, the truth under the story. Give the turn its own splash or near-splash page if it earns one — this is the image readers will describe to friends.",
      },
      {
        title: "Pages 13–15 — The Darkest Pages",
        kind: "chapter",
        guidance:
          "The hero at their lowest: fewer, heavier panels; darker compositions; dialogue thins out. Show the loss in what the art withholds — an empty chair, an unanswered caption box. Despair in comics is a layout choice as much as a line.",
      },
      {
        title: "Pages 16–18 — The Climax",
        kind: "chapter",
        guidance:
          "The confrontation, panel by panel, at the issue's fastest cutting: small panels, sharp angles, SFX doing real work. Sequence the action so a reader can follow every move without a single caption explaining it — then one wide panel for the blow that decides it.",
      },
      {
        title: "Page 19 — The Resolution",
        kind: "chapter",
        guidance:
          "The new ordinary in one page: the world after the climax, the hero changed and visible in it. Echo a panel from page one — same framing, different truth inside it. Readers feel the distance travelled without a word saying so.",
      },
      {
        title: "Page 20 — The Cliffhanger",
        kind: "chapter",
        guidance:
          "The last page points at the next issue: a new arrival, a revealed face, a problem thought buried standing in the doorway. End on one strong final panel and, at most, one line of dialogue. \"Next issue\" energy is a promise — make sure the next script keeps it.",
      },
      {
        title: "About the Writer & Artist",
        kind: "back",
        guidance:
          "Short bios for the writer and the artist (one person, if that's you): names, roles, past work, and where readers can follow the series. Comics are credited as a team — this page is where the team gets named.",
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
