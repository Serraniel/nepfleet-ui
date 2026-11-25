<script lang="ts">
	import Spinner from '#lib/ui/Spinner.svelte';
	import {
		type Backend,
		type MailSettings,
		type MailTLS,
		type MailUpdate,
		ConflictError,
		VerifyFirstError,
		fetchMail,
		saveMail,
		testMail
	} from '#lib/backend.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import Button from '#lib/ui/Button.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	type Props = { backend: Backend; token: string; label: string };
	let { backend, token, label }: Props = $props();
	const uid = $props.id();

	const defaultPort: Record<MailTLS, number> = { starttls: 587, tls: 465, none: 25 };

	let loaded = $state<MailSettings | null | undefined>(undefined);
	let loadError = $state('');
	let host = $state('');
	let port = $state('');
	let user = $state('');
	let from = $state('');
	let tls = $state<MailTLS>('starttls');
	// Write-only: never filled from the backend, cleared once saved.
	let password = $state('');
	let clearPassword = $state(false);
	let saving = $state(false);
	let removing = $state(false);
	let confirmRemove = $state(false);
	let result = $state<{ ok: boolean; text: string } | null>(null);
	let to = $state('');
	let sending = $state(false);
	let testResult = $state<{ ok: boolean; text: string } | null>(null);

	const portError = $derived(
		port !== '' && !/^\d{1,5}$/.test(port.trim()) ? 'A port number, or empty for the default' : ''
	);
	const busy = $derived(saving || removing);

	async function load() {
		loadError = '';
		try {
			const m = await fetchMail(backend, token);
			loaded = m;
			if (m?.configured) {
				host = m.host;
				port =
					m.port && m.port !== defaultPort[(m.tls || 'starttls') as MailTLS] ? String(m.port) : '';
				user = m.user;
				from = m.from;
				tls = (m.tls || 'starttls') as MailTLS;
			}
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void load();
	});

	/** Runs a change, confirming with a passkey first when the backend asks. */
	async function withVerify(change: () => Promise<string>): Promise<string> {
		try {
			return await change();
		} catch (e) {
			if (!(e instanceof VerifyFirstError)) throw e;
			await verifyIdentity(backend);
			return await change();
		}
	}

	function message(e: unknown): string {
		if (e instanceof ConflictError) return `${e.message}. Try again in a moment.`;
		return e instanceof Error ? e.message : String(e);
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!host.trim() || portError || busy) return;
		const update: MailUpdate = { host: host.trim(), tls };
		if (port.trim()) update.port = Number(port.trim());
		if (user.trim()) update.user = user.trim();
		if (from.trim()) update.from = from.trim();
		if (password) update.password = password;
		else if (clearPassword) update.password = '';
		saving = true;
		result = null;
		try {
			const commit = await withVerify(() => saveMail(backend, token, update));
			result = {
				ok: true,
				text: `Saved in ${commit.slice(0, 7)}. Stacks that use it apply again.`
			};
			password = '';
			clearPassword = false;
			await load();
		} catch (e) {
			result = { ok: false, text: message(e) };
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (!confirmRemove) {
			confirmRemove = true; // a second click removes them
			return;
		}
		confirmRemove = false;
		removing = true;
		result = null;
		try {
			const commit = await withVerify(() => saveMail(backend, token, null));
			result = { ok: true, text: `Removed in ${commit.slice(0, 7)}.` };
			host = port = user = from = password = '';
			tls = 'starttls';
			await load();
		} catch (e) {
			result = { ok: false, text: message(e) };
		} finally {
			removing = false;
		}
	}

	async function sendTest(event: SubmitEvent) {
		event.preventDefault();
		if (!to.trim()) return;
		sending = true;
		testResult = null;
		try {
			await testMail(backend, token, to.trim());
			testResult = { ok: true, text: 'Sent. Check that it arrived.' };
		} catch (e) {
			testResult = { ok: false, text: message(e) };
		} finally {
			sending = false;
		}
	}
</script>

{#if loadError}
	<p class="error" role="alert">{loadError}</p>
{:else if loaded === undefined}
	<p><Spinner label="Loading…" /></p>
{:else if loaded === null}
	<p class="muted">This backend's NepFleet is too old for mail settings.</p>
{:else}
	<form class="mail" onsubmit={save} aria-label="Mail settings of {label}">
		<TextField
			label="SMTP server"
			bind:value={host}
			placeholder="smtp.example.org"
			autocomplete="off"
			spellcheck="false"
			required
		/>
		<div class="select">
			<!-- Labelled by id: a wrapping label would add the chosen option to its name. -->
			<label for="mail-tls-{uid}">Encryption</label>
			<select id="mail-tls-{uid}" bind:value={tls}>
				<option value="starttls">STARTTLS (port 587)</option>
				<option value="tls">TLS (port 465)</option>
				<option value="none">None (a relay on the same network)</option>
			</select>
		</div>
		<TextField
			label="Port"
			bind:value={port}
			inputmode="numeric"
			placeholder={String(defaultPort[tls])}
			error={portError}
		/>
		<TextField label="User" bind:value={user} autocomplete="off" spellcheck="false" />
		<TextField
			label="Password"
			type="password"
			bind:value={password}
			autocomplete="new-password"
			hint={loaded.passwordSet ? 'Stored. Leave empty to keep it.' : undefined}
		/>
		<TextField
			label="From"
			bind:value={from}
			placeholder="NepFleet <fleet@example.org>"
			autocomplete="off"
			spellcheck="false"
		/>
		{#if loaded.passwordSet}
			<label class="check">
				<input type="checkbox" bind:checked={clearPassword} disabled={password !== ''} />
				Remove the stored password
			</label>
		{/if}
		<div class="actions">
			<Button
				type="submit"
				variant="primary"
				busy={saving}
				disabled={!host.trim() || !!portError || removing}
			>
				Save mail settings
			</Button>
			{#if loaded.configured}
				<Button
					variant={confirmRemove ? 'danger' : 'ghost'}
					busy={removing}
					disabled={saving}
					onclick={remove}
				>
					{confirmRemove ? 'Remove for good' : 'Remove…'}
				</Button>
			{/if}
		</div>
	</form>
	{#if result}<p
			class:error={!result.ok}
			class:muted={result.ok}
			role={result.ok ? 'status' : 'alert'}
		>
			{result.text}
		</p>{/if}

	{#if loaded.configured}
		<form class="test" onsubmit={sendTest} aria-label="Send a test mail from {label}">
			<TextField
				label="Send a test mail to"
				type="email"
				bind:value={to}
				autocomplete="email"
				required
			/>
			<Button type="submit" busy={sending} disabled={!to.trim()}>Send test mail</Button>
		</form>
		{#if testResult}<p
				class:error={!testResult.ok}
				class:muted={testResult.ok}
				role={testResult.ok ? 'status' : 'alert'}
			>
				{testResult.text}
			</p>{/if}
	{/if}
{/if}

<style>
	/* Labels on one line, inputs on one line; the buttons get their own row. */
	.mail {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem 1rem;
		align-items: start;
	}
	.select {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.select label {
		font-weight: 600;
		font-size: 0.9rem;
	}
	.check {
		grid-column: 1 / -1;
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.actions {
		grid-column: 1 / -1;
		display: flex;
		gap: 0.5rem;
	}
	.test {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: end;
		margin-top: 1rem;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
