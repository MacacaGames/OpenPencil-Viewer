# Public reproduction preparation

This bundle contains synthetic documents and local issue/PR preparation drafts. No input design is read or transformed. No GitHub issue or PR has been posted.

## Source revisions

- Generator export/import baseline: `8c72b62da07ea1f7e82de84c7c837c3c78dfbf95`.
- Latest inspected and separately parser-validated source: `6a05e30f15398de70d36deda011003b4347d1627`.
- Checked on 2026-10-05. Refresh upstream history and issue searches before posting.

## Documents

The three procedural fixtures below are small controls. The reporter confirmed
they do not reproduce the original failure; their largest FIG is only about
13 MB. The revised workload is `image-heavy-400mib.fig`: a new three-page graph
referencing hundreds of distinct JPEGs with at least 400 MiB of actual embedded
image bytes. Read its separate `manifest.json` for exact size, count, hashes and
validation results.

- `image-heavy-400mib.fig`: original JPEG bytes from The Met Open Access; image
  data contributes the file's size. No padding, duplicate image variants or
  confidential input design is used. Some distinct photos show different views
  of the same public-domain artwork.
- `repaint-fit-tile.fig`: two pages, 32 image nodes sharing one 512×512 image; small repaint/resize control.
- `many-images.fig`: two pages, 129 referenced and distinct 512×512 images; tests a count threshold and about 172 MiB of aggregate full-resolution RGBA/mipmap weight.
- `large-images.fig`: two pages, 16 distinct 4096×4096 images; about 1.33 GiB of aggregate full-resolution RGBA/mipmap weight. Compressed image data is about 12.3 MiB, so this tests decoded-image pressure separately from a 32 MiB encoded-data threshold.

Sizing estimates are not measured process/GPU memory or a promised OOM. Both source revisions parse every file successfully. The small files passed ZIP/PNG integrity and resource-reference checks. The revised large file's live browser result is recorded below. Live Figma import and a failure signature matching the confidential original hardware remain unrun.

The three small controls use numerical pixels from `generate-fixtures.ts`. The
large fixture uses public CC0 JPEGs. Every graph starts empty; document node
names and metadata are newly generated. Source URLs live in `sources.json`, not
in graph nodes. No confidential document, text, font, library reference or
imported document metadata is used.

Regenerating all three files from the final script at the baseline revision produced byte-identical hashes and the same manifest.

## Run the source diagnostic

Install dependencies in a disposable upstream checkout and run each diagnostic in a new process:

```sh
bun install --frozen-lockfile
bun run /path/to/probe-lifecycle.ts /absolute/path/to/upstream-checkout
git apply --check /path/to/canvaskit-initialization.patch
git apply /path/to/canvaskit-initialization.patch
bun run /path/to/probe-lifecycle.ts /absolute/path/to/upstream-checkout
```

The source-only candidate fixes concurrent initialization. It intentionally leaves the other observations unchanged. The harness mocks initializer/surface/renderer handles and must not be described as a browser or GPU acceptance test. Before submitting a PR, add canonical package-owned regression coverage and complete the checks in upstream CONTRIBUTING.md.

## Regenerate the FIG files

Copy the generator into the disposable checkout so workspace package exports resolve there:

```sh
bun run build:packages
mkdir -p scratch
cp /path/to/generate-fixtures.ts scratch/generate-fixtures.ts
bun run scratch/generate-fixtures.ts scratch/public-repro
```

Use the baseline revision for the exact attached hashes. The generator has an output directory argument and no input-file argument. It exports a fresh graph, replaces variable metadata timestamps, accepts only known ZIP entry names, and reimports every generated file. `manifest.json` records the hashes and actual dimensions.

If live Figma cannot import the generated FIG, extract only these synthetic PNG assets and rebuild the two pages in an empty Figma document, then save a local copy. Validate the failure first; reduce image count, dimensions and pages by bisection afterwards. A concurrency or disposal race requires code/timing evidence and is not guaranteed by a FIG alone.

## Rebuild the image-heavy fixture

The completed large FIG contains **262 distinct JPEGs**, **3 pages** with
88/88/86 image nodes, and **420,741,689 bytes of embedded JPEG data**. The FIG is
420,822,973 bytes (401.3 MiB), SHA-256
`36b759d00fe266d074620af0cbf619e5c090c8da29c74947358b422bca9d78ea`.
All JPEGs pass structural verification and pixel decoding. The pinned and latest
parsers both verify 266 nodes, 262 referenced images and every image hash.
Regeneration from the captured inventory produces the identical FIG hash.

Latest upstream's direct WebGL renderer fails on page 1 with `Aborted()` after
the WASM heap reaches its **2,147,483,648-byte maximum** and the decoded cache
contains 78 images. The maximum was verified from CanvasKit's binary memory
section, not imposed by the harness. Three fresh browser runs fail; the detailed
run records the final heap limit and image hashes. The 23 identical JPEGs around
the failure position complete all three subset pages with no errors and a
691,404,800-byte heap capacity. This supports cumulative memory exhaustion
rather than an invalid source JPEG. Test environment: Chrome 154, macOS arm64,
ANGLE Metal Apple M1 Max, DPR 1. There is no renderer-process crash: the caught
CanvasKit abort ends rendering. The full upstream app worker/import path,
current Portal runtime and live Figma import were not exercised by this harness.

[The Met Open Access policy](https://www.metmuseum.org/hubs/open-access) makes
images of public-domain artworks available under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Only objects whose
public API metadata says `isPublicDomain=true` and has no copyright credit are
eligible. Both primary and additional image URLs must be named in that record.
`sources.json` preserves the artwork, artist, credit, source and metadata URLs,
dimensions, exact byte count and SHA-1/SHA-256 for every selected image. JPEGs
are embedded unchanged. This reproducer is independent of the museum and is
not endorsed by it.

For exact offline regeneration, extract the JPEGs from the hash-verified public
FIG using the captured inventory (catalogue ordering and URLs may change):

```sh
# Run in the disposable upstream checkout; keep the extracted bundle separate.
repro_bundle=/absolute/path/to/extracted-public-bundle
bun install --frozen-lockfile
bun run build:packages
mkdir -p scratch
python3 "$repro_bundle/extract-public-images.py" "$repro_bundle" scratch/public-images
cp "$repro_bundle/generate-image-heavy.ts" "$repro_bundle/validate-image-heavy.ts" scratch/
bun run scratch/generate-image-heavy.ts scratch/public-images/sources.json scratch/public-repro-large
python3 "$repro_bundle/assemble-image-heavy.py" scratch/public-images scratch/public-repro-large
bun run scratch/validate-image-heavy.ts scratch/public-repro-large
```

The graph scaffold is deliberately small and not a reproduction file by itself.
The assembler streams only hash-verified public images into the final FIG. All
JPEG/ZIP integrity checks and both parser revisions must pass separately. The
aggregate decoded RGBA/mipmap estimate describes possible image weight, not
measured live RAM, VRAM or a guaranteed crash threshold.

Alternatively, `download-public-images.py scratch/public-images --inventory
sources.json` restores exactly the same inventory from the listed public CDN
URLs and checks every digest. It does not require a fresh metadata search.

`browser-image-memory.html` and `browser-image-memory.ts` are a read-only memory
diagnostic: serve them with upstream Vite and local same-origin `/fixture.fig`
and `/canvaskit.wasm` routes, then visit the HTML. They use the unmodified
upstream parser and renderer without initializing app storage, autosave or
collaboration. Cache insertions are observed without changing ownership or
limits. The recorded WASM heap capacity is not a live-allocation measurement.
This direct renderer test is separate from the full app worker/import path and
live Figma import.

The public bundle also includes a localhost-only Vite config and a Playwright
runner. After building upstream packages and extracting the bundle, copy the
browser files into that checkout's `scratch/` directory. Start the server:

```sh
# Run in the disposable upstream checkout, after the package build above.
repro_bundle=/absolute/path/to/extracted-public-bundle
cp "$repro_bundle/browser-image-memory.html" "$repro_bundle/browser-image-memory.ts" "$repro_bundle/browser-repro.vite.config.ts" "$repro_bundle/run-browser-repro.ts" scratch/
OPENPENCIL_REPRO_DIR="$repro_bundle" bun run dev --config scratch/browser-repro.vite.config.ts
```

In a second terminal in the checkout, run the large file and both controls:

```sh
OPENPENCIL_REPRO_BROWSER_CHANNEL=chrome bun run scratch/run-browser-repro.ts /fixture.fig large-result.json
OPENPENCIL_REPRO_BROWSER_CHANNEL=chrome bun run scratch/run-browser-repro.ts /control.fig small-result.json
OPENPENCIL_REPRO_BROWSER_CHANNEL=chrome bun run scratch/run-browser-repro.ts /decode-control.fig nearby-result.json
```

`chrome` selects installed Chrome. Omit that variable to use Playwright's
installed Chromium. The runner starts a fresh disposable profile, blocks
external requests, sanitizes stack paths, writes numeric JSON and closes the
browser. It reports rendering failure as data; inspect `outcome` and `errors`
rather than relying on the process exit code. Stop the local Vite server after
testing. A WASM heap limit may differ with another CanvasKit build.

If Figma rejects the generated FIG, create a new empty Figma file, import only
the listed public JPEGs, arrange them across three pages, and save a local FIG.
Compare image resource count and encoded bytes against this manifest. A Figma
round-trip can change packing and deduplication, so record its own hash and
measure the failure again.

## Share the large reproduction

A 400-MiB FIG/ZIP exceeds GitHub's
[25-MB limit for other issue attachments](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).
Prepare the FIG as a public release asset in a reproduction repository and link
it from the issue; GitHub permits
[individual release assets under 2 GiB](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).
Attach the small inventory, SHA256SUMS, generator and numeric failure log to the
issue itself. Do not add a 400-MiB binary to ordinary Git history or burden
upstream's fixture LFS before the maintainer agrees on regression coverage.
No public upload, release, issue or PR has been created here.

## Prepare contributions

`issue-canvaskit.md`, `issue-surface-lifecycle.md`, `issue-image-memory.md`, and `pr-canvaskit.md` are local English drafts. The updated image draft includes measured before/after evidence; the reporter confirmed the public FIG reproduces the problem. `pr-image-memory.md` follows the current upstream PR template. Coordinate related image-memory work with issue #587 and open PR #863. PR #868 already fixes shader handle release, so do not report that as unfixed.

Use the current upstream PR template and disclose AI assistance. Run `bun run check`, `bun run format`, `bun run test:unit`, and `bun run test`; include visual snapshots for rendering changes and live Figma round-trip validation for format changes. Upstream `tests/fixtures/*.fig` uses Git LFS. Attach only synthetic captures and numeric logs from a clean profile. If the issue form does not accept a FIG extension, attach the public ZIP bundle.

## Fork image fix (2026-10-05)

Base: upstream/fork master `a50444c265f51c5d3af0bcef507192a4b3e1cbdd`. Work branch: `codex/fix-image-reading-memory` in MacacaGames/open-pencil. Final implementation and contribution corrections: `e4ef22826ff238bba57eeeb7bc769d4a2d355ce1`. The Portal pins this pristine fork commit and applies its separately rebased LAN/security/lifecycle patches. Image cache/decoder code now belongs to native Core/Vue; Portal's duplicate image helpers were removed. The image unit tests are explicitly formatted, the browser regression uses native wheel zoom, and export-state restoration extends the existing raster-export suite.

Manual submission: create the issue in open-pencil/open-pencil with `issue-image-memory.md`; attach/link your confirmed public FIG. Create a PR with base **open-pencil/open-pencil:master**, head **MacacaGames/open-pencil:codex/fix-image-reading-memory**, and `pr-image-memory.md`. Add the actual issue URL or `Fixes #N` only after it exists. No issue or PR is posted by this task.

The final public diagnostic artifacts are `.work/upstream-audit/fork-latest-before.json` and `fork-image-fixed.json`. The first aborts at 2 GiB; the latter renders pages 1, 2, 3, 2, 1 at 128 MiB WASM capacity. These use the same file/hash above and the real editor-state renderer path; the repaired path injects the native browser decoder and waits for all visible image previews to settle. Full application/Figma import is a separate acceptance scope.

The branch is pushed and verified on the fork. Review it at <https://github.com/MacacaGames/open-pencil/tree/codex/fix-image-reading-memory>. Start the manual upstream PR comparison at <https://github.com/open-pencil/open-pencil/compare/master...MacacaGames:open-pencil:codex/fix-image-reading-memory?expand=1>. The upstream master branch was not changed.
