/* share-drop.ts — one-tap sharing for digital drops.
   "Build every output to travel": every drop page ships with attribution and
   a share action so buyers spread the creator's link, not a dead end. */

export async function shareDrop(opts: { title: string; text: string; url: string }): Promise<"shared" | "copied" | "failed"> {
  const absolute = opts.url.startsWith("http") ? opts.url : `${window.location.origin}${opts.url}`;
  const data = { title: opts.title, text: opts.text, url: absolute };
  try {
    if (navigator.share) {
      await navigator.share(data);
      return "shared";
    }
  } catch {
    /* User cancelled the share sheet — treat as a no-op, not a failure. */
    return "failed";
  }
  try {
    await navigator.clipboard.writeText(absolute);
    return "copied";
  } catch {
    return "failed";
  }
}
