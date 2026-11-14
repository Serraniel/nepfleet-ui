<script lang="ts">
	import { onMount } from 'svelte';
	import {
		type TokenInfo,
		VerifyFirstError,
		createToken,
		fetchTokens,
		revokeToken
	} from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { STACK_NAME } from '#lib/inputs.ts';
	import { local } from '#lib/local.svelte.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import People from '#lib/People.svelte';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	type Load =
		{ state: 'loading' } | { state: 'ok'; value: TokenInfo[] } | { state: 'error'; error: string };

	const scopes: { value: TokenInfo['scope']; what: string }[] = [
		{ value: 'read', what: 'read: see stacks, plans and history' },
		{ value: 'apply', what: 'apply: also apply and roll back' },
		{ value: 'edit', what: 'edit: also change stack files and secrets' },
		{ value: 'admin', what: 'admin: everything, including tokens' },
		{ value: 'notify', what: 'notify: only send alerts (e.g. from Dozzle)' }
	];

	let byBackend = $state<Record<string, Load>>({});
	let backendId = $state('');
	let name = $state('');
	let scope = $state<TokenInfo['scope']>('read');
	let stackList = $state('');
	let days = $state('90');
	let busy = $state(false);
	let error = $state('');
	// The new token's secret: shown once, kept only here until Done.
	let created = $state<{ name: string; secret: string } | null>(null);
	let copied = $state(false);

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));
	const stacks = $derived(
		stackList
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	);
	const stacksError = $derived(
		stacks.some((s) => !STACK_NAME.test(s))
			? 'Stack names, separated by commas'
			: stacks.length > 0 && (scope === 'admin' || scope === 'notify')
				? `A ${scope} token can't be limited to stacks`
				: ''
	);
	const daysError = $derived(/^\d+$/.test(days) && +days >= 1 && +days <= 3650 ? '' : '1 to 3650');

	async function load(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		if (!byBackend[id]) byBackend[id] = { state: 'loading' };
		try {
			byBackend[id] = { state: 'ok', value: await fetchTokens(b, token) };
		} catch (e) {
			byBackend[id] = { state: 'error', error: e instanceof Error ? e.message : String(e) };
		}
	}

	onMount(() => {
		void local.refresh().then(() => {
			if (!backendId && connected[0]) backendId = connected[0].id;
			for (const b of connected) void load(b.id);
		});
	});

	async function withVerify<T>(id: string, send: () => Promise<T>): Promise<T> {
		try {
			return await send();
		} catch (e) {
			const b = backends.list.find((x) => x.id === id);
			if (!(e instanceof VerifyFirstError) || !b) throw e;
			await verifyIdentity(b);
			return await send();
		}
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		const b = backends.list.find((x) => x.id === backendId);
		const token = tokens.byBackend[backendId];
		if (!b || !token || !name.trim() || stacksError || daysError) return;
		busy = true;
		error = '';
		try {
			const req = { name: name.trim(), scope, days: +days, ...(stacks.length ? { stacks } : {}) };
			const res = await withVerify(backendId, () => createToken(b, token, req));
			created = { name: res.token.name, secret: res.secret };
			copied = false;
			name = '';
			stackList = '';
			await load(backendId);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function revoke(id: string, t: TokenInfo) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		busy = true;
		error = '';
		try {
			await withVerify(id, () => revokeToken(b, token, t.id));
			await load(id);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function copy() {
		if (!created) return;
		await navigator.clipboard.writeText(created.secret);
		copied = true;
	}

	const date = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
</script>

<header>
	<h1>Access</h1>
	<p>
		Who may sign in, and API tokens for tools and scripts, per backend: what each may do, on which
		stacks, until when. Managing them needs an admin token or a sign-in, and a passkey confirmation.
	</p>
</header>

{#if connected.length === 0}
	<EmptyState title="No backend with a token">
		Add an API token for a backend on the <a href="/stacks">Stacks</a> page.
	</EmptyState>
{:else}
	{#if created}
		<section class="created" aria-labelledby="created-h">
			<h2 id="created-h">Token {created.name} created</h2>
			<p>Copy it now: it is shown only this once.</p>
			<TextField label="Token" value={created.secret} readonly hideLabel />
			<Button onclick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
			<Button variant="ghost" onclick={() => (created = null)}>Done</Button>
		</section>
	{/if}

	<section aria-labelledby="new-h">
		<h2 id="new-h">New token</h2>
		<form onsubmit={create}>
			{#if connected.length > 1}
				<label
					>Backend
					<select bind:value={backendId}>
						{#each connected as b (b.id)}<option value={b.id}
								>{b.label ?? new URL(b.url).host}</option
							>{/each}
					</select>
				</label>
			{/if}
			<TextField label="Name" bind:value={name} hint="What it's for, e.g. ci" maxlength={64} />
			<label
				>Scope
				<select bind:value={scope}>
					{#each scopes as s (s.value)}<option value={s.value}>{s.what}</option>{/each}
				</select>
			</label>
			<TextField
				label="Only these stacks"
				bind:value={stackList}
				hint="Empty: all stacks"
				error={stacksError}
			/>
			<TextField label="Days valid" bind:value={days} inputmode="numeric" error={daysError} />
			<Button
				type="submit"
				variant="primary"
				disabled={busy || !name.trim() || !!stacksError || !!daysError}>Create token</Button
			>
		</form>
	</section>
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#each connected as b (b.id)}
		{@const st = byBackend[b.id]}
		<section aria-label={b.label ?? b.url}>
			<h2>{b.label ?? new URL(b.url).host}</h2>
			{#if !st || st.state === 'loading'}
				<p class="muted">Loading…</p>
			{:else if st.state === 'error'}
				<p class="error" role="alert">{st.error}</p>
			{:else if st.value.length === 0}
				<p class="muted">No tokens.</p>
			{:else}
				<table>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Scope</th>
							<th scope="col">Stacks</th>
							<th scope="col">Expires</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each st.value as t (t.id)}
							<tr class:expired={t.expired}>
								<th scope="row">{t.name} <code class="muted">{t.id}</code></th>
								<td>{t.scope}</td>
								<td>{t.stacks?.length ? t.stacks.join(', ') : 'all'}</td>
								<td>{t.expired ? 'expired' : date(t.expires)}</td>
								<td
									><Button variant="danger" disabled={busy} onclick={() => revoke(b.id, t)}
										>Revoke</Button
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			{#if tokens.byBackend[b.id]}<People backend={b} token={tokens.byBackend[b.id] ?? ''} />{/if}
		</section>
	{/each}
{/if}

<style>
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-end;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		text-align: left;
		padding: 0.35rem 0.75rem 0.35rem 0;
	}
	tbody tr {
		border-top: 1px solid var(--border);
	}
	tr.expired {
		color: var(--muted);
	}
	.created {
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
