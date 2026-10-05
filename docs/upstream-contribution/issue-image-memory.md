Title: bug: image-heavy .fig files exhaust CanvasKit memory while rendering

### What happened?

Opening an image-heavy `.fig` can abort CanvasKit while rendering the first page. I expected the document to render and remain usable when switching pages and zooming.

The public reproduction contains 262 distinct JPEGs and approximately 400 MiB of actual embedded image data. The reporter has confirmed that this file reproduces the problem. A clean browser parser/WebGL renderer diagnostic also reproduces the allocation failure at upstream commit `a50444c265f51c5d3af0bcef507192a4b3e1cbdd`.

`SkiaRenderer.imageCache` retains decoded full-resolution images without a byte budget. `applyImageFill()` also creates mipmaps, and retained scene pictures can keep native image references alive. This is separate from shader handle disposal already fixed by [PR #868](https://github.com/open-pencil/open-pencil/pull/868).

### Platform

Web / CanvasKit WebGL renderer. Diagnostic environment: macOS arm64, Chrome 154, ANGLE Metal Apple M1 Max, DPR 1.

### Steps to reproduce

1. Build and start upstream commit `a50444c265f51c5d3af0bcef507192a4b3e1cbdd` with its frozen dependencies.
2. Open the public `image-heavy-400mib.fig` provided with this report.
3. Zoom to fit the first page. Observe the CanvasKit abort during rendering.
4. If rendering succeeds on another device, visit all three pages, alternate pages and zoom while monitoring memory and console errors.

The isolated diagnostic parses all pages and renders through `renderFromEditorState()`. It does not initialize application storage, autosave or collaboration. Its measurements are renderer evidence; they do not independently validate the entire application import path or Figma import.

### Affected area

Canvas rendering; image decoding after `.fig` import.

### Version or build

Upstream master `a50444c265f51c5d3af0bcef507192a4b3e1cbdd` (package version 0.15.1).

### Browser (web only)

Chrome 154 in the diagnostic. Add the browser/OS used for your own application reproduction if different.

### Files, screenshots, or links

I will attach or link the public reproduction `.fig` manually. It was built from a fresh graph and freely reusable CC0 images from [The Met Open Access](https://www.metmuseum.org/hubs/open-access), without confidential design data. The source inventory includes image URLs, licenses and hashes.

- FIG size: 420,822,973 bytes (401.3 MiB).
- Embedded JPEGs: 262 distinct images, totaling 420,741,689 bytes.
- Three pages: 88 / 88 / 86 image nodes.
- FIG SHA-256: `36b759d00fe266d074620af0cbf619e5c090c8da29c74947358b422bca9d78ea`.

For a file this large, provide an accessible download link if the issue attachment UI refuses it. A 23-image control using the same JPEGs near the failing allocation renders successfully; all 262 JPEGs pass independent full pixel decoding.

### Console output or logs

```text
Upstream a50444c2, page 1:
Cached decoded images: 78
WASM heap capacity: 2,147,483,648 bytes
RuntimeError: Aborted(). Build with -sASSERTIONS for more info.
```

CanvasKit 0.41.1's tested WASM binary has a 2 GiB memory maximum. Heap capacity is not a measurement of live retained memory. The Chrome process stays alive; CanvasKit rendering aborts.

The proposed fix branch completes pages 1 → 2 → 3 → 2 → 1 with no console errors, keeping WASM heap capacity at 134,217,728 bytes in the same diagnostic. This result is specific to the tested workload/environment, not a general upper bound on process/GPU memory.

### Related reports

[#587](https://github.com/open-pencil/open-pencil/issues/587) also discusses page-switch memory growth, but this report provides a distinct image-heavy reproduction. [PR #863](https://github.com/open-pencil/open-pencil/pull/863) is still open and bounds the fallback scene picture to the viewport; the proposed image decode/preview budget should be coordinated with it. No claim is made that these reports have an identical cause.
