import { Vector2 } from "./physics";
import type { Camera } from "./types";

export const CELL_SIZE = 5

export function getDistance(a: Vector2, b: Vector2) {
    return  Math.hypot(b.x - a.x, b.y - a.y)
}

/** A point drawn uniformly from the box [-xMax, xMax] x [-yMax, yMax]. */
export function getRandomVector(xMax: number, yMax: number) {
    return new Vector2(
        (Math.random() * 2 - 1) * xMax,
        (Math.random() * 2 - 1) * yMax
    )
}

export function isVisible(x: number, y: number, radius: number, canvas: HTMLCanvasElement, camera: Camera): boolean {
    let halfWidth = (canvas.clientWidth / 2) / camera.zoom;
    let halfHeight = (canvas.clientHeight / 2) / camera.zoom;

    // The renderer applies camera.rotation as a whole-canvas rotation, so the
    // visible world region is a rotated rectangle. Testing against the
    // circumscribed square keeps entities from popping mid-transition.
    if (camera.rotation !== 0) {
        const halfDiagonal = Math.hypot(halfWidth, halfHeight);
        halfWidth = halfDiagonal;
        halfHeight = halfDiagonal;
    }

    const left = camera.position.x - halfWidth;
    const right = camera.position.x + halfWidth;
    const top = camera.position.y - halfHeight;
    const bottom = camera.position.y + halfHeight;

    return x + radius > left && x - radius < right && y + radius > top && y - radius < bottom;
}

export function getPositionFromEvent(event: MouseEvent, canvas: HTMLCanvasElement, camera: Camera) {
    const rect = canvas.getBoundingClientRect()

    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top

    return camera.screenToWorld(screenX, screenY, canvas.clientWidth, canvas.clientHeight)
}

export function resizeCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const width = Math.round(rect.width * dpr)
    const height = Math.round(rect.height * dpr)

    // Resize the backing buffer to match the displayed size
    canvas.width = width;
    canvas.height = height;

    // Reset any previous transforms and scale for HiDPI displays
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function getRandomIntFromRange(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Shortest signed rotation from `from` to `to`, in (-PI, PI].
 *
 * Every steering and turret-aiming routine needs this; they each used to
 * inline the same atan2(sin, cos) wrap.
 */
export function angleDelta(from: number, to: number): number {
    const error = to - from
    return Math.atan2(Math.sin(error), Math.cos(error))
}