<script lang="ts">
	import { onMount } from "svelte";
	import SecretText from "../SecretText.svelte";
	

	let quote = $state({
		quote: "Loading...",
		attribution: "By noone",
	})

	type Quote = {
		quote: string,
		attribution: string,
	}

	const quoteList: Quote[] = [
		{ 
			quote: "May your heart not lead you to devestation.", 
			attribution: "Sandman, 2026" 
		},
		{ 
			quote: "I'd almost forgotten there were natural ways to die.", 
			attribution: "Sergeant Saunders, Combat" 
		},
		{ 
			quote: "Truth and beauty are often at odds.", 
			attribution: "Seamus Heaney, Poet" 
		},
		{ 
			quote: "I reject your reality, and substitute my own!", 
			attribution: "SAO Abridged Season 1 Finale, but originally The Dungeonmaster" 
		},
		{ 
			quote: "Awake I am not here with you, this place, where this life wasn't true, oh please I don't wanna wake up, keep me, inside this life I've dreamed.", 
			attribution: "Orno's song Amethyst" 
		},
		{ 
			quote: "Sometimes I just want to talk and spout nonsense that sounds like eloquence.", 
			attribution: "Sandman" 
		},
		{ 
			quote: "You may fail, but when you fail you are failing forward.", 
			attribution: "Stacy Chu, May 11, 2019" 
		},
		{ 
			quote: "Unhappy is the land that is in need of heroes.", 
			attribution: "Bertolt Brecht, 1900s" 
		},
		{ 
			quote: "You see, what's so scary about God isn't his control, but rather... if he ever lost it.", 
			attribution: "Quantum Break" 
		},
		{ 
			quote: "Sometimes I feel like I was born with a leak. And any goodness I started with just slowly spilled out of me and now it's all gone and I'll never get it back in me. It's too late…", 
			attribution: "Bojack Horseman, Season 1 Episode 9, 2014" 
		},
		{ 
			quote: "Being lazy is an insult to those who believe in you.", 
			attribution: "Someone important to me, 2021" 
		},
		{ 
			quote: "I'm coughing because I am trying to throw up my memories.", 
			attribution: "A friend, 2021" 
		},
		{ 
			quote: "He doesn't have any more teeth. He's lied through them so much they've all withered away.", 
			attribution: "A friend, 2021" 
		},
		{ 
			quote: "I'll hold a gun to your head until you're happy.", 
			attribution: "Sandman, 10:43pm May 25th, 2022" 
		},
		{ 
			quote: "If you can't fight the fear, do it scared.", 
			attribution: "ChasingAlniliam on Reddit, 2022" 
		},
		{ 
			quote: "Has the rot inside your soul spread so far you cannot find value in anything not spoken in numbers?", 
			attribution: "almostsweetangel on Tumblr" 
		},
		{ 
			quote: "Don't bite the hand that feeds you but lick the finger.", 
			attribution: "Sandman" 
		},
		{ 
			quote: "You can't plan magic, but you can certainly make sure you have a bunch of magicians in a room.", 
			attribution: "Arcane Writer Christian, Sundance Interview 2023" 
		},
		{ 
			quote: "There are some diseases that can't be cured.", 
			attribution: "Sandman's Partner"
		},
		{ 
			quote: "The opposite of crazy is still crazy.", 
			attribution: "No More Mr. Nice Guy" 
		},
		{ 
			quote: "People with real problems don't need to invent monsters to be afraid of.", 
			attribution: "Sandman's Partner, 2025-01-01 10:22" 
		},
		{ 
			quote: "You are dust, and to dust you shall return.", 
			attribution: "God, Genesis 3:19" 
		},
	]

	onMount(() => {
		const randomIndex = Math.floor(Math.random() * quoteList.length)
		quote = quoteList[randomIndex]
	})
</script>

<section class="content-container tinted-border">
	<h1>Welcome to Sandman's Dreamscape</h1>
	<div>
		<p class="quote" style="margin-bottom: 0;">"{quote.quote}"</p>
		<p class="quote" style="margin-top: 0;">-{quote.attribution}</p>
	</div>

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

