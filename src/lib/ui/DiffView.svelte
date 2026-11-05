<script lang="ts">
	import { diffLines, stat } from '#lib/diff.ts';

	type Props = { before: string; after: string; label: string };
	let { before, after, label }: Props = $props();
	const lines = $derived(diffLines(before, after));
	const counts = $derived(stat(lines));
	const marker = { add: '+', del: '−', same: ' ' } as const;
	const spoken = { add: 'added', del: 'removed', same: '' } as const;
</script>

<figure>
	<figcaption>
		{label}
		<span aria-hidden="true"
			><span class="add">+{counts.added}</span> <span class="del">−{counts.removed}</span></span
		>
		<span class="sr-only">{counts.added} lines added, {counts.removed} removed</span>
	</figcaption>
	{#if lines.length === 0}
		<p class="none">Empty on both sides.</p>
	{:else}
		<table>
			<tbody>
				{#each lines as l, i (i)}
					<tr class={l.kind}>
						<td class="num" aria-hidden="true">{l.old ?? ''}</td>
						<td class="num" aria-hidden="true">{l.new ?? ''}</td>
						<!-- The marker carries the meaning, not only the colour. -->
						<td class="mark"
							><span aria-hidden="true">{marker[l.kind]}</span>{#if spoken[l.kind]}<span
									class="sr-only">{spoken[l.kind]}</span
								>{/if}</td
						>
						<td class="text">{l.text}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</figure>

<style>
	figure {
		margin: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: auto;
		background: var(--surface);
	}
	figcaption {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border);
		font-weight: 600;
	}
	figcaption .add {
		color: var(--add-text);
	}
	figcaption .del {
		color: var(--del-text);
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font: 0.85rem/1.45 var(--mono);
	}
	td {
		padding: 0 var(--space-2);
		white-space: pre;
		vertical-align: top;
	}
	.num {
		color: var(--muted);
		text-align: right;
		user-select: none;
		width: 1%;
	}
	.mark {
		width: 1%;
		user-select: none;
	}
	tr.add {
		background: var(--add-bg);
		color: var(--add-text);
	}
	tr.del {
		background: var(--del-bg);
		color: var(--del-text);
	}
	tr.add .num,
	tr.del .num {
		color: inherit;
	}
	.none {
		padding: var(--space-3);
		margin: 0;
		color: var(--muted);
	}
</style>
