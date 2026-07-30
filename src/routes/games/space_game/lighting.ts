import { Vector2 } from "./physics"
import type { Camera } from "./types"

export class LightSource {
    constructor(
        public position: Vector2,
        public color: string = "#fffbe6",
        public intensity: number = 1.0,
        public radius: number = 80
    ) {}

    draw(ctx: CanvasRenderingContext2D, camera: Camera) {
        const { x, y } = camera.worldToScreen(
            this.position.x, this.position.y,
            ctx.canvas.clientWidth, ctx.canvas.clientHeight
        )

        ctx.save()
        ctx.translate(x, y)
        ctx.scale(camera.zoom, camera.zoom)

        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius)
        glow.addColorStop(0, this.color)
        glow.addColorStop(0.3, "rgba(255, 251, 200, 0.6)")
        glow.addColorStop(1, "rgba(255, 251, 200, 0)")

        ctx.globalCompositeOperation = "lighter"
        ctx.beginPath()
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2)
        ctx.fillStyle = glow
        ctx.fill()
        ctx.globalCompositeOperation = "source-over"

        ctx.beginPath()
        ctx.arc(0, 0, this.radius * 0.15, 0, Math.PI * 2)
        ctx.fillStyle = "#fff"
        ctx.fill()

        ctx.restore()
    }
}

export interface GridLightInfo {
    dirX: number
    dirY: number
    strength: number
}

export function computeGridLight(
    shipPosition: Vector2,
    shipRotation: number,
    light: LightSource,
    gridRotationOffset: number = 0
): GridLightInfo {
    const dx = light.position.x - shipPosition.x
    const dy = light.position.y - shipPosition.y
    const dist = Math.hypot(dx, dy)

    const worldAngle = Math.atan2(dy, dx)
    const localAngle = worldAngle - shipRotation - gridRotationOffset

    const falloff = Math.min(1, 5000 / Math.max(dist, 1))

    return {
        dirX: Math.cos(localAngle),
        dirY: Math.sin(localAngle),
        strength: light.intensity * falloff
    }
}

export function computeAsteroidLight(
    asteroidPosition: Vector2,
    light: LightSource
): { angle: number, strength: number } {
    const dx = light.position.x - asteroidPosition.x
    const dy = light.position.y - asteroidPosition.y
    const dist = Math.hypot(dx, dy)
    const falloff = Math.min(1, 5000 / Math.max(dist, 1))

    return {
        angle: Math.atan2(dy, dx),
        strength: light.intensity * falloff
    }
}

// --- HSL helpers ---

export function hexToHSL(hex: string): [number, number, number] {
    let r: number, g: number, b: number

    if (hex.startsWith("#")) {
        hex = hex.slice(1)
    }

    // Handle named colors by drawing to a tiny canvas
    if (!/^[0-9a-fA-F]{3,8}$/.test(hex)) {
        return namedColorToHSL(hex)
    }

    if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16) / 255
        g = parseInt(hex[1] + hex[1], 16) / 255
        b = parseInt(hex[2] + hex[2], 16) / 255
    } else {
        r = parseInt(hex.slice(0, 2), 16) / 255
        g = parseInt(hex.slice(2, 4), 16) / 255
        b = parseInt(hex.slice(4, 6), 16) / 255
    }

    return rgbToHSL(r, g, b)
}

const namedColorCache = new Map<string, [number, number, number]>()
let scratchCtx: CanvasRenderingContext2D | null = null

function namedColorToHSL(name: string): [number, number, number] {
    const cached = namedColorCache.get(name)
    if (cached) return cached

    if (!scratchCtx) {
        const c = document.createElement("canvas")
        c.width = 1
        c.height = 1
        scratchCtx = c.getContext("2d")!
    }

    scratchCtx.fillStyle = name
    scratchCtx.fillRect(0, 0, 1, 1)
    const [r, g, b] = scratchCtx.getImageData(0, 0, 1, 1).data
    const hsl = rgbToHSL(r / 255, g / 255, b / 255)
    namedColorCache.set(name, hsl)
    return hsl
}

function rgbToHSL(r: number, g: number, b: number): [number, number, number] {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2

    if (max === min) return [0, 0, l]

    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    let h = 0
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6

    return [h * 360, s * 100, l * 100]
}

export function hslToString(h: number, s: number, l: number): string {
    return `hsl(${h}, ${s}%, ${l}%)`
}

export function adjustColorForLight(
    color: string,
    cellX: number,
    cellY: number,
    centerX: number,
    centerY: number,
    lightInfo: GridLightInfo
): string {
    const relX = cellX - centerX
    const relY = cellY - centerY
    const len = Math.hypot(relX, relY)
    if (len === 0) return color

    const nX = relX / len
    const nY = relY / len

    // Dot product gives directional facing (-1 shadow, +1 lit)
    const dot = nX * lightInfo.dirX + nY * lightInfo.dirY

    // Radial falloff: cells farther from center get more contrast
    const maxRadius = 60
    const radialFactor = Math.min(len / maxRadius, 1)

    const [h, s, l] = hexToHSL(color)

    // Blend directional and radial: lit side brightens, shadow side darkens,
    // but the effect is smooth and gradient-like rather than hard-edged
    const directionalShift = dot * lightInfo.strength * 18 * radialFactor
    const ambientDarken = (1 - (dot + 1) / 2) * lightInfo.strength * 8 * radialFactor
    const shift = directionalShift - ambientDarken
    const newL = Math.max(5, Math.min(95, l + shift))

    const warmth = Math.max(0, dot) * lightInfo.strength * 10 * radialFactor
    const newS = Math.max(0, Math.min(100, s + warmth))

    return hslToString(h, newS, newL)
}
