// SPDX-License-Identifier: AGPL-3.0-or-later

/** A NepFleet backend this frontend connects to. */
export interface Backend {
	id: string;
	url: string;
	/** A remote reached through the local control daemon; never saved. */
	local?: boolean;
	label?: string;
}

/** What GET /api/v1/info returns. */
export interface BackendInfo {
	name: string;
	version: string;
	apiVersion: string;
}

export type Status =
	| { state: 'checking' }
	| { state: 'online'; info: BackendInfo }
	| { state: 'offline'; error: string };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalises a user-entered backend URL. HTTPS is required except on
 * loopback: anything else would send credentials in the clear.
 */
export function normalizeUrl(input: string): string {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		throw new Error('Not a valid URL');
	}
	if (url.username || url.password) throw new Error('Do not put credentials in the URL');
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
		throw new Error('Use https:// (plain http is only allowed for localhost)');
	}
	if (url.search || url.hash) throw new Error('The URL must not contain a query or fragment');
	return url.origin + url.pathname.replace(/\/+$/, '');
}

function isInfo(v: unknown): v is BackendInfo {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.name === 'string' && typeof o.version === 'string' && typeof o.apiVersion === 'string'
	);
}

export async function fetchInfo(
	backend: Backend,
	fetcher: typeof fetch = fetch,
	timeoutMs = 5000,
	token?: string
): Promise<BackendInfo> {
	const res = await fetcher(`${backend.url}/api/v1/info`, {
		signal: AbortSignal.timeout(timeoutMs),
		// A token replaces cookies; the control daemon doesn't accept credentials.
		credentials: token ? 'omit' : 'include',
		headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body: unknown = await res.json();
	if (!isInfo(body)) throw new Error('Unexpected response: is this a NepFleet backend?');
	return body;
}

/** A stack as GET /api/v1/stacks lists it. */
export interface StackInfo {
	name: string;
	target: string;
	mode: string;
	apply: string;
	template?: string;
	updates: string;
	/** Where its web UI is, if its settings say. */
	url?: string;
	/** Other places to look at it, such as its logs. */
	links?: StackLink[];
	/** Values it takes from other stacks: names only, never values. */
	uses?: StackRef[];
}

export interface StackLink {
	name: string;
	url: string;
}

export interface StackRef {
	/** The value's name in the stack that takes it. */
	key: string;
	from: string;
	value?: string;
	secret?: string;
}

/** How a stack and others depend on each other, both ways round. */
export function stackRelations(
	all: StackInfo[],
	name: string
): { uses: StackRef[]; usedBy: (StackRef & { stack: string })[] } {
	const valid = (r: StackRef) => typeof r?.key === 'string' && typeof r?.from === 'string';
	return {
		uses: (all.find((s) => s.name === name)?.uses ?? []).filter(valid),
		usedBy: all.flatMap((s) =>
			(s.uses ?? [])
				.filter((r) => valid(r) && r.from === name)
				.map((r) => ({ ...r, stack: s.name }))
		)
	};
}

/**
 * Where a stack can be opened. A backend's answer goes into an href, so only web
 * addresses count: a javascript: link would run in this page.
 */
export function stackPlaces(s: StackInfo): StackLink[] {
	const all = [...(s.url ? [{ name: 'Open', url: s.url }] : []), ...(s.links ?? [])];
	return all.filter((l) => {
		if (typeof l?.name !== 'string' || typeof l?.url !== 'string') return false;
		try {
			return ['http:', 'https:'].includes(new URL(l.url).protocol);
		} catch {
			return false;
		}
	});
}

function isStack(v: unknown): v is StackInfo {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		['name', 'target', 'mode', 'apply', 'updates'].every((k) => typeof o[k] === 'string') &&
		(o.template === undefined || typeof o.template === 'string')
	);
}

/** Stands for a signed-in session where a token would go; the cookie does the work. */
export const SESSION = 'session';

function authInit(token: string): {
	credentials: RequestCredentials;
	headers: Record<string, string>;
} {
	return token === SESSION
		? { credentials: 'include', headers: {} }
		: { credentials: 'omit', headers: { Authorization: `Bearer ${token}` } };
}

/** Thrown when the backend refuses the token (401) or locks out (429). */
export class AuthError extends Error {}

/** Lists a backend's stacks with an API token (nepfleet token create). */
export async function fetchStacks(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 10000
): Promise<StackInfo[]> {
	const res = await fetcher(`${backend.url}/api/v1/stacks`, {
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: { Accept: 'application/json', ...authInit(token).headers }
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body: unknown = await res.json();
	if (!Array.isArray(body) || !body.every(isStack)) throw new Error('Unexpected response');
	return body;
}

/** Thrown when the backend has no such stack, or the token does not cover it. */
export class NotFoundError extends Error {}

/** GET with an API token; validate checks the body's shape. */
async function apiGet<T>(
	backend: Backend,
	token: string,
	path: string,
	validate: (v: unknown) => v is T,
	fetcher: typeof fetch,
	timeoutMs: number
): Promise<T> {
	const res = await fetcher(`${backend.url}${path}`, {
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: { Accept: 'application/json', ...authInit(token).headers }
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 404) throw new NotFoundError('No such stack, or the token does not cover it');
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body: unknown = await res.json();
	if (!validate(body)) throw new Error('Unexpected response');
	return body;
}

/** One file or image a plan changes; diff is a context diff, secrets masked. */
export interface PlanChange {
	path: string;
	kind: 'added' | 'changed' | 'removed';
	diff?: string;
}

/** One thing apply will do, in order. */
export interface PlanStep {
	kind: string;
	text: string;
	service?: string;
	destructive?: boolean;
}

/** What GET /api/v1/stacks/{name}/plan returns. */
export interface Plan {
	/** Sent back to apply exactly this plan; older backends have none. */
	id?: string;
	stack: string;
	mode: string;
	first: boolean;
	changes: PlanChange[] | null;
	destructive?: string[];
	generated?: string[];
	steps?: PlanStep[];
	approximate?: boolean;
	template?: string;
	templateFrom?: string;
}

function isPlan(v: unknown): v is Plan {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	const changes = o.changes;
	return (
		typeof o.stack === 'string' &&
		typeof o.first === 'boolean' &&
		(changes === null ||
			(Array.isArray(changes) &&
				changes.every(
					(c) =>
						typeof c === 'object' &&
						c !== null &&
						typeof (c as Record<string, unknown>).path === 'string'
				)))
	);
}

/** A commit that touched a stack. */
export interface HistoryEntry {
	commit: string;
	date: string;
	author: string;
	subject: string;
	applied?: boolean;
}

function isHistory(v: unknown): v is HistoryEntry[] {
	return (
		Array.isArray(v) &&
		v.every((e) => {
			if (typeof e !== 'object' || e === null) return false;
			const o = e as Record<string, unknown>;
			return ['commit', 'date', 'author', 'subject'].every((k) => typeof o[k] === 'string');
		})
	);
}

/** What applying a stack would change. */
export function fetchPlan(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<Plan> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/plan`,
		isPlan,
		fetcher,
		timeoutMs
	);
}

/** The last commits that touched a stack, newest first. */
export function fetchHistory(
	backend: Backend,
	token: string,
	stack: string,
	n = 20,
	fetcher: typeof fetch = fetch,
	timeoutMs = 10000
): Promise<HistoryEntry[]> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/history?n=${n}`,
		isHistory,
		fetcher,
		timeoutMs
	);
}

/** One template in a source's catalogue (index.json format). */
export interface TemplateEntry {
	name: string;
	title?: string;
	description?: string;
	tier: string;
	category?: string;
	homepage?: string;
	version: string;
	supports: Record<string, boolean>;
	inputs: import('./inputs.ts').TemplateInput[] | null;
	generate: { name: string }[] | null;
}

/** What GET /api/v1/templates returns per template source. */
export interface SourceCatalogue {
	source: string;
	commit?: string;
	templates: TemplateEntry[] | null;
	invalid?: string[];
}

function isCatalogues(v: unknown): v is SourceCatalogue[] {
	return (
		Array.isArray(v) &&
		v.every((s) => {
			if (typeof s !== 'object' || s === null) return false;
			const o = s as Record<string, unknown>;
			return (
				typeof o.source === 'string' &&
				(o.templates === null ||
					(Array.isArray(o.templates) &&
						o.templates.every(
							(t) =>
								typeof t === 'object' &&
								t !== null &&
								typeof (t as Record<string, unknown>).name === 'string' &&
								typeof (t as Record<string, unknown>).version === 'string'
						)))
			);
		})
	);
}

/** The template catalogues of a backend's fleet. */
export function fetchTemplates(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<SourceCatalogue[]> {
	return apiGet(backend, token, '/api/v1/templates', isCatalogues, fetcher, timeoutMs);
}

/** A job on the backend, as POST …/apply and GET /api/v1/jobs/{id} return it. */
export interface Job {
	id: string;
	stack: string;
	kind: string;
	state: 'running' | 'succeeded' | 'failed';
	error?: string;
	log: string;
	by: string;
}

function isJob(v: unknown): v is Job {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.id === 'string' &&
		typeof o.log === 'string' &&
		(o.state === 'running' || o.state === 'succeeded' || o.state === 'failed')
	);
}

/** The backend refused to start: the plan changed, or another apply runs. */
export class ConflictError extends Error {}

/** The token's scope does not allow this. */
export class ScopeError extends Error {}

/** Starts a job with a POST to a stack; 202 is the only success. */
async function postJob(
	backend: Backend,
	token: string,
	stack: string,
	action: 'apply' | 'rollback',
	body: unknown,
	fetcher: typeof fetch,
	timeoutMs: number
): Promise<Job> {
	const res = await fetcher(`${backend.url}/api/v1/stacks/${encodeURIComponent(stack)}/${action}`, {
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify(body)
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403)
		throw new ScopeError('This token may only read. This needs one with the apply scope.');
	if (res.status === 404) throw new NotFoundError('No such stack, or the token does not cover it');
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (res.status !== 202) throw new Error(`HTTP ${res.status}`);
	const job: unknown = await res.json();
	if (!isJob(job)) throw new Error('Unexpected response');
	return job;
}

/** Starts applying the reviewed plan; the job runs in the background. */
export function startApply(
	backend: Backend,
	token: string,
	stack: string,
	planId: string,
	confirmDestructive: boolean,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<Job> {
	return postJob(
		backend,
		token,
		stack,
		'apply',
		{ plan: planId, confirmDestructive },
		fetcher,
		timeoutMs
	);
}

/** Starts rolling a stack back to a commit from its history. */
export function startRollback(
	backend: Backend,
	token: string,
	stack: string,
	commit: string,
	confirmDestructive: boolean,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<Job> {
	return postJob(
		backend,
		token,
		stack,
		'rollback',
		{ commit, confirmDestructive },
		fetcher,
		timeoutMs
	);
}

/** A job's state and log so far. */
export function fetchJob(
	backend: Backend,
	token: string,
	id: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 10000
): Promise<Job> {
	return apiGet(
		backend,
		token,
		`/api/v1/jobs/${encodeURIComponent(id)}`,
		isJob,
		fetcher,
		timeoutMs
	);
}
