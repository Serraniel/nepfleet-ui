<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		AuthError,
		ConflictError,
		type HistoryEntry,
		type Job,
		NotFoundError,
		type Plan,
		fetchHistory,
		fetchJob,
		fetchPlan,
		startApply
	} from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { local } from '#lib/local.svelte.ts';
	import { parseContextDiff } from '#lib/diff.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	type Load<T> =
		| { state: 'loading' }
		| { state: 'ok'; value: T }
		| { state: 'error'; error: string; auth: boolean };

	const backendId = $derived(page.params.backend ?? '');
	const name = $derived(page.params.name ?? '');
	const backend = $derived(backends.list.find((b) => b.id === backendId));
	const token = $derived(tokens.byBackend[backendId]);

	let history = $state<Load<HistoryEntry[]>>({ state: 'loading' });
	let plan = $state<Load<Plan>>({ state: 'loading' });

	function failed(e: unknown) {
		return {
			state: 'error' as const,
			error: e instanceof Error ? e.message : String(e),
			auth: e instanceof AuthError
		};
	}

	async function loadHistory() {
		if (!backend || !token) return;
		history = { state: 'loading' };
		try {
			history = { state: 'ok', value: await fetchHistory(backend, token, name) };
		} catch (e) {
			history = failed(e);
		}
	}

	async function loadPlan() {
		if (!backend || !token) return;
		plan = { state: 'loading' };
		try {
			plan = { state: 'ok', value: await fetchPlan(backend, token, name) };
		} catch (e) {
			plan = failed(e);
		}
	}

	// Opened directly: remotes through the control daemon aren't listed yet.
	onMount(() => {
		void local.refresh();
		local.follow();
	});

	$effect(() => {
		void backendId;
		void name;
		void token;
		void loadHistory();
		void loadPlan();
	});

	let confirmOpen = $state(false);
	let typed = $state('');
	let starting = $state(false);
	let applyError = $state('');
	let job = $state<Job | null>(null);
	let pollError = $state('');
	const planValue = $derived(plan.state === 'ok' ? plan.value : null);
	const destructive = $derived((planValue?.destructive?.length ?? 0) > 0);
	const running = $derived(job?.state === 'running');
	const canConfirm = $derived(!starting && (!destructive || typed === name));

	function askApply() {
		typed = '';
		applyError = '';
		confirmOpen = true;
	}

	async function apply() {
		if (!backend || !token || !planValue?.id) return;
		starting = true;
		applyError = '';
		try {
			job = await startApply(backend, token, name, planValue.id, destructive);
			pollError = '';
			confirmOpen = false;
			void follow(job.id);
		} catch (e) {
			applyError = e instanceof Error ? e.message : String(e);
			// The plan on screen is out of date: show the new one to review.
			if (e instanceof ConflictError) void loadPlan();
		} finally {
			starting = false;
		}
	}

	let left = false;
	onDestroy(() => (left = true));

	async function follow(id: string) {
		const b = backend;
		const t = token;
		if (!b || !t) return;
		while (!left && job?.id === id && job.state === 'running') {
			await new Promise((r) => setTimeout(r, 2000));
			if (left) return;
			try {
				const next = await fetchJob(b, t, id);
				if (job?.id !== id) return;
				job = next;
				pollError = '';
			} catch (e) {
				if (e instanceof NotFoundError) {
					// The backend restarted and forgot its jobs: the plan tells how it ended.
					job = {
						...job,
						state: 'failed',
						error: 'The backend no longer knows this job; check the plan below.'
					};
					break;
				}
				// The apply goes on without us (a restart, the network): keep asking.
				pollError = e instanceof Error ? e.message : String(e);
			}
		}
		void loadPlan();
		void loadHistory();
	}

	const backendLabel = $derived.by(() => {
		const s = backends.status[backendId];
		return s?.state === 'online' ? s.info.name : backend ? new URL(backend.url).host : backendId;
	});
	const date = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<nav aria-label="Breadcrumb"><a href="/stacks">Stacks</a> / {backendLabel}</nav>
<h1>{name}</h1>

{#if !backend}
	<EmptyState title="Unknown backend"
		>This backend is not in the list. <a href="/">Add it</a>.</EmptyState
	>
{:else if !token}
	<EmptyState title="No token">
		Add an API token for {backendLabel} on the <a href="/stacks">Stacks</a> page.
	</EmptyState>
{:else}
	<section aria-labelledby="plan-h">
		<div class="row">
			<h2 id="plan-h">Pending changes</h2>
			<Button variant="ghost" onclick={loadPlan} disabled={plan.state === 'loading'}>Refresh</Button
			>
		</div>
		{#if plan.state === 'loading'}
			<p class="muted" aria-live="polite">Planning… (renders the stack on the backend)</p>
		{:else if plan.state === 'error'}
			<p class="error" role="alert">{plan.error}</p>
		{:else}
			{@const p = plan.value}
			{#if p.first}<p>
					<strong>Not applied yet:</strong> the first apply creates everything below.
				</p>{/if}
			{#if !p.changes || p.changes.length === 0}
				<p class="muted">Nothing to apply: the running stack matches the fleet repository.</p>
			{:else}
				{#if p.destructive?.length}
					<div class="warn" role="alert">
						<strong>Destructive:</strong>
						<ul>
							{#each p.destructive as d (d)}<li>{d}</li>{/each}
						</ul>
					</div>
				{/if}
				{#if p.steps?.length}
					<h3>
						Steps{#if p.approximate}<span class="muted"> (approximate)</span>{/if}
					</h3>
					<ol>
						{#each p.steps as s, i (i)}
							<li class:destructive={s.destructive}>{s.text}</li>
						{/each}
					</ol>
				{/if}
				<h3>Files and images</h3>
				{#each p.changes as c (c.path)}
					<details>
						<summary><span class="kind {c.kind}">{c.kind}</span> <code>{c.path}</code></summary>
						{#if c.diff}
							<pre class="diff">{#each parseContextDiff(c.diff) as l, i (i)}<span class={l.kind}
										><span
											class="mark"
											aria-label={l.kind === 'add'
												? 'added'
												: l.kind === 'del'
													? 'removed'
													: undefined}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span
										> {l.text}
</span>{/each}</pre>
						{/if}
					</details>
				{/each}
				{#if p.id}
					<Button variant="primary" onclick={askApply} disabled={running}>Apply…</Button>
				{:else}
					<p class="muted">
						This backend cannot apply over the API yet. Run <code>nepfleet apply {name}</code> there.
					</p>
				{/if}
			{/if}
		{/if}
	</section>

	{#if job}
		<section aria-labelledby="job-h">
			<h2 id="job-h">Apply</h2>
			<p role="status" class:error={job.state === 'failed'}>
				{#if job.state === 'running'}Running…{:else if job.state === 'succeeded'}Applied.{:else}Failed:
					{job.error}{/if}
			</p>
			{#if pollError}<p class="muted" role="status">
					Lost contact with the backend, still asking: {pollError}
				</p>{/if}
			<pre class="log">{job.log}</pre>
		</section>
	{/if}

	<section aria-labelledby="hist-h">
		<div class="row">
			<h2 id="hist-h">History</h2>
			<Button variant="ghost" onclick={loadHistory} disabled={history.state === 'loading'}
				>Refresh</Button
			>
		</div>
		{#if history.state === 'loading'}
			<p class="muted">Loading…</p>
		{:else if history.state === 'error'}
			<p class="error" role="alert">{history.error}</p>
		{:else if history.value.length === 0}
			<p class="muted">No commits touch this stack yet.</p>
		{:else}
			<ol class="history">
				{#each history.value as h (h.commit)}
					<li class:applied={h.applied}>
						<code>{h.commit.slice(0, 7)}</code>
						<span>{h.subject}</span>
						<span class="muted">{h.author} · <time datetime={h.date}>{date(h.date)}</time></span>
						{#if h.applied}<span class="badge">running</span>{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</section>
{/if}

<Dialog bind:open={confirmOpen} title="Apply {name}?">
	<p>
		This applies the plan shown on the page on {backendLabel}. If the fleet changed since, the
		backend refuses, and you get the new plan to review.
	</p>
	{#if destructive}
		<div class="warn">
			<strong>Destructive:</strong>
			<ul>
				{#each planValue?.destructive ?? [] as d (d)}<li>{d}</li>{/each}
			</ul>
		</div>
		<TextField label="Type the stack name to confirm" bind:value={typed} autocomplete="off" />
	{/if}
	{#if applyError}<p class="error" role="alert">{applyError}</p>{/if}
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (confirmOpen = false)}>Cancel</Button>
		<Button variant="primary" onclick={apply} disabled={!canConfirm}>
			{starting ? 'Starting…' : 'Apply'}
		</Button>
	{/snippet}
</Dialog>

<style>
	.log {
		overflow: auto;
		max-height: 24rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.6rem 0.8rem;
		font-size: 0.85em;
	}
	nav,
	.muted {
		color: var(--muted);
	}
	h1 {
		margin: 0.25rem 0 1rem;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	section {
		margin: 1.5rem 0;
	}
	.error {
		color: var(--err);
	}
	.warn {
		border: 1px solid var(--err);
		border-radius: var(--radius);
		padding: 0.5rem 0.75rem;
	}
	.destructive {
		color: var(--err);
	}
	details {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin: 0.4rem 0;
		padding: 0.4rem 0.6rem;
	}
	.kind {
		font-size: 0.8em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.diff {
		overflow-x: auto;
		margin: 0.5rem 0 0;
		font-size: 0.85em;
	}
	.diff .add {
		background: color-mix(in srgb, var(--ok, green) 15%, transparent);
	}
	.diff .del {
		background: color-mix(in srgb, var(--err) 15%, transparent);
	}
	.diff .gap {
		color: var(--muted);
	}
	.history {
		list-style: none;
		padding: 0;
	}
	.history li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--border);
	}
	.applied {
		font-weight: 600;
	}
	.badge {
		font-size: 0.75em;
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0 0.5rem;
	}
</style>
