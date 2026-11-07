// SPDX-License-Identifier: AGPL-3.0-or-later
import { AuthError, type Backend, type StackInfo, fetchStacks } from './backend.ts';
import { backends } from './backends.svelte.ts';

const SESSION_PREFIX = 'nepfleet-token-';

/**
 * API tokens per backend. They live in memory, and in sessionStorage only
 * when the user asks to keep them for this tab: never in localStorage, which
 * outlives the session and every tab.
 */
class Tokens {
	byBackend = $state<Record<string, string>>({});

	constructor() {
		if (typeof sessionStorage === 'undefined') return;
		for (let i = 0; i < sessionStorage.length; i++) {
			const key = sessionStorage.key(i);
			if (key?.startsWith(SESSION_PREFIX)) {
				const value = sessionStorage.getItem(key);
				if (value) this.byBackend[key.slice(SESSION_PREFIX.length)] = value;
			}
		}
	}

	set(backendId: string, token: string, keepForTab: boolean) {
		const t = token.trim();
		if (!t.startsWith('nft_')) throw new Error('A NepFleet API token starts with nft_');
		this.byBackend[backendId] = t;
		if (keepForTab) sessionStorage.setItem(SESSION_PREFIX + backendId, t);
	}

	clear(backendId: string) {
		delete this.byBackend[backendId];
		sessionStorage.removeItem(SESSION_PREFIX + backendId);
	}
}

export const tokens = new Tokens();

export type StackState =
	| { state: 'no-token' }
	| { state: 'loading' }
	| { state: 'ok'; stacks: StackInfo[] }
	| { state: 'error'; error: string; auth: boolean };

/** The stacks of every backend, loaded with that backend's token. */
class Stacks {
	byBackend = $state<Record<string, StackState>>({});

	async load(backend: Backend) {
		const token = tokens.byBackend[backend.id];
		if (!token) {
			this.byBackend[backend.id] = { state: 'no-token' };
			return;
		}
		this.byBackend[backend.id] = { state: 'loading' };
		try {
			this.byBackend[backend.id] = { state: 'ok', stacks: await fetchStacks(backend, token) };
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			this.byBackend[backend.id] = { state: 'error', error, auth: e instanceof AuthError };
		}
	}

	loadAll() {
		return Promise.all(backends.list.map((b) => this.load(b)));
	}
}

export const stacks = new Stacks();
