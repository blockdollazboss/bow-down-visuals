import type { PageGuide } from "./types";

export const makeVideoGuide: PageGuide = {
  route: "/make-video",
  pageName: "Make a Music Video",
  summary:
    "Turn your song into a full video plan — AI treatment, scene storyboards, and generated clips with your artist's face locked in.",
  steps: [
    {
      target: "main h1",
      title: "From song to screen",
      body: "This is the video pipeline: pick your song, set the direction, get an AI treatment and storyboard, then generate actual video clips scene by scene.",
      tip: "The plan step is cheap — spend your credits on clips only for scenes you love.",
      askPrompt: "How do I make a music video from my song?",
    },
    {
      targetText: "Song Setup",
      title: "Step 1 — Song Setup",
      body: "Choose the song this video is for. The AI reads your lyrics and mood to shape every scene — the video is built around YOUR song, not a generic template.",
      tip: "Upload or pick a finished song — videos planned around final audio sync better.",
    },
    {
      targetText: "Artist / Brand",
      title: "Step 2 — Artist / Brand",
      body: "Pick which artist profile stars in the video. Their locked face reference keeps them looking consistent across every generated clip — no morphing between scenes.",
      tip: "No profile yet? Create one in the Artist Vault with 3-5 clear photos first.",
    },
    {
      targetText: "Video Direction",
      title: "Step 3 — Video Direction",
      body: "Set the visual direction: style, locations, color palette, camera energy. This is your director's brief — the AI treats it like gospel when building scenes.",
      tip: "Name a visual reference: 'Euphoria-style neon night scenes' gives the AI a real target.",
    },
    {
      targetText: "Create Your Video Plan",
      title: "Step 4 — Generate the plan",
      body: "AI writes your full treatment and scene-by-scene storyboard. Review it like a director — reorder scenes, tweak shots, cut what doesn't serve the song.",
      tip: "Read the plan against your lyrics — every scene should earn its place in the song.",
    },
    {
      targetText: "Your Scene Clips",
      title: "Step 5 — Generate clips",
      body: "Generate video clips per scene with your artist's face locked in. Start with your hero scenes — the chorus visuals carry the whole video.",
      tip: "Generate the chorus scene first. If that clip is fire, the rest will follow.",
    },
    {
      targetText: "Download & Share",
      title: "Step 6 — Download & Share",
      body: "Export your finished video and grab share-ready versions for every platform. Your video is done — now go promote it.",
      tip: "Export in 9:16 too — vertical is where the views live.",
    },
  ],
};
