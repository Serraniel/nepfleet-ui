<script lang="ts">
	import { type Backend, letCaddyKeepDNS } from '#lib/backend.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = { backend: Backend; token: string; domain: string };
	let { backend, token, domain }: Props = $props();

	// The zone the DNS provider holds: most often the domain's last two labels.
	let zone = $state('');
	$effect.pre(() => {
		if (!zone) zone = domain.split('.').slice(-2).join('.');
	});
	let busy = $state(false);
	let error = $state('');
	let done = $state<{ stack: string } | null>(null);

	async function turnOn() {
		busy = true;
		error = '';
		try {
			done = await letCaddyKeepDNS(backend, token, zone);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="dns-fix">
	{#if done}
		<p role="status">
			Caddy's DNS records are turned on in its stack, as a commit. Apply it from
			<a href="/stacks/{encodeURIComponent(backend.id)}/{encodeURIComponent(done.stack)}">
				{done.stack}'s page
			</a>: its pending changes show what changes. Caddy then creates the records within about five
			minutes, for this site and every site it serves later.
		</p>
	{:else}
		<p>
			Caddy has the DNS provider's token, so it can create these records itself, and keep them
			pointed at this host, for every site it serves.
		</p>
		<div class="row">
			<label>
				DNS zone
				<input bind:value={zone} spellcheck="false" autocomplete="off" />
			</label>
			<Button onclick={turnOn} {busy} disabled={!zone.trim()}>
				Let Caddy create the DNS records…
			</Button>
		</div>
		<p class="muted small">
			The zone is the domain the provider holds (e.g. example.org for status.vps.example.org). This
			commits the setting to Caddy's stack; nothing changes until you apply it.
		</p>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.dns-fix p {
		margin: 0.25rem 0;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem;
	}
	label {
		display: grid;
		gap: 0.15rem;
		font-size: 0.9rem;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: 0.85rem;
	}
	.error {
		color: var(--err);
	}
</style>
