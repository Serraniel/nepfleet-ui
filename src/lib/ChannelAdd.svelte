<script lang="ts">
	import Button from '#lib/ui/Button.svelte';

	type Severity = 'info' | 'warning' | 'error';
	let {
		label,
		save
	}: {
		/** Names the backend, for the form's accessible name. */
		label: string;
		/** Stores the channel; throws with the reason. */
		save: (name: string, url: string, min: Severity) => Promise<void>;
	} = $props();

	// The URL holds tokens: a password field, cleared once saved, kept nowhere else.
	let name = $state('');
	let url = $state('');
	let min = $state<Severity>('warning');
	let saving = $state(false);
	let error = $state('');
	const NAME = /^[A-Za-z0-9_.-]{1,64}$/;

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		error = '';
		try {
			await save(name.trim(), url.trim(), min);
			name = '';
			url = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}
</script>

<form class="add" onsubmit={submit} aria-label="Add a channel to {label}">
	<label>
		Name
		<input bind:value={name} placeholder="phone" required />
	</label>
	<label class="url">
		URL
		<input
			bind:value={url}
			type="password"
			autocomplete="off"
			placeholder="ntfy://ntfy.sh/my-topic"
			required
		/>
	</label>
	<label>
		Send
		<select bind:value={min}>
			<option value="info">everything</option>
			<option value="warning">warnings and errors</option>
			<option value="error">errors only</option>
		</select>
	</label>
	<Button type="submit" busy={saving} disabled={!NAME.test(name.trim()) || !url.trim()}>
		Add channel
	</Button>
</form>
<p class="muted hint">
	A shoutrrr URL: ntfy, Discord, Telegram, Slack, e-mail and more. It's stored encrypted in the
	fleet repository, and the backend commits the change.
</p>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: end;
		margin-top: 0.75rem;
	}
	.add label {
		display: grid;
		gap: 0.2rem;
	}
	.url {
		flex: 1 1 16rem;
	}
	.hint {
		margin-top: 0.25rem;
	}
	.error {
		color: var(--err);
	}
</style>
