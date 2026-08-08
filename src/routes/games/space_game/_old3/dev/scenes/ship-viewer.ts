import { buildHull, HULLS } from "../../../assets/ships";
import { Camera } from "../../../render/camera";
import { DEFAULT_FONT } from "../../../render/font";
import type { Grid } from "../../../render/grid";
import { buildGridMesh } from "../../../render/gridMesh";
import { Mesh } from "../../../render/mesh";
import { MINIMAL_2D_FRAGMENT_SOURCE, MINIMAL_2D_VERTEX_SOURCE, Program, Shader } from "../../../render/shaders";
import type { SettingsSchema, ValuesOf } from "../../../settings/settings";
import type { SceneContext, SceneInstance } from "../../../render/scenes";
import type { DevSceneDefinition } from "../DevScene";

/**
 * Every hull in assets/ships, one at a time, fitted to the viewport.
 *
 * Adapted from the old three-batch viewer, which drew each hull flat, lit and
 * as a wireframe at once. Both extra copies are gone for now: the lit one waits
 * on the lighting engine, and the wireframe waits on gridOutline being ported.
 * What is left is one hull, one mesh, one draw.
 *
 * Deliberately not an InstancedBatch. The old scene used three because it drew
 * three copies; instancing one object costs a second buffer and a divisor to
 * save nothing. A plain Mesh with the camera's transform is the whole job.
 */

type Color = readonly [number, number, number]

const LABEL_COLOR: Color = [0.55, 0.60, 0.65]

/**
 * World units per cell.
 *
 * Arbitrary on its own, because the camera fits whatever comes out - it only
 * sets the ratio between the hull and the label drawn under it.
 */
const CELL = 40

/** Gap between the hull and its stat line, in world units. */
const LABEL_GAP = CELL * 0.6

/**
 * Ship ids rather than display names.
 *
 * The panel shows a selection's option strings verbatim, so the option has to
 * be the thing stored. Ids come from filenames, which makes them unique by
 * construction and stable when a hull's `name` field is edited - neither of
 * which is true of the names. The pretty name goes on the canvas instead.
 */
const SHIP_IDS: readonly string[] = HULLS.map(entry => entry.id)

const SETTINGS = {
    ship:       { type: "selection", label: "Ship",       default: SHIP_IDS[0] ?? "", options: SHIP_IDS },
    resolution: { type: "range",     label: "Resolution", default: 1,    min: 0.05, max: 1,   step: 0.05 },
    padding:    { type: "range",     label: "Padding",    default: 0.05, min: 0,    max: 0.4, step: 0.01 },
    stats:      { type: "checkbox",  label: "Stats",      default: true },
} as const satisfies SettingsSchema

type ShipValues = ValuesOf<typeof SETTINGS>

/** One hull, tessellated once at construction. */
interface ShipView {
    id: string
    name: string
    grid: Grid
    mesh: Float32Array
    /** Half the hull's world size. buildGridMesh centres on the grid's centre,
     *  so the mesh spans exactly +/- these on each axis. */
    halfWidth: number
    halfHeight: number
}

interface Bounds {
    left: number
    top: number
    right: number
    bottom: number
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), high)
}

/** Name, then the numbers worth checking a tessellation against. */
function statLines(view: ShipView): string[] {
    const { width, height } = view.grid.extent

    return [
        view.name,
        // Plain ASCII separators: the sheets only carry code points 32-126, so
        // anything prettier would come out as the missing-glyph box.
        `${view.grid.count} cells - ${view.mesh.length / 5 / 3} tris - ${width}x${height}`,
    ]
}

class ShipViewer implements SceneInstance<ShipValues> {
    private readonly gl2: WebGL2RenderingContext
    private readonly canvas: HTMLCanvasElement
    private readonly program: Program
    private readonly camera = new Camera()

    private readonly ships: ShipView[]

    /** Kept for the hull's lifetime and re-uploaded on a ship change - the
     *  attribute layout never moves, so the VAO survives. */
    private readonly hull: Mesh
    private label: Mesh | null = null

    private bounds: Bounds = { left: 0, top: 0, right: 1, bottom: 1 }
    private padding = 0.05
    private builtKey = ""

    constructor(
        private readonly context: SceneContext
    ) {
        this.gl2 = context.gl2
        this.canvas = context.canvas

        this.program = new Program(this.gl2, [
            new Shader(this.gl2, this.gl2.VERTEX_SHADER, MINIMAL_2D_VERTEX_SOURCE),
            new Shader(this.gl2, this.gl2.FRAGMENT_SHADER, MINIMAL_2D_FRAGMENT_SOURCE),
        ])

        // Tessellating every hull up front is microseconds for a handful of
        // ships and makes paging between them instant.
        this.ships = HULLS.map(entry => {
            const grid = buildHull(entry.id)
            const extent = grid.extent

            return {
                id: entry.id,
                name: entry.name,
                grid,
                mesh: buildGridMesh(grid, CELL),
                halfWidth: extent.width * CELL / 2,
                halfHeight: extent.height * CELL / 2,
            }
        })

        // An empty array is a legal Mesh - zero vertices, and draw() is a no-op.
        // Better than refusing to construct when assets/ships is empty.
        this.hull = new Mesh(this.gl2, new Float32Array(0), this.gl2.DYNAMIC_DRAW)
    }

    update(dt: number, settings: ShipValues): void {
        this.context.setRenderScale(settings.resolution)

        // Read every frame: it only affects the fit, so it never rebuilds.
        this.padding = settings.padding

        const view = this.ships.find(ship => ship.id === settings.ship) ?? this.ships[0]
        if (!view) return

        // The font sheet arrives asynchronously, so `loaded` is part of the key:
        // the first build runs before the fetch returns and draws no label.
        const key = `${view.id}/${settings.stats}/${DEFAULT_FONT.loaded}`
        if (key === this.builtKey) return

        this.rebuild(view, settings.stats)
        this.builtKey = key
    }

    render(): void {
        // Refit every frame so a window resize reframes the ship for free.
        const { left, top, right, bottom } = this.bounds
        this.camera.fit(left, top, right, bottom, this.canvas.width, this.canvas.height, this.padding)

        this.program.use()
        this.gl2.uniformMatrix3fv(
            this.program.uniform("u_Transform"),
            false,
            this.camera.matrix(this.canvas.width, this.canvas.height)
        )

        // Same program and the same uniform, so the second draw costs a bind
        // and a drawArrays - cheaper than copying the hull into a new array
        // every time the label changes.
        this.hull.draw()
        this.label?.draw()
    }

    dispose(): void {
        this.label?.dispose()
        this.hull.dispose()
        this.program.dispose()
    }

    private rebuild(view: ShipView, showStats: boolean) {
        this.hull.update(view.mesh)

        this.label?.dispose()
        this.label = null

        this.bounds = {
            left: -view.halfWidth,
            top: -view.halfHeight,
            right: Math.max(view.halfWidth, 1),
            bottom: Math.max(view.halfHeight, 1),
        }

        if (!showStats) return

        const out: number[] = [] // interleaved [x, y, r, g, b]
        const lines = statLines(view)

        // Scaled so the widest line spans the hull rather than a fixed size,
        // which keeps the label proportionate across ships of very different
        // sizes. Clamped so a tall narrow hull does not shrink it to nothing.
        const widest = Math.max(...lines.map(line => DEFAULT_FONT.measureText(line, 1)), 1)
        const pixel = clamp(view.halfWidth * 2 / widest, CELL / 60, CELL / 14)

        let y = view.halfHeight + LABEL_GAP
        let labelWidth = 0

        for (const line of lines) {
            const width = DEFAULT_FONT.measureText(line, pixel)
            labelWidth = Math.max(labelWidth, width)

            // Centred per line rather than as a block, so a short name sits
            // over the middle of a long stat line instead of hanging left.
            DEFAULT_FONT.appendText(out, line, -width / 2, y, pixel, ...LABEL_COLOR)
            y += DEFAULT_FONT.lineAdvance * pixel
        }

        // Nothing came out, which means the sheet has not loaded yet.
        if (out.length === 0) return

        this.label = new Mesh(this.gl2, new Float32Array(out))

        this.bounds.left = Math.min(this.bounds.left, -labelWidth / 2)
        this.bounds.right = Math.max(this.bounds.right, labelWidth / 2)
        // The last lineAdvance overshoots by the line spacing; the descender
        // then hangs below what measureTextHeight would have counted.
        this.bounds.bottom = y - DEFAULT_FONT.lineSpacing * pixel + DEFAULT_FONT.descent * pixel
    }
}

const scene: DevSceneDefinition<ShipValues> = {
    id: "ship-viewer",
    name: "Ship Viewer",
    description: "Every hull in assets/ships, loaded through the palette format and tessellated into one mesh. Drop a JSON in that folder and it appears here. Stats draws the name, cell count, triangle count and extent under the hull.",
    settings: SETTINGS,
    create: (context: SceneContext) => new ShipViewer(context),
}

export default scene
