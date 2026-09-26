import type { PageGuide } from "./types";

export const artistVaultGuide: PageGuide = {
  route: "/artist-vault",
  pageName: "Artist Vault",
  summary:
    "Your artists' home base. Save profiles with photos and locked voices so every song and video the AI makes sounds and looks like them.",
  steps: [
    {
      target: "main h1",
      title: "Your artists live here",
      body: "The Artist Vault stores everything the AI needs to keep your artist consistent: their look, their voice, their vibe. Set it up once — every song and video uses it automatically.",
      tip: "This is the highest-leverage page on the site. 10 minutes here saves you hours of fixing inconsistent generations later.",
      askPrompt: "How does the Artist Vault work and why does it matter?",
    },
    {
      targetText: "Create",
      title: "Step 1 — Create a profile",
      body: "Add your artist: name, genre, style notes, and photos. The photos become the face reference that keeps them identical across every video clip and thumbnail.",
      tip: "Upload 3-5 clear, front-facing photos with different expressions — the AI builds a better face lock from variety.",
    },
    {
      targetText: "Saved Profiles",
      title: "Step 2 — Manage profiles",
      body: "All your saved artists live here. Edit details anytime, set one as active, and every generation across the site will use the active profile by default.",
      tip: "One active profile at a time — switch before generating so the right artist stars in your content.",
    },
    {
      targetText: "Voice",
      title: "Step 3 — Lock the voice",
      body: "Clone your artist's voice from a recording or pick from the library. Once locked, every song you generate is automatically vocal-swapped to sound like them.",
      tip: "Use a clean 30-second vocal recording — no background music — for the best clone.",
    },
  ],
};
