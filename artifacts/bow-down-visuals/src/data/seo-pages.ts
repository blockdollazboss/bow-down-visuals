/* ─── Programmatic SEO data — shared source of truth (Worker 9, virality wave)
   Tool pages (/tools/*), creator vertical hubs (/for/*), genre hubs (/genres/*).
   Copy is curated, factual, and honest: template picks are real entries from
   src/data/*-templates.ts (deep-linked with ?template=<slug>); nothing is
   invented. Top-tracks/creators sections always link to the live discovery
   hubs (/genre/:genre, /vertical/:vertical) rather than fabricating names. */

export interface SeoFaq {
  q: string;
  a: string;
}

export interface SeoFeature {
  title: string;
  blurb: string;
}

export interface ToolSeo {
  slug: string;
  path: string;
  name: string;
  title: string;
  metaDescription: string;
  kicker: string;
  h1Lead: string;
  h1Gold: string;
  intro: string[];
  features: SeoFeature[];
  howItWorks: { title: string; blurb: string }[];
  templateKind: "thumbnail" | "hook" | "caption" | "video";
  templateSlugs: string[];
  templateGalleryHref: string;
  templateGalleryLabel: string;
  toolHref: string;
  toolCtaLabel: string;
  applicationCategory: string;
  faqs: SeoFaq[];
}

export const TOOL_PAGES: ToolSeo[] = [
  {
    slug: "ai-thumbnail-maker",
    path: "/tools/ai-thumbnail-maker",
    name: "AI Thumbnail Maker",
    title: "AI Thumbnail Maker — High-CTR YouTube Thumbnails in Seconds",
    metaDescription:
      "Generate scroll-stopping YouTube thumbnails with AI. Pick a proven template style, describe your video, and get a high-CTR thumbnail in seconds.",
    kicker: "AI tool · Thumbnails",
    h1Lead: "AI Thumbnail",
    h1Gold: "Maker",
    intro: [
      "Your thumbnail decides the click before your title gets a chance. Bow Down Visuals' AI Thumbnail Maker turns a one-line description of your video into a bold, high-contrast thumbnail built on styles that actually earn clicks — expressive faces, punchy overlay text, and compositions tuned for tiny mobile screens.",
      "Start from one of 30 proven template styles — fitness transformations, gaming, podcasts, finance, vlogs, tech reviews and more — or describe your own look. Browsing is free; credits only apply when you generate.",
    ],
    features: [
      {
        title: "30 proven template styles",
        blurb:
          "Every style is a real, named template — before/after splits, reaction close-ups, podcast guest frames — deep-linked so one click preloads it into the maker.",
      },
      {
        title: "Text that pops on mobile",
        blurb:
          "Overlay text suggestions are tuned for 3–5 word punchy phrases at 16:9 and 9:16, sized to stay legible on a phone screen.",
      },
      {
        title: "Your look, kept consistent",
        blurb:
          "Reuse the same style preset across a series so returning viewers recognize your videos instantly in the feed.",
      },
      {
        title: "Built for the click",
        blurb:
          "High contrast, bold subjects, and clear focal points — the ingredients every high-CTR thumbnail shares, applied automatically.",
      },
    ],
    howItWorks: [
      {
        title: "Pick a template",
        blurb:
          "Browse the gallery below and hit “Use this template” — the style, prompt, and overlay text preload into the maker.",
      },
      {
        title: "Describe your video",
        blurb:
          "Add your topic and the 3–5 words you want on the thumbnail. The AI composes the shot around them.",
      },
      {
        title: "Generate & download",
        blurb:
          "Get your thumbnail in seconds. Regenerate variations until one screams “click me,” then export it.",
      },
    ],
    templateKind: "thumbnail",
    templateSlugs: [
      "fitness-transformation-youtube-thumbnail",
      "podcast-episode-thumbnail",
      "gaming-video-thumbnail",
    ],
    templateGalleryHref: "/templates/thumbnails",
    templateGalleryLabel: "Thumbnail templates",
    toolHref: "/thumbnail-maker",
    toolCtaLabel: "Open the Thumbnail Maker",
    applicationCategory: "DesignApplication",
    faqs: [
      {
        q: "Is the AI thumbnail maker free?",
        a: "Browsing all 30 template styles is completely free — no account needed. You only spend credits when you generate a thumbnail, and you can preview the style before committing.",
      },
      {
        q: "What size thumbnails does it make?",
        a: "Templates come in 16:9 for YouTube videos and 9:16 for Shorts. The maker keeps text and subjects inside safe zones for each format.",
      },
      {
        q: "Can I use my own photos in the thumbnail?",
        a: "Yes — upload your own images and the AI builds the thumbnail composition around them, or generate everything from scratch with a text description.",
      },
      {
        q: "Do I need design skills?",
        a: "No. Every template is a proven starting point with the composition, colors, and text placement handled. You describe the video; the AI handles the design.",
      },
    ],
  },
  {
    slug: "ai-hook-generator",
    path: "/tools/ai-hook-generator",
    name: "AI Hook Generator",
    title: "AI Hook Generator — Viral Video Hooks for TikTok, Reels & Shorts",
    metaDescription:
      "Generate scroll-stopping video hooks with AI. Pick a template for music promos, tutorials, announcements and more — 5 viral-ready hooks in seconds.",
    kicker: "AI tool · Hooks",
    h1Lead: "AI Hook",
    h1Gold: "Generator",
    intro: [
      "The first two seconds decide everything. Bow Down Visuals' AI Hook Generator writes opening hooks engineered for retention — pattern interrupts, curiosity gaps, and bold claims matched to your video type, from single releases to tutorials to announcements.",
      "Choose from 30 hook templates across 16 categories, each with a preloaded topic you can rewrite in your own words. Free to browse; credits apply when you generate.",
    ],
    features: [
      {
        title: "30 hook templates, 16 niches",
        blurb:
          "Music promo, behind-the-scenes, tutorial, announcement, comedy, podcast, business and more — each template knows what works in its lane.",
      },
      {
        title: "Five hooks per run",
        blurb:
          "Every generation returns a batch of five distinct hooks, so you're choosing between winners instead of settling for one.",
      },
      {
        title: "Matched to your video type",
        blurb:
          "Hook Studio tailors the structure — a single-release tease reads nothing like a tutorial opener, and the generator knows the difference.",
      },
      {
        title: "From hook to caption in one flow",
        blurb:
          "Push a winning hook straight into caption packs so the post copy matches the energy of the opening line.",
      },
    ],
    howItWorks: [
      {
        title: "Pick a hook template",
        blurb:
          "Find your niche below and hit “Use this template” — the topic and video type preload into Hook Studio.",
      },
      {
        title: "Make it yours",
        blurb:
          "Rewrite the topic in your own words — your song, your product, your story — and generate.",
      },
      {
        title: "Ship the best five",
        blurb:
          "Test the batch, film the strongest hook first, and post it with a matching caption pack.",
      },
    ],
    templateKind: "hook",
    templateSlugs: [
      "new-single-release-hook",
      "grow-on-tiktok-hook",
      "mixing-tips-hook",
    ],
    templateGalleryHref: "/templates/hooks",
    templateGalleryLabel: "Hook templates",
    toolHref: "/hooks",
    toolCtaLabel: "Open the Hook Generator",
    applicationCategory: "MultimediaApplication",
    faqs: [
      {
        q: "What is a video hook?",
        a: "The hook is the first 1–3 seconds of a short video — the line or visual that stops the scroll. Strong hooks typically open with a curiosity gap, a bold claim, or a pattern interrupt.",
      },
      {
        q: "How many hooks do I get per generation?",
        a: "Each run returns five distinct hooks for your topic, so you can compare approaches — curiosity vs. bold claim vs. story tease — before filming.",
      },
      {
        q: "Can it write hooks for non-music content?",
        a: "Yes. Templates cover tutorials, announcements, comedy, podcast clips, business, travel, beauty, sports, DIY, parenting, pets, news, and motivation.",
      },
      {
        q: "Does it also write captions?",
        a: "Hook Studio has a captions tab with 30 caption packs, so your post copy can match the hook's energy without switching tools.",
      },
    ],
  },
  {
    slug: "ai-caption-generator",
    path: "/tools/ai-caption-generator",
    name: "AI Caption Generator",
    title: "AI Caption Generator — Captions & Hashtags for Every Post",
    metaDescription:
      "Write better captions with AI. 30 caption packs for releases, launches, tours, merch drops and more — with hashtag sets tuned for reach.",
    kicker: "AI tool · Captions",
    h1Lead: "AI Caption",
    h1Gold: "Generator",
    intro: [
      "A great post dies with a lazy caption. Bow Down Visuals' AI Caption Generator writes post copy with a real voice — release announcements that build hype, engagement-bait questions that pull comments, behind-the-scenes captions that make followers feel like insiders.",
      "Thirty caption packs cover the moments creators actually post about: singles, videos, albums, tours, merch drops, milestones. Each pack ships with hashtag sets tuned for reach. Free to browse; credits apply when you generate.",
    ],
    features: [
      {
        title: "30 caption packs",
        blurb:
          "Release day, tour announcements, merch drops, stream milestones, Q&A prompts — the moments you post about, pre-written in your voice.",
      },
      {
        title: "Hashtags included",
        blurb:
          "Every pack pairs captions with hashtag sets so you don't post great copy into the void.",
      },
      {
        title: "Engagement-first formats",
        blurb:
          "Question packs, call-to-action closers, and comment-bait structures built to trigger the algorithm's favorite metric: replies.",
      },
      {
        title: "Lives inside Hook Studio",
        blurb:
          "Generate hooks and captions in one place — the ?tab=captions deep link preloads any pack straight into the studio.",
      },
    ],
    howItWorks: [
      {
        title: "Pick a caption pack",
        blurb:
          "Find your moment below — single release, tour, milestone — and hit “Use this pack.”",
      },
      {
        title: "Add your details",
        blurb:
          "Drop in names, dates, and links. The AI writes around your facts, not generic filler.",
      },
      {
        title: "Post with hashtags",
        blurb:
          "Copy the caption and its hashtag set, or tweak the tone and regenerate until it sounds like you.",
      },
    ],
    templateKind: "caption",
    templateSlugs: [
      "single-release-captions",
      "question-engagement-captions",
      "tour-promo-captions",
    ],
    templateGalleryHref: "/templates/captions",
    templateGalleryLabel: "Caption packs",
    toolHref: "/hooks?tab=captions",
    toolCtaLabel: "Open the Caption Generator",
    applicationCategory: "MultimediaApplication",
    faqs: [
      {
        q: "What does the caption generator write?",
        a: "Full post captions plus hashtag sets — release announcements, launch posts, tour promos, merch drops, milestone celebrations, and engagement questions designed to pull comments.",
      },
      {
        q: "Can it match my voice?",
        a: "Yes — describe your tone or feed it a past caption you liked, and it writes in that register instead of generic marketing speak.",
      },
      {
        q: "Does it include hashtags?",
        a: "Every pack includes hashtag sets tuned for reach on TikTok, Instagram, and YouTube, alongside the caption copy.",
      },
      {
        q: "Is it separate from the hook generator?",
        a: "No — captions live inside Hook Studio under the captions tab, so your hooks and post copy stay in one workflow.",
      },
    ],
  },
  {
    slug: "ai-music-video-maker",
    path: "/tools/ai-music-video-maker",
    name: "AI Music Video Maker",
    title: "AI Music Video Maker — Turn Songs Into Cinematic Videos",
    metaDescription:
      "Make music videos with AI: generate clips from text or images, sync lyric cuts to the beat, and export release-ready videos for any platform.",
    kicker: "AI tool · Music videos",
    h1Lead: "AI Music Video",
    h1Gold: "Maker",
    intro: [
      "A song without a visual is half a release. Bow Down Visuals' AI music video pipeline turns your track into a real video: generate cinematic clips from text or reference images, cut them to your structure, burn lyric lines across the frame, and export in the aspect ratio each platform wants.",
      "Start from a video template — lyric sync cuts, photo montages, promo teasers — or generate raw clips with Seedance and assemble them in the editor. Browsing templates is free; generation spends credits.",
    ],
    features: [
      {
        title: "Text & image to video",
        blurb:
          "Describe the shot or upload a reference frame — Seedance-powered generation renders cinematic clips in 5, 10, 15, or 30 second lengths.",
      },
      {
        title: "Lyric sync cuts",
        blurb:
          "Templates that chop performance clips into beat-length cuts with lyric lines burned across the frame — built for snippet drops and premieres.",
      },
      {
        title: "Every aspect ratio",
        blurb:
          "16:9 for YouTube premieres, 9:16 for Shorts and TikTok, 1:1 for the feed — one project, every placement.",
      },
      {
        title: "Lip-sync ready",
        blurb:
          "Performance clips can be lip-synced to your track, so the artist on screen actually sings the song.",
      },
    ],
    howItWorks: [
      {
        title: "Bring the song",
        blurb:
          "Generate your track in the Song Maker or upload finished audio — the video pipeline builds around your actual mix.",
      },
      {
        title: "Generate or template the visuals",
        blurb:
          "Generate cinematic clips from prompts, or drop footage into a video template for an instant structured cut.",
      },
      {
        title: "Cut, caption, export",
        blurb:
          "Assemble in the editor, burn in lyric captions, and export release-ready for YouTube, TikTok, and Reels.",
      },
    ],
    templateKind: "video",
    templateSlugs: ["lyric-sync-cut", "hype-trailer", "photo-dump-montage"],
    templateGalleryHref: "/templates/videos",
    templateGalleryLabel: "Video templates",
    toolHref: "/make-video",
    toolCtaLabel: "Start Your Music Video",
    applicationCategory: "MultimediaApplication",
    faqs: [
      {
        q: "How long are the generated clips?",
        a: "AI clips generate in 5, 10, 15, or 30 second lengths at 720p or 1080p. Longer videos are assembled by sequencing clips in the editor.",
      },
      {
        q: "Can the video match my song's lyrics?",
        a: "Yes — lyric sync templates cut footage to beat-length segments and burn each lyric line across the frame, timed to your track.",
      },
      {
        q: "What does it cost to make a music video?",
        a: "Browsing templates is free. Clip generation and exports spend credits — the exact cost is shown before you confirm, so there are no surprises.",
      },
      {
        q: "Can I use my own footage?",
        a: "Absolutely. Upload performance clips, B-roll, or photos and the templates cut them into structured edits — AI generation is optional, not required.",
      },
    ],
  },
  {
    slug: "ai-clip-maker",
    path: "/tools/ai-clip-maker",
    name: "AI Clip Maker",
    title: "AI Clip Maker — Turn Long Videos Into Viral Short Clips",
    metaDescription:
      "Repurpose long videos into Shorts, Reels, and TikToks with AI. Auto-find the best moments, cut vertical clips, and add captions in one flow.",
    kicker: "AI tool · Clips",
    h1Lead: "AI Clip",
    h1Gold: "Maker",
    intro: [
      "Your best moment is buried at minute 47. Bow Down Visuals' AI Clip Maker finds it — analyzing long videos and streams for the laugh, the drop, the hot take, then cutting vertical clips sized for Shorts, Reels, and TikTok with captions burned in.",
      "Streamers get highlight detection built for live moments; podcasters get quotable-segment cutting; vloggers get rapid montage templates. Free to explore; credits apply when you cut and export.",
    ],
    features: [
      {
        title: "Moment detection",
        blurb:
          "The analyzer scores your footage for energy, laughter, and quotable lines — then proposes the clips worth cutting.",
      },
      {
        title: "Vertical-first cuts",
        blurb:
          "9:16 reframing keeps faces and action centered, with auto captions sized for phone screens.",
      },
      {
        title: "Stream highlight mode",
        blurb:
          "Built for streamers: feed a VOD or stream and get highlight reels cut from the moments chat went wild.",
      },
      {
        title: "Template-powered edits",
        blurb:
          "Drop clips into video templates — beat cuts, montages, teasers — for edits that look intentional, not auto-generated.",
      },
    ],
    howItWorks: [
      {
        title: "Upload or link footage",
        blurb:
          "Bring a long video, a stream VOD, or a podcast episode — anything with moments worth mining.",
      },
      {
        title: "Let AI find the moments",
        blurb:
          "The analyzer proposes the strongest segments. Approve, trim, or pick your own.",
      },
      {
        title: "Export vertical clips",
        blurb:
          "Cut 9:16 clips with captions and post straight to Shorts, Reels, and TikTok.",
      },
    ],
    templateKind: "video",
    templateSlugs: ["podcast-highlight", "talking-head-polish", "hype-trailer"],
    templateGalleryHref: "/templates/videos",
    templateGalleryLabel: "Video templates",
    toolHref: "/repurpose?mode=stream",
    toolCtaLabel: "Open the Clip Maker",
    applicationCategory: "MultimediaApplication",
    faqs: [
      {
        q: "What footage can I clip?",
        a: "Long-form videos, stream VODs, and podcast episodes. Upload directly or work from your saved projects — the analyzer handles the rest.",
      },
      {
        q: "Does it add captions automatically?",
        a: "Yes — clips export with burned-in captions sized for vertical viewing, so they perform with the sound off.",
      },
      {
        q: "Can I choose the moments myself?",
        a: "Of course. AI proposes the strongest segments, but you approve every cut — trim, reject, or mark your own moments manually.",
      },
      {
        q: "Which platforms are the clips sized for?",
        a: "YouTube Shorts, TikTok, and Instagram Reels — 9:16 vertical with safe-zone-aware captions.",
      },
    ],
  },
  {
    slug: "ai-song-maker",
    path: "/tools/ai-song-maker",
    name: "AI Song Maker",
    title: "AI Song Maker — Write & Produce Full Songs With AI",
    metaDescription:
      "Create original songs with AI: lyrics, melodies, and full production in any genre. From a one-line idea to a release-ready track.",
    kicker: "AI tool · Music",
    h1Lead: "AI Song",
    h1Gold: "Maker",
    intro: [
      "Every release starts with the song. Bow Down Visuals' AI Song Maker takes a one-line idea — a feeling, a story, a late-night voice memo of a concept — and builds it into a full track: lyrics with real structure, melody, and production in the genre you pick.",
      "Pick a lane below to see how the Song Maker handles each sound, from hip-hop to lo-fi. You keep the creative direction; the AI handles the heavy lifting of arrangement and production.",
    ],
    features: [
      {
        title: "Any genre, real structure",
        blurb:
          "Verse-chorus-bridge songwriting with genre-aware production — 808s and hi-hat rolls for trap, four-on-the-floor for EDM, dusty chords for lo-fi.",
      },
      {
        title: "Lyrics that scan",
        blurb:
          "Rhymes, meter, and song structure written to actually sing — not word salad that falls apart on the mic.",
      },
      {
        title: "From idea to stems",
        blurb:
          "Generate the full track, then separate stems, polish vocals, or remix sections as the song evolves.",
      },
      {
        title: "Release-ready pipeline",
        blurb:
          "Master the track, generate cover art, cut the music video, and write the promo — one connected flow to release day.",
      },
    ],
    howItWorks: [
      {
        title: "Describe the song",
        blurb:
          "One line is enough — the vibe, the story, the genre. Add lyrics or a reference if you have them.",
      },
      {
        title: "Generate the track",
        blurb:
          "The AI writes and produces the full song. Regenerate sections until the chorus hits right.",
      },
      {
        title: "Finish and release",
        blurb:
          "Master it, make the video, write the hooks and captions — everything downstream lives on the same platform.",
      },
    ],
    templateKind: "hook",
    templateSlugs: [
      "new-single-release-hook",
      "songwriting-process-hook",
      "studio-session-hook",
    ],
    templateGalleryHref: "/templates/hooks",
    templateGalleryLabel: "Song promo hooks",
    toolHref: "/make-song",
    toolCtaLabel: "Start Making Your Song",
    applicationCategory: "MusicApplication",
    faqs: [
      {
        q: "Do I own the songs I make?",
        a: "Yes — songs you generate are yours to release, monetize, and distribute however you choose.",
      },
      {
        q: "What genres can it produce?",
        a: "Hip-hop, pop, EDM, rock, R&B, lo-fi, country, trap and more — pick a genre hub below to see how each sound is handled.",
      },
      {
        q: "Can I write my own lyrics?",
        a: "Yes. Bring your own lyrics and the AI produces around them, or let it write from your concept — verse, chorus, and bridge included.",
      },
      {
        q: "What happens after the song is done?",
        a: "The pipeline continues: mastering, cover art, music video, promo clips, hooks, and captions — every step to release day in one place.",
      },
    ],
  },
];

export const TOOL_PAGE_MAP: Record<string, ToolSeo> = Object.fromEntries(
  TOOL_PAGES.map((t) => [t.slug, t]),
);

/* ─── Creator vertical hubs (/for/*) ───
   "AI video tools for YouTubers" style pages: relevant tools + templates +
   a link to the live discovery hub for real top creators. */

export interface VerticalSeo {
  slug: string;
  path: string;
  audience: string;
  title: string;
  metaDescription: string;
  kicker: string;
  h1Lead: string;
  h1Gold: string;
  intro: string[];
  pains: SeoFeature[];
  workflow: SeoFeature[];
  toolSlugs: string[];
  templateKind: "thumbnail" | "hook" | "caption" | "video";
  templateSlugs: string[];
  templateGalleryHref: string;
  templateGalleryLabel: string;
  discoveryHref: string;
  discoveryLabel: string;
  faqs: SeoFaq[];
}

export const VERTICAL_HUBS: VerticalSeo[] = [
  {
    slug: "youtubers",
    path: "/for/youtubers",
    audience: "YouTubers",
    title: "AI Video Tools for YouTubers — Thumbnails, Hooks & Edits",
    metaDescription:
      "AI tools built for YouTubers: high-CTR thumbnail maker, viral hook generator, clip cutter, and caption packs — everything to grow your channel.",
    kicker: "For creators · YouTube",
    h1Lead: "AI Tools for",
    h1Gold: "YouTubers",
    intro: [
      "YouTube rewards consistency, but consistency eats creators alive. Bow Down Visuals gives YouTubers an AI production team: thumbnails engineered for clicks, hooks written for retention, long videos cut into Shorts, and captions that pull comments — all in one place.",
      "Start with the tool that hurts most — usually the thumbnail — then let each output feed the next: a thumbnail style becomes a channel identity, a hook becomes a Short, a Short becomes subscribers.",
    ],
    pains: [
      {
        title: "Thumbnails that don't get clicked",
        blurb:
          "The AI Thumbnail Maker builds on 30 proven high-CTR styles — expressive, high-contrast, mobile-legible — instead of guessing in Photoshop.",
      },
      {
        title: "Intros that lose viewers",
        blurb:
          "The Hook Generator writes opening lines built for retention, matched to your video type: vlog, tutorial, review, or announcement.",
      },
      {
        title: "Long videos, zero Shorts",
        blurb:
          "The Clip Maker mines your uploads for the moments worth cutting and reframes them vertical for Shorts — one video becomes five.",
      },
      {
        title: "Dead comment sections",
        blurb:
          "Caption packs with engagement-first formats — questions, CTAs, comment bait — turn passive viewers into a community.",
      },
    ],
    workflow: [
      {
        title: "Make the thumbnail",
        blurb:
          "Pick a template style, describe the video, generate. Lock a consistent style so subscribers spot you in the feed.",
      },
      {
        title: "Write the hook",
        blurb:
          "Generate five opening hooks for the video's topic and film the strongest one first.",
      },
      {
        title: "Cut the Shorts",
        blurb:
          "After upload, run the video through the Clip Maker and ship the best moments as Shorts that funnel back to the full video.",
      },
      {
        title: "Post with captions",
        blurb:
          "Community posts and Shorts descriptions get caption packs with hashtag sets — no more blank description boxes.",
      },
    ],
    toolSlugs: ["ai-thumbnail-maker", "ai-hook-generator", "ai-clip-maker", "ai-caption-generator"],
    templateKind: "thumbnail",
    templateSlugs: [
      "gaming-video-thumbnail",
      "vlog-travel-thumbnail",
      "tech-review-thumbnail",
    ],
    templateGalleryHref: "/templates/thumbnails",
    templateGalleryLabel: "Thumbnail templates",
    discoveryHref: "/vertical/video",
    discoveryLabel: "Top video creators on Bow Down Visuals",
    faqs: [
      {
        q: "What's the best AI tool for YouTube thumbnails?",
        a: "Bow Down Visuals' AI Thumbnail Maker is built specifically for high-CTR YouTube thumbnails: 30 proven template styles, punchy overlay text, and 16:9 plus 9:16 formats for videos and Shorts.",
      },
      {
        q: "Can AI help my videos get more views?",
        a: "AI helps at the leverage points: thumbnails raise click-through rate, hooks raise retention, and clips multiply one video into many Shorts. The content still has to be yours — the tools make more of it, faster.",
      },
      {
        q: "How do I turn long videos into Shorts?",
        a: "The AI Clip Maker analyzes your upload, finds the strongest moments, and cuts vertical clips with captions — ready for Shorts, TikTok, and Reels.",
      },
      {
        q: "Do I need to pay to try these tools?",
        a: "Browsing every template gallery is free with no account. Credits only apply when you generate — and new accounts start with free trial credits.",
      },
    ],
  },
  {
    slug: "podcasters",
    path: "/for/podcasters",
    audience: "Podcasters",
    title: "AI Tools for Podcasters — Clips, Captions & Promotion",
    metaDescription:
      "AI tools for podcasters: turn episodes into viral clips, generate captions and hooks, and promote every episode without hiring an editor.",
    kicker: "For creators · Podcasting",
    h1Lead: "AI Tools for",
    h1Gold: "Podcasters",
    intro: [
      "The episode is the easy part — getting anyone to hear it is the job. Bow Down Visuals gives podcasters an AI promo team: episode clips cut from your best quotes, captions and hooks for every post, and thumbnails for the video version.",
      "Record the episode. Everything after that — the clips, the captions, the promo posts — runs through one connected workflow.",
    ],
    pains: [
      {
        title: "Episodes nobody discovers",
        blurb:
          "The Clip Maker cuts your most quotable moments into vertical clips — the format discovery algorithms actually push.",
      },
      {
        title: "Promo posts that take longer than the episode",
        blurb:
          "Caption packs and hook templates turn one episode into a week of posts in minutes, not hours.",
      },
      {
        title: "Video podcasts with no visuals",
        blurb:
          "Thumbnail templates for podcast episodes and talking-head polish templates give the video version a real look.",
      },
      {
        title: "Guest promotion that fizzles",
        blurb:
          "Generate guest-specific clips and captions your guests actually want to share with their audience.",
      },
    ],
    workflow: [
      {
        title: "Cut the clips",
        blurb:
          "Run the episode through the Clip Maker — it finds the quotable moments and cuts them vertical with captions.",
      },
      {
        title: "Write the hooks",
        blurb:
          "Generate hooks for each clip so the first two seconds earn the watch.",
      },
      {
        title: "Caption every post",
        blurb:
          "Episode announcements, audiograms, guest tags — caption packs cover the whole promo calendar.",
      },
      {
        title: "Thumbnail the video version",
        blurb:
          "Podcast episode thumbnails for the YouTube upload, styled to match your show's identity.",
      },
    ],
    toolSlugs: ["ai-clip-maker", "ai-hook-generator", "ai-caption-generator", "ai-thumbnail-maker"],
    templateKind: "hook",
    templateSlugs: ["podcast-episode-hook", "podcast-clip-hook", "mindset-shift-hook"],
    templateGalleryHref: "/templates/hooks",
    templateGalleryLabel: "Podcast hook templates",
    discoveryHref: "/vertical/podcast",
    discoveryLabel: "Top podcasters on Bow Down Visuals",
    faqs: [
      {
        q: "How do I promote my podcast with short clips?",
        a: "Cut your best 30–60 second moments into vertical clips with captions and post them where discovery happens — TikTok, Reels, and Shorts. The AI Clip Maker finds quotable segments automatically.",
      },
      {
        q: "Can AI write my episode descriptions?",
        a: "Yes — caption packs include announcement and behind-the-scenes formats that adapt to episode descriptions, show notes teasers, and social posts.",
      },
      {
        q: "What about video podcasts on YouTube?",
        a: "Podcast episode thumbnail templates give the YouTube upload a clickable look, and talking-head polish templates clean up the visual edit.",
      },
      {
        q: "How many clips should I post per episode?",
        a: "Three to five clips per episode is the sweet spot — enough to test which moments resonate without spamming. The Clip Maker typically surfaces 5–10 candidate moments per hour of audio.",
      },
    ],
  },
  {
    slug: "streamers",
    path: "/for/streamers",
    audience: "Streamers",
    title: "AI Tools for Streamers — Highlights, Clips & Channel Branding",
    metaDescription:
      "AI tools for streamers: auto-cut stream highlights, viral clips from VODs, thumbnails, and hooks — turn every stream into a week of content.",
    kicker: "For creators · Streaming",
    h1Lead: "AI Tools for",
    h1Gold: "Streamers",
    intro: [
      "You stream for six hours; the internet watches sixty seconds. Bow Down Visuals turns every stream into a content engine: highlight detection finds the moments chat went wild, the Clip Maker cuts them vertical, and thumbnails plus hooks package them for the algorithm.",
      "Go live, then let the AI work the VOD while you sleep. One stream becomes highlights, Shorts, TikToks, and posts.",
    ],
    pains: [
      {
        title: "VODs nobody watches",
        blurb:
          "Highlight detection scores your stream for energy and chat reaction, then cuts the moments worth rewatching.",
      },
      {
        title: "Clipping takes longer than streaming",
        blurb:
          "The Clip Maker proposes cuts automatically — you approve, trim, and export instead of scrubbing timelines.",
      },
      {
        title: "No visual identity",
        blurb:
          "Gaming thumbnail templates and channel-branded styles give your uploads and Shorts a recognizable look.",
      },
      {
        title: "Dead socials between streams",
        blurb:
          "Hooks and caption packs turn highlights into daily posts, so your channels stay alive on off days.",
      },
    ],
    workflow: [
      {
        title: "Stream",
        blurb:
          "Go live like normal. The VOD is the raw material — nothing changes about your setup.",
      },
      {
        title: "Auto-detect highlights",
        blurb:
          "Run the VOD through the analyzer. It surfaces the plays, the fails, and the funny moments.",
      },
      {
        title: "Cut and caption",
        blurb:
          "Export vertical clips with burned-in captions for Shorts, TikTok, and Reels.",
      },
      {
        title: "Package and post",
        blurb:
          "Thumbnails for the highlight compilation, hooks for each clip, captions for every post.",
      },
    ],
    toolSlugs: ["ai-clip-maker", "ai-thumbnail-maker", "ai-hook-generator", "ai-caption-generator"],
    templateKind: "thumbnail",
    templateSlugs: [
      "gaming-video-thumbnail",
      "youtube-shorts-thumbnail",
      "fitness-transformation-youtube-thumbnail",
    ],
    templateGalleryHref: "/templates/thumbnails",
    templateGalleryLabel: "Gaming & Shorts thumbnails",
    discoveryHref: "/vertical/gaming",
    discoveryLabel: "Top streamers on Bow Down Visuals",
    faqs: [
      {
        q: "Can AI clip my Twitch/YouTube streams?",
        a: "Yes — feed the VOD to the Clip Maker and it detects high-energy moments, funny segments, and big plays, then cuts them into vertical clips with captions.",
      },
      {
        q: "How long does auto-clipping take?",
        a: "Analysis runs in the background while you do anything else — you get notified when the candidate clips are ready to review.",
      },
      {
        q: "Do the clips work for TikTok too?",
        a: "Every clip exports 9:16 vertical with captions, ready for TikTok, Reels, and YouTube Shorts from the same cut.",
      },
      {
        q: "Can I brand my clips?",
        a: "Consistent thumbnail styles and caption formatting keep your clips recognizable across platforms — your channel identity travels with every clip.",
      },
    ],
  },
  {
    slug: "musicians",
    path: "/for/musicians",
    audience: "Musicians",
    title: "AI Tools for Musicians — Songs, Videos & Release Promo",
    metaDescription:
      "AI tools for musicians: generate songs, make music videos, write viral hooks and captions — the full pipeline from idea to release day.",
    kicker: "For creators · Music",
    h1Lead: "AI Tools for",
    h1Gold: "Musicians",
    intro: [
      "Making the song is half the job — the other half is everything after it. Bow Down Visuals is built for independent musicians as one connected pipeline: write and produce the track, make the video, cut the promo clips, write the hooks and captions, and ship the release.",
      "Start at the song or start at the promo — every tool hands off to the next, so nothing you make gets stranded.",
    ],
    pains: [
      {
        title: "Songs stuck as voice memos",
        blurb:
          "The Song Maker turns a one-line idea into a full produced track — lyrics, melody, arrangement — in your genre.",
      },
      {
        title: "No video, no release",
        blurb:
          "The Music Video Maker generates cinematic clips and cuts lyric-synced edits around your actual track.",
      },
      {
        title: "Promo that never happens",
        blurb:
          "Thirty hook templates and thirty caption packs cover release day, tour announcements, and every milestone after.",
      },
      {
        title: "Cover art on a deadline",
        blurb:
          "Generate release artwork in the same session as the song — the visual ships with the audio.",
      },
    ],
    workflow: [
      {
        title: "Make the song",
        blurb:
          "Describe the vibe and genre. The AI writes and produces the full track; you direct until the chorus hits.",
      },
      {
        title: "Make the video",
        blurb:
          "Generate cinematic clips or cut your footage into lyric-synced edits for the premiere and the Shorts.",
      },
      {
        title: "Cut the promo",
        blurb:
          "Teaser hooks, snippet clips, behind-the-scenes cuts — the two weeks before release, handled.",
      },
      {
        title: "Post the release",
        blurb:
          "Release-day captions, announcement hooks, and hashtag sets — every post written, every platform covered.",
      },
    ],
    toolSlugs: ["ai-song-maker", "ai-music-video-maker", "ai-hook-generator", "ai-caption-generator"],
    templateKind: "hook",
    templateSlugs: [
      "new-single-release-hook",
      "music-video-premiere-hook",
      "song-teaser-hook",
    ],
    templateGalleryHref: "/templates/hooks",
    templateGalleryLabel: "Music promo hooks",
    discoveryHref: "/vertical/music",
    discoveryLabel: "Top artists on Bow Down Visuals",
    faqs: [
      {
        q: "Can AI really make a full song?",
        a: "Yes — the Song Maker writes lyrics with real song structure and produces the full track in your genre, from a one-line concept. You keep creative direction and own the result.",
      },
      {
        q: "How do I promote a song release with AI?",
        a: "The release pipeline: teaser hooks for the two weeks before, snippet clips cut from the video, release-day captions with hashtags, and announcement posts — all generated around your actual song.",
      },
      {
        q: "Can I make a music video without filming?",
        a: "Yes. Generate cinematic clips from text or image prompts and assemble them into lyric-synced edits — or upload your own footage and let the templates cut it.",
      },
      {
        q: "Do I own the music I generate?",
        a: "Songs you generate are yours to release, monetize, and distribute however you choose.",
      },
    ],
  },
  {
    slug: "tiktokers",
    path: "/for/tiktokers",
    audience: "TikTokers",
    title: "AI Tools for TikTokers — Hooks, Captions & Viral Clips",
    metaDescription:
      "AI tools for TikTok creators: scroll-stopping hooks, caption packs with hashtags, and clip templates — post daily without burning out.",
    kicker: "For creators · TikTok",
    h1Lead: "AI Tools for",
    h1Gold: "TikTokers",
    intro: [
      "TikTok rewards volume, and volume burns creators out. Bow Down Visuals is the shortcut: hooks engineered for the first two seconds, caption packs that pull comments, and templates that turn one idea into a week of posts.",
      "The creators winning TikTok post daily. These tools make daily posting sustainable — ideation, hooks, and captions in minutes.",
    ],
    pains: [
      {
        title: "Posting daily is unsustainable",
        blurb:
          "Thirty hook templates and thirty caption packs mean you never start from a blank screen — pick, personalize, post.",
      },
      {
        title: "Videos die in the first second",
        blurb:
          "The Hook Generator writes pattern interrupts and curiosity gaps matched to your niche, five options per run.",
      },
      {
        title: "Captions are an afterthought",
        blurb:
          "Engagement-first caption formats — questions, CTAs, comment bait — with hashtag sets tuned for reach.",
      },
      {
        title: "No consistent style",
        blurb:
          "9:16 thumbnail styles and video templates keep your grid recognizable as you scale output.",
      },
    ],
    workflow: [
      {
        title: "Pick the angle",
        blurb:
          "Browse hook templates in your niche — comedy, beauty, business, motivation, and eleven more.",
      },
      {
        title: "Generate five hooks",
        blurb:
          "Rewrite the topic in your words and get five opening lines. Film the strongest first.",
      },
      {
        title: "Pair the caption",
        blurb:
          "Grab the matching caption pack — question formats for comments, hype formats for launches.",
      },
      {
        title: "Post and repeat",
        blurb:
          "Daily output without daily burnout. Track which hooks win and double down.",
      },
    ],
    toolSlugs: ["ai-hook-generator", "ai-caption-generator", "ai-clip-maker", "ai-thumbnail-maker"],
    templateKind: "hook",
    templateSlugs: ["grow-on-tiktok-hook", "relatable-comedy-hook", "side-hustle-hook"],
    templateGalleryHref: "/templates/hooks",
    templateGalleryLabel: "TikTok hook templates",
    discoveryHref: "/vertical/influencer",
    discoveryLabel: "Top short-form creators on Bow Down Visuals",
    faqs: [
      {
        q: "What's the best AI hook generator for TikTok?",
        a: "Bow Down Visuals' Hook Generator: 30 templates across 16 niches, five hooks per run, and structures built for TikTok's retention curve — curiosity gaps, bold claims, and pattern interrupts.",
      },
      {
        q: "How do I write better TikTok captions?",
        a: "Use caption packs built for engagement — question formats that pull comments and CTA closers that drive follows — plus hashtag sets tuned for reach.",
      },
      {
        q: "Can AI help me post every day?",
        a: "That's the point: templates eliminate the blank screen. Most creators go from idea to posted in minutes per video instead of starting every caption from zero.",
      },
      {
        q: "Do hashtags still matter on TikTok?",
        a: "They help discovery, especially niche tags. Every caption pack ships with hashtag sets so you're not guessing at tags.",
      },
    ],
  },
  {
    slug: "educators",
    path: "/for/educators",
    audience: "Educators",
    title: "AI Tools for Educators & Course Creators — Lessons Into Content",
    metaDescription:
      "AI tools for educators: turn lessons into Shorts, write hooks that make learning scroll-stopping, and promote courses without a marketing team.",
    kicker: "For creators · Education",
    h1Lead: "AI Tools for",
    h1Gold: "Educators",
    intro: [
      "The best teacher doesn't always win — the most visible one does. Bow Down Visuals helps educators and course creators turn lessons into content: long lectures cut into Shorts, hooks that make a tutorial scroll-stopping, and captions that sell the course without sounding salesy.",
      "Teach once, then let the AI repackage every lesson into a week of discovery content that funnels back to your course.",
    ],
    pains: [
      {
        title: "Great lessons, no audience",
        blurb:
          "The Clip Maker cuts your most quotable teaching moments into vertical Shorts — the format learners actually discover.",
      },
      {
        title: "Tutorials that feel boring",
        blurb:
          "Hook templates for tutorials and how-tos open with the payoff first, so viewers stay for the lesson.",
      },
      {
        title: "Course launches that whisper",
        blurb:
          "Announcement hooks and caption packs turn a launch into a campaign — teasers, FAQs, testimonials, enrollment pushes.",
      },
      {
        title: "No time for marketing",
        blurb:
          "You're teaching full-time. Templates compress a week of promo into an afternoon.",
      },
    ],
    workflow: [
      {
        title: "Record the lesson",
        blurb:
          "Teach like normal — the long-form lesson is the raw material for everything else.",
      },
      {
        title: "Cut the Shorts",
        blurb:
          "The Clip Maker finds the quotable moments and cuts them vertical with captions for Shorts and Reels.",
      },
      {
        title: "Hook each lesson",
        blurb:
          "Tutorial hooks open with the transformation — “learn X in Y minutes” — not the syllabus.",
      },
      {
        title: "Promote the course",
        blurb:
          "Announcement captions and hooks for enrollment windows, with FAQ-style posts that answer objections.",
      },
    ],
    toolSlugs: ["ai-clip-maker", "ai-hook-generator", "ai-caption-generator", "ai-thumbnail-maker"],
    templateKind: "hook",
    templateSlugs: ["mixing-tips-hook", "mindset-shift-hook", "five-minute-glam-hook"],
    templateGalleryHref: "/templates/hooks",
    templateGalleryLabel: "Tutorial hook templates",
    discoveryHref: "/vertical/education",
    discoveryLabel: "Top educators on Bow Down Visuals",
    faqs: [
      {
        q: "How can teachers use AI for content creation?",
        a: "The highest-leverage use is repurposing: cut long lessons into Shorts, write scroll-stopping hooks for tutorials, and generate captions that promote courses — all from material you've already taught.",
      },
      {
        q: "Can AI help sell my online course?",
        a: "Yes — announcement hooks and caption packs cover the launch arc: teasers, enrollment announcements, FAQ posts that handle objections, and testimonial formats.",
      },
      {
        q: "What hooks work for educational videos?",
        a: "Payoff-first hooks: lead with the transformation or the surprising fact, then teach. Tutorial templates are built around this structure.",
      },
      {
        q: "Do I need video editing skills?",
        a: "No. The Clip Maker finds moments and cuts them automatically; video templates handle the edit structure. You approve everything, but you don't touch a timeline.",
      },
    ],
  },
];

export const VERTICAL_HUB_MAP: Record<string, VerticalSeo> = Object.fromEntries(
  VERTICAL_HUBS.map((v) => [v.slug, v]),
);

/* ─── Genre hubs (/genres/*) ───
   Static, curated genre pages: real genre knowledge (BPM ranges, subgenres,
   origins), the AI pipeline for that sound, and links to the LIVE discovery
   hub (/genre/:genre) for actual top tracks and creators — never fabricated. */

export interface GenreSeo {
  slug: string;
  path: string;
  name: string;
  title: string;
  metaDescription: string;
  kicker: string;
  h1Lead: string;
  h1Gold: string;
  intro: string[];
  facts: { label: string; value: string }[];
  subgenres: string[];
  toolSlugs: string[];
  discoveryHref: string;
  faqs: SeoFaq[];
}

export const GENRE_HUBS: GenreSeo[] = [
  {
    slug: "hip-hop",
    path: "/genres/hip-hop",
    name: "Hip-Hop",
    title: "Make Hip-Hop With AI — Beats, Lyrics & Music Videos",
    metaDescription:
      "Create hip-hop with AI: hard-hitting beats, bar-for-bar lyrics, and cinematic music videos. From boom bap to trap to drill.",
    kicker: "Genre hub · Hip-Hop",
    h1Lead: "Make Hip-Hop",
    h1Gold: "With AI",
    intro: [
      "Hip-hop runs on drums, delivery, and confidence — and the AI pipeline here speaks all three. Generate beats with knocking 808s and rolling hi-hats, write verses with real bar structure and internal rhymes, then shoot the visual: cinematic performance clips cut to your track.",
      "From boom bap to trap to drill, the Song Maker handles the subgenres with genre-aware production. Pick your lane below, or browse live hip-hop tracks and artists on the discovery hub.",
    ],
    facts: [
      { label: "Typical BPM", value: "70–150 (trap ~130–150, boom bap ~85–95)" },
      { label: "Born", value: "The Bronx, 1970s — DJ Kool Herc's breakbeats" },
      { label: "Signature sounds", value: "808s, hi-hat rolls, sampled breaks, ad-libs" },
      { label: "Song structure", value: "16-bar verses, hook-heavy choruses, beat switches" },
    ],
    subgenres: ["Trap", "Boom Bap", "Drill", "Conscious", "West Coast", "Crunk"],
    toolSlugs: ["ai-song-maker", "ai-music-video-maker", "ai-hook-generator"],
    discoveryHref: "/genre/hip-hop",
    faqs: [
      {
        q: "Can AI make real hip-hop beats?",
        a: "Yes — the Song Maker produces genre-aware beats: 808 patterns, hi-hat rolls, and drum programming matched to subgenres from trap to boom bap, with full song structure around them.",
      },
      {
        q: "Does the AI write actual bars?",
        a: "It writes verses with real bar structure, rhyme schemes, and flow patterns — 16s, hooks, and bridges that scan when performed, not random rhyming words.",
      },
      {
        q: "What hip-hop subgenres work best?",
        a: "Trap, drill, boom bap, and melodic hip-hop are the strongest lanes — the production signatures (808 slides, UK drill bass, dusty samples) are all in the model.",
      },
      {
        q: "Can I make a rap music video with AI?",
        a: "Yes — generate cinematic performance clips and cut them to your track with lyric-synced edits, or upload your own footage and let the templates handle the cut.",
      },
    ],
  },
  {
    slug: "pop",
    path: "/genres/pop",
    name: "Pop",
    title: "Make Pop Music With AI — Hooks, Production & Visuals",
    metaDescription:
      "Create pop music with AI: unforgettable hooks, polished production, and release-ready visuals. From dance-pop to bedroom pop.",
    kicker: "Genre hub · Pop",
    h1Lead: "Make Pop",
    h1Gold: "With AI",
    intro: [
      "Pop is the art of the unforgettable three minutes. The AI pipeline writes hooks built to loop in heads, produces polished arrangements with modern pop sheen, and packages the release with visuals and promo that match the single's energy.",
      "From dance-pop to bedroom pop to hyperpop edges, the Song Maker handles the range — then the video and promo tools carry the single to release day.",
    ],
    facts: [
      { label: "Typical BPM", value: "95–130 (dance-pop ~120–128)" },
      { label: "Song structure", value: "Verse–pre-chorus–chorus, the hook is everything" },
      { label: "Signature sounds", value: "Stacked vocals, synth leads, punchy modern drums" },
      { label: "Length", value: "2:30–3:30 — built for streaming and radio" },
    ],
    subgenres: ["Dance-Pop", "Bedroom Pop", "Hyperpop", "Synth-Pop", "Indie Pop", "K-Pop"],
    toolSlugs: ["ai-song-maker", "ai-music-video-maker", "ai-caption-generator"],
    discoveryHref: "/genre/pop",
    faqs: [
      {
        q: "Can AI write a catchy pop hook?",
        a: "That's pop's whole game and the Song Maker is built for it — memorable melodic hooks with singable phrasing, stacked harmonies, and production that keeps the chorus front and center.",
      },
      {
        q: "What does a pop release need besides the song?",
        a: "The visual and the promo: a music video or visualizer, teaser clips for the two weeks before release, and caption packs for release-day posts. The pipeline covers all of it.",
      },
      {
        q: "Can I make bedroom pop with AI?",
        a: "Yes — describe the lo-fi, intimate production style and the Song Maker leans into softer drums, hazy guitars, and close-mic vocal energy.",
      },
      {
        q: "How long should a pop single be?",
        a: "Streaming-era pop typically runs 2:30–3:30. The Song Maker structures tracks in that range with the hook arriving early.",
      },
    ],
  },
  {
    slug: "edm",
    path: "/genres/edm",
    name: "EDM",
    title: "Make EDM With AI — Drops, Builds & Festival Anthems",
    metaDescription:
      "Produce EDM with AI: massive drops, euphoric builds, and festival-ready masters. House, dubstep, techno, trance and more.",
    kicker: "Genre hub · EDM",
    h1Lead: "Make EDM",
    h1Gold: "With AI",
    intro: [
      "EDM is architecture — tension, release, repeat. The AI pipeline builds tracks with real DJ structure: intros that mix, builds that tighten, drops that detonate, and breakdowns that breathe before the second hit.",
      "House, dubstep, techno, trance, drum & bass — pick the subgenre and the production follows: sidechained four-on-the-floor, wobbling bass design, or rolling 140 energy.",
    ],
    facts: [
      { label: "Typical BPM", value: "House 120–130 · Dubstep 140–150 · DnB 170–180 · Techno 120–135" },
      { label: "Song structure", value: "Intro–build–drop–breakdown–drop, DJ-mixable" },
      { label: "Signature sounds", value: "Supersaws, sidechain compression, risers, impact drops" },
      { label: "Born", value: "Rave culture, late 1980s — Chicago house, Detroit techno" },
    ],
    subgenres: ["House", "Dubstep", "Techno", "Trance", "Drum & Bass", "Future Bass"],
    toolSlugs: ["ai-song-maker", "ai-music-video-maker", "ai-clip-maker"],
    discoveryHref: "/genre/edm",
    faqs: [
      {
        q: "Can AI produce a real EDM drop?",
        a: "Yes — the Song Maker builds proper EDM structure: risers and drum fills into the build, then a designed drop with bass, leads, and impact, followed by a breakdown before the second drop.",
      },
      {
        q: "What EDM subgenres can it make?",
        a: "House, dubstep, techno, trance, drum & bass, and future bass — each with its signature BPM, drum patterns, and sound design.",
      },
      {
        q: "Are the tracks DJ-mixable?",
        a: "Tracks are structured with DJ-friendly intros and outros in standard BPM ranges, so they slot into sets.",
      },
      {
        q: "Can I get stems of the drop?",
        a: "Yes — stem separation splits your track so you can remix, re-arrange, or rebuild the drop yourself.",
      },
    ],
  },
  {
    slug: "rock",
    path: "/genres/rock",
    name: "Rock",
    title: "Make Rock Music With AI — Riffs, Anthems & Live Energy",
    metaDescription:
      "Create rock with AI: driving riffs, anthemic choruses, and live-band energy. From garage rock to alt-rock to hard rock.",
    kicker: "Genre hub · Rock",
    h1Lead: "Make Rock",
    h1Gold: "With AI",
    intro: [
      "Rock runs on riffs and attitude. The AI pipeline writes guitar-driven songs with real verse-chorus dynamics — quiet verses that explode into choruses — and production with live-band punch: driving drums, layered guitars, vocals up front.",
      "Garage, alt-rock, hard rock, indie — describe the era and the energy, and the arrangement follows. Then cut a performance-style video to match.",
    ],
    facts: [
      { label: "Typical BPM", value: "110–140 (anthems ~120–128)" },
      { label: "Song structure", value: "Verse–chorus dynamics, guitar solos, big final chorus" },
      { label: "Signature sounds", value: "Distorted guitars, driving drums, gang vocals" },
      { label: "Born", value: "1950s rock and roll — Chuck Berry, Little Richard, Elvis" },
    ],
    subgenres: ["Alt-Rock", "Garage Rock", "Hard Rock", "Indie Rock", "Punk", "Grunge"],
    toolSlugs: ["ai-song-maker", "ai-music-video-maker", "ai-hook-generator"],
    discoveryHref: "/genre/rock",
    faqs: [
      {
        q: "Can AI write rock songs with real riffs?",
        a: "Yes — the Song Maker writes riff-driven arrangements with verse-chorus dynamics, bridges, and guitar-forward production in the subgenre you pick.",
      },
      {
        q: "Does it sound like a real band?",
        a: "Production leans into live-band energy: driving drum performances, layered guitars, and upfront vocals — describe the era (garage, grunge, modern alt) to dial the sound.",
      },
      {
        q: "Can I write my own lyrics for the track?",
        a: "Absolutely — bring your lyrics and the AI produces the arrangement around them, or let it write the full song from your concept.",
      },
      {
        q: "What about a rock music video?",
        a: "Performance-style edits work best for rock: generate cinematic band-performance clips or cut your own footage into high-energy edits synced to the track.",
      },
    ],
  },
  {
    slug: "rnb",
    path: "/genres/rnb",
    name: "R&B",
    title: "Make R&B With AI — Smooth Vocals, Slow Jams & Soul",
    metaDescription:
      "Create R&B with AI: silky vocal runs, lush chords, and late-night grooves. From classic soul to modern alternative R&B.",
    kicker: "Genre hub · R&B",
    h1Lead: "Make R&B",
    h1Gold: "With AI",
    intro: [
      "R&B is feel — vocal runs that float, chords that glow, grooves that sit back in the pocket. The AI pipeline writes slow-burning songs with lush harmony and produces them with the genre's signature warmth: Rhodes-style keys, soft drums, stacked background vocals.",
      "Classic soul, 90s slow jams, or modern alternative R&B — pick the era and the production follows the feeling.",
    ],
    facts: [
      { label: "Typical BPM", value: "60–100 (slow jams ~65–80)" },
      { label: "Signature sounds", value: "Rhodes keys, vocal runs, stacked harmonies, warm bass" },
      { label: "Song structure", value: "Long melodic phrases, vamps, ad-libbed outros" },
      { label: "Born", value: "1940s rhythm and blues — evolved through Motown, 90s, and alt-R&B" },
    ],
    subgenres: ["Classic Soul", "90s R&B", "Alternative R&B", "Neo-Soul", "Quiet Storm"],
    toolSlugs: ["ai-song-maker", "ai-music-video-maker", "ai-caption-generator"],
    discoveryHref: "/genre/rnb",
    faqs: [
      {
        q: "Can AI sing R&B runs?",
        a: "The Song Maker writes melodic R&B with the genre's signature phrasing — runs, melisma, and stacked harmonies are part of the vocal writing, not an afterthought.",
      },
      {
        q: "What R&B styles does it cover?",
        a: "Classic soul, 90s slow jams, neo-soul, and modern alternative R&B — each with era-accurate production from Rhodes warmth to minimalist alt-R&B space.",
      },
      {
        q: "Can I get a slow jam for a specific moment?",
        a: "Yes — describe the mood (late-night drive, wedding first dance, heartbreak) and the song is written around that feeling.",
      },
      {
        q: "How do I release an R&B single?",
        a: "The pipeline runs song to video to promo: generate the track, cut a cinematic visual, then run teaser hooks and release-day captions around it.",
      },
    ],
  },
  {
    slug: "lofi",
    path: "/genres/lofi",
    name: "Lo-Fi",
    title: "Make Lo-Fi Beats With AI — Chill Study & Relaxing Beats",
    metaDescription:
      "Create lo-fi beats with AI: dusty drums, jazzy chords, and cozy textures. Perfect for study playlists, streams, and relaxing content.",
    kicker: "Genre hub · Lo-Fi",
    h1Lead: "Make Lo-Fi",
    h1Gold: "With AI",
    intro: [
      "Lo-fi is a whole mood — dusty drums, jazzy seventh chords, vinyl crackle, and melodies that never demand attention. The AI pipeline produces beats with that exact texture: swung drums, warm keys, and lo-fi grit baked into the mix.",
      "Study playlists, cozy streams, background content — lo-fi is the hardest-working background music on the internet, and now you can generate an endless supply of it.",
    ],
    facts: [
      { label: "Typical BPM", value: "70–90 (the classic head-nod zone)" },
      { label: "Signature sounds", value: "Dusty drums, Rhodes/piano chords, vinyl crackle, tape hiss" },
      { label: "Song structure", value: "Loops that evolve subtly — 2–4 chord vamps" },
      { label: "Born", value: "Underground hip-hop production, popularized by YouTube study streams" },
    ],
    subgenres: ["Jazzhop", "Chillhop", "Ambient Lo-Fi", "Sleepy Beats", "Vapor"],
    toolSlugs: ["ai-song-maker", "ai-clip-maker", "ai-caption-generator"],
    discoveryHref: "/genre/lofi",
    faqs: [
      {
        q: "Can AI make real lo-fi hip-hop beats?",
        a: "Yes — dusty swung drums, jazzy chord vamps, vinyl texture, and mellow melodies in the 70–90 BPM pocket. The production is built around the genre's signature warmth.",
      },
      {
        q: "Are lo-fi beats good for study streams?",
        a: "They're the format's native music — non-distracting, loopable, and endless. Generate hours of beats for 24/7 study or cozy streams.",
      },
      {
        q: "Can I use the beats in my videos?",
        a: "Beats you generate are yours to use in content, streams, and releases however you choose.",
      },
      {
        q: "How long can the beats be?",
        a: "Generate full-length tracks and loop them for streams, or produce variations on a theme for a cohesive playlist sound.",
      },
    ],
  },
  {
    slug: "country",
    path: "/genres/country",
    name: "Country",
    title: "Make Country Music With AI — Storytelling Songs & Heartfelt Ballads",
    metaDescription:
      "Create country music with AI: storytelling lyrics, acoustic warmth, and heartfelt ballads. From classic country to modern country-pop.",
    kicker: "Genre hub · Country",
    h1Lead: "Make Country",
    h1Gold: "With AI",
    intro: [
      "Country is three chords and the truth. The AI pipeline writes story-driven songs — verses that set a scene, choruses that land the feeling — and produces them with acoustic warmth: strummed guitars, pedal steel color, and vocals that sound like they mean it.",
      "Classic country storytelling or modern country-pop polish — the song starts with your story, and the production follows.",
    ],
    facts: [
      { label: "Typical BPM", value: "90–130 (ballads ~65–80)" },
      { label: "Signature sounds", value: "Acoustic guitar, pedal steel, fiddle, warm vocals" },
      { label: "Song structure", value: "Story verses, big singalong choruses" },
      { label: "Born", value: "1920s American South — folk, blues, and gospel roots" },
    ],
    subgenres: ["Classic Country", "Country-Pop", "Outlaw", "Bluegrass", "Americana"],
    toolSlugs: ["ai-song-maker", "ai-music-video-maker", "ai-hook-generator"],
    discoveryHref: "/genre/country",
    faqs: [
      {
        q: "Can AI write country storytelling lyrics?",
        a: "Yes — country runs on narrative, and the Song Maker writes scene-setting verses with concrete details and choruses that land the emotional payoff, in classic or modern style.",
      },
      {
        q: "Does it sound like real country production?",
        a: "Acoustic-driven arrangements with pedal steel, fiddle color, and warm vocal-forward mixes — describe classic or country-pop and the production follows.",
      },
      {
        q: "Can I write a song about my own story?",
        a: "That's the best use case — give the AI your story's details (the truck, the town, the goodbye) and it builds the song around your real specifics.",
      },
      {
        q: "What about a country music video?",
        a: "Story-driven songs pair perfectly with cinematic narrative visuals — generate scenic performance clips or cut your own footage into a story arc.",
      },
    ],
  },
  {
    slug: "trap",
    path: "/genres/trap",
    name: "Trap",
    title: "Make Trap Music With AI — 808s, Hi-Hats & Hard Beats",
    metaDescription:
      "Produce trap with AI: sliding 808s, rapid hi-hats, and dark atmospheric beats. From Atlanta trap to rage to drill-adjacent sounds.",
    kicker: "Genre hub · Trap",
    h1Lead: "Make Trap",
    h1Gold: "With AI",
    intro: [
      "Trap is controlled chaos — half-time drums, sliding 808s, hi-hats rolling at inhuman speeds, and dark melodies floating over it all. The AI pipeline produces trap with the genre's exact drum science and atmospheric sound design.",
      "Atlanta roots, rage energy, drill edges — pick the flavor and the 808s follow. Then shoot the visual: dark, cinematic, larger than life.",
    ],
    facts: [
      { label: "Typical BPM", value: "130–150 (felt in half-time ~65–75)" },
      { label: "Signature sounds", value: "Sliding 808s, triplet hi-hats, dark bells, snare rolls" },
      { label: "Song structure", value: "Beat-switch-friendly, ad-libbed verses, chantable hooks" },
      { label: "Born", value: "Early 2000s Atlanta — T.I., Gucci Mane, Jeezy" },
    ],
    subgenres: ["Atlanta Trap", "Rage", "Drill", "Plugg", "Dark Trap"],
    toolSlugs: ["ai-song-maker", "ai-music-video-maker", "ai-clip-maker"],
    discoveryHref: "/genre/trap",
    faqs: [
      {
        q: "Can AI make hard trap beats?",
        a: "Yes — sliding 808s, triplet and rolling hi-hats, dark melodic loops, and snare rolls, all in the 130–150 BPM pocket with half-time drum feel.",
      },
      {
        q: "What's the difference between trap and drill?",
        a: "Drill typically runs slightly slower with sliding basslines and a darker, UK/Chicago-rooted sound; trap is broader with chantable hooks. The Song Maker handles both — just name your lane.",
      },
      {
        q: "Can it write trap hooks?",
        a: "Trap hooks are about repetition and energy — chantable phrases over the 808 pattern. The AI writes hooks built for that formula.",
      },
      {
        q: "How do I promote a trap single?",
        a: "Snippet culture is everything in trap: cut the hardest 15 seconds into vertical clips, run teaser hooks for two weeks, and let the snippet do the marketing before release day.",
      },
    ],
  },
];

export const GENRE_HUB_MAP: Record<string, GenreSeo> = Object.fromEntries(
  GENRE_HUBS.map((g) => [g.slug, g]),
);
