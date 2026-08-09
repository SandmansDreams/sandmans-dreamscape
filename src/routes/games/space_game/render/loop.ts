// Creates the animation loop and handles fps diagnostics
export class FrameLoop {
    private handle = 0
    private last = 0
    private smoothed = 0
    private shortest = Infinity
    private running = false

    get fps(): number {
        return this.smoothed
    }

    // Estimated display frame budget in ms, taken from the shortest frame seen.
    get budgetMs(): number {
        return Number.isFinite(this.shortest) ? this.shortest * 1000 : 1000 / 60
    }

    start(step: (dt: number) => void): void {
        if (this.running) return
        this.running = true

        this.last = performance.now()

        const tick = (now: number) => {
            if (!this.running) return

            // Clamped: a backgrounded tab resumes with a dt of several seconds which would teleport everything the moment physics exists
            const dt = Math.min((now - this.last) / 1000, 0.1)
            this.last = now

            if (dt > 0) {
                const instant = 1 / dt
                this.smoothed = this.smoothed === 0 ? instant : this.smoothed + (instant - this.smoothed) * 0.1
            }

            /* The shortest frame we ever manage approximates the display's vsync
            interval, which is the real budget. Hardcoding 1/60 would call a 10 ms
            frame healthy on a 120Hz screen. The lower bound stops one anomalously
            hort frame from poisoning the estimate for the rest of the session. */
            if (dt > 0.002 && dt < this.shortest) this.shortest = dt

            this.recent.push(dt)
            if (this.recent.length > 120) this.recent.shift()

            step(dt)
            if (this.running) this.handle = requestAnimationFrame(tick)
        }

        this.handle = requestAnimationFrame(tick)
    }

    stop(): void {
        if (this.handle !== 0) cancelAnimationFrame(this.handle)
        this.handle = 0
    }
}