<script lang="ts">
	import { onMount } from 'svelte';
	import {
		type Backend,
		type ServiceAction,
		type StackContainer,
		fetchContainers,
		serviceAction
	} from '#lib/backend.ts';
	import Button from '#lib/ui/Button.svelte';
	import Spinner from '#lib/ui/Spinner.svelte';

	type Props = { backend: Backend; token: string; stack: string };
	let { backend, token, stack }: Props = $props();

	let containers = $state<StackContainer[] | null>(null);
	let loading = $state(false);
	let error = $state('');
	let busy = $state<Record<string, ServiceAction>>({});
	let note = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			containers = await fetchContainers(backend, token, stack);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}
	onMount(load);

	async function act(service: string, action: ServiceAction) {
		busy[service] = action;
		note = '';
		error = '';
		try {
			await serviceAction(backend, token, stack, service, action);
			note = `${service}: ${action === 'restart' ? 'restarted' : action === 'stop' ? 'stopped' : 'started'}.`;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			delete busy[service];
		}
	}

	/** The first row of each service carries its buttons. */
	const firstOfService = (i: number) =>
		!!containers && (i === 0 || containers[i - 1]!.service !== containers[i]!.service);
	const swarm = $derived(!!containers?.some((c) => c.node));
	const badge = (c: StackContainer) =>
		c.health === 'unhealthy'
			? 'fail'
			: c.state === 'running'
				? 'ok'
				: c.state === 'exited' && c.status?.startsWith('Exited (0)')
					? 'done'
					: 'warn';
</script>

<section aria-labelledby="containers-h">
	<div class="row">
		<h2 id="containers-h">Containers</h2>
		<Button variant="ghost" onclick={load} busy={loading}>Refresh</Button>
	</div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if note}<p role="status">{note}</p>{/if}
	{#if containers === null}
		{#if loading}<Spinner label="Reading its containers…" />{/if}
	{:else if containers.length === 0}
		<p class="muted">No containers on this backend's host: the stack isn't applied here.</p>
	{:else}
		<div class="table">
			<table>
				<thead>
					<tr>
						<th scope="col">Service</th>
						<th scope="col">State</th>
						<th scope="col">Image</th>
						<th scope="col">Restarts</th>
						<th scope="col"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each containers as c, i (c.name)}
						<tr>
							<td>
								{#if firstOfService(i)}<strong>{c.service}</strong>{/if}
								<div class="muted small">{c.name}{c.node ? ` on ${c.node}` : ''}</div>
							</td>
							<td>
								<span class="badge {badge(c)}">{c.health || c.state}</span>
								{#if c.status}<div class="muted small">{c.status}</div>{/if}
								{#if c.error}<div class="error small">{c.error}</div>{/if}
							</td>
							<td><code>{c.image}</code></td>
							<td>{c.restarts}</td>
							<td class="actions">
								{#if firstOfService(i)}
									<Button
										variant="ghost"
										onclick={() => act(c.service, 'restart')}
										disabled={!!busy[c.service]}
										busy={busy[c.service] === 'restart'}>Restart</Button
									>
									{#if !swarm}
										{#if c.state === 'running'}
											<Button
												variant="ghost"
												onclick={() => act(c.service, 'stop')}
												disabled={!!busy[c.service]}
												busy={busy[c.service] === 'stop'}>Stop</Button
											>
										{:else}
											<Button
												variant="ghost"
												onclick={() => act(c.service, 'start')}
												disabled={!!busy[c.service]}
												busy={busy[c.service] === 'start'}>Start</Button
											>
										{/if}
									{/if}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted small">
			Restarting or stopping a service changes nothing in the fleet repository: the next apply
			brings it back to what the stack says. Logs are in Dozzle.
		</p>
	{/if}
</section>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.table {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}
	.actions {
		white-space: nowrap;
	}
	.small {
		font-size: 0.85rem;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
	.badge {
		display: inline-block;
		padding: 0 0.4rem;
		border-radius: 0.3rem;
		font-size: 0.85rem;
		border: 1px solid var(--border);
	}
	.badge.ok {
		color: var(--ok);
	}
	.badge.warn {
		color: var(--warn);
	}
	.badge.fail {
		color: var(--err);
	}
	.badge.done {
		color: var(--muted);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
