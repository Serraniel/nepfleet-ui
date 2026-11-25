<script lang="ts">
	import { type Backend, SESSION, VerifyFirstError, backupKey } from '#lib/backend.ts';
	import { saveBlob } from '#lib/download.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = { backend: Backend; token: string };
	let { backend, token }: Props = $props();

	let keys = $state('');
	let busy = $state(false);
	let error = $state('');
	let done = $state(false);

	const recipients = $derived(
		keys
			.split('\n')
			.map((k) => k.trim())
			.filter(Boolean)
	);
	const shapeOK = $derived(
		recipients.length > 0 &&
			recipients.every((r) => /^(age1[0-9a-z]{58}|ssh-(ed25519|rsa) AAAA\S+( .*)?)$/.test(r))
	);

	async function download() {
		busy = true;
		error = '';
		done = false;
		const send = () => backupKey(backend, token, recipients);
		try {
			let blob: Blob;
			try {
				blob = await send();
			} catch (e) {
				if (!(e instanceof VerifyFirstError)) throw e;
				await verifyIdentity(backend);
				blob = await send();
			}
			saveBlob('nepfleet-age-key.age', blob);
			done = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<h3>Age key backup</h3>
<p class="muted">
	The backend's age key opens every secret of the fleet: without it, they're lost with the host.
	Download it encrypted to your own public key (an age key, or the SSH key you already use) and keep
	the file somewhere else. Restore with <code>age -d -i ~/.ssh/id_ed25519</code> (or your age identity).
	Only a person signed in can do this, and the fleet's notification channels hear of it.
</p>
{#if token !== SESSION}
	<p class="muted">
		The backend gives its key only to a person signed in with a passkey, never to an API token, so
		it can't be done through this connection. Sign in to the backend on the Stacks page (or its web
		UI), or run <code>nepfleet key backup --out FILE</code> on the host.
	</p>
{:else}
	<label class="keys">
		Public keys, one per line
		<textarea
			bind:value={keys}
			rows="3"
			spellcheck="false"
			placeholder="ssh-ed25519 AAAA… you@laptop"></textarea>
	</label>
	<Button disabled={busy || !shapeOK} onclick={download}>Download encrypted key</Button>
	{#if done}<p role="status">
			Downloaded <code>nepfleet-age-key.age</code>. Move it off this computer's downloads folder to
			where you keep backups.
		</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}

<style>
	.keys {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}
	textarea {
		font-family: var(--mono, monospace);
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
