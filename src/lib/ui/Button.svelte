<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Props = HTMLButtonAttributes & {
		variant?: 'default' | 'primary' | 'danger' | 'ghost';
		children: Snippet;
	};
	let { variant = 'default', type = 'button', children, ...rest }: Props = $props();
</script>

<button {type} class="btn {variant}" {...rest}>{@render children()}</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		border-radius: var(--radius);
		padding: var(--space-2) 0.9rem;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.danger {
		background: var(--danger);
		border-color: var(--danger);
		color: var(--danger-text);
		font-weight: 600;
	}
	.ghost {
		background: transparent;
		border-color: transparent;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
