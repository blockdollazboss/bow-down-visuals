/**
 * party-questions.ts — the Party Games trivia bank.
 *
 * Grown in the games upgrade from 36 to 153 questions (51 per
 * category): at 36, regulars saw repeats inside their first few
 * matches and Court Battle burned its 12-per-category pools almost
 * immediately. Selection also avoids each player's most recent match
 * (see lib/party-rooms.ts), so a full evening at the table stays
 * fresh far longer.
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
  {
    id: "m13",
    category: "music",
    prompt: "In 4/4 time, a whole note lasts how many beats?",
    choices: ["Two", "Three", "Four", "Six"],
    answer: 2,
  },
  {
    id: "m14",
    category: "music",
    prompt: "The trumpet belongs to which instrument family?",
    choices: ["Woodwind", "Brass", "Strings", "Percussion"],
    answer: 1,
  },
  {
    id: "m15",
    category: "music",
    prompt: "The speed of a song — how fast or slow it moves — is called its…?",
    choices: ["Tempo", "Timbre", "Pitch", "Meter"],
    answer: 0,
  },
  {
    id: "m16",
    category: "music",
    prompt: "Three musicians performing together are called a…?",
    choices: ["Duet", "Quartet", "Solo", "Trio"],
    answer: 3,
  },
  {
    id: "m17",
    category: "music",
    prompt: "A metronome helps a musician keep what steady?",
    choices: ["Pitch", "Tempo", "Volume", "Tuning"],
    answer: 1,
  },
  {
    id: "m18",
    category: "music",
    prompt: "How many lines are on a standard sheet-music staff?",
    choices: ["Four", "Six", "Five", "Eight"],
    answer: 2,
  },
  {
    id: "m19",
    category: "music",
    prompt: "Which of these is the lowest standard male singing voice?",
    choices: ["Soprano", "Alto", "Tenor", "Bass"],
    answer: 3,
  },
  {
    id: "m20",
    category: "music",
    prompt: "The words of a song are called its…?",
    choices: ["Melody", "Lyrics", "Harmony", "Rhythm"],
    answer: 1,
  },
  {
    id: "m21",
    category: "music",
    prompt: "What does an orchestra's conductor hold to lead the players?",
    choices: ["A bow", "A pick", "A baton", "A reed"],
    answer: 2,
  },
  {
    id: "m22",
    category: "music",
    prompt: "In music, 'crescendo' means gradually getting…?",
    choices: ["Faster", "Louder", "Softer", "Higher"],
    answer: 1,
  },
  {
    id: "m23",
    category: "music",
    prompt: "In music, the interval from the note C up to the note G is called a…?",
    choices: ["Third", "Fourth", "Sixth", "Fifth"],
    answer: 3,
  },
  {
    id: "m24",
    category: "music",
    prompt: "How many semitones (half steps) are there in one octave?",
    choices: ["Twelve", "Seven", "Eight", "Ten"],
    answer: 0,
  },
  {
    id: "m25",
    category: "music",
    prompt: "The lowest string on a standard four-string bass guitar is tuned to which note?",
    choices: ["A", "D", "E", "G"],
    answer: 2,
  },
  {
    id: "m26",
    category: "music",
    prompt: "Which of these is NOT part of a standard drum kit?",
    choices: ["Snare drum", "Hi-hat", "Kick drum", "Tuba"],
    answer: 3,
  },
  {
    id: "m27",
    category: "music",
    prompt: "A 'riff' in a song is best described as…?",
    choices: [
      "A short, catchy phrase that repeats",
      "The final chord of the song",
      "A mistake the band keeps in",
      "The silence before the chorus",
    ],
    answer: 0,
  },
  {
    id: "m28",
    category: "music",
    prompt: "An 'encore' at a concert is…?",
    choices: [
      "The opening act",
      "An extra performance the crowd calls for at the end",
      "A song played twice by accident",
      "The sound check before doors",
    ],
    answer: 1,
  },
  {
    id: "m29",
    category: "music",
    prompt: "The person who writes the words to a song is the…?",
    choices: ["Composer", "Producer", "Lyricist", "Arranger"],
    answer: 2,
  },
  {
    id: "m30",
    category: "music",
    prompt: "A concert harp is famous for having how many strings?",
    choices: ["12", "47", "6", "88"],
    answer: 1,
  },
  {
    id: "m31",
    category: "music",
    prompt: "In dance and hip-hop production, 'the drop' is the moment when…?",
    choices: [
      "The song ends",
      "The beat and bass kick in after a build-up",
      "The singer starts the first verse",
      "The track goes quiet for good",
    ],
    answer: 1,
  },
  {
    id: "m32",
    category: "music",
    prompt: "A 'cover' of a song is…?",
    choices: [
      "The album artwork",
      "A brand-new original song",
      "A new performance of an existing song",
      "A song with the words removed",
    ],
    answer: 2,
  },
  {
    id: "m33",
    category: "music",
    prompt: "A capo clamped on a guitar neck does what?",
    choices: [
      "Mutes the strings",
      "Raises the key by pressing the strings at a fret",
      "Adds an extra string",
      "Tunes the guitar by itself",
    ],
    answer: 1,
  },
  {
    id: "m34",
    category: "music",
    prompt: "How many players perform in a string quartet?",
    choices: ["Three", "Five", "Four", "Eight"],
    answer: 2,
  },
  {
    id: "m35",
    category: "music",
    prompt: "The main tune of a song — the part you hum — is its…?",
    choices: ["Harmony", "Melody", "Tempo", "Groove"],
    answer: 1,
  },
  {
    id: "m36",
    category: "music",
    prompt: "Singers with the highest standard voice type are called…?",
    choices: ["Altos", "Tenors", "Baritones", "Sopranos"],
    answer: 3,
  },
  {
    id: "m37",
    category: "music",
    prompt: "A lullaby is a song meant to…?",
    choices: [
      "Start a parade",
      "Help a child drift off to sleep",
      "Open a sporting match",
      "Teach a dance",
    ],
    answer: 1,
  },
  {
    id: "m38",
    category: "music",
    prompt: "A natural sign (♮) in sheet music does what?",
    choices: [
      "Cancels a sharp or flat",
      "Doubles the note's length",
      "Marks the loudest part",
      "Ends the song",
    ],
    answer: 0,
  },
  {
    id: "m39",
    category: "music",
    prompt: "Record speeds like 33 and 45 are measured in RPM — revolutions per…?",
    choices: ["Mile", "Meter", "Minute", "Measure"],
    answer: 2,
  },
  {
    id: "m40",
    category: "music",
    prompt: "Which keyboard instrument makes its sound with hammers striking strings?",
    choices: ["Harpsichord", "Piano", "Pipe organ", "Accordion"],
    answer: 1,
  },
  {
    id: "m41",
    category: "music",
    prompt: "A track with instruments only and no singing at all is called an…?",
    choices: ["A cappella", "Interlude", "Instrumental", "Intro"],
    answer: 2,
  },
  {
    id: "m42",
    category: "music",
    prompt: "Two songs blended together into one track make a…?",
    choices: ["Remix credit", "Mashup", "Medley poster", "Soundcheck"],
    answer: 1,
  },
  {
    id: "m43",
    category: "music",
    prompt: "Which of these is a percussion instrument?",
    choices: ["Flute", "Cello", "Oboe", "Tambourine"],
    answer: 3,
  },
  {
    id: "m44",
    category: "music",
    prompt: "In a mix, EQ mainly adjusts…?",
    choices: [
      "The balance of bass, mids and treble",
      "The song's tempo",
      "How many singers there are",
      "The length of the track",
    ],
    answer: 0,
  },
  {
    id: "m45",
    category: "music",
    prompt: "Reverb on a vocal makes it sound like it was recorded in…?",
    choices: ["A tiny closet", "A bigger, echoing space", "Underwater only", "Complete silence"],
    answer: 1,
  },
  {
    id: "m46",
    category: "music",
    prompt: "The largest, lowest member of the violin family — played standing upright — is the…?",
    choices: ["Viola", "Cello", "Double bass", "Violin"],
    answer: 2,
  },
  {
    id: "m47",
    category: "music",
    prompt: "A song in a minor key is most often described as sounding…?",
    choices: [
      "Brighter and happier than major",
      "Sadder or darker than major",
      "Exactly like a major key",
      "Louder than a major key",
    ],
    answer: 1,
  },
  {
    id: "m48",
    category: "music",
    prompt: "An 'unplugged' performance means the musicians play…?",
    choices: [
      "Without any instruments",
      "Only brand-new songs",
      "On acoustic instruments, without electric amplification",
      "Facing away from the crowd",
    ],
    answer: 2,
  },
  {
    id: "m49",
    category: "music",
    prompt: "In 4/4, the accented beats 2 and 4 that hands clap along to are called the…?",
    choices: ["Downbeat", "Backbeat", "Offbeat", "Upbeat rest"],
    answer: 1,
  },
  {
    id: "m50",
    category: "music",
    prompt: "'Sampling' in music production means…?",
    choices: [
      "Trying a song before buying it",
      "Playing every instrument yourself",
      "Recording in a very small room",
      "Building a new track around a piece of an existing recording",
    ],
    answer: 3,
  },
  {
    id: "m51",
    category: "music",
    prompt: "Pitch-correction software on a vocal recording fixes notes that are…?",
    choices: ["Too quiet", "Out of tune", "Too fast", "Too long"],
    answer: 1,
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
  {
    id: "c13",
    category: "creator",
    prompt: "In video, 'FPS' measures…?",
    choices: ["File size per second", "Frames per second", "Focus points per shot", "Fans per stream"],
    answer: 1,
  },
  {
    id: "c14",
    category: "creator",
    prompt: "A 1080p frame is how many pixels tall?",
    choices: ["720", "1080", "1440", "2160"],
    answer: 1,
  },
  {
    id: "c15",
    category: "creator",
    prompt: "4K video carries roughly how many times the pixels of 1080p?",
    choices: ["Twice", "Three times", "Four times", "Eight times"],
    answer: 2,
  },
  {
    id: "c16",
    category: "creator",
    prompt: "A gimbal's job for a camera is to…?",
    choices: [
      "Zoom in automatically",
      "Keep the shot steady and smooth while moving",
      "Add filters to the footage",
      "Record the audio",
    ],
    answer: 1,
  },
  {
    id: "c17",
    category: "creator",
    prompt: "The 'rule of thirds' helps you compose a shot by…?",
    choices: [
      "Using exactly three lights",
      "Filming for three seconds",
      "Placing subjects along the grid lines of a 3×3 frame",
      "Posting three times a day",
    ],
    answer: 2,
  },
  {
    id: "c18",
    category: "creator",
    prompt: "A 'cold open' starts a video by…?",
    choices: [
      "Jumping straight into the action before any titles",
      "Showing the credits first",
      "Blacking out the screen",
      "Asking for likes before anything happens",
    ],
    answer: 0,
  },
  {
    id: "c19",
    category: "creator",
    prompt: "A teleprompter lets a presenter…?",
    choices: [
      "Edit while filming",
      "Read a script while looking into the camera",
      "Stream to two rooms at once",
      "Hide the microphone",
    ],
    answer: 1,
  },
  {
    id: "c20",
    category: "creator",
    prompt: "Of everyone who saw your thumbnail, the share who clicked play is your…?",
    choices: ["Watch time", "Retention", "Click-through rate", "Impression count"],
    answer: 2,
  },
  {
    id: "c21",
    category: "creator",
    prompt: "On a live stream, a 'raid' is when a streamer…?",
    choices: [
      "Deletes a viewer's account",
      "Sends their viewers over to another creator's stream",
      "Restarts the stream",
      "Raises the price of a shout-out",
    ],
    answer: 1,
  },
  {
    id: "c22",
    category: "creator",
    prompt: "'Dead air' on a stream means…?",
    choices: [
      "The chat is closed",
      "The camera is off but audio plays",
      "A stretch where nothing is happening and nobody is talking",
      "The stream reached its time limit",
    ],
    answer: 2,
  },
  {
    id: "c23",
    category: "creator",
    prompt: "A creator's media kit is used to show brands…?",
    choices: [
      "Their home address",
      "Their audience, stats and rates",
      "Their passwords",
      "Their unposted drafts",
    ],
    answer: 1,
  },
  {
    id: "c24",
    category: "creator",
    prompt: "'Room tone' in audio recording is…?",
    choices: [
      "The natural background sound of a space, captured for editing",
      "A ringtone for the studio",
      "The loudest note in the room",
      "Music played between takes",
    ],
    answer: 0,
  },
  {
    id: "c25",
    category: "creator",
    prompt: "Color grading a video means…?",
    choices: [
      "Sorting clips by file name",
      "Adjusting its colors and mood in post-production",
      "Adding the captions",
      "Choosing the thumbnail",
    ],
    answer: 1,
  },
  {
    id: "c26",
    category: "creator",
    prompt: "An editor's 'timeline' is where…?",
    choices: [
      "The finished video is sold",
      "Comments arrive in order",
      "Clips are arranged in the order they play",
      "The script is written",
    ],
    answer: 2,
  },
  {
    id: "c27",
    category: "creator",
    prompt: "A 'lower third' on screen is…?",
    choices: [
      "The bottom-priced ad slot",
      "The graphic band that shows a name or title near the bottom",
      "The last third of the video",
      "A smaller second camera",
    ],
    answer: 1,
  },
  {
    id: "c28",
    category: "creator",
    prompt: "'Aspect ratio' describes a frame's…?",
    choices: ["Brightness", "File weight", "Width-to-height proportion", "Frame rate"],
    answer: 2,
  },
  {
    id: "c29",
    category: "creator",
    prompt: "Vertical short-form video is usually framed at which ratio?",
    choices: ["16:9", "9:16", "4:3", "1:1 only"],
    answer: 1,
  },
  {
    id: "c30",
    category: "creator",
    prompt: "'Evergreen' content is content that…?",
    choices: [
      "Is filmed outdoors",
      "Stays useful and watchable for a long time",
      "Only works during holidays",
      "Must be reposted daily",
    ],
    answer: 1,
  },
  {
    id: "c31",
    category: "creator",
    prompt: "A call to action at the end of a video asks viewers to…?",
    choices: [
      "Do one specific next thing — subscribe, comment, buy",
      "Leave the page quietly",
      "Guess the next upload",
      "Turn the volume down",
    ],
    answer: 0,
  },
  {
    id: "c32",
    category: "creator",
    prompt: "'Batching' content means…?",
    choices: [
      "Deleting old videos in bulk",
      "Making several pieces in one focused session",
      "Posting the same video everywhere twice",
      "Buying views in lots",
    ],
    answer: 1,
  },
  {
    id: "c33",
    category: "creator",
    prompt: "A storyboard lays out a video as…?",
    choices: [
      "A list of sponsors",
      "The planned shots, frame by frame, before filming",
      "A table of upload times",
      "The comment highlights",
    ],
    answer: 1,
  },
  {
    id: "c34",
    category: "creator",
    prompt: "Thumbnail text works best when it is…?",
    choices: [
      "A full sentence in small type",
      "Hidden in a corner",
      "Big, few words, readable on a small phone screen",
      "The same words as the title",
    ],
    answer: 2,
  },
  {
    id: "c35",
    category: "creator",
    prompt: "The final quality check before posting should always be to…?",
    choices: [
      "Count the hashtags",
      "Watch the exported video start to finish once",
      "Change the title",
      "Post a teaser first",
    ],
    answer: 1,
  },
  {
    id: "c36",
    category: "creator",
    prompt: "A creator's 'niche' is…?",
    choices: [
      "Their most expensive camera",
      "The focused topic and audience they serve",
      "A secret folder of drafts",
      "The corner where they film",
    ],
    answer: 1,
  },
  {
    id: "c37",
    category: "creator",
    prompt: "In a brand deal, 'deliverables' are…?",
    choices: [
      "The specific posts or videos the creator agreed to make",
      "The brand's shipping boxes",
      "The creator's travel plans",
      "Comments from fans",
    ],
    answer: 0,
  },
  {
    id: "c38",
    category: "creator",
    prompt: "'Usage rights' in a brand deal decide…?",
    choices: [
      "Which camera the creator must use",
      "How and how long the brand may use the creator's content",
      "The video's title",
      "Who hosts the premiere",
    ],
    answer: 1,
  },
  {
    id: "c39",
    category: "creator",
    prompt: "Setting an upload as a 'premiere' means it…?",
    choices: [
      "Can only be watched once",
      "Plays live at a set time with the audience watching together, then stays up",
      "Skips the thumbnail",
      "Posts to every page at once",
    ],
    answer: 1,
  },
  {
    id: "c40",
    category: "creator",
    prompt: "'Engagement' on a post measures…?",
    choices: [
      "How long the video took to render",
      "The file size",
      "How viewers interact — likes, comments, shares, watch time",
      "The price of the camera",
    ],
    answer: 2,
  },
  {
    id: "c41",
    category: "creator",
    prompt: "Turning one video into a series mainly helps a channel because…?",
    choices: [
      "Each part is easier to film badly",
      "Viewers come back for the next part",
      "The algorithm demands exactly three parts",
      "Series never need thumbnails",
    ],
    answer: 1,
  },
  {
    id: "c42",
    category: "creator",
    prompt: "A video's metadata includes its…?",
    choices: ["Title, description and tags", "Camera brand", "Filming weather", "Edit count"],
    answer: 0,
  },
  {
    id: "c43",
    category: "creator",
    prompt: "A green screen is used so an editor can…?",
    choices: [
      "Make the subject glow",
      "Replace the background behind the subject",
      "Hide the microphone",
      "Film at night",
    ],
    answer: 1,
  },
  {
    id: "c44",
    category: "creator",
    prompt: "Editors keep 'handles' — extra footage at a clip's ends — so they can…?",
    choices: [
      "Sell the leftovers",
      "Trim and blend transitions without running out of footage",
      "Make the video longer for free",
      "Skip the color pass",
    ],
    answer: 1,
  },
  {
    id: "c45",
    category: "creator",
    prompt: "A lavalier microphone is…?",
    choices: [
      "A giant studio microphone",
      "A microphone built into the camera",
      "A small microphone clipped to clothing",
      "A speaker for the audience",
    ],
    answer: 2,
  },
  {
    id: "c46",
    category: "creator",
    prompt: "For outdoor filming, 'golden hour' is prized because…?",
    choices: [
      "The light is soft and warm near sunrise and sunset",
      "Fewer people are awake",
      "Cameras charge faster",
      "The wind stops",
    ],
    answer: 0,
  },
  {
    id: "c47",
    category: "creator",
    prompt: "Streamers commonly keep a second screen open to…?",
    choices: [
      "Watch a rival's stream",
      "Read chat without covering their content",
      "Charge their phone",
      "Show two angles at once",
    ],
    answer: 1,
  },
  {
    id: "c48",
    category: "creator",
    prompt: "A 'VOD' is…?",
    choices: [
      "A very loud microphone",
      "The saved recording of a stream, watchable on demand",
      "A type of camera lens",
      "A viewer's donation badge",
    ],
    answer: 1,
  },
  {
    id: "c49",
    category: "creator",
    prompt: "Captions on a video mainly help viewers who…?",
    choices: [
      "Watch with the sound off or can't hear the audio",
      "Have the biggest screens",
      "Skip every intro",
      "Only read comments",
    ],
    answer: 0,
  },
  {
    id: "c50",
    category: "creator",
    prompt: "A channel trailer's whole job is to…?",
    choices: [
      "Show every video ever made",
      "Apologize for the upload schedule",
      "Turn a first-time visitor into a subscriber",
      "Hide the older videos",
    ],
    answer: 2,
  },
  {
    id: "c51",
    category: "creator",
    prompt: "For a clean voice recording, the mic usually sits…?",
    choices: [
      "Across the room",
      "A few inches from the mouth, slightly off to the side",
      "Behind the speaker",
      "Inside a closed drawer",
    ],
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
  {
    id: "g13",
    category: "general",
    prompt: "How many days are there in a leap year?",
    choices: ["365", "366", "364", "360"],
    answer: 1,
  },
  {
    id: "g14",
    category: "general",
    prompt: "What is the capital of France?",
    choices: ["London", "Berlin", "Paris", "Madrid"],
    answer: 2,
  },
  {
    id: "g15",
    category: "general",
    prompt: "Which gas do plants take in from the air to make their food?",
    choices: ["Oxygen", "Carbon dioxide", "Helium", "Nitrogen gas only"],
    answer: 1,
  },
  {
    id: "g16",
    category: "general",
    prompt: "How many legs does a spider have?",
    choices: ["Six", "Ten", "Eight", "Twelve"],
    answer: 2,
  },
  {
    id: "g17",
    category: "general",
    prompt: "The largest mammal on Earth is the…?",
    choices: ["African elephant", "Blue whale", "Giraffe", "Polar bear"],
    answer: 1,
  },
  {
    id: "g18",
    category: "general",
    prompt: "At sea level, water boils at what temperature in Celsius?",
    choices: ["90 degrees", "80 degrees", "120 degrees", "100 degrees"],
    answer: 3,
  },
  {
    id: "g19",
    category: "general",
    prompt: "How many colors are classically counted in a rainbow?",
    choices: ["Five", "Six", "Seven", "Nine"],
    answer: 2,
  },
  {
    id: "g20",
    category: "general",
    prompt: "Which metal is a liquid at room temperature?",
    choices: ["Iron", "Mercury", "Copper", "Tin"],
    answer: 1,
  },
  {
    id: "g21",
    category: "general",
    prompt: "What is the currency of Japan?",
    choices: ["Won", "Yuan", "Ringgit", "Yen"],
    answer: 3,
  },
  {
    id: "g22",
    category: "general",
    prompt: "In soccer, how many players of one team are on the field at the start of a match?",
    choices: ["Nine", "Ten", "Eleven", "Twelve"],
    answer: 2,
  },
  {
    id: "g23",
    category: "general",
    prompt: "The Great Wall stretches across which country?",
    choices: ["Japan", "China", "India", "Mongolia only"],
    answer: 1,
  },
  {
    id: "g24",
    category: "general",
    prompt: "How many minutes are there in a full day?",
    choices: ["1,440", "1,200", "1,600", "960"],
    answer: 0,
  },
  {
    id: "g25",
    category: "general",
    prompt: "Which organ pumps blood around the human body?",
    choices: ["Liver", "Lung", "Heart", "Kidney"],
    answer: 2,
  },
  {
    id: "g26",
    category: "general",
    prompt: "The tallest land animal in the world is the…?",
    choices: ["Horse", "Giraffe", "Camel", "Moose"],
    answer: 1,
  },
  {
    id: "g27",
    category: "general",
    prompt: "How many vowels are in the English alphabet?",
    choices: ["Four", "Six", "Seven", "Five"],
    answer: 3,
  },
  {
    id: "g28",
    category: "general",
    prompt: "The main ingredient in guacamole is…?",
    choices: ["Tomato", "Avocado", "Onion", "Pepper"],
    answer: 1,
  },
  {
    id: "g29",
    category: "general",
    prompt: "What force pulls objects toward the Earth?",
    choices: ["Magnetism", "Friction", "Gravity", "Inertia"],
    answer: 2,
  },
  {
    id: "g30",
    category: "general",
    prompt: "How many grams make one kilogram?",
    choices: ["100", "500", "1,000", "10,000"],
    answer: 2,
  },
  {
    id: "g31",
    category: "general",
    prompt: "The Moon orbits which planet?",
    choices: ["Mars", "Earth", "Venus", "Jupiter"],
    answer: 1,
  },
  {
    id: "g32",
    category: "general",
    prompt: "A baby frog is called a…?",
    choices: ["Tadpole", "Froglet egg", "Newt", "Polyp"],
    answer: 0,
  },
  {
    id: "g33",
    category: "general",
    prompt: "Which season follows summer?",
    choices: ["Spring", "Winter", "Autumn", "Monsoon"],
    answer: 2,
  },
  {
    id: "g34",
    category: "general",
    prompt: "An octagon has how many sides?",
    choices: ["Six", "Seven", "Nine", "Eight"],
    answer: 3,
  },
  {
    id: "g35",
    category: "general",
    prompt: "Which river is generally counted the longest in the world?",
    choices: ["Danube", "Nile", "Yangtze", "Mississippi"],
    answer: 1,
  },
  {
    id: "g36",
    category: "general",
    prompt: "The hardest naturally occurring substance on Earth is…?",
    choices: ["Gold", "Iron", "Diamond", "Quartz"],
    answer: 2,
  },
  {
    id: "g37",
    category: "general",
    prompt: "A typical adult human has how many teeth?",
    choices: ["28", "30", "32", "36"],
    answer: 2,
  },
  {
    id: "g38",
    category: "general",
    prompt: "Which flightless bird swims in cold southern seas?",
    choices: ["Ostrich", "Penguin", "Kiwi", "Emu"],
    answer: 1,
  },
  {
    id: "g39",
    category: "general",
    prompt: "What is the square root of 144?",
    choices: ["14", "16", "11", "12"],
    answer: 3,
  },
  {
    id: "g40",
    category: "general",
    prompt: "Egypt sits mainly on which continent?",
    choices: ["Asia", "Africa", "Europe", "South America"],
    answer: 1,
  },
  {
    id: "g41",
    category: "general",
    prompt: "The biggest planet in our solar system is…?",
    choices: ["Saturn", "Neptune", "Jupiter", "Uranus"],
    answer: 2,
  },
  {
    id: "g42",
    category: "general",
    prompt: "The three angles of any triangle add up to how many degrees?",
    choices: ["90", "180", "270", "360"],
    answer: 1,
  },
  {
    id: "g43",
    category: "general",
    prompt: "Which is the smallest ocean on Earth?",
    choices: ["Indian", "Atlantic", "Arctic", "Pacific"],
    answer: 2,
  },
  {
    id: "g44",
    category: "general",
    prompt: "A caterpillar grows up to become a…?",
    choices: ["Beetle", "Butterfly", "Bee", "Ant"],
    answer: 1,
  },
  {
    id: "g45",
    category: "general",
    prompt: "How many hours are there in one week?",
    choices: ["148", "160", "168", "172"],
    answer: 2,
  },
  {
    id: "g46",
    category: "general",
    prompt: "Which instrument is used to measure temperature?",
    choices: ["Barometer", "Thermometer", "Speedometer", "Altimeter"],
    answer: 1,
  },
  {
    id: "g47",
    category: "general",
    prompt: "What is the capital of Canada?",
    choices: ["Toronto", "Vancouver", "Ottawa", "Montreal"],
    answer: 2,
  },
  {
    id: "g48",
    category: "general",
    prompt: "A group of wolves is called a…?",
    choices: ["Herd", "Pack", "Swarm", "Flock"],
    answer: 1,
  },
  {
    id: "g49",
    category: "general",
    prompt: "Which of these numbers is prime?",
    choices: ["4", "6", "9", "7"],
    answer: 3,
  },
  {
    id: "g50",
    category: "general",
    prompt: "Ice is water in which state of matter?",
    choices: ["Gas", "Liquid", "Solid", "Plasma"],
    answer: 2,
  },
  {
    id: "g51",
    category: "general",
    prompt: "The first day of the year is celebrated as…?",
    choices: ["New Year's Day", "Coronation Day", "Harvest Day", "Founders' Day"],
    answer: 0,
  },
];

/** Questions for one category, in bank order. */
export function questionsForCategory(category: PartyCategory): PartyQuestion[] {
  return PARTY_QUESTIONS.filter((q) => q.category === category);
}

/** Bank self-check used by the integrity tests (and cheap to re-run
 *  anywhere): every question well-formed, ids/prompts unique, each
 *  category carrying at least 40 questions, at least 150 overall —
 *  the floors the games upgrade set so the bank can't quietly shrink
 *  back to repeat-city. */
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
    if ((perCategory.get(cat) ?? 0) < 40) problems.push(`category ${cat} has fewer than 40 questions`);
  }
  if (bank.length < 150) problems.push("bank has fewer than 150 questions");
  return problems;
}
