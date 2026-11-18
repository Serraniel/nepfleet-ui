import { describe, expect, it } from 'vitest';
import { ago, loadChecked, saveChecked } from './hostupdates-cache.ts';

const value = { os: 'Arch Linux', supported: true, pending: 3, security: 1, rebootRequired: false };

function memory() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v)
	};
}

describe('host updates cache', () => {
	const now = Date.parse('2026-11-18T12:00:00Z');
	it('keeps answers across a reload', () => {
		const s = memory();
		saveChecked({ vps: { value, at: '2026-11-18T09:00:00Z' } }, s);
		expect(loadChecked(s, now)).toEqual({ vps: { value, at: '2026-11-18T09:00:00Z' } });
	});
	it('drops old, malformed and unreadable entries', () => {
		const s = memory();
		s.setItem(
			'nepfleet.hostUpdates',
			JSON.stringify({
				old: { value, at: '2026-09-01T00:00:00Z' },
				odd: { value: { os: 1 }, at: '2026-11-18T09:00:00Z' },
				undated: { value }
			})
		);
		expect(loadChecked(s, now)).toEqual({});
		s.setItem('nepfleet.hostUpdates', '{not json');
		expect(loadChecked(s, now)).toEqual({});
	});
	it('survives storage that throws', () => {
		const broken = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('full');
			}
		};
		expect(loadChecked(broken, now)).toEqual({});
		expect(() => saveChecked({}, broken)).not.toThrow();
	});
	it('says how long ago', () => {
		expect(ago('2026-11-18T11:59:30Z', now)).toBe('just now');
		expect(ago('2026-11-18T11:55:00Z', now)).toBe('5 min ago');
		expect(ago('2026-11-18T09:00:00Z', now)).toBe('3 h ago');
		expect(ago('2026-11-17T12:00:00Z', now)).toBe('1 day ago');
	});
});
