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
