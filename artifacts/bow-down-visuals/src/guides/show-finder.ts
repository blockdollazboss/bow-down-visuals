import type { PageGuide } from "./types";

export const showFinderGuide: PageGuide = {
  route: "/shows",
  pageName: "Show Finder",
  summary:
    "Thy Cheat Code's talent scout: AI-curated open mics, showcases, festivals, and gigs matched to your city and genre — plus a pitch draft for every stage.",
  steps: [
    {
      target: "main h1",
      title: "Stop waiting to be discovered",
      body: "The Show Finder hunts down performance opportunities that fit your city, genre, and goals — open mics to build your live muscle, showcases to get industry eyes on you, festivals for the long game.",
      tip: "Open mics first, showcases second, festivals third. That's the ladder.",
      askPrompt: "How should I use the Show Finder to get my first gigs?",
    },
    {
      targetText: "What are you hunting?",
      title: "Step 1 — Set your hunt",
      body: "Tell the scout where you are, your genre, and which opportunity types you want. The more honest your bio, the better the matches — the why-fit on each result is written for YOU.",
      tip: "Start with a 90-day window and 2-3 opportunity types. Narrow beats spray-and-pray.",
    },
    {
      targetText: "Why it's a fit",
      title: "Step 2 — Work the results",
      body: "Each stage card tells you why it's a fit, exactly how to apply, and what to verify before you commit. Dates and submission details change — always confirm on the organizer's official page.",
      tip: "Apply to 5 stages a week. Booking is a numbers game with a quality filter.",
    },
    {
      targetText: "Draft my pitch",
      title: "Step 3 — Pitch every stage",
      body: "One credit drafts a booking pitch tuned to that specific opportunity — subject line, body, and what to attach. Copy it, personalize the opener, and send it the same day.",
      tip: "Always attach a live video. Bookers book what they can see.",
    },
  ],
};
