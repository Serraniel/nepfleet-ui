<script lang="ts">
	import type { StackProblem } from '#lib/backend.ts';
	import { missingNames, problemFix, problemShort } from '#lib/problems.ts';
	import Button from '#lib/ui/Button.svelte';

	/**
	 * What keeps a stack from being planned or updated, each with how to fix
	 * it. For missing inputs, a button takes the person to the first one in
	 * the settings, where it's marked required.
	 */
	type Props = {
		problems: StackProblem[];
		/** The stack: its settings' fields are input-<stack>-<NAME>. */
		stack: string;
		/** Settings can be filled in here (a token, the inputs API). */
		canFill?: boolean;
		/** A heading of its own; inside a section that has one, leave it out. */
		heading?: boolean;
	};
	let { problems, stack, canFill = true, heading = true }: Props = $props();

	function fillIn(p: StackProblem) {
		const first = p.inputs?.[0];
		const field = first && document.getElementById(`input-${stack}-${first.name}`);
		if (!field) return;
		field.scrollIntoView({ block: 'center' });
		field.focus();
	}
</script>

{#snippet list()}
	<ul>
		{#each problems as p, i (i)}
			<li>
				<strong>{problemShort(p)}</strong>
				{#if p.kind !== 'missing-input'}<span>{p.message}</span>{/if}
				<span class="muted">{problemFix(p)}</span>
				{#if p.kind === 'missing-input' && p.inputs?.length && canFill}
					<span>
						<Button variant="primary" onclick={() => fillIn(p)}>
							Fill in {missingNames(p).join(', ')}
						</Button>
					</span>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#if problems.length}
	{#if heading}
		<section class="problems" aria-labelledby="problems-h-{stack}">
			<h2 id="problems-h-{stack}">Needs attention</h2>
			{@render list()}
		</section>
	{:else}
		<div class="problems" role="status">{@render list()}</div>
	{/if}
{/if}

<style>
	/* What the backend can't do by itself, in the warning colour. */
	.problems {
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--warn);
		border-radius: calc(var(--radius) + 4px);
	}
	h2 {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
		color: var(--warn);
	}
	ul {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
	}
	.muted {
		color: var(--muted);
	}
</style>
