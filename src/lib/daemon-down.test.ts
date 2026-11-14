import { describe, expect, it } from 'vitest';
import { AuthError } from './backend.ts';
import { unreachable } from './local.svelte.ts';

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
