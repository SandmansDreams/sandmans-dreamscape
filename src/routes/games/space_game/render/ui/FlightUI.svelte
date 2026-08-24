<script lang="ts">
    import type { FlightInfo } from "../../dev/scenes/ship-flight"

    /**
     * The flight readout.
     *
     * Owns nothing at all - not even a toggle. The scene publishes what is true and
     * this draws it, which is why the numbers can never disagree with the physics
     * that produced them.
     */
    let { info = null, onBack }: {
        info?: FlightInfo | null
        /** Asks the scene to go back where the ship came from. */
        onBack: () => void
    } = $props()

    /**
     * Where the back button goes, in words.
     *
     * Only ever set when a scene sent a ship here, which is what keeps the button
     * off screen for someone who simply picked this scene from the list.
     */
    const HOME_LABEL: Record<string, string> = {
        "ship-builder": "Back to builder",
        "ship-viewer": "Back to viewer",
    }

    /** Degrees per second reads better than radians for a number you watch move. */
    let spinRate = $derived(info ? (info.spin * 180) / Math.PI : 0)

    /** Every engine burning, as a fraction, for the bar. */
    let burn = $derived(info && info.thrusters > 0 ? info.firing / info.thrusters : 0)

    let powerLevel = $derived(
        info && info.powerCapacity > 0 ? info.power / info.powerCapacity : 0,
    )
    let fuelLevel = $derived(
        info && info.fuelCapacity > 0 ? info.fuel / info.fuelCapacity : 0,
    )

    /**
     * The fraction the hull starts going dark below.
     *
     * Matches BROWNOUT in game/shipSystems.ts. Duplicated rather than imported
     * because it is the *threshold the bar warns at*, and a panel that imported
     * game rules would be deciding them rather than drawing them.
     */
    const BROWNOUT = 0.15

    const KEYS = [
        { key: "W / S", does: "burn fore and aft" },
        { key: "A / D", does: "burn sideways" },
        { key: "Q / E", does: "turn" },
        { key: "Z", does: "flight assist" },
        { key: "Mouse", does: "aim and fire" },
    ]
</script>

<div id="flight-ui">
    <!-- Only for someone who arrived from somewhere. Picking this scene off the
         list is not arriving from anywhere, and a button offering to send them
         "back" to a place they have never been would mean nothing -->
    {#if info?.returnTo}
        <button id="back" class="panel" onclick={onBack}>
            {HOME_LABEL[info.returnTo] ?? "Back"}
        </button>
    {/if}

    <div id="readout" class="panel">
        {#if info}
            <div class="heading">{info.name.toUpperCase()}</div>

            <!-- Hull first: these two never change in flight, and they are what the
                 numbers below are consequences of -->
            <dl class="rows">
                <dt>mass</dt><dd>{info.mass.toFixed(0)}</dd>
                <dt>inertia</dt><dd>{info.inertia.toFixed(1)}</dd>
                <dt>engines</dt><dd>{info.thrusters}</dd>
            </dl>

            <div class="heading">MOTION</div>
            <dl class="rows">
                <dt>speed</dt><dd>{info.speed.toFixed(2)}</dd>
                <dt>spin</dt><dd class={Math.abs(spinRate) > 0.5 ? "warn" : ""}>
                    {spinRate.toFixed(1)}&deg;/s
                </dd>
            </dl>

            <div class="heading">BURN</div>
            <div class="burn">
                <div class="burn-track">
                    <div class="burn-fill" style={`width: ${burn * 100}%`}></div>
                </div>
                <span class="burn-count">{info.firing}/{info.thrusters}</span>
            </div>

            <div class="heading">POWER</div>
            <div class="burn">
                <div class="burn-track">
                    <div
                        class="burn-fill"
                        style={`width: ${powerLevel * 100}%; --fill: var(${powerLevel <= BROWNOUT ? "--alarm" : "--active"})`}
                    ></div>
                </div>
                <span class="burn-count">{info.power.toFixed(0)}/{info.powerCapacity.toFixed(0)}</span>
            </div>
            <dl class="rows">
                <dt>making</dt><dd>{info.producing.toFixed(1)}/s</dd>
                <dt>using</dt><dd class={info.drawing > info.producing ? "warn" : ""}>
                    {info.drawing.toFixed(1)}/s
                </dd>
            </dl>

            {#if info.weapons > 0}
                <div class="heading">WEAPONS</div>
                <dl class="rows">
                    <dt>mounts</dt><dd>{info.weapons}</dd>
                    {#if info.limited}
                        <dt>powered</dt>
                        <dd class={info.weaponsPowered < info.weapons ? "warn" : ""}>
                            {info.weaponsPowered}/{info.weapons}
                        </dd>
                    {/if}
                    <dt>targets</dt><dd>{info.targets}</dd>
                    <dt>in air</dt><dd>{info.shots}</dd>
                </dl>
            {/if}

            <div class="heading">FUEL</div>
            <div class="burn">
                <div class="burn-track">
                    <div
                        class="burn-fill"
                        style={`width: ${fuelLevel * 100}%; --fill: var(--fuel)`}
                    ></div>
                </div>
                <span class="burn-count">{info.fuel.toFixed(0)}/{info.fuelCapacity.toFixed(0)}</span>
            </div>

            <!-- Every one of these is a build problem rather than a flying problem,
                 and each is invisible from the cockpit unless it is said out loud -->
            {#if info.limited && info.powerCapacity === 0}
                <p class="note warn">no generator - nothing aboard makes power</p>
            {:else if info.limited && info.fuelCapacity === 0}
                <p class="note warn">no fuel tanks - the generators cannot run</p>
            {/if}
            {#if info.limited && info.unpowered > 0}
                <p class="note warn">{info.unpowered} engines out of reach of a generator</p>
            {/if}
            {#if info.islands > 1}
                <p class="note">{info.islands} separate power networks</p>
            {/if}

            <!-- A ship with no off-axis engine can never turn, and can never null a
                 spin either. Saying so beats letting someone conclude it is broken. -->
            {#if info.thrusters === 0}
                <p class="note warn">no engines - this hull cannot move</p>
            {/if}

            <div class="flags">
                <span class={info.assist ? "flag on" : "flag"}>assist</span>
                <span class={info.touching ? "flag hit" : "flag"}>contact</span>
                <span class={info.limited ? "flag on" : "flag"}>systems</span>
            </div>
        {:else}
            <p class="note">no ship yet</p>
        {/if}
    </div>

    <div id="keys" class="panel">
        {#each KEYS as row (row.key)}
            <div class="key-row">
                <b>{row.key}</b>
                <span>{row.does}</span>
            </div>
        {/each}
    </div>
</div>

<style>
    #flight-ui {
        --ui-background: rgba(0, 191, 255, 0.3);
        --ui-background-dark: rgba(0, 20, 34, 0.82);
        --ui-border: rgba(0, 191, 255, 0.55);
        --ui-separator: rgba(0, 191, 255, 0.25);
        --text-color: rgb(0, 221, 255);
        --active: rgb(0, 255, 64);
        --fuel: rgb(255, 179, 71);
        --alarm: rgb(255, 120, 120);

        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        color: var(--text-color);
        z-index: 1;
        font-family: "Jost", system-ui, sans-serif;
        /* The panels take the pointer back; everything between is the arena */
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

    #readout {
        top: 14px;
        right: 14px;
        width: 180px;
    }

    /* Opposite the readout, out of the way of the arena and of the numbers */
    #back {
        top: 14px;
        left: 14px;
        padding: 8px 12px;
        font-family: inherit;
        font-size: 12px;
        font-weight: bold;
        letter-spacing: .04em;
        color: var(--text-color);
        cursor: pointer;
    }
    #back:hover { background: var(--ui-background); }

    #keys {
        bottom: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 14px;
        padding: 8px 14px;
        font-size: 11px;
        opacity: .8;
    }
    .key-row { display: flex; gap: 6px; align-items: baseline; }
    .key-row b { color: var(--active); }

    .heading {
        text-align: center;
        line-height: 20px;
        font-size: 11px;
        letter-spacing: .14em;
        font-weight: bold;
        background: var(--ui-background);
        border-bottom: 1px solid var(--ui-separator);
    }

    .rows {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 8px;
        margin: 0;
        padding: 6px 8px;
        font-size: 12px;
    }
    .rows dt { opacity: .6; }
    .rows dd {
        margin: 0;
        text-align: right;
        font-weight: bold;
        /* Tabular figures, or a speed climbing past 9 jitters the whole column */
        font-variant-numeric: tabular-nums;
    }
    .warn { color: var(--alarm); }

    .burn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
    }
    .burn-track {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: var(--ui-background);
    }
    .burn-fill {
        height: 100%;
        border-radius: 3px;
        /* Each bar sets its own --fill; the burn bar never does and stays green */
        background: var(--fill, var(--active));
        transition: width .08s linear, background-color .2s linear;
    }
    .burn-count {
        font-size: 11px;
        opacity: .7;
        font-variant-numeric: tabular-nums;
    }

    .flags {
        display: flex;
        gap: 4px;
        padding: 0 8px 8px;
    }
    .flag {
        flex: 1;
        text-align: center;
        padding: 3px 0;
        font-size: 10px;
        letter-spacing: .08em;
        border: 1px solid var(--ui-separator);
        border-radius: 4px;
        opacity: .4;
    }
    .flag.on {
        opacity: 1;
        color: var(--active);
        border-color: rgba(0, 255, 64, 0.6);
    }
    .flag.hit {
        opacity: 1;
        color: var(--alarm);
        border-color: rgba(255, 120, 120, 0.6);
    }

    .note {
        margin: 0;
        padding: 6px 8px;
        font-size: 10px;
        opacity: .55;
        text-align: center;
    }
</style>
