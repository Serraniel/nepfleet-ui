<script lang="ts">
	// Unlocking SSH keys with a passphrase: the daemon's ssh runs without a
	// terminal, so it asks here, then runs what needed the key again.
	import { local } from '#lib/local.svelte.ts';
	import { WrongPassphraseError, unlockKey } from '#lib/local.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';

	let {
		open = $bindable(false),
		keys,
		retry = null
	}: {
		open?: boolean;
		/** The keys the machine would take; the first is asked for. */
		keys: string[];
		/** Runs what needed the key again; without it, the daemon is read again. */
		retry?: (() => Promise<void>) | null;
	} = $props();

	let passphrase = $state('');
	let unlockError = $state('');
	let unlocking = $state(false);
	$effect(() => {
		if (!open) {
			passphrase = '';
			unlockError = '';
		}
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const key = keys[0];
		if (!key || !passphrase) return;
		const given = passphrase;
		passphrase = '';
		unlocking = true;
		unlockError = '';
		try {
			await unlockKey(local.url, local.token, key, given);
			// One key is usually enough: try again with it. Only if the machine
			// still refuses does the next refusal name the remaining keys (those
			// already unlocked aren't listed again), and this asks for them.
			open = false;
			if (retry) await retry();
			else await local.refresh();
		} catch (e) {
			unlockError =
				e instanceof WrongPassphraseError
					? "That passphrase doesn't unlock the key; try again."
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			unlocking = false;
		}
	}
</script>

<Dialog bind:open title="Unlock your SSH key">
	<form id="unlock-form" onsubmit={submit}>
		<p>
			<code>{keys[0]}</code> has a passphrase. NepFleet's SSH runs in the background, without a
			terminal to ask on, so it keeps the key unlocked in an SSH agent for 8 hours.
			{#if keys.length > 1}If the machine doesn't take this key, NepFleet asks for the next one ({keys
					.slice(1)
					.join(', ')}).{/if}
		</p>
		<label class="password">
			Passphrase
			<input
				type="password"
				autocomplete="off"
				spellcheck="false"
				bind:value={passphrase}
				disabled={unlocking}
			/>
			<span class="muted">
				Sent to the NepFleet daemon on this computer only, and kept nowhere.
			</span>
		</label>
		{#if unlockError}<p class="error" role="alert">{unlockError}</p>{/if}
	</form>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="unlock-form"
			busy={unlocking}
			disabled={!passphrase}
		>
			{unlocking ? 'Unlocking…' : 'Unlock'}
		</Button>
	{/snippet}
</Dialog>

<style>
	.password {
		display: grid;
		gap: 0.3rem;
		margin-top: 0.75rem;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
