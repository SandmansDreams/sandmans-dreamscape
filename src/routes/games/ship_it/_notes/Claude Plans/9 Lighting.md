# Lighting

## What exists in the old versions

I read all three. The summary matters, because the assumption that v3 has the best one is wrong:

- **v1 (Canvas)** — `lighting/light.ts`, `shading.ts`, `color.ts`. The complete engine and the only one that ever ran: many lights, a spatial hash so a fleet of engine glows is not gathered per surface, per-entity aggregation of every light into one direction + intensity + tint, `owner` so a ship skips its own mounted light, drawn glow sprites with a cached radial gradient, and an LRU of quantised colour ramps.
- **v2 (WebGL1)** — `engine/shaders.ts`, `LIT_MESH_VERTEX_SHADER`. The same *shading model* moved onto the GPU and, in one respect, improved: it added a multiply mode and argues for it well. **One light only**, passed as uniforms; none of v1's aggregation came across.
- **v3 (WebGPU)** — `render/lights.ts` is an 18-line class with a constructor and no behaviour, and `dev/scenes/light-tests.ts` is an empty file. There is nothing here to port.

So the answer is **both, not either**: v1's aggregation feeding v2's shader.

## The model, which is the part worth keeping

Unchanged from v1, and worth restating because every decision below serves it:

- **One light sample per hull, at its centre.** Direction and intensity are constant across a ship. Everything that varies within the hull comes from the next two terms.
- **A cell's normal is the direction out from the hull's centre.** It treats the ship as a dome. This is why a hull reads as rounded rather than as a flat sprite with a line drawn across it.
- **A radial term** keeps the interior near its base colour and pushes contrast out to the silhouette.
- **Flat per cell, not smooth per vertex.** Every vertex of a cell reports the same cell centre, so the whole cell resolves to one illumination. The blockiness is deliberate — it is what made the Canvas version read as a ship built out of plates.
- **Multiply, not add** (v2's addition). Adding can only raise channels the base is *low* in, which is desaturation by definition: an additive purple on a green hull washes it grey. Filtering removes the hues the light lacks, so the surface darkens and keeps its own colour — which is also what happens to a green object under a purple lamp.

## What has to change for WebGPU

### 1. Cells need to say where their centre is

The shader needs `aCellCentre` — a cell's middle in hull-local space. The current vertex is five floats (x, y, r, g, b) and carries nothing like it, and it cannot be derived: nothing in a finished triangle list says which cell a vertex came from.

**A second vertex buffer, bound only by the lit pipeline.** `MeshBuilder` gains a parallel channel that `appendBlock` fills as it appends — it knows the cell centre at exactly that moment — and `build` hands back both buffers. The unlit pipelines bind only buffer 0 and never see it.

The alternative, widening `VERTEX_LAYOUT` to seven floats, touches all 44 `MeshBuilder` call sites and asks text glyphs and wireframe lines to answer a question they have no answer to. A parallel channel is also how v2 did it, as a separate attribute rather than a fatter vertex.

### 2. The uniforms have a home already

v2 used ten uniforms. In WebGPU that is a bind group — and `Renderer` already reserves **group 1 for materials and binds an empty layout there**. Lighting is its first real occupant, which is the shape that was anticipated when the group was reserved.

### 3. Many lights, without a second shader

v1 aggregated on the CPU and handed the renderer one direction, one intensity and one tint per entity. Do exactly that: a `LightField` in `game/`, pure and testable, with v1's `sample()` — weight each light's direction by its strength so the brightest wins, sum the tint, return nothing when opposed lights cancel.

That keeps the shader identical to v2's single-light version while supporting as many lights as the scene has. The GPU never learns that there was more than one.

**Not ported: the palette machinery.** `ShadePalette`, `SHADE_STEPS`, the interned colour ids and the LRU exist solely because `ctx.fillStyle` took a string and building one per cell per frame was the bottleneck. On the GPU the shading is four instructions. Porting the cache would be porting a workaround for a problem we no longer have.

**Also not ported yet: the spatial hash.** v1 indexed local lights so a surface only gathered nearby ones. With one ship and a sun there is nothing to index; it earns its place when there is a fleet with engine glows, and `sample` is where it slots in when that day comes.

## Where it goes first

`ship-viewer` already has a **"lit" view** — and today it is a lie: `viewRotation` shows that "lit" means *the spinning one*, nothing more. It was named for the lighting that never arrived. That is the first home, and it comes with a spin control already wired, which is exactly what you want for judging a shading model.

The flight sim is second, and is where a moving light and engine glows would actually pay off.

## Files

- `game/lighting.ts` — `Light`, `LightField`, `sample()`. Pure, no GPU. New.
- `game/lighting.test.ts` — aggregation, falloff, cancellation, the dome normal. New.
- `render/shaders/lit2d.ts` — the WGSL port of `LIT_MESH_VERTEX_SHADER`. New.
- `render/mesh.ts` — `MeshBuilder` gains the cell-centre channel; `Mesh` gains a second buffer.
- `render/grid/blockDraw.ts` — `appendBlock` records the cell centre it already knows.
- `render/renderer.ts` — a `lit` pipeline and the group 1 binding.
- `dev/scenes/ship-viewer.ts` — the "lit" view becomes lit.

## Decisions

**Lit is the default for the game, with a toggle for performance.** That settles the rest: the lit path is the primary path, so it is the one that has to be fast, and the unlit pipelines become the fallback rather than the norm.

**Lighting lives in the instanced shader, and only there.** Ships are drawn many at a time in the game this is for, and instancing is how that happens. `ship-flight` moves from its CPU vertex transform to an instanced draw as part of this — which its own comment already anticipated: "One ship of a few thousand triangles is nothing; a fleet would want the uniform instead". One lit shader, no plain-and-instanced pair to drift apart, and the per-frame CPU rotate loop goes away.

**Per-instance light data, not a uniform.** A uniform re-uploaded between draws would hit the `queue.writeBuffer` hazard already documented on the camera binding: writes are ordered against submit, not against the draws recorded between them, so two ships with different light conditions would both read the second write. Group 1 therefore holds a storage buffer of per-hull surface lights indexed by `instance_index`, alongside a uniform of the shading settings. Only the lit pipeline binds it, so nothing else pays for it.

**Everything is in scope this round**: shading, glow sprites, emission, and the flight sim lit as well.
