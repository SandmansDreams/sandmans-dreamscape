# Ship builder UI

## Context

The editor works but its brush is a column of dropdowns in the generic settings panel — you pick a shape by name from a `<select>`, and nothing tells you where a block may legally go. Version 1 had a real builder: a swatch palette, a block picker showing each shape, and keyboard commands, all as DOM in `+page.svelte` synced to the editor via `syncFromEditor()`.

This milestone rebuilds that, with three additions: a palette derived from the ship's own colors, a layer picker, and an emission selector. The grid renders only where a block can legally be placed, and placement is refused elsewhere.

Decisions taken: **all UI is DOM inside the Svelte page**, shown only when the scene asks for it. The **palette is an optional re-selector** — it lists the colors already in the ship and clicking one loads it into the color picker; it never gates placement, which always uses the picker's current color. Legality enforces **adjacency, layer/kind rules and the thruster edge rule**, and illegal cells are simply not offered.

## The thumbnail problem, and why DOM still works

A DOM block picker needs a preview per shape, and one WebGPU canvas cannot render into little DOM elements. Hand-drawn SVG would drift from the real geometry — exactly what V1 called out when it reused its real draw code for ghosts.

`appendShape` is pure CPU and already runs under Vitest with no GPU. So the picker generates its previews **from `appendShape` itself**: run it into a `MeshBuilder`, read `toArray()`, and emit one SVG subpath per triangle. A shape added to `shapes.ts` gets a correct thumbnail for free, and a thumbnail can never disagree with what gets placed.

## Where state lives

The brush stays in the settings values bag, so the scene remains a pure consumer and there is no two-way sync to keep coherent. **Keyboard handling lives in the builder panel**, not the scene — the panel owns the brush, so keys mutate `values` exactly as clicking would.

One thing does need to travel scene → page: the palette, since the ship lives in the scene. Rather than a bespoke hook, add a small general channel mirroring how `Stats` already works:

```ts
// SceneContext
publish(key: string, value: unknown): void
```

with `SceneRunner.published(key)` on the other side, cleared in `load()` alongside `stats.clear()`. The editor publishes its used colors; the page reads them on the existing 200 ms ticker.

`SceneDefinition` gains `builder?: boolean` so the page knows to show the builder panel for this scene and not for the others.

## Legality

A new `render/grid/legality.ts`, so the rules are testable without a GPU and the editor and any future validator agree:

```ts
export interface Legality { ok: boolean; reason?: string }
export function canPlaceAt(ship, layer, col, row, kind, facing): Legality
```

Rules, in the order they are cheapest to check:

1. **Kind on layer** — `canPlace` from `components.ts` already encodes it.
2. **Adjacency** — on the hull layer a block must touch an existing hull block (`Grid.hasNeighbor`), *except* when the hull is empty, or nothing could ever be placed. On the other layers a block must sit on top of an existing hull cell rather than float in space.
3. **Thruster edge rule** — stepping from the thruster in its facing direction must leave the hull within two cells. That is the doc's "1-2 blocks in from the edge, pointing at that edge" expressed as a walk, which avoids having to define what an edge is on a concave hull.

The editor evaluates this over the hull's bounds plus a two-cell margin — a small, bounded set — and draws grid marks only on cells that pass. Placement itself re-checks, so the visual and the rule cannot drift.

## Keyboard

Handled by the builder panel:

- **R** — cycle the variant, `0 .. variantCount(shape) - 1`. Indices at or past `turnCount(shape)` mean mirrored, so R walks all four turns and then the four mirrored ones for a `halfWedge`. That is exactly V1's ramp behaviour: "rotation alone can never produce a mirror image and a symmetric hull needs both."
- **M** — toggle mirrored directly.
- **Left / Right** — previous / next shape in `DRAWN_SHAPES`.
- **Up / Down** — previous / next layer in `SHIP_LAYERS`.

Two details that will bite otherwise: arrow keys scroll the page unless the handler calls `preventDefault`, and the handler must ignore events whose target is an `<input>` or `<textarea>`, or typing a ship name will rotate blocks and change layers.

## Files

New: `dev/shapeSvg.ts`, `dev/BuilderPanel.svelte`, `render/grid/legality.ts`, `render/grid/legality.test.ts`.

Modified: `render/scene.ts` (the `publish`/`published` channel, `builder?` on the definition, clearing on load), `dev/scenes/ship-editor.ts` (legality-gated placement, legal-cell grid, publishes its palette, sheds the brush settings that move into the builder panel), `+page.svelte` (render `BuilderPanel` when `scene.builder`).

Reused as-is: `appendShape` for thumbnails, `turnCount`/`variantCount`/`MIRRORABLE_SHAPES` for the R cycle, `Grid.hasNeighbor` and `canPlace` for legality, `Color.hex` for palette keys, `PointerInput`, and the existing `SettingsPanel` for everything that is not the brush.

## Verification

1. `npx vitest run` — `legality.test.ts`: the first block on an empty hull is legal anywhere; a floating block is refused; a thruster three cells deep is refused while one at the edge facing out passes; a weapon on the hull layer is refused.
2. Editor scene: the grid should show marks only around the existing hull, and clicking a cell with no mark should do nothing.
3. Press **R** on `halfWedge` eight times and confirm it passes through four rotations, then four mirrored ones, then returns to the start. On `full` it should do nothing visible, since `turnCount` is 1.
4. Type in the ship-name field and confirm arrow keys move the caret rather than changing layers — that is the `event.target` guard under test.
5. Paint blocks in two colors, confirm both appear in the palette, click one and confirm the color picker updates. Erase all of one color and confirm the swatch disappears.
6. Compare a block picker thumbnail against the same shape in the Shape Chart at the same turns — they come from one function, so any difference is a bug in the SVG emitter.
7. `npx svelte-check` clean, and no listener leaks after swapping scenes several times.

## After this

The remaining building rules as validation on load rather than only at placement time, and the editor's `pick` tool — an eyedropper becomes possible now that a scene → page channel exists.
