<script lang="ts">
	import { onMount } from 'svelte';
	import { type KumaMaintenance, fetchMaintenance } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { local } from '#lib/local.svelte.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	type Load =
		| { state: 'loading' }
		| { state: 'ok'; value: KumaMaintenance[] }
		| { state: 'error'; error: string };

	let byBackend = $state<Record<string, Load>>({});

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));

	async function load(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		byBackend[id] = { state: 'loading' };
		try {
			byBackend[id] = { state: 'ok', value: await fetchMaintenance(b, token) };
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

	const order: Record<string, number> = { 'under-maintenance': 0, scheduled: 1 };
	const sorted = (k: KumaMaintenance) =>
		[...k.windows]
			.filter((w) => w.status === 'under-maintenance' || w.status === 'scheduled')
			.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.id - b.id);

	const when = (iso?: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	};
</script>

<header>
	<h1>Maintenance</h1>
	<p>
		Uptime Kuma's maintenance windows, active and upcoming, for each backend: the ones applies open,
		and any you planned.
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
				<p class="muted">Asking its Uptime Kuma…</p>
			{:else if st.state === 'error'}
				<p class="error" role="alert">{st.error}</p>
			{:else if st.value.length === 0}
				<p class="muted">This fleet has no Uptime Kuma in fleet.yaml.</p>
			{:else}
				{#each st.value as k (k.kuma)}
					{@const shown = sorted(k)}
					<h3>{k.kuma}</h3>
					{#if k.error}
						<p class="error">{k.error}</p>
					{:else if shown.length === 0}
						<p class="muted">Nothing active or scheduled.</p>
					{:else}
						<ul class="windows">
							{#each shown as w (w.id)}
								<li>
									<span class="badge" class:active={w.status === 'under-maintenance'}
										>{w.status === 'under-maintenance' ? 'now' : 'scheduled'}</span
									>
									<strong>{w.title}</strong>
									{#if w.start}<span class="muted"
											>{when(w.start)}{#if w.end}
												– {when(w.end)}{/if}</span
										>{/if}
									{#if w.description}<span class="muted">{w.description}</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/each}
			{/if}
		</section>
	{/each}
{/if}

<style>
	.windows {
		list-style: none;
		padding: 0;
	}
	.windows li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.25rem 0;
	}
	.badge {
		font-size: 0.8em;
		padding: 0 0.4em;
		border-radius: 0.3em;
		border: 1px solid currentColor;
	}
	.badge.active {
		font-weight: 600;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
