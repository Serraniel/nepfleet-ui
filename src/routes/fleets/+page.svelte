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
		startSetup,
		type SetupKind,
		fetchSettings,
		saveSettings,
		runDoctor,
		type DoctorCheck,
		checkHostUpdates,
		describeHostUpdates,
		type HostUpdates,
		updateOffer
	} from '#lib/local.ts';
	import TextField from '#lib/ui/TextField.svelte';
	import { ago, loadChecked, saveChecked } from '#lib/hostupdates-cache.ts';
	import { ConflictError, dnsDomain } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import DNSRecordsFix from '#lib/DNSRecordsFix.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import ProgressBar from '#lib/ui/ProgressBar.svelte';
	import Spinner from '#lib/ui/Spinner.svelte';
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
	/** Per machine: the action running on it, if any. */
	let busy = $state<Record<string, string>>({});
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
			// One key is usually enough: try again with it. Only if the machine
			// still refuses does the next refusal name the remaining keys (those
			// already unlocked aren't listed again), and this asks for them.
			unlockKeys = [];
			unlockOpen = false;
			const retry = afterUnlock;
			afterUnlock = null;
			if (retry) await retry();
			else await local.refresh();
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

	/** Per machine: nepfleet doctor's last answer. */
	let doctor = $state<Record<string, { checks?: DoctorCheck[]; error?: string }>>({});

	async function checkNepFleet(r: Remote) {
		busy[r.name] = 'doctor';
		try {
			const checks = await runDoctor(local.url, local.token, r.name);
			// Problems first, the worst on top.
			const rank = { fail: 0, warn: 1, ok: 2 };
			doctor[r.name] = { checks: checks.toSorted((a, b) => rank[a.status] - rank[b.status]) };
		} catch (e) {
			doctor[r.name] = { error: e instanceof Error ? e.message : String(e) };
		} finally {
			delete busy[r.name];
		}
	}

	/** Per machine: its package manager's last answer. */
	// The last answers are remembered in this browser, so the overview stands
	// without checking every machine again.
	let hostUpdates =
		$state<Record<string, { value?: HostUpdates; error?: string; at?: string }>>(loadChecked());

	function remember() {
		const keep: Record<string, { value: HostUpdates; at: string }> = {};
		for (const [name, u] of Object.entries(hostUpdates))
			if (u.value && u.at) keep[name] = { value: $state.snapshot(u.value), at: u.at };
		saveChecked(keep);
	}

	async function checkUpdates(r: Remote) {
		busy[r.name] = 'updates';
		try {
			const value = await checkHostUpdates(local.url, local.token, r.name);
			hostUpdates[r.name] = { value, at: new Date().toISOString() };
			remember();
		} catch (e) {
			// The last good answer stays beside the error.
			hostUpdates[r.name] = {
				...hostUpdates[r.name],
				error: e instanceof Error ? e.message : String(e)
			};
		} finally {
			delete busy[r.name];
		}
	}

	/** Linux machines whose host updates can be checked. */
	const linuxRemotes = $derived(local.remotes.filter((r) => r.report?.kernel === 'Linux'));
	let checkingAll = $state(false);

	/** The machines with a remembered answer, for the overview. */
	const overview = $derived(
		linuxRemotes.flatMap((r) => {
			const u = hostUpdates[r.name];
			return u?.value && u.at ? [{ name: r.name, value: u.value, at: u.at }] : [];
		})
	);

	/** Checks every Linux machine's pending updates at once, each as its own button would. */
	async function checkAllUpdates() {
		checkingAll = true;
		try {
			await Promise.all(linuxRemotes.filter((r) => !busy[r.name]).map((r) => checkUpdates(r)));
		} finally {
			checkingAll = false;
		}
	}

	async function act(r: Remote, action: 'refresh' | 'connect' | 'disconnect') {
		busy[r.name] = action;
		actionError = '';
		try {
			await remoteAction(local.url, local.token, r.name, action);
			await local.refresh();
		} catch (e) {
			actionError = `${r.name}: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			delete busy[r.name];
		}
	}

	async function confirmRemove() {
		const r = removing;
		if (!r) return;
		removeOpen = false;
		busy[r.name] = 'remove';
		actionError = '';
		try {
			await removeRemote(local.url, local.token, r.name);
			await local.refresh();
		} catch (e) {
			actionError = `${r.name}: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			delete busy[r.name];
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

	/** The kind asked for: titles the dialog also when planning failed. */
	let setupAsked = $state<SetupKind | null>(null);

	async function planSetup(r: Remote, explicit?: SetupKind) {
		const kind = explicit ?? setupKind(r.report);
		setupAsked = kind ?? null;
		setupPlan = null;
		setupError = '';
		if (!kind) {
			setupError = `There's nothing to set up on ${r.name}: NepFleet runs there already.`;
			return;
		}
		planning = true;
		try {
			setupPlan = await fetchSetupPlan(local.url, local.token, r.name, kind);
		} catch (e) {
			if (e instanceof LockedKeyError) {
				// Shown if the unlock is cancelled; planning again replaces it.
				setupError = e.message;
				askUnlock(e.keys, () => planSetup(r, kind));
				return;
			}
			setupError = e instanceof Error ? e.message : String(e);
		} finally {
			planning = false;
		}
	}

	function openSetup(r: Remote, kind?: SetupKind) {
		setupFor = r;
		setupJob = null;
		setupOpen = true;
		void planSetup(r, kind);
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
			if (e instanceof ConflictError) void planSetup(r, p.kind);
		}
	}

	const setupRunning = $derived(setupJob?.state === 'running');
	const needsPassword = $derived(!!setupPlan?.sudoPassword && !setupRunning);
	const setupTitles: Record<SetupKind, string> = {
		bootstrap: 'Prepare the machine',
		install: 'Install NepFleet',
		update: 'Update NepFleet',
		start: 'Start NepFleet',
		repair: 'Repair NepFleet',
		'host-update': 'Update the host',
		reboot: 'Reboot the machine',
		'ssh-harden': 'Turn off SSH password logins',
		mounts: 'Network mounts'
	};
	const setupTitle = (p: SetupPlan | null) => setupTitles[p?.kind ?? setupAsked ?? 'bootstrap'];

	// The local fleet repository folder: mounts are planned from its hosts/.
	let fleetDir = $state('');
	let fleetDirSaved = $state('');
	let fleetDirError = $state('');
	async function loadSettings() {
		try {
			fleetDirSaved = (await fetchSettings(local.url, local.token)).fleetDir ?? '';
			fleetDir = fleetDirSaved;
		} catch {
			// an older daemon: no settings
		}
	}
	async function saveFleetDir(e: SubmitEvent) {
		e.preventDefault();
		fleetDirError = '';
		try {
			fleetDirSaved =
				(await saveSettings(local.url, local.token, { fleetDir: fleetDir.trim() })).fleetDir ?? '';
		} catch (err) {
			fleetDirError = err instanceof Error ? err.message : String(err);
		}
	}
	$effect(() => {
		if (local.connected) void loadSettings();
	});

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
	{#if linuxRemotes.length > 1}
		<Button
			onclick={checkAllUpdates}
			busy={checkingAll}
			title="Asks every machine's package manager what it has pending; installs nothing"
			>Check host updates on all {linuxRemotes.length} machines</Button
		>
	{/if}
	{#if overview.length}
		<table class="hosts" aria-label="Host updates per machine, as last checked">
			<thead>
				<tr
					><th scope="col">Machine</th><th scope="col">OS</th><th scope="col">Updates</th><th
						scope="col">Security</th
					><th scope="col">Reboot</th><th scope="col">Checked</th></tr
				>
			</thead>
			<tbody>
				{#each overview as o (o.name)}
					{@const v = o.value}
					<tr>
						<th scope="row"><a href="#machine-{o.name}">{o.name}</a></th>
						<td>{v.os}</td>
						<td
							>{#if !v.supported}<span class="muted">can't check</span
								>{:else}{v.pending}{#if v.fresh === false}<span
										class="muted"
										title="Only as new as the package lists"
									>
										(lists)</span
									>{/if}{/if}</td
						>
						<td class:warn={v.security > 0}>{v.security < 0 ? '?' : v.security}</td>
						<td class:warn={v.rebootRequired === true}
							>{v.rebootRequired === null ? '?' : v.rebootRequired ? 'needed' : 'no'}</td
						>
						<td class="muted">{ago(o.at)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
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
			<Button variant="primary" type="submit" busy={connecting}>
				{connecting ? 'Connecting…' : 'Connect'}
			</Button>
		</form>
		{#if connectError}<p class="error" role="alert">{connectError}</p>{/if}
	</section>
{:else}
	<div class="row">
		<p class="muted">
			Control daemon at <code>{local.url}</code>{#if local.version}, NepFleet {local.version}{#if local.commit}
					<code title={local.commit}>{local.commit.slice(0, 7)}</code>{/if}{/if}
		</p>
		{#if desktop}
			<Button
				variant="ghost"
				busy={local.restartingDaemon}
				onclick={() => local.restartDaemon()}
				title="Stop the daemon and start the nepfleet installed now. Tunnels come back by themselves."
				>{local.restartingDaemon ? 'Restarting…' : 'Restart the daemon'}</Button
			>
		{:else}
			<Button variant="ghost" onclick={() => local.disconnect()}>Forget token</Button>
		{/if}
	</div>
	{#if desktop && local.outdated && local.installed}
		<p class="notice" role="status">
			NepFleet was updated to {local.installed.version}{#if local.installed.commit}
				({local.installed.commit.slice(0, 7)}){/if}, but the daemon still runs the build it started
			with. Restart it to use the new one.
			<Button variant="primary" busy={local.restartingDaemon} onclick={() => local.restartDaemon()}
				>Restart the daemon</Button
			>
		</p>
	{/if}
	{#if local.restartError}<p class="error" role="alert">{local.restartError}</p>{/if}
	{#if local.error}<p class="error" role="alert">{local.error}</p>{/if}

	<section class="card" aria-labelledby="fleetdir-h">
		<h2 id="fleetdir-h">Fleet repository on this computer</h2>
		<p class="muted">
			For a machine's network mounts: they're planned from <code>hosts/&lt;machine&gt;.yaml</code>
			in your local copy of the fleet repository, and share passwords are decrypted with this computer's
			age key. They go only to the machine, never to the NepFleet server.
		</p>
		<form class="stacked" onsubmit={saveFleetDir}>
			<TextField
				label="Folder"
				bind:value={fleetDir}
				placeholder="/home/you/fleet"
				error={fleetDirError}
				hint={fleetDirSaved ? `Using ${fleetDirSaved}` : 'Not set'}
			/>
			<Button type="submit" disabled={fleetDir.trim() === fleetDirSaved}>Save</Button>
		</form>
	</section>

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
			<Button variant="primary" type="submit" busy={adding}>
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
				<li class="card" id="machine-{r.name}">
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
							<Button variant="primary" onclick={() => openSetup(r)} disabled={!!busy[r.name]}
								>{setupKind(r.report) === 'bootstrap'
									? 'Prepare this machine…'
									: 'Install NepFleet…'}</Button
							>
						{/if}
						{#if r.connect}
							<Button
								onclick={() => act(r, 'disconnect')}
								disabled={!!busy[r.name]}
								busy={busy[r.name] === 'disconnect'}>Disconnect</Button
							>
						{:else if canConnect(r.report)}
							<Button
								onclick={() => act(r, 'connect')}
								disabled={!!busy[r.name]}
								busy={busy[r.name] === 'connect'}>Connect</Button
							>
						{/if}
						{#if r.report && !setupKind(r.report)}
							<Button onclick={() => openSetup(r, 'mounts')} disabled={!!busy[r.name]}
								>Network mounts…</Button
							>
						{/if}
						<Button
							onclick={() => act(r, 'refresh')}
							disabled={!!busy[r.name]}
							busy={busy[r.name] === 'refresh'}>Check again</Button
						>
						{#if updateOffer(r.report, local.version)}
							<Button
								variant="primary"
								onclick={() => openSetup(r, 'update')}
								disabled={!!busy[r.name]}
								title={local.version === 'edge'
									? 'Updates it to the newest build of main (the signed :edge image), to test before a release'
									: 'This machine runs an older NepFleet than this app'}
								>Update NepFleet to {updateOffer(r.report, local.version)}…</Button
							>
						{/if}
						{#if r.report?.nepfleet || r.report?.nepfleetRunning}
							<Button
								onclick={() => checkNepFleet(r)}
								disabled={!!busy[r.name]}
								busy={busy[r.name] === 'doctor'}
								title="Runs nepfleet doctor on the machine over SSH">Check NepFleet</Button
							>
						{/if}
						{#if r.report?.kernel === 'Linux'}
							<Button
								onclick={() => checkUpdates(r)}
								disabled={!!busy[r.name]}
								busy={busy[r.name] === 'updates'}
								title="Asks the machine's package manager over SSH what it has pending; installs nothing"
								>Check host updates</Button
							>
							<Button
								variant="ghost"
								onclick={() => openSetup(r, 'ssh-harden')}
								disabled={!!busy[r.name]}
								title="Plans it for you to review: only keys can log in afterwards, as this app already does"
								>Turn off SSH password logins…</Button
							>
						{/if}
						<Button
							variant="ghost"
							onclick={() => {
								removing = r;
								removeOpen = true;
							}}
							disabled={!!busy[r.name]}
							busy={busy[r.name] === 'remove'}>Remove…</Button
						>
					</div>
					{#if hostUpdates[r.name]}
						{@const u = hostUpdates[r.name]!}
						<div class="host-updates" aria-label="Pending host updates on {r.name}">
							{#if u.error}
								<p class="error" role="alert">Host updates: {u.error}</p>
							{/if}
							{#if u.value}
								<p role="status">
									{describeHostUpdates(u.value)}
									{#if u.at}<span class="muted">· checked {ago(u.at)}</span>{/if}
								</p>
								{#if (u.value.supported && u.value.pending > 0) || u.value.rebootRequired}
									<p class="host-actions">
										{#if u.value.supported && u.value.pending > 0}
											<Button
												onclick={() => openSetup(r, 'host-update')}
												disabled={!!busy[r.name]}
												title="Plans the update for you to review; nothing runs until you start it"
												>Update the host…</Button
											>
										{/if}
										{#if u.value.rebootRequired}
											<Button
												onclick={() => openSetup(r, 'reboot')}
												disabled={!!busy[r.name]}
												title="Plans the reboot and the check afterwards; nothing runs until you start it"
												>Reboot…</Button
											>
										{/if}
									</p>
								{/if}
								{#if u.value.packages?.length}
									<details>
										<summary>Packages</summary>
										<p class="packages">
											{u.value.packages.join(', ')}{u.value.pending > u.value.packages.length
												? ` and ${u.value.pending - u.value.packages.length} more`
												: ''}
										</p>
									</details>
								{/if}
								{#if u.value.news?.length}
									<div class="news" role="alert">
										<strong>Arch news since the last update: read it before updating.</strong>
										<ul>
											{#each u.value.news as n, i (i)}
												<li>
													{#if n.link}<a href={n.link} target="_blank" rel="noopener noreferrer"
															>{n.title}</a
														>{:else}{n.title}{/if}
													<span class="muted">({new Date(n.published).toLocaleDateString()})</span>
												</li>
											{/each}
										</ul>
									</div>
								{/if}
								{#each u.value.notes ?? [] as note, i (i)}<p class="muted">{note}</p>{/each}
							{/if}
						</div>
					{/if}
					{#if doctor[r.name]}
						{@const d = doctor[r.name]!}
						<div class="doctor" aria-label="NepFleet checks on {r.name}">
							{#if d.error}
								<p class="error" role="alert">Doctor: {d.error}</p>
							{:else if d.checks}
								{@const problems = d.checks.filter((c) => c.status !== 'ok')}
								<p role="status">
									{problems.length === 0
										? `All ${d.checks.length} checks pass.`
										: `${problems.length} of ${d.checks.length} checks need attention.`}
								</p>
								<ul>
									{#each problems as c, i (i)}
										<li class={c.status}>
											<strong>{c.status === 'fail' ? '✗' : '⚠'} {c.name}</strong>
											{#if c.detail}<span>{c.detail}</span>{/if}
											{#if c.fix}<span class="fix">Fix: <code>{c.fix}</code></span>{/if}
											{#if c.action === 'dns-records'}
												{@const live = backends.list.find((b) => b.id === 'local:' + r.name)}
												{#if live && !problems.slice(0, i).some((p) => p.action === 'dns-records')}
													<DNSRecordsFix
														backend={live}
														token={tokens.byBackend[live.id] ?? ''}
														domain={dnsDomain(c.detail ?? '')}
													/>
												{:else if !live}
													<span class="muted"
														>Connect to {r.name} to let its Caddy create the records from here.</span
													>
												{/if}
											{:else if c.action}
												{@const kind = c.action}
												<span
													><Button onclick={() => openSetup(r, kind)} disabled={!!busy[r.name]}
														>{setupTitles[kind]}…</Button
													></span
												>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<Dialog bind:open={unlockOpen} title="Unlock your SSH key">
	<form id="unlock-form" onsubmit={submitUnlock}>
		<p>
			<code>{unlockKeys[0]}</code> has a passphrase. NepFleet's SSH runs in the background, without
			a terminal to ask on, so it keeps the key unlocked in an SSH agent for 8 hours.
			{#if unlockKeys.length > 1}If the machine doesn't take this key, NepFleet asks for the next
				one ({unlockKeys.slice(1).join(', ')}).{/if}
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
		<Button
			variant="primary"
			type="submit"
			form="unlock-form"
			busy={unlocking}
			disabled={!passphrase}>{unlocking ? 'Unlocking…' : 'Unlock'}</Button
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
		{#if setupPlan.kind === 'host-update' && setupFor && hostUpdates[setupFor.name]?.value?.news?.length}
			<div class="news" role="alert">
				<strong>Read the Arch news since this machine's last update first:</strong>
				<ul>
					{#each hostUpdates[setupFor.name]!.value!.news! as n, i (i)}
						<li>
							{#if n.link}<a href={n.link} target="_blank" rel="noopener noreferrer">{n.title}</a
								>{:else}{n.title}{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
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
		{#if setupJob.state === 'running' && setupJob.progress}
			<ProgressBar {...setupJob.progress} />
		{:else}
			<p role="status">
				{#if setupJob.state === 'running'}<Spinner
						label="Running…"
					/>{:else if setupJob.state === 'succeeded'}Done.{:else}Failed:
					{setupJob.error ?? ''}{/if}
			</p>
		{/if}
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
	.doctor ul {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: grid;
		gap: 0.5rem;
	}
	.doctor li {
		display: grid;
		gap: 0.15rem;
		padding-left: 0.6rem;
		border-left: 3px solid var(--warn);
	}
	.doctor li.fail {
		border-left-color: var(--err);
	}
	.doctor .fix code {
		overflow-wrap: anywhere;
	}
	.host-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.hosts {
		border-collapse: collapse;
		margin-top: 0.75rem;
		font-size: 0.9rem;
	}
	.hosts th,
	.hosts td {
		text-align: left;
		padding: 0.2rem 0.75rem 0.2rem 0;
	}
	.hosts .warn {
		color: var(--warn);
		font-weight: 600;
	}
	.host-updates p {
		margin: 0.25rem 0;
	}
	.host-updates .news,
	.news {
		padding-left: 0.6rem;
		border-left: 3px solid var(--warn);
	}
	.news ul {
		margin: 0.25rem 0 0;
		padding-left: 1.1rem;
	}
	.host-updates .packages {
		overflow-wrap: anywhere;
		font-family: var(--mono, monospace);
		font-size: 0.85rem;
	}
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
	.notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
		padding: 0.7rem 1rem;
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
	.stacked {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
		max-width: 40rem;
	}
	.stacked :global(.field) {
		justify-self: stretch;
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
