import { z } from "zod";

/* ─── Website Builder — template gallery data ────────────────────────────
   The gallery's templates are REAL starting builds, not mockups: each one
   is a complete static site (HTML pages + styles.css + script.js +
   README.md) in the exact file-map shape the builder generates, edits,
   previews, and zips. "Remix this template" seeds a build with these
   files; the conversational-edit rail then works on them like any build.

   Verticals mirror the AI Page Designer's creator verticals
   (routes/ai-page-designer.ts VERTICALS) — the gallery spans the four
   with the strongest in-house tuning: music, podcast, gaming, video.

   Placeholder discipline: anything that would be a FACT about the
   creator (name, titles, dates, quotes, numbers) is a clearly bracketed
   placeholder like [Your Stage Name] for the creator to replace — the
   templates never invent a creator's bio, dates, or credits. Generic
   structural copy (section headings, buttons, how-it-works text) is
   real copy, as on any starter theme. */

/* The builder's build schema for a site file map — the same completeness
   rule the generate/edit handlers enforce on AI output (a build must
   carry index.html and styles.css), codified so template data is
   validated against it in tests. */
export const siteFilesSchema = z
  .record(z.string().min(1), z.string().min(1))
  .refine((files) => Boolean(files["index.html"] && files["styles.css"]), {
    message: "A site build must include index.html and styles.css",
  });

export type SiteFiles = z.infer<typeof siteFilesSchema>;

/* Creator verticals, mirrored from the AI Page Designer
   (ai-page-designer.ts). The gallery test pins this mirror against the
   designer's exported VERTICALS so the two can never drift apart. */
export const TEMPLATE_VERTICALS = [
  "music",
  "video",
  "gaming",
  "podcast",
  "film",
  "tv",
  "influencer",
  "education",
  "other",
] as const;
export type TemplateVertical = (typeof TEMPLATE_VERTICALS)[number];

/** The gallery template ids — also template keys for generate/edit. */
export const WEBSITE_TEMPLATE_IDS = [
  "artist-site",
  "podcast-home",
  "streamer-hub",
  "showreel-portfolio",
] as const;
export type WebsiteTemplateId = (typeof WEBSITE_TEMPLATE_IDS)[number];

export interface WebsiteTemplate {
  /** Also the template key the generate/edit endpoints accept. */
  id: WebsiteTemplateId;
  /** Display name in plain creator language. */
  name: string;
  vertical: TemplateVertical;
  /** Short chip label, e.g. "For musicians". */
  verticalLabel: string;
  /** One line: who this starting point is best for. */
  bestFor: string;
  /** What the template is — feeds the AI prompt on generate-from-template. */
  description: string;
  /** Section names, in page order. */
  sections: string[];
  /** Starter brief tokens: remix prefills the brief form from these. */
  brief: {
    description: string;
    style: string;
    colorScheme: string;
  };
  /** The real starting build: file path -> complete file contents. */
  files: SiteFiles;
}

/* ═══ Template 1 — Artist Site (music) ══════════════════════════════════ */

const ARTIST_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>[Your Stage Name] — Official Site</title>
<meta name="description" content="[Your Stage Name] — [your sound in one line, e.g. soulful R&B from Atlanta]. Latest music, shows, and mailing list.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="index.html">[Your Stage Name]</a>
  <button class="nav-toggle" data-nav-toggle aria-label="Open menu">&#9776;</button>
  <nav class="site-nav" data-nav>
    <a href="index.html" class="active">Home</a>
    <a href="#music">Music</a>
    <a href="#shows">Shows</a>
    <a href="about.html">About</a>
    <a href="#contact">Contact</a>
  </nav>
</header>

<section class="hero">
  <p class="hero-kicker">Official site</p>
  <h1>[Your Stage Name]</h1>
  <p class="hero-tagline">[Your tagline — the sound, the city, the feeling. One line that sounds like you.]</p>
  <div class="hero-actions">
    <a class="btn btn-gold" href="#music">Listen now</a>
    <a class="btn btn-ghost" href="#shows">See live dates</a>
  </div>
</section>

<section id="music" class="section">
  <h2>Latest release</h2>
  <div class="release-card">
    <div class="release-art" aria-hidden="true">&#9836;</div>
    <div class="release-body">
      <p class="release-type">[Single / EP / Album]</p>
      <h3>[Your latest release title]</h3>
      <p>[One or two lines about this release — what it is, who produced it, why it matters to you.]</p>
      <p class="release-links">
        <a href="#contact">[Streaming link]</a> &middot;
        <a href="#contact">[Video link]</a> &middot;
        <a href="#contact">[Buy / download link]</a>
      </p>
      <p class="hint">Replace the bracketed links with your real streaming, video, and store links.</p>
    </div>
  </div>
  <div class="track-grid">
    <article class="track-card">
      <h4>[Track title]</h4>
      <p>[Album or project name] &middot; [Year]</p>
    </article>
    <article class="track-card">
      <h4>[Track title]</h4>
      <p>[Album or project name] &middot; [Year]</p>
    </article>
    <article class="track-card">
      <h4>[Track title]</h4>
      <p>[Album or project name] &middot; [Year]</p>
    </article>
  </div>
</section>

<section id="shows" class="section section-alt">
  <h2>Upcoming shows</h2>
  <ul class="show-list">
    <li>
      <span class="show-date">[Date TBA]</span>
      <span class="show-venue">[Venue name] — [City]</span>
      <a class="btn btn-small" href="#contact">Tickets</a>
    </li>
    <li>
      <span class="show-date">[Date TBA]</span>
      <span class="show-venue">[Venue name] — [City]</span>
      <a class="btn btn-small" href="#contact">Tickets</a>
    </li>
    <li>
      <span class="show-date">[Date TBA]</span>
      <span class="show-venue">[Venue name] — [City]</span>
      <a class="btn btn-small" href="#contact">Tickets</a>
    </li>
  </ul>
  <p class="hint">Swap in your real dates and ticket links — or ask the builder to do it: &ldquo;add my fall tour dates.&rdquo;</p>
</section>

<section class="section">
  <h2>Join the mailing list</h2>
  <p>New music, presale codes, and shows in your city — first, before anywhere else. No spam, ever.</p>
  <!-- Contact/mailing forms post to a placeholder endpoint. See README.md for wiring Formspree/Getform free tier, or your Bow Down Visuals email list. -->
  <form class="signup-form" data-contact-form action="#contact-form" method="post">
    <label class="sr-only" for="ml-email">Email address</label>
    <input id="ml-email" type="email" name="email" placeholder="you@email.com" required>
    <button class="btn btn-gold" type="submit">Join the list</button>
  </form>
  <p class="form-note" data-form-note hidden>Thanks — you are on the list. (Demo form: wire it up per the README to start collecting real signups.)</p>
</section>

<section id="contact" class="section section-alt">
  <h2>Booking &amp; contact</h2>
  <p>Booking, features, press, and everything else: <a href="mailto:[your@email.com]">[your@email.com]</a></p>
  <p class="social-row">
    <a href="#contact">[Instagram]</a> &middot;
    <a href="#contact">[TikTok]</a> &middot;
    <a href="#contact">[YouTube]</a> &middot;
    <a href="#contact">[X]</a>
  </p>
</section>

<footer class="site-footer">
  <p>&copy; <span data-year>2026</span> [Your Stage Name]. Built with Bow Down Visuals AI Website Builder.</p>
</footer>
<script src="script.js"></script>
</body>
</html>
`;

const ARTIST_ABOUT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>About — [Your Stage Name]</title>
<meta name="description" content="About [Your Stage Name]: the story, the sound, and where to hear more.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="index.html">[Your Stage Name]</a>
  <button class="nav-toggle" data-nav-toggle aria-label="Open menu">&#9776;</button>
  <nav class="site-nav" data-nav>
    <a href="index.html">Home</a>
    <a href="index.html#music">Music</a>
    <a href="index.html#shows">Shows</a>
    <a href="about.html" class="active">About</a>
    <a href="index.html#contact">Contact</a>
  </nav>
</header>

<section class="section page-head">
  <p class="hero-kicker">About</p>
  <h1>The story so far</h1>
</section>

<section class="section prose">
  <p>[Your bio, paragraph one — where you are from and how the music started. Write it like you talk; two or three honest sentences beat a page of hype.]</p>
  <p>[Paragraph two — the sound. Who influenced you, what you are chasing in the studio, what a listener hears first.]</p>
  <p>[Paragraph three — the road so far and what is next: releases, shows, collaborations. Link back to the homepage for the latest.]</p>
  <blockquote class="press-quote">
    <p>&ldquo;[A real press or fan quote about your music]&rdquo;</p>
    <cite>— [Publication or person]</cite>
  </blockquote>
  <p><a class="btn btn-gold" href="index.html#music">Hear the music</a></p>
</section>

<footer class="site-footer">
  <p>&copy; <span data-year>2026</span> [Your Stage Name]. Built with Bow Down Visuals AI Website Builder.</p>
</footer>
<script src="script.js"></script>
</body>
</html>
`;

const ARTIST_CSS = `:root {
  --bg: #0b0a08;
  --surface: #161310;
  --gold: #d4af37;
  --gold-soft: #b8963e;
  --text: #f5efe2;
  --muted: #a89e8a;
  --border: #2a251c;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: Georgia, "Times New Roman", serif; line-height: 1.6; }
a { color: var(--gold); text-decoration: none; }
a:hover { text-decoration: underline; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.site-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 28px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(11,10,8,.92); z-index: 10; }
.brand { font-size: 1.25rem; font-weight: bold; letter-spacing: .04em; color: var(--text); }
.nav-toggle { display: none; background: none; border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 6px 10px; font-size: 1rem; cursor: pointer; }
.site-nav a { margin-left: 22px; color: var(--muted); font-family: Arial, sans-serif; font-size: .95rem; }
.site-nav a.active, .site-nav a:hover { color: var(--gold); text-decoration: none; }
.hero { text-align: center; padding: 110px 24px 90px; background: radial-gradient(ellipse at 50% 0%, #241c0d 0%, var(--bg) 65%); }
.hero-kicker { text-transform: uppercase; letter-spacing: .35em; font-size: .75rem; color: var(--gold); font-family: Arial, sans-serif; margin-bottom: 18px; }
.hero h1 { font-size: clamp(2.6rem, 7vw, 4.6rem); line-height: 1.05; margin-bottom: 18px; }
.hero-tagline { max-width: 640px; margin: 0 auto 34px; color: var(--muted); font-size: 1.15rem; }
.hero-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.btn { display: inline-block; padding: 13px 28px; border-radius: 999px; font-family: Arial, sans-serif; font-weight: bold; font-size: .95rem; border: 1px solid var(--gold); }
.btn:hover { text-decoration: none; filter: brightness(1.1); }
.btn-gold { background: var(--gold); color: #171307; }
.btn-ghost { color: var(--gold); background: transparent; }
.btn-small { padding: 8px 18px; font-size: .85rem; }
.section { max-width: 980px; margin: 0 auto; padding: 72px 24px; }
.section-alt { background: var(--surface); border-radius: 24px; margin-top: 24px; margin-bottom: 24px; }
.section h2 { font-size: 2rem; margin-bottom: 26px; }
.page-head { padding-bottom: 0; }
.release-card { display: flex; gap: 28px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 28px; margin-bottom: 26px; }
.release-art { flex: 0 0 150px; height: 150px; border-radius: 14px; background: linear-gradient(135deg, #3a2f14, #171307); display: flex; align-items: center; justify-content: center; font-size: 3rem; color: var(--gold); }
.release-type { text-transform: uppercase; letter-spacing: .2em; font-size: .72rem; color: var(--gold); font-family: Arial, sans-serif; }
.release-body h3 { font-size: 1.6rem; margin: 6px 0 10px; }
.release-links { margin-top: 14px; font-family: Arial, sans-serif; font-size: .95rem; }
.hint { color: var(--muted); font-size: .85rem; font-style: italic; margin-top: 10px; }
.track-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.track-card { border: 1px solid var(--border); border-radius: 14px; padding: 20px; background: #100e0a; }
.track-card h4 { margin-bottom: 6px; }
.track-card p { color: var(--muted); font-size: .9rem; }
.show-list { list-style: none; }
.show-list li { display: flex; align-items: center; gap: 18px; padding: 16px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.show-date { font-family: Arial, sans-serif; font-weight: bold; color: var(--gold); min-width: 110px; }
.show-venue { flex: 1; }
.signup-form { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
.signup-form input { flex: 1; min-width: 240px; padding: 13px 18px; border-radius: 999px; border: 1px solid var(--border); background: #100e0a; color: var(--text); font-size: 1rem; }
.form-note { margin-top: 14px; color: var(--gold); }
.social-row { margin-top: 12px; font-family: Arial, sans-serif; }
.prose p { margin-bottom: 18px; max-width: 720px; }
.press-quote { border-left: 3px solid var(--gold); padding: 6px 0 6px 22px; margin: 30px 0; font-size: 1.2rem; }
.press-quote cite { color: var(--muted); font-size: .95rem; }
.site-footer { text-align: center; padding: 34px 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: .9rem; margin-top: 40px; }
@media (max-width: 720px) {
  .nav-toggle { display: block; }
  .site-nav { display: none; position: absolute; top: 64px; right: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 20px; flex-direction: column; gap: 12px; }
  .site-nav.open { display: flex; }
  .site-nav a { margin-left: 0; }
  .release-card { flex-direction: column; }
  .hero { padding: 70px 20px 60px; }
}
`;

const ARTIST_JS = `// Artist Site — mobile nav, smooth scroll, footer year, demo form note.
(function () {
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.querySelector("[data-nav]");
  if (toggle && nav) {
    toggle.addEventListener("click", function () { nav.classList.toggle("open"); });
  }
  var links = document.querySelectorAll('a[href^="#"]');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener("click", function (e) {
      var id = this.getAttribute("href");
      if (id && id.length > 1) {
        var el = document.querySelector(id);
        if (el) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth" }); }
      }
    });
  }
  var year = document.querySelector("[data-year]");
  if (year) { year.textContent = new Date().getFullYear(); }
  var forms = document.querySelectorAll("[data-contact-form]");
  for (var j = 0; j < forms.length; j++) {
    forms[j].addEventListener("submit", function (e) {
      e.preventDefault();
      var note = document.querySelector("[data-form-note]");
      if (note) { note.hidden = false; }
    });
  }
})();
`;

const ARTIST_README = `# [Your Stage Name] — Artist Site (template)

A complete starter website for a musician, built from the Bow Down
Visuals "Artist Site" template. You own these files outright — host them
anywhere.

## Files
- index.html — homepage: hero, latest release, shows, mailing list, contact
- about.html — bio page with a press-quote block
- styles.css — all styling (dark, gold-accented, responsive)
- script.js — mobile menu, smooth scrolling, footer year, demo form note
- README.md — this file

## Make it yours
Every fact about you is a bracketed placeholder — search the HTML files
for "[" and replace each one: your stage name, tagline, release titles,
show dates, social handles, and email. Section wording and layout are
finished copy you can keep as-is.

## Deploy (pick one)
1. Netlify Drop: go to app.netlify.com/drop and drag this whole folder in.
2. Vercel: run "vercel" in this folder, or drag it into a new project.
3. Cloudflare Pages: create a project and upload this folder as assets.
4. cPanel: upload every file into your domain's public_html folder.

## Wire the mailing-list / contact form
The form posts to a placeholder on purpose — a static site has no inbox
of its own. Free options: create a form at Formspree or Getform and
change the form's action to the endpoint they give you — or point fans to
your Bow Down Visuals email list and paste that signup link instead.

## What you own / what we don't do
You own the files, the design, and the content. Bow Down Visuals does
not host, publish, or monitor this site — it lives on your hosting,
under your domain.
`;

/* ═══ Template 2 — Podcast Home (podcast) ═══════════════════════════════ */

const PODCAST_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>[Your Podcast Name] — [Your Show's Hook in One Line]</title>
<meta name="description" content="[Your Podcast Name]: [what the show is about, who it is for, and how often new episodes land]. Listen and subscribe.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="index.html">[Your Podcast Name]</a>
  <button class="nav-toggle" data-nav-toggle aria-label="Open menu">&#9776;</button>
  <nav class="site-nav" data-nav>
    <a href="index.html" class="active">Home</a>
    <a href="#episodes">Episodes</a>
    <a href="about.html">About the show</a>
    <a href="#subscribe">Subscribe</a>
    <a href="#contact">Be a guest</a>
  </nav>
</header>

<section class="hero">
  <p class="hero-kicker">A podcast by [Your Name]</p>
  <h1>[Your Podcast Name]</h1>
  <p class="hero-tagline">[The show's promise in one line — the conversation, the topic, the feeling a listener gets every episode.]</p>
  <p class="hero-meta">New episodes [your release rhythm, e.g. every Tuesday] &middot; [Episode count so far] episodes and counting</p>
  <div class="hero-actions">
    <a class="btn btn-gold" href="#episodes">Play the latest episode</a>
    <a class="btn btn-ghost" href="#subscribe">Subscribe free</a>
  </div>
</section>

<section id="episodes" class="section">
  <h2>Latest episodes</h2>
  <article class="episode" data-episode>
    <button class="play-btn" data-play aria-label="Play episode">&#9654;</button>
    <div class="episode-body">
      <p class="episode-meta">Episode [number] &middot; [Date] &middot; [Length, e.g. 42 min]</p>
      <h3>[Latest episode title]</h3>
      <p>[Two lines on this episode: the guest, the topic, the one moment listeners will talk about.]</p>
    </div>
  </article>
  <article class="episode" data-episode>
    <button class="play-btn" data-play aria-label="Play episode">&#9654;</button>
    <div class="episode-body">
      <p class="episode-meta">Episode [number] &middot; [Date] &middot; [Length]</p>
      <h3>[Episode title]</h3>
      <p>[Two lines on this episode — guest, topic, takeaway.]</p>
    </div>
  </article>
  <article class="episode" data-episode>
    <button class="play-btn" data-play aria-label="Play episode">&#9654;</button>
    <div class="episode-body">
      <p class="episode-meta">Episode [number] &middot; [Date] &middot; [Length]</p>
      <h3>[Episode title]</h3>
      <p>[Two lines on this episode — guest, topic, takeaway.]</p>
    </div>
  </article>
  <p class="hint">Starter layout: swap in your real episode titles and point each play button at your episode player or listening link. The buttons above toggle a &ldquo;now playing&rdquo; state so you can see the interaction work.</p>
</section>

<section id="subscribe" class="section section-alt">
  <h2>Never miss an episode</h2>
  <p>Subscribe wherever you listen — and join the email list for episode extras, guest announcements, and live-show news.</p>
  <p class="platform-row">
    <a class="btn btn-ghost" href="#subscribe">[Apple Podcasts]</a>
    <a class="btn btn-ghost" href="#subscribe">[Spotify]</a>
    <a class="btn btn-ghost" href="#subscribe">[YouTube]</a>
    <a class="btn btn-ghost" href="#subscribe">[RSS feed]</a>
  </p>
  <!-- Forms post to a placeholder endpoint. See README.md for wiring Formspree/Getform free tier, or your Bow Down Visuals email list. -->
  <form class="signup-form" data-contact-form action="#contact-form" method="post">
    <label class="sr-only" for="pod-email">Email address</label>
    <input id="pod-email" type="email" name="email" placeholder="you@email.com" required>
    <button class="btn btn-gold" type="submit">Get episode emails</button>
  </form>
  <p class="form-note" data-form-note hidden>You are in — episode emails coming your way. (Demo form: wire it up per the README to collect real signups.)</p>
</section>

<section id="contact" class="section">
  <h2>Be a guest / say hello</h2>
  <p>Guest pitches, sponsorships, and listener mail: <a href="mailto:[your@email.com]">[your@email.com]</a></p>
  <p>[One line on the guests you are looking for, so the right people pitch you.]</p>
</section>

<footer class="site-footer">
  <p>&copy; <span data-year>2026</span> [Your Podcast Name]. Built with Bow Down Visuals AI Website Builder.</p>
</footer>
<script src="script.js"></script>
</body>
</html>
`;

const PODCAST_ABOUT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>About the show — [Your Podcast Name]</title>
<meta name="description" content="About [Your Podcast Name] and your host, [Your Name].">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="index.html">[Your Podcast Name]</a>
  <button class="nav-toggle" data-nav-toggle aria-label="Open menu">&#9776;</button>
  <nav class="site-nav" data-nav>
    <a href="index.html">Home</a>
    <a href="index.html#episodes">Episodes</a>
    <a href="about.html" class="active">About the show</a>
    <a href="index.html#subscribe">Subscribe</a>
    <a href="index.html#contact">Be a guest</a>
  </nav>
</header>

<section class="section page-head">
  <p class="hero-kicker">About the show</p>
  <h1>Why this show exists</h1>
</section>

<section class="section prose">
  <p>[The origin story — the conversation you kept having, the gap you kept seeing, the day you decided to record it. Two or three honest sentences.]</p>
  <p>[What listeners get — the format: interviews, solo breakdowns, stories; the length; the rhythm; who it is for.]</p>
  <h2 class="prose-h">Meet your host</h2>
  <p>[Your host bio — who you are, why you are the right person to host this, and one human detail that makes people stay.]</p>
  <blockquote class="press-quote">
    <p>&ldquo;[A real listener review or press quote about the show]&rdquo;</p>
    <cite>— [Reviewer or publication]</cite>
  </blockquote>
  <p><a class="btn btn-gold" href="index.html#episodes">Start with the latest episode</a></p>
</section>

<footer class="site-footer">
  <p>&copy; <span data-year>2026</span> [Your Podcast Name]. Built with Bow Down Visuals AI Website Builder.</p>
</footer>
<script src="script.js"></script>
</body>
</html>
`;

const PODCAST_CSS = `:root {
  --bg: #0d0f16;
  --surface: #151926;
  --amber: #f2a33c;
  --amber-deep: #c47b1e;
  --text: #eef0f7;
  --muted: #9aa3b8;
  --border: #262c40;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: "Segoe UI", Arial, sans-serif; line-height: 1.6; }
a { color: var(--amber); text-decoration: none; }
a:hover { text-decoration: underline; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.site-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 28px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(13,15,22,.94); z-index: 10; }
.brand { font-size: 1.2rem; font-weight: 800; letter-spacing: .02em; color: var(--text); }
.nav-toggle { display: none; background: none; border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 6px 10px; font-size: 1rem; cursor: pointer; }
.site-nav a { margin-left: 22px; color: var(--muted); font-size: .95rem; }
.site-nav a.active, .site-nav a:hover { color: var(--amber); text-decoration: none; }
.hero { text-align: center; padding: 100px 24px 84px; background: radial-gradient(ellipse at 50% 0%, #2a1f0d 0%, var(--bg) 62%); }
.hero-kicker { text-transform: uppercase; letter-spacing: .3em; font-size: .74rem; color: var(--amber); margin-bottom: 16px; }
.hero h1 { font-size: clamp(2.4rem, 6.5vw, 4.2rem); line-height: 1.08; margin-bottom: 16px; }
.hero-tagline { max-width: 620px; margin: 0 auto 14px; color: var(--muted); font-size: 1.12rem; }
.hero-meta { color: var(--muted); font-size: .9rem; margin-bottom: 32px; }
.hero-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.btn { display: inline-block; padding: 12px 26px; border-radius: 12px; font-weight: 700; font-size: .95rem; border: 1px solid var(--amber); }
.btn:hover { text-decoration: none; filter: brightness(1.1); }
.btn-gold { background: var(--amber); color: #1c1206; }
.btn-ghost { color: var(--amber); background: transparent; }
.section { max-width: 920px; margin: 0 auto; padding: 68px 24px; }
.section-alt { background: var(--surface); border-radius: 24px; margin-top: 24px; margin-bottom: 24px; }
.section h2 { font-size: 1.9rem; margin-bottom: 24px; }
.page-head { padding-bottom: 0; }
.episode { display: flex; gap: 20px; align-items: flex-start; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 22px; margin-bottom: 16px; }
.episode.playing { border-color: var(--amber); box-shadow: 0 0 0 1px var(--amber); }
.play-btn { flex: 0 0 52px; width: 52px; height: 52px; border-radius: 50%; border: none; background: var(--amber); color: #1c1206; font-size: 1.1rem; cursor: pointer; }
.play-btn:hover { background: var(--amber-deep); }
.episode-meta { color: var(--amber); font-size: .8rem; text-transform: uppercase; letter-spacing: .12em; margin-bottom: 4px; }
.episode-body h3 { font-size: 1.25rem; margin-bottom: 6px; }
.episode-body p { color: var(--muted); }
.hint { color: var(--muted); font-size: .85rem; font-style: italic; margin-top: 8px; }
.platform-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0 8px; }
.signup-form { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
.signup-form input { flex: 1; min-width: 240px; padding: 12px 18px; border-radius: 12px; border: 1px solid var(--border); background: #0d0f16; color: var(--text); font-size: 1rem; }
.form-note { margin-top: 14px; color: var(--amber); }
.prose p { margin-bottom: 18px; max-width: 700px; }
.prose-h { margin: 26px 0 14px; font-size: 1.4rem; }
.press-quote { border-left: 3px solid var(--amber); padding: 6px 0 6px 22px; margin: 28px 0; font-size: 1.15rem; }
.press-quote cite { color: var(--muted); font-size: .92rem; }
.site-footer { text-align: center; padding: 32px 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: .9rem; margin-top: 36px; }
@media (max-width: 720px) {
  .nav-toggle { display: block; }
  .site-nav { display: none; position: absolute; top: 64px; right: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 20px; flex-direction: column; gap: 12px; }
  .site-nav.open { display: flex; }
  .site-nav a { margin-left: 0; }
  .hero { padding: 64px 20px 54px; }
}
`;

const PODCAST_JS = `// Podcast Home — mobile nav, smooth scroll, footer year, demo form note,
// and episode play toggles (starter interaction — point the buttons at
// your real player links when you wire the site up).
(function () {
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.querySelector("[data-nav]");
  if (toggle && nav) {
    toggle.addEventListener("click", function () { nav.classList.toggle("open"); });
  }
  var links = document.querySelectorAll('a[href^="#"]');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener("click", function (e) {
      var id = this.getAttribute("href");
      if (id && id.length > 1) {
        var el = document.querySelector(id);
        if (el) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth" }); }
      }
    });
  }
  var year = document.querySelector("[data-year]");
  if (year) { year.textContent = new Date().getFullYear(); }
  var forms = document.querySelectorAll("[data-contact-form]");
  for (var j = 0; j < forms.length; j++) {
    forms[j].addEventListener("submit", function (e) {
      e.preventDefault();
      var note = document.querySelector("[data-form-note]");
      if (note) { note.hidden = false; }
    });
  }
  var playButtons = document.querySelectorAll("[data-play]");
  for (var k = 0; k < playButtons.length; k++) {
    playButtons[k].addEventListener("click", function () {
      var card = this.closest("[data-episode]");
      var wasPlaying = card && card.classList.contains("playing");
      var cards = document.querySelectorAll("[data-episode]");
      for (var m = 0; m < cards.length; m++) { cards[m].classList.remove("playing"); }
      var btns = document.querySelectorAll("[data-play]");
      for (var n = 0; n < btns.length; n++) { btns[n].innerHTML = "&#9654;"; }
      if (card && !wasPlaying) {
        card.classList.add("playing");
        this.innerHTML = "&#10073;&#10073;";
      }
    });
  }
})();
`;

const PODCAST_README = `# [Your Podcast Name] — Podcast Home (template)

A complete starter website for a podcast, built from the Bow Down
Visuals "Podcast Home" template. You own these files outright — host
them anywhere.

## Files
- index.html — homepage: show hero, latest episodes, subscribe, guest contact
- about.html — the show's story + host bio, with a review-quote block
- styles.css — all styling (midnight + amber, responsive)
- script.js — mobile menu, smooth scrolling, footer year, episode
  play-toggle starter interaction, demo form note
- README.md — this file

## Make it yours
Every fact about your show is a bracketed placeholder — search the HTML
files for "[" and replace each one: show name, episode titles and dates,
platform links, and your email. The play buttons toggle a "now playing"
look so you can see the layout work; point them at your real episode
player or listening links when you publish.

## Deploy (pick one)
1. Netlify Drop: go to app.netlify.com/drop and drag this whole folder in.
2. Vercel: run "vercel" in this folder, or drag it into a new project.
3. Cloudflare Pages: create a project and upload this folder as assets.
4. cPanel: upload every file into your domain's public_html folder.

## Wire the email form
The form posts to a placeholder on purpose — a static site has no inbox
of its own. Free options: create a form at Formspree or Getform and
change the form's action to the endpoint they give you — or point
listeners to your Bow Down Visuals email list signup link instead.

## What you own / what we don't do
You own the files, the design, and the content. Bow Down Visuals does
not host, publish, or monitor this site — it lives on your hosting,
under your domain.
`;

/* ═══ Template 3 — Streamer Hub (gaming) ════════════════════════════════ */

const STREAMER_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>[Your Channel Name] — Streams, Schedule &amp; Clips</title>
<meta name="description" content="[Your Channel Name] streams [your games or content] live. Schedule, clips, community links, and business contact.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="index.html">[Your Channel Name]</a>
  <button class="nav-toggle" data-nav-toggle aria-label="Open menu">&#9776;</button>
  <nav class="site-nav" data-nav>
    <a href="index.html" class="active">Home</a>
    <a href="#schedule">Schedule</a>
    <a href="#clips">Clips</a>
    <a href="about.html">About &amp; setup</a>
    <a href="#contact">Business</a>
  </nav>
</header>

<section class="hero">
  <p class="live-badge"><span class="live-dot"></span> [Live status — e.g. &ldquo;Live weeknights&rdquo; or your next stream time]</p>
  <h1>[Your Channel Name]</h1>
  <p class="hero-tagline">[Your stream in one line — the games, the energy, the community vibe. What a first-time viewer gets in the first five minutes.]</p>
  <div class="hero-actions">
    <a class="btn btn-gold" href="#contact">[Watch live — your stream link]</a>
    <a class="btn btn-ghost" href="#schedule">See the schedule</a>
  </div>
  <p class="hero-meta">Streaming [your days, e.g. Mon / Wed / Fri] &middot; [Your timezone] &middot; [Main game or category]</p>
</section>

<section id="schedule" class="section">
  <h2>Stream schedule</h2>
  <div class="schedule-grid">
    <article class="day-card">
      <h3>[Day]</h3>
      <p class="day-time">[Start time] — [End time]</p>
      <p>[What happens this stream — game, series, community games]</p>
    </article>
    <article class="day-card">
      <h3>[Day]</h3>
      <p class="day-time">[Start time] — [End time]</p>
      <p>[What happens this stream]</p>
    </article>
    <article class="day-card">
      <h3>[Day]</h3>
      <p class="day-time">[Start time] — [End time]</p>
      <p>[What happens this stream]</p>
    </article>
    <article class="day-card day-off">
      <h3>[Day]</h3>
      <p class="day-time">Off</p>
      <p>[What you post instead — VODs, shorts, community night]</p>
    </article>
  </div>
  <p class="hint">Replace the bracketed days and times with your real schedule — consistency is what turns viewers into regulars.</p>
</section>

<section id="clips" class="section section-alt">
  <h2>Clips &amp; VODs</h2>
  <div class="clip-grid">
    <article class="clip-card">
      <div class="clip-thumb" aria-hidden="true">&#9654;</div>
      <h4>[Clip or VOD title]</h4>
      <p>[Game / stream date] &middot; [Length]</p>
      <a href="#clips">[Watch link]</a>
    </article>
    <article class="clip-card">
      <div class="clip-thumb" aria-hidden="true">&#9654;</div>
      <h4>[Clip or VOD title]</h4>
      <p>[Game / stream date] &middot; [Length]</p>
      <a href="#clips">[Watch link]</a>
    </article>
    <article class="clip-card">
      <div class="clip-thumb" aria-hidden="true">&#9654;</div>
      <h4>[Clip or VOD title]</h4>
      <p>[Game / stream date] &middot; [Length]</p>
      <a href="#clips">[Watch link]</a>
    </article>
  </div>
</section>

<section class="section">
  <h2>Join the community</h2>
  <p>Stream alerts, community game nights, and the conversations that happen between streams.</p>
  <p class="platform-row">
    <a class="btn btn-ghost" href="#contact">[Discord]</a>
    <a class="btn btn-ghost" href="#contact">[YouTube]</a>
    <a class="btn btn-ghost" href="#contact">[TikTok]</a>
    <a class="btn btn-ghost" href="#contact">[X]</a>
  </p>
  <!-- Forms post to a placeholder endpoint. See README.md for wiring Formspree/Getform free tier, or your Bow Down Visuals email list. -->
  <form class="signup-form" data-contact-form action="#contact-form" method="post">
    <label class="sr-only" for="st-email">Email address</label>
    <input id="st-email" type="email" name="email" placeholder="you@email.com" required>
    <button class="btn btn-gold" type="submit">Get stream alerts</button>
  </form>
  <p class="form-note" data-form-note hidden>You are on the alert list. See you in chat. (Demo form: wire it up per the README to collect real signups.)</p>
</section>

<section id="contact" class="section section-alt">
  <h2>Business &amp; sponsorships</h2>
  <p>Brand deals, sponsored streams, and collabs: <a href="mailto:[your@email.com]">[your@email.com]</a></p>
  <p>[One line on your audience and the partnerships you say yes to.]</p>
</section>

<footer class="site-footer">
  <p>&copy; <span data-year>2026</span> [Your Channel Name]. Built with Bow Down Visuals AI Website Builder.</p>
</footer>
<script src="script.js"></script>
</body>
</html>
`;

const STREAMER_ABOUT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>About &amp; setup — [Your Channel Name]</title>
<meta name="description" content="About [Your Channel Name]: the streamer, the community, and the setup behind the stream.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="index.html">[Your Channel Name]</a>
  <button class="nav-toggle" data-nav-toggle aria-label="Open menu">&#9776;</button>
  <nav class="site-nav" data-nav>
    <a href="index.html">Home</a>
    <a href="index.html#schedule">Schedule</a>
    <a href="index.html#clips">Clips</a>
    <a href="about.html" class="active">About &amp; setup</a>
    <a href="index.html#contact">Business</a>
  </nav>
</header>

<section class="section page-head">
  <p class="hero-kicker">About</p>
  <h1>The person behind the screen</h1>
</section>

<section class="section prose">
  <p>[Your story — how you got into streaming, the first game that hooked you, the moment the channel became a community.]</p>
  <p>[What your streams are like — competitive, cozy, chaos, educational — and who feels at home in your chat.]</p>
  <h2 class="prose-h">The setup</h2>
  <ul class="setup-list">
    <li><strong>PC / console:</strong> [Your rig or console]</li>
    <li><strong>Microphone:</strong> [Your mic]</li>
    <li><strong>Camera:</strong> [Your camera]</li>
    <li><strong>Main games:</strong> [Your rotation]</li>
  </ul>
  <p class="hint">Viewers love a real setup list — swap in your actual gear (affiliate links welcome, this page is yours).</p>
  <p><a class="btn btn-gold" href="index.html#schedule">Catch the next stream</a></p>
</section>

<footer class="site-footer">
  <p>&copy; <span data-year>2026</span> [Your Channel Name]. Built with Bow Down Visuals AI Website Builder.</p>
</footer>
<script src="script.js"></script>
</body>
</html>
`;

const STREAMER_CSS = `:root {
  --bg: #08080f;
  --surface: #10101d;
  --violet: #8b5cf6;
  --cyan: #22d3ee;
  --text: #f2f2fa;
  --muted: #9d9db4;
  --border: #23233a;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: "Segoe UI", Arial, sans-serif; line-height: 1.6; }
a { color: var(--cyan); text-decoration: none; }
a:hover { text-decoration: underline; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.site-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 28px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(8,8,15,.94); z-index: 10; }
.brand { font-size: 1.2rem; font-weight: 800; letter-spacing: .03em; color: var(--text); }
.nav-toggle { display: none; background: none; border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 6px 10px; font-size: 1rem; cursor: pointer; }
.site-nav a { margin-left: 22px; color: var(--muted); font-size: .95rem; }
.site-nav a.active, .site-nav a:hover { color: var(--cyan); text-decoration: none; }
.hero { text-align: center; padding: 96px 24px 80px; background: radial-gradient(ellipse at 50% 0%, #221344 0%, var(--bg) 62%); }
.live-badge { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 999px; padding: 6px 16px; font-size: .82rem; color: var(--muted); margin-bottom: 22px; background: var(--surface); }
.live-dot { width: 9px; height: 9px; border-radius: 50%; background: #f43f5e; box-shadow: 0 0 0 0 rgba(244,63,94,.6); animation: pulse 1.8s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(244,63,94,.55); } 70% { box-shadow: 0 0 0 9px rgba(244,63,94,0); } 100% { box-shadow: 0 0 0 0 rgba(244,63,94,0); } }
.hero h1 { font-size: clamp(2.4rem, 6.5vw, 4.2rem); line-height: 1.08; margin-bottom: 16px; }
.hero-tagline { max-width: 620px; margin: 0 auto 30px; color: var(--muted); font-size: 1.12rem; }
.hero-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.hero-meta { color: var(--muted); font-size: .9rem; margin-top: 26px; }
.btn { display: inline-block; padding: 12px 26px; border-radius: 12px; font-weight: 700; font-size: .95rem; border: 1px solid var(--violet); }
.btn:hover { text-decoration: none; filter: brightness(1.12); }
.btn-gold { background: linear-gradient(90deg, var(--violet), #6d28d9); color: #ffffff; }
.btn-ghost { color: var(--cyan); border-color: var(--cyan); background: transparent; }
.section { max-width: 980px; margin: 0 auto; padding: 68px 24px; }
.section-alt { background: var(--surface); border-radius: 24px; margin-top: 24px; margin-bottom: 24px; }
.section h2 { font-size: 1.9rem; margin-bottom: 24px; }
.page-head { padding-bottom: 0; }
.schedule-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.day-card { border: 1px solid var(--border); border-radius: 16px; padding: 20px; background: var(--surface); }
.day-card h3 { margin-bottom: 4px; }
.day-time { color: var(--cyan); font-weight: 700; font-size: .92rem; margin-bottom: 8px; }
.day-card p { color: var(--muted); font-size: .94rem; }
.day-off { opacity: .65; }
.hint { color: var(--muted); font-size: .85rem; font-style: italic; margin-top: 14px; }
.clip-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
.clip-card { border: 1px solid var(--border); border-radius: 16px; padding: 18px; background: #0c0c18; }
.clip-thumb { height: 110px; border-radius: 10px; background: linear-gradient(135deg, #2c1a56, #0e2a3a); display: flex; align-items: center; justify-content: center; font-size: 1.8rem; color: #ffffff; margin-bottom: 14px; }
.clip-card h4 { margin-bottom: 4px; }
.clip-card p { color: var(--muted); font-size: .88rem; margin-bottom: 8px; }
.platform-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0 8px; }
.signup-form { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
.signup-form input { flex: 1; min-width: 240px; padding: 12px 18px; border-radius: 12px; border: 1px solid var(--border); background: #0c0c18; color: var(--text); font-size: 1rem; }
.form-note { margin-top: 14px; color: var(--cyan); }
.prose p { margin-bottom: 18px; max-width: 700px; }
.prose-h { margin: 26px 0 14px; font-size: 1.4rem; }
.setup-list { list-style: none; max-width: 700px; }
.setup-list li { padding: 10px 0; border-bottom: 1px solid var(--border); color: var(--muted); }
.setup-list strong { color: var(--text); }
.site-footer { text-align: center; padding: 32px 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: .9rem; margin-top: 36px; }
@media (max-width: 720px) {
  .nav-toggle { display: block; }
  .site-nav { display: none; position: absolute; top: 64px; right: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 20px; flex-direction: column; gap: 12px; }
  .site-nav.open { display: flex; }
  .site-nav a { margin-left: 0; }
  .hero { padding: 62px 20px 52px; }
}
`;

const STREAMER_JS = `// Streamer Hub — mobile nav, smooth scroll, footer year, demo form note.
(function () {
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.querySelector("[data-nav]");
  if (toggle && nav) {
    toggle.addEventListener("click", function () { nav.classList.toggle("open"); });
  }
  var links = document.querySelectorAll('a[href^="#"]');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener("click", function (e) {
      var id = this.getAttribute("href");
      if (id && id.length > 1) {
        var el = document.querySelector(id);
        if (el) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth" }); }
      }
    });
  }
  var year = document.querySelector("[data-year]");
  if (year) { year.textContent = new Date().getFullYear(); }
  var forms = document.querySelectorAll("[data-contact-form]");
  for (var j = 0; j < forms.length; j++) {
    forms[j].addEventListener("submit", function (e) {
      e.preventDefault();
      var note = document.querySelector("[data-form-note]");
      if (note) { note.hidden = false; }
    });
  }
})();
`;

const STREAMER_README = `# [Your Channel Name] — Streamer Hub (template)

A complete starter website for a streamer, built from the Bow Down
Visuals "Streamer Hub" template. You own these files outright — host
them anywhere.

## Files
- index.html — homepage: live-status hero, schedule, clips & VODs,
  community links, stream-alert signup, business contact
- about.html — your story + a "setup" list viewers always ask about
- styles.css — all styling (near-black, violet/cyan, responsive)
- script.js — mobile menu, smooth scrolling, footer year, demo form note
- README.md — this file

## Make it yours
Every fact about your channel is a bracketed placeholder — search the
HTML files for "[" and replace each one: channel name, schedule, clip
titles, gear list, platform links, and your business email. The live
badge in the hero is a status line you edit by hand — say when you are
live or when the next stream starts.

## Deploy (pick one)
1. Netlify Drop: go to app.netlify.com/drop and drag this whole folder in.
2. Vercel: run "vercel" in this folder, or drag it into a new project.
3. Cloudflare Pages: create a project and upload this folder as assets.
4. cPanel: upload every file into your domain's public_html folder.

## Wire the alert form
The form posts to a placeholder on purpose — a static site has no inbox
of its own. Free options: create a form at Formspree or Getform and
change the form's action to the endpoint they give you — or point fans
to your Bow Down Visuals email list signup link instead.

## What you own / what we don't do
You own the files, the design, and the content. Bow Down Visuals does
not host, publish, or monitor this site — it lives on your hosting,
under your domain.
`;

/* ═══ Template 4 — Showreel Portfolio (video) ═══════════════════════════ */

const SHOWREEL_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>[Your Name] — [Video Creator / Visual Artist] Portfolio</title>
<meta name="description" content="Portfolio of [Your Name]: [your specialty in one line — music videos, brand films, visual art]. Selected work, services, and booking.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="index.html">[Your Name]</a>
  <button class="nav-toggle" data-nav-toggle aria-label="Open menu">&#9776;</button>
  <nav class="site-nav" data-nav>
    <a href="index.html" class="active">Work</a>
    <a href="#services">Services</a>
    <a href="about.html">About</a>
    <a href="#contact">Book me</a>
  </nav>
</header>

<section class="hero">
  <p class="hero-kicker">[Your specialty — e.g. Music videos &amp; brand films]</p>
  <h1>[Your Name]</h1>
  <p class="hero-tagline">[Your visual signature in one line — the look, the feeling, the work you are hired for.]</p>
  <div class="reel-frame">
    <div class="reel-thumb" aria-hidden="true">&#9654;</div>
    <p class="reel-caption">[Your showreel — replace this block with your embedded reel video]</p>
  </div>
  <div class="hero-actions">
    <a class="btn btn-gold" href="#work">See selected work</a>
    <a class="btn btn-ghost" href="#contact">Book a project</a>
  </div>
</section>

<section id="work" class="section">
  <h2>Selected work</h2>
  <div class="filter-row" role="group" aria-label="Filter work by type">
    <button class="filter-btn active" data-filter="all">All</button>
    <button class="filter-btn" data-filter="video">Video</button>
    <button class="filter-btn" data-filter="photo">Photo / Art</button>
    <button class="filter-btn" data-filter="brand">Brand</button>
  </div>
  <div class="work-grid">
    <article class="work-card" data-kind="video">
      <div class="work-thumb" aria-hidden="true">&#9654;</div>
      <h4>[Project title]</h4>
      <p>[Client or artist] &middot; [Year] &middot; [Your role]</p>
    </article>
    <article class="work-card" data-kind="brand">
      <div class="work-thumb" aria-hidden="true">&#9654;</div>
      <h4>[Project title]</h4>
      <p>[Client or brand] &middot; [Year] &middot; [Your role]</p>
    </article>
    <article class="work-card" data-kind="photo">
      <div class="work-thumb" aria-hidden="true">&#10038;</div>
      <h4>[Series or piece title]</h4>
      <p>[Medium] &middot; [Year]</p>
    </article>
    <article class="work-card" data-kind="video">
      <div class="work-thumb" aria-hidden="true">&#9654;</div>
      <h4>[Project title]</h4>
      <p>[Client or artist] &middot; [Year] &middot; [Your role]</p>
    </article>
  </div>
  <p class="hint">The filter buttons work right now — try them. Replace the thumbs and titles with your real projects and links.</p>
</section>

<section id="services" class="section section-alt">
  <h2>Services</h2>
  <div class="service-grid">
    <article class="service-card">
      <h3>[Service — e.g. Music videos]</h3>
      <p>[What is included, who it is for, and how a project usually runs — concept to delivery.]</p>
      <p class="service-price">[Starting at / typical range — or &ldquo;ask for a quote&rdquo;]</p>
    </article>
    <article class="service-card">
      <h3>[Service — e.g. Brand films]</h3>
      <p>[What is included and who it is for.]</p>
      <p class="service-price">[Starting at / typical range — or &ldquo;ask for a quote&rdquo;]</p>
    </article>
    <article class="service-card">
      <h3>[Service — e.g. Photo &amp; cover art]</h3>
      <p>[What is included and who it is for.]</p>
      <p class="service-price">[Starting at / typical range — or &ldquo;ask for a quote&rdquo;]</p>
    </article>
  </div>
  <blockquote class="press-quote">
    <p>&ldquo;[A real client testimonial about working with you]&rdquo;</p>
    <cite>— [Client name, project]</cite>
  </blockquote>
</section>

<section id="contact" class="section">
  <h2>Book a project</h2>
  <p>Tell me about the project — what it is, when it needs to land, and the look you are after. Booking and inquiries: <a href="mailto:[your@email.com]">[your@email.com]</a></p>
  <!-- Forms post to a placeholder endpoint. See README.md for wiring Formspree/Getform free tier, or your Bow Down Visuals email list. -->
  <form class="signup-form" data-contact-form action="#contact-form" method="post">
    <label class="sr-only" for="sr-name">Your name</label>
    <input id="sr-name" type="text" name="name" placeholder="Your name" required>
    <label class="sr-only" for="sr-email">Email address</label>
    <input id="sr-email" type="email" name="email" placeholder="you@email.com" required>
    <button class="btn btn-gold" type="submit">Send inquiry</button>
  </form>
  <p class="form-note" data-form-note hidden>Thanks — your inquiry is noted. (Demo form: wire it up per the README to receive real inquiries.)</p>
</section>

<footer class="site-footer">
  <p>&copy; <span data-year>2026</span> [Your Name]. Built with Bow Down Visuals AI Website Builder.</p>
</footer>
<script src="script.js"></script>
</body>
</html>
`;

const SHOWREEL_ABOUT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>About — [Your Name]</title>
<meta name="description" content="About [Your Name]: background, approach, and the work behind the portfolio.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="index.html">[Your Name]</a>
  <button class="nav-toggle" data-nav-toggle aria-label="Open menu">&#9776;</button>
  <nav class="site-nav" data-nav>
    <a href="index.html">Work</a>
    <a href="index.html#services">Services</a>
    <a href="about.html" class="active">About</a>
    <a href="index.html#contact">Book me</a>
  </nav>
</header>

<section class="section page-head">
  <p class="hero-kicker">About</p>
  <h1>Eye first, ego last</h1>
</section>

<section class="section prose">
  <p>[Your background — how you picked up a camera, the work that shaped your eye, the city or scene you come from.]</p>
  <p>[Your approach — how a project runs with you: the conversation first, the treatment, the shoot, the edit. Clients book the process as much as the pictures.]</p>
  <p>[Selected credits or collaborations — real names and projects, or remove this paragraph until you have them.]</p>
  <p><a class="btn btn-gold" href="index.html#contact">Start a project</a></p>
</section>

<footer class="site-footer">
  <p>&copy; <span data-year>2026</span> [Your Name]. Built with Bow Down Visuals AI Website Builder.</p>
</footer>
<script src="script.js"></script>
</body>
</html>
`;

const SHOWREEL_CSS = `:root {
  --bg: #111110;
  --surface: #1b1b19;
  --ivory: #f3efe6;
  --gold: #c9a84c;
  --muted: #a3a099;
  --border: #2c2c28;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--ivory); font-family: "Helvetica Neue", Arial, sans-serif; line-height: 1.6; }
a { color: var(--gold); text-decoration: none; }
a:hover { text-decoration: underline; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.site-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 30px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(17,17,16,.94); z-index: 10; }
.brand { font-size: 1.15rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ivory); }
.nav-toggle { display: none; background: none; border: 1px solid var(--border); color: var(--ivory); border-radius: 8px; padding: 6px 10px; font-size: 1rem; cursor: pointer; }
.site-nav a { margin-left: 24px; color: var(--muted); font-size: .92rem; letter-spacing: .06em; text-transform: uppercase; }
.site-nav a.active, .site-nav a:hover { color: var(--gold); text-decoration: none; }
.hero { text-align: center; padding: 92px 24px 76px; }
.hero-kicker { text-transform: uppercase; letter-spacing: .34em; font-size: .74rem; color: var(--gold); margin-bottom: 18px; }
.hero h1 { font-size: clamp(2.6rem, 7vw, 4.8rem); line-height: 1.04; font-weight: 800; margin-bottom: 16px; }
.hero-tagline { max-width: 600px; margin: 0 auto 36px; color: var(--muted); font-size: 1.1rem; }
.reel-frame { max-width: 760px; margin: 0 auto 36px; border: 1px solid var(--border); border-radius: 18px; overflow: hidden; background: var(--surface); }
.reel-thumb { height: 300px; display: flex; align-items: center; justify-content: center; font-size: 3.4rem; color: var(--ivory); background: linear-gradient(150deg, #2e2c26, #141412); }
.reel-caption { padding: 14px 18px; color: var(--muted); font-size: .9rem; }
.hero-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.btn { display: inline-block; padding: 13px 28px; border-radius: 999px; font-weight: 700; font-size: .93rem; border: 1px solid var(--gold); }
.btn:hover { text-decoration: none; filter: brightness(1.1); }
.btn-gold { background: var(--gold); color: #17150e; }
.btn-ghost { color: var(--gold); background: transparent; }
.section { max-width: 1020px; margin: 0 auto; padding: 68px 24px; }
.section-alt { background: var(--surface); border-radius: 24px; margin-top: 24px; margin-bottom: 24px; }
.section h2 { font-size: 1.9rem; margin-bottom: 22px; }
.page-head { padding-bottom: 0; }
.filter-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 22px; }
.filter-btn { padding: 8px 20px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: .9rem; cursor: pointer; }
.filter-btn.active { border-color: var(--gold); color: var(--gold); }
.work-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 18px; }
.work-card { border: 1px solid var(--border); border-radius: 16px; padding: 16px; background: #151514; }
.work-card.hidden { display: none; }
.work-thumb { height: 140px; border-radius: 10px; background: linear-gradient(140deg, #33302a, #171714); display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--ivory); margin-bottom: 14px; }
.work-card h4 { margin-bottom: 4px; }
.work-card p { color: var(--muted); font-size: .88rem; }
.hint { color: var(--muted); font-size: .85rem; font-style: italic; margin-top: 14px; }
.service-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.service-card { border: 1px solid var(--border); border-radius: 16px; padding: 22px; background: #141413; }
.service-card h3 { margin-bottom: 8px; }
.service-card p { color: var(--muted); font-size: .95rem; }
.service-price { color: var(--gold); font-weight: 700; margin-top: 12px; }
.press-quote { border-left: 3px solid var(--gold); padding: 6px 0 6px 22px; margin: 30px 0 6px; font-size: 1.15rem; }
.press-quote cite { color: var(--muted); font-size: .92rem; }
.signup-form { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
.signup-form input { flex: 1; min-width: 200px; padding: 12px 18px; border-radius: 999px; border: 1px solid var(--border); background: #151514; color: var(--ivory); font-size: 1rem; }
.form-note { margin-top: 14px; color: var(--gold); }
.prose p { margin-bottom: 18px; max-width: 700px; }
.site-footer { text-align: center; padding: 32px 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: .9rem; margin-top: 36px; }
@media (max-width: 720px) {
  .nav-toggle { display: block; }
  .site-nav { display: none; position: absolute; top: 66px; right: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 20px; flex-direction: column; gap: 12px; }
  .site-nav.open { display: flex; }
  .site-nav a { margin-left: 0; }
  .hero { padding: 60px 20px 50px; }
  .reel-thumb { height: 200px; }
}
`;

const SHOWREEL_JS = `// Showreel Portfolio — mobile nav, smooth scroll, footer year, demo form
// note, and a working work-grid filter.
(function () {
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.querySelector("[data-nav]");
  if (toggle && nav) {
    toggle.addEventListener("click", function () { nav.classList.toggle("open"); });
  }
  var links = document.querySelectorAll('a[href^="#"]');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener("click", function (e) {
      var id = this.getAttribute("href");
      if (id && id.length > 1) {
        var el = document.querySelector(id);
        if (el) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth" }); }
      }
    });
  }
  var year = document.querySelector("[data-year]");
  if (year) { year.textContent = new Date().getFullYear(); }
  var forms = document.querySelectorAll("[data-contact-form]");
  for (var j = 0; j < forms.length; j++) {
    forms[j].addEventListener("submit", function (e) {
      e.preventDefault();
      var note = document.querySelector("[data-form-note]");
      if (note) { note.hidden = false; }
    });
  }
  var filterBtns = document.querySelectorAll("[data-filter]");
  for (var f = 0; f < filterBtns.length; f++) {
    filterBtns[f].addEventListener("click", function () {
      var kind = this.getAttribute("data-filter");
      for (var b = 0; b < filterBtns.length; b++) { filterBtns[b].classList.remove("active"); }
      this.classList.add("active");
      var cards = document.querySelectorAll("[data-kind]");
      for (var c = 0; c < cards.length; c++) {
        var show = kind === "all" || cards[c].getAttribute("data-kind") === kind;
        cards[c].classList.toggle("hidden", !show);
      }
    });
  }
})();
`;

const SHOWREEL_README = `# [Your Name] — Showreel Portfolio (template)

A complete starter portfolio for a video creator or visual artist,
built from the Bow Down Visuals "Showreel Portfolio" template. You own
these files outright — host them anywhere.

## Files
- index.html — showreel hero, filterable selected-work grid, services,
  testimonial, booking form
- about.html — background and approach
- styles.css — all styling (charcoal + ivory gallery look, responsive)
- script.js — mobile menu, smooth scrolling, footer year, the working
  work filter, demo form note
- README.md — this file

## Make it yours
Every fact about you is a bracketed placeholder — search the HTML files
for "[" and replace each one: your name, specialty, project titles and
clients, services, prices, testimonial, and email. Replace the reel
block in the hero with your embedded showreel video, and the work-card
thumbs with your real project images or embeds.

## Deploy (pick one)
1. Netlify Drop: go to app.netlify.com/drop and drag this whole folder in.
2. Vercel: run "vercel" in this folder, or drag it into a new project.
3. Cloudflare Pages: create a project and upload this folder as assets.
4. cPanel: upload every file into your domain's public_html folder.

## Wire the booking form
The form posts to a placeholder on purpose — a static site has no inbox
of its own. Free options: create a form at Formspree or Getform and
change the form's action to the endpoint they give you — or use your
Bow Down Visuals contact/booking links instead.

## What you own / what we don't do
You own the files, the design, and the content. Bow Down Visuals does
not host, publish, or monitor this site — it lives on your hosting,
under your domain.
`;

/* ═══ The gallery ═══════════════════════════════════════════════════════ */

export const WEBSITE_TEMPLATES: WebsiteTemplate[] = [
  {
    id: "artist-site",
    name: "Artist Site",
    vertical: "music",
    verticalLabel: "For musicians",
    bestFor: "Best for musicians who want one home for their music, shows, and mailing list.",
    description:
      "Full artist homepage: hero with name + tagline, latest release spotlight with more tracks, upcoming shows list, about page with press quote, mailing list signup, booking contact.",
    sections: ["Hero", "Latest release", "More tracks", "Upcoming shows", "Mailing list", "About", "Booking & contact"],
    brief: {
      description:
        "A complete artist site from the Artist Site template: hero with my name and tagline, my latest release up front, a shows list, an about page, and a mailing list signup. Placeholders mark everything I need to replace with my real details.",
      style: "Dark, premium, gold accents, big serif headlines",
      colorScheme: "Near-black with gold",
    },
    files: {
      "index.html": ARTIST_INDEX,
      "about.html": ARTIST_ABOUT,
      "styles.css": ARTIST_CSS,
      "script.js": ARTIST_JS,
      "README.md": ARTIST_README,
    },
  },
  {
    id: "podcast-home",
    name: "Podcast Home",
    vertical: "podcast",
    verticalLabel: "For podcasters",
    bestFor: "Best for podcasters who want episodes, subscribe links, and guest pitches in one place.",
    description:
      "Podcast homepage: show hero with release rhythm, latest episodes list with play toggles, subscribe row for every platform plus email list, about-the-show page with host bio, and a be-a-guest contact section.",
    sections: ["Show hero", "Latest episodes", "Subscribe", "About the show", "Host bio", "Be a guest"],
    brief: {
      description:
        "A complete podcast site from the Podcast Home template: show hero with my release rhythm, my latest episodes with play buttons, subscribe links for every platform, an email signup, an about page with my host bio, and a guest-pitch contact section. Placeholders mark everything I need to replace with my real details.",
      style: "Midnight tones, warm amber accents, clean sans-serif, episode cards",
      colorScheme: "Midnight blue-black with amber",
    },
    files: {
      "index.html": PODCAST_INDEX,
      "about.html": PODCAST_ABOUT,
      "styles.css": PODCAST_CSS,
      "script.js": PODCAST_JS,
      "README.md": PODCAST_README,
    },
  },
  {
    id: "streamer-hub",
    name: "Streamer Hub",
    vertical: "gaming",
    verticalLabel: "For streamers & gamers",
    bestFor: "Best for streamers who want their schedule, clips, and community links on one page.",
    description:
      "Streamer hub: hero with live-status badge and watch-live action, weekly stream schedule grid, clips & VOD cards, community links with stream-alert email signup, about page with a setup/gear list, and a business & sponsorships contact section.",
    sections: ["Live hero", "Stream schedule", "Clips & VODs", "Community", "About & setup", "Business contact"],
    brief: {
      description:
        "A complete streamer site from the Streamer Hub template: hero with a live-status badge and watch-live button, my weekly schedule, clips and VOD cards, community links, a stream-alert email signup, an about page with my setup list, and a business contact section. Placeholders mark everything I need to replace with my real details.",
      style: "Near-black, violet and cyan neon accents, bold rounded cards",
      colorScheme: "Near-black with violet and cyan",
    },
    files: {
      "index.html": STREAMER_INDEX,
      "about.html": STREAMER_ABOUT,
      "styles.css": STREAMER_CSS,
      "script.js": STREAMER_JS,
      "README.md": STREAMER_README,
    },
  },
  {
    id: "showreel-portfolio",
    name: "Showreel Portfolio",
    vertical: "video",
    verticalLabel: "For video creators & visual artists",
    bestFor: "Best for video creators and visual artists who sell their eye — reel up front, work filterable, booking built in.",
    description:
      "Showreel portfolio: hero with a reel frame, selected-work grid with a working category filter (video / photo & art / brand), services cards with pricing lines, client testimonial, about page, and a booking inquiry form.",
    sections: ["Showreel hero", "Selected work", "Services", "Testimonial", "About", "Book a project"],
    brief: {
      description:
        "A complete portfolio site from the Showreel Portfolio template: my showreel up front, a filterable grid of selected work, my services with pricing lines, a client testimonial, an about page, and a booking inquiry form. Placeholders mark everything I need to replace with my real details.",
      style: "Charcoal gallery minimalism, ivory text, gold accents, wide letter-spaced labels",
      colorScheme: "Charcoal with ivory and gold",
    },
    files: {
      "index.html": SHOWREEL_INDEX,
      "about.html": SHOWREEL_ABOUT,
      "styles.css": SHOWREEL_CSS,
      "script.js": SHOWREEL_JS,
      "README.md": SHOWREEL_README,
    },
  },
];

export function getWebsiteTemplate(id: string): WebsiteTemplate | undefined {
  return WEBSITE_TEMPLATES.find((t) => t.id === id);
}
