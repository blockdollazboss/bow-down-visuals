/* Beat Maker now lives inside the AI Audio hub (pages/ai-audio.tsx, "beats" tab).
   This shim keeps `import { BeatMakerModule } from "./beat-maker"` working
   (used by pages/hub.tsx). The /beat-maker route redirects to /ai-audio?tab=beats. */
export { BeatMakerModule } from "./ai-audio";
export { default } from "./ai-audio";
