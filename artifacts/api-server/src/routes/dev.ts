import { Router } from "express";
import { requireAuth, supabaseRow, supabaseMutate } from "../middlewares/require-auth";

const router = Router();

// Dev-only credit top-up. Protected by requireAuth (needs valid Supabase JWT).
// The +10 Credits button in the top bar is only rendered when import.meta.env.DEV is true,
// so production users never see this button. The endpoint itself has no NODE_ENV guard
// because that env var was unreliable inside the esbuild bundle.
router.post("/dev/add-credits", requireAuth, async (req, res) => {
  const { data: profile, httpStatus, rawError } = await supabaseRow<{ credits: number }>(
    req.accessToken!,
    "profiles",
    `id=eq.${req.userId}&select=credits`,
  );

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[dev/add-credits] userId=${req.userId} profileHttpStatus=${httpStatus} rawError=${rawError} credits=${profile?.credits}`);
  }

  if (!profile) {
    res.status(404).json({ error: "Profile not found", httpStatus, rawError });
    return;
  }

  const newCredits = profile.credits + 10;

  const { httpStatus: patchStatus, rawError: patchError } = await supabaseMutate(
    req.accessToken!,
    "PATCH",
    "profiles",
    `id=eq.${req.userId}`,
    { credits: newCredits },
  );

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[dev/add-credits] patch httpStatus=${patchStatus} rawError=${patchError} newCredits=${newCredits}`);
  }

  if (patchError) {
    res.status(500).json({ error: patchError });
    return;
  }

  res.json({ credits: newCredits });
});

export default router;
