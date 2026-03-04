<svelte:head>
	<title>About</title>
	<meta name="description" content="About the dreamscape" />
</svelte:head>

<section class="content-container tinted-border"> 
	<h1>About the Dreamscape</h1>
	<p>The dreamscape is a place for creativity, learning, exploration, and self-expression. I made it for me and for you. It's purpose is to inspire creativity and help you guys out with anything I have to offer. There will eventually be some tools and code for you guys to reference off of. If there is anything I have that you want to know how to make, let me know and I'll see about posting it!</p>
	<p>Also, please check out my projects page and leave a note in my guestbook once both are up. Would love to see what you think!</p>

	<h1>About Sandman</h1>
	<p style="justify-self: center;">So you wanna know about me huh? </p>
	<p style="justify-self: center;">Well there isn't much to tell. Here are some scant details about my life:</p>
	<ul>
		<li>I was born and raised in California, USA</li>
		<li>I have had at least five different jobs including the US military</li>
		<li>I have government secrets</li>
		<li>No, you can't have them</li>
		<li>I have been making music <i>seriously</i> since about 2020 but depending on when you start counting I have been doing musical stuff since I was a kid</li>
		<li>I have a long-distance girlfriend of almost three years now (we met on Discord)</li>
		<li>You can't have her either</li>
		<li>Would you take everything from me, given the chance?</li>
		<li>I do a bunch of other stuff as well</li>
		<li>Like, a lot, trust me...</li>
		<li>I also have a lot of stories in my head from when I was a kid and more recent times. I call people like me "people with universes in their heads". Creative right? I love meeting more people like that.</li>
		<li>I have a group of friends on Discord who do occasional real life meetups. Our first one was in a cabin in the woods and miraculously none of us turned out to be serial killers.</li>
		<li>I'm not a serial killer</li>
		<li>At least, not that I know of...</li>
		<li>I'm pretty sure I'm not one though</li>
		<li>I love Obsidian (the notetaking app), but I am making my own version with Tauri and Rust because it's too limited. That's the kind of person I am...</li>
		<li>I am a librarian</li>
		<li>Yes, you can have the books, you just have to check them out first</li>
		<li>Thanks</li>
	</ul>

	<h2>Accounts</h2>
	<p>Here are some of my internet accounts where you can check out some of my stuff or reach out for conversation:</p>


<div class="links-table">
	<a class="link-row" href="https://www.youtube.com/@gabrieltangel" target="_blank" rel="noopener" title="Youtube">
		<img src="/src/lib/images/icons/youtube.svg" alt="Youtube" class="icon"/>
		<span class="display-name">Gabriel The Angel</span>
		<p>I do Minecraft stuff and the occasional Rocket League montage. Might make it more of a general channel.</p>
	</a>
	<a class="link-row" href="https://www.twitch.tv/gabrieltangel" target="_blank" rel="noopener" title="Twitch">
		<img src="/src/lib/images/icons/twitch.svg" alt="Twitch" class="icon" />
		<span class="display-name">GabrielTAngel</span>
		<p>I don't really stream often, but I do sometimes and plan to do it more. Mostly music production streams.</p>
	</a>
	<a class="link-row" href="https://soundcloud.com/mpatheticproducer" target="_blank" rel="noopener" title="Soundcloud">
		<img src="/src/lib/images/icons/soundcloud.png" alt="Soundcloud" class="icon soundcloud-icon" />
		<span class="display-name">Mpathetic</span>
		<p>I don't posty my music really but I am working on it. The good stuff is on this site, but theres some other stuff on here as well.</p>
	</a>
	<a class="link-row" href="https://github.com/SandmansDreams" target="_blank" rel="noopener" title="Github">
		<img src="/src/lib/images/icons/github.svg" alt="Github" class="icon" />
		<span class="display-name">Sandman</span>
		<p>I just be making stuff with code on occasion. Some little project in here but the major ones are private repos.</p>
	</a>

</div>
</section>

<style>
	.links-table {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		margin: 1.5rem auto;
		width: fit-content;
		background: rgba(0,0,0,0.3);
		border-radius: 1.1rem;
		padding: 1.2rem 1.5rem;
		font-family: inherit;
		justify-items: center;
	}

	.links-table a, .links-table p {
		color: white;
		text-decoration: none;
		font-weight: bold;
		text-shadow: none;
		margin: 0;
		text-indent: 0;
	}

	p {
		padding-inline: 1rem;
	}


	.link-row {
		display: grid;
		grid-template-columns: 1fr 3fr 10fr;
		align-items: center;
		gap: .5rem;
		padding: .25rem .5rem;
		border-radius: 0.7rem;
		transition: background 0.18s;
		background-color: rgba(0,0,0,0.1);
	}
	.link-row:hover {
		background: rgba(255,255,255,0.09);
	}

	.icon {
		width: 2.5rem;
		height: 2.5rem;
		display: block;
		justify-self: center;
	}

	/* Orange filter for Soundcloud PNG */
	.soundcloud-icon {
	  filter: brightness(0) saturate(100%) invert(63%) sepia(94%) saturate(4000%) hue-rotate(1deg) brightness(101%) contrast(104%);
	}

	.display-name {
		font-size: 1.08rem;
		font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
		color: #f3f3f3;
		letter-spacing: 0.01em;
		padding-left: 0.2rem;
		opacity: 0.93;
		text-shadow: 0 1px 2px rgba(0,0,0,0.13);
		border-inline: 1px solid rgba(255,255,255,0.2);
		text-align: center;
	}
</style>