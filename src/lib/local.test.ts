import { describe as group, expect, it } from 'vitest';
import { AuthError, ConflictError } from './backend.ts';
import {
	addRemote,
	describe,
	fetchRemotes,
	normalizeDaemonUrl,
	remoteAction,
	removeRemote
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
