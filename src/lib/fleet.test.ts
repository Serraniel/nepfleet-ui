import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from './backend.ts';
import {
	KEY,
	backendsIn,
	effective,
	eventInFleet,
	fleetName,
	unreadIn,
	withFleet
} from './fleet.ts';
import type { FleetEvent } from './notifications.ts';

const a: Backend = { id: 'a', url: 'https://a.example.test' };
const vps: Backend = {
	id: 'local:vps',
	url: 'http://127.0.0.1:7481/v1/remotes/vps',
	local: true,
	label: 'vps'
};
const ev = (id: number, fleet?: string): FleetEvent => ({
	id,
	time: '2026-01-01T00:00:00Z',
	name: 'apply',
	severity: 'info',
	title: 't',
	fleet
});

describe('fleet', () => {
	it('applies a pick only for a known backend among two or more', () => {
		expect(effective('a', [a, vps])).toBe('a');
		expect(effective('', [a, vps])).toBe('');
		expect(effective('gone', [a, vps])).toBe('');
		expect(effective('a', [a])).toBe('');
		expect(effective('a', [])).toBe('');
	});
	it('lists one backend or all', () => {
		expect(backendsIn([a, vps], 'local:vps')).toEqual([vps]);
		expect(backendsIn([a, vps], '')).toEqual([a, vps]);
	});
	it('keeps the fleet in links', () => {
		expect(withFleet('/stacks', '')).toBe('/stacks');
		expect(withFleet('/stacks', 'local:vps')).toBe('/stacks?fleet=local%3Avps');
	});
	it('names a backend by label, then its own name, then host', () => {
		expect(fleetName(vps)).toBe('vps');
		expect(fleetName(a, { state: 'checking' })).toBe('a.example.test');
		const info = { name: 'home', version: '1.0.0', apiVersion: 'v1' };
		expect(fleetName(a, { state: 'online', info })).toBe('home');
	});
	it('matches daemon events to their remote', () => {
		expect(eventInFleet(ev(1, 'vps'), '')).toBe(true);
		expect(eventInFleet(ev(1), '')).toBe(true);
		expect(eventInFleet(ev(1, 'vps'), 'local:vps')).toBe(true);
		expect(eventInFleet(ev(1, 'home'), 'local:vps')).toBe(false);
		expect(eventInFleet(ev(1), 'local:vps')).toBe(false);
		expect(eventInFleet(ev(1, 'vps'), 'a')).toBe(false);
	});
	it('counts unread events of one fleet', () => {
		const events = [ev(1, 'vps'), ev(2, 'home'), ev(3, 'vps'), ev(4, 'vps')];
		expect(unreadIn(events, 1, 'local:vps')).toBe(2);
		expect(unreadIn(events, 1, 'local:home')).toBe(1);
		expect(unreadIn(events, 1, '')).toBe(3);
		expect(unreadIn(events, 4, 'local:vps')).toBe(0);
	});
});

describe('fleet store', () => {
	let data: Map<string, string>;

	beforeEach(() => {
		vi.resetModules();
		data = new Map();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v),
			removeItem: (k: string) => void data.delete(k)
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	async function load() {
		const { backends } = await import('./backends.svelte.ts');
		const { fleet } = await import('./fleet.svelte.ts');
		return { backends, fleet };
	}

	it('remembers the pick and filters the backends', async () => {
		data.set('nepfleet-backends', JSON.stringify([a]));
		const { backends, fleet } = await load();
		expect(fleet.choosable).toBe(false);
		backends.setLocal([vps], 'nfc_x');
		expect(fleet.choosable).toBe(true);
		expect(fleet.visible).toEqual([a, vps]);

		fleet.set('local:vps');
		expect(data.get(KEY)).toBe('local:vps');
		expect(fleet.current).toBe('local:vps');
		expect(fleet.visible.map((b) => b.id)).toEqual(['local:vps']);

		fleet.set('');
		expect(data.has(KEY)).toBe(false);
		expect(fleet.visible).toHaveLength(2);
	});

	it('starts from the stored pick and waits for its backend', async () => {
		data.set('nepfleet-backends', JSON.stringify([a]));
		data.set(KEY, 'local:vps');
		const { backends, fleet } = await load();
		expect(fleet.pick).toBe('local:vps');
		expect(fleet.current).toBe(''); // not connected yet: all
		backends.setLocal([vps], 'nfc_x');
		expect(fleet.current).toBe('local:vps');
		backends.setLocal([], 'nfc_x');
		expect(fleet.current).toBe('');
		expect(fleet.visible).toEqual([a]);
	});

	it('works when storage refuses it', async () => {
		// Only the fleet's key: the rest of the app has its own handling.
		const refuse = (k: string) => {
			if (k === KEY) throw new DOMException('denied', 'SecurityError');
			return null;
		};
		vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
		const { backends, fleet } = await load();
		expect(fleet.pick).toBe('');
		backends.setLocal([vps, { ...vps, id: 'local:home', label: 'home' }], 'nfc_x');
		fleet.set('local:home');
		expect(fleet.current).toBe('local:home');
	});

	it('counts the stacks that need attention in the fleet on show', async () => {
		data.set('nepfleet-backends', JSON.stringify([a]));
		const { backends, fleet } = await load();
		const { stacks } = await import('./stacks.svelte.ts');
		backends.setLocal([vps], 'nfc_x');
		const stack = (name: string, problems?: { kind: string; message: string }[]) => ({
			name,
			target: 'local',
			mode: 'compose',
			apply: 'auto',
			updates: 'patch',
			problems
		});
		stacks.byBackend['a'] = {
			state: 'ok',
			stacks: [stack('sure', [{ kind: 'missing-input', message: 'm' }]), stack('web')]
		};
		stacks.byBackend['local:vps'] = {
			state: 'ok',
			stacks: [stack('homebox', [{ kind: 'plan', message: 'm' }])]
		};
		expect(fleet.attention).toBe(2);
		fleet.set('a');
		expect(fleet.attention).toBe(1);
		stacks.byBackend['a'] = { state: 'loading' };
		expect(fleet.attention).toBe(0);
	});
});
