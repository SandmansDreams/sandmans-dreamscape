import { Vector2 } from "./physics";
import type { Camera } from "./types";

export const CELL_SIZE = 5

export function getDistance(a: Vector2, b: Vector2) {
    return  Math.hypot(b.x - a.x, b.y - a.y)
}

export function getRandomVector(xMax: number, yMax: number) {
    const xNegative = Math.random() < 0.5
    const yNegative = Math.random() < 0.5
    const x = xNegative ? -Math.random() * xMax : Math.random() * xMax
    const y = yNegative ? -Math.random() * yMax : Math.random() * yMax

    return new Vector2(x, y)
}

export function isVisible(x: number, y: number, radius: number, canvas: HTMLCanvasElement, camera: Camera): boolean {
    const halfWidth = (canvas.clientWidth / 2) / camera.zoom;
    const halfHeight = (canvas.clientHeight / 2) / camera.zoom;

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