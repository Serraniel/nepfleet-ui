<script lang="ts">
	import { toasts } from './toasts.svelte.ts';
</script>

<!-- Two live regions: errors interrupt (alert), the rest wait (status). -->
<div class="toaster">
	<div role="alert">
		{#each toasts.list.filter((t) => t.kind === 'error') as t (t.id)}
			<div class="toast error">
				<span>{t.message}</span>
				<button aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>×</button>
			</div>
		{/each}
	</div>
	<div role="status">
		{#each toasts.list.filter((t) => t.kind !== 'error') as t (t.id)}
			<div class="toast {t.kind}">
				<span>{t.message}</span>
				<button aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>×</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.toaster {
		position: fixed;
		right: var(--space-4);
		bottom: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		z-index: 10;
	}
	.toaster > div {
		display: contents;
	}
	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-left: 4px solid var(--accent);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-4);
		box-shadow: var(--shadow);
		max-width: 420px;
	}
	.success {
		border-left-color: var(--ok);
	}
	.error {
		border-left-color: var(--err);
	}
	button {
		margin-left: auto;
		background: none;
		border: 0;
		font-size: 1.2rem;
		line-height: 1;
		padding: var(--space-1);
	}
</style>
