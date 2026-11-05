<script lang="ts">
	import type { Snippet } from 'svelte';
	import Toaster from './Toaster.svelte';
	import { toasts } from './toasts.svelte.ts';

	type Props = {
		open: boolean;
		title: string;
		children: Snippet;
		/** Buttons at the bottom; close the dialog by setting open = false. */
		actions?: Snippet;
	};
	let { open = $bindable(), title, children, actions }: Props = $props();
	let dialog: HTMLDialogElement;
	const uid = $props.id();

	// The native modal dialog traps focus, closes on Escape and returns focus
	// to the opener, so none of that is reimplemented here.
	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
	// The page's toasts are inert behind a modal: show them in here instead.
	$effect(() => {
		if (!open) return;
		toasts.modals++;
		return () => toasts.modals--;
	});
</script>

<dialog bind:this={dialog} aria-labelledby="dialog-{uid}" onclose={() => (open = false)}>
	<h2 id="dialog-{uid}">{title}</h2>
	<div class="body">{@render children()}</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
	{#if open}<Toaster inModal />{/if}
</dialog>

<style>
	dialog {
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) + 4px);
		background: var(--surface);
		color: var(--text);
		padding: var(--space-6);
		max-width: min(560px, calc(100vw - 2rem));
		box-shadow: var(--shadow);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.45);
	}
	h2 {
		margin: 0 0 var(--space-3);
		font-size: 1.2rem;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-6);
	}
</style>
