<script lang="ts">
	import {
		type Backend,
		type SignOnMode,
		type StackSignOn,
		ConflictError,
		VerifyFirstError,
		fetchStackSignOn,
		saveStackSignOn,
		setSecret
	} from '#lib/backend.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import { defaultSignOn, issuerError, signOnLabels } from '#lib/signon.ts';
	import Button from '#lib/ui/Button.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	/**
	 * How a stack's users sign in: through the fleet's provider (integrated),
	 * a provider of your own (custom), or the app's own accounts. Shown for
	 * stacks whose template supports sign-on. mode is the one in effect, for
	 * the page to hide the inputs NepFleet fills.
	 */
	type Props = {
		backend: Backend;
		token: string;
		stack: string;
		mode?: SignOnMode;
		/** After a save: the plan changed. */
		onSaved?: () => void;
	};
	let { backend, token, stack, mode = $bindable(), onSaved }: Props = $props();
	const uid = $props.id();

	const SECRET = 'NEPFLEET_OIDC_CLIENT_SECRET';

	let s = $state<StackSignOn | null>(null);
	let chosen = $state<SignOnMode>('none');
	let issuer = $state('');
	let clientID = $state('');
	// Write-only: never filled from the backend.
	let secret = $state('');
	let busy = $state(false);
	let error = $state('');
	let done = $state('');

	async function load() {
		try {
			s = await fetchStackSignOn(backend, token, stack);
		} catch {
			s = null; // an older backend, or a read error: the inputs stay as they are
		}
		if (s) {
			chosen = s.mode;
			issuer = s.issuer ?? '';
			clientID = s.clientID ?? '';
		}
		mode = s?.mode;
	}

	$effect(() => {
		void load();
	});

	const fallback = $derived(s ? defaultSignOn(!!s.provider, s.supported) : 'none');
	const issuerErr = $derived(chosen === 'custom' && issuer ? issuerError(issuer) : '');
	const needsSecret = $derived(chosen === 'custom' && !s?.secretSet && !secret);
	const dirty = $derived(
		!!s &&
			(chosen !== s.mode ||
				(chosen === 'custom' &&
					(issuer !== (s.issuer ?? '') || clientID !== (s.clientID ?? '') || secret !== '')))
	);
	const valid = $derived(
		chosen !== 'custom' || (!!issuer.trim() && !issuerErr && !!clientID.trim() && !needsSecret)
	);

	async function withVerify<T>(change: () => Promise<T>): Promise<T> {
		try {
			return await change();
		} catch (e) {
			if (!(e instanceof VerifyFirstError)) throw e;
			await verifyIdentity(backend);
			return await change();
		}
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!s || busy || !dirty || !valid) return;
		busy = true;
		error = '';
		done = '';
		try {
			// The secret first: a custom stack doesn't plan without it.
			if (chosen === 'custom' && secret) {
				const value = secret;
				await withVerify(() => setSecret(backend, token, stack, SECRET, value));
				secret = '';
			}
			// The default stays unwritten, so it follows the fleet's provider.
			const update =
				chosen === 'custom'
					? { mode: chosen, issuer: issuer.trim(), clientID: clientID.trim() }
					: { mode: chosen === fallback ? ('' as const) : chosen };
			const commit = await withVerify(() => saveStackSignOn(backend, token, stack, update));
			done = `Saved in ${commit.slice(0, 7)}. A stack that applies by itself does so now; otherwise apply it below.`;
			await load();
			onSaved?.();
		} catch (err) {
			error =
				err instanceof ConflictError
					? `${err.message}. Try again in a moment.`
					: err instanceof Error
						? err.message
						: String(err);
		} finally {
			busy = false;
		}
	}

	const options = $derived(
		(['integrated', 'custom', 'none'] as SignOnMode[]).filter(
			(m) => m !== 'integrated' || !!s?.provider || s?.mode === 'integrated'
		)
	);
</script>

{#if s && (s.supported || s.set)}
	<section aria-labelledby="signon-h-{uid}">
		<h2 id="signon-h-{uid}">Sign-on</h2>
		<form onsubmit={save}>
			<div class="field">
				<label for="signon-mode-{uid}">How users sign in</label>
				<select id="signon-mode-{uid}" bind:value={chosen} aria-describedby="signon-hint-{uid}">
					{#each options as m (m)}
						<option value={m}>{signOnLabels[m]}{m === fallback ? ' (default)' : ''}</option>
					{/each}
				</select>
				<small id="signon-hint-{uid}">
					{#if chosen === 'integrated'}
						NepFleet registers the app in {s.provider || 'the fleet’s provider'} and fills its OpenID
						Connect settings.
					{:else if chosen === 'custom'}
						Register the app at your provider with the callback its template names, then enter what
						it gave you.
					{:else if s.provider}
						Users sign in with the app's own accounts, not through {s.provider}.
					{:else}
						Users sign in with the app's own accounts. Set up a provider under <a href="/features">
							Features
						</a> to sign in to every app with one account.
					{/if}
				</small>
			</div>
			{#if chosen === 'custom'}
				<TextField
					label="Issuer"
					bind:value={issuer}
					placeholder="https://login.example.org"
					autocomplete="off"
					spellcheck="false"
					error={issuerErr}
				/>
				<TextField label="Client ID" bind:value={clientID} autocomplete="off" spellcheck="false" />
				<TextField
					label="Client secret"
					type="password"
					bind:value={secret}
					autocomplete="new-password"
					hint={s.secretSet
						? 'Stored encrypted. Leave empty to keep it.'
						: 'Stored encrypted, never shown again.'}
				/>
			{/if}
			<div>
				<Button type="submit" {busy} disabled={!dirty || !valid}>
					{busy ? 'Saving…' : 'Save sign-on'}
				</Button>
			</div>
		</form>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if done}<p role="status">{done}</p>{/if}
	</section>
{/if}

<style>
	form {
		display: grid;
		gap: 0.8rem;
		max-width: 40rem;
	}
	.field {
		display: grid;
		gap: 0.25rem;
	}
	select {
		font: inherit;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: inherit;
	}
	small {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
