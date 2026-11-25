<script lang="ts">
	import Spinner from '#lib/ui/Spinner.svelte';
	import { onMount } from 'svelte';
	import { type ChannelList, type Feature, fetchChannelList, fetchFeatures } from '#lib/backend.ts';
	import { deliveryText } from '#lib/notify-setup.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { local } from '#lib/local.svelte.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	type Load =
		| { state: 'loading' }
		| { state: 'ok'; value: Feature[] | null }
		| { state: 'error'; error: string };

	let byBackend = $state<Record<string, Load>>({});
	// Notification channels by name; null from a backend too old to list them.
	let channelsBy = $state<Record<string, ChannelList | null | { error: string }>>({});

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));

	async function load(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		byBackend[id] = { state: 'loading' };
		delete channelsBy[id];
		fetchChannelList(b, token).then(
			(cs) => (channelsBy[id] = cs),
			(e: unknown) => (channelsBy[id] = { error: e instanceof Error ? e.message : String(e) })
		);
		try {
			byBackend[id] = { state: 'ok', value: await fetchFeatures(b, token) };
		} catch (e) {
			byBackend[id] = { state: 'error', error: e instanceof Error ? e.message : String(e) };
		}
	}

	function loadAll() {
		for (const b of connected) void load(b.id);
	}

	onMount(() => {
		void local.refresh().then(loadAll);
	});

	const enableHref = (backend: string, f: Feature) =>
		`/templates?backend=${encodeURIComponent(backend)}&template=${encodeURIComponent(f.template)}`;
	const setupHref = (backend: string) =>
		`/notifications/setup?backend=${encodeURIComponent(backend)}`;
	const stackHref = (backend: string, s: string) =>
		`/stacks/${encodeURIComponent(backend)}/${encodeURIComponent(s.split('@')[0] ?? s)}`;
</script>

<header>
	<h1>Features</h1>
	<p>
		Opt-in parts of NepFleet, each a stack from the official templates: versioned, planned and
		rolled back like any other. Enabling one opens its template, to fill in and create.
	</p>
</header>

{#if connected.length === 0}
	<EmptyState title="No backend with a token">
		Add an API token for a backend on the <a href="/stacks">Stacks</a> page.
	</EmptyState>
{:else}
	<Button onclick={loadAll}>Refresh</Button>
	{#each connected as b (b.id)}
		{@const st = byBackend[b.id]}
		{@const list = channelsBy[b.id]}
		{@const cs = list && !('error' in list) ? list.channels : list}
		<section aria-label={b.label ?? b.url}>
			<h2>{b.label ?? new URL(b.url).host}</h2>
			{#if !st || st.state === 'loading'}
				<p><Spinner label="Loading…" /></p>
			{:else if st.state === 'error'}
				<p class="error" role="alert">{st.error}</p>
			{:else if st.value === null}
				<p class="muted">This backend's NepFleet is too old to list features; update it.</p>
			{:else}
				<table>
					<thead>
						<tr>
							<th scope="col">Feature</th>
							<th scope="col">What it does</th>
							<th scope="col">State</th>
						</tr>
					</thead>
					<tbody>
						{#each st.value as f (f.name)}
							<tr>
								<th scope="row">{f.name}</th>
								<td>{f.what}</td>
								<td>
									{#if f.stacks.length}
										On:
										{#each f.stacks as s, i (s)}{i > 0 ? ', ' : ''}<a href={stackHref(b.id, s)}>
												{s}
											</a>{/each}
									{:else}
										<a href={enableHref(b.id, f)}>Enable…</a>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<div class="card" role="group" aria-label="Notifications">
				<div>
					<h3>Notifications</h3>
					<p class="muted">
						Messages to your phone or chat when an apply fails, a container is unhealthy, a backup
						fails or the host needs you. ntfy, Discord, Telegram, e-mail and more.
					</p>
					<p role="status">
						{#if cs === undefined}
							<Spinner label="Loading channels…" />
						{:else if cs === null}
							<span class="muted">This backend's NepFleet is too old for channels.</span>
						{:else if 'error' in cs}
							<span class="error">{cs.error}</span>
						{:else if cs.length === 0}
							No channels yet: nothing is sent.
						{:else}
							{cs.length}
							{cs.length === 1 ? 'channel' : 'channels'}:
							{#each cs as c, i (c)}
								{@const d =
									list && !('error' in list) ? deliveryText(list.deliveries[c]) : undefined}
								{i > 0 ? ', ' : ''}{c}{#if d}{' '}<span class:error={!d.ok} class:muted={d.ok}>
										({d.text})
									</span>{/if}
							{/each}
						{/if}
					</p>
				</div>
				<p class="links">
					<a href={setupHref(b.id)}>
						{Array.isArray(cs) && cs.length ? 'Add or change a channel…' : 'Set up notifications…'}
					</a>
					<a href="/notifications">Channels and routes</a>
				</p>
			</div>
		</section>
	{/each}
{/if}

<style>
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		text-align: left;
		padding: 0.35rem 0.75rem 0.35rem 0;
		vertical-align: top;
	}
	tbody tr {
		border-top: 1px solid var(--border, currentColor);
	}
	.muted {
		color: var(--muted);
	}
	.card {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: end;
		gap: 0.5rem 1.5rem;
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
	}
	.card h3,
	.card p {
		margin: 0 0 0.25rem;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}
	.error {
		color: var(--err);
	}
</style>
