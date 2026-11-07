import { describe, expect, it } from 'vitest';
import { atLeast, eventHref } from './notifications.ts';

describe('atLeast', () => {
	it('compares severities', () => {
		expect(atLeast('error', 'warning')).toBe(true);
		expect(atLeast('warning', 'warning')).toBe(true);
		expect(atLeast('info', 'warning')).toBe(false);
		expect(atLeast('nonsense', 'warning')).toBe(false);
		expect(atLeast('nonsense', 'info')).toBe(true);
	});
});

describe('eventHref', () => {
	const base = { id: 1, time: '', name: 'n', severity: 'info', title: 't' };
	it('links to the stack, escaped', () => {
		expect(eventHref({ ...base, fleet: 'nas', stack: 'web' })).toBe('/stacks/local%3Anas/web');
		expect(eventHref({ ...base, fleet: 'a/b', stack: 'c/../d' })).toBe(
			'/stacks/local%3Aa%2Fb/c%2F..%2Fd'
		);
	});
	it('has no link without both', () => {
		expect(eventHref({ ...base, stack: 'web' })).toBeUndefined();
		expect(eventHref({ ...base, fleet: 'nas' })).toBeUndefined();
	});
});
