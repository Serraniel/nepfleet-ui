<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchChannels, testChannel } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';

	let byBackend = $state<Record<string, string[] | null | { error: string }>>({});
	let result = $state<Record<string, { ok: boolean; text: string }>>({});
	let sending = $state<Record<string, boolean>>({});

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));

	onMount(() => {
		for (const b of connected) {
			const token = tokens.byBackend[b.id];
			if (!token) continue;
			fetchChannels(b, token).then(
				(cs) => (byBackend[b.id] = cs),
				(e: unknown) => (byBackend[b.id] = { error: e instanceof Error ? e.message : String(e) })
			);
		}
	});

	async function test(id: string, channel: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		const k = `${id}/${channel}`;
		sending[k] = true;
		try {
			await testChannel(b, token, channel);
			result[k] = { ok: true, text: 'Sent. Check that it arrived.' };
		} catch (e) {
			result[k] = { ok: false, text: e instanceof Error ? e.message : String(e) };
		} finally {
			sending[k] = false;
		}
	}
</script>

{#if connected.length}
	<section aria-labelledby="channels-h">
		<h2 id="channels-h">Notification channels</h2>
		<p class="muted">
			Where each backend sends its notifications (fleet.yaml). Send a test message to check one.
		</p>
		{#each connected as b (b.id)}
			{@const cs = byBackend[b.id]}
			<h3>{b.label ?? new URL(b.url).host}</h3>
			{#if cs === undefined}
				<p class="muted">Loading…</p>
			{:else if cs === null}
				<p class="muted">This backend's NepFleet is too old to list channels.</p>
			{:else if 'error' in cs}
				<p class="error">{cs.error}</p>
			{:else if cs.length === 0}
				<p class="muted">No channels in fleet.yaml yet.</p>
			{:else}
				<ul class="channels">
					{#each cs as c (c)}
						{@const r = result[`${b.id}/${c}`]}
						<li>
							<code>{c}</code>
							<Button
								variant="ghost"
								disabled={sending[`${b.id}/${c}`]}
								onclick={() => test(b.id, c)}>Send test</Button
							>
							{#if r}<span class:error={!r.ok} class:muted={r.ok} role="status">{r.text}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/each}
	</section>
{/if}

<style>
	.channels {
		list-style: none;
		padding: 0;
	}
	.channels li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.15rem 0;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
