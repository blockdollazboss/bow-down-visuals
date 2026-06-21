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

export async function callGenerateApi(
  endpoint: string,
  body: Record<string, unknown>
): Promise<Record<string, string>> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as { error?: string }).error ?? "Generation failed");
  }
  const data = (await res.json()) as { result: string };
  return parseMarkdownSections(data.result);
}
