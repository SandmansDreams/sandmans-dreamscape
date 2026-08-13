<script lang="ts">
    import { positionToRange, rangeToPosition, type SearchColumn, type SettingsSchema, type SettingValue, type SettingValues, type SettingSpec } from "../settings/settings"

    let { schema, values = $bindable(), onAction}: {
        schema: SettingsSchema
        values: SettingValues
        onAction?: (name: string) => void
    } = $props()

    // Object key order is insertion order for string keys, so rows appear in the
    // order the scene declared them
    let entries = $derived(Object.entries(schema))

    // Replaces the object rather than mutating a key: the parent's
    // $effect(() => runner.setValues(values)) only re-runs on reassignment
    function set(key: string, value: SettingValue) {
        values = { ...values, [key]: value }
    }

    // Match the readout's precision to the step, so 0.1 + 0.2 does not show its seams
    function decimals(step: number | undefined): number {
        const text = String(step ?? 1)
        const dot = text.indexOf(".")
        return dot === -1 ? 0 : text.length - dot - 1
    }

    // Query text is transient UI state, not a setting - it is what you typed to
    // find a value, and it should not be saved or pushed to the scene
    let queries = $state<Record<string, string>>({})

    /** The option id plus every column cell, which is what a query is tested against. */
    function searchText(option: string, columns: readonly SearchColumn[]): string {
        return [option, ...columns.map((column) => column.cell(option))].join(" ").toLowerCase()
    }

    function matches(
        options: readonly string[],
        query: string,
        limit: number,
        columns: readonly SearchColumn[],
    ): string[] {
        const needle = query.trim().toLowerCase()
        const found = needle === ""
            ? options
            : options.filter((option) => searchText(option, columns).includes(needle))

        return found.slice(0, limit)
    }

    /** The cells of one result row. With no columns declared, just the option id. */
    function cellsOf(option: string, columns: readonly SearchColumn[]): string[] {
        return columns.length === 0 ? [option] : columns.map((column) => column.cell(option))
    }

    /** Shared by the header and every row, so their columns line up. */
    function columnTemplate(count: number): string {
        return `repeat(${Math.max(count, 1)}, minmax(0, 1fr))`
    }

    function reset(key: string, spec: SettingSpec) {
        // A button's value is a monotonic click counter, so "resetting" it back to 0
        // is itself a change and every scene watching would read it as another press
        if (spec.type === "separator" || spec.type === "button") return
        set(key, spec.default)
    }
</script>

<div class="settings">
    {#each entries as [key, spec] (key)}
        {#if spec.type === "range"}
            <label class="label" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            <input
                id={key}
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={rangeToPosition(spec.min, spec.max, spec.scale, Number(values[key] ?? spec.default))}
                oninput={(e) => set(key, positionToRange(spec.min, spec.max, spec.scale, e.currentTarget.valueAsNumber, spec.step))}
                ondblclick={() => reset(key, spec)}
            />
            <span class="readout">
                {Number(values[key] ?? spec.default).toFixed(decimals(spec.step))}{spec.unit ?? ""}
            </span>

        {:else if spec.type === "number"}
            <label class="label" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            <input
                id={key}
                class="wide"
                type="number"
                min={spec.min}
                max={spec.max}
                step={spec.step ?? 1}
                value={Number(values[key] ?? spec.default)}
                oninput={(e) => Number.isFinite(e.currentTarget.valueAsNumber) && set(key, e.currentTarget.valueAsNumber)}
            />

        {:else if spec.type === "color"}
            <label class="label" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            <input
                id={key}
                class="swatch"
                type="color"
                value={String(values[key] ?? spec.default)}
                oninput={(e) => set(key, e.currentTarget.value)}
            />
            <span class="readout">{String(values[key] ?? spec.default)}</span>

        {:else if spec.type === "button"}
            <button class="action full" type="button" onclick={() => onAction?.(key)}>{spec.label}</button>

        {:else if spec.type === "separator"}
            <div class="separator-container full">
                <span class="separator-line"></span>
                <p>{spec.label}</p>
                <span class="separator-line"></span>
            </div>

        {:else if spec.type === "selection" && spec.display === "segmented"}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="label" title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </span>
            <div class="segmented wide">
                {#each spec.options as option (option)}
                    <button
                        type="button"
                        class:active={String(values[key] ?? spec.default) === option}
                        onclick={() => set(key, option)}
                    >{option}</button>
                {/each}
            </div>
        {:else if spec.type === "checkbox"}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="label" title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </span>
            <button
                type="button"
                class="toggle wide"
                class:active={Boolean(values[key] ?? spec.default)}
                aria-pressed={Boolean(values[key] ?? spec.default)}
                onclick={() => set(key, !(values[key] ?? spec.default))}
            >{(values[key] ?? spec.default) ? "on" : "off"}</button>
        {:else if spec.type === "search"}
            <input
                id={key}
                class="search full"
                type="text"
                placeholder={spec.placeholder ?? "Search..."}
                value={queries[key] ?? ""}
                oninput={(e) => (queries = { ...queries, [key]: e.currentTarget.value })}
            />
            {@const columns = spec.columns ?? []}
            {@const found = matches(spec.options, queries[key] ?? "", spec.limit ?? 8, columns)}
            {@const template = columnTemplate(columns.length)}
            <div class="results full">
                {#if columns.length > 0}
                    <div class="result-head" style:grid-template-columns={template}>
                        {#each columns as column (column.header)}
                            <span>{column.header}</span>
                        {/each}
                    </div>
                {/if}
                {#each found as option (option)}
                    {@const cells = cellsOf(option, columns)}
                    <button
                        type="button"
                        class="result-row"
                        style:grid-template-columns={template}
                        class:active={String(values[key] ?? spec.default) === option}
                        onclick={() => set(key, option)}
                        aria-label={cells.join(", ")}
                        title={cells.join(" - ")}
                    >
                        {#each cells as cell, index (index)}
                            <span>{cell}</span>
                        {/each}
                    </button>
                {/each}
                {#if found.length === 0}
                    <span class="empty">no matches</span>
                {/if}
            </div>

        {:else if spec.type === "selection"}
            <label class="label" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            <select
                id={key}
                class="wide"
                value={String(values[key] ?? spec.default)}
                onchange={(e) => set(key, e.currentTarget.value)}
            >
                {#each spec.options as option (option)}
                    <option value={option}>{option}</option>
                {/each}
            </select>
        {:else}
            <label class="label full" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            {#if (spec.rows ?? 1) > 1}
                <!-- oninput not onchange: the scene should follow every keystroke
                     rather than waiting for the field to be blurred -->
                <textarea
                    id={key}
                    class="full"
                    rows={spec.rows}
                    placeholder={spec.placeholder ?? ""}
                    value={String(values[key] ?? spec.default)}
                    oninput={(e) => set(key, e.currentTarget.value)}
                ></textarea>
            {:else}
                <input
                    id={key}
                    class="full"
                    type="text"
                    placeholder={spec.placeholder ?? ""}
                    value={String(values[key] ?? spec.default)}
                    oninput={(e) => set(key, e.currentTarget.value)}
                />
            {/if}
        {/if}
    {/each}
</div>

<style>
    .settings {
        display: grid;
        grid-template-columns: 72px 1fr 44px;
        gap: 6px 10px;
        align-items: center;
        margin: 8px 0;
    }

    .label { color: #ffffff99; }
    .label[title] {
        cursor: pointer;
        user-select: none; /* or a double-click just highlights the word */
    }
    .label[title]:hover { color: #fff; }

    .readout {
        color: #0df;
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    /* A control with no readout takes the readout's column too */
    .wide { grid-column: 2 / span 2; }

    /* A sentence in a 1fr column next to its label is a scrolling keyhole */
    .full { grid-column: 1 / -1; }

    .separator-container {
        color: #ffffff55;
        text-transform: uppercase;
        letter-spacing: .08em;
        display: grid;
        grid-template-columns: auto auto auto;
        justify-items: center;
        align-items: center;
        position: relative;
    }
    .separator-line {
        position: relative;
        height: 10%;
        width: 100%;
        background-color: #0df3;
        border-radius: 1rem;
        padding: none;
        margin: auto;
    }

    .toggle { width: 100%; }

    .toggle.active,
    .segmented button.active {
        background: #0df2;
        border-color: #0df;
        color: #0df;
    }

    .segmented { display: flex; gap: 4px; }
    .segmented button { flex: 1; }
    .segmented button.active {
        background: #0df2;
        border-color: #0df;
        color: #0df;
    }

    .swatch {
        width: 100%;
        height: 20px;
        padding: 0;
        border: 1px solid #0df3;
        border-radius: 3px;
        background: none;
    }

    .search {
        width: 100%;
    }
    /* A fixed block that scrolls, not one that grows: typing should filter the
       list without the controls below it jumping up and down the panel */
    .results {
        display: flex;
        flex-direction: column;
        gap: 1px;
        border: 1px solid #0df3;
        border-radius: 3px;
        background: #0b1116;
        padding: 3px;
        width: 100%;
        height: 80px;
        overflow-y: auto;
    }

    /* Matches the dev panel's own bar. Same caveat: these are ignored the moment
       scrollbar-width or scrollbar-color is set on the element, so the standard
       properties live in the @supports block below. */
    .results::-webkit-scrollbar {
        width: 10px;
    }
    .results::-webkit-scrollbar-track {
        background: transparent;
    }
    .results::-webkit-scrollbar-thumb {
        background: #0df3;
        border-radius: 5px;
        /* Transparent border plus content-box clipping insets the thumb without
           narrowing the track, so the hit area stays a comfortable 10px */
        border: 2px solid transparent;
        background-clip: content-box;
    }
    .results::-webkit-scrollbar-thumb:hover {
        background: #0dfa;
        background-clip: content-box;
    }

    /* Firefox, which has no pseudo-elements to style */
    @supports not selector(::-webkit-scrollbar) {
        .results {
            scrollbar-width: thin;
            scrollbar-color: #0df6 transparent;
        }
    }

    /* Scrolls away with the rows rather than sticking: a sticky header over a
       translucent panel needs an opaque backing or the rows ghost through it */
    .result-head {
        display: grid;
        gap: 0 8px;
        padding: 0 4px 2px;
        color: #ffffff99;
        border-bottom: 1px solid #0df3;
    }

    .result-row {
        display: grid;
        gap: 0 8px;
        width: 100%;
        text-align: left;
        border: 1px solid transparent;
        border-radius: 2px;
        padding: 1px 4px;
        background: none;
    }
    .result-row:hover { border-color: #0df; }
    .result-row.active { border-color: #0df3; background: #163045; color: #0df; }

    /* Cells clip rather than wrap: one long creator name should not make its row
       twice as tall as the others and break the table's rhythm */
    .result-head span,
    .result-row span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .empty { color: #ffffff55; }

    button {
        background: #0b1116;
        color: #fff;
        border: 1px solid #0df3;
        border-radius: 3px;
        padding: 3px 6px;
        font: inherit;
        cursor: pointer;
    }
    button:hover { border-color: #0df; }
    button:active { background: #163045; }

    input[type="range"] { width: 100%; accent-color: #0df; }

    select,
    input[type="text"],
    textarea {
        width: 100%;
        background: #0b1116;
        color: #fff;
        border: 1px solid #0df3;
        border-radius: 3px;
        padding: 3px 5px;
        font: inherit;
    }
    textarea {
        /* Reserves the gutter whether or not the bar is showing, so typing past the
           last visible row does not reflow the text by 10px */
        scrollbar-gutter: stable;
        resize: vertical;
    }

    textarea::-webkit-scrollbar {
        width: 10px;
    }
    textarea::-webkit-scrollbar-track {
        background: transparent;
    }
    textarea::-webkit-scrollbar-thumb {
        background: #0df3;
        border-radius: 5px;
        border: 2px solid transparent;
        background-clip: content-box;
    }
    textarea::-webkit-scrollbar-thumb:hover {
        background: #0dfa;
        background-clip: content-box;
    }

    @supports not selector(::-webkit-scrollbar) {
        textarea {
            scrollbar-width: thin;
            scrollbar-color: #0df6 transparent;
        }
    }
</style>
