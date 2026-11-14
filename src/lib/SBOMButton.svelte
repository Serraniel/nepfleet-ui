<script lang="ts">
	import { type Backend, fetchSBOM } from '#lib/backend.ts';
	import { saveBlob } from '#lib/download.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = {
		backend: Backend;
		token: string;
		/** The stack, or '' for the fleet's stacks the token sees. */
		stack: string;
	};
	let { backend, token, stack }: Props = $props();
	let busy = $state(false);
	let error = $state('');

	async function download() {
		busy = true;
		error = '';
		try {
			saveBlob(`${stack || 'fleet'}.cdx.json`, await fetchSBOM(backend, token, stack));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<Button
	variant="ghost"
	disabled={busy}
	onclick={download}
	title="The images it runs, as a CycloneDX software bill of materials"
	>{busy ? 'Preparing SBOM…' : stack ? 'Download SBOM' : 'Download the fleet’s SBOM'}</Button
>
{#if error}<span class="error" role="alert">{error}</span>{/if}

<style>
	.error {
		color: var(--err);
	}
</style>
