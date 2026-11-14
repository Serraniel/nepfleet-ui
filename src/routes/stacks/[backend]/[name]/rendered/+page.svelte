<script lang="ts">
	import { page } from '$app/state';
	import { fetchRendered } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	const backendId = $derived(page.params.backend ?? '');
	const name = $derived(page.params.name ?? '');
	const backend = $derived(backends.list.find((b) => b.id === backendId));
	const token = $derived(tokens.byBackend[backendId]);
	const stackHref = $derived(
		`/stacks/${encodeURIComponent(backendId)}/${encodeURIComponent(name)}`
	);

	let files = $state<{ path: string; content: string }[] | null>(null);
	let error = $state('');

	async function load() {
		if (!backend || !token) return;
		files = null;
		error = '';
		try {
			files = await fetchRendered(backend, token, name);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void load();
	});
</script>

<header>
	<p><a href={stackHref}>← {name}</a></p>
	<h1>{name}, rendered</h1>
	<p class="muted">
		What NepFleet hands Docker Compose for this stack from the fleet repository as committed, with
		secrets masked. Pending changes show under Pending changes on the stack's page.
	</p>
</header>

{#if !backend || !token}
	<EmptyState title="No token for this backend">
		Add one on the <a href="/stacks">Stacks</a> page.
	</EmptyState>
{:else if error}
	<p class="error" role="alert">{error}</p>
	<Button onclick={load}>Try again</Button>
{:else if files === null}
	<p class="muted">Rendering…</p>
{:else}
	{#each files as f, i (f.path)}
		<details open={i === 0}>
			<summary><code>{f.path}</code></summary>
			<pre>{f.content}</pre>
		</details>
	{/each}
{/if}

<style>
	details {
		border-top: 1px solid var(--border);
		padding: 0.4rem 0;
	}
	pre {
		overflow-x: auto;
		padding: 0.75rem;
		border-radius: 0.4rem;
		background: var(--surface-2, transparent);
		border: 1px solid var(--border);
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
