# Space Game — WebGL2 Renderer

A from-scratch WebGL2 2D renderer, plus a dev harness for testing pieces of it in isolation.

Route: `/games/space_game`

---

## Running it

```bash
npm run dev
```

Then open `http://localhost:5173/games/space_game`.

The dev panel is on by default. Press **`` ` ``** (backtick) to toggle it.

To hide it outside `vite dev`, change `+page.svelte`:

```ts
let devMode = $state(import.meta.env.DEV)
```

Typecheck everything (catches missing exports before the browser does):

```bash
npx svelte-check --tsconfig ./tsconfig.json
```

> `_old2/` is dead code from the previous version. It has ~43 errors. Ignore it, or delete it.

---

## How a frame works

```
DevHarness.frame(now)
  │
  ├─ syncCanvasSize()          canvas → CSS size × devicePixelRatio
  │
  ├─ target.bind()             draws now land in an offscreen texture
  ├─ clear()
  ├─ instance.update(dt, settings)
  ├─ instance.render()         scene geometry, via Program + Mesh
  │
  └─ instance.present(target)  ← if the scene defines one
     └─ else harness's present callback (passthrough → canvas)
```

Two rules follow from this:

1. **Scenes never draw to the canvas.** `render()` draws into whatever framebuffer the harness bound — the offscreen `RenderTarget`. Only `present()` touches the canvas.
2. **Whoever binds a destination sets the viewport.** `RenderTarget.bind()` and `RenderTarget.bindCanvas()` both do. Don't call `gl.viewport()` anywhere else.

---

## The two shader families

These can never be mixed. Pairing them wrong gives `FRAGMENT varying v_UV does not match any VERTEX varying` at link time.

| | **Scene** — draws geometry | **Fullscreen** — draws an image |
|---|---|---|
| vertex source | `MINIMAL_2D_VERTEX_SOURCE` | `FULLSCREEN_VERTEX_SOURCE` |
| vertex inputs | `a_Vertex`, `a_Color` from a VAO | none — built from `gl_VertexID` |
| varying | `flat out vec4 v_Color` | `out vec2 v_UV` |
| fragment inputs | `flat in vec4 v_Color` | `in vec2 v_UV`, `sampler2D u_Scene` |
| drawn by | `Program` + `Mesh.draw()` | `FullscreenPass.draw()` |
| how many | one pair | **one** vertex shader, many fragment shaders |

`FullscreenPass` takes only a fragment shader — the vertex stage is baked in, so it can't be paired wrong.

---

## Module reference

### `assert.ts`

```ts
Assert.exists(value, "name")        // throws if null/undefined, narrows the type
Assert.that(condition, "reason")    // throws if false, narrows the condition
```

Both are TypeScript assertion functions, so the compiler narrows after the call. Pass the name explicitly — it's what appears in the error.

### `physics/core.ts`

`Vector2` — mutating and chainable (`add`, `subtract`, `multiply` modify in place and return `this`). Use `.clone()` before mutating something you don't own.

### `render/shapes.ts`

Pure geometry. Returns flat `[x, y, x, y, ...]` triangle lists in clip space, **no colour**.

```ts
quad(x, y, size)      // 2 triangles, 12 numbers
triangle(x, y, size)  // 1 triangle, apex up, 6 numbers
```

### `render/mesh.ts`

```ts
const mesh = new MeshBuilder()
    .add(quad(0, 0, 0.5), [1, 1, 1])       // white square
    .add(triangle(0.5, 0, 0.2), [1, 0, 0]) // red triangle
    .build(gl2)

mesh.draw()
mesh.dispose()   // required — frees the VAO and VBO
```

`MeshBuilder.add(verts, color)` copies the colour onto **every** vertex of the shape. That matters: the shaders use `flat` shading, which takes the colour of the triangle's *last* vertex. Copying it to all three makes the result independent of that.

Vertex layout is `[x, y, r, g, b]` — 5 floats, 20-byte stride, attribute location 0 for position and 1 for colour.

Colours are **0.0–1.0 floats**, not 0–255.

### `render/transform.ts`

Column-major `mat3`, which is what `uniformMatrix3fv` expects.

```ts
IDENTITY_2D                      // no transform
aspectScale2D(aspect)            // squashes x so squares stay square
rotation2D(radians, aspect = 1)  // CCW rotation, aspect-corrected
```

**Always apply aspect correction.** Clip space is −1..1 on both axes regardless of canvas shape, so without it everything stretches horizontally on a wide window. `aspect` is `canvas.width / canvas.height`.

### `render/shaders.ts`

`Shader` — compiles one GLSL string. Throws with the driver's log on failure.

`Program` — links a `Shader[]`.

```ts
const program = new Program(gl2, [
    new Shader(gl2, gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SOURCE),
    new Shader(gl2, gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
])

program.use()
gl2.uniformMatrix3fv(program.uniform("u_Transform"), false, matrix)
program.dispose()
```

`uniform(name)` caches lookups and returns `null` for uniforms that don't exist or were optimised out. Setting a null location is a defined no-op, so it's safe to set uniforms a shader may not declare — that's how one `present()` can feed two different effect shaders.

`Buffer` — wraps a VBO. `Mesh` owns one; you rarely need it directly.

Shader sources available:

| Constant | Family | Notes |
|---|---|---|
| `MINIMAL_2D_VERTEX_SOURCE` | scene | requires `u_Transform` |
| `MINIMAL_2D_FRAGMENT_SOURCE` | scene | flat per-face colour |
| `FULLSCREEN_VERTEX_SOURCE` | fullscreen | shared by every post pass |
| `PASSTHROUGH_FRAGMENT_SOURCE` | fullscreen | copies the scene unchanged |
| `CHROMATIC_ABERRATION_2D_FRAGMENT_SOURCE` | fullscreen | `u_Time`, `u_Intensity`, `u_Falloff` |
| `CRT_SCANLINES_FRAGMENT_SOURCE` | fullscreen | `u_Time`, `u_Intensity`, `u_ScanlineCount` |

> `u_Transform` has no default. A scene program that never sets it gets a zero matrix and draws nothing.

### `render/targets.ts`

```ts
const target = new RenderTarget(gl2, width, height)  // filter defaults to NEAREST

target.bind()                                     // draws land here
RenderTarget.bindCanvas(gl2, canvas.width, canvas.height)  // draws land on screen
target.resize(width, height)                      // no-op if unchanged
```

Wrap mode is `CLAMP_TO_EDGE`, which post effects that sample neighbours depend on. With the default `REPEAT`, the chromatic aberration's edge samples wrap to the opposite side of the screen.

### `render/passes.ts`

```ts
const pass = new FullscreenPass(gl2, CRT_SCANLINES_FRAGMENT_SOURCE)

pass.draw(target, (program) => {
    gl2.uniform1f(program.uniform("u_Intensity"), 0.5)
})

pass.dispose()
```

`u_Scene` is bound automatically to texture unit 0. The `configure` callback runs after that and before the draw.

### `settings.ts`

A dev scene declares a schema; the panel renders it; the scene reads values back.

```ts
type SettingSchema =
    | { type: "range";     key, label, default: number,  min, max, step? }
    | { type: "checkbox";  key, label, default: boolean }
    | { type: "selection"; key, label, default: string,  options: readonly string[] }
```

```ts
settings.number("count")     // throws if the value isn't a number
settings.boolean("spin")
settings.string("pattern")
```

`defaultValues(schema)` builds the initial value record.

---

## Adding a dev scene

Drop a file in `dev/scenes/`. It's picked up automatically — `import.meta.glob` scans the folder, so there's no index to update. The only requirement is a **default export** of a `DevSceneDefinition`.

```ts
import type { DevSceneDefinition, DevSceneInstance, SceneContext } from "../DevScene"
import type { Settings } from "../../settings"
import { Program, Shader, MINIMAL_2D_VERTEX_SOURCE, MINIMAL_2D_FRAGMENT_SOURCE } from "../../render/shaders"
import { Mesh, MeshBuilder } from "../../render/mesh"
import { quad } from "../../render/shapes"
import { aspectScale2D } from "../../render/transform"

class MyScene implements DevSceneInstance {
    private readonly program: Program
    private mesh: Mesh

    constructor(private readonly context: SceneContext) {
        const gl2 = context.gl2

        this.program = new Program(gl2, [
            new Shader(gl2, gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SOURCE),
            new Shader(gl2, gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
        ])

        this.mesh = new MeshBuilder()
            .add(quad(0, 0, 0.5), [1, 1, 1])
            .build(gl2)
    }

    update(dt: number, settings: Settings) {
        // dt is seconds, clamped to 0.1 so a tab-out doesn't jump the sim
    }

    render() {
        const { gl2, canvas } = this.context

        this.program.use()
        gl2.uniformMatrix3fv(
            this.program.uniform("u_Transform"),
            false,
            aspectScale2D(canvas.width / canvas.height),
        )
        this.mesh.draw()
    }

    dispose() {          // called on every scene switch
        this.mesh.dispose()
        this.program.dispose()
    }
}

const scene: DevSceneDefinition = {
    id: "my-scene",
    name: "My Scene",
    description: "What this is for.",
    settings: [
        { type: "range", key: "size", label: "Size", default: 0.5, min: 0.1, max: 1, step: 0.01 },
    ],
    create: (context) => new MyScene(context),
}
export default scene
```

### The definition/instance split

`DevSceneDefinition` is plain data plus a `create()` factory. It contains no WebGL, so the menu and settings panel can be built before the GL context exists. `DevSceneInstance` owns GPU resources and is created on load, disposed on switch.

### Rules

- **Use `import type` for anything from `../DevScene`.** That file globs the scenes, and the scenes import back from it. Type imports are erased so there's no runtime cycle; a value import creates a real one and fails at module init.
- **`dispose()` must free everything.** Scene switching calls it every time. A leaked VAO per switch adds up fast.
- **Rebuild meshes only when inputs change**, not every frame — settings are read every frame:

```ts
const count = settings.number("count")
if (count !== this.builtCount) {
    this.mesh?.dispose()
    this.mesh = this.build(count)
    this.builtCount = count
}
```

### Optional hooks

```ts
present?(target: RenderTarget): void       // take over presentation (post-processing scenes)
resize?(width: number, height: number): void
```

---

## Adding a post-processing effect

1. Write a fragment shader. It must declare `in vec2 v_UV` and `uniform sampler2D u_Scene`, and write to an `out vec4`.
2. Build a pass: `new FullscreenPass(gl2, MY_FRAGMENT_SOURCE)`.
3. Override `present()` in the scene, or pass it as the harness's default in `+page.svelte`.

```ts
present(target: RenderTarget) {
    const { gl2, canvas } = this.context

    RenderTarget.bindCanvas(gl2, canvas.width, canvas.height)

    this.pass.draw(target, (program) => {
        gl2.uniform2f(program.uniform("u_Resolution"), canvas.width, canvas.height)
        gl2.uniform1f(program.uniform("u_Time"), this.time)
    })
}
```

**`u_Resolution` is the size of the framebuffer you're drawing *into*** — the canvas for a final pass — because `gl_FragCoord` is in destination pixels. Passing the scene target's size instead will centre and scale the effect wrong.

Chaining two effects needs two targets and ping-pong (A→B, B→canvas). Not built yet.

---

## Conventions

| | |
|---|---|
| GLSL variables | `u_Name` uniform, `a_Name` attribute, `v_Name` varying |
| Coordinates | clip space, −1..1, +y up |
| Colours | `[r, g, b]` floats 0.0–1.0 |
| Winding | CCW (`CULL_FACE` is off, so it doesn't currently matter) |
| Time | seconds; `dt` clamped to 0.1 |

---

## Known issues

- **The render loop stops after one frame.** Under investigation as of the last session. The harness now catches exceptions in `frame()` and logs `DevHarness: scene threw, loop stopped.` — check the browser console, since an uncaught error in a `requestAnimationFrame` callback silently ends the loop by never rescheduling.
- **`Program.dispose()` deletes its `Shader` objects.** Don't share a `Shader` instance between two `Program`s.
- Effect shaders live in `shaders.ts`. Splitting them into `render/effects.ts` would keep `shaders.ts` about the plumbing.
- `MINIMAL_2D_*` and `CHROMATIC_ABERRATION_2D_*` carry a `2D` that means nothing — especially on a fullscreen pass.
- Dead code: `Shape` and `Triangle` in `shapes.ts`, `Light` in `lights.ts` (not exported), `Scene`/`Camera` in `scenes.ts` (unused by the harness, and `Camera.postion` is misspelled), `Assert.unpack`.
- No camera or projection yet — `aspectScale2D` is a placeholder for a real orthographic projection with pan and zoom.
- `renderScale` on `DevHarness` scales the offscreen target while the canvas stays full resolution. That's the path to fixed-resolution pixel art, but nothing sets it to anything but 1 yet.
