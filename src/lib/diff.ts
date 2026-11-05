// SPDX-License-Identifier: AGPL-3.0-or-later

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string; old?: number; new?: number };

/**
 * Line diff of two texts (longest common subsequence). Inputs are config
 * files of a few hundred lines; above `limit` lines per side the result is
 * a plain replacement rather than an expensive table.
 */
export function diffLines(before: string, after: string, limit = 2000): DiffLine[] {
	const a = split(before);
	const b = split(after);
	if (a.length > limit || b.length > limit) {
		return [
			...a.map((text, i) => ({ kind: 'del' as const, text, old: i + 1 })),
			...b.map((text, i) => ({ kind: 'add' as const, text, new: i + 1 }))
		];
	}
	// lcs(i, j) = length of the LCS of a[i:] and b[j:], in one flat table.
	const w = b.length + 1;
	const table = new Uint32Array((a.length + 1) * w);
	const lcs = (i: number, j: number) => table[i * w + j] ?? 0;
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i * w + j] =
				a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
		}
	}
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		const x = a[i];
		const y = b[j];
		if (x !== undefined && x === y) {
			out.push({ kind: 'same', text: x, old: ++i, new: ++j });
		} else if (x !== undefined && (y === undefined || lcs(i + 1, j) >= lcs(i, j + 1))) {
			out.push({ kind: 'del', text: x, old: ++i }); // removals first, as in unified diffs
		} else if (y !== undefined) {
			out.push({ kind: 'add', text: y, new: ++j });
		}
	}
	return out;
}

function split(s: string): string[] {
	if (s === '') return [];
	const lines = s.split('\n');
	if (lines[lines.length - 1] === '') lines.pop();
	return lines;
}

/** Counts of added and removed lines. */
export function stat(lines: DiffLine[]): { added: number; removed: number } {
	return {
		added: lines.filter((l) => l.kind === 'add').length,
		removed: lines.filter((l) => l.kind === 'del').length
	};
}
