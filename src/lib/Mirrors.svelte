<script lang="ts">
	import { type Backend, type MirrorStatus, fetchMirrors, mirrorNow } from '#lib/backend.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = { backend: Backend; token: string };
	let { backend, token }: Props = $props();

	let mirrors = $state<MirrorStatus[] | null | undefined>(undefined);
	let error = $state('');
	let busy = $state(false);

	$effect(() => {
		fetchMirrors(backend, token).then(
			(m) => (mirrors = m),
			(e: unknown) => (error = e instanceof Error ? e.message : String(e))
		);
	});

	async function push() {
		busy = true;
		error = '';
		try {
			mirrors = await mirrorNow(backend, token);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const when = (iso?: string) =>
		iso && !iso.startsWith('0001')
			? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
			: 'never';
</script>

<h3>Repository mirrors</h3>
{#if mirrors === undefined && !error}
	<p class="muted">Loading…</p>
{:else if mirrors === null}
	<p class="muted">This backend's NepFleet is too old to show its mirrors.</p>
{:else if mirrors && mirrors.length === 0}
	<p class="muted">
		No mirrors: the fleet repository lives only here and at its origin. Add second remotes under
		<code>spec.mirrors</code> in fleet.yaml.
	</p>
{:else if mirrors}
	<ul class="mirrors">
		{#each mirrors as m (m.url)}
			<li>
				<code>{m.url}</code>
				<span class="muted">last pushed {when(m.ok)}</span>
				{#if m.error}<span class="error">{m.error}</span>{/if}
			</li>
		{/each}
	</ul>
	<Button variant="ghost" disabled={busy} onclick={push}>{busy ? 'Pushing…' : 'Mirror now'}</Button>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
	.mirrors {
		list-style: none;
		padding: 0;
	}
	.mirrors li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.2rem 0;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
