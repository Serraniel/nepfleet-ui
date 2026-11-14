<script lang="ts">
	import {
		type Backend,
		ConflictError,
		VerifyFirstError,
		fetchSecretKeys,
		secretKeyPattern,
		setSecret
	} from '#lib/backend.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import Button from '#lib/ui/Button.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	type Props = {
		backend: Backend;
		token: string;
		/** The stack, or '' for the fleet-wide secrets. */
		stack: string;
	};
	let { backend, token, stack }: Props = $props();

	let keys = $state<string[] | null>(null);
	let loadError = $state('');
	let key = $state('');
	let value = $state('');
	let busy = $state(false);
	let error = $state('');
	let done = $state('');

	const keyError = $derived(
		key !== '' && !secretKeyPattern.test(key)
			? 'Letters, digits and _, not starting with a digit'
			: ''
	);

	async function load() {
		loadError = '';
		try {
			keys = await fetchSecretKeys(backend, token, stack);
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void load();
	});

	async function change(k: string, v: string | null) {
		busy = true;
		error = '';
		done = '';
		const send = () => setSecret(backend, token, stack, k, v);
		try {
			let commit: string;
			try {
				commit = await send();
			} catch (e) {
				if (!(e instanceof VerifyFirstError)) throw e;
				await verifyIdentity(backend);
				commit = await send();
			}
			done =
				v === null
					? `Removed ${k} in ${commit.slice(0, 7)}.`
					: `Saved ${k}, encrypted, in ${commit.slice(0, 7)}.`;
			if (v !== null) {
				key = '';
				value = '';
			}
			await load();
		} catch (e) {
			error =
				e instanceof ConflictError
					? `${e.message}. Try again in a moment.`
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			busy = false;
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!key || keyError || busy) return;
		void change(key, value);
	}
</script>

<section aria-labelledby="secrets-h-{stack}">
	<h2 id="secrets-h-{stack}">{stack === '' ? 'Fleet-wide secrets' : 'Secrets'}</h2>
	<p class="muted">
		Stored encrypted in the fleet repository, in a commit in your name. Values can be replaced or
		removed, but never shown again.{#if stack !== ''}
			Changing one doesn't apply: apply the stack afterwards.{/if}
	</p>
	{#if loadError}
		<p class="error" role="alert">{loadError}</p>
	{:else if keys === null}
		<p class="muted">Loading…</p>
	{:else if keys.length === 0}
		<p class="muted">No secrets yet.</p>
	{:else}
		<ul class="keys">
			{#each keys as k (k)}
				<li>
					<code>{k}</code>
					<Button variant="ghost" disabled={busy} onclick={() => (key = k)}>Replace…</Button>
					<Button variant="ghost" disabled={busy} onclick={() => change(k, null)}>Remove</Button>
				</li>
			{/each}
		</ul>
	{/if}
	<form onsubmit={submit}>
		<TextField
			label="Key"
			bind:value={key}
			error={keyError}
			autocomplete="off"
			spellcheck="false"
		/>
		<TextField
			label="Value"
			type="password"
			bind:value
			autocomplete="new-password"
			hint={keys?.includes(key) ? `Replaces the stored ${key}` : undefined}
		/>
		<Button type="submit" disabled={busy || !key || !!keyError}>Save secret</Button>
	</form>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if done}<p class="muted" role="status">{done}</p>{/if}
</section>

<style>
	.keys {
		list-style: none;
		padding: 0;
	}
	.keys li {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.15rem 0;
	}
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-end;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
