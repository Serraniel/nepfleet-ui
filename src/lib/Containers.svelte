<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		type Backend,
		type ServiceAction,
		type StackContainer,
		fetchContainers,
		fetchLogs,
		followLogs,
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

	/** Per container: its last lines, shown below its row while open. */
	let logs = $state<Record<string, { text?: string; error?: string; loading: boolean }>>({});

	async function loadLogs(container: string) {
		logs[container] = { ...logs[container], loading: true };
		try {
			logs[container] = { text: await fetchLogs(backend, token, stack, container), loading: false };
		} catch (e) {
			logs[container] = { error: e instanceof Error ? e.message : String(e), loading: false };
		}
	}

	function toggleLogs(container: string) {
		if (logs[container]) {
			stopFollowing(container);
			delete logs[container];
		} else void loadLogs(container);
	}

	// Following: the newest output appended as it comes, at most so much kept.
	const KEEP = 200_000;
	const following: Record<string, AbortController> = {};
	let followed = $state<Record<string, boolean>>({});

	function stopFollowing(container: string) {
		following[container]?.abort();
		delete following[container];
		delete followed[container];
	}

	async function follow(container: string) {
		const stop = new AbortController();
		following[container] = stop;
		followed[container] = true;
		logs[container] = { text: '', loading: false };
		// The server ends a stream after 30 minutes: start again until stopped.
		while (!stop.signal.aborted) {
			try {
				await followLogs(
					backend,
					token,
					stack,
					container,
					(t) => {
						const now = (logs[container]?.text ?? '') + t;
						logs[container] = { text: now.length > KEEP ? now.slice(-KEEP) : now, loading: false };
					},
					stop.signal
				);
			} catch (e) {
				if (stop.signal.aborted) break;
				logs[container] = {
					...logs[container],
					error: e instanceof Error ? e.message : String(e),
					loading: false
				};
				break;
			}
		}
		if (following[container] === stop) stopFollowing(container);
	}

	/** Keeps a followed log scrolled to its newest line (param: the text, or null). */
	function stickToEnd(node: HTMLElement, text: string | null) {
		const end = (t: string | null) => {
			if (t !== null) node.scrollTop = node.scrollHeight;
		};
		end(text);
		return { update: end };
	}

	onDestroy(() => {
		for (const c of Object.keys(following)) following[c]?.abort();
	});

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
								<Button
									variant="ghost"
									onclick={() => toggleLogs(c.name)}
									busy={logs[c.name]?.loading}
									aria-expanded={!!logs[c.name]}
								>
									{logs[c.name] ? 'Hide logs' : 'Logs'}
								</Button>
								{#if firstOfService(i)}
									<Button
										variant="ghost"
										onclick={() => act(c.service, 'restart')}
										disabled={!!busy[c.service]}
										busy={busy[c.service] === 'restart'}
									>
										Restart
									</Button>
									{#if !swarm}
										{#if c.state === 'running'}
											<Button
												variant="ghost"
												onclick={() => act(c.service, 'stop')}
												disabled={!!busy[c.service]}
												busy={busy[c.service] === 'stop'}
											>
												Stop
											</Button>
										{:else}
											<Button
												variant="ghost"
												onclick={() => act(c.service, 'start')}
												disabled={!!busy[c.service]}
												busy={busy[c.service] === 'start'}
											>
												Start
											</Button>
										{/if}
									{/if}
								{/if}
							</td>
						</tr>
						{#if logs[c.name]}
							{@const l = logs[c.name]!}
							<tr class="logs-row">
								<td colspan="5">
									{#if l.error}
										<p class="error" role="alert">{l.error}</p>
									{:else if l.text !== undefined}
										<div class="row">
											<span class="muted small" role="status">
												{followed[c.name]
													? `Following ${c.name}: new output appears as it comes`
													: `The last 200 lines of ${c.name}`}
											</span>
											<span>
												{#if followed[c.name]}
													<Button variant="ghost" onclick={() => stopFollowing(c.name)}>
														Stop
													</Button>
												{:else}
													<Button variant="ghost" onclick={() => loadLogs(c.name)} busy={l.loading}>
														Refresh
													</Button>
													<Button variant="ghost" onclick={() => follow(c.name)}>Follow</Button>
												{/if}
											</span>
										</div>
										<pre class="logs" use:stickToEnd={followed[c.name] ? l.text : null}>{l.text ||
												(followed[c.name] ? '(waiting for output)' : '(no output)')}</pre>
									{:else}
										<Spinner label="Reading its logs…" />
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted small">
			Restarting or stopping a service changes nothing in the fleet repository: the next apply
			brings it back to what the stack says. Logs here need a token that may edit the stack: they
			often hold secrets. To follow them live, use Dozzle.
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
	.logs {
		max-height: 24rem;
		overflow: auto;
		margin: 0.25rem 0 0;
		padding: 0.5rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-2);
		font-size: 0.8rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
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
