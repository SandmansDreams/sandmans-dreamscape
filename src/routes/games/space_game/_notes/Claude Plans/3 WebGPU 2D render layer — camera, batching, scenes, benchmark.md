# WebGPU 2D render layer — camera, batching, scenes, benchmark

## Context

The foundation milestone landed: `render/{gpu,frame,buffer,shader,pipeline,loop}.ts` plus `shaders/flat.ts` draw a triangle, and `+page.svelte` runs a real frame loop with a live fps readout. Everything on screen is still hardcoded in clip space — there is no camera, no geometry upload, no way to draw more than one thing, and no harness for trying things out.

This milestone builds the layer that makes the renderer usable: a camera to define a world, meshes to put geometry in it, an instance batch to draw thousands of them, and a scene system to switch between experiments without editing the page. It ends with a benchmark scene that stresses the batch and reports real GPU time, so later optimisation work has a baseline.

Vers_3 solved these same problems in WebGL 2; its designs inform this but nothing is copied — all of it is rewritten, including `settings.ts` and the dev panel.

Decisions taken: camera is **y-down with rotation support**; **settings system and dev panel are rewritten from scratch**; `InstanceBatch` **grows** with a tunable factor rather than dropping instances; the benchmark uses **GPU timestamp queries**, with `dev/performance.ts` built as a general stats collector because more metrics are wanted later.

Delivery is unchanged: complete code in chat, the user types it.

## Design decisions specific to WebGPU

### Camera uniform packing

Rotation rules out the vec4 packing from the last plan, but `mat3x3<f32>` in a uniform buffer is 48 bytes with a 16-byte column stride — a 9-float upload silently corrupts. Two `vec4f` instead: 32 bytes, no padding to reason about.

```wgsl
struct Camera {
    transform: vec4f,  // column-major 2x2 world->clip: (m00, m01, m10, m11)
    offset: vec4f,     // xy = translation, zw = viewport size in pixels
}
```

World is y-down, clip is y-up, so the projection flips y. The flip is a mirror, so **rotation must be composed before it** or the rotation direction inverts: `M = S · R(-θ)` with `S = diag(sx, sy)`, `sx = 2·zoom/width`, `sy = -2·zoom/height`. Translation is the precomputed `-M · position`, so the shader is two multiply-adds and never sees the camera position. `zw` carries the viewport for free — post-processing and pixel snapping will both want it.

Binding: **group 0, binding 0**, matching the frequency convention already in `render/pipeline.ts`.

### Instance layout

```wgsl
struct Instance {
    offset: vec2f,    // world position
    rotation: vec2f,  // (cos, sin) * scale — uniform scale folds into the rotation vector
    color: vec4f,
}
```

32 bytes, align 16, so `array<Instance>` has a 32-byte stride with no implicit padding. This is the layout to keep: a `vec3f` colour would be 12 bytes padded to 16 and is where people lose an afternoon. Folding uniform scale into `(cos·s, sin·s)` is worth keeping from Vers_3 — two floats carry rotation and scale together because scaling `[c -s; s c]` by k gives `[kc -ks; ks kc]`.

Read via `@builtin(instance_index)` from a `var<storage, read>` binding in **group 2**.

### Growth policy

`InstanceBatch` reallocates when full. Growth is `Math.max(needed, Math.ceil(capacity * GROWTH_FACTOR))` with `GROWTH_FACTOR = 1.5` as an exported const — the `max` means a single huge frame jumps straight to the size it needs instead of doubling repeatedly, while normal creep stays amortised. Growing recreates both the `Buffer` **and** the bind group, since a bind group holds a reference to the specific buffer; forgetting the second is the bug that shows stale instances.

## Files

New, in dependency order:

| File | Contents |
|---|---|
| `render/camera.ts` | `Camera` — position, zoom, rotation; `pack(out, width, height)` into an 8-float array; `screenToWorld` / `worldToScreen`; `fit()` |
| `render/mesh.ts` | `VERTEX_LAYOUT` (the single source of truth for the vertex format), `Mesh`, `MeshBuilder` |
| `render/instance.ts` | `INSTANCE_LAYOUT`, `GROWTH_FACTOR`, `InstanceBatch` |
| `render/timing.ts` | `GpuTimer` — query set, resolve buffer, readback ring |
| `dev/performance.ts` | `Stats` — rolling averages and named counters (file exists, currently 0 bytes) |
| `settings/settings.ts` | `SettingSpec`, `SettingsSchema`, `SettingValues`, `ValuesOf`, `defaultValues`, `loadSettings` |
| `render/scene.ts` | `SceneContext`, `SceneInstance`, `SceneDefinition`, `SceneRunner` |
| `dev/DevScene.ts` | `DevSceneDefinition`, `DEV_SCENES` registry via `import.meta.glob` |
| `dev/SettingsPanel.svelte` | Widgets generated from a schema |
| `dev/scenes/benchmark.ts` | The benchmark scene |
| `render/shaders/instanced.ts` | WGSL for camera + instance storage buffer |

Modified: `render/gpu.ts` (request `timestamp-query` when available), `render/frame.ts` (optional `timestampWrites`, draw-call counter), `+page.svelte` (scene picker replaces the hardcoded triangle).

Reused as-is: `dev/assert.ts`, `settings/storage.ts` (`loadStore`/`saveStore`, already `browser`-guarded), and the `Buffer`/`Pipeline`/`Shader`/`Frame` classes from the last milestone.

## Stages

Each stage is a chat delivery followed by a verification pass, so nothing is typed on top of a broken layer.

**Stage A — a world to draw in.** `camera.ts`, `mesh.ts`, `shaders/instanced.ts` (camera-only path first), and a temporary hookup in `+page.svelte` that draws a `MeshBuilder` quad through the camera. Proves the uniform packing and the y-down convention before anything depends on them. `VERTEX_LAYOUT` is exported as a `GPUVertexBufferLayout` so the pipeline descriptor and the WGSL `@location` numbers are declared once — fixing the `ATTR_VERTEX`/`ATTR_COLOR` wart flagged in Vers_3's `mesh.ts`.

**Stage B — many things at once.** `instance.ts` plus the instanced WGSL path. Verified by drawing a grid of a few thousand rotating quads from the page, still without a scene system.

**Stage C — instrumentation.** `timing.ts` and `dev/performance.ts`, and the `gpu.ts`/`frame.ts` changes. `GPU.create` requests `timestamp-query` only when `adapter.features.has(...)`, and `GpuTimer` degrades to reporting `null` when the feature is absent — it must not throw on hardware without it. Readback needs a small ring of mappable buffers because a buffer cannot be re-mapped while a previous `mapAsync` is outstanding; GPU timings therefore lag the displayed frame by 2–3 frames, which is fine for a running average and worth knowing so the number isn't mistrusted.

**Stage D — the harness.** `settings/settings.ts`, `render/scene.ts`, `dev/DevScene.ts`, `dev/SettingsPanel.svelte`, and the `+page.svelte` rewrite. Two details from Vers_3 that were load-bearing and are being kept by design, not by copying: the whole frame body sits in a `try`/`catch` that stops the loop and logs, because an uncaught throw inside a rAF callback otherwise just stalls silently with no message; and the page uses two separate effects — scene selection triggers a full `load()` (dispose + rebuild GPU resources), value changes only call `setValues()` — with `untrack` on the values read so dragging a slider doesn't tear down and rebuild every GPU resource per pointer event.

`SceneInstance.render(frame: Frame)` takes the frame as an argument rather than relying on a bound global. That is also the seam for the post-processing milestone: the runner will later hand scenes a frame that targets an offscreen texture instead of the canvas, and no scene code changes.

**Stage E — the benchmark.** `dev/scenes/benchmark.ts`: N moving, rotating, coloured quads with settings for count, size, zoom and draw mode. Struct-of-arrays simulation on a fixed 1/60 step with an accumulator and render-time interpolation — and the two traps Vers_3 documented, which are easy to reintroduce: seed `prev` equal to `pos` or everything streaks in from the origin on frame one, and wrap `prev` alongside `pos` or a wrapping entity draws a streak across the whole world. Reports CPU frame time, GPU pass time and instance count through `Stats`.

## Verification

Per stage, using the running dev server (`preview_start` with `{name: "dev"}`, already configured in `.claude/launch.json`, port 5173, route `/games/space_game`):

- **A** — screenshot shows a quad where the camera says it should be. Verify y-down explicitly: a vertex at `y = +100` must render *below* centre, not above. Rotate the camera and confirm the direction of travel matches the sign convention documented in `camera.ts`.
- **B** — thousands of quads visible, one draw call. Confirm growth works by setting a count above the initial capacity and checking nothing disappears and nothing throws.
- **C** — `read_console_messages` clean; GPU time reported as a plausible non-zero millisecond figure, and reported as unavailable rather than throwing if the feature is missing.
- **D** — the scene dropdown lists scenes, switching rebuilds, and dragging a slider changes output without a visible rebuild hitch.
- **E** — screenshot at a high count; raise the count until fps drops and confirm GPU time rises with it. If fps stays pinned while GPU time is low, the bottleneck is CPU-side — which is the whole reason for the timestamps.

Also `npx svelte-check --tsconfig ./tsconfig.json` after each stage, and `npx vitest run` — the user has started writing unit tests (`render/buffer.test.ts` covers `align4`), so `camera.ts`'s packing maths and `InstanceBatch`'s growth arithmetic are both worth covering the same way. Both are pure functions of their inputs and need no GPU.

Note: `_Old Versions/` still contributes ~100 `svelte-check` errors and 12 stray Vitest files. Excluding it is a two-line config change and should happen before Stage A so real failures are visible.

## After this milestone

Post-processing (offscreen render targets, render scale, fullscreen passes) and the block grid implementation (`Grid`, block shapes, hull loading), which will also un-break `assets/ships/index.ts`.
