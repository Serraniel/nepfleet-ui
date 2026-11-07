import { describe, expect, it } from 'vitest';
import { diffLines, parseContextDiff, stat } from './diff.ts';

describe('diffLines', () => {
	it('marks changed lines and keeps line numbers', () => {
		const d = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n');
		expect(d.map((l) => `${l.kind[0]}${l.text}`)).toEqual(['sa', 'db', 'aB', 'sc', 'ad']);
		expect(d[0]).toMatchObject({ old: 1, new: 1 });
		expect(d.at(-1)).toMatchObject({ kind: 'add', new: 4 });
		expect(stat(d)).toEqual({ added: 2, removed: 1 });
	});
	it('handles empty sides', () => {
		expect(diffLines('', 'x').map((l) => l.kind)).toEqual(['add']);
		expect(diffLines('x', '').map((l) => l.kind)).toEqual(['del']);
		expect(diffLines('', '')).toEqual([]);
	});
	it('falls back to a replacement for huge inputs', () => {
		const big = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
		expect(stat(diffLines(big, big + '\nz', 10))).toEqual({ added: 31, removed: 30 });
	});
});

describe('parseContextDiff', () => {
	it('reads the backend format', () => {
		expect(parseContextDiff('  a\n- b\n+ c\n  …\n+ d\n')).toEqual([
			{ kind: 'same', text: 'a' },
			{ kind: 'del', text: 'b' },
			{ kind: 'add', text: 'c' },
			{ kind: 'gap', text: '…' },
			{ kind: 'add', text: 'd' }
		]);
	});
});
