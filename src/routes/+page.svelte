<script lang="ts">
	import { onMount } from 'svelte';
	import { backends } from '#lib/backends.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	let url = $state('');
	let error = $state('');

	onMount(() => {
		void backends.checkAll();
	});

	function add(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			backends.add(url);
			url = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<header>
	<h1>Backends</h1>
	<p>
		Each backend is one NepFleet server, for example at home or in the cloud. The backend must allow
		this page's origin: <code>nepfleet serve --allowed-origins {location.origin}</code>
	</p>
</header>

<form onsubmit={add}>
	<label for="url" class="sr-only">Backend URL</label>
	<input
		id="url"
		type="url"
		placeholder="https://fleet.example.org"
		bind:value={url}
		required
		autocomplete="url"
	/>
	<Button variant="primary" type="submit">Add backend</Button>
</form>
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if backends.list.length === 0}
	<EmptyState title="No backends yet">Add one above to see its stacks and hosts.</EmptyState>
{:else}
	<ul class="grid">
		{#each backends.list as backend (backend.id)}
			{@const status = backends.status[backend.id]}
			<li class="card">
				<div class="row">
					<span class="dot {status?.state ?? 'checking'}" aria-hidden="true"></span>
					<strong>
						{status?.state === 'online' ? status.info.name : new URL(backend.url).host}
					</strong>
				</div>
				<code class="muted">{backend.url}</code>
				<p class="muted">
					{#if !status || status.state === 'checking'}
						Checking…
					{:else if status.state === 'online'}
						Online · v{status.info.version} · API {status.info.apiVersion}
					{:else}
						Offline · {status.error}
					{/if}
				</p>
				<div class="row actions">
					<Button onclick={() => backends.check(backend)}>Recheck</Button>
					<Button variant="ghost" onclick={() => backends.remove(backend.id)}>Remove</Button>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	header p,
	.muted {
		color: var(--muted);
	}
	h1 {
		margin: 0 0 0.25rem;
	}
	form {
		display: flex;
		gap: 0.5rem;
		margin: 1.5rem 0 0.5rem;
	}
	form input {
		flex: 1;
	}
	.error {
		color: var(--err);
	}
	.grid {
		list-style: none;
		padding: 0;
		margin: 1.5rem 0 0;
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.card p {
		margin: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.actions {
		margin-top: 0.5rem;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--muted);
	}
	.dot.online {
		background: var(--ok);
	}
	.dot.offline {
		background: var(--err);
	}
</style>
