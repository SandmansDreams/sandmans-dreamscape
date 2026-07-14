<svelte:head>
	<title>Sandman's Tools</title>
	<meta name="description" content="Web tools I made" />
</svelte:head>

<section class="content-container tinted-border">
    <h1 style="margin: 0">Tools</h1>
    <h2 style="margin: 0">Some web tools I created in with JavaScript</h2>

    <ul class="posts">
        <a class="post tinted" href={`/tools/audio-visualizer`}>
            <img class="cover" src="Sandman Logo.png"  alt="Audio Visualizer Preview" loading="lazy" />
            <div class="details">
                <h3 class="title">Audio Visualiser</h3>
                <p class="date">Upload Date: 7/10/26</p>
                <p class="summary">A local audio visualizer with different modes and settings</p>
            </div>
        </a>
        <a class="post tinted" href={`/tools/audio-visualizer`}>
            <img class="cover" src="Sandman Logo.png"  alt="Audio Visualizer Preview" loading="lazy" />
            <div class="details">
                <h3 class="title">Pixel Sorter</h3>
                <p class="date">Upload Date: 7/10/26</p>
                <p class="summary">A local image editor which sorts your pixels for cool effects</p>
            </div>
        </a>
    </ul>
</section>
