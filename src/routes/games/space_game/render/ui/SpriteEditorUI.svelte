<script lang="ts">
    import { shapeSvgPath } from "../shapeSVG"
    import { DRAWN_SHAPES } from "../grid/palette"
    import { turnCount, type BlockShape } from "../grid/shapes"
    import { ART_LAYERS, ART_ROLES, type ArtLayer, type ArtRole } from "../grid/spriteMesh"
    import type { ArtBrush, ArtInfo } from "../../dev/scenes/sprite-editor"

    /**
     * The sprite editor's interface.
     *
     * Owns nothing. The scene holds the brush and the piece; every control asks
     * for a change and waits to be told what happened.
     */
    let { brush, info = null, onPatch, onAction }: {
        brush: ArtBrush
        info?: ArtInfo | null
        onPatch: (patch: Partial<ArtBrush>) => void
        onAction: (name: string) => void
    } = $props()

    const TOOLS = ["build", "destroy"] as const

    /** What each role means, since "accent" alone does not say it. */
    const ROLE_HINT: Record<ArtRole, string> = {
        static: "keeps this colour on every ship",
        main: "recoloured by the component",
        accent: "recoloured by the component",
    }

    /** What each layer is for, since the split only pays off at runtime. */
    const LAYER_HINT: Record<ArtLayer, string> = {
        base: "drawn first, and stays put",
        top: "drawn over the base, and can be moved or animated",
    }

    function set(patch: Partial<ArtBrush>) {
        onPatch(patch)
    }

    /** Squares on a layer and role, or zero before the scene has published. */
    function cellsOn(layer: ArtLayer, role: ArtRole): number {
        return info?.cells[layer][role] ?? 0
    }

    /**
     * The colour the current role draws with.
     *
     * One picker rather than three: you are always editing "the colour of the
     * role you are on", and the other two are not in play while you draw.
     */
    function colorOf(): string {
        if (brush.role === "main") return brush.mainColor
        if (brush.role === "accent") return brush.accentColor
        return brush.color
    }

    function setColor(hex: string) {
        if (brush.role === "main") set({ mainColor: hex })
        else if (brush.role === "accent") set({ accentColor: hex })
        else set({ color: hex })
    }

    /** Carries the rotation only when the new shape turns the same number of ways. */
    function selectShape(shape: BlockShape) {
        const count = turnCount(shape)
        const carried = count === turnCount(brush.shape) ? brush.turns % count : 0

        set({ shape, turns: carried, tool: "build" })
    }

    /** True while the brush would place what the shape tray is showing. */
    let picking = $derived(brush.tool === "build")

    /** Colours already on the piece, so one can be picked back up without matching hexes by eye. */
    let palette = $derived(info?.palette ?? [])

    /** Only the selected shape previews its live orientation. */
    function swatchTurns(shape: BlockShape): number {
        return shape === brush.shape ? brush.turns : 0
    }

    function swatchMirrored(shape: BlockShape): boolean {
        return shape === brush.shape && brush.mirrored
    }
</script>

<div id="sprite-ui">
    <div id="top-panel" class="panel">
        <div class="group">
            {#each TOOLS as name (name)}
                <button class={brush.tool === name ? "active" : ""} onclick={() => set({ tool: name })}>
                    {name}
                </button>
            {/each}
        </div>

        <span class="divider"></span>

        <div class="group">
            <button onclick={() => onAction("undo")}>undo</button>
            <button onclick={() => onAction("redo")}>redo</button>
            <button onclick={() => onAction("clearRole")}>clear role</button>
            <button onclick={() => onAction("clearLayer")}>clear layer</button>
            <button onclick={() => onAction("clearAll")}>clear all</button>
        </div>

        <span class="divider"></span>

        <div class="group">
            <button onclick={() => onAction("upload")}>upload</button>
            <button onclick={() => onAction("download")}>download</button>
        </div>

        <span class="divider"></span>

        <div class="group hints">
            <span><b>R</b> rotate</span>
                <span><b>M</b> mirror</span>
            <span><b>L</b> layer</span>
        </div>
    </div>

    <div id="left-panel" class="panel">
        <!-- Layer above role: it decides which canvas every other control acts
             on, so it reads top-down the way the edit happens -->
        <div class="heading">LAYER</div>
        <div id="layers">
            {#each ART_LAYERS as layer (layer)}
                <button
                    class={brush.layer === layer ? "active" : ""}
                    onclick={() => set({ layer })}
                    title={LAYER_HINT[layer]}
                >
                    {layer}
                </button>
            {/each}
        </div>

        <div class="heading">ROLE</div>
        <div id="roles">
            {#each ART_ROLES as role (role)}
                <button
                    class={`role-row ${brush.role === role ? "active" : ""}`}
                    onclick={() => set({ role })}
                    title={ROLE_HINT[role]}
                >
                    <span>{role}</span>
                    <!-- The active layer's count, since that is the one a click
                         would change -->
                    <span class="count">{cellsOn(brush.layer, role)}</span>
                </button>
            {/each}
        </div>

        <!-- Named by role, because main and accent are stand-ins: the file keeps
             no colour for them, and a component supplies one at runtime -->
        <div class="heading">{brush.role.toUpperCase()} COLOR</div>
        <input
            id="art-color"
            type="color"
            value={colorOf()}
            oninput={(e) => setColor(e.currentTarget.value)}
        />
        {#if brush.role === "static"}
            <!-- Only static has a palette to speak of: main and accent are one
                 colour each, and that colour is a preview the ship overrides -->
            {#if palette.length > 0}
                <div id="palette">
                    {#each palette as hex (hex)}
                        <button
                            class={`swatch ${brush.color.toLowerCase() === hex.toLowerCase() ? "active" : ""}`}
                            style={`background: ${hex}`}
                            onclick={() => set({ color: hex })}
                            title={hex}
                            aria-label={hex}
                        ></button>
                    {/each}
                </div>
            {/if}
        {:else}
            <p class="note">preview only</p>
        {/if}
    </div>

    <div id="info-panel" class="panel">
        <div class="heading">PIECE</div>
        {#if info}
            <dl class="readout">
                <dt>id</dt><dd>{info.id}</dd>
                <dt>name</dt><dd>{info.name}</dd>
                <dt>grid</dt><dd>{info.grid}x{info.grid}</dd>
            </dl>

            <!-- Cells against triangles is the merge working or not: a solid
                 plate should read 256 cells and 2 triangles. Both layers, since
                 what ships is the sum of the two -->
            {#each ART_LAYERS as layer (layer)}
                <div class="heading">{layer.toUpperCase()} BAKE</div>
                <dl class="readout">
                    {#each ART_ROLES as role (role)}
                        <dt>{role}</dt>
                        <dd>{info.cells[layer][role]} &rarr; {info.triangles[layer][role]} tri</dd>
                    {/each}
                </dl>
            {/each}
        {:else}
            <p class="note">no piece yet</p>
        {/if}
    </div>

    <div id="bottom-panel" class="panel">
        {#each DRAWN_SHAPES as shape (shape)}
            <button
                class={`shape-swatch ${picking && brush.shape === shape ? "active" : ""}`}
                onclick={() => selectShape(shape)}
                title={shape}
                aria-label={shape}
            >
                <svg class="shape-svg" viewBox="0 0 100 100" aria-hidden="true">
                    <path
                        d={shapeSvgPath(shape, swatchTurns(shape), swatchMirrored(shape))}
                        fill={colorOf()}
                    />
                </svg>
            </button>
        {/each}
    </div>
</div>

<style>
    #sprite-ui {
        --ui-background: rgba(0, 191, 255, 0.3);
        --ui-background-dark: rgba(0, 20, 34, 0.82);
        --ui-border: rgba(0, 191, 255, 0.55);
        --ui-separator: rgba(0, 191, 255, 0.25);
        --text-color: rgb(0, 221, 255);
        --active: rgb(0, 255, 64);

        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        color: var(--text-color);
        z-index: 1;
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        /* The panels take the pointer back; everything between is the canvas */
        pointer-events: none;
    }

    .panel {
        pointer-events: auto;
        position: absolute;
        background: var(--ui-background-dark);
        border: 2px solid var(--ui-border);
        border-radius: 8px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        overflow: hidden;
    }

    button {
        background-color: var(--ui-background);
        border: solid 2px transparent;
        border-radius: 6px;
        padding: .35rem .7rem;
        font-family: inherit;
        color: var(--text-color);
        font-weight: bold;
        font-size: 14px;
        cursor: pointer;
        transition: background-color .12s ease, border-color .12s ease;
    }
    button:hover { background-color: rgba(0, 191, 255, 0.45); }
    button.active {
        background-color: rgba(0, 255, 64, 0.28);
        color: var(--active);
        border-color: rgba(0, 255, 64, 0.6);
    }

    .heading {
        text-align: center;
        line-height: 20px;
        font-size: 11px;
        letter-spacing: .14em;
        font-weight: bold;
        background: var(--ui-background);
        border-bottom: 1px solid var(--ui-separator);
    }

    .note {
        margin: 0;
        padding: 4px 8px;
        font-size: 10px;
        opacity: .55;
        text-align: center;
    }

    #top-panel {
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
    }
    .group { display: flex; gap: 5px; align-items: center; }
    .divider { width: 1px; align-self: stretch; background: var(--ui-separator); }
    .hints { gap: 10px; font-size: 11px; opacity: .7; }
    .hints b { color: var(--active); }

    #left-panel {
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        width: 150px;
    }

    #layers { display: flex; gap: 4px; padding: 6px; }
    #layers button { flex: 1; font-size: 12px; padding: .3rem 0; }

    #roles { display: flex; flex-direction: column; }
    .role-row {
        display: flex;
        justify-content: space-between;
        border-radius: 0;
        border: 1px solid var(--ui-separator);
        background: transparent;
        font-size: 12px;
        padding: .3rem .5rem;
    }
    .role-row:hover { background: rgba(0, 191, 255, 0.2); }
    .count { opacity: .6; }

    #art-color {
        display: block;
        width: calc(100% - 12px);
        height: 28px;
        margin: 6px;
        padding: 0;
        border: 2px solid var(--ui-border);
        border-radius: 5px;
        background: none;
        cursor: pointer;
    }
    /* Strip the native chrome so the swatch fills the control. */
    #art-color::-webkit-color-swatch-wrapper { padding: 2px; }
    #art-color::-webkit-color-swatch { border: none; border-radius: 3px; }

    #palette {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 0 6px 6px;
    }
    .swatch {
        width: 20px;
        height: 20px;
        padding: 0;
        border-radius: 4px;
        border: 2px solid var(--ui-separator);
    }
    /* The swatch is the colour. Its inline background outranks the fills
       button:hover and button.active would otherwise paint over it, so the
       border is all these have to say */
    .swatch:hover { border-color: var(--ui-border); }
    .swatch.active { border-color: var(--active); }

    #info-panel {
        right: 14px;
        top: 50%;
        transform: translateY(-50%);
        width: 170px;
    }

    .readout {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 8px;
        margin: 0;
        padding: 6px 8px;
        font-size: 12px;
    }
    .readout dt { opacity: .6; }
    .readout dd {
        margin: 0;
        text-align: right;
        font-weight: bold;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    #bottom-panel {
        bottom: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 6px;
        padding: 8px;
        max-width: 62vw;
        overflow-x: auto;
    }
    .shape-swatch {
        width: 44px;
        flex-shrink: 0;
        aspect-ratio: 1 / 1;
        padding: 4px;
        background: transparent;
        border: 1px solid var(--ui-separator);
        border-radius: 5px;
    }
    .shape-swatch:hover { background: rgba(0, 191, 255, 0.2); }
    .shape-svg { width: 100%; height: 100%; display: block; }

    /* Chrome and Safari. These are ignored the moment scrollbar-width or
       scrollbar-color is set on the same element, which is why the standard
       properties are quarantined in the @supports block below. */
    .panel::-webkit-scrollbar { width: 8px; height: 8px; }
    .panel::-webkit-scrollbar-track { background: transparent; }
    .panel::-webkit-scrollbar-thumb { background: var(--ui-background); border-radius: 4px; }

    /* Firefox, which has no pseudo-elements to style */
    @supports not selector(::-webkit-scrollbar) {
        .panel { scrollbar-width: thin; scrollbar-color: var(--ui-background) transparent; }
    }
</style>