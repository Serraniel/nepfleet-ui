<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		AuthError,
		ConflictError,
		InvalidEditError,
		ScopeError,
		type StackFile,
		VerifyFirstError,
		fetchStackFiles,
		saveStackFiles
	} from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	const backendId = $derived(page.params.backend ?? '');
	const name = $derived(page.params.name ?? '');
	const backend = $derived(backends.list.find((b) => b.id === backendId));
	const token = $derived(tokens.byBackend[backendId]);
	const stackHref = $derived(
		`/stacks/${encodeURIComponent(backendId)}/${encodeURIComponent(name)}`
	);

	let files = $state<StackFile[]>([]);
	// What the person typed, per path; a file is changed when it differs.
	let drafts = $state<Record<string, string>>({});
	let selected = $state('');
	let loading = $state(true);
	let loadError = $state('');
	let message = $state('');
	let saving = $state(false);
	let saveError = $state('');
	let savedCommit = $state('');
	let newPath = $state('');

	async function load() {
		if (!backend || !token) return;
		loading = true;
		loadError = '';
		try {
			files = await fetchStackFiles(backend, token, name);
			drafts = Object.fromEntries(files.map((f) => [f.path, f.content]));
			if (!files.some((f) => f.path === selected)) selected = files[0]?.path ?? '';
		} catch (e) {
			loadError =
				e instanceof AuthError
					? 'Add a token for this backend on the Stacks page first.'
					: e instanceof ScopeError
						? 'Editing needs a token with the edit scope, or signing in.'
						: e instanceof Error
							? e.message
							: String(e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const original = (path: string) => files.find((f) => f.path === path);
	const changed = $derived(
		Object.keys(drafts).filter((p) => drafts[p] !== (original(p)?.content ?? undefined))
	);

	function addFile(event: SubmitEvent) {
		event.preventDefault();
		const p = newPath.trim();
		if (!p) return;
		if (!p.startsWith('files/')) {
			saveError = 'New files go under files/, which the stack can mount as ./…';
			return;
		}
		if (!(p in drafts)) drafts[p] = '';
		selected = p;
		newPath = '';
	}

	async function save() {
		if (!backend || !token || changed.length === 0) return;
		saving = true;
		saveError = '';
		savedCommit = '';
		const body = Object.fromEntries(changed.map((p) => [p, drafts[p] ?? '']));
		const base = Object.fromEntries(changed.map((p) => [p, original(p)?.revision ?? '']));
		const send = () => saveStackFiles(backend, token, name, body, base, message.trim());
		try {
			try {
				savedCommit = await send();
			} catch (e) {
				if (!(e instanceof VerifyFirstError)) throw e;
				await verifyIdentity(backend);
				savedCommit = await send();
			}
			message = '';
			await load();
		} catch (e) {
			saveError =
				e instanceof ConflictError
					? `${e.message}. Your changes are still here: copy them, reload, and apply them again.`
					: e instanceof InvalidEditError
						? e.message
						: e instanceof Error
							? e.message
							: String(e);
		} finally {
			saving = false;
		}
	}
</script>

<header>
	<p><a href={stackHref}>← {name}</a></p>
	<h1>Edit {name}</h1>
	<p class="muted">
		Saving makes one commit in the fleet repository, in your name. It doesn't apply: review the
		changes under Pending changes on the stack's page, then apply them there. Encrypted values
		aren't shown here.
	</p>
</header>

{#if !backend || !token}
	<EmptyState title="No token for this backend">
		Add one on the <a href="/stacks">Stacks</a> page.
	</EmptyState>
{:else if loading}
	<p class="muted">Loading…</p>
{:else if loadError}
	<p class="error" role="alert">{loadError}</p>
{:else}
	<div class="editor">
		<nav aria-label="Files">
			<ul>
				{#each Object.keys(drafts).sort() as p (p)}
					<li>
						<button type="button" class:current={p === selected} onclick={() => (selected = p)}
							>{p}{#if changed.includes(p)}
								•{/if}</button
						>
					</li>
				{/each}
			</ul>
			<form onsubmit={addFile}>
				<label for="new-file" class="sr-only">New file</label>
				<input id="new-file" placeholder="files/config/app.yaml" bind:value={newPath} />
				<Button variant="ghost" type="submit">Add file</Button>
			</form>
		</nav>
		<div class="text">
			{#if selected}
				<label for="content" class="sr-only">{selected}</label>
				<textarea id="content" spellcheck="false" autocomplete="off" bind:value={drafts[selected]}
				></textarea>
			{:else}
				<p class="muted">This stack has no editable files.</p>
			{/if}
		</div>
	</div>
	<div class="save">
		<label for="message" class="sr-only">Commit message</label>
		<input
			id="message"
			placeholder="What changed (the commit's message)"
			bind:value={message}
			maxlength="200"
		/>
		<Button variant="primary" onclick={save} disabled={saving || changed.length === 0}
			>{saving
				? 'Saving…'
				: changed.length
					? `Save ${changed.length} file${changed.length === 1 ? '' : 's'}`
					: 'No changes'}</Button
		>
	</div>
	{#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
	{#if savedCommit}
		<p role="status">
			Saved as <code>{savedCommit.slice(0, 7)}</code>.
			<a href={stackHref}>Review and apply it on the stack's page</a>.
		</p>
	{/if}
{/if}

<style>
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
	.editor {
		display: grid;
		grid-template-columns: minmax(12rem, 1fr) 3fr;
		gap: 1rem;
		margin: 1rem 0;
	}
	@media (max-width: 40rem) {
		.editor {
			grid-template-columns: 1fr;
		}
	}
	nav ul {
		list-style: none;
		padding: 0;
		margin: 0 0 0.75rem;
	}
	nav button {
		all: unset;
		cursor: pointer;
		display: block;
		padding: 0.2rem 0.4rem;
		border-radius: var(--radius);
		font-family: var(--mono, monospace);
		font-size: 0.9em;
		word-break: break-all;
	}
	nav button.current {
		background: var(--surface);
		font-weight: 600;
	}
	nav button:focus-visible {
		outline: 2px solid currentColor;
	}
	textarea {
		width: 100%;
		min-height: 28rem;
		font-family: var(--mono, monospace);
		font-size: 0.9em;
		line-height: 1.4;
		tab-size: 2;
		box-sizing: border-box;
	}
	.save {
		display: flex;
		gap: 0.5rem;
	}
	.save input {
		flex: 1;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
