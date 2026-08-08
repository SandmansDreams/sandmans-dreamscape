// Creates the animation loop and handles fps diagnostics
export class FrameLoop {
    private handle = 0
    private last = 0
    private smoothed = 0

    get fps(): number {
        return this.smoothed
    }

    start(step: (dt: number) => void): void {
        if (this.handle !== 0) return
        this.last = performance.now()

        const tick = (now: number) => {
            // Clamped: a backgrounded tab resumes with a dt of several seconds which would teleport everything the moment physics exists
            const dt = Math.min((now - this.last) / 1000, 0.1)
            this.last = now

            if (dt > 0) {
                const instant = 1 / dt
                this.smoothed = this.smoothed === 0 ? instant : this.smoothed + (instant - this.smoothed) * 0.1
            }

            step(dt)
            this.handle = requestAnimationFrame(tick)
        }

        this.handle = requestAnimationFrame(tick)
    }

    stop(): void {
        if (this.handle !== 0) cancelAnimationFrame(this.handle)
        this.handle = 0
    }
}