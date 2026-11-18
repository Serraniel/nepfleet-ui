<script lang="ts">
	import { type Backend, type NotifyRoute, fetchRoutes, saveRoutes } from '#lib/backend.ts';
	import Button from '#lib/ui/Button.svelte';
	import Spinner from '#lib/ui/Spinner.svelte';

	type Props = { backend: Backend; token: string; channels: string[] };
	let { backend, token, channels }: Props = $props();

	/** A route as the form edits it: lists as comma-separated text. */
	type Draft = {
		channels: string[];
		events: string;
		stacks: string;
		minSeverity: '' | 'info' | 'warning' | 'error';
	};

	let loaded = $state<'loading' | 'old' | 'ok' | { error: string }>('loading');
	let drafts = $state<Draft[]>([]);
	let saving = $state(false);
	let status = $state('');
	let error = $state('');
	let dirty = $state(false);

	const toDraft = (r: NotifyRoute): Draft => ({
		channels: [...r.channels],
		events: r.events.join(', '),
		stacks: r.stacks.join(', '),
		minSeverity: r.minSeverity ?? ''
	});
	const list = (s: string) =>
		s
			.split(',')
			.map((x) => x.trim())
			.filter(Boolean);
	const toRoute = (d: Draft): NotifyRoute => ({
		channels: d.channels,
		events: list(d.events),
		stacks: list(d.stacks),
		...(d.minSeverity ? { minSeverity: d.minSeverity } : {})
	});

	async function load() {
		loaded = 'loading';
		try {
			const rs = await fetchRoutes(backend, token);
			if (rs === null) {
				loaded = 'old';
				return;
			}
			drafts = rs.map(toDraft);
			dirty = false;
			loaded = 'ok';
		} catch (e) {
			loaded = { error: e instanceof Error ? e.message : String(e) };
		}
	}
	$effect(() => {
		void backend;
		void token;
		void load();
	});

	function add() {
		drafts.push({ channels: channels.slice(0, 1), events: '', stacks: '', minSeverity: '' });
		dirty = true;
	}
	function remove(i: number) {
		drafts.splice(i, 1);
		dirty = true;
	}
	function toggle(d: Draft, c: string, on: boolean) {
		d.channels = on ? [...new Set([...d.channels, c])] : d.channels.filter((x) => x !== c);
		dirty = true;
	}

	const empty = $derived(drafts.findIndex((d) => d.channels.length === 0));

	async function save() {
		saving = true;
		error = '';
		status = '';
		try {
			const commit = await saveRoutes(backend, token, drafts.map(toRoute));
			status = `Saved as commit ${commit.slice(0, 7)}.`;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}
</script>

<div class="routes">
	<h4>Routes: which notifications go where</h4>
	{#if loaded === 'loading'}
		<Spinner label="Loading routes…" />
	{:else if loaded === 'old'}
		<p class="muted">This backend's NepFleet is too old to edit routes here.</p>
	{:else if typeof loaded === 'object'}
		<p class="error">{loaded.error}</p>
	{:else}
		<p class="muted small">
			Each route sends the events it matches to its channels. Events are names or patterns (<code
				>apply.*</code
			>, <code>update.available</code>); stacks limit it to those. Empty means all. A notification
			goes to every route it matches.
		</p>
		{#if drafts.length === 0}
			<p class="muted">No routes: nothing is sent.</p>
		{/if}
		<ol>
			{#each drafts as d, i (i)}
				<li>
					<fieldset>
						<legend>Route {i + 1}</legend>
						<div class="chans">
							{#each channels as c (c)}
								<label
									><input
										type="checkbox"
										checked={d.channels.includes(c)}
										onchange={(e) => toggle(d, c, e.currentTarget.checked)}
									/>
									<code>{c}</code></label
								>
							{/each}
						</div>
						<label
							>Events
							<input
								bind:value={d.events}
								oninput={() => (dirty = true)}
								placeholder="all"
								spellcheck="false"
							/></label
						>
						<label
							>Stacks
							<input
								bind:value={d.stacks}
								oninput={() => (dirty = true)}
								placeholder="all"
								spellcheck="false"
							/></label
						>
						<label
							>At least
							<select bind:value={d.minSeverity} onchange={() => (dirty = true)}>
								<option value="">any severity</option>
								<option value="info">info</option>
								<option value="warning">warning</option>
								<option value="error">error</option>
							</select></label
						>
						<Button variant="ghost" onclick={() => remove(i)}>Remove route</Button>
					</fieldset>
				</li>
			{/each}
		</ol>
		<div class="row">
			<Button variant="ghost" onclick={add} disabled={channels.length === 0}>Add a route</Button>
			<Button onclick={save} busy={saving} disabled={!dirty || empty >= 0}>Save routes</Button>
			{#if empty >= 0}<span class="error small">Route {empty + 1} needs a channel.</span>{/if}
		</div>
		{#if status}<p role="status">{status}</p>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	{/if}
</div>

<style>
	.routes ol {
		padding-left: 1.2rem;
	}
	fieldset {
		display: grid;
		gap: 0.4rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		padding: 0.5rem 0.75rem;
		margin: 0 0 0.5rem;
	}
	.chans {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	label {
		display: grid;
		gap: 0.15rem;
	}
	.chans label {
		display: flex;
		gap: 0.3rem;
		align-items: center;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
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
</style>
