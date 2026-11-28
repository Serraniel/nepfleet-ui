<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		type Backend,
		type Job,
		type RemovalPlan,
		VerifyFirstError,
		fetchJob,
		fetchRemovalPlan,
		startRemove
	} from '#lib/backend.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import {
		type RemoveChoices,
		defaultChoices,
		removeRequest,
		reportOf,
		whyNot
	} from '#lib/remove.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import ProgressBar from '#lib/ui/ProgressBar.svelte';
	import Spinner from '#lib/ui/Spinner.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	type Props = { backend: Backend; token: string; stack: string };
	let { backend, token, stack }: Props = $props();

	let open = $state(false);
	let plan = $state<RemovalPlan | null>(null);
	let choices = $state<RemoveChoices>({ backup: true, deleteData: false, typed: '', force: false });
	let loading = $state(false);
	let starting = $state(false);
	let error = $state('');
	let job = $state<Job | null>(null);
	let left = false;
	onDestroy(() => (left = true));

	const reason = $derived(plan ? whyNot(plan, choices) : '');
	const report = $derived(reportOf(job));
	const busy = $derived(starting || job?.state === 'running');

	async function show() {
		open = true;
		if (job) return; // the running or finished removal stays on view
		loading = true;
		error = '';
		plan = null;
		try {
			plan = await fetchRemovalPlan(backend, token, stack);
			choices = defaultChoices(plan);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function remove() {
		if (!plan || reason) return;
		const req = removeRequest(plan, choices);
		error = '';
		starting = true;
		try {
			try {
				job = await startRemove(backend, token, stack, req);
			} catch (e) {
				if (!(e instanceof VerifyFirstError)) throw e;
				await verifyIdentity(backend);
				job = await startRemove(backend, token, stack, req);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			return;
		} finally {
			starting = false;
		}
		const id = job.id;
		while (!left && job?.id === id && job.state === 'running') {
			await new Promise((r) => setTimeout(r, 2000));
			try {
				job = await fetchJob(backend, token, id);
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
				return;
			}
		}
	}
</script>

<section aria-labelledby="remove-h" class="danger-zone">
	<h2 id="remove-h">Remove stack</h2>
	<p class="muted">
		Stops and removes the stack, its directory in the fleet repository, and what NepFleet made for
		it: DNS records, tokens, its sign-on client. You see the plan first. The data stays unless you
		choose otherwise.
	</p>
	<Button variant="danger" onclick={show}>Remove stack…</Button>
</section>

<Dialog bind:open title="Remove {stack}?">
	{#if loading}
		<p><Spinner label="Planning the removal…" /></p>
	{:else if job}
		{#if job.state === 'running' && job.progress}
			<ProgressBar {...job.progress} />
		{:else if job.state === 'running'}
			<p role="status"><Spinner label="Removing…" /></p>
		{:else}
			<p role="status" class:error={job.state === 'failed'}>
				{job.state === 'succeeded'
					? `${stack} is removed.`
					: `Failed: ${job.error ?? 'see the log'}`}
			</p>
		{/if}
		{#if report}
			{#if report.removed.length}
				<h3>Removed</h3>
				<ul aria-label="Removed">
					{#each report.removed as r (r)}<li>{r}</li>{/each}
				</ul>
			{/if}
			{#if report.backup}
				<p>
					Backup: <code>{report.backup}</code>. To get the data back, roll the stack back (<code>
						nepfleet rollback {stack}
					</code>) and restore from it.
				</p>
			{/if}
			{#if report.kept.length}
				<h3>Kept</h3>
				<ul aria-label="Kept">
					{#each report.kept as k (k)}<li>{k}</li>{/each}
				</ul>
			{/if}
			{#if report.warnings.length}
				<div class="warn">
					<ul aria-label="Warnings">
						{#each report.warnings as w (w)}<li>{w}</li>{/each}
					</ul>
				</div>
			{/if}
		{/if}
		{#if job.log}
			<details>
				<summary>Log</summary>
				<pre>{job.log}</pre>
			</details>
		{/if}
		{#if job.state === 'succeeded'}<p><a href="/stacks">Back to the stacks</a></p>{/if}
	{:else if plan}
		<h3>What happens</h3>
		<ol class="steps">
			{#each plan.steps as s (s)}<li>{s}</li>{/each}
		</ol>
		{#if plan.dnsManual.length}
			<p>DNS records to check, and delete by hand where they point at this host:</p>
			<ul>
				{#each plan.dnsManual as d (d)}<li>{d}</li>{/each}
			</ul>
		{/if}
		{#if plan.refused.length}
			<div class="warn" role="alert">
				<strong>It can't be removed:</strong>
				<ul>
					{#each plan.refused as r (r)}<li>{r}</li>{/each}
				</ul>
			</div>
		{:else}
			{#if plan.blocked.length}
				<div class="warn">
					<strong>Other stacks need it:</strong>
					<ul>
						{#each plan.blocked as b (b)}<li>{b}</li>{/each}
					</ul>
					<label><input type="checkbox" bind:checked={choices.force} /> Remove anyway</label>
				</div>
			{/if}
			<fieldset>
				<legend>Options</legend>
				<label>
					<input type="checkbox" bind:checked={choices.backup} disabled={!plan.backup} />
					Back up first
				</label>
				<p class="muted">
					{#if !plan.backup}
						No volume is kept in backups, so none is taken.
					{:else if plan.backupUnavailable}
						{plan.backupUnavailable}.
					{:else}
						The volumes go into one encrypted archive in <code>{plan.backupFolder}</code>.
					{/if}
				</p>
				{#if plan.volumes.length}
					<label>
						<input type="checkbox" bind:checked={choices.deleteData} />
						Delete the data too
					</label>
					<p class="muted">
						Without it the volumes stay: {plan.volumes.map((v) => v.name).join(', ')}.
					</p>
					{#if choices.deleteData}
						<div class="warn">
							<strong>The data is deleted:</strong>
							{plan.volumes.length} volume(s). {choices.backup && plan.backup
								? 'Only the backup keeps it.'
								: 'Nothing keeps it.'}
						</div>
						<TextField
							label="Type {stack} to delete its data"
							bind:value={choices.typed}
							autocomplete="off"
						/>
					{/if}
				{/if}
			</fieldset>
		{/if}
		{#if reason && !plan.refused.length}<p class="muted" role="status">{reason}</p>{/if}
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (open = false)}>
			{job && job.state !== 'running' ? 'Close' : 'Cancel'}
		</Button>
		{#if !job}
			<Button variant="danger" onclick={remove} disabled={!plan || !!reason} {busy}>
				{starting ? 'Starting…' : 'Remove'}
			</Button>
		{/if}
	{/snippet}
</Dialog>

<style>
	.danger-zone {
		margin: 2rem 0 1.5rem;
		padding: 1rem;
		border: 1px solid var(--err);
		border-radius: var(--radius);
	}
	.danger-zone h2 {
		margin-top: 0;
	}
	h3 {
		font-size: 1rem;
		margin: 1rem 0 0.25rem;
	}
	.steps {
		padding-left: 1.25rem;
	}
	fieldset {
		display: grid;
		gap: 0.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin: 0.75rem 0;
	}
	fieldset p {
		margin: 0 0 0.5rem 1.6rem;
	}
	.warn {
		border: 1px solid var(--err);
		border-radius: var(--radius);
		padding: 0.5rem 0.75rem;
		margin: 0.5rem 0;
	}
	pre {
		overflow-x: auto;
		max-height: 16rem;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-2);
		font-size: 0.85em;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
