<script lang="ts">
    import { shapeSvgPath } from "../shapeSVG"
    import { blockSvgTriangles } from "../artSVG"
    import { Color } from "../color"
    import type { BlockLike } from "../grid/blockDraw"
    import { nameIssue, type Issue } from "../../game/shipReadiness"
    import { layerFor, type Brush, type BrushTool } from "../grid/brush"
    import { DRAWN_SHAPES } from "../grid/palette"
    import { turnCount, type BlockShape } from "../grid/shapes"
    import { SHIP_LAYERS } from "../grid/layers"
    import { COMPONENT_KINDS } from "../grid/components"
    import {
        canPlace, componentById, componentsOfKind, kindOf, maxLevel, statsFor,
        type ComponentKind,
    } from "../grid/components"
    import { VIEW_LAYERS, type LayerView, type SelectedCell, type ShipInfo } from "../../dev/scenes/ship-builder"
    
    import circleFilledIconSRC from "../../assets/icons/SpaceGame-Circle_Filled.png"
    import circleHalfIconSRC from "../../assets/icons/SpaceGame-Circle_Half.png"
    import circleEmptyIconSRC from "../../assets/icons/SpaceGame-Circle_Empty.png"
    import screwDriverIconSRC from "../../assets/icons/SpaceGame-Screw_Driver.png"
    import eraserIconSRC from "../../assets/icons/SpaceGame-Eraser.png"
    import selectIconSRC from "../../assets/icons/SpaceGame-Select.png"
    import undoIconSRC from "../../assets/icons/SpaceGame-Undo.png"
    import clearLayerIconSRC from "../../assets/icons/SpaceGame-X.png"
    import clearAllIconSRC from "../../assets/icons/SpaceGame-Bomb.png"
    import arrowIconSRC from "../../assets/icons/SpaceGame-Arrow.png"
    import testIconSRC from "../../assets/icons/SpaceGame-Test.png"
    import hullIconSRC from "../../assets/icons/SpaceGame-Hull.png"
    import thrusterIconSRC from "../../assets/icons/SpaceGame-Thruster.png"
    import cargoIconSRC from "../../assets/icons/SpaceGame-Storage.png"
    import generatorIconSRC from "../../assets/icons/SpaceGame-Generator.png"
    import projectorIconSRC from "../../assets/icons/SpaceGame-Projector.png"
    import weaponIconSRC from "../../assets/icons/SpaceGame-Weapon.png"


    /**
     * The builder's whole interface.
     *
     * Owns nothing but which panel is showing. `brush`, `shipInfo` and `selected`
     * are the scene's, rendered here; every control asks for a change and waits
     * to be told what happened, so there is no local copy to fall out of step.
     */
    let { brush, palette = [], shipInfo = null, selected = null, notice = null, layerView = null, onPatch, onAction, onUpgrade, onSteering, onHighlight, onLayerView, onIdentity, onModal, lit = false, onLit, keyGuide = [] }: {
        brush: Brush
        /** Hex colors currently used in the ship, published by the scene. */
        palette?: string[]
        shipInfo?: ShipInfo | null
        /** The block last clicked, or null when that cell is empty. */
        selected?: SelectedCell | null
        notice?: string | null
        /** How much of each layer the scene draws. Null until it has published. */
        layerView?: Record<string, LayerView> | null
        onPatch: (patch: Partial<Brush>) => void
        onAction: (name: string) => void
        onUpgrade: (delta: number) => void
        /** Hex to box on the ship, or null to clear. */
        onHighlight: (hex: string | null) => void
        onLayerView: (patch: Record<string, LayerView>) => void
        /** Flips whether the selected thruster is used for turning. */
        onSteering: (steering: boolean) => void
        /**
         * Renames the ship, or its creator.
         *
         * A patch rather than a whole identity, so the two fields never overwrite
         * each other with a stale copy of the one that was not being typed in.
         */
        onIdentity: (patch: { name?: string; creator?: string }) => void
        /** Raised while a dialog is covering the scene, lowered when it closes. */
        onModal: (open: boolean) => void
        /** True while the ship is drawn lit rather than in flat colours. */
        lit?: boolean
        /** Switches the lighting preview. */
        onLit: (next: boolean) => void
        /** Every builder shortcut as it is currently bound. */
        keyGuide?: { keys: string; does: string }[]
    } = $props()

    /** What each control does, in the words someone who has not read the code would use. */
    const TIPS: Record<string, string> = {
        build: "Place the selected block",
        destroy: "Remove blocks. Refuses anything the ship needs",
        select: "Inspect a block without changing it",
        undo: "Undo the last stroke",
        redo: "Redo the last undone stroke",
        clear: "Empty the current layer",
        clearAll: "Empty every layer",
        upload: "Load a ship from a file",
        test: "Fly this ship, then come back to it",
        download: "Save this ship to a file",
    }

    /** The type under the cursor right now, which outranks everything else. */
    let hoveredType = $state<string | null>(null)

    /** The category the brush is holding, which is what the picker highlights. */
    let brushKind = $derived(kindOf(brush.type))

    /** True while the brush places a machine rather than plain structure. */
    let placingComponent = $derived(brushKind !== "hull")

    /** The models available under the brush's category. */
    let types = $derived(componentsOfKind(brushKind))

    /**
     * The one tooltip for the whole panel, placed from the hovered control's rect.
     *
     * A ::after on the button itself is less code but unusable here: every panel
     * sets `overflow: hidden`, and the ones that matter also carry a `transform`,
     * which makes them the containing block even for `position: fixed`. The tip
     * was being drawn inside the toolbar and clipped away. This element lives
     * outside every panel, so nothing can cut it off.
     *
     * Delegated from one listener rather than a handler per button, so adding
     * `data-tip` to a new control is all anyone has to remember.
     */
    let tip = $state<{ text: string; x: number; y: number; below: boolean } | null>(null)

    /** True while the download dialog is up. Nothing is written until it closes. */
    let confirmingDownload = $state(false)

    /**
     * Tells the scene to stop reading the keyboard while a dialog is up.
     *
     * The backdrop already keeps the pointer off the grid, but the scene polls
     * keys from the window and has no way to know a dialog is covering it, so
     * pressing T behind the dialog would quietly switch the brush.
     */
    $effect(() => {
        onModal(confirmingDownload)
    })

    /**
     * Everything wrong with the ship right now, including the name being typed.
     *
     * The scene reports what is wrong with the hull; the name is this panel's,
     * because the field holding it is. Composed here rather than in either place
     * alone, which is why the rule for it is its own exported function.
     */
    let downloadIssues = $derived.by((): Issue[] => {
        const structural = shipInfo?.issues ?? []

        // An empty grid says one thing and stops - piling "and name it" onto that
        // is not help, it is a list
        if (structural[0]?.id === "empty") return structural

        const named = nameIssue(shipInfo?.name ?? "")
        return named ? [named, ...structural] : structural
    })

    /** The rich tip: an enlarged sprite and the numbers behind it. */
    let card = $state<{ type: string; x: number; y: number; below: boolean } | null>(null)

    /**
     * What the accent picker shows before one has been chosen.
     *
     * The brush stores "" for "leave the art alone", which an <input type="color">
     * cannot display - it needs some hex, and this one is only ever a starting
     * point for the first drag of the slider.
     */
    const DEFAULT_ACCENT_SWATCH = "#ffb347"

    /** Enough room for a two-line tip; below that it flips above the control. */
    const TIP_ROOM = 70

    /** The same, for the taller sprite card. */
    const CARD_ROOM = 210

    function trackTip(event: Event) {
        const target = event.target as HTMLElement | null

        // The card wins wherever both could apply: it says everything the text tip
        // would and shows the piece as well
        const sprite = target?.closest?.("[data-sprite]")
        if (sprite instanceof HTMLElement && sprite.dataset.sprite) {
            const box = sprite.getBoundingClientRect()
            const room = box.bottom + CARD_ROOM < window.innerHeight

            tip = null
            card = {
                type: sprite.dataset.sprite,
                x: box.left + box.width / 2,
                y: room ? box.bottom + 8 : box.top - 8,
                below: room,
            }
            return
        }

        card = null

        const found = target?.closest?.("[data-tip]")
        const text = found instanceof HTMLElement ? found.dataset.tip : null

        if (!found || !text) {
            tip = null
            return
        }

        const rect = found.getBoundingClientRect()
        const below = rect.bottom + TIP_ROOM < window.innerHeight

        tip = {
            text,
            x: rect.left + rect.width / 2,
            y: below ? rect.bottom + 8 : rect.top - 8,
            below,
        }
    }

    /** What each visibility state does when clicked, and what it looks like. */
    const NEXT_VIEW: Record<LayerView, LayerView> = {
        full: "dim",
        dim: "hidden",
        hidden: "full",
    }

    /** The icon each state wears, so the button says what it is without a label. */
    const VIEW_ICON: Record<LayerView, string> = {
        full: circleFilledIconSRC,
        dim: circleHalfIconSRC,
        hidden: circleEmptyIconSRC,
    }

    /*
     * Worded as "see through" rather than a percentage: a dimmed layer is drawn
     * blended now, not washed toward the background, so the point of it is what
     * shows through rather than how pale it went.
     */
    const VIEW_TIP: Record<LayerView, string> = {
        full: "Visible. Click to see through it",
        dim: "See-through. Click to hide",
        hidden: "Hidden. Click to show",
    }

    /** A layer's view, defaulting to full for the frames before the scene publishes. */
    function viewOf(layer: string): LayerView {
        return layerView?.[layer] ?? "full"
    }

    function cycleView(layer: string) {
        onLayerView({ [layer]: NEXT_VIEW[viewOf(layer)] })
    }

    /** Which destructive button is armed, if any. */
    let confirming = $state<string | null>(null)

    /**
     * What the bottom of the info panel talks about.
     *
     * Hover wins, then a block you clicked, then the component the brush is
     * holding - so picking a thruster leaves its stats on screen rather than
     * flashing them for only as long as the pointer rests on the button.
     */
    let describing = $derived(
        hoveredType ?? (selected ? null : placingComponent ? brush.type : null),
    )

    /** Requested, not applied. The scene decides, publishes, and this rerenders. */
    function set(patch: Partial<Brush>) {
        onPatch(patch)
    }

    /**
     * Switches tool, putting the brush back on a layer it can build on.
     *
     * Destroy and select reach every layer, so either can leave the brush on one
     * its type is not allowed to build on. Coming back to build without fixing
     * that is what shows a layer as selected and disabled at once.
     */
    function selectTool(tool: BrushTool) {
        set(tool === "build" ? { tool, layer: layerFor(brush.type, brush.layer) } : { tool })
    }

    /**
     * True while the brush would actually place what the pickers are showing.
     *
     * Erase and select act on blocks already down, so highlighting a shape or a
     * placement during either would advertise a choice that changes nothing.
     */
    let picking = $derived(brush.tool === "build")

    /**
     * Switches shape, carrying the rotation when it still means something.
     *
     * A wedge's turn 3 is meaningless on a shape with one turn, so the rotation
     * only survives when the new shape turns the same number of ways. Anything
     * else starts from zero rather than landing somewhere arbitrary.
     */
    function selectShape(shape: BlockShape) {
        const count = turnCount(shape)
        const carried = count === turnCount(brush.shape) ? brush.turns % count : 0

        // Back to paint, as picking a placement does: choosing a shape while the
        // brush sits on erase would otherwise light nothing up and do nothing.
        // The layer comes along for the same reason it does in selectTool - erase
        // may have left the brush somewhere it cannot build.
        set({ shape, turns: carried, tool: "build", layer: layerFor(brush.type, brush.layer) })
    }

    /** The model a category offers first, which is what its button selects. */
    function firstTypeOf(kind: ComponentKind): string {
        return componentsOfKind(kind)[0]?.id ?? brush.type
    }

    /**
     * Picks a component to place.
     *
     * Also switches to paint and to a layer the type is allowed on: choosing a
     * thruster while the brush sits on "erase" and the cosmetic layer meant three
     * more clicks before anything could happen, and every one of them was the
     * only possible answer.
     */
    function selectType(type: string) {
        const layers = SHIP_LAYERS.filter((layer) => canPlace(type, layer))
        const layer = layers.includes(brush.layer) ? brush.layer : layers[0] ?? brush.layer

        set({
            type,
            layer,
            level: Math.min(brush.level, maxLevel(type)),
            tool: brush.tool === "build" ? brush.tool : "build",
        })
    }

    /**
     * Picks a category, keeping the model if the brush already holds one of them.
     *
     * Clicking STORAGE while a battery is in hand must not silently swap it for a
     * crate - the category button is how you get to the tray, not a reset.
     */
    function selectKind(kind: ComponentKind) {
        selectType(brushKind === kind ? brush.type : firstTypeOf(kind))
    }

    /**
     * First click arms, second fires.
     *
     * In-panel rather than window.confirm: it matches the rest of the UI, it does
     * not block the render loop, and it is testable.
     */
    function armOrRun(name: string) {
        if (confirming !== name) {
            confirming = name
            return
        }

        confirming = null
        onAction(name)
    }

    // An armed button that stays armed is a trap: come back in a minute and a
    // single click wipes the ship
    $effect(() => {
        if (confirming === null) return

        const timer = setTimeout(() => (confirming = null), 3000)
        return () => clearTimeout(timer)
    })

    /**
     * The orientation a swatch draws at.
     *
     * Only the selected shape shows the live rotation. The rest sit at zero, so
     * the picker reads as a menu of shapes rather than a jumble of angles - the
     * current orientation is visible on the ghost out in the world anyway.
     */
    function swatchTurns(shape: BlockShape): number {
        return shape === brush.shape ? brush.turns : 0
    }

    function swatchMirrored(shape: BlockShape): boolean {
        return shape === brush.shape && brush.mirrored
    }

    /**
     * What a tray swatch draws: this type, at the level a click would place.
     *
     * Painted in the brush's own colours, so the tray previews the piece as it
     * will land on the ship rather than in whatever palette the artist used.
     */
    function swatchBlock(type: string): BlockLike {
        return {
            shape: "full",
            turns: 0,
            mirrored: false,
            type,
            facing: 0,
            level: Math.min(brush.level, maxLevel(type)),
            color: Color.from(brush.color),
            // Empty means "leave the art's own accent alone", same as a placed cell
            accentColor: brush.accentColor === "" ? null : Color.from(brush.accentColor),
        }
    }

    /**
     * The tray's sprites, rebuilt only when the brush changes how they look.
     *
     * Derived rather than built in the markup: re-tessellating a tray of turrets
     * on every hover would be most of a frame for a result that did not change.
     */
    let traySprites = $derived(
        types.map((type) => ({ type, triangles: blockSvgTriangles(swatchBlock(type.id)) })),
    )
</script>

<!-- mouseover/mouseout rather than enter/leave, and focusin/focusout rather than
     focus/blur: only the bubbling pairs reach one listener here, and the focus
     pair is what gives a keyboard the same tips a mouse gets.

     The a11y rule wants the literal onfocus/onblur beside the mouse handlers. It
     is asking for the right thing and getting the name wrong: focus and blur do
     not bubble, so on this container they would never fire for the buttons
     inside, and focusin/focusout already cover the keyboard the rule is
     protecting. -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div
    id="build-ui"
    onmouseover={trackTip}
    onmouseout={() => (tip = null)}
    onfocusin={trackTip}
    onfocusout={() => (tip = null)}
    role="presentation"
>
    <!-- Outside every panel, so no panel's overflow can clip it -->
    {#if tip}
        <div
            id="tip"
            style={`left: ${tip.x}px; top: ${tip.y}px; transform: translateX(-50%) ${tip.below ? "" : "translateY(-100%)"}`}
        >
            {tip.text}
        </div>
    {/if}

    <!-- Out here with the tip, and for the same reason: every panel clips its
         overflow, and the ones that matter carry a transform -->
    {#if card}
        {@const component = componentById(card.type)}
        {@const level = Math.min(brush.level, component.maxLevel)}
        {@const stats = component.statsAt(level)}

        <div
            id="sprite-card"
            style={`left: ${card.x}px; top: ${card.y}px; transform: translateX(-50%) ${card.below ? "" : "translateY(-100%)"}`}
        >
            <svg class="card-art" viewBox="0 0 100 100" aria-hidden="true">
                {#each blockSvgTriangles(swatchBlock(card.type)) as triangle, index (index)}
                    <polygon points={triangle.points} fill={triangle.fill} />
                {/each}
            </svg>

            <div class="card-body">
                <div class="card-name">{component.name}</div>
                <div class="card-kind">{component.kind} &middot; L{level} of {component.maxLevel}</div>

                <dl class="readout">
                    <dt>hp</dt><dd>{stats.hitPoints}</dd>
                    <dt>mass</dt><dd>{stats.mass}</dd>
                    <dt>cost</dt><dd>{stats.cost}</dd>
                    {#each component.extraStats(level) as line (line.label)}
                        <dt>{line.label}</dt><dd>{line.value}</dd>
                    {/each}
                </dl>
            </div>
        </div>
    {/if}

    <!-- The last look before a file is written. The name and creator are the live
         settings, so editing them here is editing the ship, not a copy of it that
         has to be applied on confirm -->
    {#if confirmingDownload && shipInfo}
        <div id="download-backdrop" role="presentation" onclick={() => (confirmingDownload = false)}></div>

        <div id="download-dialog" role="dialog" aria-label="Confirm download">
            <div class="heading">DOWNLOAD SHIP</div>

            <div class="dialog-body">
                <label class="field">
                    <span>name</span>
                    <input
                        value={shipInfo.name}
                        oninput={(e) => onIdentity({ name: e.currentTarget.value })}
                    />
                </label>
                <label class="field">
                    <span>by</span>
                    <input
                        value={shipInfo.creator}
                        oninput={(e) => onIdentity({ creator: e.currentTarget.value })}
                    />
                </label>

                <dl class="readout">
                    <dt>cost</dt><dd>{shipInfo.cost}</dd>
                    <dt>mass</dt><dd>{shipInfo.mass}</dd>
                    <dt>blocks</dt><dd>{shipInfo.blocks}</dd>
                    <dt>size</dt><dd>{shipInfo.width}x{shipInfo.height}</dd>
                    {#each SHIP_LAYERS as layer (layer)}
                        <dt>{layer}</dt><dd>{shipInfo.perLayer[layer]}</dd>
                    {/each}
                    <!-- Count and price together: which category the money went
                         on is the question the total immediately raises -->
                    {#each COMPONENT_KINDS as kind (kind)}
                        {#if kind !== "hull"}
                            <dt>{kind}</dt><dd>{shipInfo.perKind[kind]} &middot; {shipInfo.costPerKind[kind]}</dd>
                        {/if}
                    {/each}
                </dl>

                <!-- Listed rather than reduced to "not ready": three things wrong
                     should be said once, not found one download at a time -->
                {#if downloadIssues.length > 0}
                    <ul id="download-issues">
                        {#each downloadIssues as issue (issue.id)}
                            <li>{issue.message}</li>
                        {/each}
                    </ul>
                {/if}
            </div>

            <div class="dialog-actions">
                <button onclick={() => (confirmingDownload = false)}>Cancel</button>
                <button
                    class="confirm"
                    disabled={downloadIssues.length > 0}
                    onclick={() => { confirmingDownload = false; onAction("download") }}
                >
                    Download
                </button>
            </div>
        </div>
    {/if}

    <!-- Over the canvas, where the eye already is. A refusal in a corner panel is
         a refusal nobody reads -->
    {#if notice}
        <div id="notice" role="status">{notice}</div>
    {/if}

    <div id="top-panel" class="panel">
        <div class="group">
            <button class={`icon-button ${brush.tool === "build" ? "active" : ""}`} onclick={() => selectTool("build")} data-tip={TIPS.build}>
                <img class="image-icon" src={screwDriverIconSRC} alt="screw-driver.png">
                BUILD
            </button>
            <button class={`icon-button ${brush.tool === "destroy" ? "active" : ""}`} onclick={() => selectTool("destroy")} data-tip={TIPS.destroy}>
                <img class="image-icon" src={eraserIconSRC} alt="eraser.png">
                DESTROY
            </button>
            <button class={`icon-button ${brush.tool === "select" ? "active" : ""}`} onclick={() => selectTool("select")} data-tip={TIPS.select}>
                <img class="image-icon" src={selectIconSRC} alt="select.png">
                SELECT
            </button>
        </div>

        <span class="divider"></span>

        <div class="group">
            <button class="icon-button" onclick={() => onAction("undo")} data-tip={TIPS.undo}>
                <img class="image-icon" src={undoIconSRC} alt="undo.png">
                UNDO
            </button>
            <button class="icon-button" onclick={() => onAction("redo")} data-tip={TIPS.redo}>
                <img class="image-icon" src={undoIconSRC} style="transform: scaleX(-1)" alt="redo.png">
                REDO
            </button>
            <button
                class={`icon-button ${confirming === "clear" ? "arming" : ""}`}
                onclick={() => armOrRun("clear")}
                data-tip={TIPS.clear}
            >
                <img class="image-icon" src={clearLayerIconSRC} alt="clear.png">
                {confirming === "clear" ? "YOU SURE?" : "CLEAR"}
            </button>
            <button
                class={`icon-button ${confirming === "clearAll" ? "arming" : ""}`}
                onclick={() => armOrRun("clearAll")}
                data-tip={TIPS.clearAll}
            >
                <img class="image-icon" src={clearAllIconSRC} alt="bomb.png">
                {confirming === "clearAll" ? "YOU SURE?" : "CLEAR ALL"}
            </button>
        </div>

        <span class="divider"></span>

        <div class="group">
            <button class="icon-button" onclick={() => onAction("upload")} data-tip={TIPS.upload}>
                <img class="image-icon" src={arrowIconSRC} alt="redo.png">
                UPLOAD
            </button>
            <button class="icon-button" onclick={() => onAction("test")} data-tip={TIPS.test}>
                <img class="image-icon" src={testIconSRC} alt="test.png">
                TEST
            </button>
            <button class="icon-button" onclick={() => (confirmingDownload = true)} data-tip={TIPS.download}>
                <img class="image-icon" src={arrowIconSRC} style="transform: scaleY(-1)" alt="redo.png">
                DOWNLOAD
            </button>
        </div>
    </div>

    <div id="draw-panel" class="panel">
        <div class="heading">COMPONENTS</div>
        <div id="placements">
            <button 
                class={`icon-button ${picking && brushKind === "hull" ? "active" : ""}`} 
                onclick={() => selectKind("hull")}
                onmouseenter={() => (hoveredType = firstTypeOf("hull"))}
                onmouseleave={() => (hoveredType = null)}
                title={"hull"}
                aria-label={"hull"}
            >
                <img class="image-icon" src={hullIconSRC} alt="hull.png">
                HULL
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "cargo" ? "active" : ""}`} 
                onclick={() => selectKind("cargo")}
                onmouseenter={() => (hoveredType = firstTypeOf("cargo"))}
                onmouseleave={() => (hoveredType = null)}
                title={"cargo"}
                aria-label={"cargo"}
            >
                <img class="image-icon" src={cargoIconSRC} alt="cargo.png">
                CARGO
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "thruster" ? "active" : ""}`} 
                onclick={() => selectKind("thruster")}
                onmouseenter={() => (hoveredType = firstTypeOf("thruster"))}
                onmouseleave={() => (hoveredType = null)}
                title={"thruster"}
                aria-label={"thruster"}
            >
                <img class="image-icon" src={thrusterIconSRC} alt="thruster.png">
                THRUSTER
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "generator" ? "active" : ""}`} 
                onclick={() => selectKind("generator")}
                onmouseenter={() => (hoveredType = firstTypeOf("generator"))}
                onmouseleave={() => (hoveredType = null)}
                title={"generator"}
                aria-label={"generator"}
            >
                <img class="image-icon" src={generatorIconSRC} alt="generator.png">
                GENERATOR
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "weapon" ? "active" : ""}`} 
                onclick={() => selectKind("weapon")}
                onmouseenter={() => (hoveredType = firstTypeOf("weapon"))}
                onmouseleave={() => (hoveredType = null)}
                title={"weapon"}
                aria-label={"weapon"}
            >
                <img class="image-icon" src={weaponIconSRC} alt="weapon.png">
                WEAPON
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "projector" ? "active" : ""}`} 
                onclick={() => selectKind("projector")}
                onmouseenter={() => (hoveredType = firstTypeOf("projector"))}
                onmouseleave={() => (hoveredType = null)}
                title={"projector"}
                aria-label={"projector"}
            >
                <img class="image-icon" src={projectorIconSRC} alt="projector.png">
                PROJECTOR
            </button>
        </div>

        <!-- Only a machine has grades to choose between; structure has shapes,
             and those live in the tray along the bottom -->
        <div class="heading">{placingComponent ? "MAIN COLOR" : "COLOR"}</div>
        <input
            id="build-color"
            type="color"
            value={brush.color}
            oninput={(e) => set({ color: e.currentTarget.value })}
        />

        <!-- Always offered, so the two pickers do not shuffle up and down the panel
             as the category changes. It only reaches art, so on a plain shape it
             sets a colour nothing draws with - harmless, and worth less than a
             control that stays where you left it -->
        <div class="heading">ACCENT</div>
            <input
                id="build-accent"
                type="color"
                value={brush.accentColor === "" ? DEFAULT_ACCENT_SWATCH : brush.accentColor}
                oninput={(e) => set({ accentColor: e.currentTarget.value })}
            />
        <button
            class="accent-reset"
            onclick={() => set({ accentColor: "" })}
            disabled={brush.accentColor === ""}
            data-tip="Use the colour the art was drawn with"
        >
            {brush.accentColor === "" ? "using art's accent" : "reset to art"}
        </button>

        <!-- Structure only. A component's glow is the artist's, not the builder's -
             see emissionFor in the scene, which is what actually enforces it -->
        {#if !placingComponent}
            <div class="heading">EMISSION</div>
            <div class="slider-row">
                <input
                    type="range" min="0" max="1" step="0.05"
                    value={brush.emission}
                    oninput={(e) => set({ emission: e.currentTarget.valueAsNumber })}
                />
                <span class="slider-value">{brush.emission.toFixed(2)}</span>
            </div>
        {/if}
        <div class="heading">PALETTE</div>
        <div id="palette">
            {#each palette as entry (entry)}
                <!-- Hovering boxes every block already wearing this colour, which is
                     how you find the three cells you got wrong on a finished hull -->
                <button
                    class="palette-swatch {brush.color.toLowerCase() === entry.toLowerCase() ? 'active' : ''}"
                    style:background-color={entry}
                    title={entry}
                    aria-label={entry}
                    onclick={() => set({ color: entry })}
                    onmouseenter={() => onHighlight(entry)}
                    onmouseleave={() => onHighlight(null)}
                ></button>
            {/each}
            {#if palette.length === 0}
                <span class="empty small">empty</span>
            {/if}
        </div>
    </div>

    <!-- Top right, above the readout: a card you glance at while your other hand
         is on the keyboard, not something to read through -->
    {#if keyGuide.length > 0}
        <div id="key-guide" class="panel">
            <div class="heading">KEYS</div>
            <dl class="readout">
                {#each keyGuide as entry (entry.does)}
                    <dt>{entry.keys}</dt><dd>{entry.does}</dd>
                {/each}
            </dl>
        </div>
    {/if}

    <div id="info-panel" class="panel">
        <div class="heading">SHIP</div>
        {#if shipInfo}
            <dl class="readout">
                <dt>name</dt>
                <dd>
                    <input
                        class="identity-input"
                        value={shipInfo.name}
                        oninput={(e) => onIdentity({ name: e.currentTarget.value })}
                        aria-label="Ship name"
                    />
                </dd>
                <dt>by</dt>
                <dd>
                    <input
                        class="identity-input"
                        value={shipInfo.creator}
                        oninput={(e) => onIdentity({ creator: e.currentTarget.value })}
                        aria-label="Creator"
                    />
                </dd>
                <dt>cost</dt><dd>{shipInfo.cost}</dd>
                <dt>mass</dt><dd>{shipInfo.mass}</dd>
                <dt>blocks</dt><dd>{shipInfo.blocks}</dd>
                <dt>size</dt><dd>{shipInfo.width}x{shipInfo.height}</dd>
            </dl>
        {:else}
            <p class="empty">no ship yet</p>
        {/if}

        <div class="heading">LAYERS</div>
        <div id="layers">
            {#each VIEW_LAYERS as layer (layer)}
                {@const isShipLayer = layer !== "markers"}
                <!-- Disabled rather than hidden: the count is still worth reading,
                     and a row vanishing as you switch types is disorienting -->
                <div class="layer-line">
                    <!-- Its own button, not part of the row: hiding a layer and
                         building on it are different intentions, and one must not
                         be a side effect of the other -->
                    <button
                        class={`eye ${viewOf(layer) === "hidden" ? "off" : ""}`}
                        onclick={() => cycleView(layer)}
                        data-tip={VIEW_TIP[viewOf(layer)]}
                        aria-label={`${layer} visibility`}
                    >
                        <img class="eye-icon" src={VIEW_ICON[viewOf(layer)]} alt="">
                    </button>

                    {#if isShipLayer}
                        <button
                            class={`layer-row ${brush.layer === layer ? "active" : ""}`}
                            onclick={() => set({ layer })}
                            disabled={picking && !canPlace(brush.type, layer)}
                            data-tip={!picking
                                ? `${brush.tool === "destroy" ? "Erase" : "Inspect"} on the ${layer} layer`
                                : canPlace(brush.type, layer)
                                    ? `Build on the ${layer} layer`
                                    : `${componentById(brush.type).name} cannot go on ${layer}`}
                        >
                            <span>{layer}</span>
                            <span class="count">{shipInfo?.perLayer[layer] ?? 0}</span>
                        </button>
                    {:else}
                        <!-- Not a button: nothing is stored in this layer, so there
                             is nothing to select and nothing to build on -->
                        <span class="layer-row static-row">markers</span>
                    {/if}
                </div>

                <!-- Under markers, because it belongs with it: neither is a layer
                     of the ship, both only change how what is there is drawn. Its
                     eye is two-state, since a half-lit ship means nothing -->
                {#if layer === "markers"}
                    <div class="layer-line">
                        <button
                            class={`eye ${lit ? "" : "off"}`}
                            onclick={() => onLit(!lit)}
                            data-tip={lit
                                ? "Previewing the ship lit. Click for flat colours"
                                : "Flat colours, for building. Click to preview it lit"}
                            aria-label="lighting preview"
                        >
                            <img class="eye-icon" src={lit ? circleFilledIconSRC : circleEmptyIconSRC} alt="">
                        </button>
                        <span class="layer-row static-row">lighting</span>
                    </div>
                {/if}
            {/each}
        </div>

        <!-- A hovered type wins over the selection: you are asking about the thing
             under the cursor right now, not the thing you clicked a minute ago -->
        {#if describing}
            {@const stats = statsFor(describing, brush.level)}
            <div class="heading">{componentById(describing).name.toUpperCase()} L{brush.level}</div>
            <dl class="readout">
                <dt>hp</dt><dd>{stats.hitPoints}</dd>
                <dt>mass</dt><dd>{stats.mass}</dd>
                <dt>cost</dt><dd>{stats.cost}</dd>
                <dt>levels</dt><dd>{maxLevel(describing)}</dd>
            </dl>
        {:else if selected}
            <div class="heading">BLOCK</div>
            <dl class="readout">
                <dt>at</dt><dd>{selected.col}, {selected.row}</dd>
                <dt>layer</dt><dd>{selected.layer}</dd>
                <dt>shape</dt><dd>{selected.shape}</dd>
                <dt>type</dt><dd>{selected.typeName}</dd>
                <dt>hp</dt><dd>{selected.hitPoints}</dd>
                <dt>mass</dt><dd>{selected.mass}</dd>
            </dl>

            <div id="level-row">
                <!-- Upgrades the block already on the ship, not the brush. The scene
                     re-runs set() so hit points and mass follow the level. -->
                <button onclick={() => onUpgrade(-1)} disabled={selected.level <= 1}>&minus;</button>
                <span class="level">L{selected.level} / {selected.maxLevel}</span>
                <button onclick={() => onUpgrade(1)} disabled={selected.level >= selected.maxLevel}>+</button>
            </div>

            {#if kindOf(selected.type) === "thruster"}
                <!-- Q and E fire only these. A main drive mounted off center is
                     still allowed to be one - it will just turn the ship hard. -->
                <div id="steer-row">
                    <span class="level">steering</span>
                    <button
                        class={selected.steering ? "active" : ""}
                        onclick={() => onSteering(!selected.steering)}
                        data-tip={selected.steering
                            ? "Turns the ship on Q/E. Click to stop using it to turn"
                            : "Thrust only. Click to steer with it"}
                    >{selected.steering ? "ON" : "OFF"}</button>
                </div>
            {/if}
        {:else}
            <div class="heading">BLOCK</div>
            <p class="empty">select a block</p>
        {/if}
    </div>

    <div id="bottom-panel" class="panel">
        {#if placingComponent}
            <!-- The models in this category, drawn as what they actually place.
                 One per model and not per level: levels are their own row, and a
                 tray of five autocannons differing by a digit is not a choice.

                 No `title`, because a native tooltip would race the card below
                 and win -->
            {#each traySprites as entry (entry.type.id)}
                <button
                    class={`shape-swatch wide ${picking && brush.type === entry.type.id ? "active" : ""}`}
                    onclick={() => selectType(entry.type.id)}
                    onmouseenter={() => (hoveredType = entry.type.id)}
                    onmouseleave={() => (hoveredType = null)}
                    data-sprite={entry.type.id}
                    aria-label={entry.type.name}
                >
                    <svg class="shape-svg" viewBox="0 0 100 100" aria-hidden="true">
                        {#each entry.triangles as triangle, index (index)}
                            <polygon points={triangle.points} fill={triangle.fill} />
                        {/each}
                    </svg>
                </button>
            {/each}
        {:else}
            {#each DRAWN_SHAPES as shape (shape)}
                <button
                    class={`shape-swatch wide ${picking && brush.shape === shape ? "active" : ""}`}
                    onclick={() => selectShape(shape)}
                    title={shape}
                    aria-label={shape}
                >
                    <svg class="shape-svg" viewBox="0 0 100 100" aria-hidden="true">
                        <path
                            d={shapeSvgPath(shape, swatchTurns(shape), swatchMirrored(shape))}
                            fill={brush.color}
                        />
                    </svg>
                </button>
            {/each}
        {/if}
    </div>
</div>

<style>
    #build-ui {
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
        margin: 0;
        color: var(--text-color);
        background: none;
        z-index: 1;
        font-family: "Jost", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        /* The panels take the pointer back; everything between belongs to the canvas */
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
    button:active { background-color: rgba(0, 191, 255, 0.15); }
    button:disabled { opacity: .3; cursor: default; }
    button:disabled:hover { background-color: var(--ui-background); }

    button.active {
        background-color: rgba(0, 255, 64, 0.28);
        color: var(--active);
        border-color: rgba(0, 255, 64, 0.6);
    }
    button.active:hover { background-color: rgba(0, 255, 64, 0.4); }

    .heading {
        text-align: center;
        line-height: 20px;
        font-size: 11px;
        letter-spacing: .14em;
        font-weight: bold;
        color: var(--text-color);
        background: var(--ui-background);
        border-block: 1px solid var(--ui-separator);
    }

    .empty {
        margin: 0;
        padding: 8px;
        font-size: 12px;
        opacity: .5;
        text-align: center;
    }
    .empty.small { padding: 4px; grid-column: 1 / -1; }

    /*~~~ Top: tools ~~~*/
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
    .divider {
        width: 1px;
        align-self: stretch;
        background: var(--ui-separator);
    }
    .hints {
        gap: 10px;
        font-size: 11px;
        opacity: .7;
    }

    .icon-button {
        /* An explicit column, not a label left to wrap past an inline icon: a
           short label like HULL fits beside a 40px icon in a wider font, so that
           one button would lay itself out differently from all its neighbours */
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;

        width: 85px;
        height: 85px;
        padding: 3px;
        color: white;
        font-weight: bold;
        font-size: 12px;
        border-radius: 0;
        margin: 0;
    }
    .image-icon {
        /* Must be a factor of 16 */
        width: 48px;
        height: 48px;
        margin-bottom: 5px;
        image-rendering: pixelated;
    }

    /*~~~ Left: colour, shapes or levels, palette ~~~*/
    #draw-panel {
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        max-height: 74vh;
        overflow-y: auto;
    }

    #build-color,
    #build-accent {
        display: block;
        width: calc(100% - 12px);
        height: 26px;
        margin: 6px;
        padding: 0;
        border: 2px solid var(--ui-border);
        border-radius: 5px;
        background: none;
        cursor: pointer;
    }
    /* Strip the native chrome so the swatch fills the control. */
    #build-color::-webkit-color-swatch-wrapper,
    #build-accent::-webkit-color-swatch-wrapper { padding: 2px; }
    #build-color::-webkit-color-swatch,
    #build-accent::-webkit-color-swatch { border: none; border-radius: 3px; }

    .slider-row {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 5px 6px;
    }
    .slider-row input[type="range"] {
        /* Zero basis, then grow. A range input carries an intrinsic width of its
           own, and this panel is shrink-to-fit, so leaving it would make the panel
           jump wider the moment the emission row appeared */
        width: 0;
        flex: 1 1 0;
        min-width: 0;
        accent-color: var(--text-color);
    }
    .slider-value {
        font-size: 10px;
        opacity: .7;
        font-variant-numeric: tabular-nums;
    }

    .shape-swatch {
        border: 1px solid var(--ui-separator);
        border-radius: 0;
        width: 50px;
        height: 50px;
        margin: 0;
        /* Overriding the padding every button gets by default, which is what was
           holding the art off the edges - a 100% svg only fills the content box */
        padding: 0;
        aspect-ratio: 1 / 1;
        background: transparent;
    }
    .shape-swatch:hover { background: rgba(0, 191, 255, 0.2); }
    .shape-swatch.active { background: rgba(0, 255, 64, 0.22); }
    .shape-svg { 
        width: 100%; 
        height: 100%; 
        width: 50px;
        height: 50px;
        display: block; 
        aspect-ratio: 1/1; 
        padding: 0;
    }

    /* The bottom tray runs sideways, so its swatches are fixed-width columns with
       a name under the art rather than cells in a grid */
    .shape-swatch.wide {
        display: flex;
        width: 50px;
        flex-shrink: 0;
        border-radius: 0;
        aspect-ratio: 1 / 1;
    }
    /* Filling the button rather than sitting inside it, so a sprite and a shape
       are drawn at the same scale - both viewBoxes are the same 100 unit box, so
       the only thing that could differ is how much of the button each one gets */
    .shape-swatch.wide .shape-svg { width: 100%; height: 100%; padding: 0; }

    /* One down the column: a category is picked by its name as much as its icon,
       and a single column gives the name room to sit beside the art */
    #placements { display: grid; grid-template-columns: 1fr; gap: 1px}

    /* Rows rather than the square tiles the toolbar uses. Scoped to this list,
       because .icon-button is shared with the toolbar across the top, where the
       stacked column is right. Six squares at full panel width would not fit the
       panel, which is the whole reason this is a row */
    #placements .icon-button {
        flex-direction: row;
        justify-content: flex-start;
        gap: 8px;
        width: 100%;
        height: 50px;
        padding: 3px 8px;
    }
    #placements .image-icon {
        width: 48px;
        height: 48px;
        margin-bottom: 0;
    }

    #palette {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 2px;
        padding: 3px;
    }
    .palette-swatch {
        border: 2px solid transparent;
        width: 100%;
        aspect-ratio: 1 / 1;
        border-radius: 3px;
        padding: 0;
    }
    /* A ring rather than a fill, so the swatch keeps showing its own colour */
    .palette-swatch:hover { border-color: var(--text-color); }
    .palette-swatch.active { border-color: var(--active); }

    /*~~~ Right: ship, layers, block or hovered kind ~~~*/
    /* The readout drops below the guide rather than staying centred, so the two
       never overlap on a short window */
    #info-panel {
        right: 14px;
        top: 340px;
        width: 186px;
        max-height: calc(100vh - 370px);
        overflow-y: auto;
    }

    /* Below the toolbar, not beside it: the toolbar is centred and wide enough to
       reach this corner, and a guide over the download button is worse than one
       an inch lower */
    #key-guide {
        right: 14px;
        top: 133px;
        width: 186px;
        max-height: 190px;
        overflow-y: auto;
    }
    /* Keys left, what they do right - the opposite of the readouts, because here
       the key is what you are looking up */
    #key-guide .readout {
        grid-template-columns: auto 1fr;
        font-size: 11px;
    }
    #key-guide dt { font-weight: bold; }
    #key-guide dd { opacity: .7; text-align: right; }

    .readout {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 8px;
        margin: 0;
        padding: 6px 8px;
        font-size: 12px;
    }
    /* A grid item will not shrink below its content's intrinsic width unless it
       is told to, and an input's is wide enough to push the value off the panel */
    .readout dd { min-width: 0; }
    .readout dt { opacity: .6; }
    .readout dd {
        margin: 0;
        text-align: right;
        font-weight: bold;
        /* A long ship name must not widen the panel */
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .accent-reset {
        display: block;
        width: calc(100% - 12px);
        margin: 0 6px 6px;
        padding: .25rem;
        font-size: 10px;
        background: transparent;
        border: 1px solid var(--ui-separator);
        border-radius: 4px;
    }
    .accent-reset:hover:not(:disabled) { background: rgba(0, 191, 255, 0.2); }
    .accent-reset:disabled { opacity: .45; cursor: default; }

    #layers { display: flex; flex-direction: column; }
    .layer-row {
        display: flex;
        justify-content: space-between;
        border-radius: 0;
        border: 1px solid var(--ui-separator);
        background: transparent;
        font-size: 12px;
        padding: .3rem .5rem;
    }
    .layer-row:hover { background: rgba(0, 191, 255, 0.2); }
    .count { opacity: .6; }

    #level-row, #steer-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 6px 8px;
    }
    #level-row button, #steer-row button { padding: .1rem .55rem; }
    .level { font-size: 13px; font-weight: bold; }

    /*~~~ Bottom: functional blocks ~~~*/
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
    .component-swatch {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        width: 70px;
        flex-shrink: 0;
        padding: 4px;
        background: transparent;
        border: 2px solid var(--ui-separator);
    }
    .component-swatch:hover { background: rgba(0, 191, 255, 0.2); }
    .component-swatch .shape-svg { width: 32px; height: 32px; padding: 0;}
    .component-name { font-size: 11px; }

    .glyph {
        font-size: 44px;
        font-family: inherit;
        font-weight: bold;
        text-anchor: middle;
        dominant-baseline: central;
        fill: rgba(0, 20, 34, 0.75);
    }
    .glyph-level {
        font-size: 30px;
        font-family: inherit;
        font-weight: bold;
        text-anchor: middle;
        dominant-baseline: central;
        fill: rgba(0, 20, 34, 0.9);
    }

    /* Chrome and Safari. These are ignored the moment scrollbar-width or
       scrollbar-color is set on the same element, which is why the standard
       properties are quarantined in the @supports block below. */
    .panel::-webkit-scrollbar { width: 8px; height: 8px; }
    .panel::-webkit-scrollbar-track { background: transparent; }
    .panel::-webkit-scrollbar-thumb {
        background: var(--ui-background);
        border-radius: 4px;
    }
    .panel::-webkit-scrollbar-thumb:hover { background: var(--ui-border); }

        #notice {
        position: absolute;
        top: 120px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: bold;
        color: #ffd0d0;
        background: rgba(60, 8, 8, 0.9);
        border: 2px solid rgba(255, 90, 90, 0.75);
        border-radius: 6px;
        z-index: 5;
    }

    .icon-button.arming {
        background-color: rgba(255, 90, 90, 0.3);
        border-color: rgba(255, 90, 90, 0.8);
        color: #ffd0d0;
    }

    /* A styled tooltip rather than `title`: the native one waits about a second
       and cannot be themed, which on a toolbar this dense means you hover, wait,
       and give up before it appears.

       Fixed and positioned from script, because every panel clips its overflow
       and the important ones are also a containing block for fixed children -
       a pseudo-element on the button had nowhere to go but inside the bar. */
    #tip {
        position: fixed;
        z-index: 100;
        width: max-content;
        max-width: 190px;
        padding: 5px 8px;
        font-size: 11px;
        font-weight: normal;
        line-height: 1.35;
        text-align: center;
        color: var(--text-color);
        background: var(--ui-background-dark);
        border: 1px solid var(--ui-border);
        border-radius: 4px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
        pointer-events: none;
    }

    /* Dimmed rather than blacked out: the ship you are about to save should still
       be visible behind the dialog describing it */
    #download-backdrop {
        position: fixed;
        inset: 0;
        z-index: 200;
        background: rgba(0, 0, 0, 0.55);
        /* Taken back from the overlay, which switches them off so the canvas can
           be drawn on. Without this the dialog is a picture: clicks fall straight
           through it and keep building the ship behind. Covering the canvas is
           also what makes this modal - a stray click cannot reach the grid */
        pointer-events: auto;
    }
    #download-dialog {
        position: fixed;
        z-index: 201;
        pointer-events: auto;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 300px;
        color: var(--text-color);
        background: var(--ui-background-dark);
        border: 1px solid var(--ui-border);
        border-radius: 6px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7);
        overflow: hidden;
    }
    .dialog-body { padding: 4px 0; }
    .field {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        font-size: 12px;
    }
    .field span { opacity: .7; }
    .field input, .identity-input {
        width: 100%;
        min-width: 0;
        /* Or the padding and border are added to the 100% and the value is pushed
           out past the panel, which clips it */
        box-sizing: border-box;
        padding: 2px 4px;
        font-family: inherit;
        font-size: 12px;
        font-weight: bold;
        text-align: right;
        color: var(--text-color);
        background: rgba(0, 0, 0, .35);
        border: 1px solid var(--ui-separator);
        border-radius: 3px;
    }
    .field input:focus, .identity-input:focus {
        outline: none;
        border-color: var(--text-color);
    }
    #download-issues {
        margin: 4px 8px 8px;
        padding-left: 16px;
        font-size: 11px;
        line-height: 1.4;
        color: #ffb0b0;
    }
    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        padding: 8px;
        border-top: 1px solid var(--ui-separator);
    }
    .dialog-actions button { font-size: 12px; }
    .dialog-actions .confirm:not(:disabled) { background: rgba(0, 255, 64, 0.22); }
    .dialog-actions .confirm:disabled { opacity: .45; cursor: default; }

    #sprite-card {
        position: fixed;
        z-index: 100;
        display: flex;
        gap: 10px;
        width: max-content;
        padding: 8px 10px;
        font-size: 11px;
        font-weight: normal;
        color: var(--text-color);
        background: var(--ui-background-dark);
        border: 1px solid var(--ui-border);
        border-radius: 4px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
        pointer-events: none;
    }
    /* Big enough to read the art rather than guess at it, which is the whole
       point of the card over the one-line tip */
    .card-art {
        width: 72px;
        height: 72px;
        background: rgba(0, 0, 0, .35);
        border-radius: 3px;
    }
    .card-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 118px;
    }
    .card-name { font-weight: bold; }
    .card-kind {
        opacity: .6;
        text-transform: uppercase;
        letter-spacing: .04em;
    }
    #sprite-card .readout { margin-top: 4px; }

    /* One row per layer: the eye acts on what is drawn, the row on what is built */
    .layer-line { display: flex; align-items: stretch; }
    .layer-line .layer-row { flex: 1; }

    /* The markers row, which only its eye can act on. Styled to match the others
       so the column still reads as one list, but plainly not clickable */
    .static-row {
        display: flex;
        align-items: center;
        font-size: 12px;
        font-weight: bold;
        padding: .3rem .5rem;
        opacity: .7;
        cursor: default;
    }

    .eye {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        padding: 0;
        border-radius: 0;
        border: 1px solid var(--ui-separator);
        background: transparent;
    }
    .eye:hover { background: rgba(0, 191, 255, 0.2); }
    .eye.off { opacity: .45; }

    .eye-icon {
        width: 16px;
        height: 16px;
        image-rendering: pixelated;
    }

    /* Firefox, which has no pseudo-elements to style */
    @supports not selector(::-webkit-scrollbar) {
        .panel {
            scrollbar-width: thin;
            scrollbar-color: var(--ui-background) transparent;
        }
    }
</style>
