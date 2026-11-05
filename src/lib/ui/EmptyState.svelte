<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { title: string; children?: Snippet; action?: Snippet };
	let { title, children, action }: Props = $props();
</script>

<section class="empty">
	<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
		<path fill="currentColor" d="M3 17h18l-2 4H5zM6 15l2-9 4 3 4-6 2 12z" opacity="0.5" />
	</svg>
	<h2>{title}</h2>
	{#if children}<p>{@render children()}</p>{/if}
	{#if action}<div>{@render action()}</div>{/if}
</section>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-2);
		padding: var(--space-6) var(--space-4);
		border: 1px dashed var(--border);
		border-radius: calc(var(--radius) + 4px);
		color: var(--muted);
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
		color: var(--text);
	}
	p {
		margin: 0;
		max-width: 46ch;
	}
</style>
