<script lang="ts">
	import '../app.css';
	import { theme } from '#lib/theme.svelte.ts';

	let { children } = $props();

	// Sections arrive with their milestones; listed so the shape of the app is visible.
	const planned = ['Stacks', 'Hosts', 'Templates', 'Updates', 'Tunnels'];
</script>

<div class="shell">
	<aside>
		<a class="brand" href="/">
			<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
				<path fill="currentColor" d="M3 17h18l-2 4H5zM6 15l2-9 4 3 4-6 2 12z" />
			</svg>
			NepFleet
		</a>
		<nav aria-label="Main">
			<a href="/" aria-current="page">Backends</a>
			{#each planned as item (item)}
				<span class="planned" title="Planned">{item}</span>
			{/each}
		</nav>
		<footer>
			<button
				onclick={() => theme.toggle()}
				aria-label="Switch to {theme.current === 'dark' ? 'light' : 'dark'} mode"
			>
				{theme.current === 'dark' ? '☀︎ Light' : '☾ Dark'}
			</button>
			<small>v{__APP_VERSION__}</small>
		</footer>
	</aside>
	<main>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 220px 1fr;
		min-height: 100dvh;
	}
	aside {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 1.25rem 1rem;
		background: var(--surface);
		border-right: 1px solid var(--border);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--text);
		text-decoration: none;
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	nav a,
	nav span {
		padding: 0.45rem 0.7rem;
		border-radius: var(--radius);
		text-decoration: none;
		color: var(--text);
	}
	nav a[aria-current='page'] {
		background: var(--surface-2);
		font-weight: 600;
	}
	.planned {
		color: var(--muted);
		cursor: default;
	}
	footer {
		margin-top: auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: var(--muted);
	}
	main {
		padding: 2rem clamp(1rem, 4vw, 3rem);
		max-width: 1100px;
	}
	@media (max-width: 720px) {
		.shell {
			grid-template-columns: 1fr;
		}
		aside {
			border-right: 0;
			border-bottom: 1px solid var(--border);
		}
		nav {
			flex-direction: row;
			flex-wrap: wrap;
		}
	}
</style>
