<script lang="ts">
    import { shapeSvgPath } from "./shapeSVG"
    import { DEFAULT_BRUSH, type Brush } from "./brush"
    import { DRAWN_SHAPES } from "../render/grid/palette"
    import { SHIP_LAYERS } from "../render/grid/layers"
    import { COMPONENT_KINDS, maxLevel, type ComponentKind } from "../render/grid/components"
    import { turnCount, variantCount, type BlockShape } from "../render/grid/shapes"

    /**
     * The ship editor's brush.
     *
     * Owned here rather than in the settings bag, so a field can be the type that
     * suits it - facing is a plain 0-3 rather than the string a selection setting
     * would have forced - and so there is only ever one control per property.
     */
    let { brush = $bindable(), palette = [] }: {
        brush: Brush
        /** Hex colors currently used in the ship, published by the scene. */
        palette?: string[]
    } = $props()

    const FACINGS = ["N", "E", "S", "W"] as const
    const TOOLS = ["paint", "erase"] as const

    function set(patch: Partial<Brush>) {
        // Replaced rather than mutated, so the parent's effect sees a new object
        brush = { ...brush, ...patch }
    }

    function selectShape(shape: BlockShape) {
        // Orientation resets with the shape: turn 3 of a wedge means nothing once
        // you have switched to a circle, and carrying it over is confusing
        set({ shape, turns: 0, mirrored: false })
    }

    /**
     * One step through every distinct state of the current shape.
     *
     * Indices at or past turnCount mean mirrored, so R walks four rotations and
     * then the four mirrored ones - rotation alone can never produce a mirror
     * image, and a symmetric hull needs both hands of a ramp. On a `full` block
     * this does nothing, because it has exactly one distinct state.
     */
    function rotate() {
        const turns = turnCount(brush.shape)
        const next = ((brush.mirrored ? turns + brush.turns : brush.turns) + 1) % variantCount(brush.shape)

        set({ turns: next % turns, mirrored: next >= turns })
    }

    function step<T>(list: readonly T[], current: T, by: number): T {
        const index = list.indexOf(current)
        return list[(index + by + list.length) % list.length]!
    }

    function onKey(event: KeyboardEvent) {
        // Typing a ship name must not rotate blocks and change layers
        const target = event.target as HTMLElement | null
        if (target?.isContentEditable) return
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

        switch (event.key) {
            case "r": case "R": rotate(); break
            case "m": case "M": set({ mirrored: !brush.mirrored }); break
            case "ArrowLeft": selectShape(step(DRAWN_SHAPES, brush.shape, -1)); break
            case "ArrowRight": selectShape(step(DRAWN_SHAPES, brush.shape, 1)); break
            case "ArrowUp": set({ layer: step(SHIP_LAYERS, brush.layer, -1) }); break
            case "ArrowDown": set({ layer: step(SHIP_LAYERS, brush.layer, 1) }); break
            default: return
        }

        // Arrows scroll the page otherwise
        event.preventDefault()
    }
</script>

<svelte:window onkeydown={onKey} />

<div class="builder">
    <span class="section">Layer &mdash; up/down</span>
    <div class="row">
        {#each SHIP_LAYERS as name (name)}
            <button type="button" class:active={brush.layer === name} onclick={() => set({ layer: name })}>
                {name}
            </button>
        {/each}
    </div>

    <span class="section">Tool</span>
    <div class="row">
        {#each TOOLS as name (name)}
            <button type="button" class:active={brush.tool === name} onclick={() => set({ tool: name })}>
                {name}
            </button>
        {/each}
    </div>

    <span class="section">Block &mdash; left/right, R rotates, M mirrors</span>
    <div class="blocks">
        {#each DRAWN_SHAPES as shape (shape)}
            <button
                type="button"
                class="block"
                class:active={brush.shape === shape}
                title={shape}
                onclick={() => selectShape(shape)}
            >
                <!-- The selected block previews its live orientation; the rest sit
                     at turn 0, so the picker reads as a menu rather than a jumble -->
                <svg viewBox="0 0 100 100" aria-hidden="true">
                    <path
                        d={shapeSvgPath(
                            shape,
                            brush.shape === shape ? brush.turns : 0,
                            brush.shape === shape && brush.mirrored,
                        )}
                        fill={brush.color}
                    />
                </svg>
            </button>
        {/each}
    </div>

    <span class="section">Component</span>
    <div class="row wrap">
        {#each COMPONENT_KINDS as kind (kind)}
            <button
                type="button"
                class:active={brush.kind === kind}
                onclick={() => set({ kind, level: Math.min(brush.level, maxLevel(kind)) })}
            >
                {kind}
            </button>
        {/each}
    </div>

    <div class="grid">
        <span class="label">Level</span>
        <input
            type="range" min="1" max={maxLevel(brush.kind)} step="1"
            value={brush.level}
            oninput={(e) => set({ level: e.currentTarget.valueAsNumber })}
        />
        <span class="readout">{brush.level}</span>

        <span class="label">Facing</span>
        <div class="row">
            {#each FACINGS as name, index (name)}
                <button type="button" class:active={brush.facing === index} onclick={() => set({ facing: index })}>
                    {name}
                </button>
            {/each}
        </div>
        <span class="readout"></span>

        <span class="label">Emission</span>
        <input
            type="range" min="0" max="1" step="0.05"
            value={brush.emission}
            oninput={(e) => set({ emission: e.currentTarget.valueAsNumber })}
        />
        <span class="readout">{brush.emission.toFixed(2)}</span>

        <span class="label">Color</span>
        <input
            type="color" class="swatch"
            value={brush.color}
            oninput={(e) => set({ color: e.currentTarget.value })}
        />
        <span class="readout">{brush.color}</span>
    </div>

    {#if palette.length > 0}
        <span class="section">Ship palette</span>
        <div class="palette">
            {#each palette as entry (entry)}
                <!-- Re-selects a color already in the ship; placing always uses the
                     picker above, so this never gates what you can build -->
                <button
                    type="button"
                    class="chip"
                    class:active={brush.color.toLowerCase() === entry.toLowerCase()}
                    style:background={entry}
                    title={entry}
                    aria-label={entry}
                    onclick={() => set({ color: entry })}
                ></button>
            {/each}
        </div>
    {/if}

    <button class="reset" type="button" onclick={() => (brush = { ...DEFAULT_BRUSH })}>Reset brush</button>
</div>

<style>
    .builder { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }

    .section {
        color: #ffffff55;
        text-transform: uppercase;
        letter-spacing: .08em;
        border-bottom: 1px solid var(--line, #0df3);
        padding-bottom: 3px;
        margin-top: 6px;
    }

    .row { display: flex; gap: 4px; }
    .row.wrap { flex-wrap: wrap; }

    .grid {
        display: grid;
        grid-template-columns: 62px 1fr 44px;
        gap: 6px 10px;
        align-items: center;
    }

    .label { color: #ffffff99; }
    .readout {
        color: var(--accent, #0df);
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    button {
        flex: 1;
        background: #0b1116;
        color: #fff;
        border: 1px solid #0df3;
        border-radius: 3px;
        padding: 3px 6px;
        font: inherit;
        cursor: pointer;
    }
    button:hover { border-color: var(--accent, #0df); }
    button.active {
        background: #0df2;
        border-color: var(--accent, #0df);
        color: var(--accent, #0df);
    }

    .blocks {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
        gap: 4px;
    }
    .block { padding: 2px; aspect-ratio: 1; }
    .block svg { display: block; width: 100%; height: 100%; }

    .palette { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { flex: 0 0 auto; width: 20px; height: 20px; padding: 0; border-radius: 3px; }

    .reset { margin-top: 6px; }

    input[type="range"] { width: 100%; accent-color: var(--accent, #0df); }
    .swatch {
        width: 100%;
        height: 20px;
        padding: 0;
        border: 1px solid #0df3;
        border-radius: 3px;
        background: none;
    }
</style>