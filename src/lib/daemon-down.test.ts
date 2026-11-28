import { describe, expect, it } from 'vitest';
import { AuthError } from './backend.ts';
import { nextLocked, unreachable, untilAnswers } from './local.svelte.ts';

describe('a stopped daemon', () => {
	it('is told apart from a daemon that answered with an error', () => {
		// What fetch throws when nothing listens, and when it hangs past the timeout.
		expect(unreachable(new TypeError('Failed to fetch'))).toBe(true);
		expect(unreachable(new DOMException('timed out', 'TimeoutError'))).toBe(true);
		// An answer, even a bad one, means the daemon runs.
		expect(unreachable(new AuthError('refused'))).toBe(false);
		expect(unreachable(new Error('HTTP 500'))).toBe(false);
	});
});

describe('after a restart', () => {
	it('waits for the new daemon to answer', async () => {
		let calls = 0;
		const got = await untilAnswers(
			async () => {
				if (++calls < 3) throw new TypeError('Load failed');
				return 'ok';
			},
			5,
			1
		);
		expect(got).toBe('ok');
		expect(calls).toBe(3);
	});

	it("gives up in words, not fetch's own", async () => {
		const never = () => Promise.reject(new TypeError('Load failed'));
		await expect(untilAnswers(never, 2, 1)).rejects.toThrow(/does not answer yet/);
	});

	it('passes an answer that is an error straight on', async () => {
		let calls = 0;
		const refused = () => {
			calls++;
			return Promise.reject(new AuthError('refused'));
		};
		await expect(untilAnswers(refused, 5, 1)).rejects.toBeInstanceOf(AuthError);
		expect(calls).toBe(1);
	});

	it('asks for each locked key once', () => {
		const remotes = [
			{ name: 'a', address: 'ssh://a.example.test' },
			// Only checked, not connected: Fleets shows a button instead.
			{ name: 'lab', address: 'ssh://lab.example.test', lockedKeys: ['k3'] },
			{
				name: 'vps',
				address: 'ssh://vps.example.test',
				connect: true,
				lockedKeys: ['~/.ssh/id_rsa']
			},
			{
				name: 'nas',
				address: 'ssh://nas.example.test',
				connect: true,
				lockedKeys: ['~/.ssh/id_rsa', 'k2']
			}
		];
		const asked = new Set<string>();
		const first = nextLocked(remotes, asked);
		expect(first).toEqual({ name: 'vps', keys: ['~/.ssh/id_rsa'] });
		for (const k of first?.keys ?? []) asked.add(k);
		// The same key on another machine isn't asked for again; the new one is.
		expect(nextLocked(remotes, asked)).toEqual({ name: 'nas', keys: ['k2'] });
		asked.add('k2');
		expect(nextLocked(remotes, asked)).toBeNull();
	});
});
