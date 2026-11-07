<script lang="ts">
	import type { Backend } from '#lib/backend.ts';
	import {
		type AuthStatus,
		type CodeSetup,
		addPasskey,
		beginCodes,
		fetchAuthStatus,
		finishCodes,
		providerLoginUrl,
		removeCodes,
		setUp,
		signIn,
		signInWithCode,
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
	let code = $state('');
	/** In memory only, and gone once codes are on. */
	let codeSetup = $state<CodeSetup | null>(null);

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

	function useCode(event: SubmitEvent) {
		event.preventDefault();
		void act(async () => {
			await signInWithCode(backend, name, code);
			code = '';
		});
	}

	function startCodes() {
		void act(async () => {
			codeSetup = await beginCodes(backend);
			code = '';
		});
	}

	function confirmCodes(event: SubmitEvent) {
		event.preventDefault();
		const setup = codeSetup;
		if (!setup) return;
		void act(async () => {
			await finishCodes(backend, setup.ceremony, code);
			codeSetup = null;
			code = '';
		});
	}
</script>

{#if status?.signedIn}
	<p class="muted">Signed in as {status.name}</p>
	<div class="row">
		{#if status.passkeys && !status.external}
			<Button variant="ghost" disabled={busy} onclick={another}>Add a passkey</Button>
		{/if}
		{#if status.totp}
			<Button variant="ghost" disabled={busy} onclick={() => act(() => removeCodes(backend))}
				>Turn off sign-in codes</Button
			>
		{:else if !codeSetup && !status.external}
			<Button variant="ghost" disabled={busy} onclick={startCodes}>Set up sign-in codes</Button>
		{/if}
		<Button variant="ghost" disabled={busy} onclick={() => act(() => signOut(backend))}
			>Sign out</Button
		>
	</div>
	{#if added}<p class="muted" role="status">Passkey added.</p>{/if}
	{#if codeSetup}
		<form onsubmit={confirmCodes}>
			<p class="muted">
				A fallback for when no passkey is at hand. Codes are weaker than passkeys: they can be
				phished, and one alone signs you in.
			</p>
			<p class="muted">
				Add this to your authenticator app:
				<a href={codeSetup.url}>open in an app</a>, or enter the key
				<code data-testid="totp-secret">{codeSetup.secret}</code>
			</p>
			<TextField
				label="Code from the app"
				inputmode="numeric"
				autocomplete="one-time-code"
				bind:value={code}
				required
			/>
			<div class="row">
				<Button variant="primary" type="submit" disabled={busy}>Turn on</Button>
				<Button variant="ghost" disabled={busy} onclick={() => (codeSetup = null)}>Cancel</Button>
			</div>
		</form>
	{/if}
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
	{#if status.oidc}
		<Button
			variant="primary"
			disabled={busy}
			onclick={() => location.assign(providerLoginUrl(backend, location.href))}
		>
			Sign in with your identity provider
		</Button>
	{/if}
	{#if status.passkeys}
		<Button
			variant={status.oidc ? 'ghost' : 'primary'}
			disabled={busy}
			onclick={() => act(() => signIn(backend))}
		>
			{busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
		</Button>
	{/if}
	<details>
		<summary>Use a code instead</summary>
		<form onsubmit={useCode}>
			<TextField label="Your name" autocomplete="username" bind:value={name} required />
			<TextField
				label="Code from your app"
				inputmode="numeric"
				autocomplete="one-time-code"
				bind:value={code}
				required
			/>
			<Button variant="primary" type="submit" disabled={busy}>Sign in with a code</Button>
		</form>
	</details>
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
