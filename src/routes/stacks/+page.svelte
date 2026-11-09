<script lang="ts">
	import { onMount } from 'svelte';
	import { backends } from '#lib/backends.svelte.ts';
	import { local } from '#lib/local.svelte.ts';
	import { stacks, tokens } from '#lib/stacks.svelte.ts';
	import { SESSION } from '#lib/backend.ts';
	import { fetchAuthStatus } from '#lib/login.ts';
	import BackendSignIn from '#lib/ui/BackendSignIn.svelte';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	let query = $state('');
	let backendFilter = $state('');
	let targetFilter = $state('');
	let stateFilter = $state('');
	let tokenInput = $state<Record<string, string>>({});
	let keep = $state<Record<string, boolean>>({});
	let tokenError = $state<Record<string, string>>({});

	onMount(() => {
		// Remotes through the control daemon join the list when it answers.
		void local.refresh().then(() => {
			void backends.checkAll();
			void stacks.loadAll();
			for (const b of backends.list) void syncSession(b.id);
		});
		local.follow();
	});

	function backendName(id: string): string {
		const s = backends.status[id];
		const b = backends.list.find((x) => x.id === id);
		if (b?.label) return b.label;
		return s?.state === 'online' ? s.info.name : b ? new URL(b.url).host : id;
	}

	const rows = $derived(
		backends.list.flatMap((b) => {
			const st = stacks.byBackend[b.id];
			return st?.state === 'ok' ? st.stacks.map((s) => ({ ...s, backend: b.id })) : [];
		})
	);
	const stateText: Record<string, string> = {
		running: 'Running',
		unhealthy: 'Unhealthy',
		partial: 'Partly down',
		stopped: 'Stopped'
	};
	const targets = $derived([...new Set(rows.map((r) => r.target))].sort());
	const shown = $derived(
		rows.filter(
			(r) =>
				(!backendFilter || r.backend === backendFilter) &&
				(!targetFilter || r.target === targetFilter) &&
				(!stateFilter ||
					(stateFilter === 'attention'
						? ['unhealthy', 'partial', 'stopped'].includes(r.state ?? '')
						: (r.state ?? 'unknown') === stateFilter)) &&
				(!query ||
					`${r.name} ${r.template ?? ''} ${r.target}`.toLowerCase().includes(query.toLowerCase()))
		)
	);

	/** A session (the cookie) replaces a token on that backend. */
	async function syncSession(id: string) {
		const b = backends.list.find((x) => x.id === id);
		if (!b || b.local) return;
		const s = await fetchAuthStatus(b).catch(() => null);
		const had = tokens.byBackend[id] === SESSION;
		if (s?.signedIn) tokens.byBackend[id] = SESSION;
		else if (had) delete tokens.byBackend[id];
		await stacks.load(b);
	}

	function useToken(event: SubmitEvent, id: string) {
		event.preventDefault();
		tokenError[id] = '';
		try {
			tokens.set(id, tokenInput[id] ?? '', keep[id] ?? false);
			tokenInput[id] = '';
			const b = backends.list.find((x) => x.id === id);
			if (b) void stacks.load(b);
		} catch (e) {
			tokenError[id] = e instanceof Error ? e.message : String(e);
		}
	}

	function forget(id: string) {
		tokens.clear(id);
		const b = backends.list.find((x) => x.id === id);
		if (b) void stacks.load(b);
	}
</script>

<header>
	<h1>Stacks</h1>
	<p>Every stack of every backend. Each backend needs an API token with the read scope.</p>
</header>

{#if backends.list.length === 0}
	<EmptyState title="No backends yet"><a href="/">Add a backend</a> to see its stacks.</EmptyState>
{:else}
	<section class="access" aria-label="Access per backend">
		{#each backends.list as backend (backend.id)}
			{@const st = stacks.byBackend[backend.id]}
			<div class="card">
				<strong>{backendName(backend.id)}</strong>
				{#if !backend.local}
					<BackendSignIn {backend} onchange={() => void syncSession(backend.id)} />
				{/if}
				{#if !st || st.state === 'no-token' || (st.state === 'error' && st.auth)}
					{#if st?.state === 'error'}<p class="error" role="alert">{st.error}</p>{/if}
					<form onsubmit={(e) => useToken(e, backend.id)}>
						<label for="token-{backend.id}">API token</label>
						<input
							id="token-{backend.id}"
							type="password"
							autocomplete="off"
							placeholder="nft_…"
							bind:value={tokenInput[backend.id]}
							required
						/>
						<label class="check">
							<input type="checkbox" bind:checked={keep[backend.id]} /> Keep for this tab
						</label>
						<Button variant="primary" type="submit">Use token</Button>
					</form>
					<p class="muted">
						Create one on the backend: <code>nepfleet token create --name ui --scope read</code>
					</p>
					{#if tokenError[backend.id]}<p class="error" role="alert">
							{tokenError[backend.id]}
						</p>{/if}
				{:else if st.state === 'loading'}
					<p class="muted">Loading…</p>
				{:else if st.state === 'error'}
					<p class="error" role="alert">{st.error}</p>
					<Button onclick={() => stacks.load(backend)}>Retry</Button>
				{:else}
					<p class="muted">{st.stacks.length} stacks</p>
					{#if !backend.local && tokens.byBackend[backend.id] !== SESSION}
						<Button variant="ghost" onclick={() => forget(backend.id)}>Forget token</Button>
					{/if}
				{/if}
			</div>
		{/each}
	</section>

	<div class="filters">
		<label for="q" class="sr-only">Search</label>
		<input id="q" type="search" placeholder="Search stacks" bind:value={query} />
		<label for="fb" class="sr-only">Backend</label>
		<select id="fb" bind:value={backendFilter}>
			<option value="">All backends</option>
			{#each backends.list as b (b.id)}<option value={b.id}>{backendName(b.id)}</option>{/each}
		</select>
		<label for="ft" class="sr-only">Host</label>
		<select id="ft" bind:value={targetFilter}>
			<option value="">All hosts</option>
			{#each targets as t (t)}<option value={t}>{t}</option>{/each}
		</select>
		<label for="fs" class="sr-only">State</label>
		<select id="fs" bind:value={stateFilter}>
			<option value="">Any state</option>
			<option value="attention">Needs attention</option>
			<option value="running">Running</option>
			<option value="unhealthy">Unhealthy</option>
			<option value="partial">Partly down</option>
			<option value="stopped">Stopped</option>
			<option value="unknown">Unknown (other host, swarm, not applied)</option>
		</select>
		<a href="/updates">Which have updates?</a>
	</div>

	{#if shown.length === 0}
		<EmptyState title="No stacks">
			{rows.length === 0 ? 'Add a token above to load stacks.' : 'Nothing matches the filters.'}
		</EmptyState>
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">Stack</th>
					<th scope="col">Backend</th>
					<th scope="col">Host</th>
					<th scope="col">State</th>
					<th scope="col">Template</th>
					<th scope="col">Mode</th>
					<th scope="col">Updates</th>
				</tr>
			</thead>
			<tbody>
				{#each shown as s (s.backend + '/' + s.name)}
					<tr>
						<td>
							<a href="/stacks/{encodeURIComponent(s.backend)}/{encodeURIComponent(s.name)}"
								><strong>{s.name}</strong></a
							>
						</td>
						<td>{backendName(s.backend)}</td>
						<td>{s.target}</td>
						<td class="state {s.state ?? ''}">{stateText[s.state ?? ''] ?? '—'}</td>
						<td>{s.template ?? 'plain compose'}</td>
						<td>{s.mode}</td>
						<td>{s.updates}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{/if}

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
	.access {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		margin: 1.5rem 0;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.card p {
		margin: 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	td.state.unhealthy,
	td.state.partial,
	td.state.stopped {
		color: var(--err);
	}
	.filters {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	.filters input {
		flex: 1;
		min-width: 12rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--border);
	}
	th {
		color: var(--muted);
		font-weight: 600;
	}
</style>
