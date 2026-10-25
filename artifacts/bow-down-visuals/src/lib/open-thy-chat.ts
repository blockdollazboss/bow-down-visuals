/**
 * Ask-Thy chat opener (Stack-200, editor priority lane, item 186).
 *
 * This used to live inside components/ThyCheatCodeChat.tsx — a
 * 680-line component module — so every surface that only needed to
 * OPEN the chat (the video editor's "Ask Thy" button, the chat host)
 * dragged the entire chat UI and its dependencies into its own entry
 * chunk. The opener is a five-line event dispatch; it lives here so
 * importing it costs nothing. ThyCheatCodeChat re-exports it for
 * compatibility with existing import sites.
 */
export function openThyChat(prompt?: string) {
  window.dispatchEvent(
    new CustomEvent("thy-chat:open", { detail: { prompt } }),
  );
}
