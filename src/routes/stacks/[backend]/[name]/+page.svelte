<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		AuthError,
		ConflictError,
		type HistoryEntry,
		type ImageUpdate,
		type StackEgress,
		type Job,
		NotFoundError,
		type Plan,
		type StackLink,
		fetchHistory,
		fetchJob,
		fetchPlan,
		fetchStacks,
		fetchUpdates,
		fetchEgress,
		stackPlaces,
		stackRelations,
		startApply,
		startRollback
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

	// Only on request: it asks every image's registry.
	let updates = $state<Load<ImageUpdate[]> | null>(null);
	async function loadUpdates() {
		if (!backend || !token) return;
		updates = { state: 'loading' };
		try {
			updates = { state: 'ok', value: await fetchUpdates(backend, token, name) };
		} catch (e) {
			updates = failed(e);
		}
	}

	// Outbound traffic: what the stack's egress sidecars recorded or refused.
	let egress = $state<Load<StackEgress> | null>(null);
	async function loadEgress() {
		if (!backend || !token) return;
		egress = { state: 'loading' };
		try {
			egress = { state: 'ok', value: await fetchEgress(backend, token, name) };
		} catch (e) {
			egress = failed(e);
		}
	}

	// Taking updates: the plan and its apply use newer digests and the template
	// source's current commit.
	let takingUpdates = $state(false);
	function reviewUpdates(on: boolean) {
		takingUpdates = on;
		void loadPlan();
	}

	async function loadPlan() {
		if (!backend || !token) return;
		plan = { state: 'loading' };
		try {
			plan = {
				state: 'ok',
				value: await fetchPlan(backend, token, name, fetch, 120000, takingUpdates)
			};
		} catch (e) {
			plan = failed(e);
		}
	}

	let places = $state<StackLink[]>([]);
	let relations = $state<ReturnType<typeof stackRelations>>({ uses: [], usedBy: [] });

	/** A nicety: without them, the rest of the page works just the same. */
	async function loadPlaces() {
		places = [];
		relations = { uses: [], usedBy: [] };
		if (!backend || !token) return;
		try {
			const all = await fetchStacks(backend, token);
			const info = all.find((s) => s.name === name);
			places = info ? stackPlaces(info) : [];
			relations = stackRelations(all, name);
		} catch {
			places = [];
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
		void loadPlaces();
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

	// Rolling back: the backend only learns whether it is destructive once it has
	// planned the old version, so the first try is unconfirmed, and a refusal
	// offers a second one that needs the stack's name.
	let rollbackOpen = $state(false);
	let rollbackTo = $state<HistoryEntry | null>(null);
	let rollbackConfirm = $state(false);
	let lastRollback = $state<HistoryEntry | null>(null);
	const canRollback = $derived(!starting && (!rollbackConfirm || typed === name));
	const rollbackRefused = $derived(
		job?.kind === 'rollback' && job.state === 'failed' && /destructive/i.test(job.error ?? '')
	);

	function askRollback(h: HistoryEntry, confirm = false) {
		rollbackTo = h;
		rollbackConfirm = confirm;
		typed = '';
		applyError = '';
		rollbackOpen = true;
	}

	async function rollback() {
		if (!backend || !token || !rollbackTo) return;
		starting = true;
		applyError = '';
		try {
			lastRollback = rollbackTo;
			job = await startRollback(backend, token, name, rollbackTo.commit, rollbackConfirm);
			pollError = '';
			rollbackOpen = false;
			void follow(job.id);
		} catch (e) {
			applyError = e instanceof Error ? e.message : String(e);
			if (e instanceof ConflictError) void loadHistory();
		} finally {
			starting = false;
		}
	}

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
			job = await startApply(
				backend,
				token,
				name,
				planValue.id,
				destructive,
				fetch,
				60000,
				takingUpdates
			);
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
{#if places.length}
	<ul class="places" aria-label="Open elsewhere">
		{#each places as place (place.url)}
			<li><a href={place.url} target="_blank" rel="noopener noreferrer">{place.name}</a></li>
		{/each}
	</ul>
{/if}
{#snippet stackLink(other: string)}
	<a href="/stacks/{encodeURIComponent(backendId)}/{encodeURIComponent(other)}">{other}</a>
{/snippet}
{#if relations.uses.length}
	<section aria-labelledby="uses-h">
		<h2 id="uses-h">Uses</h2>
		<ul>
			{#each relations.uses as r (r.key)}
				<li>
					<code>{r.key}</code> from {@render stackLink(r.from)}:
					{#if r.secret}secret <code>{r.secret}</code>{:else}<code>{r.value}</code>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
{#if relations.usedBy.length}
	<section aria-labelledby="used-by-h">
		<h2 id="used-by-h">Used by</h2>
		<p class="muted">Changing these values here changes those stacks too.</p>
		<ul>
			{#each relations.usedBy as r (r.stack + '/' + r.key)}
				<li>
					{@render stackLink(r.stack)} takes
					{#if r.secret}secret <code>{r.secret}</code>{:else}<code>{r.value}</code>{/if}
					as <code>{r.key}</code>
				</li>
			{/each}
		</ul>
	</section>
{/if}

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
			<h2 id="plan-h">{takingUpdates ? 'Pending changes, taking updates' : 'Pending changes'}</h2>
			<Button variant="ghost" onclick={loadPlan} disabled={plan.state === 'loading'}>Refresh</Button
			>
		</div>
		{#if takingUpdates}
			<p class="muted">
				With newer image digests and the template source's current commit, as
				<code>apply --update-lock</code>. Review it like any change.
				<Button variant="ghost" onclick={() => reviewUpdates(false)}>Without updates</Button>
			</p>
		{/if}
		{#if plan.state === 'loading'}
			<p class="muted" aria-live="polite">Planning… (renders the stack on the backend)</p>
		{:else if plan.state === 'error'}
			<p class="error" role="alert">{plan.error}</p>
		{:else}
			{@const p = plan.value}
			{#if p.first}<p>
					<strong>Not applied yet:</strong> the first apply creates everything below.
				</p>{/if}
			{#if p.egress === 'enforce'}<p class="muted">
					Outbound traffic: only to what's allowed. <code>nepfleet egress suggest {name}</code> lists
					what was refused.
				</p>{:else if p.egress === 'log'}<p class="muted">
					Outbound traffic: recorded, for <code>nepfleet egress suggest {name}</code>.
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
			<h2 id="job-h">{job.kind === 'rollback' ? 'Rollback' : 'Apply'}</h2>
			<p role="status" class:error={job.state === 'failed'}>
				{#if job.state === 'running'}Running…{:else if job.state === 'succeeded'}{job.kind ===
					'rollback'
						? 'Rolled back.'
						: 'Applied.'}{:else}Failed:
					{job.error}{/if}
			</p>
			{#if pollError}<p class="muted" role="status">
					Lost contact with the backend, still asking: {pollError}
				</p>{/if}
			{#if rollbackRefused && lastRollback}
				{@const retry = lastRollback}
				<p>Nothing changed. The old version would remove things.</p>
				<Button onclick={() => askRollback(retry, true)}>Review and roll back anyway…</Button>
			{/if}
			<pre class="log">{job.log}</pre>
		</section>
	{/if}

	<section aria-labelledby="upd-h">
		<div class="row">
			<h2 id="upd-h">Image updates</h2>
			<Button variant="ghost" onclick={loadUpdates} disabled={updates?.state === 'loading'}
				>{updates ? 'Check again' : 'Check for updates'}</Button
			>
		</div>
		{#if updates === null}
			<p class="muted">Asks each image's registry what's newer than what runs.</p>
		{:else if updates.state === 'loading'}
			<p class="muted">Asking the registries…</p>
		{:else if updates.state === 'error'}
			<p class="error" role="alert">{updates.error}</p>
		{:else if updates.value.every((u) => !u.next && !u.beyond && !u.rebuilt && !u.error)}
			<p class="muted">Every image is up to date within its track.</p>
		{:else}
			<ul class="updates">
				{#each updates.value as u (u.image)}
					<li>
						<code>{u.image}:{u.current}</code>
						{#if u.error}<span class="error">{u.error}</span>{/if}
						{#if u.next}<span>→ <strong>{u.next}</strong> with the next template update</span>{/if}
						{#if u.rebuilt}<span>rebuilt since it was pinned: apply with an updated lock</span>{/if}
						{#if u.beyond}<span class="muted">{u.beyond} is out, beyond the {u.track} track</span
							>{/if}
						{#if !u.next && !u.rebuilt && !u.beyond && !u.error}<span class="muted">up to date</span
							>{/if}
					</li>
				{/each}
			</ul>
			{#if updates.value.some((u) => u.next || u.rebuilt)}
				<Button onclick={() => reviewUpdates(true)} disabled={running}
					>Review and take updates…</Button
				>
				<span class="muted">Shows them under Pending changes, to apply from there.</span>
			{/if}
		{/if}
	</section>

	{#if planValue?.egress}
		<section aria-labelledby="egress-h">
			<div class="row">
				<h2 id="egress-h">Outbound traffic</h2>
				<Button variant="ghost" onclick={loadEgress} disabled={egress?.state === 'loading'}
					>{egress
						? 'Check again'
						: planValue.egress === 'enforce'
							? 'Show refused'
							: 'Show where it went'}</Button
				>
			</div>
			{#if egress === null}
				<p class="muted">
					{planValue.egress === 'enforce'
						? 'Only what is allowed gets out. See what was refused, to allow what it needs.'
						: 'Recorded, not limited. See where it went, to build an allow list.'}
				</p>
			{:else if egress.state === 'loading'}
				<p class="muted">Reading its logs…</p>
			{:else if egress.state === 'error'}
				<p class="error" role="alert">{egress.error}</p>
			{:else if egress.value.sidecars === 0}
				<p class="muted">
					Nothing recorded on this backend's host: the stack isn't applied with it yet.
				</p>
			{:else if egress.value.hosts.length + egress.value.addresses.length === 0}
				<p class="muted">
					{egress.value.mode === 'enforce'
						? 'Nothing was refused, as far as the logs go back.'
						: 'It went nowhere that isn’t already allowed.'}
				</p>
			{:else}
				<p>
					{egress.value.mode === 'enforce' ? 'Refused:' : 'Went to, and not yet allowed:'}
				</p>
				<ul class="updates">
					{#each egress.value.hosts as h (h)}<li><code>{h}</code></li>{/each}
					{#each egress.value.addresses as a (a)}<li>
							<code>{a}</code> <span class="muted">no name seen; an address may change</span>
						</li>{/each}
				</ul>
				<p class="muted">
					Allow what it needs under <code>spec.egress.allow</code> in its stack.yaml;
					<code>nepfleet egress suggest {name}</code> prints it ready to paste.
				</p>
			{/if}
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
						{#if h.applied}<span class="badge">running</span>{:else}
							<Button
								variant="ghost"
								onclick={() => askRollback(h)}
								disabled={running}
								aria-label="Roll back to {h.commit.slice(0, 7)}">Roll back…</Button
							>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</section>
{/if}

<Dialog bind:open={rollbackOpen} title="Roll back {name}?">
	{#if rollbackTo}
		<p>
			Back to <code>{rollbackTo.commit.slice(0, 7)}</code>: {rollbackTo.subject}. The fleet
			repository gets a new commit, and the stack is applied. Volume data is not rolled back.
		</p>
	{/if}
	{#if rollbackConfirm}
		<div class="warn">
			<strong>Destructive:</strong> the old version removes things the running stack has. See the job's
			message on the page.
		</div>
		<TextField label="Type the stack name to confirm" bind:value={typed} autocomplete="off" />
	{/if}
	{#if applyError}<p class="error" role="alert">{applyError}</p>{/if}
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (rollbackOpen = false)}>Cancel</Button>
		<Button variant="primary" onclick={rollback} disabled={!canRollback}>
			{starting ? 'Starting…' : 'Roll back'}
		</Button>
	{/snippet}
</Dialog>

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
	.places {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
	}
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
	.history,
	.updates {
		list-style: none;
		padding: 0;
	}
	.updates li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.25rem 0;
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
