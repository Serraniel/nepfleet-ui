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
	fetchContainers,
	dnsDomain,
	letCaddyKeepDNS,
	fetchLogs,
	followLogs,
	serviceAction,
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
	fetchSBOM,
	fetchChannelList,
	fetchChannels,
	testChannel,
	fetchTokens,
	createToken,
	revokeToken,
	fetchDoctor,
	fetchUsers,
	removeAccess,
	allowEgress,
	fetchRendered,
	startUpdates,
	backupKey,
	fetchMirrors,
	mirrorNow,
	mirrorURLKind,
	addMirror,
	removeMirror,
	fetchEvents,
	fetchMatches,
	fetchBackups,
	startRestore,
	fetchComposeProjects,
	importCompose,
	neededScope,
	scopeMessage,
	setChannel,
	fetchRoutes,
	saveRoutes,
	fetchMail,
	saveMail,
	testMail
} from './backend.ts';

describe('mail', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const reply = (status: number, body: unknown) =>
		(async () =>
			new Response(status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body), {
				status
			})) as unknown as typeof fetch;
	it('reads the settings, and an older backend has none', async () => {
		const m = {
			configured: true,
			host: 'smtp.example.test',
			port: 587,
			user: 'u',
			from: 'f@example.test',
			tls: 'starttls',
			passwordSet: true
		};
		expect(await fetchMail(backend, 't', reply(200, m))).toEqual(m);
		expect(await fetchMail(backend, 't', reply(404, ''))).toBeNull();
		await expect(fetchMail(backend, 't', reply(200, { host: 1 }))).rejects.toThrow(/Unexpected/);
		await expect(fetchMail(backend, 't', reply(403, ''))).rejects.toBeInstanceOf(ScopeError);
	});
	it('saves and removes, asking for a passkey when told', async () => {
		const sent: { url: string; method: string; body: unknown }[] = [];
		const ok = (async (u: string, init: RequestInit) => {
			sent.push({ url: u, method: init.method ?? '', body: init.body });
			return new Response(JSON.stringify({ commit: 'c1' }));
		}) as unknown as typeof fetch;
		expect(await saveMail(backend, 't', { host: 'smtp.example.test', password: 'pw' }, ok)).toBe(
			'c1'
		);
		await saveMail(backend, 't', null, ok);
		expect(sent[0]).toEqual({
			url: 'https://fleet.example.org/api/v1/mail',
			method: 'PUT',
			body: '{"host":"smtp.example.test","password":"pw"}'
		});
		expect(sent[1]).toMatchObject({ method: 'DELETE', body: undefined });
		const save = (f: typeof fetch) => saveMail(backend, 't', { host: 'h' }, f);
		await expect(save(reply(403, { verify: true }))).rejects.toBeInstanceOf(VerifyFirstError);
		await expect(save(reply(403, 'no'))).rejects.toThrow(/admin/);
		await expect(save(reply(409, 'busy'))).rejects.toBeInstanceOf(ConflictError);
		await expect(save(reply(400, 'not saved: host is wrong'))).rejects.toThrow(/host is wrong/);
	});
	it('sends a test, with the reason when it fails', async () => {
		let body = '';
		const ok = (async (_u: string, init: RequestInit) => {
			body = String(init.body);
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;
		await testMail(backend, 't', 'me@example.test', ok);
		expect(JSON.parse(body)).toEqual({ to: 'me@example.test' });
		await expect(
			testMail(backend, 't', 'a@example.test', reply(502, 'sending failed: 535'))
		).rejects.toThrow(/535/);
		await expect(testMail(backend, 't', 'a@example.test', reply(429, 'at most 5'))).rejects.toThrow(
			/at most 5/
		);
		await expect(testMail(backend, 't', 'a@example.test', reply(404, ''))).rejects.toThrow(/Save/);
	});
});

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
		).toEqual(['Open web.example.org', 'Logs in Dozzle']);
		expect(stackPlaces({ ...stack, url: 'https://example.org/wiki/' })[0]?.name).toBe(
			'Open example.org/wiki/'
		);
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

describe('containers', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const reply = (status: number, body?: unknown) => {
		const calls: string[] = [];
		const fetcher = (async (url: string, init?: RequestInit) => {
			calls.push(`${init?.method ?? 'GET'} ${url}`);
			return new Response(body === undefined ? null : JSON.stringify(body), { status });
		}) as unknown as typeof fetch;
		return { fetcher, calls };
	};
	it('lists them, and refuses odd answers', async () => {
		const web = {
			service: 'web',
			name: 'web-web-1',
			state: 'running',
			health: 'healthy',
			image: 'nginx:1.29',
			restarts: 0
		};
		const ok = reply(200, [web]);
		expect(await fetchContainers(backend, 't', 'web', ok.fetcher)).toEqual([web]);
		expect(ok.calls[0]).toBe('GET https://fleet.example.org/api/v1/stacks/web/containers');
		await expect(
			fetchContainers(backend, 't', 'web', reply(200, [{ ...web, restarts: 'many' }]).fetcher)
		).rejects.toThrow(/Unexpected/);
	});
	it('reads logs as text, and says when the token may not', async () => {
		const calls: string[] = [];
		const ok = (async (url: string) => {
			calls.push(url);
			return new Response('2026-11-15T10:00:00Z hello\n');
		}) as unknown as typeof fetch;
		expect(await fetchLogs(backend, 't', 'web', 'web-web-1', 50, ok)).toContain('hello');
		expect(calls[0]).toBe(
			'https://fleet.example.org/api/v1/stacks/web/containers/web-web-1/logs?lines=50'
		);
		await expect(
			fetchLogs(backend, 't', 'web', 'web-web-1', 50, reply(403).fetcher)
		).rejects.toBeInstanceOf(ScopeError);
	});
	it('acts on a service, and names why it can not', async () => {
		const ok = reply(204);
		await serviceAction(backend, 't', 'web', 'db', 'restart', ok.fetcher);
		expect(ok.calls[0]).toBe(
			'POST https://fleet.example.org/api/v1/stacks/web/services/db/restart'
		);
		await expect(
			serviceAction(backend, 't', 'web', 'db', 'stop', reply(503).fetcher)
		).rejects.toBeInstanceOf(ConflictError);
		await expect(
			serviceAction(backend, 't', 'web', 'db', 'stop', reply(403).fetcher)
		).rejects.toBeInstanceOf(ScopeError);
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
		const remote = (async () =>
			new Response(
				JSON.stringify({ enabled: false, remote: true, remoteUrl: 'https://git.example.org/f.git' })
			)) as unknown as typeof fetch;
		const r = await fetchSync(backend, 't', remote);
		expect(r.remote).toBe(true);
		expect(r.remoteUrl).toBe('https://git.example.org/f.git');
		const badRemote = (async () =>
			new Response(JSON.stringify({ enabled: false, remote: 'yes' }))) as unknown as typeof fetch;
		await expect(fetchSync(backend, 't', badRemote)).rejects.toThrow(/Unexpected/);
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
		expect(await fetchChannelList(backend, 't', list)).toEqual({
			channels: ['discord'],
			deliveries: {}
		});
		const delivery = { at: '2026-11-07T10:00:00Z', ok: false, error: '401 Unauthorized' };
		const withDeliveries = (async () =>
			new Response(
				JSON.stringify({ channels: ['discord'], deliveries: { discord: delivery } })
			)) as unknown as typeof fetch;
		expect(await fetchChannelList(backend, 't', withDeliveries)).toEqual({
			channels: ['discord'],
			deliveries: { discord: delivery }
		});
		const odd = (async () =>
			new Response(
				JSON.stringify({ channels: ['discord'], deliveries: { discord: { ok: 'yes' } } })
			)) as unknown as typeof fetch;
		await expect(fetchChannelList(backend, 't', odd)).rejects.toThrow(/Unexpected/);
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

describe('fetchSBOM', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('asks for a stack or the fleet, with contents when wanted', async () => {
		const urls: string[] = [];
		const ok = (async (u: string) => {
			urls.push(u);
			return new Response('{"bomFormat":"CycloneDX"}');
		}) as unknown as typeof fetch;
		expect(await (await fetchSBOM(backend, 't', 'web', false, ok)).text()).toContain('CycloneDX');
		await fetchSBOM(backend, 't', '', true, ok);
		expect(urls).toEqual([
			'https://fleet.example.org/api/v1/stacks/web/sbom',
			'https://fleet.example.org/api/v1/sbom?contents=true'
		]);
		const busy = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
		await expect(fetchSBOM(backend, 't', 'web', false, busy)).rejects.toThrow(/busy/);
	});
});

describe('API tokens', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const info = {
		id: 'abcd1234',
		name: 'ci',
		scope: 'apply',
		created: '2026-01-01T00:00:00Z',
		expires: '2026-04-01T00:00:00Z',
		expired: false
	};
	it('lists, creates with the secret once, revokes, and names refusals', async () => {
		const list = (async () => new Response(JSON.stringify([info]))) as unknown as typeof fetch;
		expect((await fetchTokens(backend, 't', list))[0]?.name).toBe('ci');
		let sent = '';
		const made = (async (_u: string, init: RequestInit) => {
			sent = String(init.body);
			return new Response(JSON.stringify({ token: info, secret: 'nft_x' }), { status: 201 });
		}) as unknown as typeof fetch;
		const c = await createToken(backend, 't', { name: 'ci', scope: 'apply', days: 90 }, made);
		expect(c.secret).toBe('nft_x');
		expect(JSON.parse(sent)).toEqual({ name: 'ci', scope: 'apply', days: 90 });
		let method = '';
		const gone = (async (_u: string, init: RequestInit) => {
			method = init.method ?? '';
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;
		await revokeToken(backend, 't', 'abcd1234', gone);
		expect(method).toBe('DELETE');
		const reply = (status: number, body: unknown) =>
			(async () =>
				new Response(typeof body === 'string' ? body : JSON.stringify(body), {
					status
				})) as unknown as typeof fetch;
		await expect(
			revokeToken(backend, 't', 'x', reply(403, { verify: true }))
		).rejects.toBeInstanceOf(VerifyFirstError);
		await expect(
			createToken(
				backend,
				't',
				{ name: 'x', scope: 'admin', days: 0 },
				reply(422, 'days is 1 to 3650')
			)
		).rejects.toThrow(/days/);
		await expect(fetchTokens(backend, 't', reply(403, 'no'))).rejects.toBeInstanceOf(ScopeError);
	});
});

describe('fetchDoctor', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads the report, and an older backend has none', async () => {
		const ok = (async () =>
			new Response(
				JSON.stringify({
					host: 'nas',
					stacks: 2,
					checks: [{ name: 'Docker', status: 'ok', detail: '29' }],
					security: []
				})
			)) as unknown as typeof fetch;
		expect((await fetchDoctor(backend, 't', ok))?.checks[0]?.status).toBe('ok');
		const old = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
		expect(await fetchDoctor(backend, 't', old)).toBeNull();
		const odd = (async () =>
			new Response(
				JSON.stringify({ host: 'nas', checks: [{ name: 'x', status: 'bad' }], security: [] })
			)) as unknown as typeof fetch;
		await expect(fetchDoctor(backend, 't', odd)).rejects.toThrow(/Unexpected/);
	});
});

describe('people', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('lists people, removes a passkey or a person, and names refusals', async () => {
		const list = (async () =>
			new Response(
				JSON.stringify([
					{
						name: 'Ada',
						created: '2026-01-01T00:00:00Z',
						codes: false,
						passkeys: [{ id: 'abc_def', name: 'abc_def', synced: true, uses: 3 }]
					}
				])
			)) as unknown as typeof fetch;
		expect((await fetchUsers(backend, 't', list))?.[0]?.passkeys[0]?.id).toBe('abc_def');
		const none = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
		expect(await fetchUsers(backend, 't', none)).toBeNull();
		const urls: string[] = [];
		const ok = (async (u: string) => {
			urls.push(u);
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;
		await removeAccess(backend, 't', 'Ada Lovelace', 'abc_def', ok);
		await removeAccess(backend, 't', 'Ada Lovelace', null, ok);
		expect(urls).toEqual([
			'https://fleet.example.org/api/v1/users/Ada%20Lovelace/passkeys/abc_def',
			'https://fleet.example.org/api/v1/users/Ada%20Lovelace'
		]);
		const last = (async () =>
			new Response("it's the last way Ada signs in", { status: 409 })) as unknown as typeof fetch;
		await expect(removeAccess(backend, 't', 'Ada', 'abc', last)).rejects.toThrow(/last way/);
	});
});

describe('allowEgress', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('posts the entries and names refusals', async () => {
		let sent = '';
		const ok = (async (_u: string, init: RequestInit) => {
			sent = String(init.body);
			return new Response(JSON.stringify({ commit: 'c1', added: ['a.org'] }));
		}) as unknown as typeof fetch;
		expect(await allowEgress(backend, 't', 'web', ['a.org'], ok)).toEqual({
			commit: 'c1',
			added: ['a.org']
		});
		expect(JSON.parse(sent)).toEqual({ add: ['a.org'] });
		const bad = (async () =>
			new Response('allow: "*.a.org" is not a host name', {
				status: 422
			})) as unknown as typeof fetch;
		await expect(allowEgress(backend, 't', 'web', ['*.a.org'], bad)).rejects.toBeInstanceOf(
			InvalidEditError
		);
	});
});

describe('fetchRendered', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads the files, and refuses odd answers', async () => {
		const ok = (async () =>
			new Response(
				JSON.stringify([{ path: '.env', content: "PW='••••••'\n" }])
			)) as unknown as typeof fetch;
		expect((await fetchRendered(backend, 't', 'web', ok))[0]?.path).toBe('.env');
		const odd = (async () =>
			new Response(JSON.stringify([{ path: 1 }]))) as unknown as typeof fetch;
		await expect(fetchRendered(backend, 't', 'web', odd)).rejects.toThrow(/Unexpected/);
	});
});

describe('startUpdates', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('starts the job, and names refusals', async () => {
		let sent = '';
		const ok = (async (_u: string, init: RequestInit) => {
			sent = String(init.body);
			return new Response(
				JSON.stringify({
					id: 'j1',
					stack: '',
					kind: 'updates',
					state: 'running',
					log: '',
					by: 'ci'
				}),
				{ status: 202 }
			);
		}) as unknown as typeof fetch;
		expect((await startUpdates(backend, 't', true, ok)).kind).toBe('updates');
		expect(JSON.parse(sent)).toEqual({ now: true });
		const limited = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
		await expect(startUpdates(backend, 't', false, limited)).rejects.toThrow(/not limited/);
	});
});

describe('backupKey', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('posts the recipients and names refusals', async () => {
		let sent = '';
		const ok = (async (_u: string, init: RequestInit) => {
			sent = String(init.body);
			return new Response('-----BEGIN AGE ENCRYPTED FILE-----\n');
		}) as unknown as typeof fetch;
		expect(await (await backupKey(backend, 't', ['age1x'], ok)).text()).toContain('AGE ENCRYPTED');
		expect(JSON.parse(sent)).toEqual({ recipients: ['age1x'] });
		const token = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
		await expect(backupKey(backend, 't', ['age1x'], token)).rejects.toThrow(/person/);
		const verify = (async () =>
			new Response(JSON.stringify({ verify: true }), { status: 403 })) as unknown as typeof fetch;
		await expect(backupKey(backend, 't', ['age1x'], verify)).rejects.toBeInstanceOf(
			VerifyFirstError
		);
	});
});

describe('mirrors', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads the status and pushes now', async () => {
		const list = (async () =>
			new Response(
				JSON.stringify([{ url: 'https://***@git.example.org/f.git', error: 'denied' }])
			)) as unknown as typeof fetch;
		expect((await fetchMirrors(backend, 't', list))?.[0]?.error).toBe('denied');
		const old = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
		expect(await fetchMirrors(backend, 't', old)).toBeNull();
		let method = '';
		const ok = (async (_u: string, init: RequestInit) => {
			method = init.method ?? '';
			return new Response(JSON.stringify([{ url: 'x', ok: '2026-01-01T00:00:00Z' }]));
		}) as unknown as typeof fetch;
		expect((await mirrorNow(backend, 't', ok))[0]?.ok).toBeTruthy();
		expect(method).toBe('POST');
	});
	it('tells the kinds of mirror URL apart, and refuses credentials in them', () => {
		expect(mirrorURLKind('git@codeberg.example.test:me/fleet.git')).toBe('ssh');
		expect(mirrorURLKind('ssh://git@git.example.test:2222/fleet.git')).toBe('ssh');
		expect(mirrorURLKind('https://git.example.test/me/fleet.git')).toBe('https');
		expect(mirrorURLKind('/srv/backup/fleet.git')).toBe('local');
		for (const bad of [
			'https://bot:s3cr3t@git.example.test/x.git',
			'https://tok3n@git.example.test/x.git',
			'http://git.example.test/x.git',
			'git://git.example.test/x.git',
			'relative/path'
		])
			expect(typeof mirrorURLKind(bad)).toBe('object');
	});
	it('adds a mirror, confirming with a passkey first when asked', async () => {
		let body = '';
		const added = (async (_u: string, init: RequestInit) => {
			body = String(init.body);
			return new Response(
				JSON.stringify({
					mirror: {
						id: 'a1',
						url: 'git@h:x.git',
						auth: 'deploy-key',
						publicKey: 'ssh-ed25519 AAAA'
					},
					commit: 'c'
				}),
				{ status: 201 }
			);
		}) as unknown as typeof fetch;
		const r = await addMirror(backend, 't', { url: 'git@h:x.git' }, added);
		expect(r.mirror.publicKey).toBe('ssh-ed25519 AAAA');
		expect(JSON.parse(body)).toEqual({ url: 'git@h:x.git' });
		const verify = (async () =>
			new Response(JSON.stringify({ verify: true }), { status: 403 })) as unknown as typeof fetch;
		await expect(addMirror(backend, 't', { url: 'x' }, verify)).rejects.toBeInstanceOf(
			VerifyFirstError
		);
		const bad = (async () =>
			new Response('no token in the URL', { status: 422 })) as unknown as typeof fetch;
		await expect(addMirror(backend, 't', { url: 'x' }, bad)).rejects.toBeInstanceOf(
			InvalidEditError
		);
		let path = '';
		const removed = (async (u: string, init: RequestInit) => {
			path = `${init.method} ${u}`;
			return new Response(JSON.stringify({ commit: 'd' }));
		}) as unknown as typeof fetch;
		expect(await removeMirror(backend, 't', 'a1', removed)).toBe('d');
		expect(path).toBe('DELETE https://fleet.example.org/api/v1/mirror/remotes/a1');
	});
});

describe('fetchEvents', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('walks the pages and keeps the newest', async () => {
		const ev = (id: number) => ({
			id,
			time: '2026-01-01T00:00:00Z',
			name: 'container.oom',
			severity: 'error',
			title: `e${id}`
		});
		const urls: string[] = [];
		const paged = (async (u: string) => {
			urls.push(u);
			const after = Number(new URL(u).searchParams.get('after'));
			const n = after === 0 ? 500 : 3;
			return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ev(after + i + 1))));
		}) as unknown as typeof fetch;
		const got = await fetchEvents(backend, 't', 10, paged);
		expect(got.length).toBe(10);
		expect(got.at(-1)?.id).toBe(503);
		expect(urls[1]).toContain('after=500');
	});
});

describe('fetchMatches', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads matches and refuses odd answers', async () => {
		const ok = (async () =>
			new Response(
				JSON.stringify({
					matches: [
						{
							source: 'official',
							name: 'jellyfin',
							version: '1.0.0',
							same: [{ image: 'jellyfin/jellyfin', stack: '10.9', template: '10.10' }],
							onlyStack: [],
							onlyTemplate: []
						}
					]
				})
			)) as unknown as typeof fetch;
		expect((await fetchMatches(backend, 't', 'media', ok)).matches[0]?.name).toBe('jellyfin');
		const odd = (async () =>
			new Response(JSON.stringify({ matches: [{}] }))) as unknown as typeof fetch;
		await expect(fetchMatches(backend, 't', 'media', odd)).rejects.toThrow(/Unexpected/);
	});
});

describe('restore', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('lists archives, starts the job, and names refusals', async () => {
		const list = (async () =>
			new Response(
				JSON.stringify({
					folder: '/srv/backups',
					archives: ['backup-1.tar.gz.age'],
					volumes: ['db']
				})
			)) as unknown as typeof fetch;
		expect((await fetchBackups(backend, 't', 'web', list)).volumes).toEqual(['db']);
		let sent = '';
		const ok = (async (_u: string, init: RequestInit) => {
			sent = String(init.body);
			return new Response(
				JSON.stringify({
					id: 'j',
					stack: 'web',
					kind: 'restore',
					state: 'running',
					log: '',
					by: 'a'
				}),
				{ status: 202 }
			);
		}) as unknown as typeof fetch;
		const req = { archive: 'backup-1.tar.gz.age', confirm: 'web' };
		expect((await startRestore(backend, 't', 'web', req, ok)).kind).toBe('restore');
		expect(JSON.parse(sent)).toEqual(req);
		const none = (async () =>
			new Response('no volume-backup stack runs on this host', {
				status: 422
			})) as unknown as typeof fetch;
		await expect(fetchBackups(backend, 't', 'web', none)).rejects.toThrow();
	});
});

describe('compose import', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('lists projects and imports one', async () => {
		const list = (async () =>
			new Response(
				JSON.stringify([{ name: 'blog', status: 'running(2)', configFiles: [], stack: false }])
			)) as unknown as typeof fetch;
		expect((await fetchComposeProjects(backend, 't', list))?.[0]?.name).toBe('blog');
		let sent = '';
		const ok = (async (_u: string, init: RequestInit) => {
			sent = String(init.body);
			return new Response(JSON.stringify({ stack: 'blog', commit: 'c1', log: 'adopted' }), {
				status: 201
			});
		}) as unknown as typeof fetch;
		expect((await importCompose(backend, 't', 'blog', false, ok)).stack).toBe('blog');
		expect(JSON.parse(sent)).toEqual({ project: 'blog' });
		const taken = (async () =>
			new Response('a stack of that name exists already', {
				status: 409
			})) as unknown as typeof fetch;
		await expect(importCompose(backend, 't', 'blog', false, taken)).rejects.toBeInstanceOf(
			ConflictError
		);
	});
});

describe('scope errors', () => {
	it('name the scope a path needs', () => {
		expect(neededScope('/api/v1/tokens')).toBe('admin');
		expect(neededScope('/api/v1/users')).toBe('admin');
		expect(neededScope('/api/v1/stacks/web/files')).toBe('edit');
		expect(neededScope('/api/v1/stacks/web/secrets')).toBe('edit');
		expect(neededScope('/api/v1/import/compose')).toBe('edit');
		expect(neededScope('/api/v1/stacks/web/plan?x=1')).toBe('read');
		expect(scopeMessage('admin')).toContain('admin scope');
	});
	it('say it when the backend refuses', async () => {
		const no = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
		await expect(fetchTokens({ id: 'b', url: 'https://x.example' }, 't', no)).rejects.toThrow(
			/admin scope/
		);
	});
});

describe('job progress', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const answering = (body: unknown) =>
		(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
	const job = { id: 'j', stack: 'web', kind: 'apply', state: 'running', log: '', by: 't' };
	it('is kept when well formed', async () => {
		const j = await fetchJob(
			backend,
			't',
			'j',
			answering({ ...job, progress: { step: 2, steps: 4, text: 'files' } })
		);
		expect(j.progress).toEqual({ step: 2, steps: 4, text: 'files' });
	});
	it('is dropped, not the job, when odd', async () => {
		for (const progress of [
			{ step: 5, steps: 4, text: 'x' },
			{ step: 0, steps: 4, text: 'x' },
			'half'
		]) {
			const j = await fetchJob(backend, 't', 'j', answering({ ...job, progress }));
			expect(j.progress).toBeUndefined();
			expect(j.id).toBe('j');
		}
	});
});

describe('setChannel', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('PUTs the URL and returns the commit', async () => {
		let seen: { method?: string; body?: unknown; url?: string } = {};
		const fetcher = (async (url: string, init: RequestInit) => {
			seen = {
				method: init.method,
				body: init.body ? JSON.parse(init.body as string) : undefined,
				url
			};
			return new Response(JSON.stringify({ commit: 'abc' }));
		}) as unknown as typeof fetch;
		expect(await setChannel(backend, 't', 'my phone', 'ntfy://x/y', 'error', fetcher)).toBe('abc');
		expect(seen.method).toBe('PUT');
		expect(seen.url).toBe('https://fleet.example.org/api/v1/notifications/channels/my%20phone');
		expect(seen.body).toEqual({ url: 'ntfy://x/y', minSeverity: 'error' });
	});
	it('DELETEs without a body', async () => {
		let method = '';
		const fetcher = (async (_u: string, init: RequestInit) => {
			method = init.method ?? '';
			expect(init.body).toBeUndefined();
			return new Response(JSON.stringify({ commit: 'def' }));
		}) as unknown as typeof fetch;
		expect(await setChannel(backend, 't', 'phone', null, 'warning', fetcher)).toBe('def');
		expect(method).toBe('DELETE');
	});
	it('says what an old backend or a missing scope means', async () => {
		const answer = (status: number) =>
			(async () => new Response('', { status })) as unknown as typeof fetch;
		await expect(setChannel(backend, 't', 'p', 'ntfy://x', 'warning', answer(405))).rejects.toThrow(
			'too old'
		);
		await expect(setChannel(backend, 't', 'p', 'ntfy://x', 'warning', answer(403))).rejects.toThrow(
			'admin'
		);
	});
});

describe('DNS records fix', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('reads the domain from a DNS check', () => {
		expect(
			dnsDomain("dozzle: monitor.vps.example.org doesn't resolve, so the site can't be reached")
		).toBe('monitor.vps.example.org');
		expect(dnsDomain('nothing here')).toBe('');
	});
	it('turns Caddy’s records on, and says why not', async () => {
		const calls: { url: string; body: string }[] = [];
		const ok = (async (url: string, init: RequestInit) => {
			calls.push({ url, body: String(init.body) });
			return new Response(JSON.stringify({ stack: 'caddy', commit: 'abc' }));
		}) as unknown as typeof fetch;
		expect(await letCaddyKeepDNS(backend, 't', 'example.org', ok)).toEqual({
			stack: 'caddy',
			commit: 'abc'
		});
		expect(calls[0]).toEqual({
			url: 'https://fleet.example.org/api/v1/dns-records',
			body: '{"zone":"example.org"}'
		});
		const refused = (async () =>
			new Response('no Caddy stack runs on this host', { status: 422 })) as unknown as typeof fetch;
		await expect(letCaddyKeepDNS(backend, 't', 'example.org', refused)).rejects.toThrow(
			'no Caddy stack'
		);
	});
});

describe('followLogs', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('hands over each chunk as it comes, and says why not', async () => {
		let url = '';
		const streaming = (async (u: string) => {
			url = u;
			const body = new ReadableStream({
				start(c) {
					c.enqueue(new TextEncoder().encode('first\n'));
					c.enqueue(new TextEncoder().encode('second\n'));
					c.close();
				}
			});
			return new Response(body);
		}) as unknown as typeof fetch;
		const got: string[] = [];
		await followLogs(
			backend,
			't',
			'web',
			'web-web-1',
			(t) => got.push(t),
			new AbortController().signal,
			50,
			streaming
		);
		expect(got.join('')).toBe('first\nsecond\n');
		expect(url).toBe(
			'https://fleet.example.org/api/v1/stacks/web/containers/web-web-1/logs?lines=50&follow=1'
		);
		const old = (async () => new Response('', { status: 501 })) as unknown as typeof fetch;
		await expect(
			followLogs(backend, 't', 'web', 'x', () => {}, new AbortController().signal, 50, old)
		).rejects.toThrow('too old');
	});
});

describe('notification routes', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	it('lists the routes, or null from an old backend', async () => {
		const ok = (async () =>
			new Response(
				JSON.stringify({
					routes: [{ channels: ['phone'], events: ['apply.*'], stacks: [], minSeverity: 'error' }]
				})
			)) as unknown as typeof fetch;
		expect(await fetchRoutes(backend, 't', ok)).toEqual([
			{ channels: ['phone'], events: ['apply.*'], stacks: [], minSeverity: 'error' }
		]);
		const old = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
		expect(await fetchRoutes(backend, 't', old)).toBeNull();
		const odd = (async () =>
			new Response(JSON.stringify({ routes: [{ channels: 'phone' }] }))) as unknown as typeof fetch;
		await expect(fetchRoutes(backend, 't', odd)).rejects.toThrow();
	});
	it('PUTs the whole list and returns the commit', async () => {
		let body: unknown;
		const fetcher = (async (_u: string, init: RequestInit) => {
			expect(init.method).toBe('PUT');
			body = JSON.parse(init.body as string);
			return new Response(JSON.stringify({ commit: 'abc' }));
		}) as unknown as typeof fetch;
		const routes = [{ channels: ['phone'], events: [], stacks: ['web'] }];
		expect(await saveRoutes(backend, 't', routes, fetcher)).toBe('abc');
		expect(body).toEqual({ routes });
		const refused = (async () =>
			new Response('unknown channel "pager"', { status: 400 })) as unknown as typeof fetch;
		await expect(saveRoutes(backend, 't', routes, refused)).rejects.toThrow('unknown channel');
	});
});
