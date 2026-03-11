<script lang="ts">
	import { formatDate } from '$lib/utils'

	let { data } = $props()
</script>

<svelte:head>
	<title>{data.meta.title}</title>
	<meta property="og:type" content="article" />
	<meta property="og:title" content={data.meta.title} />
</svelte:head>

<div class="header">
    <a href="/articles" class="back-button">{"← Back to Articles"}</a>
    <p style="text-align: center; text-indent: 0px;">Uploaded on {formatDate(data.meta.date)}</p>
    <div class="tags">
        {#each data.meta.tags as tags}
            <span class="tag">&num;{tags}</span>
        {/each}
    </div>
</div>

<article class="content-container tinted-border">
    <h1>{data.meta.title}</h1>

	<div class="tags">
		{#each data.meta.categories as category}
			<span class="surface-4">&num;{category}</span>
		{/each}
	</div>

	<div class="prose">
		<data.content />
	</div>
</article>

<style>
	article {
		max-inline-size: var(--size-content-3);
		margin-inline: auto;

		h1 {
			text-transform: capitalize;
		}

		h1 + p {
			margin-top: var(--size-2);
			color: var(--text-2);
		}

        li {
            margin-top: var(--size-3);
        }
	}

    .back-button {
        background-color: rgba(0, 0, 0, 0.5);
        border: none;
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 8rem;
        text-decoration: none;
        font-size: 14pt;
        display: inline-block;
        max-width: fit-content;
    }

    .back-button:hover {
        background-color: rgba(0, 0, 0, 0.7);
    }

    .tags {
        display: flex;
        justify-content: center;
        gap: 10px;
        font-size: 14pt;
        > * {
            padding: var(--size-2) var(--size-3);
            border-radius: var(--radius-round);
        }
    }

    .tag {
        background-color: rgba(0, 0, 0, 0.5);
        border-radius: 8rem;
        padding: 0.25rem 0.5rem;
    }

    .header {
        display: grid;
        grid-template-columns: 2fr 5fr 2fr;
        justify-content: space-between;
        align-items: center;
    }
</style>