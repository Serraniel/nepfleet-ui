<script lang="ts">
	import { onMount } from 'svelte';
	import { type SyncStatus, fetchSync, syncNow } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { local } from '#lib/local.svelte.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	type Load =
		{ state: 'loading' } | { state: 'ok'; value: SyncStatus } | { state: 'error'; error: string };

	let byBackend = $state<Record<string, Load>>({});
	let asking = $state<Record<string, string>>({});

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));

	async function load(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		if (!byBackend[id]) byBackend[id] = { state: 'loading' };
		try {
			byBackend[id] = { state: 'ok', value: await fetchSync(b, token) };
		} catch (e) {
			byBackend[id] = { state: 'error', error: e instanceof Error ? e.message : String(e) };
		}
	}

	function loadAll() {
		for (const b of connected) void load(b.id);
	}

	async function now(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		asking[id] = 'Asked; it pulls in the background…';
		try {
			await syncNow(b, token);
			// The server answers before it pulls; look again shortly.
			setTimeout(() => {
				void load(id).then(() => delete asking[id]);
			}, 4000);
		} catch (e) {
			asking[id] = e instanceof Error ? e.message : String(e);
		}
	}

	onMount(() => {
		void local.refresh().then(loadAll);
	});

	const when = (iso?: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	};
</script>

<header>
	<h1>Git sync</h1>
	<p>
		Each server can keep its fleet repository at origin's commit, on a timer or on a forge's
		webhook. Changed stacks set to <code>apply: auto</code> are applied; the others, and destructive changes,
		wait for you here.
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
				<p class="muted">Asking…</p>
			{:else if st.state === 'error'}
				<p class="error" role="alert">{st.error}</p>
			{:else}
				{@const s = st.value}
				{#if !s.enabled}
					<p class="muted">
						This server doesn't sync. Start it with <code>nepfleet serve --sync 5m</code> (and
						<code>NEPFLEET_SYNC_SECRET</code> for webhooks).
					</p>
				{:else}
					<dl>
						<dt>Pulls</dt>
						<dd>{s.interval ? `every ${s.interval}, and on webhooks` : 'on webhooks only'}</dd>
						<dt>Last looked</dt>
						<dd>{s.last ? when(s.last) : 'not yet'}</dd>
						{#if s.commit}<dt>At commit</dt>
							<dd><code>{s.commit.slice(0, 7)}</code></dd>{/if}
					</dl>
					{#if s.error}<p class="error" role="alert">{s.error}</p>{/if}
					{#if s.pending?.length}
						<p>
							<strong>Waiting for you:</strong>
							{#each s.pending as name, i (name)}{i > 0 ? ', ' : ''}<a
									href="/stacks/{encodeURIComponent(b.id)}/{encodeURIComponent(name)}">{name}</a
								>{/each}. Review their plans and apply them.
						</p>
					{/if}
					{#if s.failed?.length}
						<p class="error">Failed to apply: {s.failed.join(', ')}</p>
					{/if}
					{#if s.applied?.length}
						<p class="muted">Applied: {s.applied.join(', ')}</p>
					{/if}
					<Button onclick={() => now(b.id)} disabled={!!asking[b.id]}>Sync now</Button>
				{/if}
				{#if asking[b.id]}<p class="muted" role="status">{asking[b.id]}</p>{/if}
			{/if}
		</section>
	{/each}
{/if}

<style>
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
