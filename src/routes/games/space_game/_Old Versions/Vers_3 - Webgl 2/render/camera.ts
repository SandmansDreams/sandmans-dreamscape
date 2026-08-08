import { Vector2 } from "../physics/core"

/**
 * A 2D camera over a y-DOWN world.
 *
 * Geometry from shapes.ts is authored with y increasing downward and each
 * cell's origin at its top-left, so the projection flips y on the way to clip
 * space. Doing it here means shapes never have to be written upside down.
 */
export class Camera {
    position: Vector2
    zoom: number

    /** Viewport passed to the last matrix() call, in drawing-buffer pixels. */
    viewportWidth = 1
    viewportHeight = 1

    // Reused so a per-frame camera update allocates nothing.
    private readonly projection = new Float32Array(9)

    constructor(position = new Vector2(), zoom = 1) {
        this.position = position
        this.zoom = zoom
    }

    /**
     * World -> clip, column-major for uniformMatrix3fv.
     *
     * At zoom 1 one world unit is one drawing-buffer pixel, so a `cell` of 40
     * in shapes.ts is 40 pixels tall.
     */
    matrix(viewportWidth: number, viewportHeight: number): Float32Array {
        this.viewportWidth = viewportWidth
        this.viewportHeight = viewportHeight

        // A zero or negative zoom divides to Infinity and collapses every
        // vertex, with no GL error to explain it. Clamp instead.
        const zoom = this.zoom > 0 ? this.zoom : 1

        const sx = (2 * zoom) / viewportWidth
        const sy = (-2 * zoom) / viewportHeight // negative: world y points down

        const out = this.projection
        out[0] = sx; out[1] = 0;  out[2] = 0             // column 0
        out[3] = 0;  out[4] = sy; out[5] = 0             // column 1
        out[6] = -sx * this.position.x                   // column 2
        out[7] = -sy * this.position.y
        out[8] = 1

        return out
    }

    /**
     * Centres on a world-space rect and zooms so it fits, keeping `margin`
     * of the viewport as slack on the tighter axis.
     */
    fit(
        left: number, top: number, right: number, bottom: number,
        viewportWidth: number, viewportHeight: number,
        margin = 0.05
    ) {
        const width = Math.max(right - left, 1e-6)
        const height = Math.max(bottom - top, 1e-6)

        this.position.x = (left + right) / 2
        this.position.y = (top + bottom) / 2

        // Whichever axis runs out of room first decides the zoom
        this.zoom = Math.min(viewportWidth / width, viewportHeight / height) * (1 - margin)
    }

    /**
     * Turns a point in drawing-buffer pixels from the canvas's top-left into
     * world space.
     *
     * The inverse of what matrix() builds, written out directly rather than by
     * inverting the matrix - it is three operations and stays readable.
     */
    screenToWorld(screenX: number, screenY: number): Vector2 {
        const zoom = this.zoom > 0 ? this.zoom : 1

        return new Vector2(
            (screenX - this.viewportWidth / 2) / zoom + this.position.x,
            (screenY - this.viewportHeight / 2) / zoom + this.position.y
        )
    }

    /** Inverse of screenToWorld, for placing overlays over world objects. */
    worldToScreen(worldX: number, worldY: number): Vector2 {
        const zoom = this.zoom > 0 ? this.zoom : 1

        return new Vector2(
            (worldX - this.position.x) * zoom + this.viewportWidth / 2,
            (worldY - this.position.y) * zoom + this.viewportHeight / 2
        )
    }
}
