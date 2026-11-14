<script lang="ts">
	/**
	 * Something is under way and its length isn't known. With a label it stands
	 * alone and is announced; without one it sits inside a control that says
	 * what is happening (a busy button), and stays silent.
	 */
	let { label = '' }: { label?: string } = $props();
</script>

{#if label}
	<span class="loading" role="status" aria-live="polite">
		<span class="spinner" aria-hidden="true"></span>{label}
	</span>
{:else}
	<span class="spinner" aria-hidden="true"></span>
{/if}

<style>
	.loading {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--muted);
	}
	.spinner {
		display: inline-block;
		flex: none;
		width: 1em;
		height: 1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: turn 0.8s linear infinite;
	}
	@keyframes turn {
		to {
			transform: rotate(360deg);
		}
	}
	/* No spinning for those who asked for less motion: a slow pulse says it instead. */
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: pulse 2s ease-in-out infinite;
		}
		@keyframes pulse {
			50% {
				opacity: 0.35;
			}
		}
	}
</style>
