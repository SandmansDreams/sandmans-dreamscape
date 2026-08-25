# Restructure toward a game: input service + component art

## Context

The physics and flight work landed, and the project has outgrown its shape. Today
the **dev harness *is* the app**: `+page.svelte` picks a scene out of
`dev/scenes/`, and the flight prototype is a dev scene taking its arena from dev
sliders. Everything reusable is copy-pasted per scene.

Two problems are worth fixing now, before more scenes multiply them:

1. **Input is three unrelated paradigms.** Polled classes in `game/input.ts`
   constructed once per scene (`new Input(canvas)` in ship-builder and
   sprite-editor, `new KeyboardInput()` in ship-flight, `new PointerInput()` in
   ship-viewer), plus two `svelte:window onkeydown` handlers in `BuilderUI` and
   `SpriteEditorUI`, plus the backtick handler in `+page.svelte`. There is no one
   place that lists what is bound, keys are hard-coded at every call site, and the
   UI handlers switch on `event.key` — which breaks on non-QWERTY layouts and
   directly contradicts the policy `game/input.ts:160` states for itself. Nothing
   can be rebound.

2. **Nine of ten components have no art.** Only `autocannon` is drawn (L1–L5);
   `hull-plate`, both thrusters, `crate`, `battery`, `fusion-core`,
   `shield-projector`, `radar-dish` and `railgun` all fall through `findArt` to
   the placeholder hexagon in `blockDraw.ts:225`.

**Destination shape** (agreed, not all built this round): a `Game` runtime owns
the app — world, systems, camera, input — and the dev scene picker becomes a
debug overlay behind the backtick rather than the thing being run. This round
builds the input service **at that altitude**, owned above the scenes, so it is
already sitting where `Game` will pick it up.

**Explicitly not this round:** the shared renderer (MESH_2D is compiled in five
scenes, the same solid+line pipelines built six times, and several call sites
`Mesh.create`/`destroy` where `Mesh.update` would reuse the buffer), and the
game layer (world/entities/systems). Both get easier once input is a service
rather than a per-scene possession.

---

## Part 1 — Input service with an action catalogue

### New: `input/` (top level, peer to `settings/`)

Input is app infrastructure, not game rules, and `settings/` already sets the
precedent for a top-level service directory.

| File | Holds |
|---|---|
| `input/keys.ts` | `KeyboardInput`, `PointerInput`, `isTyping` — **moved verbatim** from `game/input.ts`. Device polling, unchanged. |
| `input/actions.ts` | The action catalogue: every action, its label, its context, its default binding, whether it captures. |
| `input/bindings.ts` | `Bindings` — action → codes, load/save through `settings/storage.ts`, conflict detection. |
| `input/service.ts` | `InputService` — owns one keyboard and one pointer, resolves actions, holds the context stack, one `endFrame`. |

`game/input.ts` goes away; the composite `Input` class it exports is replaced by
`InputService`.

### The catalogue is data

```ts
export interface ActionSpec {
    /** Shown in a rebinding panel. */
    label: string
    context: InputContext
    /** Physical codes, in `event.code` form. First is the primary. */
    default: readonly string[]
    /** Suppress the browser default while this context is active. */
    capture?: boolean
}
```

Keyed by dotted id (`"flight.thrustForward"`, `"builder.rotate"`) so a log line
or a conflict message names itself. `InputContext` is
`"global" | "flight" | "builder" | "sprite" | "viewer"`.

Contexts are what make rebinding tractable: `KeyW` may mean thrust in flight and
something else in the builder without either being a clash, so conflict checks
run **per context, plus global**. This is also the table a rebinding panel
renders itself from later — the panel is not built this round, but nothing else
needs to change when it is.

Everything currently hard-coded becomes an entry: WASD/QE/Z from
`ship-flight.ts:190`, the r/m/l/arrow shortcuts from `BuilderUI.svelte:308`, the
sprite editor's equivalents, and the backtick dev toggle from `+page.svelte:160`.

### The query API

Action names in, never key codes:

```ts
held(action): boolean
pressed(action): boolean      // edge since last endFrame, auto-repeat excluded
released(action): boolean
axis(negative, positive): number
```

Same four shapes `KeyboardInput` already offers, so the call sites in
`ship-flight.ts` change name only. `readControls` becomes
`axis("flight.strafeLeft", "flight.strafeRight")` and so on.

### Ownership moves above the scenes

- `+page.svelte` constructs **one** `InputService` for the page's life and hands
  it to `SceneRunner`.
- `SceneRunner` puts it on `SceneContext` (`render/scene.ts:14`) and calls
  `endFrame()` once per frame after `instance.update`. Scenes stop constructing
  input, stop calling `endFrame`, and stop destroying it — three current
  obligations that a new scene can silently forget, and a missed `endFrame`
  leaves a key held forever.
- One `PointerInput` for the page rather than per scene: the canvas is
  `gpu.canvas` and outlives every scene swap, so per-scene construction was
  never buying anything.
- `SceneDefinition` gains `input?: InputContext`. `SceneRunner.load` pushes it
  and pops the outgoing one, so exactly one scene context plus `global` is ever
  active.
- The `isTyping` guard lives once in `input/keys.ts` instead of being restated in
  `BuilderUI.onKey` and `SpriteEditorUI.onKey`.

### The UI keyboard handlers fold in

`BuilderUI`'s `onKey` currently mutates the brush by calling `set()` →
`onPatch` → `runner.send("brush", …)`, so the shortcut already round-trips
through the scene. The logic moves **into** `ship-builder.ts`, which reads
`pressed("builder.rotate")` and patches the brush it already owns. Same for the
sprite editor. Both `svelte:window onkeydown` blocks are deleted.

This is the largest chunk of churn in Part 1 and the part most likely to surface
behaviour differences — the arrow-key shape/layer stepping in particular, which
uses `DRAWN_SHAPES` and `SHIP_LAYERS` order from the UI module.

### Persistence

`Bindings` saves through the existing `loadStore`/`saveStore`
(`settings/storage.ts`), validated the way `loadBrush` validates
(`render/grid/brush.ts:80`): start from defaults, accept only keys the catalogue
declares, drop anything unrecognised. A binding file from an older build must
never leave an action unbound.

### Tests

`input/bindings.test.ts` — defaults resolve, a stored override wins, an unknown
action in storage is dropped, a same-context conflict is reported, the same code
in two different contexts is not. Pure logic, no DOM.

---

## Part 2 — Art for every component

### How it gets generated

Authored designs live in a script, not hand-typed JSON:

- `dev/tools/genComponentArt.ts` holds each piece as readable cell data and
  writes `assets/components/<id>.json` through the existing
  `artToText` (`game/componentArt.ts:157`).
- `npm run art` runs it with `tsx`, alongside the existing script entries.
  (Those two entries, `shapes` and `convert-hull`, point at
  `space_game/engine/dev/…` which no longer exists — stale, worth deleting in
  the same pass.)

Going through `artToText` means the generated files are **byte-identical in shape
to what the sprite editor downloads**: baked mesh included, palette written,
version 3. Opening one in the editor and saving it back produces the same file.
The whole chain (`ArtGrid` → `bakeRole` → `MeshBuilder`) is already headless —
`game/componentArt.test.ts` exercises it under vitest.

### Conventions the pieces must follow

- **16×16 canvas** (`ART_GRID`), baked into the 0..1 box of one hull cell.
- **Author pointing north.** `appendArt` (`blockDraw.ts:165`) rotates by
  `facing` on the CPU, so one piece serves all four headings. `autocannon-l1`
  confirms it: its barrel sits at `r: 0..6`, the top of the canvas.
- **Roles carry the recolouring.** `main` is replaced by the cell's colour, so
  the body of the piece goes there and player colours work. `accent` is replaced
  by the cell's accent (falling back to the art's own) — the functional part:
  nozzle, lens, barrel, coil. `static` keeps what it was drawn with — dark
  framing and panel lines.
- **`full` cells merge, nothing else does** (`spriteMesh.ts:59`). Large flat
  areas cost two triangles; a field of wedges costs two each. Silhouette detail
  on the edges, flat interiors.
- **One file per component id**, no level suffix. `artIds`
  (`components.ts:79`) tries `<id>-l<level>` then `<id>`, so a single file covers
  every level immediately. Level variants come later where a level should
  genuinely look different — `autocannon` already shows that pattern with five
  files.

### The nine pieces

| Component | Intent |
|---|---|
| `hull-plate` | Plated square, static framing with a `main` field and a bevelled corner. The most-placed block, so it must tile without visual noise. |
| `ion-thruster` | Narrow bell tapering to a north-pointing `accent` throat, static housing. |
| `chem-thruster` | Wider, blunter bell than ion, twin `accent` nozzles — heavier at a glance, matching its higher mass and thrust. |
| `crate` | Banded box, `main` body with static strapping. Deliberately dull; it is cargo. |
| `battery` | Cell block with an `accent` charge bar down one side. |
| `fusion-core` | Round `accent` core inside a static housing, radial vents. The one piece that should read as "hot". |
| `shield-projector` | Dish cupped toward north, `accent` emitter at the focus. |
| `radar-dish` | Open lattice dish, thinner than the projector, `accent` feed horn — distinguishable from `shield-projector` at a glance, since they share a category. |
| `railgun` | Two long static rails with an `accent` gap between them, running north. Reads as bigger than `autocannon`. |

No code change is needed for these to appear: `appendBlock`
(`blockDraw.ts:225`) already prefers art over the placeholder, and it is the
single path the builder ghost, the ship viewer and the flight scene all draw
through.

### Test

Extend `game/componentArt.test.ts`: every id in the `REGISTRY`
(`components.ts:190`) resolves through `findArt` at level 1, and every generated
file reads back with zero warnings. That is the check that catches a filename
that does not match a registry id — the failure mode where a piece silently
never shows up.

---

## Verification

1. `npx vitest run` — 218 tests today, plus the new bindings and art cases.
2. `npx svelte-check --tsconfig ./tsconfig.json --threshold error` — 0 errors
   today; the input move touches every scene, so this is the real gate.
3. Browser, via the dev server:
   - **Builder** — components draw as their own art, not hexagons. `r`, `m`,
     `l` and the arrows still do what they did, now through the scene.
   - **Flight** — WASD/QE fly, `Z` toggles assist, the readout agrees.
   - **Sprite editor** — open a generated piece; it loads with no console
     warnings and looks the way it was generated.
   - Switch scenes repeatedly and confirm no key sticks held — the failure a
     missed `endFrame` used to cause per scene.
   - `localStorage` — rebind an action by hand, reload, confirm it survives and
     that a garbage entry falls back to the default rather than unbinding.

## Cleanup noticed along the way

- `package.json` scripts `shapes` and `convert-hull` point at a deleted
  `engine/dev/` path.
- Nothing is committed since `41464c6`; the physics, steering and flight work is
  all still in the working tree.
