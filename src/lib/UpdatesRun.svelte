<script lang="ts">
	import { onDestroy } from 'svelte';
	import { type Backend, type Job, fetchJob, startUpdates } from '#lib/backend.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = { backend: Backend; token: string; label: string };
	let { backend, token, label }: Props = $props();

	let now = $state(false);
	let job = $state<Job | null>(null);
	let error = $state('');
	let left = false;
	onDestroy(() => (left = true));

	async function run() {
		error = '';
		try {
			job = await startUpdates(backend, token, now);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			return;
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

<div class="run">
	<strong>{label}</strong>
	<label><input type="checkbox" bind:checked={now} /> also outside the update window</label>
	<Button disabled={job?.state === 'running'} onclick={run}
		>{job?.state === 'running' ? 'Running…' : 'Run updates now'}</Button
	>
</div>
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if job}
	<p role="status" class:error={job.state === 'failed'}>
		{job.state === 'running'
			? 'Running…'
			: job.state === 'succeeded'
				? 'Done.'
				: `Failed: ${job.error ?? 'see the log'}`}
	</p>
	{#if job.log}<pre>{job.log}</pre>{/if}
{/if}

<style>
	.run {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	pre {
		overflow-x: auto;
		max-height: 20rem;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-2);
	}
	.error {
		color: var(--err);
	}
</style>
