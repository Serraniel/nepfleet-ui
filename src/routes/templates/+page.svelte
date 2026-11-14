<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		type SourceCatalogue,
		type TemplateEntry,
		VerifyFirstError,
		createStack,
		fetchTemplates
	} from '#lib/backend.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { STACK_NAME, TYPED, type TemplateInput, checkInput, newCommand } from '#lib/inputs.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	let backendId = $state('');
	let catalogues = $state<SourceCatalogue[]>([]);
	let loading = $state(false);
	let error = $state('');
	let query = $state('');
	let picked = $state<{ source: string; t: TemplateEntry } | null>(null);
	let stackName = $state('');
	let target = $state('local');
	let values = $state<Record<string, string>>({});
	let copied = $state(false);
	// Secret inputs: sent with Create only, stored encrypted there, and cleared
	// when the wizard closes. The copied command never holds them.
	let secretValues = $state<Record<string, string>>({});
	let access = $state<'domain' | 'port'>('domain');
	let creating = $state(false);
	let createError = $state('');

	const withToken = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));

	// ?backend=<id>&template=<name> opens the wizard for an official template,
	// as the Features page does to enable one.
	let wanted = '';

	onMount(() => {
		void backends.checkAll();
		const q = page.url.searchParams;
		wanted = q.get('template') ?? '';
		const asked = withToken.find((b) => b.id === q.get('backend'));
		if (asked) backendId = asked.id;
		else if (withToken[0]) backendId = withToken[0].id;
	});

	async function load() {
		const b = backends.list.find((x) => x.id === backendId);
		const token = tokens.byBackend[backendId];
		if (!b || !token) return;
		loading = true;
		error = '';
		try {
			catalogues = await fetchTemplates(b, token);
			if (wanted) {
				const hit = catalogues
					.filter((c) => c.source === 'official')
					.flatMap((c) => (c.templates ?? []).map((t) => ({ source: c.source, t })))
					.find((e) => e.t.name === wanted);
				wanted = '';
				if (hit) pick(hit);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			catalogues = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void backendId;
		picked = null;
		void load();
	});

	const entries = $derived(
		catalogues.flatMap((c) => (c.templates ?? []).map((t) => ({ source: c.source, t })))
	);
	const shown = $derived(
		entries.filter(({ t }) =>
			`${t.name} ${t.title ?? ''} ${t.description ?? ''} ${t.category ?? ''}`
				.toLowerCase()
				.includes(query.toLowerCase())
		)
	);

	function pick(e: { source: string; t: TemplateEntry }) {
		picked = e;
		stackName = e.t.name;
		target = 'local';
		values = Object.fromEntries((e.t.inputs ?? []).map((i) => [i.name, i.default ?? '']));
		secretValues = {};
		access = 'domain';
		createError = '';
		copied = false;
	}

	$effect(() => {
		if (!picked) secretValues = {};
	});

	const inputs = $derived(picked?.t.inputs ?? []);
	const errors = $derived(
		Object.fromEntries(
			inputs
				.filter((i) => i.type !== 'secret')
				.map((i) => [i.name, checkInput(i, values[i.name] ?? '')])
		)
	);
	const nameError = $derived(
		STACK_NAME.test(stackName) ? '' : 'Lowercase letters, digits, - and _'
	);
	const valid = $derived(!nameError && Object.values(errors).every((e) => !e));
	const command = $derived(
		picked ? newCommand(picked.t.name, stackName, target, inputs, values) : ''
	);
	const secrets = $derived(inputs.filter((i) => i.type === 'secret'));
	const secretsMissing = $derived(
		secrets.some((i) => i.required && !i.default && !secretValues[i.name])
	);

	async function create() {
		const b = backends.list.find((x) => x.id === backendId);
		const token = tokens.byBackend[backendId];
		if (!b || !token || !picked) return;
		creating = true;
		createError = '';
		const all: Record<string, string> = {};
		for (const [k, v] of Object.entries(values)) if (v !== '') all[k] = v;
		for (const [k, v] of Object.entries(secretValues)) if (v !== '') all[k] = v;
		const req = {
			template: picked.t.name,
			source: picked.source,
			name: stackName,
			target,
			access,
			values: all
		};
		try {
			let res;
			try {
				res = await createStack(b, token, req);
			} catch (e) {
				if (!(e instanceof VerifyFirstError)) throw e;
				await verifyIdentity(b);
				res = await createStack(b, token, req);
			}
			secretValues = {};
			await goto(`/stacks/${encodeURIComponent(backendId)}/${encodeURIComponent(res.name)}`);
		} catch (e) {
			createError = e instanceof Error ? e.message : String(e);
		} finally {
			creating = false;
		}
	}

	function choices(inp: TemplateInput): string[] {
		if (inp.type === 'bool') return ['true', 'false'];
		if (inp.type === 'gpu') return ['none', 'intel', 'amd', 'nvidia'];
		return inp.options ?? [];
	}

	async function copy() {
		await navigator.clipboard.writeText(command);
		copied = true;
	}

	const badges: Record<string, string> = {
		ingress: '🌐 ingress',
		monitoring: '📈 monitoring',
		dashboard: '🏠 dashboard',
		backup: '💾 backup',
		swarm: '🐝 swarm',
		arm64: '🦾 arm64',
		sso: '🔑 sso'
	};
</script>

<header>
	<h1>Templates</h1>
	<p>The catalogues of a backend's fleet. Pick a template to fill in its inputs.</p>
</header>

{#if withToken.length === 0}
	<EmptyState title="No backend with a token">
		Add an API token on the <a href="/stacks">Stacks</a> page first.
	</EmptyState>
{:else}
	<div class="filters">
		<label for="backend" class="sr-only">Backend</label>
		<select id="backend" bind:value={backendId}>
			{#each withToken as b (b.id)}<option value={b.id}>{b.label ?? new URL(b.url).host}</option
				>{/each}
		</select>
		<label for="q" class="sr-only">Search</label>
		<input id="q" type="search" placeholder="Search templates" bind:value={query} />
	</div>

	{#if loading}
		<p class="muted" aria-live="polite">Loading the catalogue…</p>
	{:else if error}
		<p class="error" role="alert">{error}</p>
		<Button onclick={load}>Retry</Button>
	{:else if picked}
		{@const t = picked.t}
		<section class="wizard" aria-labelledby="wiz-h">
			<Button variant="ghost" onclick={() => (picked = null)}>← All templates</Button>
			<h2 id="wiz-h">
				{t.title ?? t.name} <span class="muted">{picked.source}/{t.name} {t.version}</span>
			</h2>
			{#if t.description}<p>{t.description}</p>{/if}
			<form onsubmit={(e) => e.preventDefault()}>
				<div class="field">
					<label for="f-stack">Stack name</label>
					<input
						id="f-stack"
						bind:value={stackName}
						aria-invalid={!!nameError}
						aria-describedby="e-stack"
					/>
					{#if nameError}<span id="e-stack" class="error">{nameError}</span>{/if}
				</div>
				<div class="field">
					<label for="f-target">Host</label>
					<input id="f-target" bind:value={target} />
					<span class="muted">local is the host the command runs on</span>
				</div>
				<div class="field">
					<label for="f-access">Reached</label>
					<select id="f-access" bind:value={access}>
						<option value="domain">on its domain, through Caddy</option>
						<option value="port">on a LAN port of the host (templates with a web UI)</option>
					</select>
				</div>
				{#each inputs as inp (inp.name)}
					{#if inp.type !== 'secret'}
						{@const err = errors[inp.name]}
						<div class="field">
							<label for="f-{inp.name}">
								{inp.title ?? inp.name}{#if inp.required && !inp.default}<span aria-hidden="true">
										*</span
									>{/if}
							</label>
							{#if inp.type === 'enum' || inp.type === 'bool' || inp.type === 'gpu'}
								<select id="f-{inp.name}" bind:value={values[inp.name]}>
									{#if !inp.required || TYPED.has(inp.type)}<option value="">(default)</option>{/if}
									{#each choices(inp) as o (o)}
										<option value={o}>{o}</option>
									{/each}
								</select>
							{:else if inp.type === 'text'}
								<textarea id="f-{inp.name}" bind:value={values[inp.name]} rows="4"></textarea>
							{:else}
								<input
									id="f-{inp.name}"
									bind:value={values[inp.name]}
									inputmode={inp.type === 'int' ? 'numeric' : undefined}
									type={inp.type === 'email' ? 'email' : inp.type === 'url' ? 'url' : 'text'}
									aria-invalid={!!err}
									aria-describedby="h-{inp.name}"
								/>
							{/if}
							<span id="h-{inp.name}" class={err ? 'error' : 'muted'}>
								{err || inp.description || ''}
							</span>
						</div>
					{:else}
						<div class="field">
							<label for="f-{inp.name}">
								{inp.title ?? inp.name}{#if inp.required && !inp.default}<span aria-hidden="true">
										*</span
									>{/if}
							</label>
							<input
								id="f-{inp.name}"
								type="password"
								autocomplete="new-password"
								bind:value={secretValues[inp.name]}
								aria-describedby="h-{inp.name}"
							/>
							<span id="h-{inp.name}" class="muted">
								{inp.description ? inp.description + ' ' : ''}Stored encrypted on the backend.
							</span>
						</div>
					{/if}
				{/each}
			</form>
			{#if secrets.length || t.generate?.length}
				<div class="note">
					{#if secrets.length}
						<p>
							<strong>Secrets:</strong>
							{secrets.map((s) => s.title ?? s.name).join(', ')}. With Create, they go to the
							backend and are stored encrypted there. The command below leaves them out: it asks for
							them when you run it.
						</p>
					{/if}
					{#if t.generate?.length}
						<p>
							<strong>Generated and stored encrypted:</strong>
							{t.generate.map((g) => g.name).join(', ')}.
						</p>
					{/if}
				</div>
			{/if}
			<div class="actions">
				<Button variant="primary" onclick={create} disabled={!valid || secretsMissing || creating}
					>{creating ? 'Creating…' : 'Create stack'}</Button
				>
				<span class="muted"
					>Commits it to the fleet repository without applying it: review its plan on the next page,
					then apply.</span
				>
			</div>
			{#if createError}<p class="error" role="alert">{createError}</p>{/if}
			<h3>Or from the command line</h3>
			<pre><code>{command}</code></pre>
			<Button onclick={copy} disabled={!valid}>{copied ? 'Copied' : 'Copy command'}</Button>
			{#if !valid}<p class="error" role="status">Fix the marked fields first.</p>{/if}
			<p class="muted">
				Run it in the fleet repository, then <code>nepfleet plan</code>, commit and apply.
			</p>
		</section>
	{:else if shown.length === 0}
		<EmptyState title="No templates"
			>{entries.length ? 'Nothing matches.' : 'The catalogue is empty.'}</EmptyState
		>
	{:else}
		<ul class="grid">
			{#each shown as e (e.source + '/' + e.t.name)}
				<li class="card">
					<button type="button" onclick={() => pick(e)}>
						<strong>{e.t.title ?? e.t.name}</strong>
						<span class="muted">{e.t.tier} · {e.t.category ?? ''} · {e.t.version}</span>
						{#if e.t.description}<span class="desc">{e.t.description}</span>{/if}
						<span class="badges">
							{#each Object.entries(badges).filter(([k]) => e.t.supports?.[k]) as [k, label] (k)}
								<span>{label}</span>
							{/each}
						</span>
					</button>
				</li>
			{/each}
		</ul>
		{#each catalogues.filter((c) => c.invalid?.length) as c (c.source)}
			<p class="muted">
				{c.source}: not offered because they do not validate: {c.invalid?.join(', ')}
			</p>
		{/each}
	{/if}
{/if}

<style>
	header p,
	.muted {
		color: var(--muted);
	}
	h1 {
		margin: 0 0 0.25rem;
	}
	.error {
		color: var(--err);
	}
	.filters {
		display: flex;
		gap: 0.5rem;
		margin: 1rem 0;
	}
	.grid {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	}
	.card button {
		width: 100%;
		height: 100%;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
		padding: 0.8rem 1rem;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.card button:hover,
	.card button:focus-visible {
		border-color: var(--accent, currentColor);
	}
	.desc {
		font-size: 0.9em;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		font-size: 0.8em;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
		margin: 1rem 0;
	}
	.wizard form {
		display: grid;
		gap: 0.8rem;
		max-width: 40rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.field span {
		font-size: 0.85em;
	}
	.note {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.4rem 0.8rem;
		margin: 1rem 0;
		max-width: 40rem;
	}
	pre {
		white-space: pre-wrap;
		word-break: break-all;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.6rem 0.8rem;
	}
</style>
