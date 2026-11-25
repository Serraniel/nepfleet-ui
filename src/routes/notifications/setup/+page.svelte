<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		type StackInfo,
		fetchChannels,
		fetchRoutes,
		fetchStacks,
		saveRoutes,
		setChannel,
		testChannel
	} from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { local } from '#lib/local.svelte.ts';
	import { PRESETS, applyPreset, isNtfyStack, ntfyUrl, randomTopic } from '#lib/notify-setup.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import ChannelAdd from '#lib/ChannelAdd.svelte';
	import RoutesEditor from '#lib/RoutesEditor.svelte';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Spinner from '#lib/ui/Spinner.svelte';

	type Step = 'provider' | 'routes' | 'test';
	const STEPS: { id: Step; title: string }[] = [
		{ id: 'provider', title: 'Where to' },
		{ id: 'routes', title: 'What to send' },
		{ id: 'test', title: 'Send a test' }
	];
	const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));
	let backendId = $state('');
	const backend = $derived(backends.list.find((b) => b.id === backendId));
	const token = $derived(tokens.byBackend[backendId] ?? '');

	let step = $state<Step>('provider');
	let channel = $state('');

	// What the backend has: its ntfy stacks, and the channels already there.
	let loading = $state(false);
	let loadError = $state('');
	let ntfyStacks = $state<StackInfo[]>([]);
	let channels = $state<string[] | null>([]);

	// Step 1: the provider.
	let choice = $state('');
	let server = $state('');
	let topic = $state('');
	// An access token for ntfy: a password field, sent once with the channel.
	let ntfyToken = $state('');
	let name = $state('ntfy');
	let existing = $state('');
	let adding = $state(false);
	let addError = $state('');

	// Step 2: the routes.
	let preset = $state('problems');
	let savingRoutes = $state(false);
	let routesError = $state('');

	// Step 3: the test.
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; text: string } | null>(null);

	onMount(() => {
		void local.refresh().then(() => {
			const asked = page.url.searchParams.get('backend');
			backendId = connected.find((b) => b.id === asked)?.id ?? connected[0]?.id ?? '';
		});
	});

	async function load() {
		const b = backend;
		if (!b || !token) return;
		loading = true;
		loadError = '';
		try {
			const [stacks, cs] = await Promise.all([fetchStacks(b, token), fetchChannels(b, token)]);
			ntfyStacks = stacks.filter(isNtfyStack);
			channels = cs;
			choose(ntfyStacks[0] ? `stack:${ntfyStacks[0].name}` : 'external');
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void backendId;
		restart();
		void load();
	});

	function restart() {
		step = 'provider';
		channel = '';
		addError = '';
		routesError = '';
		testResult = null;
		preset = 'problems';
	}

	/** Picks a provider and fills its fields with what fits it. */
	function choose(c: string) {
		choice = c;
		addError = '';
		ntfyToken = '';
		if (c.startsWith('stack:')) {
			const s = ntfyStacks.find((x) => `stack:${x.name}` === c);
			server = s?.url ?? '';
			// Your own server: the topic needs no hiding, access is by token.
			topic = 'nepfleet';
		} else if (c === 'external') {
			server = 'https://ntfy.sh';
			// A public server: anyone who knows a topic can read it.
			topic = randomTopic();
		}
		name = c === 'other' ? '' : 'ntfy';
		existing = channels?.[0] ?? '';
	}

	const isNtfy = $derived(choice.startsWith('stack:') || choice === 'external');
	const builtUrl = $derived.by(() => {
		if (!isNtfy) return { url: '', error: '' };
		try {
			return { url: ntfyUrl(server, topic, ntfyToken), error: '' };
		} catch (e) {
			return { url: '', error: e instanceof Error ? e.message : String(e) };
		}
	});
	const taken = $derived(channels?.includes(name.trim()) ?? false);

	async function save(n: string, url: string, min: 'info' | 'warning' | 'error') {
		const b = backend;
		if (!b || !token || !NAME_RE.test(n))
			throw new Error('A name is 1 to 64 letters, digits, dots, dashes or underscores.');
		await setChannel(b, token, n, url, min);
		channel = n;
		channels = [...new Set([...(channels ?? []), n])];
		step = 'routes';
	}

	async function addNtfy(event: SubmitEvent) {
		event.preventDefault();
		adding = true;
		addError = '';
		try {
			await save(name.trim(), builtUrl.url, 'warning');
			ntfyToken = '';
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			adding = false;
		}
	}

	function useExisting() {
		channel = existing;
		step = 'routes';
	}

	async function applyRoutes() {
		const b = backend;
		const p = PRESETS.find((x) => x.id === preset);
		if (!b || !token || !p) return;
		savingRoutes = true;
		routesError = '';
		try {
			const routes = (await fetchRoutes(b, token)) ?? [];
			await saveRoutes(b, token, applyPreset(routes, channel, p));
			step = 'test';
		} catch (e) {
			routesError = e instanceof Error ? e.message : String(e);
		} finally {
			savingRoutes = false;
		}
	}

	async function sendTest() {
		const b = backend;
		if (!b || !token) return;
		testing = true;
		testResult = null;
		try {
			await testChannel(b, token, channel);
			testResult = { ok: true, text: 'Sent. Check that it arrived.' };
		} catch (e) {
			testResult = { ok: false, text: e instanceof Error ? e.message : String(e) };
		} finally {
			testing = false;
		}
	}

	const createHref = $derived(`/templates?backend=${encodeURIComponent(backendId)}&template=ntfy`);
	const stepIndex = $derived(STEPS.findIndex((s) => s.id === step));
</script>

<header>
	<p class="crumb"><a href="/features">Features</a> / Notifications</p>
	<h1>Set up notifications</h1>
	<p class="muted">
		Pick where messages go, what the fleet sends there, and check one arrives. Everything lands in
		the fleet repository: the channel's address encrypted in <code>fleet.secret.yaml</code>, its
		routes in <code>fleet.yaml</code>.
	</p>
</header>

{#if connected.length === 0}
	<EmptyState title="No backend with a token">
		Add an API token for a backend on the <a href="/stacks">Stacks</a> page.
	</EmptyState>
{:else}
	{#if connected.length > 1}
		<label class="pick">
			Backend
			<select bind:value={backendId}>
				{#each connected as b (b.id)}
					<option value={b.id}>{b.label ?? new URL(b.url).host}</option>
				{/each}
			</select>
		</label>
	{/if}

	<ol class="steps" aria-label="Steps">
		{#each STEPS as s, i (s.id)}
			<li aria-current={s.id === step ? 'step' : undefined} class:done={i < stepIndex}>
				{i + 1}. {s.title}
			</li>
		{/each}
	</ol>

	{#if loading}
		<p><Spinner label="Loading…" /></p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
	{:else if channels === null}
		<p class="muted">This backend's NepFleet is too old for notification channels; update it.</p>
	{:else if step === 'provider'}
		<section aria-labelledby="provider-h">
			<h2 id="provider-h">Where should messages go?</h2>
			<fieldset class="choices">
				<legend class="sr-only">Provider</legend>
				{#each ntfyStacks as s (s.name)}
					<label>
						<input
							type="radio"
							name="provider"
							checked={choice === `stack:${s.name}`}
							onchange={() => choose(`stack:${s.name}`)}
						/>
						<span>
							<strong>ntfy in this fleet: {s.name}</strong>
							<span class="muted">
								{s.url ?? 'no address known'}{s.state ? ` · ${s.state}` : ''}
							</span>
						</span>
					</label>
				{/each}
				{#if ntfyStacks.length === 0}
					<label>
						<input
							type="radio"
							name="provider"
							checked={choice === 'create'}
							onchange={() => choose('create')}
						/>
						<span>
							<strong>Run ntfy in this fleet</strong>
							<span class="muted">Your own push server, from the ntfy template.</span>
						</span>
					</label>
				{/if}
				<label>
					<input
						type="radio"
						name="provider"
						checked={choice === 'external'}
						onchange={() => choose('external')}
					/>
					<span>
						<strong>An ntfy server elsewhere</strong>
						<span class="muted">ntfy.sh, or one you run outside this fleet.</span>
					</span>
				</label>
				<label>
					<input
						type="radio"
						name="provider"
						checked={choice === 'other'}
						onchange={() => choose('other')}
					/>
					<span>
						<strong>Another service</strong>
						<span class="muted">Discord, Telegram, Slack, Matrix, e-mail, a webhook…</span>
					</span>
				</label>
				{#if channels.length}
					<label>
						<input
							type="radio"
							name="provider"
							checked={choice === 'existing'}
							onchange={() => choose('existing')}
						/>
						<span>
							<strong>A channel you already have</strong>
							<span class="muted">{channels.join(', ')}</span>
						</span>
					</label>
				{/if}
			</fieldset>

			{#if isNtfy}
				<form class="form" onsubmit={addNtfy} aria-label="ntfy channel">
					<label>
						Server
						<input bind:value={server} placeholder="https://ntfy.example.test" required />
					</label>
					<label>
						Topic
						<input bind:value={topic} spellcheck="false" required />
					</label>
					<label>
						Access token (optional)
						<input bind:value={ntfyToken} type="password" autocomplete="off" />
					</label>
					<label>
						Channel name
						<input bind:value={name} required />
					</label>
					<div class="row">
						<Button
							type="submit"
							variant="primary"
							busy={adding}
							disabled={!builtUrl.url || !NAME_RE.test(name.trim())}
						>
							{taken ? 'Replace channel' : 'Add channel'}
						</Button>
						{#if builtUrl.error && server && topic}
							<span class="error small">{builtUrl.error}</span>
						{:else if taken}
							<span class="muted small">
								A channel named {name.trim()} exists; this replaces it.
							</span>
						{/if}
					</div>
					{#if choice.startsWith('stack:')}
						<p class="muted small">
							The ntfy template is closed by default. Sign in to its web app as admin, create a user
							that may write to the topic, and paste an access token for it here.
						</p>
					{:else}
						<p class="muted small">
							On a public server, anyone who knows the topic can read it: keep the random one, and
							subscribe to it in the ntfy app.
						</p>
					{/if}
					{#if addError}<p class="error" role="alert">{addError}</p>{/if}
				</form>
			{:else if choice === 'create'}
				<div class="form">
					<p>
						The ntfy template runs it as a stack: give it a domain and an admin password, create it,
						and apply it. Then come back here: it shows up as a choice.
					</p>
					<p><a class="go" href={createHref}>Create an ntfy stack…</a></p>
				</div>
			{:else if choice === 'other'}
				<div class="form">
					<ChannelAdd label={backend?.label ?? backend?.url ?? ''} {save} />
				</div>
			{:else if choice === 'existing'}
				<div class="form row">
					<label>
						Channel
						<select bind:value={existing}>
							{#each channels as c (c)}<option value={c}>{c}</option>{/each}
						</select>
					</label>
					<Button variant="primary" onclick={useExisting} disabled={!existing}>Continue</Button>
				</div>
			{/if}
		</section>
	{:else if step === 'routes'}
		<section aria-labelledby="routes-h">
			<h2 id="routes-h">What should <code>{channel}</code> get?</h2>
			<fieldset class="choices">
				<legend class="sr-only">Preset</legend>
				{#each PRESETS as p (p.id)}
					<label>
						<input type="radio" name="preset" value={p.id} bind:group={preset} />
						<span>
							<strong>{p.title}</strong>
							<span class="muted">{p.what}</span>
						</span>
					</label>
				{/each}
				<label>
					<input type="radio" name="preset" value="custom" bind:group={preset} />
					<span>
						<strong>Choose yourself</strong>
						<span class="muted">Edit the routes: events, stacks and severity per channel.</span>
					</span>
				</label>
			</fieldset>
			{#if preset === 'custom'}
				{#if backend}<RoutesEditor {backend} {token} channels={channels ?? [channel]} />{/if}
				<div class="row">
					<Button variant="primary" onclick={() => (step = 'test')}>Next</Button>
				</div>
			{:else}
				<p class="muted small">
					This replaces the routes that send to <code>{channel}</code>; other channels keep theirs.
				</p>
				<div class="row">
					<Button variant="primary" busy={savingRoutes} onclick={applyRoutes}>
						Save and continue
					</Button>
					<Button variant="ghost" onclick={() => (step = 'test')}>Skip</Button>
				</div>
				{#if routesError}<p class="error" role="alert">{routesError}</p>{/if}
			{/if}
		</section>
	{:else}
		<section aria-labelledby="test-h">
			<h2 id="test-h">Send a test to <code>{channel}</code></h2>
			<div class="row">
				<Button variant="primary" busy={testing} onclick={sendTest}>Send test</Button>
				{#if testResult}
					<span class:error={!testResult.ok} class:muted={testResult.ok} role="status">
						{testResult.text}
					</span>
				{/if}
			</div>
			<p class="row">
				<a class="go" href="/notifications">Done: see notifications</a>
				<Button variant="ghost" onclick={restart}>Set up another channel</Button>
			</p>
		</section>
	{/if}
{/if}

<style>
	h1 {
		margin: 0 0 0.25rem;
	}
	.crumb {
		margin: 0;
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
	.pick {
		display: grid;
		gap: 0.2rem;
		max-width: 20rem;
		margin: 1rem 0;
	}
	.steps {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		list-style: none;
		padding: 0;
		margin: 1rem 0;
		color: var(--muted);
	}
	.steps [aria-current] {
		color: var(--text);
		font-weight: 600;
	}
	.choices {
		display: grid;
		gap: 0.5rem;
		border: 0;
		padding: 0;
		margin: 0 0 1rem;
	}
	.choices label {
		display: flex;
		gap: 0.6rem;
		align-items: start;
		padding: 0.6rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
		cursor: pointer;
	}
	.choices label > span {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}
	.form {
		display: grid;
		gap: 0.5rem;
		max-width: 36rem;
	}
	.form label {
		display: grid;
		gap: 0.2rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.form.row {
		align-items: end;
	}
	.go {
		font-weight: 600;
	}
</style>
