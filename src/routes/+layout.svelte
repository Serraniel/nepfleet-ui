<script lang="ts">
	import '../app.css';
	import { theme } from '#lib/theme.svelte.ts';
	import { preferences, type Preference } from '#lib/theme.ts';

	const labels: Record<Preference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

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
			<fieldset class="theme">
				<legend>Theme</legend>
				{#each preferences as pref (pref)}
					<label>
						<input
							type="radio"
							name="nepfleet-theme"
							value={pref}
							checked={theme.preference === pref}
							onchange={() => theme.set(pref)}
						/>
						{labels[pref]}
					</label>
				{/each}
			</fieldset>
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
		flex-direction: column;
		gap: 0.75rem;
		color: var(--muted);
	}
	.theme {
		display: flex;
		gap: 2px;
		margin: 0;
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-2);
	}
	.theme legend {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.theme label {
		flex: 1;
		position: relative;
		padding: 0.3rem 0.4rem;
		border-radius: calc(var(--radius) - 3px);
		text-align: center;
		font-size: 0.85rem;
		color: var(--text);
		cursor: pointer;
	}
	.theme input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.theme label:has(input:checked) {
		background: var(--surface);
		font-weight: 600;
		/* The accent ring is the 3:1 state cue; background and weight alone are not. */
		box-shadow: 0 0 0 1px var(--accent);
	}
	.theme label:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
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
