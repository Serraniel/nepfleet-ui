<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchEvents } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { fleet } from '#lib/fleet.svelte.ts';
	import type { FleetEvent } from '#lib/notifications.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	type Row = FleetEvent & { backend: string; label: string };
	let rows = $state<Row[]>([]);
	let errors = $state<{ backend: string; text: string }[]>([]);
	let loading = $state(false);

	// Loaded from every backend, shown for the picked fleet: switching needs no wait.
	const withToken = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));
	const connected = $derived(fleet.visible.filter((b) => tokens.byBackend[b.id]));
	const inFleet = (r: { backend: string }) => connected.some((b) => b.id === r.backend);
	const shown = $derived(rows.filter(inFleet).slice(0, 300));
	const shownErrors = $derived(errors.filter(inFleet));

	async function load() {
		loading = true;
		errors = [];
		const all: Row[] = [];
		await Promise.all(
			withToken.map(async (b) => {
				const token = tokens.byBackend[b.id];
				if (!token) return;
				const label = b.label ?? new URL(b.url).host;
				try {
					for (const e of await fetchEvents(b, token)) all.push({ ...e, backend: b.id, label });
				} catch (e) {
					errors.push({
						backend: b.id,
						text: `${label}: ${e instanceof Error ? e.message : String(e)}`
					});
				}
			})
		);
		rows = all.sort((a, b) => b.time.localeCompare(a.time));
		loading = false;
	}

	onMount(() => void load());

	const date = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

{#if connected.length === 0}
	<EmptyState title="Not connected">
		Add a backend with a token on the <a href="/stacks">Stacks</a> page, or connect the control
		daemon on the <a href="/fleets">Fleets</a> page.
	</EmptyState>
{:else}
	<div class="row">
		<p class="muted">From each backend you have a token for, newest first.</p>
		<Button busy={loading} onclick={load}>Refresh</Button>
	</div>
	{#each shownErrors as e (e.backend)}<p class="error" role="alert">{e.text}</p>{/each}
	{#if shown.length === 0 && !loading}
		<EmptyState title="Nothing yet">New events show up here.</EmptyState>
	{:else}
		<ul class="events">
			{#each shown as e (e.backend + '/' + e.id)}
				<li>
					<span class="sev {e.severity}">{e.severity}</span>
					<div class="body">
						<strong>
							{#if e.stack}<a
									href="/stacks/{encodeURIComponent(e.backend)}/{encodeURIComponent(e.stack)}"
								>
									{e.title}
								</a>{:else}{e.title}{/if}
						</strong>
						<span class="muted">
							{[e.label, e.stack].filter(Boolean).join(' / ')} ·
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

<style>
	.row {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
	}
	.events {
		list-style: none;
		padding: 0;
	}
	.events li {
		display: flex;
		gap: 0.75rem;
		padding: 0.5rem 0;
		border-top: 1px solid var(--border);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	.sev {
		font-size: 0.8em;
		min-width: 4.5em;
	}
	.sev.error {
		color: var(--err);
		font-weight: 600;
	}
	pre {
		white-space: pre-wrap;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
