<script lang="ts">
	import { onMount } from 'svelte';
	import { DEFAULT_DAEMON, local } from '#lib/local.svelte.ts';
	import { type Remote, addRemote, describe, remoteAction, removeRemote } from '#lib/local.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	let daemonUrl = $state(local.url || DEFAULT_DAEMON);
	let tokenInput = $state('');
	let keep = $state(false);
	let connecting = $state(false);
	let connectError = $state('');

	let address = $state('');
	let name = $state('');
	let adding = $state(false);
	let addError = $state('');
	let busy = $state<Record<string, boolean>>({});
	let actionError = $state('');
	let removing = $state<Remote | null>(null);
	let removeOpen = $state(false);

	onMount(() => {
		void local.refresh();
		local.follow();
	});

	async function connectDaemon(event: SubmitEvent) {
		event.preventDefault();
		connecting = true;
		connectError = '';
		try {
			await local.connect(daemonUrl, tokenInput, keep);
			tokenInput = '';
		} catch (e) {
			connectError =
				e instanceof TypeError
					? `No answer from ${daemonUrl}. Is the daemon running with --http, and does it allow this page's origin?`
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			connecting = false;
		}
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		adding = true;
		addError = '';
		try {
			await addRemote(local.url, local.token, address.trim(), name.trim());
			address = '';
			name = '';
			await local.refresh();
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			adding = false;
		}
	}

	async function act(r: Remote, action: 'refresh' | 'connect' | 'disconnect') {
		busy[r.name] = true;
		actionError = '';
		try {
			await remoteAction(local.url, local.token, r.name, action);
			await local.refresh();
		} catch (e) {
			actionError = `${r.name}: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			busy[r.name] = false;
		}
	}

	async function confirmRemove() {
		const r = removing;
		if (!r) return;
		removeOpen = false;
		busy[r.name] = true;
		actionError = '';
		try {
			await removeRemote(local.url, local.token, r.name);
			await local.refresh();
		} catch (e) {
			actionError = `${r.name}: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			busy[r.name] = false;
		}
	}

	const tunnelText: Record<string, string> = {
		off: 'Not connected',
		connecting: 'Connecting…',
		up: 'Connected',
		down: 'Reconnecting…'
	};
</script>

<header>
	<h1>Fleets</h1>
	<p>
		Manage machines from here through the NepFleet control daemon on this computer. It keeps running
		when you close this page, and reaches them over SSH with your keys.
	</p>
</header>

{#if !local.connected}
	<section class="card" aria-labelledby="daemon-h">
		<h2 id="daemon-h">Connect to the control daemon</h2>
		<p>Start it on this computer, then paste its token:</p>
		<pre><code
				>nepfleet control --http 127.0.0.1:7481 --allowed-origins {location.origin}
nepfleet control token</code
			></pre>
		<form onsubmit={connectDaemon}>
			<label for="daemon-url">Daemon address</label>
			<input id="daemon-url" type="url" bind:value={daemonUrl} required />
			<label for="daemon-token">Token</label>
			<input
				id="daemon-token"
				type="password"
				autocomplete="off"
				placeholder="nfc_…"
				bind:value={tokenInput}
				required
			/>
			<label class="check"><input type="checkbox" bind:checked={keep} /> Keep for this tab</label>
			<Button variant="primary" type="submit" disabled={connecting}>
				{connecting ? 'Connecting…' : 'Connect'}
			</Button>
		</form>
		{#if connectError}<p class="error" role="alert">{connectError}</p>{/if}
	</section>
{:else}
	<div class="row">
		<p class="muted">Control daemon at <code>{local.url}</code></p>
		<Button variant="ghost" onclick={() => local.disconnect()}>Forget token</Button>
	</div>
	{#if local.error}<p class="error" role="alert">{local.error}</p>{/if}

	<section class="card" aria-labelledby="add-h">
		<h2 id="add-h">Add a machine</h2>
		<p class="muted">
			The daemon looks at it first over SSH, changing nothing. It uses your SSH keys and never asks
			for a password. Connect once with <code>ssh</code> first, so its host key is known.
		</p>
		<form class="inline" onsubmit={add}>
			<label for="add-address" class="sr-only">SSH address</label>
			<input
				id="add-address"
				placeholder="ssh://me@nas.local"
				bind:value={address}
				autocomplete="off"
				required
			/>
			<label for="add-name" class="sr-only">Name (optional)</label>
			<input id="add-name" placeholder="Name (optional)" bind:value={name} autocomplete="off" />
			<Button variant="primary" type="submit" disabled={adding}>
				{adding ? 'Looking at it…' : 'Add'}
			</Button>
		</form>
		{#if addError}<p class="error" role="alert">{addError}</p>{/if}
	</section>

	{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}

	{#if local.remotes.length === 0}
		<EmptyState title="No machines yet">Add one above by its SSH address.</EmptyState>
	{:else}
		<ul class="remotes">
			{#each local.remotes as r (r.name)}
				<li class="card">
					<div class="row">
						<div>
							<strong>{r.name}</strong> <code class="muted">{r.address}</code>
						</div>
						<span class="state {r.tunnel}" role="status">{tunnelText[r.tunnel ?? 'off']}</span>
					</div>
					{#if r.report}<p>{describe(r.report)}</p>{/if}
					{#if r.next}<p class="muted">{r.next}</p>{/if}
					{#if r.tunnelError}<p class="error">{r.tunnelError}</p>{/if}
					{#if r.error}<p class="error">Last check failed: {r.error}</p>{/if}
					<div class="actions">
						{#if r.tunnel === 'up'}
							<a href="/stacks">Stacks</a>
						{/if}
						{#if r.connect}
							<Button onclick={() => act(r, 'disconnect')} disabled={busy[r.name]}
								>Disconnect</Button
							>
						{:else}
							<Button onclick={() => act(r, 'connect')} disabled={busy[r.name]}>Connect</Button>
						{/if}
						<Button variant="ghost" onclick={() => act(r, 'refresh')} disabled={busy[r.name]}>
							Check again
						</Button>
						<Button
							variant="ghost"
							onclick={() => {
								removing = r;
								removeOpen = true;
							}}
							disabled={busy[r.name]}>Remove…</Button
						>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<Dialog bind:open={removeOpen} title="Remove {removing?.name}?">
	<p>
		This disconnects and forgets it here. Nothing changes on the machine itself, apart from revoking
		this computer's token.
	</p>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (removeOpen = false)}>Cancel</Button>
		<Button variant="primary" onclick={confirmRemove}>Remove</Button>
	{/snippet}
</Dialog>

<style>
	header p,
	.muted {
		color: var(--muted);
	}
	h1 {
		margin: 0 0 0.25rem;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
	}
	.error {
		color: var(--err);
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
		padding: 1rem 1.1rem;
		margin: 1rem 0;
	}
	.card p {
		margin: 0.3rem 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: 32rem;
	}
	form.inline {
		flex-direction: row;
		flex-wrap: wrap;
		max-width: none;
	}
	form.inline input {
		flex: 1 1 12rem;
	}
	.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	pre {
		white-space: pre-wrap;
		word-break: break-all;
		font-size: 0.85em;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.remotes {
		list-style: none;
		padding: 0;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.6rem;
	}
	.state {
		font-size: 0.85em;
	}
	.state.up {
		color: var(--ok);
	}
	.state.down {
		color: var(--err);
	}
</style>
