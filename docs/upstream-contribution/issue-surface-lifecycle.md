Title: bug: redundant surface resize and font callbacks bypass canvas scheduling

### What happened?

The surface manager recreates a surface for unchanged or zero dimensions. A font completion callback also invokes `renderNow()` synchronously; when it occurs inside a draw, drawing reenters. Separately, `markDirty()` can enqueue work after the render loop has been paused during disposal.

The attached mocked diagnostic demonstrates these lifecycle contracts at the current source SHA. It does not establish how often they occur in a browser or prove a visible flicker on a particular GPU.

### Platform

Web / Vue SDK. Diagnostic: Bun 1.4.2, macOS arm64.

### Steps to reproduce

Run `bun run probe-lifecycle.ts /absolute/path/to/checkout` in a fresh process. It creates a synthetic 300×200 canvas with a mocked surface factory, resizes to the same size and then zero width, invokes a font completion during drawing, and calls `markDirty()` after `pause()`.

### Affected area

Canvas rendering / Vue surface lifecycle.

### Version or build

`6a05e30f15398de70d36deda011003b4347d1627`.

### Files, screenshots, or links

Attach `probe-lifecycle.ts`. `repaint-fit-tile.fig` is optional for a follow-up browser resize/page-switch test; the deterministic lifecycle diagnostic does not require it.

### Console output or logs

```json
{
  "framesAfterPause": 1,
  "surfacesForSameSize": 1,
  "surfacesForZeroSize": 1,
  "maximumFontCallbackRenderDepth": 2
}
```

Expected: `0, 0, 0, 1`. A downstream source patch produces those expected values with the same harness. The CanvasKit-only patch does not change these results.

### Proposed direction

Retain the existing rAF resize throttle. Skip zero dimensions and an unchanged physical pixel size when a renderer already exists. Schedule font completion through the existing render scheduler, preserve the explicit immediate draw needed after real surface replacement, and make terminal disposal reject late scheduling.

### Before submitting

Related #823 addresses missing canvas initialization, and #432/#433 address UI remounting and oversized retained backing. Inspect their current discussions before reporting this narrower lifecycle behavior. Split scheduling/disposal from resize into separate PRs if maintainers prefer.
