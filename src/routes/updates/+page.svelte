<script lang="ts">
	import { onMount } from 'svelte';
	import { type ImageUpdate, fetchUpdates } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { local } from '#lib/local.svelte.ts';
	import { stacks, tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	type Row = {
		backend: string;
		stack: string;
		state: 'waiting' | 'checking' | 'ok' | 'error';
		updates?: ImageUpdate[];
		error?: string;
	};

	let rows = $state<Row[]>([]);
	let checking = $state(false);

	onMount(() => {
		void local.refresh().then(() => stacks.loadAll());
	});

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	// One stack after another per backend: it renders each, one at a time, and
	// answers busy (503) meanwhile.
	async function checkBackend(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		for (const row of rows.filter((r) => r.backend === id)) {
			row.state = 'checking';
			for (let attempt = 0; ; attempt++) {
				try {
					const updates = await fetchUpdates(b, token, row.stack);
					Object.assign(row, { state: 'ok' as const, updates });
					break;
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					if (error === 'HTTP 503' && attempt < 5) {
						await sleep(3000);
						continue;
					}
					Object.assign(row, { state: 'error' as const, error });
					break;
				}
			}
		}
	}

	async function checkAll() {
		checking = true;
		rows = connected.flatMap((b) => {
			const st = stacks.byBackend[b.id];
			return st?.state === 'ok'
				? st.stacks.map((s) => ({ backend: b.id, stack: s.name, state: 'waiting' as const }))
				: [];
		});
		await Promise.all(connected.map((b) => checkBackend(b.id)));
		checking = false;
	}

	const news = (u: ImageUpdate[]) => u.filter((x) => x.next || x.rebuilt || x.beyond || x.error);
	const label = (id: string) => {
		const b = backends.list.find((x) => x.id === id);
		return b?.label ?? (b ? new URL(b.url).host : id);
	};
</script>

<header>
	<h1>Updates</h1>
	<p>
		What the registries have for every stack's images. Take an update from the stack's page, where
		it's reviewed like any change.
	</p>
</header>

{#if connected.length === 0}
	<EmptyState title="No backend with a token">
		Add an API token for a backend on the <a href="/stacks">Stacks</a> page.
	</EmptyState>
{:else}
	<Button onclick={checkAll} disabled={checking}
		>{checking ? 'Checking…' : rows.length ? 'Check again' : 'Check every stack'}</Button
	>
	<p class="muted">It asks each image's registry, stack by stack, so it takes a while.</p>
	{#if rows.length}
		<ul class="rows">
			{#each rows as r (r.backend + '/' + r.stack)}
				<li>
					<a href="/stacks/{encodeURIComponent(r.backend)}/{encodeURIComponent(r.stack)}"
						><strong>{r.stack}</strong></a
					>
					<span class="muted">{label(r.backend)}</span>
					{#if r.state === 'waiting'}
						<span class="muted">waiting</span>
					{:else if r.state === 'checking'}
						<span class="muted">checking…</span>
					{:else if r.state === 'error'}
						<span class="error">{r.error}</span>
					{:else if news(r.updates ?? []).length === 0}
						<span class="muted">up to date</span>
					{:else}
						<ul>
							{#each news(r.updates ?? []) as u (u.image)}
								<li>
									<code>{u.image}:{u.current}</code>
									{#if u.next}→ <strong>{u.next}</strong>{/if}
									{#if u.rebuilt}<span>rebuilt since pinned</span>{/if}
									{#if u.beyond}<span class="muted">{u.beyond} beyond the {u.track} track</span
										>{/if}
									{#if u.error}<span class="error">{u.error}</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.rows {
		list-style: none;
		padding: 0;
	}
	.rows > li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.35rem 0;
	}
	.rows ul {
		flex-basis: 100%;
		margin: 0;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
