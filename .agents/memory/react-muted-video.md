---
name: React muted video prop bug
description: React's muted JSX prop doesn't propagate to the DOM video element — only works via imperative ref.
---

The `muted` prop on `<video>` in React is a known bug — NOT reflected to the DOM `muted` property.
Video `.play()` calls will be blocked by browser autoplay policy unless `muted` is set imperatively.

**Why:** React's prop reconciler skips the `muted` attribute in its DOM patching.

**How to apply:** Use a callback ref:
```tsx
const videoRef = useRef<HTMLVideoElement | null>(null);
const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
  videoRef.current = el;
  if (el) el.muted = true;
}, []);
// Also set el.muted = true before every .play() call
```
Use `ref={setVideoRef}` on the `<video>` element instead of `ref={videoRef}`.
