<script lang="ts">
	import '../app.css';
	import { theme } from '#lib/theme.svelte.ts';
	import { preferences, type Preference } from '#lib/theme.ts';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { isDesktop, startDaemon } from '#lib/desktop.ts';
	import { local } from '#lib/local.svelte.ts';
	import { fleet } from '#lib/fleet.svelte.ts';
	import { withFleet } from '#lib/fleet.ts';
	import FleetPicker from '#lib/ui/FleetPicker.svelte';
	import Toaster from '#lib/ui/Toaster.svelte';

	const labels: Record<Preference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

	let { children } = $props();

	// The desktop app connects by itself. If it can't, the Fleets page says why.
	onMount(() => {
		// A token kept for this tab: follow it from any page, for the unread count.
		if (local.connected) {
			void local.refresh();
			local.follow();
		}
		if (!isDesktop() || local.connected) return;
		void startDaemon()
			.then((d) => local.connect(d.url, d.token, false))
			.catch(() => {});
	});

	// Links keep the picked fleet in the URL, so the address always says what's shown.
	const sections = [
		['/', 'Backends'],
		['/fleets', 'Fleets'],
		['/stacks', 'Stacks'],
		['/templates', 'Templates'],
		['/features', 'Features'],
		['/updates', 'Updates'],
		['/sync', 'Sync'],
		['/maintenance', 'Maintenance'],
		['/health', 'Health'],
		['/access', 'Access']
	] as const;
</script>

<div class="shell">
	<aside>
		<a class="brand" href="/">
			<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
				<path fill="currentColor" d="M3 17h18l-2 4H5zM6 15l2-9 4 3 4-6 2 12z" />
			</svg>
			NepFleet
		</a>
		<FleetPicker />
		<nav aria-label="Main">
			{#each sections as [path, name] (path)}
				<a
					href={withFleet(path, fleet.current)}
					aria-current={page.url.pathname === path ? 'page' : undefined}
				>
					{name}
				</a>
			{/each}
			<a
				href={withFleet('/notifications', fleet.current)}
				aria-current={page.url.pathname === '/notifications' ? 'page' : undefined}
				aria-label={fleet.unread > 0 ? `Notifications, ${fleet.unread} unread` : 'Notifications'}
			>
				Notifications
				{#if fleet.unread > 0}<span class="count" aria-hidden="true">{fleet.unread}</span>{/if}
			</a>
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
			<small>
				v{__APP_VERSION__} ·
				<a href="/design" aria-current={page.url.pathname === '/design' ? 'page' : undefined}>
					Design system
				</a>
			</small>
		</footer>
	</aside>
	<main>
		{#if local.daemonDown}
			<p class="daemon-down" role="alert">
				{#if local.restarting}
					NepFleet's control daemon on this computer stopped; starting it again…
				{:else if isDesktop()}
					NepFleet's control daemon on this computer stopped, so your machines aren't connected. The
					app keeps trying to start it.
				{:else}
					NepFleet's control daemon on this computer isn't answering, so your machines aren't
					connected. Start it with <code>nepfleet control</code>.
				{/if}
			</p>
		{/if}
		{@render children()}
	</main>
	<Toaster />
</div>

<style>
	.daemon-down {
		margin: 0 0 1rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--err);
		border-radius: 8px;
		color: var(--err);
	}
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
		/* The window's height, in place while the page scrolls: the footer
		   stays at the bottom. A very short window scrolls the sidebar itself. */
		position: sticky;
		top: 0;
		height: 100dvh;
		overflow-y: auto;
		box-sizing: border-box;
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
	.count {
		display: inline-block;
		min-width: 1.4em;
		padding: 0 0.35em;
		border-radius: 999px;
		font-size: 0.8em;
		text-align: center;
		color: var(--surface);
		background: var(--text);
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
			position: static;
			height: auto;
			overflow-y: visible;
		}
		nav {
			flex-direction: row;
			flex-wrap: wrap;
		}
	}
</style>
