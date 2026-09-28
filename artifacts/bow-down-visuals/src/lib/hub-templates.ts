import {
  Drum, Disc3, Flame, Dumbbell, Shirt, Gamepad2, UtensilsCrossed, Plane,
  Banknote, Laugh, Cpu, Rocket, Film, Ghost, Heart, Trophy, Swords, Puzzle,
  Skull, Mic, Newspaper, Briefcase, ShoppingBag, GraduationCap, Scale,
  Megaphone, Music2, Star, Clapperboard, Users, Wand2, Lightbulb, ImageIcon,
  AudioWaveform, CalendarDays, Handshake, Coins, Play, MessageCircle,
  TrendingUp, Sparkles, Moon, Crown, Zap, ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { HubProjectType } from "./hub-project";

/* ─── Hub templates ─────────────────────────────────────────────────────────
   CapCut-style preloaded starters: every template ships with a full creative
   brief (the concept) plus preloaded settings for the steps that matter, so a
   new project opens already pointing somewhere instead of at a blank page. */

export interface TemplatePreload {
  /** Workflow step key this hint belongs to. */
  step: string;
  /** The preloaded starter — shown in the guide on that step. */
  hint: string;
}

export interface HubTemplate {
  key: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  /** Preloaded project name. */
  projectName: string;
  /** The preloaded creative brief — carried through the whole chain. */
  concept: string;
  /** Preloaded per-step starters. */
  preload: TemplatePreload[];
}

export const HUB_TEMPLATES: Record<HubProjectType, HubTemplate[]> = {
  song: [
    {
      key: "trap-banger", name: "Trap Banger", blurb: "Dark, hard-hitting trap built for the club and the car.", icon: Flame,
      projectName: "Trap Banger",
      concept: "A dark trap anthem about coming up from nothing. Menacing piano loop, sliding 808s, and rapid hi-hats. The hook needs to be chant-ready — something a crowd screams back. One verse, huge hook, second verse that goes harder.",
      preload: [
        { step: "beat", hint: "140 BPM · minor key · dark piano + sliding 808s + rolling hi-hats" },
        { step: "song", hint: "Theme: from nothing to something · hook first, chant-ready" },
        { step: "video", hint: "Night city, neon, luxury cars — performance shots with the artist front and center" },
        { step: "promo", hint: "Hook-only 15s clips · bass-boosted for car-test videos" },
      ],
    },
    {
      key: "rnb-slow-jam", name: "R&B Slow Jam", blurb: "Silky late-night R&B with room-filling vocals.", icon: Moon,
      projectName: "Slow Jam",
      concept: "A late-night R&B slow jam about love that almost slipped away. Warm Rhodes chords, soft drums, stacked harmonies on the hook. The vocal is the star — intimate verses, soaring chorus.",
      preload: [
        { step: "beat", hint: "92 BPM · major 7th chords · Rhodes + soft kick, roomy snare" },
        { step: "song", hint: "Intimate verses, stacked harmonies on the hook" },
        { step: "video", hint: "Moody low-light, city rain, cinematic close-ups" },
      ],
    },
    {
      key: "afrobeats-party", name: "Afrobeats Party", blurb: "Sun-soaked Afrobeats made for the dancefloor.", icon: Star,
      projectName: "Afrobeats Party",
      concept: "A feel-good Afrobeats record about celebrating life with your people. Log-drum groove, bouncy percussion, melodic pidgin-tinged hook. Built to make shoulders move in the first ten seconds.",
      preload: [
        { step: "beat", hint: "100 BPM · log drums · shakers + melodic guitar plucks" },
        { step: "song", hint: "Call-and-response hook · dancefloor energy from bar one" },
        { step: "promo", hint: "Dance-challenge clip cut to the hook" },
      ],
    },
    {
      key: "boombap-story", name: "Boom Bap Story", blurb: "Dusty drums, sharp bars, real storytelling.", icon: Newspaper,
      projectName: "Boom Bap Story",
      concept: "A boom-bap storytelling record — one vivid true story across three verses. Chopped soul sample, dusty drums, no hook gimmicks: the bars carry it. Written like a short film.",
      preload: [
        { step: "beat", hint: "90 BPM · chopped soul sample · dusty kick-snare" },
        { step: "samples", hint: "Dig for a soulful vocal chop to anchor the loop" },
        { step: "song", hint: "3 verses, one story · vivid scene-setting bars" },
      ],
    },
    {
      key: "drill-anthem", name: "Drill Anthem", blurb: "Sliding 808s and dead-serious energy.", icon: Zap,
      projectName: "Drill Anthem",
      concept: "A drill anthem with block-ready energy. Sliding 808s, sparse dark melody, and a hook that sounds like a warning. Ad-libs doing half the talking.",
      preload: [
        { step: "beat", hint: "142 BPM · sliding 808s · sparse dark bells" },
        { step: "song", hint: "Aggressive hook · ad-libs as an instrument" },
        { step: "video", hint: "Stark, high-contrast visuals · crew shots" },
      ],
    },
    {
      key: "pop-hit", name: "Pop Hit", blurb: "Big chorus, bigger feelings — radio-ready pop.", icon: Sparkles,
      projectName: "Pop Hit",
      concept: "A radio-ready pop record about the rush of new love. Bright synths, driving drums, and a chorus that lands on the first listen. Verse, pre-chorus lift, explosive chorus.",
      preload: [
        { step: "beat", hint: "118 BPM · bright synths · four-on-the-floor energy" },
        { step: "song", hint: "Pre-chorus lift into an explosive, simple chorus" },
        { step: "lyricvideo", hint: "Bold kinetic type on bright gradients" },
      ],
    },
  ],
  video: [
    {
      key: "talking-head", name: "Talking Head", blurb: "You, the camera, and an idea worth hearing.", icon: Mic,
      projectName: "Talking Head Video",
      concept: "A talking-head video where you break down one big idea in under 8 minutes. Open with a bold claim, prove it with three points, close with a CTA. Punchy cuts every 3–5 seconds.",
      preload: [
        { step: "hook", hint: "Open with a bold claim that sounds wrong until you explain it" },
        { step: "script", hint: "3 points, one idea · 8 minutes max" },
        { step: "captions", hint: "Word-by-word pop captions, top keywords highlighted" },
        { step: "thumbnail", hint: "Your face + 3 words max, high contrast" },
      ],
    },
    {
      key: "vlog", name: "Day Vlog", blurb: "A day in your life, cut like a movie.", icon: Play,
      projectName: "Day Vlog",
      concept: "A day-in-the-life vlog cut like a short film. Morning hook, three story beats through the day, reflective close. B-roll over voiceover carries the energy.",
      preload: [
        { step: "hook", hint: "Start mid-action — the most interesting 3 seconds of the day" },
        { step: "clips", hint: "Pull 3 vertical moments: the hook, the twist, the lesson" },
        { step: "thumbnail", hint: "Candid moment + curious title" },
      ],
    },
    {
      key: "tutorial", name: "Tutorial", blurb: "Teach it step by step — the video that ranks forever.", icon: GraduationCap,
      projectName: "How-To Tutorial",
      concept: "A step-by-step tutorial that teaches one skill start to finish. Promise the outcome in the first 15 seconds, then numbered steps with on-screen demos. Built to rank in search for years.",
      preload: [
        { step: "hook", hint: "Promise the exact outcome in 15 seconds" },
        { step: "script", hint: "Numbered steps · show, don't just tell" },
        { step: "captions", hint: "Clean readable captions — tutorials get watched on mute" },
      ],
    },
    {
      key: "storytime", name: "Storytime", blurb: "One wild story, told like only you can.", icon: MessageCircle,
      projectName: "Storytime",
      concept: "A storytime video about the wildest thing that ever happened to you. Cold open on the climax, rewind to the start, escalate to the payoff. Retention lives in the tease.",
      preload: [
        { step: "hook", hint: "Cold open on the climax — then rewind" },
        { step: "script", hint: "Tease the payoff 3 times before delivering it" },
        { step: "clips", hint: "The climax moment as a standalone clip" },
      ],
    },
    {
      key: "street-interview", name: "Street Interview", blurb: "One question, strangers, unfiltered answers.", icon: Users,
      projectName: "Street Interview",
      concept: "A street-interview video built around one spicy question. Ask ten strangers, keep the five wildest answers, rapid-fire edit. The question is the whole video — make it irresistible.",
      preload: [
        { step: "hook", hint: "The question on screen before anyone answers" },
        { step: "script", hint: "One question · follow-ups that escalate" },
        { step: "captions", hint: "Speaker labels + punchy word pops" },
      ],
    },
  ],
  visual: [
    {
      key: "artist-identity", name: "Artist Identity Lock", blurb: "Your face, style, and rules — locked forever.", icon: ShieldCheck,
      projectName: "Artist Identity",
      concept: "The complete visual identity lock for an AI artist: face, signature style, color rules, and never-break guidelines. Every future visual gets generated against this lock.",
      preload: [
        { step: "vault", hint: "Front-facing portrait + style keywords + 3 never-break rules" },
        { step: "logo", hint: "Monogram style, works at avatar size" },
        { step: "brand", hint: "One kit: logo, colors, intro card" },
      ],
    },
    {
      key: "channel-rebrand", name: "Channel Rebrand", blurb: "A full new look for your channel in one pass.", icon: Sparkles,
      projectName: "Channel Rebrand",
      concept: "A complete channel rebrand: new logo, banner, thumbnail system, and intro/outro — one consistent look across everything a viewer touches.",
      preload: [
        { step: "logo", hint: "Readable at 98px — test it tiny" },
        { step: "thumbnail", hint: "One system: same font, same layout, new episode = new face" },
        { step: "test", hint: "A/B the old look vs the new on your top video style" },
      ],
    },
    {
      key: "single-pack", name: "Single Cover Pack", blurb: "Cover art plus every size the drop needs.", icon: Disc3,
      projectName: "Single Cover Pack",
      concept: "Cover art for a new single plus every crop the release needs: square, story, banner. One art direction, zero rework on release week.",
      preload: [
        { step: "cover", hint: "Design square-first — it becomes everything else" },
        { step: "upscale", hint: "Upscale the master before cropping down" },
      ],
    },
    {
      key: "streamer-overhaul", name: "Streamer Overhaul", blurb: "Overlays, alerts, panels — the whole stream look.", icon: Gamepad2,
      projectName: "Streamer Overhaul",
      concept: "A full stream visual overhaul: animated overlays, alert animations, panels, and offline screen — one theme, unmistakably yours.",
      preload: [
        { step: "streampack", hint: "One theme across overlay + alerts + panels" },
        { step: "brand", hint: "Match your thumbnails so VODs look intentional" },
      ],
    },
  ],
  movie: [
    {
      key: "scifi-short", name: "Sci-Fi Short", blurb: "One strange signal. One long night. 10 minutes.", icon: Rocket,
      projectName: "Sci-Fi Short",
      concept: "A 10-minute sci-fi short: a radio astronomer picks up a signal that answers back. One location, two characters, escalating dread. The twist recontextualizes the opening shot.",
      preload: [
        { step: "script", hint: "One location, two characters · twist rewrites the opening" },
        { step: "cast", hint: "Lock both faces before generating a single frame" },
        { step: "scenes", hint: "Storyboard first · night exteriors need consistent lighting" },
        { step: "score", hint: "Low synth drone that never fully resolves" },
      ],
    },
    {
      key: "horror-short", name: "Horror Short", blurb: "Don't answer the door. 8 minutes of dread.", icon: Ghost,
      projectName: "Horror Short",
      concept: "An 8-minute horror short built on one rule: the scare is what you don't see. A housesitter, a door that shouldn't be open, and sound design doing the killing.",
      preload: [
        { step: "script", hint: "Dread over jumpscares · the audience's imagination is the monster" },
        { step: "dialogue", hint: "Whispered delivery · long silences" },
        { step: "score", hint: "Sub-bass + diegetic creaks, no melody" },
      ],
    },
    {
      key: "comedy-short", name: "Comedy Short", blurb: "One terrible idea, executed perfectly.", icon: Laugh,
      projectName: "Comedy Short",
      concept: "A 6-minute comedy short: a man tries to return something to a store with no receipt, no box, and no shame. Escalating absurdity, deadpan lead, one perfect button at the end.",
      preload: [
        { step: "script", hint: "Escalate the absurdity · deadpan lead vs chaotic world" },
        { step: "cast", hint: "The straight face sells every joke — lock it" },
        { step: "premiere", hint: "Cut the trailer on the three biggest laughs" },
      ],
    },
    {
      key: "drama-short", name: "Drama Short", blurb: "Two people, one conversation, everything changes.", icon: Heart,
      projectName: "Drama Short",
      concept: "A 12-minute drama: two estranged siblings meet at a diner to divide their mother's things. One conversation, no villains, an ending that hurts in the right way.",
      preload: [
        { step: "script", hint: "Subtext over speeches · what they don't say is the scene" },
        { step: "dialogue", hint: "Naturalistic delivery · overlapping lines" },
        { step: "score", hint: "Single piano motif, barely there" },
      ],
    },
  ],
  series: [
    {
      key: "comedy-series", name: "Comedy Web Series", blurb: "Six episodes of beautiful bad decisions.", icon: Laugh,
      projectName: "Comedy Web Series",
      concept: "A 6-episode comedy web series about roommates running a failing food truck. 8 minutes an episode, one disaster per episode, running gags that pay off in the finale.",
      preload: [
        { step: "arc", hint: "One disaster per episode · running gags pay off in ep 6" },
        { step: "cast", hint: "Lock all four roommates before ep 1" },
        { step: "locations", hint: "The truck is a standing set — lock it once" },
      ],
    },
    {
      key: "drama-miniseries", name: "Drama Miniseries", blurb: "Four episodes. One secret. No going back.", icon: Heart,
      projectName: "Drama Miniseries",
      concept: "A 4-episode drama miniseries: a small-town mayor's perfect life cracks when a stranger arrives with a box of old letters. Slow burn, episode-ending reveals.",
      preload: [
        { step: "arc", hint: "One reveal per episode · the finale recontextualizes ep 1" },
        { step: "episodes", hint: "End every episode mid-consequence, never mid-scene" },
      ],
    },
    {
      key: "ai-adventure", name: "AI Adventure Series", blurb: "A crew, a map, and monsters between them.", icon: Swords,
      projectName: "AI Adventure Series",
      concept: "An AI-generated adventure series: a crew of four sails a living sea where islands are sleeping giants. Episodic quests, season-long mystery about the map that drew itself.",
      preload: [
        { step: "cast", hint: "Four distinct silhouettes — readable at thumbnail size" },
        { step: "locations", hint: "Each island = one strong visual idea" },
        { step: "score", hint: "One heroic theme, endless variations" },
      ],
    },
    {
      key: "reality-style", name: "Reality-Style Show", blurb: "Strangers, one house, zero privacy.", icon: Users,
      projectName: "Reality Show",
      concept: "A reality-style competition show: eight strangers, one house, weekly challenges, one winner. Confessionals carry the story — cast for personality collisions.",
      preload: [
        { step: "cast", hint: "Cast for collisions — every pair needs a dynamic" },
        { step: "episodes", hint: "Challenge + fallout + confessional = the formula" },
        { step: "premiere", hint: "Trailer is 90% confessionals, 10% challenges" },
      ],
    },
  ],
  game: [
    {
      key: "retro-platformer", name: "Retro Platformer", blurb: "Run, jump, and don't fall in the lava.", icon: Gamepad2,
      projectName: "Retro Platformer",
      concept: "A retro pixel-art platformer: a courier robot races across collapsing rooftops to deliver one last package. 20 levels, tight jumps, a speedrun timer that rewards mastery.",
      preload: [
        { step: "story", hint: "One sentence: a courier robot's last delivery across collapsing rooftops" },
        { step: "characters", hint: "Silhouette-readable hero · 3-frame run cycle" },
        { step: "art", hint: "One palette per world · parallax backgrounds" },
        { step: "soundtrack", hint: "Chiptune lead that speeds up on the final levels" },
      ],
    },
    {
      key: "horror-game", name: "Horror Game", blurb: "The flashlight is dying. So are you.", icon: Skull,
      projectName: "Horror Game",
      concept: "A first-person horror game set in an abandoned radio station. No weapons — just a dying flashlight and a tape recorder that plays back things you never said. 90 minutes of dread.",
      preload: [
        { step: "story", hint: "No weapons · the tape recorder is the mechanic" },
        { step: "art", hint: "Darkness is a feature — light only what matters" },
        { step: "sfx", hint: "Footsteps, static, and long silences" },
        { step: "promote", hint: "Streamer-bait: one scare per 10 minutes, clip-ready" },
      ],
    },
    {
      key: "rpg-adventure", name: "RPG Adventure", blurb: "A tiny hero, a huge map, one ancient evil.", icon: Swords,
      projectName: "RPG Adventure",
      concept: "A story-driven RPG: a mapmaker's apprentice discovers the edge of the map is moving. Turn-based battles, a party of four, and a twist at the world's edge.",
      preload: [
        { step: "story", hint: "The map is wrong — that's the whole game" },
        { step: "characters", hint: "Party of four · one healer players will protect with their life" },
        { step: "soundtrack", hint: "Overworld theme players hum for years" },
      ],
    },
    {
      key: "mobile-puzzle", name: "Mobile Puzzle", blurb: "One more level. Just one more.", icon: Puzzle,
      projectName: "Mobile Puzzle",
      concept: "A cozy mobile puzzle game: rotate fragments of stained glass to complete the picture. 100 levels, no timers, no fail state — pure satisfaction.",
      preload: [
        { step: "story", hint: "No fail state · satisfaction is the mechanic" },
        { step: "art", hint: "Stained-glass aesthetic · every level is wallpaper-worthy" },
        { step: "sfx", hint: "The 'click' of a piece landing is sacred — nail it" },
      ],
    },
  ],
  podcast: [
    {
      key: "interview-show", name: "Interview Show", blurb: "Real conversations with people doing real things.", icon: Mic,
      projectName: "Interview Show",
      concept: "A weekly interview show with builders, artists, and outsiders. 45 minutes, three acts: the origin, the hard part, the playbook. Listeners leave with something they can use.",
      preload: [
        { step: "script", hint: "Three acts: origin → the hard part → the playbook" },
        { step: "episode", hint: "Record 60, ship 45 — edit ruthlessly" },
        { step: "cover", hint: "Your face + guest face, consistent layout" },
        { step: "clips", hint: "One 60s clip per episode: the most quotable moment" },
      ],
    },
    {
      key: "solo-commentary", name: "Solo Commentary", blurb: "Your takes, no guests, no mercy.", icon: MessageCircle,
      projectName: "Solo Commentary",
      concept: "A solo commentary podcast: one host, one strong take per episode, 20 minutes. News, culture, or your industry — filtered through an opinion people either love or argue with.",
      preload: [
        { step: "script", hint: "One take per episode · outline, don't read" },
        { step: "episode", hint: "Punchy delivery — edit out every 'um'" },
        { step: "video", hint: "Film it — solo pods live on YouTube too" },
      ],
    },
    {
      key: "true-crime", name: "True Crime", blurb: "The case nobody talks about.", icon: Ghost,
      projectName: "True Crime Pod",
      concept: "A true-crime series covering overlooked cases, one case per 3-episode arc. Respectful, research-heavy, and paced like a thriller. Facts first, drama second.",
      preload: [
        { step: "script", hint: "One case per 3-episode arc · cliffhanger every episode" },
        { step: "episode", hint: "Slow, deliberate narration — let silences breathe" },
        { step: "cover", hint: "Dark, minimal, instantly recognizable in a feed" },
      ],
    },
    {
      key: "comedy-pod", name: "Comedy Pod", blurb: "Two mics, zero plan, all laughs.", icon: Laugh,
      projectName: "Comedy Pod",
      concept: "A comedy podcast with two hosts and zero plan: weekly chaos, recurring bits, and listener voicemails that go off the rails. Chemistry over structure.",
      preload: [
        { step: "script", hint: "Loose bullet points — chemistry over structure" },
        { step: "episode", hint: "Keep the mistakes that are funnier than the plan" },
        { step: "clips", hint: "Clip the bits — they become the show's ads" },
      ],
    },
    {
      key: "mindset-pod", name: "Mindset & Money", blurb: "The playbook, one episode at a time.", icon: Banknote,
      projectName: "Mindset & Money",
      concept: "A mindset-and-money podcast: short 15-minute episodes, one principle each, with a real example and one action step. Built for the morning routine.",
      preload: [
        { step: "script", hint: "15 minutes · one principle + one action step" },
        { step: "episode", hint: "Morning-energy delivery — first thing energy" },
        { step: "video", hint: "Quote cards from every episode for socials" },
      ],
    },
  ],
  "ai-producer": [
    {
      key: "trap-chef", name: "Trap Chef", blurb: "Dark 808s, executive-produced by an AI.", icon: Flame,
      projectName: "Trap Chef",
      concept: "An AI trap producer persona: the shadowy chef behind the hardest beats in the city. Signature sound — dark piano loops, sliding 808s, hi-hats like gunfire. Sells beats, lands placements, never sleeps.",
      preload: [
        { step: "persona", hint: "Name, masked aesthetic, 'the chef' mythology" },
        { step: "beats", hint: "140 BPM signature · dark piano + sliding 808s" },
        { step: "tag", hint: "'Chef's up!' — stamped on every beat" },
        { step: "placements", hint: "Target hungry local rappers first — volume over prestige" },
      ],
    },
    {
      key: "boombap-architect", name: "Boom Bap Architect", blurb: "Dusty loops for lyricists.", icon: Newspaper,
      projectName: "Boom Bap Architect",
      concept: "An AI boom-bap producer for the lyricists: chopped soul, dusty drums, jazz rap textures. The architect builds the foundation — rappers bring the skyscrapers.",
      preload: [
        { step: "beats", hint: "88–94 BPM · chopped soul + dusty drums" },
        { step: "tag", hint: "A vinyl crackle + 'Architect' whisper" },
        { step: "songs", hint: "Build full songs around one perfect loop" },
      ],
    },
    {
      key: "rage-producer", name: "Rage Producer", blurb: "Synths that sound like the future arguing.", icon: Zap,
      projectName: "Rage Producer",
      concept: "An AI rage/hyperpop producer: distorted saw synths, blown-out 808s, melodies from another dimension. The sound of the underground right now.",
      preload: [
        { step: "beats", hint: "150 BPM · distorted saws + blown-out 808s" },
        { step: "content", hint: "Beat-making videos — the process IS the content" },
        { step: "placements", hint: "DM underground artists with 30-second snippets" },
      ],
    },
    {
      key: "afrobeats-cook", name: "Afrobeats Cook", blurb: "Log drums and sunshine, on demand.", icon: Star,
      projectName: "Afrobeats Cook",
      concept: "An AI Afrobeats producer cooking global hits: log-drum grooves, melodic guitar, percussion that moves continents. Built for the worldwide dancefloor.",
      preload: [
        { step: "beats", hint: "98–104 BPM · log drums + shakers + guitar plucks" },
        { step: "tag", hint: "Warm vocal chop tag — feels like summer" },
        { step: "placements", hint: "Pitch to Afrobeats and dancehall artists simultaneously" },
      ],
    },
    {
      key: "drill-smith", name: "Drill Smith", blurb: "Forged in the cold. Sliding 808s.", icon: Skull,
      projectName: "Drill Smith",
      concept: "An AI drill producer with an icy signature: sliding 808s, sparse minor-key bells, drums that hit like footsteps in an empty stairwell.",
      preload: [
        { step: "beats", hint: "142 BPM · sliding 808s + sparse bells" },
        { step: "songs", hint: "One-verse + hook structures — drill is about impact" },
        { step: "content", hint: "'Type beat' videos with the city in the visuals" },
      ],
    },
  ],
  "ai-influencer": [
    {
      key: "fitness-coach", name: "AI Fitness Coach", blurb: "Your virtual trainer with perfect form, 24/7.", icon: Dumbbell,
      projectName: "AI Fitness Coach",
      concept: "A virtual fitness influencer: a motivating coach who posts daily workouts, form breakdowns, and transformation-style content. Never tired, never misses a day, always on brand.",
      preload: [
        { step: "persona", hint: "Name, age 28, ex-athlete energy · tough love + encouragement" },
        { step: "brand", hint: "Athletic aesthetic · consistent gym + outdoor looks" },
        { step: "voice", hint: "Energetic, clear coaching voice" },
        { step: "videos", hint: "30s form breakdowns · 'day 1 vs day 90' style arcs" },
        { step: "deals", hint: "Supplement + activewear brands pay fitness faces first" },
      ],
    },
    {
      key: "fashion-muse", name: "AI Fashion Muse", blurb: "A digital model who never has a bad shoot.", icon: Shirt,
      projectName: "AI Fashion Muse",
      concept: "A virtual fashion influencer: a digital model with an unmistakable look, posting editorial shoots, styling videos, and 'get ready with me' content. Every outfit is a moment.",
      preload: [
        { step: "persona", hint: "High-fashion edge · mysterious, minimal captions" },
        { step: "brand", hint: "One signature look element (silver hair, gold jewelry…)" },
        { step: "photos", hint: "Editorial shoots · always a strong location" },
        { step: "deals", hint: "Fashion + beauty brands — highest-paying niche for virtual faces" },
      ],
    },
    {
      key: "gamer-ai", name: "AI Gamer", blurb: "Clutch plays and chaotic energy, rendered.", icon: Gamepad2,
      projectName: "AI Gamer",
      concept: "A virtual gaming influencer: a charismatic AI gamer posting clutch compilations, funny fails, and hot takes. The personality carries it — the gameplay is the stage.",
      preload: [
        { step: "persona", hint: "Chaotic-good energy · catchphrase after every clutch" },
        { step: "voice", hint: "Hypeman delivery · reactions sell the clip" },
        { step: "videos", hint: "Clutch comps + rage-fail edits — both go viral" },
        { step: "content", hint: "Post daily — gaming rewards volume" },
      ],
    },
    {
      key: "foodie-ai", name: "AI Foodie", blurb: "Every meal looks Michelin-starred.", icon: UtensilsCrossed,
      projectName: "AI Foodie",
      concept: "A virtual food influencer: restaurant tours, recipe recreations, and 'rating street food' series. Every dish looks unreal — because the presentation always is.",
      preload: [
        { step: "persona", hint: "Warm, obsessive about flavor · rates everything /10" },
        { step: "photos", hint: "Overhead hero shots · steam and texture" },
        { step: "videos", hint: "'Rating street food' series — endless content" },
        { step: "deals", hint: "Restaurants + delivery apps + kitchen brands" },
      ],
    },
    {
      key: "travel-ai", name: "AI Traveler", blurb: "Everywhere on Earth, no flights required.", icon: Plane,
      projectName: "AI Traveler",
      concept: "A virtual travel influencer visiting everywhere on Earth: cinematic destination reels, hidden-gem guides, and '48 hours in…' series. Wanderlust on tap.",
      preload: [
        { step: "persona", hint: "Curious, poetic captions · 'take me back' energy" },
        { step: "photos", hint: "Golden-hour everything · one iconic shot per place" },
        { step: "videos", hint: "'48 hours in…' series — repeatable format" },
        { step: "deals", hint: "Tourism boards + hotels + travel gear" },
      ],
    },
    {
      key: "money-mindset-ai", name: "AI Money Mentor", blurb: "Wealth wisdom from a face that never ages.", icon: Banknote,
      projectName: "AI Money Mentor",
      concept: "A virtual finance influencer: sharp-dressed mentor breaking down money moves, business ideas, and mindset in 60 seconds. Authority you can generate.",
      preload: [
        { step: "persona", hint: "Calm authority · 'your rich mentor' archetype" },
        { step: "brand", hint: "Luxury-minimal · suit or streetwear-luxe, never sloppy" },
        { step: "voice", hint: "Measured, confident — the voice of someone who's seen money" },
        { step: "content", hint: "One money lesson per day · hooks with numbers" },
      ],
    },
  ],
  influencer: [
    {
      key: "fitness-creator", name: "Fitness Creator", blurb: "Build the body, build the audience.", icon: Dumbbell,
      projectName: "Fitness Creator",
      concept: "A fitness creator brand: document the journey, teach what works, and become the coach your audience trusts. Transformation content + actionable training.",
      preload: [
        { step: "niche", hint: "Pick ONE: fat loss, muscle, or athletic performance" },
        { step: "content", hint: "3 posts/week: teach, transform, entertain" },
        { step: "hooks", hint: "'I did X for 30 days — here's what happened'" },
        { step: "deals", hint: "Start with affiliate codes, graduate to retainers" },
      ],
    },
    {
      key: "comedy-creator", name: "Comedy Creator", blurb: "Sketches, characters, and chaos.", icon: Laugh,
      projectName: "Comedy Creator",
      concept: "A comedy creator brand: original sketches, recurring characters, and relatable chaos. Post volume wins — the algorithm rewards the prolific.",
      preload: [
        { step: "niche", hint: "Sketches vs. standup clips vs. characters — pick a lane" },
        { step: "content", hint: "Daily sketches · recurring characters build fandom" },
        { step: "collabs", hint: "Duet and stitch bigger comics — borrowed audiences convert" },
      ],
    },
    {
      key: "tech-reviewer", name: "Tech Reviewer", blurb: "Gadgets in, honest takes out.", icon: Cpu,
      projectName: "Tech Reviewer",
      concept: "A tech review brand: honest, fast, visual. Unboxings, 60-second verdicts, and 'worth it or skip it' series. Trust is the currency — never shill.",
      preload: [
        { step: "niche", hint: "Phones, AI tools, or budget tech — own one shelf" },
        { step: "content", hint: "'Worth it or skip it' — the repeatable verdict format" },
        { step: "deals", hint: "Affiliate links first · sponsors after 10k" },
      ],
    },
    {
      key: "beauty-creator", name: "Beauty Creator", blurb: "Looks, tutorials, and honest reviews.", icon: Sparkles,
      projectName: "Beauty Creator",
      concept: "A beauty creator brand: tutorials that actually teach, wear-tests that don't lie, and a signature look people copy. One of the highest-paying niches in the game.",
      preload: [
        { step: "niche", hint: "Tutorials, reviews, or transformations — pick your pillar" },
        { step: "hooks", hint: "Before/after in the first second" },
        { step: "deals", hint: "Beauty pays premium — media kit early" },
      ],
    },
    {
      key: "finance-creator", name: "Finance Creator", blurb: "Money talk that actually helps.", icon: Banknote,
      projectName: "Finance Creator",
      concept: "A personal-finance creator brand: demystify money for regular people. One concept per video, real numbers, zero jargon. Trust compounds like interest.",
      preload: [
        { step: "niche", hint: "Budgeting, investing, or side hustles — one lane" },
        { step: "content", hint: "Real numbers on screen — specificity builds trust" },
        { step: "hooks", hint: "Lead with the mistake, then the fix" },
      ],
    },
  ],
  release: [
    {
      key: "single-drop", name: "Single Drop", blurb: "One song, one moment, maximum noise.", icon: Disc3,
      projectName: "Single Drop",
      concept: "A single release rollout: 2-week runway, cover art, promo clips, and a release-day blitz. One song gets the full campaign treatment.",
      preload: [
        { step: "protect", hint: "Register before the first teaser goes public" },
        { step: "brand", hint: "Cover art that reads at 55px in a playlist" },
        { step: "distribute", hint: "Deliver 2 weeks early · pitch playlists on day one" },
        { step: "promos", hint: "Hook clips × 5 · post daily for 7 days" },
      ],
    },
    {
      key: "ep-launch", name: "EP Launch", blurb: "5 tracks, one story, one rollout.", icon: Music2,
      projectName: "EP Launch",
      concept: "An EP rollout: 5 tracks with one sonic story, two singles before release week, and a visual identity that ties it all together.",
      preload: [
        { step: "brand", hint: "One visual world across all 5 tracks" },
        { step: "plan", hint: "Single 1 → single 2 → EP · 6-week runway" },
        { step: "schedule", hint: "Content calendar: 3 posts/week minimum" },
      ],
    },
    {
      key: "album-rollout", name: "Album Rollout", blurb: "The full era. Act like it.", icon: Crown,
      projectName: "Album Rollout",
      concept: "A full album era: 3 singles, a visual world, merch, and a release show. Albums are campaigns — every piece feeds the story.",
      preload: [
        { step: "brand", hint: "The 'era' look — colors, fonts, motifs locked" },
        { step: "plan", hint: "3 singles · each with its own moment" },
        { step: "monetize", hint: "Merch + show + deluxe — stack the revenue" },
      ],
    },
  ],
  grow: [
    {
      key: "growth-sprint", name: "30-Day Growth Sprint", blurb: "One month. All gas. Measurable growth.", icon: TrendingUp,
      projectName: "30-Day Growth Sprint",
      concept: "A 30-day audience sprint: daily posting, weekly collabs, and a ruthless analytics review every Sunday. Growth is a system, not luck.",
      preload: [
        { step: "hooks", hint: "Write 30 hooks on day one — bank them" },
        { step: "calendar", hint: "1 post/day minimum · batch film on Sundays" },
        { step: "collabs", hint: "One collab per week · same-size creators" },
        { step: "analytics", hint: "Sunday review: kill the bottom 20%, double the top 20%" },
      ],
    },
    {
      key: "clip-engine", name: "Viral Clip Engine", blurb: "Turn everything into clips that travel.", icon: Clapperboard,
      projectName: "Viral Clip Engine",
      concept: "A clip engine: every long video becomes 5+ short clips, every clip gets 3 hook variations. Volume + iteration = the viral lottery with better odds.",
      preload: [
        { step: "hooks", hint: "3 hook variants per clip — test, don't guess" },
        { step: "repurpose", hint: "1 long video → 5 clips → 15 hook variants" },
        { step: "virality", hint: "Run the pre-flight check before posting the best one" },
      ],
    },
    {
      key: "collab-ladder", name: "Collab Ladder", blurb: "Climb audiences one collab at a time.", icon: Users,
      projectName: "Collab Ladder",
      concept: "A collaboration ladder: start with same-size creators, trade audiences upward, and land one dream collab per quarter. Nobody grows alone.",
      preload: [
        { step: "collabs", hint: "Same-size first · bring a concept, not just 'let's collab'" },
        { step: "replies", hint: "Reply to every comment in the first hour — the algorithm notices" },
        { step: "contests", hint: "One giveaway per quarter with a collab partner" },
      ],
    },
  ],
  monetize: [
    {
      key: "sponsor-blitz", name: "Sponsorship Blitz", blurb: "30 days to your first paid brand deal.", icon: Handshake,
      projectName: "Sponsorship Blitz",
      concept: "A 30-day sponsorship blitz: media kit, 50 targeted pitches, and follow-up until someone says yes. Your first paid deal is a numbers game played well.",
      preload: [
        { step: "strategy", hint: "Pick 3 revenue streams · rank by speed to first dollar" },
        { step: "outreach", hint: "50 pitches in 30 days · personalize the first line" },
        { step: "deals", hint: "Price on value, not followers · start 20% higher than comfortable" },
      ],
    },
    {
      key: "merch-drop", name: "Merch Drop", blurb: "Design it, drop it, sell out.", icon: ShoppingBag,
      projectName: "Merch Drop",
      concept: "A merch drop built to sell out: 3 designs, limited run, 2-week promo runway. Scarcity + story = sold out.",
      preload: [
        { step: "merch", hint: "3 designs max · one hero piece" },
        { step: "brandingshop", hint: "Dropship — no inventory, no risk" },
        { step: "calculator", hint: "Price for 4x margin after fees" },
      ],
    },
    {
      key: "fan-stack", name: "Fan Revenue Stack", blurb: "Tips, shoutouts, and superfans paying monthly.", icon: Coins,
      projectName: "Fan Revenue Stack",
      concept: "A fan-monetization stack: tips, paid shoutouts, and a membership tier for superfans. A thousand true fans, monetized with respect.",
      preload: [
        { step: "tips", hint: "Pin your tip link on every platform" },
        { step: "shoutouts", hint: "Price shoutouts at 1% of monthly reach" },
        { step: "strategy", hint: "One membership tier · one irresistible perk" },
      ],
    },
  ],
  learn: [
    {
      key: "creator-basics", name: "Creator Business Basics", blurb: "The stuff nobody teaches you.", icon: GraduationCap,
      projectName: "Creator Business Basics",
      concept: "Learn the business of being a creator: how money actually flows, what to register, and what to avoid. The unsexy stuff that keeps you paid.",
      preload: [
        { step: "academy", hint: "Start with the money modules — revenue first" },
        { step: "guides", hint: "Read the sponsor-negotiation guide before your first pitch" },
      ],
    },
    {
      key: "copyright-crash", name: "Copyright Crash Course", blurb: "Protect everything you make.", icon: Scale,
      projectName: "Copyright Crash Course",
      concept: "A copyright crash course for creators: what you own automatically, what you must register, and how to handle thieves. Your catalog is an asset — treat it like one.",
      preload: [
        { step: "copyright", hint: "Register your top 10 works first" },
        { step: "detector", hint: "Scan for copies of your best-performing content monthly" },
      ],
    },
  ],
  business: [
    {
      key: "llc-pack", name: "LLC + Contracts Pack", blurb: "Get legit, get protected.", icon: Briefcase,
      projectName: "LLC + Contracts Pack",
      concept: "The legitimacy pack: form your LLC, lock your split sheets, and get contracts for every collab. Professionals get paid — amateurs get stories.",
      preload: [
        { step: "llc", hint: "Form before your first paid deal lands" },
        { step: "contracts", hint: "Split sheets on every collab, no exceptions" },
      ],
    },
    {
      key: "presskit-build", name: "Press Kit Build", blurb: "Look undeniable to brands and press.", icon: Newspaper,
      projectName: "Press Kit Build",
      concept: "A press kit that makes you undeniable: bio, stats, best work, and contact — packaged so brands and press say yes faster.",
      preload: [
        { step: "presskit", hint: "Lead with numbers · end with the story" },
        { step: "emaillist", hint: "Your list is the asset — start it with the press kit" },
      ],
    },
  ],
  clipper: [
    {
      key: "stream-clipper", name: "Stream Clipper", blurb: "Gaming's funniest 30 seconds, clipped daily.", icon: Gamepad2,
      projectName: "Stream Clipper",
      concept: "A stream-clipping brand: turn gaming streams into daily viral clips. Clutch plays, funny fails, and unhinged reactions — posted fast while the moment is hot. Speed + taste = the whole business.",
      preload: [
        { step: "niche", hint: "One game or one streamer circle — depth beats breadth" },
        { step: "brand", hint: "Watermark every clip · same caption font always" },
        { step: "clip", hint: "Clip within 24h of the stream — speed is the edge" },
        { step: "hooks", hint: "'He did WHAT?!' — reaction-style hooks win" },
        { step: "post", hint: "3–5 clips/day across TikTok, Reels, Shorts" },
        { step: "deals", hint: "Rev-share with the streamer once you pop their clips" },
      ],
    },
    {
      key: "podcast-clipper", name: "Podcast Clipper", blurb: "The quotable minute from every episode.", icon: Mic,
      projectName: "Podcast Clipper",
      concept: "A podcast-clipping brand: pull the single most quotable minute from every big episode. Hot takes, wild stories, mic-drop moments — packaged to travel without the 2-hour context.",
      preload: [
        { step: "niche", hint: "Comedy pods, finance pods, or interviews — pick one lane" },
        { step: "clip", hint: "The take, the story, the reaction — never the setup alone" },
        { step: "hooks", hint: "On-screen text carries the context the clip lacks" },
        { step: "post", hint: "Post the clip the day the episode drops" },
      ],
    },
    {
      key: "sports-clipper", name: "Sports Clipper", blurb: "The play everyone's talking about, first.", icon: Zap,
      projectName: "Sports Clipper",
      concept: "A sports-clipping brand: the insane play, the buzzer-beater, the brawl — clipped and posted before the broadcasters finish their highlight package. First + best angle wins.",
      preload: [
        { step: "niche", hint: "One league, one team, or one type of moment" },
        { step: "clip", hint: "Speed wins — post before the official accounts" },
        { step: "hooks", hint: "Score + clock on screen · let the play breathe" },
        { step: "deals", hint: "Betting + merch brands pay for sports audiences" },
      ],
    },
    {
      key: "drama-clipper", name: "Drama Clipper", blurb: "Internet beef, timestamped and captioned.", icon: MessageCircle,
      projectName: "Drama Clipper",
      concept: "A commentary/drama clipping brand: track the internet's messiest moments — beefs, apologies, and viral arguments — and package them with context people can't look away from.",
      preload: [
        { step: "niche", hint: "Creator drama, reality TV, or viral arguments" },
        { step: "clip", hint: "Context in the caption — new viewers need the lore fast" },
        { step: "hooks", hint: "'The timeline is NOT okay today' energy" },
        { step: "post", hint: "Threads-style multi-part for long sagas" },
      ],
    },
  ],
};

export function getTemplates(type: HubProjectType): HubTemplate[] {
  return HUB_TEMPLATES[type] ?? [];
}

export function getTemplate(type: HubProjectType, key: string | null | undefined): HubTemplate | undefined {
  if (!key) return undefined;
  return getTemplates(type).find((t) => t.key === key);
}
