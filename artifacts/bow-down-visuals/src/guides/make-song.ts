import type { PageGuide } from "./types";

export const makeSongGuide: PageGuide = {
  route: "/make-song",
  pageName: "Make a Song",
  summary:
    "Describe your vibe and let AI write the lyrics, hooks, and verses — then generate a full AI-produced track in your artist's locked voice.",
  steps: [
    {
      target: "main h1",
      title: "Your song starts here",
      body: "This page takes you from a rough idea to a finished song. You'll describe the vibe, AI writes the lyrics, and then you generate the actual track — vocals and beat.",
      tip: "Have your artist profile saved in the Artist Vault first — the song uses their locked voice automatically.",
      askPrompt: "Walk me through making my first song on this site",
    },
    {
      targetText: "Song Details",
      title: "Step 1 — Tell AI the vibe",
      body: "Fill in the song details: title idea, genre, mood, and what the song is about. The more specific you are, the better the lyrics. Think of it as briefing a co-writer.",
      tip: "Drop in a reference: 'like a late-night Drake record but faster' beats 'sad song' every time.",
    },
    {
      targetText: "Lyrics",
      title: "Step 2 — Generate the lyrics",
      body: "AI writes full structured lyrics — verses, chorus, bridge — tuned to your genre and mood. Don't love a line? Regenerate just that section until it hits.",
      tip: "Generate 2-3 lyric drafts and cherry-pick the best bars from each.",
    },
    {
      targetText: "Generate",
      title: "Step 3 — Produce the track",
      body: "Hit generate and AI produces the full song — vocals in your artist's locked voice over an AI-built beat. This is the credit-costing step, so make sure your lyrics are locked first.",
      tip: "Preview the lyrics out loud before generating — if it doesn't flow when you read it, it won't flow in the track.",
    },
  ],
};
