<script lang="ts">
	import { onMount } from "svelte";
	import SecretText from "./SecretText.svelte";
	

	let quoteDisplay: HTMLParagraphElement
	let quote = "Loading quote..."

	const quoteList = [
		"\"May your heart not lead you to devestation.\" - Sandman, 2026",
		"\"I'd almost forgotten there were natural ways to die.\" - Sergeant Saunders, Combat",
		"\"Truth and beauty are often at odds.\" - Seamus Heaney, Poet",
		"\"I reject your reality, and substitute my own!\" - The Dungeonmaster",
		"\"Awake I am not here with you, this place, where this life wasn't true, oh please I don't wanna wake up, keep me, inside this life I've dreamed.\" - Orno's song Amethyst",
		"\"Sometimes I just want to talk and spout nonsense that sounds like eloquence.\" - Sandman",
		"\"You may fail, but when you fail you are failing forward.\" - Stacy Chu, May 11, 2019",
		"\"Unhappy is the land that is in need of heroes.\" - Bertolt Brecht, 1900s",
		"\"You see, what's so scary about God isn't his control, but rather... if he ever lost it.\" - Quantum Break",
		"\"Sometimes I feel like I was born with a leak. And any goodness I started with just slowly spilled out of me and now it's all gone and I'll never get it back in me. It's too late…\" - Bojack Horseman, Season 1 Episode 9, 2014",
		"\"Being lazy is an insult to those who believe in you.\" - Someone important to me, 2021",
		"\"I'm coughing because I am trying to throw up my memories.\" - A friend, 2021",
		"\"He doesn't have any more teeth. He's lied through them so much they've all withered away.\" - A friend, 2021",
		"\"I'll hold a gun to your head until you're happy.\" - Sandman, 10:43pm May 25th, 2022",
		"\"If you can't fight the fear, do it scared.\" - ChasingAlniliam on Reddit, 2022",
		"\"Has the rot inside your soul spread so far you cannot find value in anything not spoken in numbers?\" - almostsweetangel on Tumblr",
		"\"Don't bite the hand that feeds you but lick the finger.\" - Sandman",
		"\"You can't plan magic, but you can certainly make sure you have a bunch of magicians in a room.\" - Arcane Writer Christian, Sundance Interview 2023",
		"\"There are some diseases that can't be cured.\" - Sandman's Partner",
		"\"The opposite of crazy is still crazy.\" - No More Mr. Nice Guy",
		"\"People with real problems don't need to invent monsters to be afraid of.\" - Sandman's Partner, 2025-01-01 10:22",
		"\"You are dust, and to dust you shall return.\" - God, Genesis 3:19",
	]

	onMount(() => {
		if (!quoteDisplay) return
		const randomIndex = Math.floor(Math.random() * quoteList.length)
		quote = quoteList[randomIndex]
	})
</script>

<section class="content-container tinted-border">
	<h1>Welcome to Sandman's Dreamscape</h1>
	<p class="quote" bind:this={quoteDisplay}>{quote}</p>

	<p>Hello and welcome! My name is Gabriel the Angel, but you can call me Gabe or Sandman. I am a sort of "Jack-of-all-trades", doing coding, writing, art, music, etc. My main focuses right now is on music and coding. I can't wait to share all the stuff I am working on with you!</p>
	<p>This site will (eventually) contain a lot of things:</p>
	<ul>
		<li>Projects I am working on or have finished</li>
		<li>Tools I have made (with UI) or code snippets</li>
		<li>Articles or posts about things I want to talk about or deem important</li>
		<li>Some fun web stuff that I thought would be cool</li>
		<li><SecretText text="Secrets, traps, and unique entertainment"/></li>
		<li>And much more!!!</li>
	</ul>
</section>

