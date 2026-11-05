<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		tabs: { id: string; label: string }[];
		selected?: string;
		label: string;
		panel: Snippet<[string]>;
	};
	let { tabs, selected = $bindable(tabs[0]?.id), label, panel }: Props = $props();
	const uid = $props.id();
	let buttons: HTMLButtonElement[] = $state([]);

	// ARIA tabs pattern: one tab stop, arrows move and select, Home/End jump.
	function key(e: KeyboardEvent, i: number) {
		const n = tabs.length;
		const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
		if (to === undefined) return;
		e.preventDefault();
		selected = tabs[to]?.id ?? selected;
		buttons[to]?.focus();
	}
</script>

<div role="tablist" aria-label={label}>
	{#each tabs as tab, i (tab.id)}
		<button
			bind:this={buttons[i]}
			role="tab"
			id="tab-{uid}-{tab.id}"
			aria-selected={selected === tab.id}
			aria-controls="panel-{uid}-{tab.id}"
			tabindex={selected === tab.id ? 0 : -1}
			onclick={() => (selected = tab.id)}
			onkeydown={(e) => key(e, i)}
		>
			{tab.label}
		</button>
	{/each}
</div>
{#each tabs as tab (tab.id)}
	<div
		role="tabpanel"
		id="panel-{uid}-{tab.id}"
		aria-labelledby="tab-{uid}-{tab.id}"
		hidden={selected !== tab.id}
		tabindex="0"
	>
		{#if selected === tab.id}{@render panel(tab.id)}{/if}
	</div>
{/each}

<style>
	[role='tablist'] {
		display: flex;
		gap: var(--space-1);
		border-bottom: 1px solid var(--border);
	}
	[role='tab'] {
		background: none;
		border: 0;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		padding: var(--space-2) var(--space-3);
		margin-bottom: -1px;
		color: var(--muted);
	}
	[role='tab'][aria-selected='true'] {
		color: var(--text);
		border-bottom-color: var(--accent);
		font-weight: 600;
	}
	[role='tabpanel'] {
		padding: var(--space-4) 0;
	}
</style>
