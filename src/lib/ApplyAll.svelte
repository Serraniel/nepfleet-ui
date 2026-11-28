<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { type Pending, applicable, applyAll } from '#lib/apply-all.ts';
	import { fetchJob, fetchPlan, startApply } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { fleet } from '#lib/fleet.svelte.ts';
	import { stacks, tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import ProgressBar from '#lib/ui/ProgressBar.svelte';
	import Spinner from '#lib/ui/Spinner.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	type Props = { label: (backend: string) => string };
	let { label }: Props = $props();

	/** Manual stacks with changes Apply all takes. */
	let pending = $state<Pending[]>([]);
	/** Manual stacks it leaves to their page: a first apply, or a plan that failed. */
	let other = $state<{ backend: string; stack: string; why: string }[]>([]);
	let upToDate = $state(0);
	let checking = $state(false);
	let checked = $state(false);
	let running = $state(false);
	let confirmOpen = $state(false);
	let typed = $state<Record<string, string>>({});
	let left = false;
	onDestroy(() => (left = true));

	const connected = $derived(fleet.visible.filter((b) => tokens.byBackend[b.id]));
	const key = (p: { backend: string; stack: string }) => `${p.backend}/${p.stack}`;
	const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
	const isDestructive = (p: Pending) => (p.plan.destructive?.length ?? 0) > 0;
	const todo = $derived(pending.filter((p) => p.state !== 'applied'));

	// The backend renders one plan at a time and answers busy (503) meanwhile.
	async function plan(backendId: string, stack: string) {
		const b = backends.list.find((x) => x.id === backendId);
		const token = tokens.byBackend[backendId];
		if (!b || !token) throw new Error('No token for this backend');
		for (let attempt = 0; ; attempt++) {
			try {
				return await fetchPlan(b, token, stack);
			} catch (e) {
				if (e instanceof Error && e.message === 'HTTP 503' && attempt < 5) {
					await sleep(3000);
					continue;
				}
				throw e;
			}
		}
	}

	// Each check is a round; picking another fleet ends it, and what it found
	// is dropped, so Apply all only ever takes stacks of the fleet on show.
	let round = 0;
	function reset() {
		round++;
		checking = false;
		checked = false;
		confirmOpen = false;
		pending = [];
		other = [];
		upToDate = 0;
		typed = {};
	}
	$effect(() => {
		void fleet.current;
		untrack(() => {
			if (!running) reset();
		});
	});

	async function check() {
		reset();
		const mine = round;
		checking = true;
		await Promise.all(
			connected.map(async (b) => {
				const st = stacks.byBackend[b.id];
				if (st?.state !== 'ok') return;
				for (const s of st.stacks.filter((x) => x.apply === 'manual')) {
					if (left || mine !== round) return;
					try {
						const p = await plan(b.id, s.name);
						if (mine !== round) return;
						if (applicable(p))
							pending.push({ backend: b.id, stack: s.name, plan: p, state: 'pending' });
						else if (p.first) other.push({ backend: b.id, stack: s.name, why: 'not applied yet' });
						else upToDate++;
					} catch (e) {
						if (mine !== round) return;
						other.push({
							backend: b.id,
							stack: s.name,
							why: e instanceof Error ? e.message : String(e)
						});
					}
				}
			})
		);
		if (mine !== round) return;
		checking = false;
		checked = true;
	}

	function askAll() {
		typed = {}; // each time, every destructive stack is confirmed anew
		confirmOpen = true;
	}

	async function run() {
		confirmOpen = false;
		running = true;
		try {
			await applyAll(
				pending,
				{
					start: (p, confirm) => {
						const b = backends.list.find((x) => x.id === p.backend);
						const token = tokens.byBackend[p.backend];
						if (!b || !token || !p.plan.id) throw new Error('No token for this backend');
						return startApply(b, token, p.stack, p.plan.id, confirm);
					},
					job: (p, id) => {
						const b = backends.list.find((x) => x.id === p.backend);
						const token = tokens.byBackend[p.backend];
						if (!b || !token) throw new Error('No token for this backend');
						return fetchJob(b, token, id);
					},
					sleep,
					stopped: () => left
				},
				(p) => typed[key(p)] === p.stack
			);
		} finally {
			running = false;
		}
	}

	const stackHref = (p: { backend: string; stack: string }) =>
		`/stacks/${encodeURIComponent(p.backend)}/${encodeURIComponent(p.stack)}`;
	const files = (p: Pending) => {
		const n = p.plan.changes?.length ?? 0;
		return `${n} ${n === 1 ? 'file' : 'files'}`;
	};
</script>

<section aria-labelledby="pending-h">
	<h2 id="pending-h">Pending changes</h2>
	<p class="muted">
		Stacks set to <code>apply: manual</code> wait for you. Apply all applies each one's current plan,
		one after another, health-checked as usual, and stops at the first failure.
	</p>
	<div class="buttons">
		<Button onclick={check} busy={checking} disabled={running}>
			{checking ? 'Checking…' : checked ? 'Check again' : 'Check manual stacks'}
		</Button>
		{#if todo.length}
			<Button variant="primary" busy={running} disabled={checking} onclick={askAll}>
				{running ? 'Applying…' : `Apply all (${todo.length})`}
			</Button>
		{/if}
	</div>
	{#if checked && !checking}
		<p class="muted" role="status">
			{#if pending.length === 0}No manual stack has pending changes.{/if}
			{#if upToDate}{upToDate} up to date.{/if}
		</p>
	{/if}
	{#if pending.length}
		<ul class="rows" aria-label="Stacks with pending changes">
			{#each pending as p (key(p))}
				<li>
					<a href={stackHref(p)}><strong>{p.stack}</strong></a>
					<span class="muted">{label(p.backend)}</span>
					<span class="muted">{files(p)}</span>
					{#if isDestructive(p)}<span class="warn">destructive</span>{/if}
					<span class="state" role="status">
						{#if p.state === 'pending'}
							<span class="muted">pending</span>
						{:else if p.state === 'applying'}
							{#if p.progress}<ProgressBar {...p.progress} />{:else}<Spinner
									label="Applying…"
								/>{/if}
						{:else if p.state === 'applied'}
							applied
						{:else if p.state === 'failed'}
							<span class="error">failed: {p.reason}</span>
							<a href={stackHref(p)}>See the stack</a>
						{:else if p.state === 'skipped'}
							<span class="muted">skipped: {p.reason}</span>
						{:else}
							<span class="muted">not started</span>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if other.length}
		<p class="muted">Left to their page:</p>
		<ul class="rows">
			{#each other as o (key(o))}
				<li>
					<a href={stackHref(o)}><strong>{o.stack}</strong></a>
					<span class="muted">{label(o.backend)}</span>
					<span class="muted">{o.why}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<Dialog
	bind:open={confirmOpen}
	title={todo.length === 1 ? 'Apply 1 stack?' : `Apply ${todo.length} stacks?`}
>
	<p>
		This applies each stack's plan as checked, in this order. If one fails, the rest wait. If a
		stack changed since, the backend refuses it, and you check again.
	</p>
	<ol>
		{#each todo as p (key(p))}
			<li>
				<strong>{p.stack}</strong> <span class="muted">{label(p.backend)}, {files(p)}</span>
				{#if isDestructive(p)}
					<div class="warn">
						<strong>Destructive:</strong>
						<ul>
							{#each p.plan.destructive ?? [] as d (d)}<li>{d}</li>{/each}
						</ul>
						<TextField
							label="Type {p.stack} to include it; otherwise it's skipped"
							bind:value={() => typed[key(p)] ?? '', (v) => (typed[key(p)] = v)}
							autocomplete="off"
						/>
					</div>
				{/if}
			</li>
		{/each}
	</ol>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (confirmOpen = false)}>Cancel</Button>
		<Button variant="primary" onclick={run}>Apply all</Button>
	{/snippet}
</Dialog>

<style>
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
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
	.state {
		flex: 1 1 12rem;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
	.warn {
		color: var(--warn);
	}
</style>
