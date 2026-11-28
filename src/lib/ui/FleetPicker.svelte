<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { backends } from '#lib/backends.svelte.ts';
	import { fleet } from '#lib/fleet.svelte.ts';
	import { PARAM, fleetName } from '#lib/fleet.ts';

	// A link with ?fleet= opens that fleet and becomes the pick. Only the URL
	// is followed here: the pick changing must not send it back to the URL's.
	$effect(() => {
		const id = page.url.searchParams.get(PARAM);
		if (id !== null) untrack(() => fleet.set(id));
	});

	function pick(event: Event) {
		const id = (event.currentTarget as HTMLSelectElement).value;
		fleet.set(id);
		const url = new URL(page.url.href);
		if (id) url.searchParams.set(PARAM, id);
		else url.searchParams.delete(PARAM);
		// The same page with another query: keep focus on the picker and the scroll.
		void goto(url, { replace: true, reset: false });
	}

	const status = $derived(fleet.current ? backends.status[fleet.current] : undefined);
</script>

{#if fleet.choosable}
	<div class="fleet">
		<label for="fleet-picker">Fleet</label>
		<div class="field">
			{#if fleet.current}
				<span class="dot {status?.state ?? 'checking'}" aria-hidden="true"></span>
			{/if}
			<select id="fleet-picker" value={fleet.current} onchange={pick}>
				<option value="">All fleets</option>
				{#each backends.list as b (b.id)}
					{@const s = backends.status[b.id]}
					<option value={b.id}>
						{fleetName(b, s)}{s?.state === 'offline' ? ' (offline)' : ''}
					</option>
				{/each}
			</select>
		</div>
	</div>
{/if}

<style>
	.fleet {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	label {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.field {
		position: relative;
		display: flex;
		align-items: center;
	}
	select {
		width: 100%;
	}
	/* The picked fleet's status, inside the field like an icon. */
	.dot {
		position: absolute;
		left: 0.7rem;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--muted);
		pointer-events: none;
	}
	.dot.online {
		background: var(--ok);
	}
	.dot.offline {
		background: var(--err);
	}
	.dot + select {
		padding-left: 1.6rem;
	}
</style>
