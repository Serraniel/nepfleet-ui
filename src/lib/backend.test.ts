import { describe, expect, it } from 'vitest';
import {
	AuthError,
	ConflictError,
	ScopeError,
	createStack,
	InvalidEditError,
	VerifyFirstError,
	fetchStackFiles,
	saveStackFiles,
	startApply,
	startRollback,
	fetchJob,
	NotFoundError,
	fetchHistory,
	fetchEgress,
	fetchMaintenance,
	fetchUpdates,
	fetchInfo,
	fetchPlan,
	fetchStacks,
	normalizeUrl,
	stackPlaces,
	stackRelations,
	SyncOffError,
	fetchSync,
	syncNow,
	fetchSecretKeys,
	setSecret,
	secretKeyPattern,
	fetchFeatures,
	fetchChannels,
	testChannel
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
	it('sends an SSH address to the Fleets page', () => {
		expect(() => normalizeUrl('ssh://me@203.0.113.9')).toThrow(/Fleets page/);
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

describe('taking updates', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('plans and applies with updateLock only when asked', async () => {
		const calls: { url: string; body?: string }[] = [];
		const fetcher = (async (u: string, init: RequestInit) => {
			calls.push({ url: u, body: init.body as string | undefined });
			if (u.endsWith('/apply'))
				return new Response(
					JSON.stringify({ id: 'j1', stack: 'web', kind: 'apply', state: 'running', log: '' }),
					{
						status: 202
					}
				);
			return new Response(
				JSON.stringify({ stack: 'web', mode: 'compose', first: false, changes: null })
			);
		}) as unknown as typeof fetch;
		await fetchPlan(backend, 't', 'web', fetcher);
		await fetchPlan(backend, 't', 'web', fetcher, 1000, true);
		await startApply(backend, 't', 'web', 'p1', false, fetcher);
		await startApply(backend, 't', 'web', 'p1', false, fetcher, 1000, true);
		expect(calls.map((c) => c.url.replace(backend.url, ''))).toEqual([
			'/api/v1/stacks/web/plan',
			'/api/v1/stacks/web/plan?updateLock=true',
			'/api/v1/stacks/web/apply',
			'/api/v1/stacks/web/apply'
		]);
		expect(JSON.parse(calls[2]?.body ?? '{}')).toEqual({ plan: 'p1', confirmDestructive: false });
		expect(JSON.parse(calls[3]?.body ?? '{}')).toEqual({
			plan: 'p1',
			confirmDestructive: false,
			updateLock: true
		});
	});
});

describe('fetchMaintenance', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads windows per Kuma, and refuses odd answers', async () => {
		const ok = (async () =>
			new Response(
				JSON.stringify([
					{
						kuma: 'home',
						windows: [
							{
								id: 1,
								title: 'NepFleet: update of web',
								strategy: 'single',
								active: true,
								status: 'under-maintenance'
							}
						]
					},
					{ kuma: 'cloud', error: 'unreachable', windows: [] }
				])
			)) as unknown as typeof fetch;
		const m = await fetchMaintenance(backend, 't', ok);
		expect(m[0]?.windows[0]?.status).toBe('under-maintenance');
		expect(m[1]?.error).toBe('unreachable');
		const odd = (async () =>
			new Response(JSON.stringify([{ kuma: 'home' }]))) as unknown as typeof fetch;
		await expect(fetchMaintenance(backend, 't', odd)).rejects.toThrow(/Unexpected/);
	});
});

describe('fetchEgress', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads the report, and refuses odd answers', async () => {
		const ok = (async () =>
			new Response(
				JSON.stringify({
					mode: 'enforce',
					sidecars: 1,
					hosts: ['api.example.org'],
					addresses: [],
					lookedUp: []
				})
			)) as unknown as typeof fetch;
		const e = await fetchEgress(backend, 't', 'web', ok);
		expect(e.hosts).toEqual(['api.example.org']);
		const odd = (async () =>
			new Response(
				JSON.stringify({ mode: 'log', sidecars: 1, hosts: null })
			)) as unknown as typeof fetch;
		await expect(fetchEgress(backend, 't', 'web', odd)).rejects.toThrow(/Unexpected/);
	});
});

describe('stack state', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const reply = (body: unknown) =>
		(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
	const base = { name: 'web', target: 'h', mode: 'compose', apply: 'manual', updates: 'notify' };
	it('passes the state through, and refuses a malformed one', async () => {
		const s = await fetchStacks(backend, 't', reply([{ ...base, state: 'unhealthy' }]));
		expect(s[0]?.state).toBe('unhealthy');
		await expect(fetchStacks(backend, 't', reply([{ ...base, state: 3 }]))).rejects.toThrow();
	});
});

describe('editing stack files', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const reply = (status: number, body: unknown) =>
		(async () =>
			new Response(typeof body === 'string' ? body : JSON.stringify(body), {
				status
			})) as unknown as typeof fetch;
	it('lists files, and refuses odd answers', async () => {
		const f = await fetchStackFiles(
			backend,
			't',
			'web',
			reply(200, [{ path: 'stack.yaml', content: 'x', revision: 'r1' }])
		);
		expect(f[0]?.revision).toBe('r1');
		await expect(fetchStackFiles(backend, 't', 'web', reply(200, [{ path: 1 }]))).rejects.toThrow(
			/Unexpected/
		);
	});
	it('saves with base revisions, and names each refusal', async () => {
		let sent = '';
		const ok = (async (_u: string, init: RequestInit) => {
			sent = init.body as string;
			return new Response(JSON.stringify({ commit: 'c1' }));
		}) as unknown as typeof fetch;
		expect(
			await saveStackFiles(
				backend,
				't',
				'web',
				{ 'compose.yaml': 'y' },
				{ 'compose.yaml': 'r1' },
				'bump',
				ok
			)
		).toBe('c1');
		expect(JSON.parse(sent)).toEqual({
			files: { 'compose.yaml': 'y' },
			base: { 'compose.yaml': 'r1' },
			message: 'bump'
		});
		const save = (f: typeof fetch) => saveStackFiles(backend, 't', 'web', { a: 'b' }, {}, '', f);
		await expect(save(reply(403, { verify: true }))).rejects.toBeInstanceOf(VerifyFirstError);
		await expect(save(reply(403, 'forbidden'))).rejects.toBeInstanceOf(ScopeError);
		await expect(save(reply(409, 'a file changed'))).rejects.toBeInstanceOf(ConflictError);
		await expect(save(reply(422, 'not saved: bad'))).rejects.toBeInstanceOf(InvalidEditError);
	});
});

describe('Git sync', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads the status, and treats an older server as off', async () => {
		const ok = (async () =>
			new Response(
				JSON.stringify({
					enabled: true,
					interval: '5m0s',
					commit: 'abc1234',
					applied: ['web'],
					pending: ['db']
				})
			)) as unknown as typeof fetch;
		const s = await fetchSync(backend, 't', ok);
		expect(s.pending).toEqual(['db']);
		const old = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
		expect((await fetchSync(backend, 't', old)).enabled).toBe(false);
		const odd = (async () =>
			new Response(JSON.stringify({ enabled: 'yes' }))) as unknown as typeof fetch;
		await expect(fetchSync(backend, 't', odd)).rejects.toThrow(/Unexpected/);
	});
	it('asks for a sync, and says when the server does not sync', async () => {
		let method = '';
		const ok = (async (_u: string, init: RequestInit) => {
			method = init.method ?? '';
			return new Response(null, { status: 202 });
		}) as unknown as typeof fetch;
		await syncNow(backend, 't', ok);
		expect(method).toBe('POST');
		const off = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
		await expect(syncNow(backend, 't', off)).rejects.toBeInstanceOf(SyncOffError);
		const read = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
		await expect(syncNow(backend, 't', read)).rejects.toThrow(/apply scope/);
	});
});

describe('createStack', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const reply = (status: number, body: unknown) =>
		(async () =>
			new Response(typeof body === 'string' ? body : JSON.stringify(body), {
				status
			})) as unknown as typeof fetch;
	it('posts the request, and names each refusal', async () => {
		let sent = '';
		const ok = (async (_u: string, init: RequestInit) => {
			sent = String(init.body);
			return new Response(JSON.stringify({ name: 'web', commit: 'c1' }), { status: 201 });
		}) as unknown as typeof fetch;
		const res = await createStack(
			backend,
			't',
			{ template: 'hello', name: 'web', values: { A: 'b' } },
			ok
		);
		expect(res.commit).toBe('c1');
		expect(JSON.parse(sent)).toEqual({ template: 'hello', name: 'web', values: { A: 'b' } });
		const make = (f: typeof fetch) => createStack(backend, 't', { template: 'hello' }, f);
		await expect(make(reply(403, { verify: true }))).rejects.toBeInstanceOf(VerifyFirstError);
		await expect(make(reply(403, 'this token may not create db'))).rejects.toBeInstanceOf(
			ScopeError
		);
		await expect(make(reply(409, 'exists'))).rejects.toBeInstanceOf(ConflictError);
		await expect(make(reply(422, 'not saved: GREETING is required'))).rejects.toThrow(/GREETING/);
	});
});

describe('secrets', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('lists keys, sets and removes, and names refusals', async () => {
		const keys = (async () =>
			new Response(JSON.stringify({ keys: ['DB_PASSWORD'] }))) as unknown as typeof fetch;
		expect(await fetchSecretKeys(backend, 't', 'web', keys)).toEqual(['DB_PASSWORD']);
		const sent: { url: string; method: string; body: unknown }[] = [];
		const ok = (async (u: string, init: RequestInit) => {
			sent.push({ url: u, method: init.method ?? '', body: init.body });
			return new Response(JSON.stringify({ commit: 'c1' }));
		}) as unknown as typeof fetch;
		expect(await setSecret(backend, 't', 'web', 'DB_PASSWORD', 'pw', ok)).toBe('c1');
		await setSecret(backend, 't', '', 'KUMA', null, ok);
		expect(sent[0]).toEqual({
			url: 'https://fleet.example.org/api/v1/stacks/web/secrets/DB_PASSWORD',
			method: 'PUT',
			body: '{"value":"pw"}'
		});
		expect(sent[1]).toMatchObject({
			url: 'https://fleet.example.org/api/v1/secrets/KUMA',
			method: 'DELETE',
			body: undefined
		});
		const reply = (status: number, body: unknown) =>
			(async () =>
				new Response(typeof body === 'string' ? body : JSON.stringify(body), {
					status
				})) as unknown as typeof fetch;
		await expect(
			setSecret(backend, 't', 'web', 'K', 'v', reply(403, { verify: true }))
		).rejects.toBeInstanceOf(VerifyFirstError);
		await expect(setSecret(backend, 't', '', 'K', 'v', reply(403, 'no'))).rejects.toThrow(/admin/);
		await expect(setSecret(backend, 't', 'web', 'K', null, reply(404, ''))).rejects.toThrow(
			/No such secret/
		);
		expect(secretKeyPattern.test('DB_PASSWORD')).toBe(true);
		expect(secretKeyPattern.test('1X')).toBe(false);
	});
});

describe('fetchFeatures', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads features, and an older backend has none', async () => {
		const ok = (async () =>
			new Response(
				JSON.stringify([{ name: 'logs', template: 'dozzle', what: 'logs', stacks: ['dozzle@nas'] }])
			)) as unknown as typeof fetch;
		expect((await fetchFeatures(backend, 't', ok))?.[0]?.stacks).toEqual(['dozzle@nas']);
		const old = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
		expect(await fetchFeatures(backend, 't', old)).toBeNull();
		const odd = (async () =>
			new Response(JSON.stringify([{ name: 'logs' }]))) as unknown as typeof fetch;
		await expect(fetchFeatures(backend, 't', odd)).rejects.toThrow(/Unexpected/);
	});
});

describe('notification channels', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('lists names, tests one, and passes the reason on', async () => {
		const list = (async () =>
			new Response(JSON.stringify({ channels: ['discord'] }))) as unknown as typeof fetch;
		expect(await fetchChannels(backend, 't', list)).toEqual(['discord']);
		const old = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
		expect(await fetchChannels(backend, 't', old)).toBeNull();
		let url = '';
		const ok = (async (u: string) => {
			url = u;
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;
		await testChannel(backend, 't', 'discord', ok);
		expect(url).toBe('https://fleet.example.org/api/v1/notifications/channels/discord/test');
		const bad = (async () =>
			new Response('sending failed: 401 Unauthorized', { status: 502 })) as unknown as typeof fetch;
		await expect(testChannel(backend, 't', 'discord', bad)).rejects.toThrow(/401/);
	});
});
