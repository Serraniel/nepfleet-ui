import { describe, expect, it } from 'vitest';
import { parsePreference, resolve } from './theme.ts';

describe('theme', () => {
	it('treats anything but light or dark as system', () => {
		expect(parsePreference('dark')).toBe('dark');
		expect(parsePreference('light')).toBe('light');
		expect(parsePreference(null)).toBe('system');
		expect(parsePreference('purple')).toBe('system');
	});
	it('follows the system only for the system preference', () => {
		expect(resolve('system', true)).toBe('dark');
		expect(resolve('system', false)).toBe('light');
		expect(resolve('light', true)).toBe('light');
		expect(resolve('dark', false)).toBe('dark');
	});
});
