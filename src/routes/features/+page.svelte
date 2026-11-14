<script lang="ts">
	import { onMount } from 'svelte';
	import { type Feature, fetchFeatures } from '#lib/backend.ts';
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

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));

	async function load(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		byBackend[id] = { state: 'loading' };
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
	<Button variant="ghost" onclick={loadAll}>Refresh</Button>
	{#each connected as b (b.id)}
		{@const st = byBackend[b.id]}
		<section aria-label={b.label ?? b.url}>
			<h2>{b.label ?? new URL(b.url).host}</h2>
			{#if !st || st.state === 'loading'}
				<p class="muted">Loading…</p>
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
										{#each f.stacks as s, i (s)}{i > 0 ? ', ' : ''}<a href={stackHref(b.id, s)}
												>{s}</a
											>{/each}
									{:else}
										<a href={enableHref(b.id, f)}>Enable…</a>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
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
	.error {
		color: var(--err);
	}
</style>
