<script lang="ts">
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import DiffView from '#lib/ui/DiffView.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';

	let dialogOpen = $state(false);
	let domain = $state('');
	const before = 'services:\n  web:\n    image: nginx:1.27\n    ports: ["8080:80"]\n';
	const after =
		'services:\n  web:\n    image: nginx:1.29\n    ports: ["8080:80"]\n    restart: unless-stopped\n';
</script>

<svelte:head><title>Design system · NepFleet</title></svelte:head>

<h1>Design system</h1>
<p class="lead">The building blocks of the NepFleet UI, in the current theme.</p>

<section aria-labelledby="buttons">
	<h2 id="buttons">Buttons</h2>
	<div class="row">
		<Button>Default</Button>
		<Button variant="primary">Primary</Button>
		<Button variant="danger">Delete stack</Button>
		<Button variant="ghost">Ghost</Button>
		<Button disabled>Disabled</Button>
	</div>
</section>

<section aria-labelledby="inputs">
	<h2 id="inputs">Inputs</h2>
	<div class="fields">
		<TextField
			label="Domain"
			bind:value={domain}
			placeholder="vault.example.org"
			hint="Caddy requests a certificate for it."
		/>
		<TextField label="Port" value="99999" error="Must be between 1 and 65535." />
	</div>
</section>

<section aria-labelledby="dialogs">
	<h2 id="dialogs">Dialog and toasts</h2>
	<div class="row">
		<Button onclick={() => (dialogOpen = true)}>Open dialog</Button>
		<Button onclick={() => toasts.push('Stack vaultwarden applied', 'success')}
			>Success toast</Button
		>
		<Button onclick={() => toasts.push('Apply failed: health check timed out', 'error')}
			>Error toast</Button
		>
	</div>
	<Dialog bind:open={dialogOpen} title="Apply vaultwarden?">
		The new image is pulled and the stack restarted. If it does not become healthy, the previous
		version is restored.
		{#snippet actions()}
			<Button onclick={() => (dialogOpen = false)}>Cancel</Button>
			<Button onclick={() => toasts.push('Apply failed: image not found', 'error')}
				>Fail while open</Button
			>
			<Button variant="primary" onclick={() => (dialogOpen = false)}>Apply</Button>
		{/snippet}
	</Dialog>
</section>

<section aria-labelledby="tabs">
	<h2 id="tabs">Tabs and diff</h2>
	<Tabs
		label="Stack views"
		tabs={[
			{ id: 'diff', label: 'Changes' },
			{ id: 'empty', label: 'Empty state' }
		]}
	>
		{#snippet panel(id)}
			{#if id === 'diff'}
				<DiffView label="compose.yaml" {before} {after} />
			{:else}
				<EmptyState title="No stacks yet">
					Create one from a template or import a running Compose project.
					{#snippet action()}<Button variant="primary">New stack</Button>{/snippet}
				</EmptyState>
			{/if}
		{/snippet}
	</Tabs>
</section>

<style>
	.lead {
		color: var(--muted);
	}
	section {
		margin-top: var(--space-6);
	}
	h2 {
		font-size: 1.1rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.fields {
		display: grid;
		gap: var(--space-4);
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
	}
</style>
