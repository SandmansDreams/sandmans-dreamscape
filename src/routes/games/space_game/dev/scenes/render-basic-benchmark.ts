import type { DevSceneDefinition, DevSceneInstance, SceneContext } from "../DevScene"
import type { Settings } from "../../settings"
import { Program, Shader, MINIMAL_2D_VERTEX_SOURCE, MINIMAL_2D_FRAGMENT_SOURCE } from "../../render/shaders"
import { Mesh, MeshBuilder } from "../../render/mesh"
import { quad } from "../../render/shapes"
import { aspectScale2D, rotation2D } from "../../render/transform"

class SquaresScene implements DevSceneInstance {
    private readonly program: Program
    private mesh: Mesh | null = null
    private builtCount = -1     // rebuild only when the setting changes
    private spin = true
    private time = 0

    constructor(private readonly context: SceneContext) {
        const gl2 = context.gl2
        this.program = new Program(gl2, [
            new Shader(gl2, gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SOURCE),
            new Shader(gl2, gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
        ])
    }

    update(dt: number, settings: Settings) {
        this.time += dt
        this.spin = settings.boolean("spin")

        const count = settings.number("count")
        if (count !== this.builtCount) {
            this.mesh?.dispose()
            this.mesh = this.build(count)
            this.builtCount = count
        }
    }

    render() {
        const { gl2, canvas } = this.context
        const aspect = canvas.width / canvas.height

        this.program.use()
        gl2.uniformMatrix3fv(
            this.program.uniform("u_Transform"),
            false,
            this.spin ? rotation2D(this.time * 0.2, aspect) : aspectScale2D(aspect),
        )
        this.mesh?.draw()
    }

    dispose() {
        this.mesh?.dispose()
        this.program.dispose()
    }

    private build(count: number): Mesh {
        const builder = new MeshBuilder()

        for (let i = 0; i < count; i++) {
            // Golden-angle spiral - even coverage, no visible rings, deterministic
            const angle = i * 2.39996323
            const radius = 0.95 * Math.sqrt(i / count)
            const x = Math.cos(angle) * radius
            const y = Math.sin(angle) * radius

            const shade = 0.3 + 0.7 * (i / count)
            builder.add(quad(x, y, 0.02), [shade, 0.4, 1 - shade])
        }

        return builder.build(this.context.gl2)
    }
}

const scene: DevSceneDefinition = {
    id: "render-basic-benchmark",
    name: "Basic Squares Benchmark",
    description: "A field of squares in a single draw call, rotating as one mesh. Measures vertex throughput rather than draw-call overhead.",
    settings: [
        { type: "range",    key: "count", label: "Squares", default: 1000, min: 1, max: 50000, step: 1 },
        { type: "checkbox", key: "spin",  label: "Rotate",  default: true },
    ],
    create: (context: SceneContext) => new SquaresScene(context),
}

export default scene
