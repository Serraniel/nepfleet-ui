<script lang="ts">
	import { onMount } from 'svelte';
	import { isDesktop, startDaemon } from '#lib/desktop.ts';
	import { DEFAULT_DAEMON, local } from '#lib/local.svelte.ts';
	import {
		type Remote,
		type SetupJob,
		type SetupPlan,
		addRemote,
		describe,
		fetchSetupJob,
		fetchSetupPlan,
		remoteAction,
		removeRemote,
		setupKind,
		LockedKeyError,
		WrongPassphraseError,
		unlockKey,
		canConnect,
		startSetup
	} from '#lib/local.ts';
	import { ConflictError } from '#lib/backend.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	let daemonUrl = $state(local.url || DEFAULT_DAEMON);
	let tokenInput = $state('');
	let keep = $state(false);
	let connecting = $state(false);
	let connectError = $state('');

	let address = $state('');
	let name = $state('');
	let adding = $state(false);
	let addError = $state('');
	let busy = $state<Record<string, boolean>>({});
	let actionError = $state('');
	let removing = $state<Remote | null>(null);
	let removeOpen = $state(false);

	const desktop = isDesktop();

	onMount(() => {
		void local.refresh();
		local.follow();
		// The layout connected already, unless that failed: then show why.
		if (desktop && !local.connected) void connectDesktop();
	});

	// The desktop app needs no pasted token: it asks the daemon itself.
	async function connectDesktop() {
		connecting = true;
		connectError = '';
		try {
			const d = await startDaemon();
			await local.connect(d.url, d.token, false);
		} catch (e) {
			connectError = e instanceof Error ? e.message : String(e);
		} finally {
			connecting = false;
		}
	}

	async function connectDaemon(event: SubmitEvent) {
		event.preventDefault();
		connecting = true;
		connectError = '';
		try {
			await local.connect(daemonUrl, tokenInput, keep);
			tokenInput = '';
		} catch (e) {
			connectError =
				e instanceof TypeError
					? `No answer from ${daemonUrl}. Is the daemon running with --http, and does it allow this page's origin?`
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			connecting = false;
		}
	}

	// Unlocking SSH keys with a passphrase: the daemon's ssh runs without a
	// terminal, so it asks here, then runs what needed the key again.
	let unlockOpen = $state(false);
	let unlockKeys = $state<string[]>([]);
	let passphrase = $state('');
	let unlockError = $state('');
	let unlocking = $state(false);
	let afterUnlock: (() => Promise<void>) | null = null;
	$effect(() => {
		if (!unlockOpen) passphrase = '';
	});

	function askUnlock(keys: string[], retry: (() => Promise<void>) | null) {
		unlockKeys = keys;
		unlockError = '';
		passphrase = '';
		afterUnlock = retry;
		unlockOpen = true;
	}

	async function submitUnlock(event: SubmitEvent) {
		event.preventDefault();
		const key = unlockKeys[0];
		if (!key || !passphrase) return;
		const given = passphrase;
		passphrase = '';
		unlocking = true;
		unlockError = '';
		try {
			await unlockKey(local.url, local.token, key, given);
			unlockKeys = unlockKeys.slice(1);
			if (unlockKeys.length === 0) {
				unlockOpen = false;
				const retry = afterUnlock;
				afterUnlock = null;
				if (retry) await retry();
				else await local.refresh();
			}
		} catch (e) {
			unlockError =
				e instanceof WrongPassphraseError
					? "That passphrase doesn't unlock the key; try again."
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			unlocking = false;
		}
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		adding = true;
		addError = '';
		try {
			await addRemote(local.url, local.token, address.trim(), name.trim());
			address = '';
			name = '';
			await local.refresh();
		} catch (e) {
			if (e instanceof LockedKeyError) {
				// Unlock, then add again with what was typed.
				const [a, n] = [address, name];
				askUnlock(e.keys, async () => {
					address = a;
					name = n;
					await add(new SubmitEvent('submit'));
				});
				return;
			}
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			adding = false;
		}
	}

	async function act(r: Remote, action: 'refresh' | 'connect' | 'disconnect') {
		busy[r.name] = true;
		actionError = '';
		try {
			await remoteAction(local.url, local.token, r.name, action);
			await local.refresh();
		} catch (e) {
			actionError = `${r.name}: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			busy[r.name] = false;
		}
	}

	async function confirmRemove() {
		const r = removing;
		if (!r) return;
		removeOpen = false;
		busy[r.name] = true;
		actionError = '';
		try {
			await removeRemote(local.url, local.token, r.name);
			await local.refresh();
		} catch (e) {
			actionError = `${r.name}: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			busy[r.name] = false;
		}
	}

	// Setting a machine up: prepare it (Docker), then install NepFleet, each as a
	// plan the person reviews; then connect.
	let setupFor = $state<Remote | null>(null);
	let setupOpen = $state(false);
	let setupPlan = $state<SetupPlan | null>(null);
	let setupJob = $state<SetupJob | null>(null);
	let setupError = $state('');
	// The sudo password, for one run only: cleared when it starts or the dialog
	// closes, and never stored.
	let sudoPassword = $state('');
	$effect(() => {
		if (!setupOpen) sudoPassword = '';
	});
	let planning = $state(false);

	async function planSetup(r: Remote) {
		const kind = setupKind(r.report);
		setupPlan = null;
		setupError = '';
		if (!kind) return;
		planning = true;
		try {
			setupPlan = await fetchSetupPlan(local.url, local.token, r.name, kind);
		} catch (e) {
			if (e instanceof LockedKeyError) {
				askUnlock(e.keys, () => planSetup(r));
				return;
			}
			setupError = e instanceof Error ? e.message : String(e);
		} finally {
			planning = false;
		}
	}

	function openSetup(r: Remote) {
		setupFor = r;
		setupJob = null;
		setupOpen = true;
		void planSetup(r);
	}

	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	async function runSetup() {
		const r = setupFor;
		const p = setupPlan;
		if (!r || !p?.id) return;
		setupError = '';
		const password = p.sudoPassword ? sudoPassword : '';
		sudoPassword = '';
		try {
			setupJob = await startSetup(local.url, local.token, r.name, p.kind, p.id, fetch, password);
			while (setupJob.state === 'running') {
				await sleep(2000);
				setupJob = await fetchSetupJob(local.url, local.token, r.name);
			}
			await local.refresh();
			const fresh = local.remotes.find((x) => x.name === r.name);
			if (fresh) setupFor = fresh;
			// After preparing, installing is next: plan it straight away.
			if (setupJob.state === 'succeeded' && p.kind === 'bootstrap' && fresh) void planSetup(fresh);
		} catch (e) {
			setupError =
				e instanceof ConflictError
					? `${e.message}. The plan below is the new one.`
					: e instanceof Error
						? e.message
						: String(e);
			if (e instanceof ConflictError) void planSetup(r);
		}
	}

	const setupRunning = $derived(setupJob?.state === 'running');
	const needsPassword = $derived(!!setupPlan?.sudoPassword && !setupRunning);
	const setupTitle = (p: SetupPlan | null) =>
		p?.kind === 'install' ? 'Install NepFleet' : 'Prepare the machine';

	const tunnelText: Record<string, string> = {
		off: 'Not connected',
		connecting: 'Connecting…',
		up: 'Connected',
		down: 'Reconnecting…'
	};
</script>

<header>
	<h1>Fleets</h1>
	<p>
		Manage machines from here through the NepFleet control daemon on this computer. It keeps running
		when you close this page, and reaches them over SSH with your keys.
	</p>
</header>

{#if !local.connected && desktop}
	<section class="card" aria-labelledby="daemon-h">
		<h2 id="daemon-h">Control daemon</h2>
		{#if connecting}
			<p class="muted" aria-live="polite">Starting the control daemon…</p>
		{:else}
			{#if connectError}<p class="error" role="alert">{connectError}</p>{/if}
			<Button variant="primary" onclick={connectDesktop}>Try again</Button>
		{/if}
	</section>
{:else if !local.connected}
	<section class="card" aria-labelledby="daemon-h">
		<h2 id="daemon-h">Connect to the control daemon</h2>
		<p>Start it on this computer, then paste its token:</p>
		<pre><code
				>nepfleet control --http 127.0.0.1:7481 --allowed-origins {location.origin}
nepfleet control token</code
			></pre>
		<form onsubmit={connectDaemon}>
			<label for="daemon-url">Daemon address</label>
			<input id="daemon-url" type="url" bind:value={daemonUrl} required />
			<label for="daemon-token">Token</label>
			<input
				id="daemon-token"
				type="password"
				autocomplete="off"
				placeholder="nfc_…"
				bind:value={tokenInput}
				required
			/>
			<label class="check"><input type="checkbox" bind:checked={keep} /> Keep for this tab</label>
			<Button variant="primary" type="submit" disabled={connecting}>
				{connecting ? 'Connecting…' : 'Connect'}
			</Button>
		</form>
		{#if connectError}<p class="error" role="alert">{connectError}</p>{/if}
	</section>
{:else}
	<div class="row">
		<p class="muted">Control daemon at <code>{local.url}</code></p>
		{#if !desktop}
			<Button variant="ghost" onclick={() => local.disconnect()}>Forget token</Button>
		{/if}
	</div>
	{#if local.error}<p class="error" role="alert">{local.error}</p>{/if}

	<section class="card" aria-labelledby="add-h">
		<h2 id="add-h">Add a machine</h2>
		<p class="muted">
			The daemon looks at it first over SSH, changing nothing. It uses your SSH keys and never asks
			for a password. Connect once with <code>ssh</code> first, so its host key is known.
		</p>
		<form class="inline" onsubmit={add}>
			<label for="add-address" class="sr-only">SSH address</label>
			<input
				id="add-address"
				placeholder="ssh://me@nas.local"
				bind:value={address}
				autocomplete="off"
				required
			/>
			<label for="add-name" class="sr-only">Name (optional)</label>
			<input id="add-name" placeholder="Name (optional)" bind:value={name} autocomplete="off" />
			<Button variant="primary" type="submit" disabled={adding}>
				{adding ? 'Looking at it…' : 'Add'}
			</Button>
		</form>
		{#if addError}<p class="error" role="alert">{addError}</p>{/if}
	</section>

	{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}

	{#if local.remotes.length === 0}
		<EmptyState title="No machines yet">Add one above by its SSH address.</EmptyState>
	{:else}
		<ul class="remotes">
			{#each local.remotes as r (r.name)}
				<li class="card">
					<div class="row">
						<div>
							<strong>{r.name}</strong> <code class="muted">{r.address}</code>
						</div>
						<span class="state {r.tunnel}" role="status">{tunnelText[r.tunnel ?? 'off']}</span>
					</div>
					{#if r.report}<p>{describe(r.report)}</p>{/if}
					{#if r.next}<p class="muted">{r.next}</p>{/if}
					{#if r.tunnelError}<p class="error">{r.tunnelError}</p>{/if}
					{#if r.error}<p class="error">Last check failed: {r.error}</p>{/if}
					{#if r.lockedKeys?.length}
						<p>
							<Button
								variant="primary"
								onclick={() => askUnlock(r.lockedKeys ?? [], () => act(r, 'refresh'))}
								>Unlock key…</Button
							>
						</p>
					{/if}
					<div class="actions">
						{#if r.tunnel === 'up'}
							<a href="/stacks">Stacks</a>
						{/if}
						{#if setupKind(r.report)}
							<Button variant="primary" onclick={() => openSetup(r)} disabled={busy[r.name]}
								>{setupKind(r.report) === 'bootstrap'
									? 'Prepare this machine…'
									: 'Install NepFleet…'}</Button
							>
						{/if}
						{#if r.connect}
							<Button onclick={() => act(r, 'disconnect')} disabled={busy[r.name]}
								>Disconnect</Button
							>
						{:else if canConnect(r.report)}
							<Button onclick={() => act(r, 'connect')} disabled={busy[r.name]}>Connect</Button>
						{/if}
						<Button variant="ghost" onclick={() => act(r, 'refresh')} disabled={busy[r.name]}>
							Check again
						</Button>
						<Button
							variant="ghost"
							onclick={() => {
								removing = r;
								removeOpen = true;
							}}
							disabled={busy[r.name]}>Remove…</Button
						>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<Dialog bind:open={unlockOpen} title="Unlock your SSH key">
	<form id="unlock-form" onsubmit={submitUnlock}>
		<p>
			<code>{unlockKeys[0]}</code> has a passphrase. NepFleet's SSH runs in the background, without a
			terminal to ask on, so it keeps the key unlocked in an SSH agent for 8 hours.
		</p>
		<label class="password">
			Passphrase
			<input
				type="password"
				autocomplete="off"
				spellcheck="false"
				bind:value={passphrase}
				disabled={unlocking}
			/>
			<span class="muted">Sent to the NepFleet daemon on this computer only, and kept nowhere.</span
			>
		</label>
		{#if unlockError}<p class="error" role="alert">{unlockError}</p>{/if}
	</form>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (unlockOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="unlock-form" disabled={unlocking || !passphrase}
			>{unlocking ? 'Unlocking…' : 'Unlock'}</Button
		>
	{/snippet}
</Dialog>

<Dialog bind:open={setupOpen} title="{setupTitle(setupPlan)} on {setupFor?.name}">
	{#if planning}
		<p class="muted">Looking at the machine…</p>
	{:else if setupJob && setupJob.state !== 'running' && setupJob.state === 'succeeded' && setupPlan?.kind === 'install' && !setupKind(setupFor?.report)}
		<p>
			NepFleet runs on {setupFor?.name}. Back up its age key, which never left the machine: without
			it, no secret of that fleet can be read.
		</p>
		<pre class="log">ssh {setupFor?.address} cat /srv/nepfleet/age.key</pre>
		<p>Then connect, to manage its stacks from here.</p>
	{:else if setupPlan}
		{#if setupPlan.error}<p class="error" role="alert">{setupPlan.error}</p>{/if}
		{#if setupPlan.steps.length}
			<p>{setupPlan.error ? 'It would need:' : 'This runs on the machine, in order:'}</p>
			<ol>
				{#each setupPlan.steps as s, i (i)}
					<li>
						{s.text}{#if s.root}<strong> (as root)</strong>{/if}
					</li>
				{/each}
			</ol>
		{/if}
		{#if needsPassword && setupPlan.id}
			<label class="password">
				Sudo password of {setupFor?.report?.user ?? 'your user'} on {setupFor?.name}
				<input
					type="password"
					autocomplete="off"
					spellcheck="false"
					bind:value={sudoPassword}
					onkeydown={(e) => {
						if (e.key === 'Enter' && sudoPassword) void runSetup();
					}}
				/>
				<span class="muted"
					>For the steps marked as root, this run only. It's sent over SSH to sudo on the machine,
					and kept nowhere.</span
				>
			</label>
		{/if}
	{/if}
	{#if setupJob}
		<p role="status">
			{setupJob.state === 'running'
				? 'Running…'
				: setupJob.state === 'succeeded'
					? 'Done.'
					: `Failed: ${setupJob.error ?? ''}`}
		</p>
		{#if setupJob.log}<pre class="log">{setupJob.log}</pre>{/if}
	{/if}
	{#if setupError}<p class="error" role="alert">{setupError}</p>{/if}
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (setupOpen = false)}>
			{setupRunning ? 'Close (it keeps running)' : 'Close'}
		</Button>
		{#if setupFor && !setupKind(setupFor.report) && setupJob?.state === 'succeeded'}
			<Button
				variant="primary"
				onclick={() => {
					setupOpen = false;
					if (setupFor) void act(setupFor, 'connect');
				}}>Connect</Button
			>
		{:else if setupPlan?.id && !setupRunning && setupJob?.state !== 'succeeded'}
			<Button variant="primary" onclick={runSetup} disabled={needsPassword && !sudoPassword}
				>Run this plan</Button
			>
		{:else if setupPlan?.id && setupJob?.state === 'succeeded'}
			<Button variant="primary" onclick={runSetup} disabled={needsPassword && !sudoPassword}
				>Run the next plan</Button
			>
		{/if}
	{/snippet}
</Dialog>

<Dialog bind:open={removeOpen} title="Remove {removing?.name}?">
	<p>
		This disconnects and forgets it here. Nothing changes on the machine itself, apart from revoking
		this computer's token.
	</p>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (removeOpen = false)}>Cancel</Button>
		<Button variant="primary" onclick={confirmRemove}>Remove</Button>
	{/snippet}
</Dialog>

<style>
	header p,
	.muted {
		color: var(--muted);
	}
	h1 {
		margin: 0 0 0.25rem;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
	}
	.error {
		color: var(--err);
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
		padding: 1rem 1.1rem;
		margin: 1rem 0;
	}
	.card p {
		margin: 0.3rem 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: 32rem;
	}
	form.inline {
		flex-direction: row;
		flex-wrap: wrap;
		max-width: none;
	}
	form.inline input {
		flex: 1 1 12rem;
	}
	.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	pre {
		white-space: pre-wrap;
		word-break: break-all;
		font-size: 0.85em;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.remotes {
		list-style: none;
		padding: 0;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.6rem;
	}
	.state {
		font-size: 0.85em;
	}
	.state.up {
		color: var(--ok);
	}
	.state.down {
		color: var(--err);
	}
	.password {
		display: grid;
		gap: 0.3rem;
		margin-top: 0.75rem;
	}
	.log {
		overflow: auto;
		max-height: 18rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.6rem 0.8rem;
		font-size: 0.85em;
		white-space: pre-wrap;
	}
</style>
