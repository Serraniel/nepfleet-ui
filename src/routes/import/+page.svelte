<script lang="ts">
	import { onMount } from 'svelte';
	import {
		type ComposeProject,
		VerifyFirstError,
		fetchComposeProjects,
		importCompose
	} from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { local } from '#lib/local.svelte.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	type Load =
		| { state: 'loading' }
		| { state: 'ok'; value: ComposeProject[] | null }
		| { state: 'error'; error: string };

	let byBackend = $state<Record<string, Load>>({});
	let busy = $state('');
	let encryptAll = $state(false);
	let result = $state<{ backend: string; stack: string; commit: string; log: string } | null>(null);
	let error = $state('');

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));

	async function load(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		byBackend[id] = { state: 'loading' };
		try {
			byBackend[id] = { state: 'ok', value: await fetchComposeProjects(b, token) };
		} catch (e) {
			byBackend[id] = { state: 'error', error: e instanceof Error ? e.message : String(e) };
		}
	}

	onMount(() => {
		void local.refresh().then(() => {
			for (const b of connected) void load(b.id);
		});
	});

	async function run(id: string, project: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		busy = id + '/' + project;
		error = '';
		result = null;
		const send = () => importCompose(b, token, project, encryptAll);
		try {
			let r;
			try {
				r = await send();
			} catch (e) {
				if (!(e instanceof VerifyFirstError)) throw e;
				await verifyIdentity(b);
				r = await send();
			}
			result = { backend: id, ...r };
			await load(id);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = '';
		}
	}
</script>

<header>
	<h1>Import</h1>
	<p>
		Compose projects already running on a backend's host can become NepFleet stacks: their settings
		go to the fleet repository (secret-looking values encrypted), and the running containers count
		as applied, so nothing restarts. From then on, change them only through NepFleet.
	</p>
</header>

{#if connected.length === 0}
	<EmptyState title="No backend with a token">
		Add an API token for a backend on the <a href="/stacks">Stacks</a> page.
	</EmptyState>
{:else}
	<label class="check"
		><input type="checkbox" bind:checked={encryptAll} /> Encrypt every value, not only secret-looking
		ones</label
	>
	{#if result}
		<section class="result" aria-label="Imported">
			<p role="status">
				Imported as
				<a href="/stacks/{encodeURIComponent(result.backend)}/{encodeURIComponent(result.stack)}"
					>{result.stack}</a
				>
				in <code>{result.commit.slice(0, 7)}</code>.
			</p>
			{#if result.log}<pre>{result.log}</pre>{/if}
		</section>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#each connected as b (b.id)}
		{@const st = byBackend[b.id]}
		<section aria-label={b.label ?? b.url}>
			<h2>{b.label ?? new URL(b.url).host}</h2>
			{#if !st || st.state === 'loading'}
				<p class="muted">Asking its Docker…</p>
			{:else if st.state === 'error'}
				<p class="error" role="alert">{st.error}</p>
			{:else if st.value === null}
				<p class="muted">This backend's NepFleet is too old to import from here; update it.</p>
			{:else if st.value.length === 0}
				<p class="muted">No Compose projects on this host.</p>
			{:else}
				<ul class="projects">
					{#each st.value as p (p.name)}
						<li>
							<strong>{p.name}</strong>
							<span class="muted">{p.status}</span>
							{#if p.stack}
								<span class="muted">a stack already</span>
							{:else}
								<Button variant="ghost" disabled={busy !== ''} onclick={() => run(b.id, p.name)}
									>{busy === b.id + '/' + p.name ? 'Importing…' : 'Import'}</Button
								>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
{/if}

<style>
	.projects {
		list-style: none;
		padding: 0;
	}
	.projects li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		padding: 0.3rem 0;
		border-top: 1px solid var(--border);
	}
	.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	pre {
		white-space: pre-wrap;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
