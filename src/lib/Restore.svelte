<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		type Backend,
		type Backups,
		type Job,
		VerifyFirstError,
		fetchBackups,
		fetchJob,
		startRestore
	} from '#lib/backend.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import Button from '#lib/ui/Button.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	type Props = { backend: Backend; token: string; stack: string };
	let { backend, token, stack }: Props = $props();

	let backups = $state<Backups | null>(null);
	let archive = $state('');
	let picked = $state<Record<string, boolean>>({});
	let confirm = $state('');
	let error = $state('');
	let loading = $state(false);
	let job = $state<Job | null>(null);
	let left = false;
	onDestroy(() => (left = true));

	async function load() {
		loading = true;
		error = '';
		try {
			backups = await fetchBackups(backend, token, stack);
			archive = backups.archives[0] ?? '';
			picked = Object.fromEntries(backups.volumes.map((v) => [v, true]));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	const when = (name: string) => {
		const m = /backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(name);
		return m ? `${m[1]} ${m[2]}:${m[3]}` : name;
	};

	async function restore() {
		if (!backups) return;
		error = '';
		const all = backups.volumes.every((v) => picked[v]);
		const volumes = backups.volumes.filter((v) => picked[v]);
		const req = { archive, confirm, ...(all ? {} : { volumes }) };
		try {
			try {
				job = await startRestore(backend, token, stack, req);
			} catch (e) {
				if (!(e instanceof VerifyFirstError)) throw e;
				await verifyIdentity(backend);
				job = await startRestore(backend, token, stack, req);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			return;
		}
		confirm = '';
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

<section aria-labelledby="restore-h">
	<h2 id="restore-h">Restore from a backup</h2>
	{#if !backups}
		<p class="muted">Put the stack's volumes back from one of this host's backup archives.</p>
		<Button variant="ghost" disabled={loading} onclick={load}
			>{loading ? 'Looking…' : 'Show backups'}</Button
		>
	{:else if backups.archives.length === 0}
		<p class="muted">No archives in {backups.folder} yet.</p>
	{:else if backups.volumes.length === 0}
		<p class="muted">The stack has no volumes on this host: apply it here first.</p>
	{:else}
		<label class="field"
			>Archive
			<select bind:value={archive}>
				{#each backups.archives as a (a)}<option value={a}>{when(a)}</option>{/each}
			</select>
		</label>
		<fieldset>
			<legend>Volumes</legend>
			{#each backups.volumes as v (v)}<label
					><input type="checkbox" bind:checked={picked[v]} /> {v}</label
				>{/each}
		</fieldset>
		<p>
			The stack stops while its data is replaced. The current data of each volume is kept in a copy
			(<code>…-before-restore-…</code>) until you remove it.
		</p>
		<TextField label="Type {stack} to confirm" bind:value={confirm} autocomplete="off" />
		<Button
			variant="danger"
			disabled={confirm !== stack ||
				!archive ||
				!Object.values(picked).some(Boolean) ||
				job?.state === 'running'}
			onclick={restore}>Restore</Button
		>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if job}
		<p role="status" class:error={job.state === 'failed'}>
			{job.state === 'running'
				? 'Restoring…'
				: job.state === 'succeeded'
					? 'Restored.'
					: `Failed: ${job.error ?? 'see the log'}`}
		</p>
		{#if job.log}<pre>{job.log}</pre>{/if}
	{/if}
</section>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-width: 20rem;
	}
	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		margin: 0.75rem 0;
	}
	pre {
		overflow-x: auto;
		max-height: 20rem;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-2);
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
