<script lang="ts">
	import { type Backend, type TemplateMatches, fetchMatches } from '#lib/backend.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = { backend: Backend; backendId: string; token: string; stack: string };
	let { backend, backendId, token, stack }: Props = $props();

	let result = $state<TemplateMatches | null>(null);
	let busy = $state(false);
	let error = $state('');

	async function find() {
		busy = true;
		error = '';
		try {
			result = await fetchMatches(backend, token, stack);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const createHref = (name: string) =>
		`/templates?backend=${encodeURIComponent(backendId)}&template=${encodeURIComponent(name)}`;
</script>

<section aria-labelledby="match-h">
	<h2 id="match-h">Template</h2>
	{#if result?.template}
		<p class="muted">Made from the template <code>{result.template}</code>.</p>
	{:else if result}
		{#if result.matches.length === 0}
			<p class="muted">No template in the official catalogue runs these images.</p>
		{:else}
			<p>
				A template runs the same images: switching to it brings its updates, checks and settings.
				Create it beside this stack, compare, move the data over, then remove the old one.
			</p>
			<ul class="matches">
				{#each result.matches as m (m.source + '/' + m.name)}
					<li>
						<strong>{m.title ?? m.name}</strong>
						<span class="muted">{m.source}/{m.name} {m.version}</span>
						<ul>
							{#each m.same as i (i.image)}
								<li>
									<code>{i.image}</code>
									{i.stack === i.template
										? i.stack
										: `yours ${i.stack || '(no tag)'}, template ${i.template || '(no tag)'}`}
								</li>
							{/each}
							{#each m.onlyTemplate as i (i)}<li>
									<code>{i}</code> the template also runs this
								</li>{/each}
							{#each m.onlyStack as i (i)}<li><code>{i}</code> yours only</li>{/each}
						</ul>
						{#if m.source === 'official'}<a href={createHref(m.name)}>Create from {m.name}…</a>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		<p class="muted">Is there a catalogue template for what this stack runs?</p>
		<Button variant="ghost" disabled={busy} onclick={find}
			>{busy ? 'Looking…' : 'Find a matching template'}</Button
		>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.matches {
		list-style: none;
		padding: 0;
	}
	.matches > li {
		padding: 0.4rem 0;
		border-top: 1px solid var(--border);
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
