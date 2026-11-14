<script lang="ts">
	import { onMount } from 'svelte';
	import { local } from '#lib/local.svelte.ts';
	import {
		type MinSeverity,
		eventHref,
		loadOsSettings,
		requestOsPermission,
		saveOsSettings
	} from '#lib/notifications.ts';
	import BackendEvents from '#lib/BackendEvents.svelte';
	import ChannelTests from '#lib/ChannelTests.svelte';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	let settings = $state(loadOsSettings());
	let permissionError = $state('');

	const newest = $derived([...local.events].reverse());

	onMount(() => {
		void local.refresh();
		local.follow();
	});

	async function toggle(event: Event) {
		const on = (event.target as HTMLInputElement).checked;
		permissionError = '';
		if (on && !(await requestOsPermission())) {
			settings.enabled = false;
			permissionError = 'The system did not allow notifications. Check its settings for this app.';
		} else {
			settings.enabled = on;
		}
		saveOsSettings($state.snapshot(settings));
	}

	function setMin(event: Event) {
		settings.minSeverity = (event.target as HTMLSelectElement).value as MinSeverity;
		saveOsSettings($state.snapshot(settings));
	}

	const date = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<header>
	<h1>Notifications</h1>
	<p>What happened across your connected fleets: applies, rollbacks, crashes and more.</p>
</header>

{#if !local.connected}
	<BackendEvents />
{:else}
	<section class="settings" aria-label="System notifications">
		<label class="check">
			<input type="checkbox" checked={settings.enabled} onchange={toggle} />
			Show system notifications on this device
		</label>
		<label>
			For
			<select value={settings.minSeverity} onchange={setMin} disabled={!settings.enabled}>
				<option value="error">errors only</option>
				<option value="warning">warnings and errors</option>
				<option value="info">everything</option>
			</select>
		</label>
		{#if permissionError}<p class="error" role="alert">{permissionError}</p>{/if}
		<p class="muted">Only while this app is open. The daemon keeps collecting events either way.</p>
	</section>

	{#if local.eventsError}<p class="error" role="alert">{local.eventsError}</p>{/if}

	{#if newest.length === 0}
		<EmptyState title="Nothing yet">New events from connected fleets show up here.</EmptyState>
	{:else}
		<div class="row">
			<p class="muted" role="status">{local.unread} unread</p>
			<Button onclick={() => local.markAllRead()} disabled={local.unread === 0}
				>Mark all read</Button
			>
		</div>
		<ul class="events">
			{#each newest as e (e.id)}
				{@const href = eventHref(e)}
				<li class:unread={e.id > local.seen}>
					<span class="sev {e.severity}">{e.severity}</span>
					<div class="body">
						<strong>
							{#if href}<a {href}>{e.title}</a>{:else}{e.title}{/if}
						</strong>
						<span class="muted">
							{[e.fleet, e.stack].filter(Boolean).join(' / ')} ·
							<time datetime={e.time}>{date(e.time)}</time>
						</span>
						{#if e.message}
							<details>
								<summary>Details</summary>
								<pre>{e.message}</pre>
							</details>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<ChannelTests />

<style>
	header p,
	.muted {
		color: var(--muted);
	}
	h1 {
		margin: 0 0 0.25rem;
	}
	.error {
		color: var(--err);
	}
	.settings {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		align-items: center;
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
	}
	.settings p {
		flex-basis: 100%;
		margin: 0;
	}
	.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}
	.events {
		list-style: none;
		padding: 0;
	}
	.events li {
		display: flex;
		gap: 0.75rem;
		padding: 0.6rem 0.5rem;
		border-bottom: 1px solid var(--border);
	}
	.unread {
		border-left: 3px solid currentColor;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	/* The word carries the meaning, not only the colour. */
	.sev {
		font-size: 0.75em;
		text-transform: uppercase;
		min-width: 4.5em;
		padding-top: 0.2em;
	}
	.sev.error {
		color: var(--err);
	}
	pre {
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.85em;
		margin: 0.3rem 0 0;
	}
</style>
