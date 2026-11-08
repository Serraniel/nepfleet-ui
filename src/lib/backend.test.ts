import { describe, expect, it } from 'vitest';
import {
	AuthError,
	ConflictError,
	ScopeError,
	startApply,
	startRollback,
	fetchJob,
	NotFoundError,
	fetchHistory,
	fetchUpdates,
	fetchInfo,
	fetchPlan,
	fetchStacks,
	normalizeUrl,
	stackPlaces,
	stackRelations
} from './backend.ts';

describe('stackRelations', () => {
	const base = { target: 'nas', mode: 'compose', apply: 'manual', updates: 'notify' };
	const all = [
		{ ...base, name: 'jellyfin' },
		{
			...base,
			name: 'homepage',
			uses: [{ key: 'JELLYFIN_KEY', from: 'jellyfin', secret: 'API_KEY' }]
		},
		{ ...base, name: 'seerr', uses: [{ key: 'MEDIA_URL', from: 'jellyfin', value: 'URL' }] }
	];
	it('shows both directions', () => {
		const j = stackRelations(all, 'jellyfin');
		expect(j.uses).toEqual([]);
		expect(j.usedBy.map((r) => `${r.stack}/${r.key}`)).toEqual([
			'homepage/JELLYFIN_KEY',
			'seerr/MEDIA_URL'
		]);
		expect(stackRelations(all, 'homepage').uses[0]?.secret).toBe('API_KEY');
		expect(stackRelations(all, 'homepage').usedBy).toEqual([]);
	});
	it('handles a stack it does not know, and odd entries', () => {
		expect(stackRelations(all, 'nope')).toEqual({ uses: [], usedBy: [] });
		const odd = [{ ...base, name: 'x', uses: [null, { key: 1 }] as never }];
		expect(stackRelations(odd, 'x')).toEqual({ uses: [], usedBy: [] });
	});
});

describe('stackPlaces', () => {
	const stack = { name: 'web', target: 'nas', mode: 'compose', apply: 'manual', updates: 'notify' };
	it('lists the stack first, then its links', () => {
		expect(
			stackPlaces({
				...stack,
				url: 'https://web.example.org',
				links: [{ name: 'Logs in Dozzle', url: 'https://logs.example.org/stack/web' }]
			}).map((l) => l.name)
		).toEqual(['Open', 'Logs in Dozzle']);
		expect(stackPlaces(stack)).toEqual([]);
	});
	it('keeps out what could run in this page', () => {
		const bad = ['javascript:alert(1)', 'data:text/html,x', 'not a url', ''];
		const links = bad.map((url) => ({ name: 'x', url }));
		expect(stackPlaces({ ...stack, url: 'javascript:alert(1)', links })).toEqual([]);
	});
	it('survives odd entries from a backend', () => {
		const links = [null, { name: 1, url: 2 }] as unknown as { name: string; url: string }[];
		expect(stackPlaces({ ...stack, links })).toEqual([]);
	});
});

describe('normalizeUrl', () => {
	it('accepts https and strips trailing slashes', () => {
		expect(normalizeUrl(' https://fleet.example.org/ ')).toBe('https://fleet.example.org');
		expect(normalizeUrl('https://example.org/nepfleet//')).toBe('https://example.org/nepfleet');
	});
	it('allows plain http only on loopback', () => {
		expect(normalizeUrl('http://localhost:7480')).toBe('http://localhost:7480');
		expect(() => normalizeUrl('http://192.168.1.2:7480')).toThrow(/https/);
	});
	it('rejects credentials, queries and garbage', () => {
		expect(() => normalizeUrl('https://u:p@example.org')).toThrow(/credentials/);
		expect(() => normalizeUrl('https://example.org/?x=1')).toThrow(/query/);
		expect(() => normalizeUrl('not a url')).toThrow(/valid/);
	});
});

describe('fetchInfo', () => {
	const backend = { id: 'a', url: 'https://fleet.example.org' };
	it('returns valid info', async () => {
		const info = { name: 'home', version: '0.1.0', apiVersion: 'v1' };
		const fake = (async () => new Response(JSON.stringify(info))) as typeof fetch;
		await expect(fetchInfo(backend, fake)).resolves.toEqual(info);
	});
	it('rejects foreign responses', async () => {
		const fake = (async () => new Response('{"hello":"world"}')) as typeof fetch;
		await expect(fetchInfo(backend, fake)).rejects.toThrow(/NepFleet/);
	});
});

describe('fetchStacks', () => {
	const backend = { id: 'a', url: 'https://fleet.example.org' };
	const stack = { name: 'web', target: 'nas', mode: 'compose', apply: 'manual', updates: 'notify' };
	it('sends the token and returns the stacks', async () => {
		let auth = '';
		const fake = (async (_url: string, init?: RequestInit) => {
			auth = new Headers(init?.headers).get('Authorization') ?? '';
			return new Response(
				JSON.stringify([stack, { ...stack, name: 'db', template: 'official/x@1' }])
			);
		}) as typeof fetch;
		const got = await fetchStacks(backend, 'nft_abc', fake);
		expect(auth).toBe('Bearer nft_abc');
		expect(got.map((s) => s.name)).toEqual(['web', 'db']);
	});
	it('reports a refused token as an auth error', async () => {
		const fake = (async () => new Response('no', { status: 401 })) as typeof fetch;
		await expect(fetchStacks(backend, 'nft_x', fake)).rejects.toBeInstanceOf(AuthError);
	});
	it('rejects malformed lists', async () => {
		const fake = (async () => new Response('[{"name":1}]')) as typeof fetch;
		await expect(fetchStacks(backend, 'nft_x', fake)).rejects.toThrow(/Unexpected/);
	});
});

describe('fetchPlan and fetchHistory', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const respond = (status: number, body: unknown) =>
		(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
	it('reads a plan and sends the token', async () => {
		let auth = '';
		let url = '';
		const fetcher = (async (u: string, init: RequestInit) => {
			url = u;
			auth = new Headers(init.headers).get('Authorization') ?? '';
			return new Response(
				JSON.stringify({ stack: 'web', mode: 'compose', first: false, changes: null })
			);
		}) as unknown as typeof fetch;
		const p = await fetchPlan(backend, 'nft_x', 'web', fetcher);
		expect(p.stack).toBe('web');
		expect(auth).toBe('Bearer nft_x');
		expect(url).toBe('https://fleet.example.org/api/v1/stacks/web/plan');
	});
	it('tells unknown stacks and refused tokens apart', async () => {
		await expect(fetchPlan(backend, 't', 'x', respond(404, 'no'))).rejects.toBeInstanceOf(
			NotFoundError
		);
		await expect(fetchHistory(backend, 't', 'x', 5, respond(401, 'no'))).rejects.toBeInstanceOf(
			AuthError
		);
		await expect(fetchHistory(backend, 't', 'x', 5, respond(200, [{ commit: 1 }]))).rejects.toThrow(
			/Unexpected/
		);
	});
	it('reads history', async () => {
		const h = await fetchHistory(
			backend,
			't',
			'web',
			5,
			respond(200, [
				{
					commit: 'abc',
					date: '2026-11-07T08:00:00+01:00',
					author: 'A',
					subject: 's',
					applied: true
				}
			])
		);
		expect(h[0]?.applied).toBe(true);
	});
});

describe('startApply', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const job = { id: 'j1', stack: 'web', kind: 'apply', state: 'running', log: '', by: 'ui' };
	it('sends the reviewed plan and returns the job', async () => {
		let body = '';
		let method = '';
		const fetcher = (async (_: string, init: RequestInit) => {
			body = String(init.body);
			method = String(init.method);
			return new Response(JSON.stringify(job), { status: 202 });
		}) as unknown as typeof fetch;
		const j = await startApply(backend, 't', 'web', 'abc', true, fetcher);
		expect(j.id).toBe('j1');
		expect(method).toBe('POST');
		expect(JSON.parse(body)).toEqual({ plan: 'abc', confirmDestructive: true });
	});
	it('names refusals', async () => {
		const respond = (status: number, text: string) =>
			(async () => new Response(text, { status })) as unknown as typeof fetch;
		await expect(
			startApply(backend, 't', 'web', 'abc', false, respond(409, 'the plan changed\n'))
		).rejects.toThrow(new ConflictError('the plan changed'));
		await expect(
			startApply(backend, 't', 'web', 'abc', false, respond(403, 'no'))
		).rejects.toBeInstanceOf(ScopeError);
	});
	it('reads a job', async () => {
		const fetcher = (async () =>
			new Response(
				JSON.stringify({ ...job, state: 'failed', error: 'x' })
			)) as unknown as typeof fetch;
		expect((await fetchJob(backend, 't', 'j1', fetcher)).state).toBe('failed');
	});
});

describe('fetchInfo with a token', () => {
	it('sends it and no cookies', async () => {
		let init: RequestInit = {};
		const fetcher = (async (_: string, i: RequestInit) => {
			init = i;
			return new Response(JSON.stringify({ name: 'n', version: 'v', apiVersion: 'v1' }));
		}) as unknown as typeof fetch;
		await fetchInfo(
			{ id: 'l', url: 'http://127.0.0.1:7481/v1/remotes/nas' },
			fetcher,
			5000,
			'nfc_x'
		);
		expect(init.credentials).toBe('omit');
		expect(new Headers(init.headers).get('Authorization')).toBe('Bearer nfc_x');
	});
});

describe('startRollback', () => {
	it('sends the commit', async () => {
		let url = '';
		let body = '';
		const fetcher = (async (u: string, init: RequestInit) => {
			url = u;
			body = String(init.body);
			return new Response(JSON.stringify({ id: 'j', state: 'running', log: '' }), { status: 202 });
		}) as unknown as typeof fetch;
		const j = await startRollback(
			{ id: 'b', url: 'https://f.example' },
			't',
			'web',
			'abc',
			false,
			fetcher
		);
		expect(j.id).toBe('j');
		expect(url).toBe('https://f.example/api/v1/stacks/web/rollback');
		expect(JSON.parse(body)).toEqual({ commit: 'abc', confirmDestructive: false });
	});
});

describe('fetchUpdates', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads what the registries have, and refuses odd answers', async () => {
		let url = '';
		const fetcher = (async (u: string) => {
			url = u;
			return new Response(
				JSON.stringify([
					{ stack: 'my web', image: 'nginx', track: 'minor', current: '1.28', next: '1.29' }
				])
			);
		}) as unknown as typeof fetch;
		const u = await fetchUpdates(backend, 't', 'my web', fetcher);
		expect(u[0]?.next).toBe('1.29');
		expect(url).toBe('https://fleet.example.org/api/v1/stacks/my%20web/updates');
		const odd = (async () =>
			new Response(JSON.stringify([{ image: 'x' }]))) as unknown as typeof fetch;
		await expect(fetchUpdates(backend, 't', 'web', odd)).rejects.toThrow(/Unexpected/);
	});
});
