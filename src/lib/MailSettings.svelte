<script lang="ts">
	import { backends } from '#lib/backends.svelte.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import MailForm from '#lib/MailForm.svelte';

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));
</script>

{#if connected.length}
	<section aria-labelledby="mail-h">
		<h2 id="mail-h">Mail</h2>
		<p class="muted">
			The SMTP server apps send mail through: password resets, invites, alerts. Set it once per
			fleet; templates use it unless a stack sets its own. The password is stored encrypted in the
			fleet repository and never shown again. Save, then send a test mail to check it.
		</p>
		{#each connected as b (b.id)}
			<h3>{b.label ?? new URL(b.url).host}</h3>
			<MailForm backend={b} token={tokens.byBackend[b.id] ?? ''} label={b.label ?? b.url} />
		{/each}
	</section>
{/if}

<style>
	.muted {
		color: var(--muted);
	}
</style>
