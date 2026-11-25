<script lang="ts">
	import Spinner from '#lib/ui/Spinner.svelte';
	import {
		type Backend,
		type SignOnSettings,
		ConflictError,
		VerifyFirstError,
		fetchSignOn,
		saveSignOn
	} from '#lib/backend.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import Button from '#lib/ui/Button.svelte';

	/**
	 * The fleet's sign-on: which Pocket ID stack signs users in to the apps,
	 * and which stacks use it. Picking a provider is a commit to fleet.yaml;
	 * stacks that support sign-on use it on their next apply.
	 */
	type Props = { backend: Backend; token: string; backendId: string };
	let { backend, token, backendId }: Props = $props();
	const uid = $props.id();

	let s = $state<SignOnSettings | null | undefined>(undefined);
	let loadError = $state('');
	let pick = $state('');
	let busy = $state(false);
	let confirmRemove = $state(false);
	let result = $state<{ ok: boolean; text: string } | null>(null);

	async function load() {
		loadError = '';
		try {
			s = await fetchSignOn(backend, token);
			pick = s?.candidates[0] ?? '';
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void load();
	});

	const byMode = $derived.by(() => {
		const out = { integrated: [] as string[], custom: [] as string[], none: [] as string[] };
		for (const st of s?.stacks ?? []) out[st.mode]?.push(st.name);
		return out;
	});

	async function change(provider: string | null) {
		busy = true;
		result = null;
		try {
			let commit: string;
			try {
				commit = await saveSignOn(backend, token, provider);
			} catch (e) {
				if (!(e instanceof VerifyFirstError)) throw e;
				await verifyIdentity(backend);
				commit = await saveSignOn(backend, token, provider);
			}
			result = {
				ok: true,
				text:
					provider === null
						? `Removed in ${commit.slice(0, 7)}. Its clients stay in the provider: delete them there.`
						: `Saved in ${commit.slice(0, 7)}. Stacks that support sign-on use it on their next apply.`
			};
			await load();
		} catch (e) {
			result = {
				ok: false,
				text:
					e instanceof ConflictError
						? `${e.message}. Try again in a moment.`
						: e instanceof Error
							? e.message
							: String(e)
			};
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!confirmRemove) {
			confirmRemove = true; // a second click removes it
			return;
		}
		confirmRemove = false;
		await change(null);
	}

	const stackHref = (name: string) =>
		`/stacks/${encodeURIComponent(backendId)}/${encodeURIComponent(name)}`;
	const createHref = $derived(
		`/templates?backend=${encodeURIComponent(backendId)}&template=${encodeURIComponent(s?.kinds[0] ?? 'pocket-id')}`
	);
</script>

{#snippet stackList(names: string[])}
	{#each names as n, i (n)}{i > 0 ? ', ' : ''}<a href={stackHref(n)}>{n}</a>{/each}
{/snippet}

<div class="card" role="group" aria-label="Sign-on">
	<h3>Sign-on</h3>
	<p class="muted">
		One account for every app: a Pocket ID stack in the fleet signs users in, and NepFleet registers
		each app with it. Apps whose template supports it use it unless their stack says otherwise.
	</p>
	{#if loadError}
		<p class="error" role="alert">{loadError}</p>
	{:else if s === undefined}
		<p><Spinner label="Loading sign-on…" /></p>
	{:else if s === null}
		<p class="muted">This backend's NepFleet is too old for sign-on.</p>
	{:else}
		{#if s.provider}
			<p role="status">Users sign in through <a href={stackHref(s.provider)}>{s.provider}</a>.</p>
		{:else}
			<p role="status">No provider: apps use their own accounts.</p>
		{/if}
		{#if s.stacks.length}
			<ul class="modes">
				{#if byMode.integrated.length}<li>
						Integrated: {@render stackList(byMode.integrated)}
					</li>{/if}
				{#if byMode.custom.length}<li>Own provider: {@render stackList(byMode.custom)}</li>{/if}
				{#if byMode.none.length}<li>Own accounts: {@render stackList(byMode.none)}</li>{/if}
			</ul>
		{/if}
		{#if !s.provider}
			{#if s.candidates.length}
				<form
					class="pick"
					onsubmit={(e) => {
						e.preventDefault();
						if (pick) void change(pick);
					}}
				>
					<div class="select">
						<label for="signon-provider-{uid}">Provider</label>
						<select id="signon-provider-{uid}" bind:value={pick}>
							{#each s.candidates as c (c)}<option value={c}>{c}</option>{/each}
						</select>
					</div>
					<Button type="submit" variant="primary" {busy} disabled={!pick}>Use for sign-on</Button>
				</form>
			{:else}
				<p class="links"><a href={createHref}>Create a Pocket ID stack…</a></p>
				<p class="muted">Apply it, then come back here to use it.</p>
			{/if}
		{:else}
			<p class="links">
				<Button variant={confirmRemove ? 'danger' : 'ghost'} {busy} onclick={remove}>
					{confirmRemove ? 'Stop for good' : 'Stop using it…'}
				</Button>
			</p>
			{#if confirmRemove}
				<p class="muted">
					Apps that use it by default go back to their own accounts on their next apply.
				</p>
			{/if}
		{/if}
		{#if result}<p
				class:error={!result.ok}
				class:muted={result.ok}
				role={result.ok ? 'status' : 'alert'}
			>
				{result.text}
			</p>{/if}
	{/if}
</div>

<style>
	.card {
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
	}
	.card h3,
	.card p {
		margin: 0 0 0.25rem;
	}
	.modes {
		margin: 0.25rem 0;
		padding-left: 1.2rem;
	}
	.pick {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: end;
		margin: 0.5rem 0;
	}
	.select {
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
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
