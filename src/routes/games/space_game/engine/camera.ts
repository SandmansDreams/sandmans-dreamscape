import { Mat4, mat4 } from "ts-gl-matrix";

export class Camera {
    x = 0
    y = 0
    zoom = 1

    /**
     * Viewport used by the last `update`, in CSS pixels.
     *
     * Retained so callers can convert screen points or fit content without
     * having to measure the canvas again themselves.
     */
    viewportWidth = 1
    viewportHeight = 1

    readonly projection: Mat4 = mat4.create()

    /**
     * Turns a point in CSS pixels from the canvas's top-left into world space.
     *
     * The inverse of what `update` builds, written out directly rather than by
     * inverting the matrix — it is three operations and stays readable.
     */
    screenToWorld(
        screenX: number,
        screenY: number,
        viewportWidth = this.viewportWidth,
        viewportHeight = this.viewportHeight
    ) {
        const zoom = this.zoom > 0 ? this.zoom : 1

        return {
            x: (screenX - viewportWidth / 2) / zoom + this.x,
            y: (screenY - viewportHeight / 2) / zoom + this.y
        }
    }

    /** Inverse of screenToWorld, for placing overlays over world objects. */
    worldToScreen(
        worldX: number,
        worldY: number,
        viewportWidth = this.viewportWidth,
        viewportHeight = this.viewportHeight
    ) {
        const zoom = this.zoom > 0 ? this.zoom : 1

        return {
            x: (worldX - this.x) * zoom + viewportWidth / 2,
            y: (worldY - this.y) * zoom + viewportHeight / 2
        }
    }

    update(viewportWidth: number, viewportHeight: number) {
        this.viewportWidth = viewportWidth
        this.viewportHeight = viewportHeight

        // A zero or negative zoom divides to Infinity, and ortho() then turns
        // that into a matrix of zeros and NaNs — every vertex collapses and
        // nothing draws, with no GL error to explain it. Clamp instead.
        const zoom = this.zoom > 0 ? this.zoom : 1

        const halfWidth = viewportWidth / zoom / 2
        const halfHeight = viewportHeight / zoom / 2

        mat4.orthoNO(
            this.projection,
            this.x - halfWidth,  this.x + halfWidth,    // left, right
            this.y + halfHeight, this.y - halfHeight,   // bottom, top — flipped
            -1, 1
        )
    }
}
