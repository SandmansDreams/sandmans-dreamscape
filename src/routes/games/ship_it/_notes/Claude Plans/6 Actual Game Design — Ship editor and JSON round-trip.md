# Ship editor and JSON round-trip

## Context

Ships are authored in code (`assets/ships/*.ts` export builders), which is fine for two test hulls and hopeless for designing real ones. The ship viewer proves the render path; what's missing is a way to *make* a ship and a way to keep it.

This milestone builds both: a JSON format with a reader and writer, and an interactive editor scene that paints blocks onto a grid. The format comes first deliberately — an editor with no save format is a toy, and the format is what the editor's undo, load and export all sit on.

`dev/ship-parser.ts` currently has a `shipToJSON` that discards its own output and a `JSONToShip` stub that returns nothing. It also can't work as written: `Grid` keeps cells in a `Map`, and `JSON.stringify` renders a `Map` as `{}`, so it would emit empty layers. Serialization has to go through `grid.list`.

Decisions taken: **palette plus one cell per line**, layers grouped, and the editor is a full interactive scene rather than a code-only builder.

## The format

```json
{
  "version": 2,
  "id": "scythe",
  "name": "Scythe",
  "palette": { "94a1b3": [0.58, 0.63, 0.70], "424a57": [0.26, 0.29, 0.34] },
  "layers": {
    "hull": [
      { "c": -1, "r": -4, "s": "full", "p": "94a1b3" }
    ],
    "coverable": [
      { "c": -1, "r": 4, "s": "full", "k": "thruster", "f": 2, "p": "424a57", "e": 0.8 }
    ],
    "cosmetic": [],
    "placement": []
  }
}
```

Cell keys stay short because these files get long: `c`/`r` position, `s` shape, `t` turns, `m` mirrored, `p` palette key, `e` emission, `k` kind, `lv` level, `f` facing, `hp`/`ma` stat overrides. **Everything except `c`, `r` and `s` is omitted when it equals the default** — `t: 0`, `m: false`, `e: 0`, `k: "hull"`, `lv: 1`, `f: 0`, and `hp`/`ma` when they match the level's defaults from `statsFor`. A plain hull block is therefore four keys.

**Palette keys are the color's hex digits** (`94a1b3`), not `c0`/`c1`. The same color always gets the same key, so re-exporting a ship after an unrelated edit produces a stable diff rather than renumbering everything.

**No `origin` field.** Coordinates are signed and absolute, so the origin is already `(0, 0)` by construction — a separate field would be a second source of truth that can disagree.

Reading is deliberately lenient, matching the old loader: an unknown shape, kind or palette key drops that one cell with a warning rather than throwing, so a hand-edited file loses a block instead of the whole ship. `readShip` returns `{ ship, warnings }`; a thin `shipFromJson` wrapper discards the warnings for callers that don't care.

## The input gap

Nothing in the tree listens to a pointer — no `addEventListener` anywhere. The editor needs picking, drag-painting, pan and zoom, and the game will want the same, so this goes in a small shared `dev/input.ts` rather than inline in the scene.

Two details that will bite otherwise:

**Mouse events are in CSS pixels; the camera is in drawing-buffer pixels.** `Camera.screenToWorld` reads `viewportWidth/Height`, which are `gpu.width`/`gpu.height` — the device-pixel drawing buffer. Converting through `devicePixelRatio` alone is wrong when CSS scales the canvas; scale by the ratio of the two instead:

```ts
const rect = canvas.getBoundingClientRect()
const x = (event.clientX - rect.left) * (canvas.width / rect.width)
```

**Edge detection needs a frame boundary.** Painting on press rather than on hold means the input has to know when a frame ended, so `PointerInput` exposes `pressed()`/`released()` alongside `isDown()` and the scene calls `endFrame()` at the end of `update`.

## The editor's camera must not auto-fit

Every scene so far calls `Camera.fit` each frame. An editor cannot: the fit would rescale the moment you add a block outside the current bounds, so the ship would jump under your cursor mid-stroke.

For the same reason the mesh origin is fixed at `(0, 0)` rather than `ship.centerOfMass` — the viewer recenters on mass, which in an editor means every placed block shifts everything already drawn. The editor pans and zooms explicitly and never recenters.

Cell picking is then the inverse of what `appendGridMesh` does:

```ts
const col = Math.floor(world.x / cellSize + origin.x)
const row = Math.floor(world.y / cellSize + origin.y)
```

## Undo by snapshot

Grid mutations are `set`/`delete`/`fill`/`clear`, and a command stack would need an inverse for each. A snapshot of `grid.list` per layer is simpler and correct for the sizes involved — a few hundred cells against a bounded stack of ~50 states. Restoring is `clear()` then `set()` per cell, which reproduces every field including stat overrides, since `set` accepts all of them.

## Stages

**A — `game/shipJson.ts`.** `shipToJson(ship)` and `readShip(data)`, plus `downloadShip(ship)` using a Blob and an object URL (revoked after the click, and `browser`-guarded). Wire the existing `getShip` button in the ship viewer to it — and fix its key mismatch, since the schema says `getShip` while the action map says `download`, so it currently no-ops silently. Delete `dev/ship-parser.ts`.

**B — `dev/input.ts`.** `PointerInput`: position in drawing-buffer pixels, `isDown`/`pressed`/`released`, accumulated wheel, drag delta, `endFrame()`, `destroy()`. Attaches in the constructor, detaches on destroy so a scene swap leaves no listeners behind.

**C — `dev/scenes/ship-editor.ts`.** The brush *is* the settings panel: layer, shape, turns, mirrored, kind, level, facing, color and tool (paint/erase/pick) are all existing spec types. Left drag paints, middle or right drag pans, wheel zooms. Draws the cell lattice and a hover preview of the brush so placement is predictable.

**D — Editing actions.** Undo, redo, clear layer, clear all, download, and load-by-paste (a `text` setting plus a button — a `file` spec type can come later if pasting gets tiresome).

## Files

New: `game/shipJson.ts`, `game/shipJson.test.ts`, `dev/input.ts`, `dev/scenes/ship-editor.ts`.

Modified: `dev/scenes/ship-viewer.ts` (action key fix, download wiring), `settings/settings.ts` (add `ActionsOf<S>` so a button key that has no action is a compile error, and drop the leftover button click-counter from `defaultValues`), `render/scene.ts` (delete the duplicated `SceneContext`/`SceneInstance`/`SceneDefinition` block at lines 41-69).

Deleted: `dev/ship-parser.ts`.

Reused as-is: `Grid.list`/`set`/`clear`, `statsFor` for default-stripping, `Camera.screenToWorld`, `appendGridMesh`, `DRAWN_SHAPES` and `COMPONENT_KINDS` for the brush options, and the whole settings/scene machinery.

## Verification

1. **A** — `npx vitest run` over `shipJson.test.ts`: a ship survives write → read → write byte-identically; defaults are stripped; an unknown shape drops one cell and reports a warning rather than throwing; palette keys are stable across re-exports.
2. **A** — in the viewer, click Download Ship and confirm a file lands with the palette and layers populated, not `{"hull":{"cells":{}}}`.
3. **B/C** — select the editor scene, paint a few blocks, confirm the cell under the cursor is the one that changes at several zoom levels and after panning. That is the CSS-versus-device-pixel conversion under test; getting it wrong shows up as an offset that grows with distance from the origin.
4. **C** — confirm the view does *not* jump when a block is placed outside the current bounds.
5. **D** — paint, undo back past the first block, redo forward, then download and reload the result.
6. `npx svelte-check` clean, and `read_console_messages` free of listener or validation errors after several scene swaps (which is what proves `destroy()` detaches).

## After this

Building rules from the design doc — blocks must touch existing hull, thrusters within 1-2 cells of an edge and pointing at it, cosmetic layer restricted to hull-kind blocks. `Grid.hasNeighbor` and `canPlace` already exist for the first two; the editor is the natural place to surface violations.
