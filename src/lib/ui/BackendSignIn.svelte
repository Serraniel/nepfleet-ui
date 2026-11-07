<script lang="ts">
	import type { Backend } from '#lib/backend.ts';
	import {
		type AuthStatus,
		addPasskey,
		fetchAuthStatus,
		setUp,
		signIn,
		signOut
	} from '#lib/login.ts';
	import Button from './Button.svelte';
	import TextField from './TextField.svelte';

	type Props = { backend: Backend; onchange: () => void };
	let { backend, onchange }: Props = $props();

	let status = $state<AuthStatus | null>(null);
	let busy = $state(false);
	let error = $state('');
	let added = $state(false);
	let setupToken = $state('');
	let name = $state('');

	async function refresh() {
		try {
			status = await fetchAuthStatus(backend);
		} catch {
			status = null; // offline: the backend's card already says so
		}
	}

	$effect(() => {
		void backend.id;
		void refresh();
	});

	async function act(what: () => Promise<void>) {
		busy = true;
		error = '';
		added = false;
		try {
			await what();
			await refresh();
			onchange();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	function create(event: SubmitEvent) {
		event.preventDefault();
		void act(async () => {
			await setUp(backend, setupToken, name);
			setupToken = '';
		});
	}

	function another() {
		void act(async () => {
			await addPasskey(backend);
			added = true;
		});
	}
</script>

{#if status?.signedIn}
	<p class="muted">Signed in as {status.name}</p>
	<div class="row">
		<Button variant="ghost" disabled={busy} onclick={another}>Add a passkey</Button>
		<Button variant="ghost" disabled={busy} onclick={() => act(() => signOut(backend))}
			>Sign out</Button
		>
	</div>
	{#if added}<p class="muted" role="status">Passkey added.</p>{/if}
{:else if status?.setupNeeded}
	<form onsubmit={create}>
		<p class="muted">No users yet. The server printed a one-time setup token to its log.</p>
		<TextField
			label="Setup token"
			type="password"
			autocomplete="off"
			bind:value={setupToken}
			required
		/>
		<TextField label="Your name" autocomplete="name" bind:value={name} required />
		<Button variant="primary" type="submit" disabled={busy}>Create a passkey</Button>
	</form>
{:else if status}
	<Button variant="primary" disabled={busy} onclick={() => act(() => signIn(backend))}>
		{busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
	</Button>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
	.muted {
		color: var(--muted);
		margin: 0;
	}
	.error {
		color: var(--err);
		margin: 0;
	}
	.row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
</style>
