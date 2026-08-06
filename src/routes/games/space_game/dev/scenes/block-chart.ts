import { Camera } from "../../render/camera";
import { appendText, GLYPH_HEIGHT, measureText } from "../../render/font";
import { Mesh } from "../../render/mesh";
import { MINIMAL_2D_FRAGMENT_SOURCE, MINIMAL_2D_VERTEX_SOURCE, Program, Shader } from "../../render/shaders";
import { appendShape, BLOCK_SHAPES, type BlockShape, MIRRORABLE_SHAPES } from "../../render/shapes";
import type { SettingsSchema, ValuesOf } from "../../settings/settings";
import type { DevSceneDefinition, DevSceneInstance, SceneContext } from "../DevScene";

const SETTINGS = {
    gap: { type: "range", label: "Gap", default: 8, min: 0, max: 25, step: 1 },
} as const satisfies SettingsSchema

type ChartValues = ValuesOf<typeof SETTINGS>

const BACKDROP_COLOR: [number, number, number] = [0.10, 0.10, 0.10]

const ROW_COLORS: [number, number, number][] = [
    [0.35, 0.65, 1.00],   // blue
    [1.00, 0.55, 0.25],   // orange
    [0.45, 0.85, 0.45],   // green
    [1.00, 0.45, 0.70],   // pink
    [0.95, 0.85, 0.35],   // yellow
    [0.35, 0.90, 0.90],   // cyan
    [0.70, 0.50, 1.00],   // purple
    [1.00, 0.40, 0.40],   // red
    [0.30, 0.75, 0.65],   // teal
    [0.75, 0.95, 0.35],   // lime
    [0.85, 0.65, 0.45],   // tan
    [0.60, 0.75, 1.00],   // periwinkle
    [0.95, 0.60, 0.85],   // magenta
    [0.55, 0.90, 0.70],   // mint
]

const TURN_COUNT = 4
const CELL = 40 // world units per cell; at camera zoom 1 that is 40 pixels

const LABEL_COLOR: [number, number, number] = [0.55, 0.60, 0.65]
const FONT_PIXEL = 3  // world units per font pixel, so a glyph is 15 x 21
const LABEL_GAP = 12  // between a label and the cell it names

class BlockChart implements DevSceneInstance<ChartValues> {
    private readonly canvas: HTMLCanvasElement
    private readonly gl2: WebGL2RenderingContext
    private readonly program: Program
    private readonly camera = new Camera()

    private mesh: Mesh | null = null
    private bounds = { left: 0, top: 0, right: 1, bottom: 1 }
    private builtGap = -1

    constructor(
        private readonly context: SceneContext
    ) {
        this.gl2 = context.gl2
        this.canvas = context.canvas

        // Every cell has different geometry, so there is nothing to instance -
        // the whole chart bakes into one static mesh and one draw call.
        this.program = new Program(this.gl2, [
            new Shader(this.gl2, this.gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SOURCE),
            new Shader(this.gl2, this.gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
        ])
    }

    update(dt: number, settings: ChartValues): void {
        const gap = settings.gap

        if (gap !== this.builtGap) {
            this.rebuild(gap)
            this.builtGap = gap
        }
    }

    render(): void {
        if (!this.mesh) return

        // Refit every frame so a window resize reframes the chart for free.
        const { left, top, right, bottom } = this.bounds
        this.camera.fit(left, top, right, bottom, this.canvas.width, this.canvas.height)

        this.program.use()
        this.gl2.uniformMatrix3fv(
            this.program.uniform("u_Transform"),
            false,
            this.camera.matrix(this.canvas.width, this.canvas.height)
        )

        this.mesh.draw()
    }

    dispose(): void {
        this.mesh?.dispose()
        this.program.dispose()
    }

    private rebuild(gap: number) {
        const built = this.build(gap, CELL)

        this.mesh?.dispose()
        this.mesh = new Mesh(this.gl2, built.vertices)
        this.bounds = built.bounds
    }

    private pushBackdrop(
        out: number[],
        left: number, top: number, right: number, bottom: number,
        r: number, g: number, b: number
    ) {
        out.push(
            left, top, r, g, b,
            right, top, r, g, b,
            right, bottom, r, g, b,

            left, top, r, g, b,
            right, bottom, r, g, b,
            left, bottom, r, g, b
        )
    }

    build(gap: number, cell: number = CELL) {
        const out: number[] = [] // interleaved [x, y, r, g, b]
        const step = cell + gap // Distance to next cell
        const shapes = BLOCK_SHAPES

        const anyMirrored = shapes.some(shape => MIRRORABLE_SHAPES.includes(shape))
        const columns = anyMirrored ? TURN_COUNT * 2 : TURN_COUNT

        // Left edge
        const columnX = (turn: number, mirrored: boolean) => (mirrored ? TURN_COUNT + turn : turn) * step + (mirrored ? gap : 0)

        const groupsFor = (shape: BlockShape): boolean[] => MIRRORABLE_SHAPES.includes(shape) ? [false, true] : [false]

        // Backdrops first, so every shape paints over its own cell. There is no
        // depth test - later triangles simply cover earlier ones.
        for (let row = 0; row < shapes.length; row++) {
            for (const mirrored of groupsFor(shapes[row])) {
                for (let turn = 0; turn < TURN_COUNT; turn++) {
                    const x = columnX(turn, mirrored)
                    const y = row * step
                    this.pushBackdrop(out, x, y, x + cell, y + cell, ...BACKDROP_COLOR)
                }
            }
        }

        for (let row = 0; row < shapes.length; row++) {
            const [r, g, b] = ROW_COLORS[row % ROW_COLORS.length]
            const shape = shapes[row]

            for (const mirrored of groupsFor(shape)) {
                for (let turn = 0; turn < TURN_COUNT; turn++) {
                    appendShape(out, shape, turn, mirrored, columnX(turn, mirrored), row * step, cell, r, g, b)
                }
            }
        }

        // Shape name to the left of each row, right-aligned against the grid
        const [lr, lg, lb] = LABEL_COLOR
        const glyphHeight = GLYPH_HEIGHT * FONT_PIXEL
        let widestLabel = 0

        for (let row = 0; row < shapes.length; row++) {
            const width = measureText(shapes[row], FONT_PIXEL)
            widestLabel = Math.max(widestLabel, width)

            appendText(
                out, shapes[row],
                -LABEL_GAP - width,                    // right edge sits LABEL_GAP from the grid
                row * step + (cell - glyphHeight) / 2, // vertically centred on the cell
                FONT_PIXEL, lr, lg, lb
            )
        }

        // Turn number above each column; M marks the mirrored group
        const headerTop = -LABEL_GAP - glyphHeight

        for (const mirrored of anyMirrored ? [false, true] : [false]) {
            for (let turn = 0; turn < TURN_COUNT; turn++) {
                const text = (mirrored ? "M" : "T") + turn
                const width = measureText(text, FONT_PIXEL)
                const centre = columnX(turn, mirrored) + cell / 2

                appendText(out, text, centre - width / 2, headerTop, FONT_PIXEL, lr, lg, lb)
            }
        }

        return {
            vertices: new Float32Array(out),
            bounds: {
                left: -LABEL_GAP - widestLabel,
                top: headerTop,
                right: columns * step - gap + (anyMirrored ? gap : 0),
                bottom: Math.max(1, shapes.length) * step - gap,
            },
        }
    }
}

const scene: DevSceneDefinition<ChartValues> = {
    id: "block-chart",
    name: "Block Chart",
    description: "Every block shape (rows) in all four turns, plus mirrored variants for the shapes that need them. Auto-fits to the viewport.",
    settings: SETTINGS,
    create: (context: SceneContext) => new BlockChart(context),
}

export default scene
