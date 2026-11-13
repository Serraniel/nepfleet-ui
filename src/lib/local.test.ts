import { describe as group, expect, it } from 'vitest';
import { AuthError, ConflictError } from './backend.ts';
import {
	type RemoteReport,
	addRemote,
	canConnect,
	describe,
	fetchEvents,
	fetchRemotes,
	markSeen,
	normalizeDaemonUrl,
	remoteAction,
	fetchSetupJob,
	fetchSetupPlan,
	removeRemote,
	setupKind,
	startSetup
} from './local.ts';

const daemon = 'http://127.0.0.1:7481';

function fake(status: number, body?: unknown) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return new Response(body === undefined ? null : JSON.stringify(body), { status });
	}) as unknown as typeof fetch;
	return { calls, fetcher };
}

group('normalizeDaemonUrl', () => {
	it('takes loopback only', () => {
		expect(normalizeDaemonUrl('http://127.0.0.1:7481/')).toBe(daemon);
		expect(normalizeDaemonUrl('http://localhost:7481')).toBe('http://localhost:7481');
		expect(() => normalizeDaemonUrl('https://fleet.example.org')).toThrow(/this machine/);
		expect(() => normalizeDaemonUrl('http://192.168.1.2:7481')).toThrow();
	});
});

group('the daemon API', () => {
	it('lists remotes with the token', async () => {
		const { calls, fetcher } = fake(200, [{ name: 'nas', address: 'ssh://nas', tunnel: 'up' }]);
		const all = await fetchRemotes(daemon, 'nfc_x', fetcher);
		expect(all[0]?.tunnel).toBe('up');
		expect(calls[0]?.url).toBe(daemon + '/v1/remotes');
		expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe('Bearer nfc_x');
	});
	it('rejects odd answers and names refusals', async () => {
		await expect(fetchRemotes(daemon, 't', fake(200, [{ x: 1 }]).fetcher)).rejects.toThrow(
			/Unexpected/
		);
		await expect(fetchRemotes(daemon, 't', fake(401).fetcher)).rejects.toBeInstanceOf(AuthError);
		await expect(
			addRemote(daemon, 't', 'ssh://nas', '', fake(409, { error: 'exists' }).fetcher)
		).rejects.toBeInstanceOf(ConflictError);
		await expect(
			addRemote(daemon, 't', 'ssh://x', '', fake(502, { error: 'host key unknown' }).fetcher)
		).rejects.toThrow('host key unknown');
	});
	it('escapes names in paths', async () => {
		const a = fake(200, { name: 'a/b', address: 'x' });
		await remoteAction(daemon, 't', 'a/b', 'connect', a.fetcher);
		expect(a.calls[0]?.url).toBe(daemon + '/v1/remotes/a%2Fb/connect');
		const b = fake(204);
		await removeRemote(daemon, 't', 'nas', b.fetcher);
		expect(b.calls[0]?.init.method).toBe('DELETE');
	});
});

group('describe', () => {
	it('says what is there', () => {
		expect(describe({ os: 'Arch Linux', arch: 'x86_64', docker: false })).toBe(
			'Arch Linux, x86_64 · no Docker'
		);
		expect(
			describe({
				docker: true,
				dockerRunning: true,
				dockerVersion: '29',
				containers: 3,
				swarm: 'manager',
				nepfleetRunning: true
			})
		).toBe('Docker 29, 3 containers · swarm manager · NepFleet running');
	});
});

group('events', () => {
	it('reads a page and rejects odd answers', async () => {
		const a = fake(200, { events: [{ id: 3, title: 't' }], unread: 1, seen: 2 });
		const page = await fetchEvents(daemon, 't', 2, 500, a.fetcher);
		expect(page.events[0]?.id).toBe(3);
		expect(page.unread).toBe(1);
		expect(a.calls[0]?.url).toBe(daemon + '/v1/events?after=2&limit=500');
		await expect(
			fetchEvents(daemon, 't', 0, 500, fake(200, { events: [{ x: 1 }] }).fetcher)
		).rejects.toThrow(/Unexpected/);
	});
	it('marks read', async () => {
		const a = fake(204);
		await markSeen(daemon, 't', 9, a.fetcher);
		expect(a.calls[0]?.init.body).toBe('{"id":9}');
	});
});

group('setting a machine up', () => {
	it('knows what a machine needs next', () => {
		expect(setupKind(undefined)).toBeUndefined();
		expect(setupKind({ kernel: 'Linux', docker: false })).toBe('bootstrap');
		expect(setupKind({ kernel: 'Linux', docker: true, dockerRunning: true })).toBe('bootstrap');
		expect(setupKind({ kernel: 'Linux', docker: true, dockerRunning: true, compose: '2.40' })).toBe(
			'install'
		);
		expect(
			setupKind({
				kernel: 'Linux',
				docker: true,
				dockerRunning: true,
				compose: '2.40',
				nepfleetRunning: true
			})
		).toBeUndefined();
		expect(setupKind({ kernel: 'Darwin' })).toBeUndefined();
	});
	it('plans, starts the reviewed plan and follows the job', async () => {
		const plan = fake(200, {
			kind: 'install',
			steps: [{ text: 'pull the image', root: false }],
			id: 'p1'
		});
		const p = await fetchSetupPlan(daemon, 't', 'my vps', 'install', plan.fetcher);
		expect(p.id).toBe('p1');
		expect(plan.calls[0]?.url).toBe(daemon + '/v1/remotes/my%20vps/setup?kind=install');
		const start = fake(202, { kind: 'install', state: 'running', log: '' });
		await startSetup(daemon, 't', 'vps', 'install', 'p1', start.fetcher);
		expect(JSON.parse(start.calls[0]?.init.body as string)).toEqual({
			kind: 'install',
			plan: 'p1'
		});
		const job = fake(200, { kind: 'install', state: 'succeeded', log: '1/1 pull the image\n' });
		expect((await fetchSetupJob(daemon, 't', 'vps', job.fetcher)).state).toBe('succeeded');
		await expect(
			startSetup(
				daemon,
				't',
				'vps',
				'install',
				'old',
				fake(409, { error: 'the plan changed' }).fetcher
			)
		).rejects.toBeInstanceOf(ConflictError);
		await expect(
			fetchSetupPlan(daemon, 't', 'vps', 'install', fake(200, { kind: 'x' }).fetcher)
		).rejects.toThrow(/Unexpected/);
	});
});

group('canConnect', () => {
	it('needs a NepFleet on the machine', () => {
		expect(canConnect(undefined)).toBe(false);
		expect(canConnect({ kernel: 'Linux', docker: true } as RemoteReport)).toBe(false);
		expect(canConnect({ kernel: 'Linux', nepfleetRunning: true } as RemoteReport)).toBe(true);
		expect(canConnect({ kernel: 'Linux', fleet: '/srv/nepfleet' } as RemoteReport)).toBe(true);
	});
});
