<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = Omit<HTMLInputAttributes, 'value'> & {
		label: string;
		value?: string;
		hint?: string;
		error?: string;
		/** Keep the label for screen readers only. */
		hideLabel?: boolean;
	};
	let {
		label,
		value = $bindable(''),
		hint,
		error,
		hideLabel = false,
		id,
		...rest
	}: Props = $props();
	const uid = $props.id();
	const inputId = $derived(id ?? `field-${uid}`);
	const describedBy = $derived(
		[hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field">
	<label for={inputId} class:sr-only={hideLabel}>{label}</label>
	<input
		id={inputId}
		bind:value
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
		{...rest}
	/>
	{#if hint}<small id="{inputId}-hint">{hint}</small>{/if}
	{#if error}<small id="{inputId}-error" class="error">{error}</small>{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	label {
		font-weight: 600;
		font-size: 0.9rem;
	}
	small {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
	input[aria-invalid='true'] {
		border-color: var(--err);
	}
</style>
