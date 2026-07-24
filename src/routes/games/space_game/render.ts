import {Vector2} from "./types"

const starColors = [30, 50, 60, 150]

interface Star {
    position: Vector2
    lightness: number,
    radius: number
    color: number
}

export function buildStarMap(mapWidth: number, mapHight: number, density?: number, averageSize?: number): HTMLCanvasElement{
    const area = mapWidth * mapHight
    const starCount = density ? area * (density / 100) : area * .00001;
    const stars: Star[] = []

    for (let s = 0; s < starCount; s++) {
        const star = createRandomStar(mapWidth, mapHight, averageSize)
        stars.push(star)
    }

    const canvas = createStarCanvas(mapWidth, mapHight, stars)
    return canvas
}

function createRandomStar(mapWidth: number, mapHeight: number, averageSize?: number): Star {
    const x = Math.round(Math.random() * mapWidth)
    const y = Math.round(Math.random() * mapHeight)
    const position: Vector2 = new Vector2(x, y)

    const lightness = Math.round(Math.random() * 100)
    const radius = Math.round(Math.pow(Math.random(), averageSize || 3) * (averageSize || 3) + 0.5)
    const color = starColors[Math.floor(Math.random() * starColors.length)] // Random HSL hue

    return {position, lightness, radius, color}
}

function createStarCanvas(mapWidth: number, mapHeight: number, stars: Star[]) {
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    canvas.width = mapWidth
    canvas.height = mapHeight

    if (!context) {
        throw new Error("Could not create canvas context in createStarCanvas in render.ts")
    }

    for (const star of stars) {
        drawStar(context, star)
    }

    return canvas
}

function drawStar(context: CanvasRenderingContext2D, star: Star) {
    const { x, y } = star.position
    const outerRadius = star.radius
    // How pinched the waist of the star is. Smaller = pointier spikes.
    const innerRadius = outerRadius * 0.28
 
    const gradient = context.createRadialGradient(
        x, y, 0,
        x, y, outerRadius
    )
 
    gradient.addColorStop(0, `hsla(${star.color}, 100%, ${star.lightness}%, 1)`)
    gradient.addColorStop(1, `hsla(${star.color}, 100%, 0%, 0)`)
 
    context.fillStyle = gradient
 
    context.beginPath()
    for (let i = 0; i < 8; i++) {
        const angle = (Math.PI / 4) * i - Math.PI / 2
        const r = i % 2 === 0 ? outerRadius : innerRadius
        const px = x + Math.cos(angle) * r
        const py = y + Math.sin(angle) * r
 
        if (i === 0) {
            context.moveTo(px, py)
        } else {
            context.lineTo(px, py)
        }
    }
    context.closePath()
    context.fill()
}