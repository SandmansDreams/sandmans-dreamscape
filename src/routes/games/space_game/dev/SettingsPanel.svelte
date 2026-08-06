<script lang="ts">
    import type { SettingSchema, SettingValue, SettingValues } from "../settings"

    let { schema, values = $bindable() }: {
        schema: readonly SettingSchema[]
        values: SettingValues
    } = $props()

    // Replace the object rather than mutating, so the parent's effect fires
    function set(key: string, value: number | boolean | string) {
        values = { ...values, [key]: value }
    }

    // How far along the track the filled portion should run
    function fillPercent(value: SettingValue, min: number, max: number): number {
        if (typeof value !== "number" || max === min) return 0
        return ((value - min) / (max - min)) * 100
    }

    // Match the displayed precision to the step, so 0.1 + 0.2 doesn't show its seams
    function format(value: SettingValue, step: number | undefined): string {
        if (typeof value !== "number") return String(value)
        const decimals = step && step < 1 ? (String(step).split(".")[1]?.length ?? 0) : 0
        return value.toFixed(decimals)
    }
</script>

<div class="panel">
    {#each schema as setting (setting.key)}
        <label class="row" class:wide={setting.type !== "range"}>
            <span class="name">{setting.label}</span>

            {#if setting.type === "range"}
                <input
                    type="range"
                    min={setting.min}
                    max={setting.max}
                    step={setting.step ?? 1}
                    value={values[setting.key] as number}
                    style="--fill: {fillPercent(values[setting.key], setting.min, setting.max)}%"
                    oninput={(e) => set(setting.key, e.currentTarget.valueAsNumber)}
                />
                <span class="value">{format(values[setting.key], setting.step)}</span>

            {:else if setting.type === "checkbox"}
                <input
                    type="checkbox"
                    checked={values[setting.key] as boolean}
                    onchange={(e) => set(setting.key, e.currentTarget.checked)}
                />

            {:else if setting.type === "selection"}
                <span class="select">
                    <select
                        value={values[setting.key] as string}
                        onchange={(e) => set(setting.key, e.currentTarget.value)}
                    >
                        {#each setting.options as option}
                            <option value={option}>{option}</option>
                        {/each}
                    </select>
                </span>
            {/if}
        </label>
    {/each}
</div>

<style>
    .panel {
        --accent: #0df;
        --glow: #0df6;
        --line: #0df3;
        --track: #ffffff14;

        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .row {
        display: grid;
        grid-template-columns: 78px 1fr 46px;
        align-items: center;
        gap: 10px;
        padding: 4px 6px;
        border-radius: 3px;
    }

    .row.wide {
        grid-template-columns: 78px 1fr;
    }

    .row:hover {
        background: #ffffff0a;
    }

    .name {
        color: var(--accent);
        opacity: 0.75;
        letter-spacing: 0.02em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .row:hover .name {
        opacity: 1;
    }

    .value {
        text-align: right;
        color: #fff;
        opacity: 0.85;
        font-variant-numeric: tabular-nums;
    }

    /*~~~ Range ~~~*/
    input[type="range"] {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        height: 14px;
        background: transparent;
        cursor: ew-resize;
    }

    input[type="range"]::-webkit-slider-runnable-track {
        height: 3px;
        background: linear-gradient(
            to right,
            var(--accent) 0,
            var(--accent) var(--fill),
            var(--track) var(--fill),
            var(--track) 100%
        );
    }

    input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 10px;
        height: 10px;
        margin-top: -3.5px; /* centres the thumb on a 3px track */
        background: var(--accent);
        box-shadow: 0 0 6px var(--glow);
    }

    input[type="range"]:hover::-webkit-slider-thumb,
    input[type="range"]:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 10px var(--accent);
    }

    input[type="range"]::-moz-range-track {
        height: 3px;
        background: var(--track);
    }

    input[type="range"]::-moz-range-progress {
        height: 3px;
        background: var(--accent);
    }

    input[type="range"]::-moz-range-thumb {
        width: 10px;
        height: 10px;
        border: none;
        border-radius: 0;
        background: var(--accent);
        box-shadow: 0 0 6px var(--glow);
    }

    input[type="range"]:focus-visible {
        outline: none;
    }

    /*~~~ Checkbox ~~~*/
    input[type="checkbox"] {
        appearance: none;
        -webkit-appearance: none;
        position: relative;
        justify-self: start;
        width: 14px;
        height: 14px;
        margin: 0;
        border: 1px solid var(--line);
        background: var(--track);
        cursor: pointer;
    }

    input[type="checkbox"]:hover {
        border-color: var(--accent);
    }

    input[type="checkbox"]:checked {
        background: var(--accent);
        border-color: var(--accent);
        box-shadow: 0 0 6px var(--glow);
    }

    input[type="checkbox"]:checked::after { /* the tick */
        content: "";
        position: absolute;
        left: 4px;
        top: 1px;
        width: 3px;
        height: 7px;
        border: solid #000;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
    }

    /*~~~ Selection ~~~*/
    .select {
        position: relative;
        display: block;
    }

    .select::after { /* the arrow - the native one can't be styled */
        content: "";
        position: absolute;
        top: 50%;
        right: 8px;
        margin-top: -2px;
        border: 4px solid transparent;
        border-top-color: var(--accent);
        pointer-events: none;
    }

    select {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        padding: 3px 22px 3px 7px;
        border: 1px solid var(--line);
        background: var(--track);
        color: #fff;
        font: inherit;
        cursor: pointer;
    }

    select:hover,
    select:focus-visible {
        border-color: var(--accent);
        outline: none;
    }

    option {
        background: #0b0f12;
        color: #fff;
    }
</style>
