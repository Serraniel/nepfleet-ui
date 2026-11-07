import { describe, expect, it } from 'vitest';
import { fetchAuthStatus, setUp, signIn, signOut } from './login.ts';

const backend = { id: 'b', url: 'https://api.example.org' };

function fake(routes: Record<string, () => Response>) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const path = url.replace(backend.url, '').split('?')[0] ?? '';
		return routes[path]?.() ?? new Response('', { status: 404 });
	}) as unknown as typeof fetch;
	return { calls, fetcher };
}

const begun = () =>
	new Response(JSON.stringify({ ceremony: 'c1', options: { publicKey: { challenge: 'x' } } }));

describe('fetchAuthStatus', () => {
	it('reads status, and null means passkeys are off', async () => {
		const on = fake({
			'/api/v1/auth/status': () =>
				new Response(JSON.stringify({ setupNeeded: true, signedIn: false, name: '' }))
		});
		expect((await fetchAuthStatus(backend, on.fetcher))?.setupNeeded).toBe(true);
		expect(on.calls[0]?.init.credentials).toBe('include');
		expect(await fetchAuthStatus(backend, fake({}).fetcher)).toBeNull();
	});
});

describe('signIn', () => {
	it('answers the challenge it got, for the ceremony it got', async () => {
		const f = fake({
			'/api/v1/auth/login/begin': begun,
			'/api/v1/auth/login/finish': () => new Response(null, { status: 204 })
		});
		let asked: unknown;
		const passkeys = {
			create: async () => null,
			get: async (o: unknown) => {
				asked = o;
				return { toJSON: () => ({ id: 'cred' }) };
			}
		};
		await signIn(backend, passkeys, f.fetcher);
		expect(asked).toEqual({ challenge: 'x' });
		expect(f.calls[1]?.url).toBe(backend.url + '/api/v1/auth/login/finish?ceremony=c1');
		expect(f.calls[1]?.init.body).toBe('{"id":"cred"}');
		expect(f.calls.every((c) => c.init.credentials === 'include')).toBe(true);
	});
	it('says when the person cancels, and sends nothing further', async () => {
		const f = fake({ '/api/v1/auth/login/begin': begun });
		const passkeys = {
			create: async () => null,
			get: async () => {
				const e = new Error('no');
				e.name = 'NotAllowedError';
				throw e;
			}
		};
		await expect(signIn(backend, passkeys, f.fetcher)).rejects.toThrow(/Cancelled/);
		expect(f.calls).toHaveLength(1);
	});
	it('names refusals', async () => {
		const passkeys = { create: async () => null, get: async () => null };
		const f = fake({ '/api/v1/auth/login/begin': () => new Response('', { status: 429 }) });
		await expect(signIn(backend, passkeys, f.fetcher)).rejects.toThrow(/wait a minute/);
	});
});

describe('setUp and signOut', () => {
	it('sends the token and name once, trimmed', async () => {
		const f = fake({
			'/api/v1/auth/setup/begin': begun,
			'/api/v1/auth/setup/finish': () => new Response(null, { status: 204 }),
			'/api/v1/auth/logout': () => new Response(null, { status: 204 })
		});
		const passkeys = { create: async () => ({ toJSON: () => ({}) }), get: async () => null };
		await setUp(backend, ' tok ', ' Ada ', passkeys, f.fetcher);
		expect(JSON.parse(String(f.calls[0]?.init.body))).toEqual({ setupToken: 'tok', name: 'Ada' });
		await signOut(backend, f.fetcher);
		expect(f.calls[2]?.url).toContain('/logout');
	});
});
