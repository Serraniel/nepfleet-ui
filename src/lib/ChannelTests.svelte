<script lang="ts">
	import Spinner from '#lib/ui/Spinner.svelte';
	import { fetchChannels, setChannel, testChannel } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import ChannelAdd from '#lib/ChannelAdd.svelte';

	let byBackend = $state<Record<string, string[] | null | { error: string }>>({});
	let result = $state<Record<string, { ok: boolean; text: string }>>({});
	let sending = $state<Record<string, boolean>>({});

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));

	// Backends connect after the page opens (the control daemon's machines
	// arrive later): load each once it's there.
	const asked = new Set<string>();
	$effect(() => {
		for (const b of connected) {
			if (asked.has(b.id)) continue;
			asked.add(b.id);
			load(b.id);
		}
	});

	function load(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		fetchChannels(b, token).then(
			(cs) => (byBackend[id] = cs),
			(e: unknown) => (byBackend[id] = { error: e instanceof Error ? e.message : String(e) })
		);
	}

	const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
	let removing = $state<Record<string, boolean>>({});
	let confirmRemove = $state('');

	async function add(id: string, name: string, url: string, min: 'info' | 'warning' | 'error') {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token || !NAME_RE.test(name))
			throw new Error('A name is 1 to 64 letters, digits, dots, dashes or underscores.');
		await setChannel(b, token, name, url, min);
		load(id);
	}

	async function remove(id: string, channel: string) {
		const k = `${id}/${channel}`;
		if (confirmRemove !== k) {
			confirmRemove = k; // a second click removes it
			return;
		}
		confirmRemove = '';
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		removing[k] = true;
		try {
			await setChannel(b, token, channel, null);
			delete result[k];
			load(id);
		} catch (e) {
			result[k] = { ok: false, text: e instanceof Error ? e.message : String(e) };
		} finally {
			removing[k] = false;
		}
	}

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
			Where each backend sends its notifications, its own and those of stacks that alert through it
			(Uptime Kuma, Dozzle, neptide, Watchtower, volume backups). Set them up once here; send a test
			message to check one.
		</p>
		{#each connected as b (b.id)}
			{@const cs = byBackend[b.id]}
			<h3>{b.label ?? new URL(b.url).host}</h3>
			{#if cs === undefined}
				<p><Spinner label="Loading…" /></p>
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
							<Button busy={sending[`${b.id}/${c}`]} onclick={() => test(b.id, c)}>Send test</Button
							>
							<Button
								variant={confirmRemove === `${b.id}/${c}` ? 'danger' : 'ghost'}
								busy={removing[`${b.id}/${c}`]}
								onclick={() => remove(b.id, c)}
								>{confirmRemove === `${b.id}/${c}` ? 'Remove for good' : 'Remove…'}</Button
							>
							{#if r}<span class:error={!r.ok} class:muted={r.ok} role="status">{r.text}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if cs !== undefined && cs !== null && !('error' in cs)}
				<ChannelAdd label={b.label ?? b.url} save={(name, url, min) => add(b.id, name, url, min)} />
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
