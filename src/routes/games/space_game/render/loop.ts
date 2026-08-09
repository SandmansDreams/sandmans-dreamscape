// Creates the animation loop and handles fps diagnostics
export class FrameLoop {
    private handle = 0
    private last = 0
    private smoothed = 0
    private running = false

    private readonly recent: number[] = [] // Recent frame times in seconds

    get fps(): number {
        return this.smoothed
    }

    // Estimated display frame budget in ms
    get budgetMs(): number {
        // Too few samples to judge - assume 60Hz rather than report something wild
        if (this.recent.length < 20) return 1000 / 60

        /* The 10th percentile, not the minimum. rAF occasionally fires two callbacks
        almost back to back, and a running minimum would latch onto that gap and go on
        claiming the display runs at 300Hz for the rest of the session. */
        const sorted = [...this.recent].sort((a, b) => a - b)
        return sorted[Math.floor(sorted.length * 0.1)]! * 1000
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

            // Roughly two seconds of history, which is what budgetMs reads
            this.recent.push(dt)
            if (this.recent.length > 120) this.recent.shift()

            step(dt)

            // step() may have called stop(). Re-check before rescheduling, or a scene that halts the loop from inside a frame gets restarted anyway.
            if (this.running) this.handle = requestAnimationFrame(tick)
        }

        this.handle = requestAnimationFrame(tick)
    }

    stop(): void {
        this.running = false
        if (this.handle !== 0) cancelAnimationFrame(this.handle)
        this.handle = 0
    }
}