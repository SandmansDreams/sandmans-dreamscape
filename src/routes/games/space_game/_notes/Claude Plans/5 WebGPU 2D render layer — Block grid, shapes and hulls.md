# Block grid, shapes and hulls

## Context

The renderer draws geometry, batches instances, times itself, switches scenes and renders text — but every scene so far has drawn shapes invented on the spot. There is no ship. `assets/ships/index.ts` has been broken since the rewrite began because it imports `render/grid` and `render/hull`, which do not exist in the live tree, and five hull JSON files sit unused.

This milestone builds the block system: `Grid` (a sparse map of blocks), `shapes.ts` (the geometry for each block kind), and hull loading, ending with a ship on screen. It also un-breaks `assets/ships/index.ts`.

Decisions taken: hulls are drawn **through `InstanceBatch`**, so N ships of one type cost one draw call. Two scenes ship with it: **ship viewer** and **shape chart**. `saveHull` is **not** ported. And the hull format is being **redesigned to carry per-cell gameplay stats and component kinds**, which is the change that reshapes `Grid` rather than just porting it.

## What carries over unchanged

Vers_3's design is sound and most of it is CPU code that needs no WebGPU adaptation. Four things to preserve deliberately, all of which have real reasoning behind them:

- **Exact integer quarter-turns.** `(dx, dy) → (-dy, dx)`, never trig. Vertices on cell boundaries stay bit-identical across rotations, so adjacent blocks never crack.
- **Mirror before rotate**, in the shape's own frame, so `(turns, mirrored)` is a clean 4×2 product rather than eight special cases.
- **Segment counts chosen for quarter-turn symmetry** — hexagon 6, octagon 8, circle 40 all divide 90° exactly, which is what makes those shapes identical under rotation.
- **One canonical definition per shape** in cell-local `0..size` y-down coordinates, with the transform applied at emit time.

## What changes for WebGPU

### Emit into `MeshBuilder`

Same move as the font work: `appendShape` takes a `MeshBuilder` instead of pushing interleaved floats into a `number[]`. Rotation is applied to the vertex positions first, then handed to `MeshBuilder.add(verts, color)` in [render/mesh.ts](../../Documents/Scripting/Webstites/sandmans-dreamscape/src/routes/games/space_game/render/mesh.ts) — no new interleaving code.

### Colour stays per-vertex, tint comes per-instance

A hull's colours vary per cell, so they must be baked into the vertices. The instanced shader already computes `instance.color * vertex.color`, so a hull keeps its palette *and* takes a per-ship tint for free — damage flash, faction colour, selection highlight — with no shader change.

### Two revision counters, not one

This is the change per-cell stats force. Vers_3 had a single `revision` bumped by every mutation, with the mesh cache keyed off it. Once a block has hit points, **damage mutates cells every frame**, and a single counter would re-tessellate the whole ship on every hit.

So `Grid` exposes `revision` (any change) and `geometryRevision` (bumped only when something the mesh depends on changes: shape, turns, mirrored, colour, or a cell appearing or disappearing). The mesh cache keys off `geometryRevision`; gameplay systems watching for any change use `revision`.

### Drop the parts that were dead

`LIT_MESH_STRIDE` and the `withCellCentre` path were written but never reachable — `GridMeshCache` never passed the flag. Per-block flat shading is better done in WGSL with `@interpolate(flat)` on a varying than by shipping two extra floats per vertex, so skip it entirely and revisit when lighting arrives. Also drop the unused `ts-gl-matrix` import, the per-call `Vector2` allocation inside `appendShape`, and the standalone `quad`/`triangle` helpers (centre-anchored, y-up, colourless — a different convention from everything else, and only the old dev scenes used them).

## Hull format v2

The redesign keeps v1's two good ideas — a palette so recolouring is one edit, and `c2`/`r2` inclusive rectangles because hull interiors are runs of `full` — and adds gameplay data without making files longer.

**Stats default from the component kind.** A table in `render/components.ts` maps each kind to its defaults; a cell names a kind and overrides only what differs. Ship files stay about layout, and balance changes are one edit in code rather than a pass over every JSON.

```ts
// render/components.ts
export type ComponentKind = "hull" | "armour" | "engine" | "weapon" | "cockpit" | "fuel" | "reactor"

export interface ComponentStats {
    hitPoints: number
    mass: number
}

export const COMPONENTS: Record<ComponentKind, ComponentStats>
```

Per cell, the new optional keys stay short in keeping with the format's own convention: `k` (kind, default `"hull"`), `hp` and `ma` (overrides, omitted when the kind's default applies).

`version` is finally **checked** — v1 had a required `version` field that `loadHullDetailed` never read. v1 files load unchanged, since every new key is optional and absent means "kind is hull, stats are the defaults".

`Cell` gains `kind`, `hitPoints` and `mass`. `Grid` gains a lazily-built, revision-cached index from kind to cells, so "where are the thrusters" is a lookup rather than a scan — the same memoisation pattern `list` and `bounds` already use.

Loading stays **deliberately lenient**: an unknown shape, kind or palette key drops that one cell with a warning rather than throwing, so a hand-edited file loses a block instead of the whole ship. Note that hand-authored `demoShip.json` carries a `_comment` key, so the loader must keep tolerating unknown top-level fields.

## Stages

**A — `render/shapes.ts` and `dev/scenes/shape-chart.ts`.** All 17 shapes plus the orientation constants (`ARC_BITE`, `WEDGE_SOLID`, `QUARTER_IN`, `HALF_FILLS`, `RAMP_ON`, `EDGE_LINE_ON`). The chart scene draws every shape at all four turns plus mirrored, labelled with the font system. Standalone — it calls `appendShape` directly and needs no `Grid`. Vers_2 had an `asciiShapes` CLI purely because reading rotations off a screenshot was too slow; this replaces it with something legible.

**B — `render/grid.ts` and `render/gridMesh.ts`.** `Grid` with the packed-integer key (`(col + 0x8000) << 16 | (row + 0x8000)`, avoiding a string allocation per lookup), dual revisions, memoised `list`/`bounds`/`centre`/`extent`/kind index. `buildGridMesh(grid, cellSize)` centres output on `grid.centre` so a ship drawn at world position P has its hull centred on P with no per-frame translation. Plus `GridMeshCache`, rebuilding only when `geometryRevision` or `cellSize` changes.

**C — `render/components.ts`, `render/hull.ts`, and the `assets/ships/index.ts` fix.** The v2 loader, and the two-line fix to the ships index (its imports resolve once B and C land; its error message still says `engine/hulls`, a Vers_2 path).

**D — `dev/scenes/ship-viewer.ts`.** Hull picker over `HULLS`, cell-size slider, camera fit to the hull's extent, ship name drawn with the font system, and drawn through `InstanceBatch` with a count slider so a fleet is one draw call.

## Files

New: `render/shapes.ts`, `render/grid.ts`, `render/gridMesh.ts`, `render/components.ts`, `render/hull.ts`, `dev/scenes/shape-chart.ts`, `dev/scenes/ship-viewer.ts`.

Tests: `render/grid.test.ts` (keying with negative coordinates, `fill` inclusivity, bounds/centre off-by-one, the two revisions moving independently), `render/hull.test.ts` (rect expansion, leniency, palette resolution, kind defaults and overrides, v1 files still loading), `render/shapes.test.ts` (every shape emits whole triangles; a rotated shape's vertices stay exactly on cell boundaries — the crack-free property).

Modified: `assets/ships/index.ts`.

Reused as-is: `MeshBuilder`/`Mesh`/`VERTEX_LAYOUT`, `InstanceBatch`, `Camera.fit`, `BitmapFont.appendText`, `Pipeline`, `Assert`, and the settings/scene machinery.

## Verification

Per stage, on the running dev server at `/games/space_game`:

- **A** — shape chart screenshot. Check `arc` bites SE at `turns: 0` and steps SE→SW→NW→NE; `wedge` keeps its right angle NW→NE→SE→SW; `halfWedge` sits on N→E→S→W. Confirm mirrored differs from every rotation for the three `MIRRORABLE_SHAPES` and is redundant for the rest.
- **B** — `npx vitest run` for the grid tests. Verify visually that adjacent rotated blocks share edges with no seam.
- **C** — load each of the five ships; console should show no warnings for the four well-formed files. Deliberately corrupt a shape name in a copy and confirm one block drops rather than the ship failing.
- **D** — ship viewer screenshot with each hull. Confirm centring (the hull sits on the origin regardless of whether its JSON uses corner-origin or centred coordinates — `demoShip` and `scytheShip` differ here). Raise the instance count and confirm `draw calls` stays at 1 while `instances` climbs.

Then `npx svelte-check` — the two long-standing `assets/ships` errors should finally be **gone**, leaving zero errors.

## After this

Post-processing: offscreen render targets, render scale, and fullscreen passes — the milestone where textures, samplers and the group-1 material layer finally get built.
