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
	// A machine over SSH is added on the Fleets page, through the control daemon.
	if (url.protocol === 'ssh:') {
		throw new Error(
			'This is for a NepFleet API address (https://…). To add a machine over SSH, use the Fleets page.'
		);
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
	/** running, unhealthy, partial or stopped; absent for other hosts, swarm, or not applied. */
	state?: string;
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
		(o.template === undefined || typeof o.template === 'string') &&
		(o.state === undefined || typeof o.state === 'string')
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
	if (res.status === 403) throw new ScopeError("This token's scope doesn't cover this");
	if (res.status === 404) throw new NotFoundError('No such stack, or the token does not cover it');
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body: unknown = await res.json();
	if (!validate(body)) throw new Error('Unexpected response');
	return body;
}

/** One of a stack's editable files, with the revision to send back when saving. */
export interface StackFile {
	path: string;
	content: string;
	revision: string;
}

function isStackFiles(v: unknown): v is StackFile[] {
	return (
		Array.isArray(v) &&
		v.every((f) => {
			const o = f as Partial<StackFile> | null;
			return (
				typeof o?.path === 'string' &&
				typeof o.content === 'string' &&
				typeof o.revision === 'string'
			);
		})
	);
}

/** The stack's editable files (never its encrypted values). */
export function fetchStackFiles(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<StackFile[]> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/files`,
		isStackFiles,
		fetcher,
		timeoutMs
	);
}

/** A person must prove it's still them (a passkey) before changing what runs. */
export class VerifyFirstError extends Error {}
/** The stack would no longer load or render; nothing was saved. */
export class InvalidEditError extends Error {}

/**
 * Saves changed files in one commit. base holds each changed file's revision as
 * read ('' for a new file). It doesn't apply: plan and apply afterwards.
 */
export async function saveStackFiles(
	backend: Backend,
	token: string,
	stack: string,
	files: Record<string, string>,
	base: Record<string, string>,
	message: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<string> {
	const res = await fetcher(`${backend.url}/api/v1/stacks/${encodeURIComponent(stack)}/files`, {
		method: 'PUT',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify({ files, base, message })
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError('This token may not change files. That needs one with the edit scope.');
	}
	if (res.status === 404) throw new NotFoundError('No such stack, or the token does not cover it');
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (res.status === 422) throw new InvalidEditError((await res.text()).trim());
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const o = (await res.json()) as { commit?: unknown };
	if (typeof o.commit !== 'string') throw new Error('Unexpected response');
	return o.commit;
}

/** What POST /api/v1/stacks takes: a stack from a template, as nepfleet new. */
export interface NewStack {
	template: string;
	source?: string;
	name?: string;
	target?: string;
	access?: 'domain' | 'port';
	port?: number;
	/** The template's inputs; secret ones are stored encrypted on the backend. */
	values?: Record<string, string>;
}

/**
 * Creates and commits a stack from a template, without applying it. Throws
 * VerifyFirstError when a person must confirm with a passkey first.
 */
export async function createStack(
	backend: Backend,
	token: string,
	req: NewStack,
	fetcher: typeof fetch = fetch,
	timeoutMs = 120000
): Promise<{ name: string; commit: string; port?: number }> {
	const res = await fetcher(`${backend.url}/api/v1/stacks`, {
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify(req)
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 403) {
		const text = await res.text();
		let verify = false;
		try {
			verify = (JSON.parse(text) as { verify?: unknown }).verify === true;
		} catch {
			/* not JSON */
		}
		if (verify) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError(
			text.trim() || 'This token may not create stacks. That needs one with the edit scope.'
		);
	}
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const o = (await res.json()) as { name?: unknown; commit?: unknown; port?: unknown };
	if (typeof o.name !== 'string' || typeof o.commit !== 'string')
		throw new Error('Unexpected response');
	return { name: o.name, commit: o.commit, port: typeof o.port === 'number' ? o.port : undefined };
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
	/** Outbound traffic is recorded (log) or limited to what's allowed (enforce). */
	egress?: 'log' | 'enforce';
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
	timeoutMs = 60000,
	/** Plan taking updates: newer image digests and the template source's current commit. */
	updateLock = false
): Promise<Plan> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/plan${updateLock ? '?updateLock=true' : ''}`,
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

/** What the registry has for one image of a stack. */
export interface ImageUpdate {
	stack: string;
	image: string;
	/** major, minor, patch or digest */
	track: string;
	current: string;
	/** The newest tag the track allows; it comes with a template update. */
	next?: string;
	/** A newer tag outside the track. */
	beyond?: string;
	/** The tag points at a newer digest than the lock pins. */
	rebuilt?: boolean;
	error?: string;
}

function isUpdates(v: unknown): v is ImageUpdate[] {
	return (
		Array.isArray(v) &&
		v.every((e) => {
			if (typeof e !== 'object' || e === null) return false;
			const o = e as Record<string, unknown>;
			return ['stack', 'image', 'track', 'current'].every((k) => typeof o[k] === 'string');
		})
	);
}

/** Asks the registries what's newer for a stack's images; takes a while. */
export function fetchUpdates(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 120000
): Promise<ImageUpdate[]> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/updates`,
		isUpdates,
		fetcher,
		timeoutMs
	);
}

/** What a stack's egress sidecars recorded (log) or refused (enforce). */
export interface StackEgress {
	mode: 'off' | 'log' | 'enforce';
	/** Sidecars on the backend's host; 0 means nothing is recorded. */
	sidecars: number;
	hosts: string[];
	addresses: string[];
	lookedUp: string[];
}

function isEgress(v: unknown): v is StackEgress {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');
	return (
		typeof o.mode === 'string' &&
		typeof o.sidecars === 'number' &&
		strings(o.hosts) &&
		strings(o.addresses) &&
		strings(o.lookedUp)
	);
}

/** Where a stack's containers went, or what they were refused, less what's allowed. */
export function fetchEgress(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<StackEgress> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/egress`,
		isEgress,
		fetcher,
		timeoutMs
	);
}

/** A maintenance window as Uptime Kuma lists it. */
export interface MaintenanceWindow {
	id: number;
	title: string;
	description?: string;
	strategy: string;
	active: boolean;
	/** under-maintenance, scheduled, ended, inactive or unknown */
	status: string;
	start?: string;
	end?: string;
}

/** One Uptime Kuma of a fleet and its windows, or why they couldn't be read. */
export interface KumaMaintenance {
	kuma: string;
	error?: string;
	windows: MaintenanceWindow[];
}

function isMaintenance(v: unknown): v is KumaMaintenance[] {
	return (
		Array.isArray(v) &&
		v.every((k) => {
			if (typeof k !== 'object' || k === null) return false;
			const o = k as Record<string, unknown>;
			return (
				typeof o.kuma === 'string' &&
				Array.isArray(o.windows) &&
				o.windows.every(
					(w) =>
						typeof w === 'object' &&
						w !== null &&
						typeof (w as Record<string, unknown>).title === 'string' &&
						typeof (w as Record<string, unknown>).status === 'string'
				)
			);
		})
	);
}

/** The maintenance windows of a backend's Uptime Kuma instances. */
export function fetchMaintenance(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<KumaMaintenance[]> {
	return apiGet(backend, token, '/api/v1/maintenance', isMaintenance, fetcher, timeoutMs);
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
	timeoutMs = 60000,
	/** Apply a plan fetched with updateLock. */
	updateLock = false
): Promise<Job> {
	return postJob(
		backend,
		token,
		stack,
		'apply',
		updateLock
			? { plan: planId, confirmDestructive, updateLock }
			: { plan: planId, confirmDestructive },
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

/** Where the server's fleet repository stands against its origin (GET /api/v1/sync). */
export interface SyncStatus {
	/** The server pulls by itself (serve --sync), or on webhooks. */
	enabled: boolean;
	interval?: string;
	last?: string;
	commit?: string;
	error?: string;
	applied?: string[];
	failed?: string[];
	pending?: string[];
}

const isNames = (v: unknown) =>
	v === undefined || v === null || (Array.isArray(v) && v.every((s) => typeof s === 'string'));

function isSyncStatus(v: unknown): v is SyncStatus {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.enabled === 'boolean' &&
		(o.error === undefined || typeof o.error === 'string') &&
		isNames(o.applied) &&
		isNames(o.failed) &&
		isNames(o.pending)
	);
}

/** How the server's last Git sync went. A server older than sync answers 404. */
export async function fetchSync(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 15000
): Promise<SyncStatus> {
	try {
		return await apiGet(backend, token, '/api/v1/sync', isSyncStatus, fetcher, timeoutMs);
	} catch (e) {
		if (e instanceof NotFoundError) return { enabled: false };
		throw e;
	}
}

/** The server doesn't sync: it was started without --sync. */
export class SyncOffError extends Error {}

/** Asks the server to pull now; it syncs in the background. */
export async function syncNow(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 15000
): Promise<void> {
	const res = await fetcher(`${backend.url}/api/v1/sync`, {
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: { Accept: 'application/json', ...authInit(token).headers }
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403)
		throw new ScopeError('This token may only read. Syncing needs one with the apply scope.');
	if (res.status === 503 || res.status === 404)
		throw new SyncOffError(
			'This server does not sync: start it with nepfleet serve --sync <interval>.'
		);
	if (res.status !== 202) throw new Error(`HTTP ${res.status}`);
}

/** The secrets path of a stack, or of the fleet for stack ''. */
const secretsPath = (stack: string) =>
	stack === '' ? '/api/v1/secrets' : `/api/v1/stacks/${encodeURIComponent(stack)}/secrets`;

/** A secret's key is a variable name, as the backend accepts it. */
export const secretKeyPattern = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** The keys of a stack's encrypted values (or the fleet's, for ''), never the values. */
export function fetchSecretKeys(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<string[]> {
	return apiGet(
		backend,
		token,
		secretsPath(stack),
		(v: unknown): v is { keys: string[] } =>
			typeof v === 'object' &&
			v !== null &&
			Array.isArray((v as Record<string, unknown>).keys) &&
			((v as Record<string, unknown>).keys as unknown[]).every((k) => typeof k === 'string'),
		fetcher,
		timeoutMs
	).then((o) => o.keys);
}

/**
 * Stores (value) or removes (null) one secret, encrypted, in a commit. The
 * backend never sends a value back. Throws VerifyFirstError when a person must
 * confirm with a passkey first.
 */
export async function setSecret(
	backend: Backend,
	token: string,
	stack: string,
	key: string,
	value: string | null,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<string> {
	const res = await fetcher(`${backend.url}${secretsPath(stack)}/${encodeURIComponent(key)}`, {
		method: value === null ? 'DELETE' : 'PUT',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: value === null ? undefined : JSON.stringify({ value })
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError(
			stack === ''
				? 'Fleet-wide secrets need an admin token.'
				: 'This token may not change secrets. That needs one with the edit scope.'
		);
	}
	if (res.status === 404)
		throw new NotFoundError(value === null ? 'No such secret' : 'No such stack');
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const o = (await res.json()) as { commit?: unknown };
	if (typeof o.commit !== 'string') throw new Error('Unexpected response');
	return o.commit;
}

/** An opt-in system stack, as nepfleet enable lists it (GET /api/v1/features). */
export interface Feature {
	name: string;
	template: string;
	what: string;
	/** The stacks providing it, as name@target. */
	stacks: string[];
}

function isFeatures(v: unknown): v is Feature[] {
	return (
		Array.isArray(v) &&
		v.every((f) => {
			if (typeof f !== 'object' || f === null) return false;
			const o = f as Record<string, unknown>;
			return (
				typeof o.name === 'string' &&
				typeof o.template === 'string' &&
				typeof o.what === 'string' &&
				Array.isArray(o.stacks) &&
				o.stacks.every((s) => typeof s === 'string')
			);
		})
	);
}

/** The features of a backend's fleet; an older backend has none to offer. */
export async function fetchFeatures(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<Feature[] | null> {
	try {
		return await apiGet(backend, token, '/api/v1/features', isFeatures, fetcher, timeoutMs);
	} catch (e) {
		if (e instanceof NotFoundError) return null;
		throw e;
	}
}

/** The notification channels of a backend's fleet.yaml, by name; null on an older backend. */
export async function fetchChannels(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<string[] | null> {
	try {
		const o = await apiGet(
			backend,
			token,
			'/api/v1/notifications/channels',
			(v: unknown): v is { channels: string[] } =>
				typeof v === 'object' &&
				v !== null &&
				Array.isArray((v as Record<string, unknown>).channels) &&
				((v as Record<string, unknown>).channels as unknown[]).every((c) => typeof c === 'string'),
			fetcher,
			timeoutMs
		);
		return o.channels;
	} catch (e) {
		if (e instanceof NotFoundError) return null;
		throw e;
	}
}

/** Sends a channel a test message (admin scope). Throws with the reason when it fails. */
export async function testChannel(
	backend: Backend,
	token: string,
	channel: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<void> {
	const res = await fetcher(
		`${backend.url}/api/v1/notifications/channels/${encodeURIComponent(channel)}/test`,
		{
			method: 'POST',
			signal: AbortSignal.timeout(timeoutMs),
			credentials: authInit(token).credentials,
			headers: { Accept: 'application/json', ...authInit(token).headers }
		}
	);
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403)
		throw new ScopeError('Sending a test needs an admin token, or signing in.');
	if (res.status === 404) throw new NotFoundError('No such channel');
	if (res.status !== 204) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
}

/** A CycloneDX SBOM of a stack, or of the fleet's stacks the token sees (stack ''). */
export async function fetchSBOM(
	backend: Backend,
	token: string,
	stack: string,
	contents = false,
	fetcher: typeof fetch = fetch,
	timeoutMs = 330000
): Promise<Blob> {
	const path = stack === '' ? '/api/v1/sbom' : `/api/v1/stacks/${encodeURIComponent(stack)}/sbom`;
	const res = await fetcher(`${backend.url}${path}${contents ? '?contents=true' : ''}`, {
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: { Accept: 'application/vnd.cyclonedx+json', ...authInit(token).headers }
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 404) throw new NotFoundError('No such stack, or the token does not cover it');
	if (res.status === 503) throw new Error('The backend is busy with another operation; try again');
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.blob();
}

/** An API token as the backend lists it: never its secret. */
export interface TokenInfo {
	id: string;
	name: string;
	scope: 'read' | 'apply' | 'edit' | 'admin' | 'notify';
	stacks?: string[];
	created: string;
	expires: string;
	expired: boolean;
}

function isTokenInfo(v: unknown): v is TokenInfo {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.id === 'string' &&
		typeof o.name === 'string' &&
		typeof o.scope === 'string' &&
		typeof o.expires === 'string' &&
		typeof o.expired === 'boolean'
	);
}

/** The backend's API tokens (admin scope). */
export function fetchTokens(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<TokenInfo[]> {
	return apiGet(
		backend,
		token,
		'/api/v1/tokens',
		(v: unknown): v is TokenInfo[] => Array.isArray(v) && v.every(isTokenInfo),
		fetcher,
		timeoutMs
	);
}

/** Sends a change to tokens; maps the answers shared by create and revoke. */
async function tokenRequest(
	backend: Backend,
	token: string,
	path: string,
	method: 'POST' | 'DELETE',
	body: unknown,
	fetcher: typeof fetch,
	timeoutMs: number
): Promise<Response> {
	const res = await fetcher(`${backend.url}${path}`, {
		method,
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError('Managing tokens needs an admin token, or signing in.');
	}
	if (res.status === 404) throw new NotFoundError('No such token');
	if (res.status === 422 || res.status === 400) throw new Error((await res.text()).trim());
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res;
}

/** Creates a token; the secret comes only in this answer. */
export async function createToken(
	backend: Backend,
	token: string,
	req: { name: string; scope: TokenInfo['scope']; stacks?: string[]; days: number },
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<{ token: TokenInfo; secret: string }> {
	const res = await tokenRequest(backend, token, '/api/v1/tokens', 'POST', req, fetcher, timeoutMs);
	const o = (await res.json()) as { token?: unknown; secret?: unknown };
	if (!isTokenInfo(o.token) || typeof o.secret !== 'string') throw new Error('Unexpected response');
	return { token: o.token, secret: o.secret };
}

/** Revokes a token by its ID. */
export async function revokeToken(
	backend: Backend,
	token: string,
	id: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<void> {
	await tokenRequest(
		backend,
		token,
		`/api/v1/tokens/${encodeURIComponent(id)}`,
		'DELETE',
		undefined,
		fetcher,
		timeoutMs
	);
}

/** How a backend's host stands, as nepfleet doctor and doctor --security see it. */
export interface DoctorReport {
	host: string;
	stacks: number;
	checks: { name: string; status: 'ok' | 'warn' | 'fail'; detail: string; fix?: string }[];
	security: { check: string; level: string; message: string }[];
	securityError?: string;
}

function isDoctorReport(v: unknown): v is DoctorReport {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.host === 'string' &&
		Array.isArray(o.checks) &&
		o.checks.every(
			(c) =>
				typeof c === 'object' &&
				c !== null &&
				typeof (c as Record<string, unknown>).name === 'string' &&
				['ok', 'warn', 'fail'].includes((c as Record<string, unknown>).status as string)
		) &&
		Array.isArray(o.security)
	);
}

/** Runs the backend host's checks (admin scope); null on an older backend. */
export async function fetchDoctor(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 150000
): Promise<DoctorReport | null> {
	try {
		return await apiGet(backend, token, '/api/v1/doctor', isDoctorReport, fetcher, timeoutMs);
	} catch (e) {
		if (e instanceof NotFoundError) return null;
		throw e;
	}
}
