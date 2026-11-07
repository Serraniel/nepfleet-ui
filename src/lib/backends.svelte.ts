// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Backend, type Status, fetchInfo, normalizeUrl } from './backend.ts';

const KEY = 'nepfleet-backends';

function load(): Backend[] {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(raw)
			? raw.filter((b): b is Backend => typeof b?.id === 'string' && typeof b?.url === 'string')
			: [];
	} catch {
		return [];
	}
}

/** The backends this browser knows, with their live status. */
class Backends {
	list = $state<Backend[]>(load());
	status = $state<Record<string, Status>>({});

	private save() {
		localStorage.setItem(KEY, JSON.stringify(this.list));
	}

	add(input: string): Backend {
		const url = normalizeUrl(input);
		if (this.list.some((b) => b.url === url)) throw new Error('This backend is already added');
		const backend = { id: crypto.randomUUID(), url };
		this.list.push(backend);
		this.save();
		void this.check(backend);
		return backend;
	}

	remove(id: string) {
		this.list = this.list.filter((b) => b.id !== id);
		delete this.status[id];
		sessionStorage.removeItem('nepfleet-token-' + id); // its API token, if kept for this tab
		this.save();
	}

	async check(backend: Backend) {
		this.status[backend.id] = { state: 'checking' };
		try {
			this.status[backend.id] = { state: 'online', info: await fetchInfo(backend) };
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			this.status[backend.id] = { state: 'offline', error };
		}
	}

	checkAll() {
		return Promise.all(this.list.map((b) => this.check(b)));
	}
}

export const backends = new Backends();
