# Bitmap fonts

## Context

The renderer can now draw arbitrary geometry through a camera, batch thousands of instances, time itself, and swap between scenes with live settings. What it cannot do is draw a single character — so every scene is debugged by reading numbers out of a DOM panel rather than labelling things in the world.

Vers_3 solved this, and the key discovery from reading it is that **its font system uses no GPU textures at all**. It decodes the PNG sheet on the CPU, merges lit pixels into horizontal runs, and emits one quad per run into the same interleaved `[x, y, r, g, b]` stream everything else uses:

> "No texture, no atlas, no UVs - each lit pixel becomes geometry in the same interleaved stream as everything else, so text goes into an ordinary Mesh and through the post-processing chain with the rest of a scene."

That means fonts introduce **zero new GPU concepts**. They sit entirely on top of `MeshBuilder` and the existing `MESH_2D` shader. Textures are only needed for post-processing, which is deliberately last.

Order for the next three milestones, decided: **fonts → grid/hull → post-processing**. Wrapping is word-based with hard-break overflow. Text is world-space only; the HUD will be built from HTML elements rather than drawn in-canvas, which is what makes `Camera.worldToScreen` ([render/camera.ts](../../Documents/Scripting/Webstites/sandmans-dreamscape/src/routes/games/space_game/render/camera.ts)) load-bearing later for positioning DOM over world objects.

## Sheet format

Three sheets already exist in `assets/fonts/`, all 80×42 RGBA: `SpaceGameMono_mono_5x7.png`, `SpaceGameGalactic_spaced_5x7.png`, `SpaceGameStylized_spaced_5x7.png`.

Everything about a font except its spacing is read from the filename and the pixels: `name_type_WxH.png`, a 16×6 grid of cells starting at code point 32, so codes 32–127 row-major. Glyphs are white-or-transparent, so "lit" is an alpha test alone.

## Design

### Emit into `MeshBuilder`, not a raw array

Vers_3's `appendText` pushed interleaved floats into a `number[]` because it predated a builder. A run is exactly `MeshBuilder.quad(x, y, width, height, color)` — the existing method in [render/mesh.ts](../../Documents/Scripting/Webstites/sandmans-dreamscape/src/routes/games/space_game/render/mesh.ts) — so the new signature takes a builder and no new interleaving code is written:

```ts
appendText(builder: MeshBuilder, text: string, x: number, y: number, pixel: number, color: RGB): number
```

### Run merging is the performance story

One quad per *run* of horizontally adjacent lit pixels, not per pixel. Vers_3's note: a row of `#####` becomes one quad instead of five, "which cuts the geometry for typical text by more than half."

### Wrapping as a pure function

Word wrap needs to measure in world units, not count characters, or a spaced font wraps at inconsistent widths. Making the measurement injectable keeps the algorithm unit-testable with no PNG, no GPU and no async:

```ts
export function wrapText(text: string, maxWidth: number, measure: (line: string) => number): string
```

The class method delegates to it with its own measurement. Behaviour: break on spaces; hard-break any single word wider than the line; preserve explicit `\n`; preserve deliberate blank lines (slicing an empty string yields nothing, so a blank paragraph silently vanishes without an explicit case).

### Loading, and the SSR hazard

`FONTS` is built at module scope from an eager `import.meta.glob(..., { query: "?url" })`, so importing the module kicks off work. Vers_3 started a `fetch` from the `BitmapFont` constructor — under SvelteKit that also fires **on the server**, where a relative URL fetch fails and gets logged for every render.

Guard the fetch with `browser` from `$app/environment`, the same pattern [settings/storage.ts](../../Documents/Scripting/Webstites/sandmans-dreamscape/src/routes/games/space_game/settings/storage.ts) already uses. On the server `loaded` stays false, `ready` resolves immediately, and nothing is fetched.

Two failure-handling rules worth carrying over verbatim, both with real reasoning behind them: **loading never rejects** (it runs detached from whatever created the font, so a rejection surfaces as an unhandled promise with no owner — log and leave `loaded` false), and the **missing-glyph box is empty until the sheet loads** (so text is simply absent during the fetch instead of flashing a wall of boxes).

### Mono vs spaced

The single decision the cutter turns on. Mono is centred in its cell, so trimming would destroy the alignment that makes it monospace — advance is always `glyphWidth`. Spaced sheets are left-aligned, so trimming to the measured ink box is correct — advance is `right - left + 1`. Trimming is horizontal only; vertical alignment comes from the sheet.

Descenders get a per-glyph downward shift, detected at runtime (`bounds.top < DESCENDER_DEPTH` for a character in `gjpqy`) rather than configured per font, because only a sheet that raised its descenders to fit the cell needs it. The largest shift seen becomes `font.descent`, which callers add to `measureTextHeight` when sizing a box, since that method counts whole cells only.

## Files

| File | Contents |
|---|---|
| `render/font.ts` | `FontType`, `Glyph`, `FontOptions`, `BitmapFont`, `wrapText`, `FONTS`, `FONT_NAMES`, `DEFAULT_FONT`, `fontByName`, `fontsReady` |
| `render/font.test.ts` | `wrapText` against an injected measure function |
| `dev/scenes/font-test.ts` | Scene exercising all three sheets |

No changes to existing render modules — `MeshBuilder.quad`, `Mesh`, `Camera.fit`, `MESH_2D` and `Pipeline` are all used as they stand. `Assert` from [dev/assert.ts](../../Documents/Scripting/Webstites/sandmans-dreamscape/src/routes/games/space_game/dev/assert.ts) for the sheet-dimension check.

## The test scene

`dev/scenes/font-test.ts`, auto-registered by the `import.meta.glob` in `dev/DevScene.ts`. A good exercise for the settings types added last session:

- `font` — selection over `FONT_NAMES`
- `text` — text, `rows: 4`
- `wrap` — range in world units, `scale: "log"`
- `pixel` — range, world units per font pixel
- `color` — color, through `hexToRgb`
- `letterSpacing` / `lineSpacing` — range, for tuning a sheet's `OVERRIDES` entry by eye

Rebuild is guarded by a dirty key that **includes `font.loaded`** — the first build runs before the fetch returns and produces nothing, and the flag flipping is what triggers the rebuild once glyphs exist. `render()` refits the camera to the text bounds every frame so a window resize reframes for free.

## Verification

1. `preview_start`, navigate to `/games/space_game`, select **Font Test** from the scene dropdown.
2. Screenshot: text renders, and switching `font` between the three sheets visibly changes the glyphs.
3. Confirm spaced vs mono: `SpaceGameMono` should show even columns; the spaced sheets should show tighter, variable advances. A string of `iiii` versus `MMMM` makes it obvious.
4. Drag `wrap` down and confirm lines break between words, not mid-word, and that a single over-long word hard-breaks rather than overflowing.
5. Check descenders: `gjpqy` must sit below the baseline without clipping, and the camera fit must not crop them (that's what `descent` is for).
6. `read_console_messages` clean — in particular no fetch errors, which would mean the `browser` guard is wrong or a sheet name doesn't parse.
7. `npx vitest run` — the `wrapText` tests, plus the existing 11.
8. `npx svelte-check` — no new errors beyond the two known `assets/ships` ones.

## After this

Grid, block shapes and hull loading — also pure CPU on top of the existing mesh layer, and it un-breaks `assets/ships/index.ts`. Then post-processing, which is where textures, samplers, render targets and the group-1 material layer finally get built.
