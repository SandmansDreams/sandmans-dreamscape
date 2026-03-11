<script lang="ts">
	import { formatDate } from '$lib/utils'

	let { data } = $props()

	let readable = $state(false)
	let darkMode = $state(false)
</script>

<svelte:head>
	<title>{data.meta.title}</title>
	<meta property="og:type" content="article" />
	<meta property="og:title" content={data.meta.title} />
</svelte:head>

<div class="header">
    <a href="/articles" class="default-button back-button">{"← Back to Articles"}</a>
    <p style="text-align: center; text-indent: 0px;">Uploaded on {formatDate(data.meta.date)}</p>
    <div class="tags">
        {#each data.meta.tags as tags}
            <span class="tag">&num;{tags}</span>
        {/each}
    </div>
</div>

<article class="content-container tinted-border" class:readable class:dark-mode={darkMode}>
    <div class="toolbar">
        <button class="default-button" onclick={() => readable = !readable}>
            {readable ? 'Restore Style' : 'Make Readable'}
        </button>
        {#if readable}
            <button class="default-button" onclick={() => darkMode = !darkMode}>
                {darkMode ? 'Light' : 'Dark'}
            </button>
        {/if}
    </div>
    <h1>{data.meta.title}</h1>

	<div class="prose">
		<data.content />
	</div>
</article>

<style>
	article {
		max-inline-size: var(--size-content-3);
		margin-inline: auto;
	}

    .back-button {
        display: inline-block;
        max-width: fit-content;
        color: white;
        text-decoration: none;
    }

    .tags {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 10px;
        font-size: 14pt;
        height: fit-content;
        padding-bottom: 1rem;
        justify-self: center;
    }

    .tag {
        background-color: rgba(0, 0, 0, 0.5);
        border-radius: 8rem;
        padding: 0.25rem 0.5rem;
    }

    .header {
        display: grid;
        grid-template-columns: 2fr 5fr 4fr;
        justify-content: space-between;
        align-items: center;
    }

    article.readable {
        background-color: #f5f0e8;
        color: #1a1a1a;
        border-color: transparent;
        padding: 2.5rem 3rem;
        border-radius: 8px;
    }

    article.readable :global(.prose) {
        font-family: 'Georgia', 'Times New Roman', serif;
        font-size: 1.125rem;
        line-height: 1.9;
        letter-spacing: 0.01em;
    }

    article.readable :global(.prose p) {
        margin-block: 1.25em;
        text-shadow: none;
        line-height: 1.5;
    }

    article.readable :global(h1) {
        font-family: 'Georgia', 'Times New Roman', serif;
        color: #1a1a1a;
        margin-bottom: 1.5rem;
    }

    article.readable :global(h2) {
        font-family: 'Georgia', 'Times New Roman', serif;
        color: #1a1a1a;
        margin-block: 1.25rem 0.75rem;
        border-top: 1px solid black;
        text-shadow: none;
    }

    article.readable :global(h3) {
        font-family: 'Georgia', 'Times New Roman', serif;
        color: #1a1a1a;
        margin-block: 1.25rem 0.75rem;
        text-shadow: none;
    }

    article.readable :global(li) {
        font-family: 'Georgia', 'Times New Roman', serif;
        color: #1a1a1a;
        margin-block: 1.25rem 0.75rem;
        text-shadow: none;
    }

    article.readable :global(img) {
        border: 3px solid black;
    }

    .toolbar {
        width: 100%;
        display: flex;
        justify-content: center;
        gap: 0.75rem;
    }

    /* ── Dark mode ── */
    article.dark-mode {
        background-color: #1c1c1f;
        color: #e0ddd5;
        border-color: transparent;
        padding: 2.5rem 3rem;
        border-radius: 8px;
    }

    article.dark-mode :global(.prose) {
        font-family: 'Georgia', 'Times New Roman', serif;
        font-size: 1.125rem;
        line-height: 1.9;
        letter-spacing: 0.01em;
    }

    article.dark-mode :global(.prose p) {
        margin-block: 1.25em;
        text-shadow: none;
        line-height: 1.5;
    }

    article.dark-mode :global(h1),
    article.dark-mode :global(h2),
    article.dark-mode :global(h3) {
        font-family: 'Georgia', 'Times New Roman', serif;
        color: #f0ece4;
        text-shadow: none;
    }

    article.dark-mode :global(h2) {
        border-top: 1px solid #4a4a6a;
        margin-block: 1.25rem 0.75rem;
    }

    article.dark-mode :global(h3) {
        margin-block: 1.25rem 0.75rem;
    }

    article.dark-mode :global(li) {
        font-family: 'Georgia', 'Times New Roman', serif;
        color: #e0ddd5;
        margin-block: 1.25rem 0.75rem;
        text-shadow: none;
    }

    article.dark-mode :global(img) {
        border: 3px solid #4a4a6a;
    }
</style>