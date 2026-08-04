/**
 * Frame timing, sampled over a window rather than per frame.
 *
 * Two numbers, because they answer different questions. `fps` is vsync-locked,
 * so it reads 60 whether a frame took 1ms or 15ms and only moves once frames
 * are already being dropped. `workMs` is time spent inside the tick body — the
 * actual budget consumption, and the number that shows work getting cheaper.
 */
export class FrameStats {
    fps = 0
    workMs = 0
    drawCalls = 0

    private frames = 0
    private workAccum = 0
    private drawAccum = 0
    private windowStart = 0
    private frameStart = 0

    begin(now: number) {
        this.frameStart = now
        if (this.windowStart === 0) this.windowStart = now
    }

    /**
     * Closes a frame.
     *
     * @returns true when a new sample is ready, so callers only touch the DOM
     *          a few times a second — writing a text node every frame triggers
     *          layout and shows up in the measurement itself.
     */
    end(now: number, drawCalls = 0, windowMs = 250): boolean {
        this.workAccum += now - this.frameStart
        this.drawAccum += drawCalls
        this.frames++

        const elapsed = now - this.windowStart
        if (elapsed < windowMs) return false

        this.fps = (this.frames * 1000) / elapsed
        this.workMs = this.workAccum / this.frames
        this.drawCalls = this.drawAccum / this.frames

        this.frames = 0
        this.workAccum = 0
        this.drawAccum = 0
        this.windowStart = now
        return true
    }
}
