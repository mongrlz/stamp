# STAMP receipt rendering

STAMP receipts are rendered as one high-resolution Canvas 2D surface rather than HTML text placed over a paper PNG.

## Production path

1. Draw a seeded, irregular torn-paper silhouette inside transparent canvas margins, then clip the generated thermal-paper texture into it.
2. Draw receipt ink, fingerprint values, dividers, barcode, and the rotated result stamp into the same pixel surface.
3. Use `globalCompositeOperation = "multiply"` while drawing the ink so the paper grain remains visible through it.
4. Add seeded, deterministic micro-offsets and opacity variation to soften perfectly digital edges without making receipt data unstable.
5. Keep a visually hidden HTML transcript beside the canvas so the receipt remains accessible to assistive technology.

The transparent canvas margin is intentional: it keeps the full deckled edge and alpha-aware drop shadow visible at narrow sidebar sizes without clipping the bottom corners.

The implementation is in `apps/web/src/receipt-canvas.tsx` and is used by live pool, archive, replay, and final-result receipts.

## Why not Chrome HTML-in-Canvas yet?

Chrome's `drawElementImage()` HTML-in-Canvas work is an experimental origin trial in Chrome 148–150. It is promising for rendering live DOM subtrees into canvas, but it is not a reliable production dependency for a public hackathon demo yet.

STAMP therefore uses the broadly available Canvas 2D APIs today. The experimental HTML-in-Canvas path can be reconsidered after it ships without flags or an origin-trial token.

## Sources

- [Chrome Developers: HTML-in-Canvas origin trial](https://developer.chrome.com/blog/html-in-canvas-origin-trial)
- [MDN: CanvasRenderingContext2D.globalCompositeOperation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation)
- [MDN: CanvasRenderingContext2D.drawImage](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage)
- [MDN: OffscreenCanvasRenderingContext2D](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvasRenderingContext2D)

## Local precedent

Looplings uses the same core pattern in `src/components/scenes/StarterRoomScene.tsx`: draw a complete receipt into a canvas, then treat the canvas as the stable visual texture. STAMP keeps that stable-surface model but renders directly in the web UI rather than mapping the canvas into Three.js.
