// SPDX-License-Identifier: AGPL-3.0-or-later
import { AuthError, type Backend } from './backend.ts';
import { backends } from './backends.svelte.ts';
import { installedVersion, isDesktop, restartDaemon, startDaemon } from './desktop.ts';
import {
	type Build,
	type Remote,
	daemonOutdated,
	fetchDaemonInfo,
	parseVersionOutput,
	fetchEvents,
	fetchRemotes,
	markSeen,
	normalizeDaemonUrl
} from './local.ts';
import { type FleetEvent, atLeast, loadOsSettings, showOsNotification } from './notifications.ts';
import { stacks, tokens } from './stacks.svelte.ts';

const URL_KEY = 'nepfleet-control-url';
const TOKEN_KEY = 'nepfleet-control-token';
/** How many events the page keeps in memory. */
const KEEP_EVENTS = 500;
/** How often the desktop app tries to start a daemon that stopped. */
const RESTART_EVERY_MS = 30_000;
/** How often the desktop app asks which nepfleet is installed. */
const INSTALLED_EVERY_MS = 60_000;

/** No answer at all: nothing listens, or it hangs. Not an HTTP error. */
export function unreachable(e: unknown): boolean {
	return (
		e instanceof TypeError ||
		(e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError'))
	);
}
export const DEFAULT_DAEMON = 'http://127.0.0.1:7481';

/**
 * The local control daemon. Its token lives in memory, and in sessionStorage
 * only when the user asks to keep it for this tab.
 */
class Local {
	url = $state(DEFAULT_DAEMON);
	token = $state('');
	remotes = $state<Remote[]>([]);
	/** The daemon's version: machines running an older NepFleet can update to it. */
	version = $state('');
	/** The commit the daemon was built from, '' when it doesn't say. */
	commit = $state('');
	/** The nepfleet installed now (desktop app only): another build after an update. */
	installed = $state<Build | null>(null);
	/** The daemon is being restarted on request; restartError says why it failed. */
	restartingDaemon = $state(false);
	restartError = $state('');
	#installedChecked = 0;
	error = $state('');
	events = $state<FleetEvent[]>([]);
	unread = $state(0);
	seen = $state(0);
	eventsError = $state('');
	/** The daemon stopped answering; what it reported before is gone. */
	daemonDown = $state(false);
	/** The desktop app is starting the daemon again. */
	restarting = $state(false);
	#lastRestart = 0;
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

	/** nepfleet was updated while the daemon kept running the old binary. */
	get outdated() {
		return daemonOutdated({ version: this.version, commit: this.commit }, this.installed);
	}

	/**
	 * Restarts the daemon with the nepfleet installed now, through the desktop
	 * app. Tunnels come back by themselves; a running setup makes it refuse.
	 */
	async restartDaemon() {
		if (!isDesktop() || this.restartingDaemon) return;
		this.restartingDaemon = true;
		this.restartError = '';
		try {
			const d = await restartDaemon();
			this.version = '';
			this.commit = '';
			this.#installedChecked = 0;
			await this.connect(d.url, d.token, false);
		} catch (e) {
			this.restartError = e instanceof Error ? e.message : String(e);
		} finally {
			this.restartingDaemon = false;
		}
	}

	private async checkInstalled() {
		if (!isDesktop() || Date.now() - this.#installedChecked < INSTALLED_EVERY_MS) return;
		this.#installedChecked = Date.now();
		this.installed = parseVersionOutput(await installedVersion().catch(() => ''));
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
		this.daemonDown = false;
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
			this.daemonDown = false;
			if (!this.version) {
				const info = await fetchDaemonInfo(this.url, this.token).catch(() => null);
				this.version = info?.version ?? '';
				this.commit = info?.commit ?? '';
			}
			void this.checkInstalled();
			this.sync();
			await this.refreshEvents();
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			if (e instanceof AuthError) this.disconnect();
			else if (unreachable(e)) this.lost();
		}
	}

	/**
	 * The daemon is gone: its machines aren't connected any more, whatever it
	 * said last. The desktop app starts it again, as on launch; a new daemon
	 * has a new SSH agent, so Fleets then asks for locked keys again.
	 */
	private lost() {
		this.daemonDown = true;
		this.error = '';
		this.remotes = [];
		// The daemon that starts next may be another build.
		this.version = '';
		this.commit = '';
		this.sync();
		void this.restart();
	}

	private async restart() {
		if (!isDesktop() || this.restarting) return;
		if (Date.now() - this.#lastRestart < RESTART_EVERY_MS) return;
		this.#lastRestart = Date.now();
		this.restarting = true;
		try {
			const d = await startDaemon();
			await this.connect(d.url, d.token, false);
		} catch {
			// Still down: the banner says so, and the next refresh tries again.
		} finally {
			this.restarting = false;
		}
	}

	/** Brings in new events. What arrives after the first load may notify. */
	private refreshEvents(): Promise<void> {
		// One at a time: two at once read the same last ID and would both add
		// the same events, which the page lists by ID (it broke with a 500).
		this.#eventsRun ??= this.loadEvents().finally(() => (this.#eventsRun = null));
		return this.#eventsRun;
	}

	#eventsRun: Promise<void> | null = null;

	private async loadEvents() {
		const last = this.events.at(-1)?.id ?? 0;
		try {
			const page = await fetchEvents(this.url, this.token, last);
			const known = new Set(this.events.map((e) => e.id));
			const fresh = page.events.filter((e) => !known.has(e.id));
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
