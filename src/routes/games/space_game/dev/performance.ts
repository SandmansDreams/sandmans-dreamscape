// Collects per-frame metrics for the dev panel

export type StatUnit = "ms" | "count"

export interface StatEntry {
    name: string
    latest: number
    average: number
    unit: StatUnit
}

// One tracked number and its exponentially smoothed average
class Metric {
    latest = 0
    average = 0
    private seeded = false

    constructor(readonly unit: StatUnit) {}

    push(value: number, weight = 0.1): void {
        this.latest = value
        // The first sample seeds the average outright, otherwise every metric spends its first second crawling up from zero and reads as a false improvement
        this.average = this.seeded ? this.average + (value - this.average) * weight : value
        this.seeded = true
    }
}

export class Stats {
    // Insertion-ordered, so panel rows appear in the order they were first recorded
    private readonly metrics = new Map<string, Metric>()
    private readonly marks = new Map<string, number>()

    set(name: string, value: number, unit: StatUnit = "count"): void {
        let metric = this.metrics.get(name)
        if (!metric) {
            metric = new Metric(unit)
            this.metrics.set(name, metric)
        }
        metric.push(value)
    }

    /**
     * Forgets every metric.
     *
     * Metrics belong to whatever recorded them, so a scene swap has to wipe the
     * slate - otherwise the old scene's rows sit in the panel forever, frozen at
     * their last value and looking like live readings.
     */
    clear(): void {
        this.metrics.clear()
        this.marks.clear()
    }

    begin(name: string): void {
        this.marks.set(name, performance.now())
    }

    end(name: string): void {
        const start = this.marks.get(name)
        if (start === undefined) return // end() without begin() - ignore rather than throw
        this.marks.delete(name)
        this.set(name, performance.now() - start, "ms")
    }

    // Read this on a timer rather than every frame
    entries(): StatEntry[] {
        return [...this.metrics].map(([name, metric]) => ({
            name,
            latest: metric.latest,
            average: metric.average,
            unit: metric.unit,
        }))
    }
}