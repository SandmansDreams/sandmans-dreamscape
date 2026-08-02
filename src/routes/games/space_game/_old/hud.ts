/**
 * Screen-space overlays drawn on top of world entities.
 *
 * These are drawn in unrotated, unscaled screen coordinates so they stay
 * upright and legible whatever the entity is doing.
 */

const BAR_HEIGHT = 3
const BAR_GAP = 8
const BAR_WIDTH_FACTOR = 0.8

/**
 * Draws a health bar above an entity. No-op at full health, so callers can
 * call it unconditionally.
 *
 * @param screenX,screenY the entity's centre in screen pixels
 * @param radius the entity's world-space radius
 * @param zoom the camera zoom, to size the bar with the entity
 */
export function drawHealthBar(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    radius: number,
    zoom: number,
    current: number,
    max: number
) {
    if (max <= 0 || current >= max) return

    const pct = Math.max(0, Math.min(1, current / max))

    const width = radius * 2 * zoom * BAR_WIDTH_FACTOR
    const x = screenX - width / 2
    const y = screenY - radius * zoom - BAR_GAP

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)"
    ctx.fillRect(x, y, width, BAR_HEIGHT)

    ctx.fillStyle = `rgb(${Math.round(255 * (1 - pct))}, ${Math.round(255 * pct)}, 50)`
    ctx.fillRect(x, y, width * pct, BAR_HEIGHT)
}
