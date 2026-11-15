import { describe as group, expect, it } from 'vitest';
import { AuthError, ConflictError } from './backend.ts';
import {
	type RemoteReport,
	addRemote,
	LockedKeyError,
	WrongPassphraseError,
	unlockKey,
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
	SETUP_KINDS,
	setupKind,
	startSetup,
	saveSettings,
	runDoctor,
	checkHostUpdates,
	describeHostUpdates,
	updateOffer
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
	it('accepts a plan of every setup kind', async () => {
		for (const kind of SETUP_KINDS) {
			const plan = fake(200, { kind, steps: [{ text: 'a step', root: false }], id: 'p' });
			expect((await fetchSetupPlan(daemon, 't', 'vps', kind, plan.fetcher)).kind).toBe(kind);
		}
		const odd = fake(200, { kind: 'format-disk', steps: [], id: 'p' });
		await expect(fetchSetupPlan(daemon, 't', 'vps', 'install', odd.fetcher)).rejects.toThrow();
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
		const running = fake(200, {
			kind: 'install',
			state: 'running',
			log: '1/2 pull the image\n',
			progress: { step: 1, steps: 2, text: 'pull the image' }
		});
		expect((await fetchSetupJob(daemon, 't', 'vps', running.fetcher)).progress).toEqual({
			step: 1,
			steps: 2,
			text: 'pull the image'
		});
		const odd = fake(200, {
			kind: 'install',
			state: 'running',
			log: '',
			progress: { step: 3, steps: 2, text: 'x' }
		});
		const kept = await fetchSetupJob(daemon, 't', 'vps', odd.fetcher);
		expect(kept.state).toBe('running');
		expect(kept.progress).toBeUndefined();
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

group('startSetup with a sudo password', () => {
	it('sends it only when given', async () => {
		const bodies: string[] = [];
		const fetcher = (async (_u: string, init: RequestInit) => {
			bodies.push(String(init.body));
			return new Response(
				JSON.stringify({
					kind: 'bootstrap',
					state: 'running',
					log: '',
					started: '2026-11-13T00:00:00Z'
				}),
				{ status: 202 }
			);
		}) as unknown as typeof fetch;
		await startSetup('http://127.0.0.1:7481', 't', 'vps', 'bootstrap', 'p1', fetcher);
		await startSetup('http://127.0.0.1:7481', 't', 'vps', 'bootstrap', 'p1', fetcher, 'pw');
		expect(JSON.parse(bodies[0] ?? '{}')).toEqual({ kind: 'bootstrap', plan: 'p1' });
		expect(JSON.parse(bodies[1] ?? '{}')).toEqual({
			kind: 'bootstrap',
			plan: 'p1',
			sudoPassword: 'pw'
		});
	});
});

group('locked keys', () => {
	it('turns lockedKeys in an error into LockedKeyError, and unlocks', async () => {
		const reply = (status: number, body: unknown) =>
			(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
		const err = await addRemote(
			'http://127.0.0.1:7481',
			't',
			'ssh://me@vps',
			'vps',
			reply(502, { error: 'refused', lockedKeys: ['/home/me/.ssh/id_rsa'] })
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LockedKeyError);
		expect((err as LockedKeyError).keys).toEqual(['/home/me/.ssh/id_rsa']);
		let sent = '';
		const ok = (async (_u: string, init: RequestInit) => {
			sent = String(init.body);
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;
		await unlockKey('http://127.0.0.1:7481', 't', '/home/me/.ssh/id_rsa', 'pw', ok);
		expect(JSON.parse(sent)).toEqual({ path: '/home/me/.ssh/id_rsa', passphrase: 'pw' });
		await expect(
			unlockKey(
				'http://127.0.0.1:7481',
				't',
				'/home/me/.ssh/id_rsa',
				'no',
				reply(403, { error: "that passphrase doesn't unlock the key" })
			)
		).rejects.toBeInstanceOf(WrongPassphraseError);
	});
});

group('daemon settings and mounts', () => {
	it('saves the fleet folder and plans mounts', async () => {
		const calls: { url: string; method: string }[] = [];
		const fake = (async (u: string, init: RequestInit) => {
			calls.push({ url: u, method: init.method ?? 'GET' });
			if (u.endsWith('/v1/settings'))
				return new Response(JSON.stringify({ fleetDir: '/home/me/fleet' }));
			return new Response(
				JSON.stringify({
					kind: 'mounts',
					steps: [{ text: 'mount nas:/media', root: true }],
					id: 'p1'
				})
			);
		}) as unknown as typeof fetch;
		const saved = await saveSettings(
			'http://127.0.0.1:1',
			't',
			{ fleetDir: '/home/me/fleet' },
			fake
		);
		expect(saved.fleetDir).toBe('/home/me/fleet');
		expect(calls[0]?.method).toBe('PUT');
		const plan = await fetchSetupPlan('http://127.0.0.1:1', 't', 'vps', 'mounts', fake);
		expect(plan.kind).toBe('mounts');
		expect(calls[1]?.url).toContain('kind=mounts');
	});
});

group('checkHostUpdates', () => {
	const answering = (body: unknown) =>
		(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
	const arch = {
		os: 'arch',
		supported: true,
		pending: 2,
		security: 1,
		rebootRequired: true,
		packages: ['linux', 'openssl']
	};
	it('returns and describes the answer', async () => {
		const h = await checkHostUpdates('http://127.0.0.1:7481', 'nfc_x', 'vps', answering(arch));
		expect(h).toEqual(arch);
		expect(describeHostUpdates(h)).toBe('2 updates (1 security fix), reboot required.');
		expect(describeHostUpdates({ ...arch, pending: 0, security: -1, rebootRequired: null })).toBe(
			'Up to date.'
		);
		expect(describeHostUpdates({ ...arch, pending: 1, security: 0, rebootRequired: false })).toBe(
			'1 update, no security fixes.'
		);
		expect(describeHostUpdates({ ...arch, os: 'gentoo', supported: false })).toContain('gentoo');
	});
	it('keeps Arch news, and drops news with an odd link', async () => {
		const item = {
			title: 'Manual step',
			link: 'https://archlinux.org/news/x/',
			published: '2026-10-21T13:58:42Z'
		};
		const ok = await checkHostUpdates(
			'http://127.0.0.1:7481',
			'nfc_x',
			'vps',
			answering({ ...arch, lastUpgrade: '2026-10-20T10:00:00Z', news: [item] })
		);
		expect(ok.news).toEqual([item]);
		const odd = await checkHostUpdates(
			'http://127.0.0.1:7481',
			'nfc_x',
			'vps',
			answering({ ...arch, news: [{ ...item, link: 'javascript:alert(1)' }] })
		);
		expect(odd.news).toBeUndefined();
		expect(odd.pending).toBe(2);
	});
	it('refuses odd answers', async () => {
		for (const body of [
			{},
			{ ...arch, pending: -3 },
			{ ...arch, security: -2 },
			{ ...arch, rebootRequired: 'maybe' },
			{ ...arch, packages: [1] }
		]) {
			await expect(
				checkHostUpdates('http://127.0.0.1:7481', 'nfc_x', 'vps', answering(body))
			).rejects.toThrow('Unexpected response');
		}
	});
});

group('runDoctor', () => {
	const answering = (body: unknown) =>
		(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
	it('returns the checks', async () => {
		const checks = [
			{ name: 'Docker', status: 'ok', detail: '29.9' },
			{ name: 'Key copy', status: 'warn', detail: 'none', fix: 'nepfleet key backup' }
		];
		expect(await runDoctor('http://127.0.0.1:7481', 'nfc_x', 'vps', answering(checks))).toEqual(
			checks
		);
	});
	it('refuses odd answers', async () => {
		for (const body of [{}, [{ name: 'x', status: 'great' }], [{ status: 'ok' }], 'checks']) {
			await expect(
				runDoctor('http://127.0.0.1:7481', 'nfc_x', 'vps', answering(body))
			).rejects.toThrow('Unexpected response');
		}
	});
	it('keeps known actions and drops others, not the check', async () => {
		const got = await runDoctor(
			'http://127.0.0.1:7481',
			'nfc_x',
			'vps',
			answering([
				{ name: 'age key', status: 'fail', action: 'repair' },
				{ name: 'NepFleet', status: 'fail', action: 'start' },
				{ name: 'x', status: 'fail', action: 'rm -rf' }
			])
		);
		expect(got.map((c) => c.action)).toEqual(['repair', 'start', undefined]);
	});
});

group('updateOffer', () => {
	const at = (tag: string) => ({ nepfleetImage: `ghcr.io/serraniel/nepfleet:${tag}` });
	it("offers the daemon's release when the machine runs an older one", () => {
		expect(updateOffer(at('0.3.1'), 'v0.4.0')).toBe('0.4.0');
		expect(updateOffer(at('0.3.9'), '0.10.0')).toBe('0.10.0');
		expect(
			updateOffer({ nepfleetImage: 'ghcr.io/serraniel/nepfleet:v0.3.1@sha256:abc' }, 'v0.3.4')
		).toBe('0.3.4');
	});
	it('offers edge from a daemon built from main, wherever a NepFleet container runs', () => {
		expect(updateOffer(at('0.4.0'), 'edge')).toBe('edge');
		expect(updateOffer(at('edge@sha256:abc'), 'edge')).toBe('edge');
		expect(updateOffer({ nepfleetRunning: true }, 'edge')).toBeNull();
		expect(updateOffer(undefined, 'edge')).toBeNull();
	});
	it('offers nothing otherwise', () => {
		expect(updateOffer(at('0.4.0'), 'v0.4.0')).toBeNull();
		expect(updateOffer(at('0.5.0'), 'v0.4.0')).toBeNull();
		expect(updateOffer(at('edge'), 'v0.4.0')).toBeNull();
		expect(updateOffer(at('0.3.1'), 'v0.4.0-dev')).toBeNull();
		expect(updateOffer(undefined, 'v0.4.0')).toBeNull();
		expect(updateOffer(at('0.3.1'), '')).toBeNull();
	});
});
