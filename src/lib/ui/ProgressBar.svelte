<script lang="ts">
	/**
	 * Measurable progress: step of steps, and what the step does. Steps, not
	 * a percentage: a step's length isn't known, so the bar never claims more.
	 */
	let { step, steps, text }: { step: number; steps: number; text: string } = $props();
</script>

<div class="progress">
	<progress max={steps} value={step} aria-label="Step {step} of {steps}: {text}"></progress>
	<span role="status" aria-live="polite">Step {step} of {steps}: {text}</span>
</div>

<style>
	.progress {
		display: grid;
		gap: var(--space-1, 0.25rem);
		max-width: 32rem;
	}
	progress {
		width: 100%;
		height: 0.5rem;
		accent-color: var(--accent);
	}
	span {
		color: var(--muted);
	}
</style>
