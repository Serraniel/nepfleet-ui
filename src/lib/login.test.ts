import { describe, expect, it } from 'vitest';
import {
	beginCodes,
	fetchAuthStatus,
	finishCodes,
	providerLoginUrl,
	removeCodes,
	setUp,
	signIn,
	signInWithCode,
	signOut
} from './login.ts';

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

describe('identity provider', () => {
	it('builds the sign-in address, with where to come back to', () => {
		expect(providerLoginUrl(backend, 'https://ui.example.org/stacks?a=1')).toBe(
			'https://api.example.org/api/v1/auth/oidc/login?return=https%3A%2F%2Fui.example.org%2Fstacks%3Fa%3D1'
		);
	});
	it('reads which ways in there are', async () => {
		const status = (o: object) =>
			fetchAuthStatus(
				backend,
				fake({ '/api/v1/auth/status': () => new Response(JSON.stringify(o)) }).fetcher
			);
		const provider = await status({ oidc: true, passkeys: false, external: true });
		expect(provider).toMatchObject({ oidc: true, passkeys: false, external: true });
		// A backend from before these fields has passkeys only.
		expect(await status({})).toMatchObject({ oidc: false, passkeys: true, external: false });
	});
});

describe('sign-in codes', () => {
	it('signs in, trimmed, and says so when refused', async () => {
		const ok = fake({ '/api/v1/auth/totp/login': () => new Response(null, { status: 204 }) });
		await signInWithCode(backend, ' Ada ', ' 123456 ', ok.fetcher);
		expect(JSON.parse(String(ok.calls[0]?.init.body))).toEqual({ name: 'Ada', code: '123456' });
		expect(ok.calls[0]?.init.credentials).toBe('include');
		const no = fake({ '/api/v1/auth/totp/login': () => new Response('', { status: 401 }) });
		await expect(signInWithCode(backend, 'Ada', '000000', no.fetcher)).rejects.toThrow(
			/Wrong name or code/
		);
	});
	it('sets up with the ceremony it got, and turns off', async () => {
		const f = fake({
			'/api/v1/auth/totp/begin': () =>
				new Response(JSON.stringify({ ceremony: 'c 1', secret: 'S', url: 'otpauth://x' })),
			'/api/v1/auth/totp/finish': () => new Response(null, { status: 204 }),
			'/api/v1/auth/totp/remove': () => new Response(null, { status: 204 })
		});
		const setup = await beginCodes(backend, f.fetcher);
		await finishCodes(backend, setup.ceremony, '123456', f.fetcher);
		expect(f.calls[1]?.url).toContain('totp/finish?ceremony=c%201');
		await removeCodes(backend, f.fetcher);
		expect(f.calls[2]?.url).toContain('totp/remove');
	});
	it('refuses an odd answer to begin', async () => {
		const f = fake({ '/api/v1/auth/totp/begin': () => new Response('{}') });
		await expect(beginCodes(backend, f.fetcher)).rejects.toThrow(/Unexpected/);
	});
	it('reads whether codes are on', async () => {
		const f = fake({
			'/api/v1/auth/status': () => new Response(JSON.stringify({ signedIn: true, totp: true }))
		});
		expect((await fetchAuthStatus(backend, f.fetcher))?.totp).toBe(true);
	});
});

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
