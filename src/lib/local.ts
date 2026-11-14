// SPDX-License-Identifier: AGPL-3.0-or-later
import { AuthError, ConflictError, NotFoundError, normalizeUrl } from './backend.ts';
import type { FleetEvent } from './notifications.ts';

/** What a probe found on a machine (nepfleet remote probe). */
export interface RemoteReport {
	os?: string;
	kernel?: string;
	arch?: string;
	user?: string;
	root?: boolean;
	sudo?: boolean;
	docker?: boolean;
	dockerRunning?: boolean;
	dockerVersion?: string;
	compose?: string;
	projects?: number;
	containers?: number;
	swarm?: string;
	nepfleet?: string;
	nepfleetRunning?: boolean;
	fleet?: string;
}

/** A machine the control daemon knows. */
export interface Remote {
	name: string;
	address: string;
	checked?: string;
	report?: RemoteReport;
	next?: string;
	error?: string;
	connect?: boolean;
	tunnel?: 'off' | 'connecting' | 'up' | 'down';
	tunnelError?: string;
	/** Keys with a passphrase the last check or the tunnel needed unlocked. */
	lockedKeys?: string[];
}

function isRemote(v: unknown): v is Remote {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return typeof o.name === 'string' && typeof o.address === 'string';
}

/**
 * The daemon's address. Only loopback: it reaches every connected fleet, and
 * the daemon refuses other addresses too.
 */
export function normalizeDaemonUrl(input: string): string {
	const url = normalizeUrl(input);
	const host = new URL(url).hostname;
	if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
		throw new Error('The control daemon is always on this machine, e.g. http://127.0.0.1:7481');
	}
	return url;
}

/** Calls the daemon. */
/** SSH refused the login, and these keys need their passphrase first. */
export class LockedKeyError extends Error {
	constructor(
		message: string,
		readonly keys: string[]
	) {
		super(message);
		this.name = 'LockedKeyError';
	}
}

/** The passphrase didn't unlock the key. */
export class WrongPassphraseError extends Error {}

/**
 * Unlocks an SSH key into the daemon's agent for 8 hours. The passphrase goes
 * to the daemon for this call only; nothing here keeps it.
 */
export async function unlockKey(
	daemon: string,
	token: string,
	path: string,
	passphrase: string,
	fetcher: typeof fetch = fetch
): Promise<void> {
	try {
		await call(daemon, token, 'POST', '/v1/keys/unlock', { path, passphrase }, fetcher, 40000);
	} catch (e) {
		if (e instanceof Error && /doesn.t unlock/.test(e.message)) {
			throw new WrongPassphraseError(e.message);
		}
		throw e;
	}
}

async function call(
	daemon: string,
	token: string,
	method: string,
	path: string,
	body: unknown,
	fetcher: typeof fetch,
	timeoutMs: number
): Promise<unknown> {
	const res = await fetcher(`${daemon}${path}`, {
		method,
		signal: AbortSignal.timeout(timeoutMs),
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
			...(body === undefined ? {} : { 'Content-Type': 'application/json' })
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	if (res.status === 401) throw new AuthError('The control daemon refused the token');
	if (res.status === 204) return undefined;
	const data: unknown = await res.json().catch(() => undefined);
	if (!res.ok) {
		const msg = (data as { error?: unknown } | undefined)?.error;
		const text = typeof msg === 'string' ? msg : `HTTP ${res.status}`;
		const locked = (data as { lockedKeys?: unknown } | undefined)?.lockedKeys;
		if (Array.isArray(locked) && locked.length && locked.every((k) => typeof k === 'string')) {
			throw new LockedKeyError(text, locked as string[]);
		}
		if (res.status === 404) throw new NotFoundError(text);
		if (res.status === 409) throw new ConflictError(text);
		throw new Error(text);
	}
	return data;
}

export async function fetchRemotes(
	daemon: string,
	token: string,
	fetcher: typeof fetch = fetch
): Promise<Remote[]> {
	const data = await call(daemon, token, 'GET', '/v1/remotes', undefined, fetcher, 10000);
	if (!Array.isArray(data) || !data.every(isRemote)) throw new Error('Unexpected response');
	return data;
}

/** Adds a machine; the daemon probes it first, over SSH, which takes a while. */
export async function addRemote(
	daemon: string,
	token: string,
	address: string,
	name: string,
	fetcher: typeof fetch = fetch
): Promise<Remote> {
	const data = await call(daemon, token, 'POST', '/v1/remotes', { address, name }, fetcher, 90000);
	if (!isRemote(data)) throw new Error('Unexpected response');
	return data;
}

/** Runs refresh, connect or disconnect on a remote. */
export async function remoteAction(
	daemon: string,
	token: string,
	name: string,
	action: 'refresh' | 'connect' | 'disconnect',
	fetcher: typeof fetch = fetch
): Promise<void> {
	await call(
		daemon,
		token,
		'POST',
		`/v1/remotes/${encodeURIComponent(name)}/${action}`,
		undefined,
		fetcher,
		90000
	);
}

export async function removeRemote(
	daemon: string,
	token: string,
	name: string,
	fetcher: typeof fetch = fetch
): Promise<void> {
	await call(
		daemon,
		token,
		'DELETE',
		`/v1/remotes/${encodeURIComponent(name)}`,
		undefined,
		fetcher,
		30000
	);
}

/** Preparing a machine (Docker, Compose, network) or installing NepFleet on it. */
/** Preparing a machine, installing NepFleet, or its network mounts (host apply). */
export type SetupKind = 'bootstrap' | 'install' | 'mounts';

/** One step of a setup; root steps run as root over SSH. */
export interface SetupStep {
	text: string;
	root: boolean;
}

/** What a setup would do; it runs only with this id. */
export interface SetupPlan {
	kind: SetupKind;
	steps: SetupStep[];
	id?: string;
	/** Why it can't run (no root, Docker missing, …). */
	error?: string;
	/** Its root steps need the sudo password: sudo asks for one there. */
	sudoPassword?: boolean;
}

export interface SetupJob {
	kind: SetupKind;
	state: 'running' | 'succeeded' | 'failed';
	log: string;
	error?: string;
}

/** What the machine needs next, from its last check: undefined when NepFleet is there. */
export function setupKind(r: RemoteReport | undefined): SetupKind | undefined {
	if (!r || (r.kernel !== undefined && r.kernel !== 'Linux')) return undefined;
	if (r.nepfleetRunning || r.fleet) return undefined;
	if (!r.docker || !r.dockerRunning || !r.compose) return 'bootstrap';
	return 'install';
}

function isSetupPlan(v: unknown): v is SetupPlan {
	const o = v as Partial<SetupPlan> | null;
	return (
		typeof o === 'object' &&
		o !== null &&
		(o.kind === 'bootstrap' || o.kind === 'install' || o.kind === 'mounts') &&
		Array.isArray(o.steps) &&
		o.steps.every((s) => typeof s?.text === 'string' && typeof s.root === 'boolean')
	);
}

function isSetupJob(v: unknown): v is SetupJob {
	const o = v as Partial<SetupJob> | null;
	return (
		typeof o === 'object' &&
		o !== null &&
		(o.state === 'running' || o.state === 'succeeded' || o.state === 'failed') &&
		typeof o.log === 'string'
	);
}

const setupPath = (name: string) => `/v1/remotes/${encodeURIComponent(name)}/setup`;

/** Checks the machine again and plans the setup, changing nothing. */
export async function fetchSetupPlan(
	daemon: string,
	token: string,
	name: string,
	kind: SetupKind,
	fetcher: typeof fetch = fetch
): Promise<SetupPlan> {
	const data = await call(
		daemon,
		token,
		'GET',
		`${setupPath(name)}?kind=${kind}`,
		undefined,
		fetcher,
		90000
	);
	if (!isSetupPlan(data)) throw new Error('Unexpected response');
	return data;
}

/** Starts the reviewed plan; a ConflictError means it changed: plan again. */
export async function startSetup(
	daemon: string,
	token: string,
	name: string,
	kind: SetupKind,
	planId: string,
	fetcher: typeof fetch = fetch,
	/** For this run only: the daemon keeps it nowhere. */
	sudoPassword = ''
): Promise<SetupJob> {
	const data = await call(
		daemon,
		token,
		'POST',
		setupPath(name),
		sudoPassword ? { kind, plan: planId, sudoPassword } : { kind, plan: planId },
		fetcher,
		90000
	);
	if (!isSetupJob(data)) throw new Error('Unexpected response');
	return data;
}

export async function fetchSetupJob(
	daemon: string,
	token: string,
	name: string,
	fetcher: typeof fetch = fetch
): Promise<SetupJob> {
	const data = await call(
		daemon,
		token,
		'GET',
		`${setupPath(name)}/job`,
		undefined,
		fetcher,
		10000
	);
	if (!isSetupJob(data)) throw new Error('Unexpected response');
	return data;
}

/** One plain sentence about a machine's Docker and NepFleet. */
export function describe(r: RemoteReport): string {
	const parts: string[] = [];
	if (r.os || r.arch) parts.push([r.os, r.arch].filter(Boolean).join(', '));
	if (!r.docker) parts.push('no Docker');
	else if (!r.dockerRunning) parts.push('Docker not reachable by this user');
	else
		parts.push(
			`Docker ${r.dockerVersion ?? ''}, ${r.containers ?? 0} containers`.replace('  ', ' ')
		);
	if (r.swarm) parts.push(`swarm ${r.swarm}`);
	if (r.nepfleetRunning) parts.push('NepFleet running');
	else if (r.nepfleet) parts.push('NepFleet installed, not answering');
	return parts.join(' · ');
}

/** The merged events of all connected fleets, with the unread count. */
export interface EventPage {
	events: FleetEvent[];
	unread: number;
	seen: number;
}

export async function fetchEvents(
	daemon: string,
	token: string,
	after: number,
	limit = 500,
	fetcher: typeof fetch = fetch
): Promise<EventPage> {
	const data = await call(
		daemon,
		token,
		'GET',
		`/v1/events?after=${after}&limit=${limit}`,
		undefined,
		fetcher,
		10000
	);
	const o = data as Partial<EventPage> | undefined;
	if (
		!o ||
		!Array.isArray(o.events) ||
		!o.events.every((e) => typeof e?.id === 'number' && typeof e?.title === 'string')
	) {
		throw new Error('Unexpected response');
	}
	return { events: o.events, unread: Number(o.unread) || 0, seen: Number(o.seen) || 0 };
}

export async function markSeen(
	daemon: string,
	token: string,
	id: number,
	fetcher: typeof fetch = fetch
): Promise<void> {
	await call(daemon, token, 'POST', '/v1/events/seen', { id }, fetcher, 10000);
}

/**
 * Whether there is a NepFleet to connect to: connecting talks to it, so until
 * the machine is set up, setting it up is what to offer.
 */
export function canConnect(r: RemoteReport | undefined): boolean {
	return !!r && (r.nepfleetRunning === true || !!r.fleet);
}

/** What the daemon keeps for the app: the local fleet repository folder. */
export interface DaemonSettings {
	fleetDir?: string;
}

export async function fetchSettings(
	daemon: string,
	token: string,
	fetcher: typeof fetch = fetch
): Promise<DaemonSettings> {
	const o = (await call(daemon, token, 'GET', '/v1/settings', undefined, fetcher, 10000)) as
		DaemonSettings | undefined;
	return { fleetDir: typeof o?.fleetDir === 'string' ? o.fleetDir : undefined };
}

/** Saves the settings; the daemon checks the folder has a fleet.yaml. */
export async function saveSettings(
	daemon: string,
	token: string,
	settings: DaemonSettings,
	fetcher: typeof fetch = fetch
): Promise<DaemonSettings> {
	const o = (await call(daemon, token, 'PUT', '/v1/settings', settings, fetcher, 10000)) as
		DaemonSettings | undefined;
	return { fleetDir: typeof o?.fleetDir === 'string' ? o.fleetDir : undefined };
}
