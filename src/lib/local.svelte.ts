// SPDX-License-Identifier: AGPL-3.0-or-later
import { AuthError, type Backend } from './backend.ts';
import { backends } from './backends.svelte.ts';
import { type Remote, fetchEvents, fetchRemotes, markSeen, normalizeDaemonUrl } from './local.ts';
import { type FleetEvent, atLeast, loadOsSettings, showOsNotification } from './notifications.ts';
import { stacks, tokens } from './stacks.svelte.ts';

const URL_KEY = 'nepfleet-control-url';
const TOKEN_KEY = 'nepfleet-control-token';
/** How many events the page keeps in memory. */
const KEEP_EVENTS = 500;
export const DEFAULT_DAEMON = 'http://127.0.0.1:7481';

/**
 * The local control daemon. Its token lives in memory, and in sessionStorage
 * only when the user asks to keep it for this tab.
 */
class Local {
	url = $state(DEFAULT_DAEMON);
	token = $state('');
	remotes = $state<Remote[]>([]);
	error = $state('');
	events = $state<FleetEvent[]>([]);
	unread = $state(0);
	seen = $state(0);
	eventsError = $state('');
	#eventsLoaded = false;
	#timer: ReturnType<typeof setInterval> | undefined;

	constructor() {
		if (typeof localStorage === 'undefined') return;
		this.url = localStorage.getItem(URL_KEY) ?? DEFAULT_DAEMON;
		this.token = sessionStorage.getItem(TOKEN_KEY) ?? '';
	}

	get connected() {
		return this.token !== '';
	}

	/** Remembers the daemon and starts following it. Throws on a bad address. */
	async connect(url: string, token: string, keepForTab: boolean) {
		const t = token.trim();
		if (!t.startsWith('nfc_')) throw new Error('The token comes from: nepfleet control token');
		this.url = normalizeDaemonUrl(url);
		await fetchRemotes(this.url, t); // refuses a wrong token before anything is kept
		this.token = t;
		localStorage.setItem(URL_KEY, this.url);
		if (keepForTab) sessionStorage.setItem(TOKEN_KEY, t);
		await this.refresh();
		this.follow();
	}

	disconnect() {
		clearInterval(this.#timer);
		this.#timer = undefined;
		this.token = '';
		this.remotes = [];
		this.error = '';
		this.events = [];
		this.unread = 0;
		this.seen = 0;
		this.#eventsLoaded = false;
		sessionStorage.removeItem(TOKEN_KEY);
		this.sync();
	}

	follow() {
		if (this.#timer || !this.connected) return;
		this.#timer = setInterval(() => void this.refresh(), 5000);
	}

	async refresh() {
		if (!this.connected) return;
		try {
			this.remotes = await fetchRemotes(this.url, this.token);
			this.error = '';
			this.sync();
			await this.refreshEvents();
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			if (e instanceof AuthError) this.disconnect();
		}
	}

	/** Brings in new events. What arrives after the first load may notify. */
	private async refreshEvents() {
		const last = this.events.at(-1)?.id ?? 0;
		try {
			const page = await fetchEvents(this.url, this.token, last);
			const fresh = page.events;
			if (fresh.length > 0) this.events = [...this.events, ...fresh].slice(-KEEP_EVENTS);
			this.unread = page.unread;
			this.seen = page.seen;
			this.eventsError = '';
			if (this.#eventsLoaded) void this.announce(fresh);
			this.#eventsLoaded = true;
		} catch (e) {
			// An older daemon has no events; the rest of the page works regardless.
			this.eventsError = e instanceof Error ? e.message : String(e);
		}
	}

	private async announce(fresh: FleetEvent[]) {
		const s = loadOsSettings();
		if (!s.enabled) return;
		for (const e of fresh) {
			if (atLeast(e.severity, s.minSeverity)) await showOsNotification(e).catch(() => {});
		}
	}

	async markAllRead() {
		const last = this.events.at(-1)?.id;
		if (!last || !this.connected) return;
		try {
			await markSeen(this.url, this.token, last);
			this.seen = last;
			this.unread = 0;
		} catch (e) {
			this.eventsError = e instanceof Error ? e.message : String(e);
		}
	}

	/** Remotes with a live tunnel are backends like any other. */
	private sync() {
		const live: Backend[] = this.remotes
			.filter((r) => r.tunnel === 'up')
			.map((r) => ({
				id: 'local:' + r.name,
				url: `${this.url}/v1/remotes/${encodeURIComponent(r.name)}`,
				local: true,
				label: r.name
			}));
		const before = backends.list.filter((b) => b.local).map((b) => b.id);
		backends.setLocal(live, this.token);
		for (const b of live) tokens.byBackend[b.id] = this.token;
		for (const id of before) {
			if (!live.some((b) => b.id === id)) delete tokens.byBackend[id];
		}
		for (const b of live) {
			if (!before.includes(b.id)) {
				void backends.check(b);
				void stacks.load(b);
			}
		}
	}
}

export const local = new Local();
