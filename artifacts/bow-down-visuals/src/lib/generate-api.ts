import type { FetchImpl } from "@/hooks/use-confirmed-api";

export function parseMarkdownSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = text.split(/^##\s+/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const newlineIdx = trimmed.indexOf("\n");
    if (newlineIdx === -1) continue;
    const heading = trimmed.slice(0, newlineIdx).trim().replace(/[*_`#]+/g, "");
    const content = trimmed.slice(newlineIdx + 1).trim();
    if (heading && content) {
      sections[heading] = content;
    }
  }
  return sections;
}

export interface GenerateResult {
  rawResult: string;
  sections: Record<string, string>;
  creditsRemaining?: number;
  creditsUsed?: number;
  genHistoryId?: string | null;
  thumbnailImageUrl?: string | null;
  imageError?: string | null;
}

export async function callGenerateApi(
  endpoint: string,
  body: Record<string, unknown>,
  token?: string | null,
  /** Pass confirmedFetch from useConfirmedApi() to confirm credit spend first. */
  fetchImpl: FetchImpl = fetch,
): Promise<GenerateResult | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res) return null; // user cancelled the credit confirmation

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    const errObj = err as { error?: string; message?: string };
    throw new Error(errObj.error ?? errObj.message ?? "Generation failed");
  }

  const data = (await res.json()) as {
    result: string;
    creditsRemaining?: number;
    creditsUsed?: number;
    genHistoryId?: string | null;
    thumbnailImageUrl?: string | null;
    imageError?: string | null;
  };
  return {
    rawResult:         data.result,
    sections:          parseMarkdownSections(data.result),
    creditsRemaining:  data.creditsRemaining,
    creditsUsed:       data.creditsUsed,
    genHistoryId:      data.genHistoryId ?? null,
    thumbnailImageUrl: data.thumbnailImageUrl ?? null,
    imageError:        data.imageError ?? null,
  };
}
