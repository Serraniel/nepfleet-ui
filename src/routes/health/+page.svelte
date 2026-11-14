<script lang="ts">
	import { onMount } from 'svelte';
	import { type DoctorReport, fetchDoctor } from '#lib/backend.ts';
	import { backends } from '#lib/backends.svelte.ts';
	import { local } from '#lib/local.svelte.ts';
	import { tokens } from '#lib/stacks.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';

	type Load =
		| { state: 'loading' }
		| { state: 'ok'; value: DoctorReport | null }
		| { state: 'error'; error: string };

	let byBackend = $state<Record<string, Load>>({});

	const connected = $derived(backends.list.filter((b) => tokens.byBackend[b.id]));

	async function run(id: string) {
		const b = backends.list.find((x) => x.id === id);
		const token = tokens.byBackend[id];
		if (!b || !token) return;
		byBackend[id] = { state: 'loading' };
		try {
			byBackend[id] = { state: 'ok', value: await fetchDoctor(b, token) };
		} catch (e) {
			byBackend[id] = { state: 'error', error: e instanceof Error ? e.message : String(e) };
		}
	}

	onMount(() => {
		void local.refresh().then(() => {
			for (const b of connected) void run(b.id);
		});
	});

	const order = { fail: 0, warn: 1, ok: 2 } as const;
	const sorted = (r: DoctorReport) =>
		[...r.checks].sort((a, b) => order[a.status] - order[b.status]);
	const label = { ok: 'OK', warn: 'Warning', fail: 'Problem' } as const;
	const levelBad = (level: string) => /high|crit|fail|error/i.test(level);
</script>

<header>
	<h1>Health</h1>
	<p>
		Each backend checks its own host, as <code>nepfleet doctor</code> does: Docker, the age key, ports,
		devices and shared folders the stacks need, backups, and the host's security (SSH, firewall, open
		ports, updates). Needs an admin token or a sign-in.
	</p>
</header>

{#if connected.length === 0}
	<EmptyState title="No backend with a token">
		Add an API token for a backend on the <a href="/stacks">Stacks</a> page.
	</EmptyState>
{:else}
	{#each connected as b (b.id)}
		{@const st = byBackend[b.id]}
		<section aria-label={b.label ?? b.url}>
			<h2>{b.label ?? new URL(b.url).host}</h2>
			<Button variant="ghost" disabled={st?.state === 'loading'} onclick={() => run(b.id)}
				>Check again</Button
			>
			{#if !st || st.state === 'loading'}
				<p class="muted" role="status">Checking the host…</p>
			{:else if st.state === 'error'}
				<p class="error" role="alert">{st.error}</p>
			{:else if st.value === null}
				<p class="muted">
					This backend's NepFleet is too old to check itself from here; update it.
				</p>
			{:else}
				{@const r = st.value}
				<p class="muted">Host {r.host}, {r.stacks} stack(s) planned there.</p>
				<ul class="checks">
					{#each sorted(r) as c, i (i)}
						<li class={c.status}>
							<span class="badge">{label[c.status]}</span>
							<strong>{c.name}</strong>
							<span>{c.detail}</span>
							{#if c.fix && c.status !== 'ok'}<span class="fix">→ {c.fix}</span>{/if}
						</li>
					{/each}
				</ul>
				<h3>Security</h3>
				{#if r.securityError}
					<p class="error">The security check couldn't run: {r.securityError}</p>
				{:else if r.security.length === 0}
					<p class="muted">Nothing found.</p>
				{:else}
					<ul class="checks">
						{#each r.security as f, i (i)}
							<li class={levelBad(f.level) ? 'fail' : 'warn'}>
								<span class="badge">{f.level}</span>
								<strong>{f.check}</strong>
								<span>{f.message}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</section>
	{/each}
{/if}

<style>
	.checks {
		list-style: none;
		padding: 0;
	}
	.checks li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.3rem 0;
		border-top: 1px solid var(--border);
	}
	.badge {
		font-size: 0.8em;
		padding: 0 0.4em;
		border-radius: 0.3em;
		border: 1px solid currentColor;
	}
	li.fail .badge {
		color: var(--err);
		font-weight: 600;
	}
	li.ok .badge {
		color: var(--muted);
	}
	.fix {
		flex-basis: 100%;
		color: var(--muted);
		padding-left: 1rem;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
