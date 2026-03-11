<script lang="ts">
	import { formatDate } from '$lib/utils'

	let { data } = $props()
</script>

<svelte:head>
	<title>Articles</title>
</svelte:head>

<section class="content-container tinted-border">
    <h1>Articles</h1>
    <h2>Just stuff I wanted to talk about or found interesting</h2>
	<ul class="posts">
		{#each data.posts as post}
			<a class="post tinted" href={`/articles/${post.slug}`}>
				<img class="cover" src={post.coverImage} alt={post.title} loading="lazy" />
				<div class="details">
                    <h3 class="title">{post.title}</h3>
					<p class="date">Upload Date: {formatDate(post.date)}</p>
					<p class="summary">{post.summary}</p>
				</div>
			</a>
		{/each}
	</ul>
</section>

<style>
	.posts {
		display: grid;
		gap: 0.5rem;
        color: white;
        padding: 0;
    }

    .post {
        display: grid;
        grid-template-columns: 1fr 4fr;
        gap: .5rem;
        position: relative;
        align-items: start;
        background-color: rgba(0,0,0,0.3);
        border-radius: 2rem;
        overflow: hidden;
        padding: 0;
        transition: 0.2s;
        max-height: 150px;
        border: 3px solid rgba(0, 0, 0, 0.2);
        align-items: center;
        color: white;
        text-decoration: none;
        width: 100%;
    }

    .post:hover {
        transition: 0.2s;
        border: 3px solid rgb(255, 255, 255);
    }
    
    .cover {
        width: 100%;
        min-width: 150px;
        max-height: 150px;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        border-radius: 0;
        border: none;
    }

    .title {
        text-wrap: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
        margin: 0;
    }

    .details {
        width: 100%;
        height: 100%;
        max-height: 150px;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: .5rem 1rem;
        min-width: 0;
        overflow: hidden;
    }

    .date {
        text-indent: 0;
        margin: 0;
        color: lightgray;
    }

    .summary {
        text-indent: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        margin: 0;
    }
</style>