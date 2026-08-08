# WebGPU 2D render layer — foundation milestone

## Context

`space_game` has been rewritten three times (Canvas → WebGL 1 → WebGL 2, all in `_Old Versions/`) and is now on WebGPU. The active tree is at step zero: `+page.svelte` is a 249-line single file containing the webgpufundamentals compute-shader sample (doubles `[1,3,5]` in a storage buffer and logs it). There is **no render pipeline anywhere in the project** — `createRenderPipeline` is never called, no `.wgsl` files exist, and the canvas draws nothing. The one `render()` function in the page is dead code.

The goal is to stop writing raw WebGPU calls in the component and build a class layer that turns WebGPU's low-level primitives into game-facing ones. WebGPU makes this more valuable than it was in WebGL: pipelines are immutable baked state objects, bind groups replace uniform locations, and everything goes through explicit command encoders — a lot of ceremony per draw that belongs behind an API.

**This milestone stops at a cleanly layered triangle.** The classes are designed so the next milestone (instanced hull rendering via storage buffers) drops in without reworking them, but the only thing on screen at the end is one triangle proving the architecture works.

Decisions taken: code is delivered **in chat for the user to type** (not written to files); the CPU-side modules from Vers_3 (Grid, shapes, hull, camera) are **rewritten from scratch** later, not ported; per-instance data will use **storage buffers** indexed by `@builtin(instance_index)`.

## Architecture

New directory `src/routes/games/space_game/render/`. Six small modules, each absorbing one category of WebGPU ceremony:

| Module | Class | Absorbs |
|---|---|---|
| `render/gpu.ts` | `GPU` | adapter/device/context/format handshake, canvas sizing, device-loss reporting, frame kickoff |
| `render/frame.ts` | `Frame` | command encoder + render pass lifecycle, `submit()` |
| `render/buffer.ts` | `Buffer` | usage-flag combinations, `writeBuffer` offsets, sizing to 4-byte multiples |
| `render/shader.ts` | `Shader` | module creation **plus async compilation diagnostics** |
| `render/pipeline.ts` | `Pipeline` | pipeline descriptor boilerplate, blend presets, bind group layouts |
| `render/loop.ts` | `FrameLoop` | rAF, delta time, fps averaging |

Existing code to reuse: **`dev/assert.ts`** (`Assert.exists` / `Assert.that`, both real `asserts` signatures) — every class uses it for precondition checks rather than hand-rolled throws.

### Bind group frequency convention

Decide this now, at the triangle, because it determines whether `Pipeline` can use `layout: 'auto'`. With `'auto'`, bind groups **cannot be shared between pipelines** — the camera would have to be re-bound per pipeline, which breaks as soon as there's more than one material. So `Pipeline` takes explicit `GPUBindGroupLayout`s, organised by update frequency:

- **group 0** — per frame: camera matrix, time, viewport size
- **group 1** — per material: textures, samplers, material constants
- **group 2** — per draw: instance storage buffer

The triangle only needs group 0 (or none at all), but the layout arrives already correct.

### Uniform alignment

WGSL uniform structs follow 16-byte alignment rules, and `mat3x3<f32>` is **48 bytes with a 16-byte column stride** — not 36. This silently corrupted transforms is the single most common WebGPU 2D bug. The camera therefore will not use a mat3 the way Vers_3's `transform.ts` did; it packs the 2D view as a `vec4<f32>` of `(scaleX, scaleY, offsetX, offsetY)`, 16 bytes, no padding to reason about. Noted here because it constrains the camera rewrite that follows.

## Steps

Each step is delivered as complete code in the chat response with explanation of the non-obvious parts; the user types it into the files.

**1. `render/gpu.ts` — `GPU`**
- `static async create(canvas: HTMLCanvasElement): Promise<GPU>` — requests adapter, requests device, asserts support with a real message, gets the `"webgpu"` context, configures with `navigator.gpu.getPreferredCanvasFormat()`.
- Attaches `device.lost.then(...)` and `device.onuncapturederror` so validation errors surface instead of producing a black canvas.
- Private `ResizeObserver` on the canvas: sets `canvas.width/height` from `devicePixelContentBoxSize`, clamped to `device.limits.maxTextureDimension2D`. The context does **not** need reconfiguring on resize — a common misconception worth explaining, and it's why `+page.svelte`'s CSS-only sizing currently gives a blurry buffer.
- `beginFrame(clear?): Frame`, `destroy()`, plus `width` / `height` / `aspect` getters.

**2. `render/frame.ts` — `Frame`**
- Created by `GPU.beginFrame()`. Calls `context.getCurrentTexture().createView()` **inside the frame, never cached** — the swap-chain texture rotates every frame, and holding one is the second classic WebGPU bug.
- Chainable `setPipeline()`, `setBindGroup()`, `setVertex()`, `draw(vertexCount, instanceCount = 1)`, and `end()` which calls `pass.end()`, `encoder.finish()` and `queue.submit()`.

**3. `render/buffer.ts` — `Buffer`**
- Static factories `vertex()`, `index()`, `uniform()`, `storage()` that pick the right `GPUBufferUsage` flags (each one `| COPY_DST`, which is what `writeBuffer` requires and what people forget).
- `write(data, offsetBytes = 0)`, `destroy()`, `handle`, `size`. Rounds sizes up to 4-byte multiples.

**4. `render/shader.ts` — `Shader`**
- Wraps `createShaderModule`, and exposes `async check()` over `getCompilationInfo()` that formats messages with line/column and throws on `"error"`.
- This is the highest-value wrapper in the set: **WGSL compile errors do not throw** — you get a broken pipeline and a black screen with nothing in the console unless you ask for the compilation info.
- Also export a no-op `wgsl` tagged template so shader source gets editor highlighting (the same trick as the existing `/* wgsl */` comment).

**5. `render/pipeline.ts` — `Pipeline`**
- `static create(gpu, options)` taking `{ label, shader, vertexEntry, fragmentEntry, layouts, vertexBuffers, blend, topology }`.
- `blend` presets: `"none" | "alpha" | "additive"` expanded into the verbose `GPUBlendState` — alpha blending must be declared on the pipeline's fragment target in WebGPU, there is no global blend switch like WebGL's.
- Targets `gpu.format` automatically. Helper `bindGroup(index, entries, label?)`.

**6. `render/shaders/flat.ts`** — the triangle's WGSL: hardcoded clip-space positions from `@builtin(vertex_index)`, flat colour out. No buffers, no bindings, so a failure here can only be pipeline or pass setup.

**7. `render/loop.ts` — `FrameLoop`** — `start(cb: (dt: number) => void)` / `stop()`, tracks smoothed fps. Wires up the dev HUD in `+page.svelte`, which currently shows `-1 fps` in red permanently because the `setInterval` feeding it is commented out at line 153.

**8. Rewrite `+page.svelte`'s script** — delete the compute-shader demo and the dead `render()` function; `onMount` becomes: create `GPU`, build the triangle `Pipeline`, start the `FrameLoop`, and return a cleanup that stops the loop and destroys the device. The existing `void (async () => {…})()` shape stays (with its parens — that bug already bit once).

**9. Optional housekeeping** — `svelte-check` currently reports **100 errors, all from `_Old Versions/` and the broken `assets/ships/index.ts`** (which imports `../../render/grid` and `../../render/hull`, paths that only exist in Vers_3). That noise will bury real errors in the new code. Either add `"exclude": ["src/routes/games/space_game/_Old Versions"]` to `tsconfig.json` or rename the folder so TypeScript skips it. Vitest also picks up the 12 archived test files for the same reason.

## Reference mapping

Relevant webgpufundamentals articles per step: [Fundamentals](https://webgpufundamentals.org/webgpu/lessons/webgpu-fundamentals.html) (steps 1–2, 6), [Inter-stage Variables](https://webgpufundamentals.org/webgpu/lessons/webgpu-inter-stage-variables.html) (step 6), [Uniforms](https://webgpufundamentals.org/webgpu/lessons/webgpu-uniforms.html) and [Storage Buffers](https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html) (step 3, and the instancing milestone after this one), [Vertex Buffers](https://webgpufundamentals.org/webgpu/lessons/webgpu-vertex-buffers.html) (step 5's `vertexBuffers` option).

## Verification

1. `preview_start` with `{name: "dev"}` — `.claude/launch.json` already defines it (npm run dev, port 5173).
2. Navigate to `http://localhost:5173/games/space_game`.
3. `read_console_messages` — expect zero errors. Specifically confirm no "Assertion Failed" from the WebGPU support check and no uncaptured validation errors from the new `onuncapturederror` handler.
4. `computer {action: "screenshot"}` — expect a visible triangle on the dark background, and the dev panel showing a real fps number rather than `-1`.
5. Resize the window via `resize_window` and re-screenshot — the triangle should stay crisp, confirming the `ResizeObserver` drives the drawing-buffer size.
6. `npx svelte-check --tsconfig ./tsconfig.json` — no new errors under `render/` or `+page.svelte`.

Risk: if the in-app preview browser lacks WebGPU, the support assertion fires and nothing renders. Fall back to verifying in real Chrome before concluding the code is wrong.

## After this milestone

In order: `Camera` (vec4-packed 2D view, group 0 uniform) → `MeshBuilder` + `Mesh` (CPU triangle accumulation → vertex buffer) → `Grid` and block `shapes` rewrite → `InstanceBatch` on a storage buffer → hull JSON loading, which also un-breaks `assets/ships/index.ts` and puts a ship on screen.
