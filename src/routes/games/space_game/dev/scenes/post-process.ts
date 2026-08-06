import { Mesh, MeshBuilder, type Color } from "../../render/mesh"
import { FullscreenPass } from "../../render/passes"
import { CHROMATIC_ABERRATION_2D_FRAGMENT_SOURCE, CRT_SCANLINES_FRAGMENT_SOURCE, MINIMAL_2D_FRAGMENT_SOURCE, MINIMAL_2D_VERTEX_SOURCE, Program, Shader } from "../../render/shaders"
import { quad, triangle } from "../../render/shapes"
import { RenderTarget } from "../../render/targets"
import { aspectScale2D } from "../../render/transform"
import type { SettingsSchema, ValuesOf } from "../../settings/settings"
import type { DevSceneDefinition, DevSceneInstance, SceneContext } from "../DevScene"

const SETTINGS = {
    effect:        { type: "selection", label: "Effect",     default: "chromatic", options: ["chromatic", "scanlines"] },
    pattern:       { type: "selection", label: "Pattern",    default: "grid",      options: ["grid", "bars", "triangle"] },
    intensity:     { type: "range",     label: "Aberration", default: 0.02, min: 0,  max: 0.1, step: 0.001 },
    falloff:       { type: "range",     label: "Falloff",    default: 1,    min: 0,  max: 4,   step: 0.1 },
    crtIntensity:  { type: "range",     label: "CRT",        default: 0.5,  min: 0,  max: 1,   step: 0.01 },
    scanlineCount: { type: "range",     label: "Scanlines",  default: 200,  min: 20, max: 600, step: 10 },
    speed:         { type: "range",     label: "Speed",      default: 1,    min: 0,  max: 4,   step: 0.1 },
    animate:       { type: "checkbox",  label: "Animate",    default: true },
} as const satisfies SettingsSchema

type PostValues = ValuesOf<typeof SETTINGS>

function buildPattern(gl2: WebGL2RenderingContext, pattern: string): Mesh {
    const builder = new MeshBuilder()

    if (pattern === "triangle") {
        builder.add(triangle(0, 0, 1.3), [1, 1, 1])
        return builder.build(gl2)
    }

    if (pattern === "bars") {
        for (let i = 0; i < 9; i++) {
            builder.add(quad(-0.85 + (1.7 * i) / 8, 0, 0.08), [1, 1, 1])
        }
        return builder.build(gl2)
    }

    const n = 7 // "grid"
    for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
            const x = -0.85 + (1.7 * col) / (n - 1)
            const y = -0.85 + (1.7 * row) / (n - 1)
            const lit: Color = (row + col) % 2 === 0 ? [1, 1, 1] : [0.12, 0.12, 0.12]
            builder.add(quad(x, y, 0.16), lit)
        }
    }
    return builder.build(gl2)
}

class PostProcessScene implements DevSceneInstance<PostValues> {
    private readonly program: Program
    private readonly chromatic: FullscreenPass
    private readonly scanlines: FullscreenPass
    private readonly gl2: WebGL2RenderingContext
    private mesh: Mesh
    private builtPattern: string
    private time = 0
    private effect = "chromatic"
    private intensity = 0
    private crtIntensity = 0
    private falloff = 1
    private scanlineCount = 200

    constructor(
        private readonly context: SceneContext,
    ) {
        this.gl2 = context.gl2

        this.program = new Program(this.gl2, [
            new Shader(this.gl2, this.gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SOURCE),
            new Shader(this.gl2, this.gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
        ])

        // Both passes are cheap to hold, so build them up front and switch at draw time
        this.chromatic = new FullscreenPass(this.gl2, CHROMATIC_ABERRATION_2D_FRAGMENT_SOURCE)
        this.scanlines = new FullscreenPass(this.gl2, CRT_SCANLINES_FRAGMENT_SOURCE)

        this.builtPattern = "grid"
        this.mesh = buildPattern(this.gl2, this.builtPattern)
    }

    update(dt: number, settings: PostValues) {
        if (settings.animate) {
            this.time += dt * settings.speed
        }

        this.effect = settings.effect
        this.intensity = settings.intensity
        this.crtIntensity = settings.crtIntensity
        this.falloff = settings.falloff
        this.scanlineCount = settings.scanlineCount

        const pattern = settings.pattern
        if (pattern !== this.builtPattern) { // rebuild only when it actually changes
            this.mesh.dispose()
            this.mesh = buildPattern(this.gl2, pattern)
            this.builtPattern = pattern
        }
    }

    render() { // Draws into the harness's target, not the canvas
        const { canvas } = this.context

        this.program.use()
        this.gl2.uniformMatrix3fv(
            this.program.uniform("u_Transform"),
            false,
            aspectScale2D(canvas.width / canvas.height),
        )
        this.mesh.draw()
    }

    present(target: RenderTarget) { // Target -> effect -> canvas
        const { gl2, canvas } = this.context

        RenderTarget.bindCanvas(gl2, canvas.width, canvas.height)

        const scanlines = this.effect === "scanlines"
        const pass = scanlines ? this.scanlines : this.chromatic

        // Uniforms the active shader doesn't declare resolve to null, and
        // setting a null location is a defined no-op
        pass.draw(target, (program) => {
            gl2.uniform2f(program.uniform("u_Resolution"), canvas.width, canvas.height)
            gl2.uniform1f(program.uniform("u_Time"), this.time)
            gl2.uniform1f(program.uniform("u_Intensity"), scanlines ? this.crtIntensity : this.intensity)
            gl2.uniform1f(program.uniform("u_Falloff"), this.falloff)
            gl2.uniform1f(program.uniform("u_ScanlineCount"), this.scanlineCount)
        })
    }

    dispose() {
        this.mesh.dispose()
        this.program.dispose()
        this.chromatic.dispose()
        this.scanlines.dispose()
    }
}

const scene: DevSceneDefinition<PostValues> = {
    id: "post-process",
    name: "Post Processing",
    description: "Chromatic aberration and CRT scanlines over a high-contrast pattern. Falloff controls how fast the aberration grows toward the corners.",
    settings: SETTINGS,
    create: (context) => new PostProcessScene(context),
}
export default scene
