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