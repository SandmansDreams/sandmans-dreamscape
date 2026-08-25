# Shared render layer

## Context

The previous round's two jobs are done. Input is a service in `input/` — `actions.ts`, `bindings.ts`, `keys.ts`, `service.ts` — owned above the scenes and reached through `SceneContext`, and `game/input.ts` is deleted. Every component except `hull-plate` now has art; hulls draw as their shapes and never consult `findArt`, which is what `artFor` in `blockDraw.ts` enforces.

That plan's own deferral list named two things, in order: **the shared renderer**, then the game layer. This is the first of those.

The destination is unchanged: a `Game` runtime owns the app — world, systems, camera, input — and the dev scene picker becomes a debug overlay behind the backtick. So the renderer gets built at that altitude too, owned above the scenes, already sitting where `Game` will pick it up. Same move as the input service, for the same reason.

## What is actually duplicated

Measured, not estimated:

- **`MESH_2D` is compiled six times** — `font-preview`, `shape-chart`, `sprite-editor`, `ship-builder`, `ship-flight`, `ship-viewer`. **`INSTANCED_2D` three times**, twice of them inside `ship-viewer` alone (`ship instanced` and `ship wireframe` each call `Shader.createNow` for the same source).
- **There are exactly four distinct pipelines in the whole project**, built twelve times between them:

  | pipeline | shader | layouts | topology | built |
  |---|---|---|---|---|
  | mesh | MESH_2D | camera | triangle-list | 6× |
  | mesh lines | MESH_2D | camera | line-list | 3× |
  | instanced | INSTANCED_2D | camera, empty, instances | triangle-list | 2× |
  | instanced lines | INSTANCED_2D | camera, empty, instances | line-list | 1× |

  The labels differ (`flight solid`, `editor solid`, `sprite solid`, `font text`, `ship overlay`) but the pipelines do not.
- **`CameraBinding.create` runs in all seven scenes**, and `emptyBindGroupLayout` / `InstanceBatch.layout` create a fresh `GPUBindGroupLayout` on every call.
- **Ten sites destroy and recreate a `Mesh` where `Mesh.update` would do** — `ship-builder` (highlight boxes, legal-cell marks, cell boxes), `ship-viewer` (hover, wireframe), `sprite-editor` (lattice, hover, baked layers), `ship-flight` (walls). Several of those rebuild while the pointer moves, so a hover box allocates and frees a GPU buffer per frame.

All of it is rebuilt on every scene swap.

## The shape: a `Renderer`, owned above the scenes

`render/renderer.ts`. Created by `SceneRunner` once it has a device, handed to scenes through `SceneContext` beside `gpu`, `input` and `stats`, and destroyed with the runner rather than with a scene. These are device-lifetime objects; a scene is not.

```ts
export class Renderer {
    readonly gpu: GPU
    /** Shared, because only one scene is alive at a time. */
    readonly camera: CameraBinding

    static create(gpu: GPU): Renderer

    /** Triangles in the shared 2D mesh format. What almost every scene draws. */
    get mesh(): Pipeline
    /** The same vertices as a line list, for outlines and wireframes. */
    get meshLines(): Pipeline
    /** Instanced quads. */
    get instanced(): Pipeline
    get instancedLines(): Pipeline

    /** The layout every InstanceBatch must be created against. */
    readonly instanceLayout: GPUBindGroupLayout

    destroy(): void
}
```

**Named pipelines, not a general cache.** A `pipeline(options)` cache needs a stable key over the shader, the bind group layouts, the vertex buffer layouts and the topology — and three of those are opaque GPU objects with no structural identity, so the key would have to be invented and maintained alongside the real options. Four accessors are the honest description of what exists. A fifth pipeline is one more accessor, and that is a smaller change than a keying scheme that can silently return the wrong pipeline.

**Lazy, not eager.** Each getter builds on first ask and caches. A scene drawing only lines should not compile the instanced shader.

**One caveat worth a loud comment**: the shared `CameraBinding` is a single uniform buffer. `queue.writeBuffer` is ordered against submit, not against recorded draws — the same hazard `ship-viewer` already documents for its instance batches — so a scene that uploads two different cameras within one frame will see both passes read the second upload. That is already true per scene today; sharing the binding does not make it worse, but it does make it everyone's problem, so it belongs in the doc comment rather than in a bug report later.

## `DynamicMesh`

`render/mesh.ts`. `Mesh.update` refuses data past the capacity the mesh was created with, which is why every rebuilding caller destroys and recreates instead. That is the whole reason for the churn.

```ts
/**
 * A mesh whose contents change but whose buffer should not.
 *
 * Keeps its buffer and reallocates only when the data genuinely outgrows it,
 * with headroom so a mesh that creeps upward does not reallocate every step.
 * Empty is a real state: writing nothing draws nothing rather than needing a
 * null mesh and a `?.` at every draw site.
 */
export class DynamicMesh {
    static create(gpu: GPU, label?: string): DynamicMesh
    write(data: Float32Array): void
    draw(frame: Frame): void
    destroy(): void
}
```

Growth is `max(needed, capacity * 2)`, so a mesh that grows steadily reallocates a logarithmic number of times rather than every frame.

This also removes a pattern repeated at every one of those ten sites: `out.length === 0 ? null : Mesh.create(...)`, a nullable field, `mesh?.destroy()`, `mesh = null`, and `mesh?.draw(frame)`. `DynamicMesh` absorbs all five.

## Order of work

1. `render/renderer.ts`, wired into `SceneRunner` and `SceneContext`. Nothing uses it yet.
2. Port scenes one at a time, simplest first — `font-preview`, `shape-chart`, `instanced-quad-spiral`, then `sprite-editor`, `ship-flight`, `ship-builder`, `ship-viewer`. Each port deletes that scene's `Shader.createNow`, `Pipeline.create`, `CameraBinding.create` and its now-unused imports. Verify each in the browser before the next; a wrong pipeline shows up immediately as nothing drawn.
3. `DynamicMesh`, then the ten churn sites, same one-at-a-time rule.
4. Delete `emptyBindGroupLayout` call sites in scenes; it stays exported for the renderer.

Steps 1–2 are pure deletion at the call sites and can land alone. Step 3 is independent of them and could go first if the churn is the more annoying problem.

## Not this round

- **The game layer** — world, entities, systems, and `Game` owning the app. That is next, and it is what turns the scene picker into a debug overlay.
- **Batching or draw-order changes.** The renderer hands out the same pipelines the scenes build today; nothing about how a scene records draws changes.
- **The shaders themselves.** `MESH_2D` and `INSTANCED_2D` are untouched.
- **A material or bind-group-1 concept.** Group 1 is still the empty layout it is today.

## Files

- `render/renderer.ts` — new
- `render/mesh.ts` — `DynamicMesh` added beside `Mesh`
- `render/scene.ts` — `SceneContext.renderer`, `SceneRunner` owns and destroys it
- `dev/scenes/*.ts` — seven scenes lose their pipeline construction
