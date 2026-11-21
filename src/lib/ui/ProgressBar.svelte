<script lang="ts">
	/**
	 * Measurable progress: step of steps, and what the step does. Steps, not
	 * a percentage: a step's length isn't known, so the bar never claims more.
	 * A sheen moves over the filled part while it runs, so a long step still
	 * shows that something happens.
	 */
	let { step, steps, text }: { step: number; steps: number; text: string } = $props();
	const pct = $derived(steps > 0 ? Math.min(100, Math.max(0, (step / steps) * 100)) : 0);
</script>

<div class="progress">
	<div
		class="track"
		role="progressbar"
		aria-valuemin={0}
		aria-valuemax={steps}
		aria-valuenow={step}
		aria-valuetext="Step {step} of {steps}: {text}"
		aria-label="Step {step} of {steps}: {text}"
	>
		<div class="fill" style:width="{pct}%"></div>
	</div>
	<span role="status" aria-live="polite">Step {step} of {steps}: {text}</span>
</div>

<style>
	.progress {
		display: grid;
		gap: var(--space-1, 0.25rem);
		max-width: 32rem;
	}
	.track {
		height: 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--border);
		overflow: hidden;
	}
	.fill {
		position: relative;
		height: 100%;
		min-width: 0.5rem;
		border-radius: inherit;
		background: var(--accent);
		overflow: hidden;
		transition: width 0.3s ease;
	}
	.fill::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			color-mix(in srgb, var(--accent-text) 45%, transparent) 50%,
			transparent 100%
		);
		transform: translateX(-100%);
		animation: sheen 1.6s ease-in-out infinite;
	}
	@keyframes sheen {
		to {
			transform: translateX(100%);
		}
	}
	span {
		color: var(--muted);
	}
	/* Less motion asked for: no moving sheen, a slow pulse says it instead. */
	@media (prefers-reduced-motion: reduce) {
		.fill {
			transition: none;
			animation: pulse 2s ease-in-out infinite;
		}
		.fill::after {
			animation: none;
			display: none;
		}
		@keyframes pulse {
			50% {
				opacity: 0.55;
			}
		}
	}
</style>
