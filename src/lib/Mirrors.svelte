<script lang="ts">
	import Spinner from '#lib/ui/Spinner.svelte';
	import {
		type Backend,
		type MirrorStatus,
		VerifyFirstError,
		addMirror,
		fetchMirrors,
		mirrorNow,
		mirrorURLKind,
		removeMirror
	} from '#lib/backend.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	/**
	 * adding: the add form is open (Health opens it from the mirror warning).
	 * onchange: a mirror was added, removed or pushed to.
	 */
	type Props = { backend: Backend; token: string; adding?: boolean; onchange?: () => void };
	let { backend, token, adding = $bindable(false), onchange }: Props = $props();

	let mirrors = $state<MirrorStatus[] | null | undefined>(undefined);
	let error = $state('');
	let busy = $state(false);

	let url = $state('');
	let httpToken = $state('');
	let user = $state('');
	let saving = $state(false);
	let addError = $state('');
	// The mirror just added: its deploy key stays in view until it's pushed to.
	let fresh = $state<MirrorStatus | null>(null);
	let copied = $state('');

	const kind = $derived(mirrorURLKind(url));
	const kindError = $derived(typeof kind === 'object' ? kind.error : '');

	$effect(() => {
		fetchMirrors(backend, token).then(
			(m) => (mirrors = m),
			(e: unknown) => (error = e instanceof Error ? e.message : String(e))
		);
	});

	// A person confirms with a passkey once, then the request goes again.
	async function verified<T>(send: () => Promise<T>): Promise<T> {
		try {
			return await send();
		} catch (e) {
			if (!(e instanceof VerifyFirstError)) throw e;
			await verifyIdentity(backend);
			return send();
		}
	}

	async function push() {
		busy = true;
		error = '';
		try {
			mirrors = await mirrorNow(backend, token);
			const f = fresh && mirrors.find((m) => m.id === fresh?.id);
			if (f?.ok && !f.error) fresh = null;
			onchange?.();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function add() {
		if (typeof kind === 'object') return;
		saving = true;
		addError = '';
		try {
			const req = {
				url: url.trim(),
				...(kind === 'https' && httpToken
					? { token: httpToken, user: user.trim() || undefined }
					: {})
			};
			const { mirror } = await verified(() => addMirror(backend, token, req));
			url = httpToken = user = '';
			adding = false;
			mirrors = [...(mirrors ?? []), mirror];
			if (mirror.auth === 'deploy-key') {
				// The forge needs the key before the first push can work.
				fresh = mirror;
				onchange?.();
			} else {
				await push();
			}
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	let removing = $state<MirrorStatus | null>(null);
	let removeOpen = $state(false);

	async function remove(m: MirrorStatus) {
		if (!m.id) return;
		removeOpen = false;
		error = '';
		try {
			await verified(() => removeMirror(backend, token, m.id ?? ''));
			mirrors = (mirrors ?? []).filter((x) => x.id !== m.id);
			if (fresh?.id === m.id) fresh = null;
			onchange?.();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function copy(key: string) {
		await navigator.clipboard.writeText(key);
		copied = key;
	}

	const when = (iso?: string) =>
		iso && !iso.startsWith('0001')
			? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
			: 'never';
</script>

{#snippet deployKey(key: string)}
	<div class="key">
		<code>{key}</code>
		<Button onclick={() => copy(key)}>{copied === key ? 'Copied' : 'Copy'}</Button>
	</div>
{/snippet}

<h3>Repository mirrors</h3>
{#if mirrors === undefined && !error}
	<p><Spinner label="Loading…" /></p>
{:else if mirrors === null}
	<p class="muted">This backend's NepFleet is too old to show its mirrors.</p>
{:else if mirrors}
	{#if mirrors.length === 0}
		<p class="muted">
			No mirrors: the fleet repository lives only here and at its origin. A mirror on another forge
			or a backup server keeps it if those are lost.
		</p>
	{:else}
		<ul class="mirrors">
			{#each mirrors as m (m.id ?? m.url)}
				<li>
					<div class="row">
						<code>{m.url}</code>
						<span class="muted">last pushed {when(m.ok)}</span>
						{#if m.id}<Button
								variant="ghost"
								onclick={() => {
									removing = m;
									removeOpen = true;
								}}
							>
								Remove
							</Button>{/if}
					</div>
					{#if m.error}<p class="error">{m.error}</p>{/if}
					{#if m.publicKey && fresh?.id !== m.id}
						<details>
							<summary>Deploy key</summary>
							{@render deployKey(m.publicKey)}
						</details>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if fresh?.publicKey}
		<div class="fresh" role="status">
			<p>
				<strong>Add this to your forge as a deploy key with write access</strong> (in the repository's
				settings, under deploy keys), then push. The backend keeps the private half, encrypted; it never
				leaves the server.
			</p>
			{@render deployKey(fresh.publicKey)}
		</div>
	{/if}
	<div class="actions">
		{#if mirrors.length > 0}
			<Button variant={fresh ? 'primary' : 'default'} {busy} onclick={push}>
				{busy ? 'Pushing…' : 'Push now'}
			</Button>
		{/if}
		{#if !adding}<Button onclick={() => (adding = true)}>Add a mirror…</Button>{/if}
	</div>
	{#if adding}
		<form
			class="add"
			onsubmit={(e) => {
				e.preventDefault();
				void add();
			}}
		>
			<TextField
				label="Git URL of the mirror"
				bind:value={url}
				placeholder="git@codeberg.org:you/fleet.git"
				spellcheck="false"
				autocomplete="off"
				error={kindError}
				hint={kind === 'ssh'
					? 'The backend makes a deploy key for it and shows it next.'
					: kind === 'https'
						? 'Signs in with the token below, or the server’s git credential helper.'
						: kind === 'local'
							? 'A path on the server, such as a mounted backup disk.'
							: 'ssh://…, user@host:path, https://… or a path on the server.'}
			/>
			{#if kind === 'https'}
				<TextField
					label="Access token (optional)"
					type="password"
					bind:value={httpToken}
					autocomplete="off"
					hint="Stored encrypted with the fleet's secrets, never in the URL. It needs write access."
				/>
				{#if httpToken}<TextField
						label="User name (optional)"
						bind:value={user}
						autocomplete="off"
						placeholder="git"
					/>{/if}
			{/if}
			<div class="actions">
				<Button type="submit" variant="primary" busy={saving} disabled={typeof kind === 'object'}>
					Add mirror
				</Button>
				<Button variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
			</div>
			{#if addError}<p class="error" role="alert">{addError}</p>{/if}
		</form>
	{/if}
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<Dialog bind:open={removeOpen} title="Stop mirroring?">
	<p>
		The fleet repository is no longer pushed to <code>{removing?.url}</code>. The copy there stays,
		and so does the deploy key on the forge; remove it there too.
	</p>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (removeOpen = false)}>Cancel</Button>
		<Button variant="danger" onclick={() => removing && remove(removing)}>Remove mirror</Button>
	{/snippet}
</Dialog>

<style>
	.mirrors {
		list-style: none;
		padding: 0;
	}
	.mirrors li {
		padding: 0.2rem 0;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
	}
	.key {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0.25rem 0;
	}
	.key code {
		overflow-wrap: anywhere;
		font-size: 0.85em;
	}
	.fresh {
		border-left: 3px solid var(--accent, currentColor);
		padding-left: 0.75rem;
		margin: 0.5rem 0;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0.5rem 0;
	}
	.add {
		max-width: 36rem;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
