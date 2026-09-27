/**
 * Download an image from a URL.
 * Fetches as blob to handle CORS and force download with a proper filename.
 */
export async function downloadImage(url: string, filename?: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename || `bowdown-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    // Fallback: open in new tab if fetch fails (e.g. CORS)
    console.error("[downloadImage] fetch failed, opening in new tab:", err);
    window.open(url, "_blank");
  }
}
