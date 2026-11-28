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

/** "Open" with the stack's address, so its domain shows: "Open vault.example.org". */
function openName(url: string): string {
	try {
		const u = new URL(url);
		const path = u.pathname === '/' ? '' : u.pathname;
		return `Open ${u.host}${path}`;
	} catch {
		return 'Open';
	}
}

/**
 * Where a stack can be opened. A backend's answer goes into an href, so only web
 * addresses count: a javascript: link would run in this page.
 */
export function stackPlaces(s: StackInfo): StackLink[] {
	const all = [...(s.url ? [{ name: openName(s.url), url: s.url }] : []), ...(s.links ?? [])];
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

/** The scope a GET of the API needs, by its path (as the server's routes). */
export function neededScope(path: string): 'read' | 'edit' | 'admin' {
	const p = path.split('?')[0] ?? path;
	if (/^\/api\/v1\/(tokens|users|doctor|mirror|secrets)(\/|$)/.test(p)) return 'admin';
	if (
		/^\/api\/v1\/stacks\/[^/]+\/(files|secrets|backups)$/.test(p) ||
		/^\/api\/v1\/import\//.test(p)
	)
		return 'edit';
	return 'read';
}

/** What to tell when the token may not: which scope, and the way out. */
export function scopeMessage(scope: 'read' | 'edit' | 'admin'): string {
	return (
		`This needs a token with the ${scope} scope, and this backend's token has less. ` +
		'Use one that has it (or sign in to the backend). For a machine connected through ' +
		'the desktop app: update NepFleet on this computer, then disconnect and connect it again.'
	);
}

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
	if (res.status === 403) throw new ScopeError(scopeMessage(neededScope(path)));
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
	/** stack.yaml's spec.signOn; left out for the default. */
	signOn?: { mode: SignOnMode; issuer?: string; clientID?: string; clientSecret?: string };
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

/** One container (Compose) or task (Swarm) of a stack. */
export interface StackContainer {
	service: string;
	name: string;
	state: string;
	health?: string;
	status?: string;
	image: string;
	/** Docker's automatic restarts. */
	restarts: number;
	node?: string;
	error?: string;
}

function isContainers(v: unknown): v is StackContainer[] {
	return (
		Array.isArray(v) &&
		v.every((c) => {
			if (typeof c !== 'object' || c === null) return false;
			const o = c as Record<string, unknown>;
			const opt = (k: string) => o[k] === undefined || typeof o[k] === 'string';
			return (
				typeof o.service === 'string' &&
				typeof o.name === 'string' &&
				typeof o.state === 'string' &&
				typeof o.image === 'string' &&
				Number.isInteger(o.restarts) &&
				['health', 'status', 'node', 'error'].every(opt)
			);
		})
	);
}

/** A stack's containers on its backend's host. */
export function fetchContainers(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<StackContainer[]> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/containers`,
		isContainers,
		fetcher,
		timeoutMs
	);
}

/** The last lines of one of a stack's containers (edit scope: logs hold secrets). */
/**
 * Follows one of a stack's containers' output: the last lines, then what
 * comes, each chunk handed to onText, until signal aborts or the server ends
 * the stream (after 30 minutes; follow again).
 */
export async function followLogs(
	backend: Backend,
	token: string,
	stack: string,
	container: string,
	onText: (text: string) => void,
	signal: AbortSignal,
	lines = 200,
	fetcher: typeof fetch = fetch
): Promise<void> {
	const res = await fetcher(
		`${backend.url}/api/v1/stacks/${encodeURIComponent(stack)}/containers/${encodeURIComponent(container)}/logs?lines=${lines}&follow=1`,
		{
			signal,
			credentials: authInit(token).credentials,
			headers: { Accept: 'text/plain', ...authInit(token).headers }
		}
	);
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 403) throw new ScopeError(scopeMessage('edit'));
	if (res.status === 404)
		throw new NotFoundError('No such container, or the token does not cover it');
	if (res.status === 501)
		throw new Error('This backend is too old to follow logs: update its NepFleet.');
	if (!res.ok || !res.body) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		onText(value);
	}
}

export async function fetchLogs(
	backend: Backend,
	token: string,
	stack: string,
	container: string,
	lines = 200,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<string> {
	const res = await fetcher(
		`${backend.url}/api/v1/stacks/${encodeURIComponent(stack)}/containers/${encodeURIComponent(container)}/logs?lines=${lines}`,
		{
			signal: AbortSignal.timeout(timeoutMs),
			credentials: authInit(token).credentials,
			headers: { Accept: 'text/plain', ...authInit(token).headers }
		}
	);
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) throw new ScopeError(scopeMessage('edit'));
	if (res.status === 404)
		throw new NotFoundError('No such container, or the token does not cover it');
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	return res.text();
}

export type ServiceAction = 'restart' | 'stop' | 'start';

/** Restarts, stops or starts one service of a stack (apply scope). */
export async function serviceAction(
	backend: Backend,
	token: string,
	stack: string,
	service: string,
	action: ServiceAction,
	fetcher: typeof fetch = fetch,
	timeoutMs = 120000
): Promise<void> {
	const res = await fetcher(
		`${backend.url}/api/v1/stacks/${encodeURIComponent(stack)}/services/${encodeURIComponent(service)}/${action}`,
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
		throw new ScopeError('This needs a token that may apply stacks, or signing in.');
	if (res.status === 404)
		throw new NotFoundError('No such service, or the token does not cover it');
	if (res.status === 503)
		throw new ConflictError('An apply or restore of this stack is running; try again after it.');
	if (res.status !== 204) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
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
	/** The template can sign in through the fleet's identity provider. */
	oidc?: { redirect: string; scopes?: string[]; logout?: string };
}

/** What GET /api/v1/templates returns per template source. */
export interface SourceCatalogue {
	source: string;
	commit?: string;
	templates: TemplateEntry[] | null;
	invalid?: string[];
	/** Templates that stacks on the backend's host use; absent from older servers. */
	installed?: string[];
}

function isCatalogues(v: unknown): v is SourceCatalogue[] {
	return (
		Array.isArray(v) &&
		v.every((s) => {
			if (typeof s !== 'object' || s === null) return false;
			const o = s as Record<string, unknown>;
			// The installed list is extra: malformed, it is dropped.
			if (
				o.installed !== undefined &&
				!(Array.isArray(o.installed) && o.installed.every((n) => typeof n === 'string'))
			)
				delete o.installed;
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
	/** The step a running job is in: step of steps, counted from the start. */
	progress?: { step: number; steps: number; text: string };
}

export function isProgress(v: unknown): v is Job['progress'] {
	if (typeof v !== 'object' || v === null) return false;
	const p = v as Record<string, unknown>;
	return (
		Number.isInteger(p.step) &&
		Number.isInteger(p.steps) &&
		typeof p.text === 'string' &&
		(p.step as number) >= 1 &&
		(p.steps as number) >= (p.step as number)
	);
}

function isJob(v: unknown): v is Job {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	// A malformed progress is dropped, not the job: the bar is extra.
	if (o.progress !== undefined && !isProgress(o.progress)) delete o.progress;
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
	/** Whether the fleet repository has a git remote, sync on or off; absent on older servers. */
	remote?: boolean;
	/** That remote, without credentials. */
	remoteUrl?: string;
}

const isNames = (v: unknown) =>
	v === undefined || v === null || (Array.isArray(v) && v.every((s) => typeof s === 'string'));

function isSyncStatus(v: unknown): v is SyncStatus {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.enabled === 'boolean' &&
		(o.error === undefined || typeof o.error === 'string') &&
		(o.remote === undefined || typeof o.remote === 'boolean') &&
		(o.remoteUrl === undefined || typeof o.remoteUrl === 'string') &&
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

/** One input of a stack's template, and whether it's set (GET …/inputs). */
export interface StackInput {
	name: string;
	type: string;
	title?: string;
	description?: string;
	required?: boolean;
	default?: string;
	options?: string[];
	pattern?: string;
	/** Kept encrypted: written, never read back. */
	secret?: boolean;
	set?: boolean;
	/** The current value; never for secret inputs. */
	value?: string;
	/** Required, no default, and not set: the stack waits for it. */
	missing?: boolean;
}

function isStackInputs(v: unknown): v is { inputs: StackInput[] } {
	const o = v as { inputs?: unknown } | null;
	return (
		typeof o === 'object' &&
		o !== null &&
		Array.isArray(o.inputs) &&
		o.inputs.every(
			(i: unknown) =>
				typeof i === 'object' &&
				i !== null &&
				typeof (i as StackInput).name === 'string' &&
				typeof (i as StackInput).type === 'string'
		)
	);
}

/** The inputs of a stack's template; [] for a stack without a template. */
export function fetchStackInputs(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<StackInput[]> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/inputs`,
		isStackInputs,
		fetcher,
		timeoutMs
	).then((o) => o.inputs);
}

/**
 * Sets several inputs in one commit: secret ones encrypted, the others in
 * stack.yaml. An empty value leaves an input as it is. The backend waits up to
 * 2 minutes for a running apply. Throws VerifyFirstError when a person must
 * confirm with a passkey first.
 */
export async function setStackInputs(
	backend: Backend,
	token: string,
	stack: string,
	values: Record<string, string>,
	fetcher: typeof fetch = fetch,
	timeoutMs = 150000
): Promise<string> {
	const res = await fetcher(`${backend.url}/api/v1/stacks/${encodeURIComponent(stack)}/inputs`, {
		method: 'PUT',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify({ values })
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError(
			'This token may not change the stack. That needs one with the edit scope.'
		);
	}
	if (res.status === 404) throw new NotFoundError('No such stack');
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

/** A channel's last send attempt: when, whether it went out, why not (no URLs). */
export type ChannelDelivery = {
	at: string;
	ok: boolean;
	error?: string;
	/** The last attempt that went out, if any. */
	delivered?: string;
};

export type ChannelList = {
	channels: string[];
	/** By channel name; a channel not sent to yet, or a backend too old to record them, has none. */
	deliveries: Record<string, ChannelDelivery>;
};

function isChannelDelivery(v: unknown): v is ChannelDelivery {
	if (typeof v !== 'object' || v === null) return false;
	const d = v as Record<string, unknown>;
	return (
		typeof d.at === 'string' &&
		typeof d.ok === 'boolean' &&
		(d.error === undefined || typeof d.error === 'string') &&
		(d.delivered === undefined || typeof d.delivered === 'string')
	);
}

function isChannelList(v: unknown): v is { channels: string[]; deliveries?: unknown } {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		Array.isArray(o.channels) &&
		o.channels.every((c) => typeof c === 'string') &&
		(o.deliveries === undefined ||
			(typeof o.deliveries === 'object' &&
				o.deliveries !== null &&
				Object.values(o.deliveries).every(isChannelDelivery)))
	);
}

/**
 * The notification channels of a backend's fleet.yaml, by name, with each
 * one's last delivery; null on an older backend.
 */
export async function fetchChannelList(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<ChannelList | null> {
	try {
		const o = await apiGet(
			backend,
			token,
			'/api/v1/notifications/channels',
			isChannelList,
			fetcher,
			timeoutMs
		);
		return {
			channels: o.channels,
			deliveries: (o.deliveries ?? {}) as Record<string, ChannelDelivery>
		};
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
	return (await fetchChannelList(backend, token, fetcher, timeoutMs))?.channels ?? null;
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

/**
 * Adds or replaces a notification channel (url: a shoutrrr URL, stored
 * encrypted), or removes it (url null). Committed on the backend; returns
 * the commit.
 */
export async function setChannel(
	backend: Backend,
	token: string,
	channel: string,
	url: string | null,
	minSeverity: 'info' | 'warning' | 'error' = 'warning',
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<string> {
	const res = await fetcher(
		`${backend.url}/api/v1/notifications/channels/${encodeURIComponent(channel)}`,
		{
			method: url === null ? 'DELETE' : 'PUT',
			signal: AbortSignal.timeout(timeoutMs),
			credentials: authInit(token).credentials,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				...authInit(token).headers
			},
			body: url === null ? undefined : JSON.stringify({ url, minSeverity })
		}
	);
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403)
		throw new ScopeError('Changing channels needs an admin token, or signing in.');
	if (res.status === 404 || res.status === 405)
		throw new NotFoundError(
			url === null ? 'No such channel' : 'This backend’s NepFleet is too old to change channels.'
		);
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const o = (await res.json()) as { commit?: unknown };
	if (typeof o.commit !== 'string') throw new Error('Unexpected response');
	return o.commit;
}

/** Which events go to which channels; empty events or stacks match all. */
export interface NotifyRoute {
	channels: string[];
	events: string[];
	stacks: string[];
	minSeverity?: 'info' | 'warning' | 'error';
}

function isRoutes(v: unknown): v is { routes: NotifyRoute[] } {
	if (typeof v !== 'object' || v === null) return false;
	const rs = (v as Record<string, unknown>).routes;
	const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');
	return (
		Array.isArray(rs) &&
		rs.every((r) => {
			if (typeof r !== 'object' || r === null) return false;
			const o = r as Record<string, unknown>;
			return (
				strings(o.channels) &&
				strings(o.events) &&
				strings(o.stacks) &&
				(o.minSeverity === undefined ||
					['info', 'warning', 'error'].includes(o.minSeverity as string))
			);
		})
	);
}

/** The fleet's notification routes, or null from a backend too old to list them. */
export async function fetchRoutes(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<NotifyRoute[] | null> {
	try {
		const body = await apiGet(
			backend,
			token,
			'/api/v1/notifications/routes',
			isRoutes,
			fetcher,
			timeoutMs
		);
		return body.routes;
	} catch (e) {
		if (e instanceof NotFoundError) return null;
		throw e;
	}
}

/** Replaces the fleet's notification routes, committed there; returns the commit. */
export async function saveRoutes(
	backend: Backend,
	token: string,
	routes: NotifyRoute[],
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<string> {
	const res = await fetcher(`${backend.url}/api/v1/notifications/routes`, {
		method: 'PUT',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify({ routes })
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403)
		throw new ScopeError('Changing routes needs an admin token, or signing in.');
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const o = (await res.json()) as { commit?: unknown };
	if (typeof o.commit !== 'string') throw new Error('Unexpected response');
	return o.commit;
}

export type MailTLS = 'starttls' | 'tls' | 'none';

/** The fleet's mail settings (GET /api/v1/mail). The password is never sent, only whether it's set. */
export interface MailSettings {
	configured: boolean;
	host: string;
	port: number;
	user: string;
	from: string;
	tls: MailTLS | '';
	passwordSet: boolean;
}

/** What saving takes. password: undefined keeps the stored one, '' removes it. */
export interface MailUpdate {
	host: string;
	port?: number;
	user?: string;
	from?: string;
	tls?: MailTLS;
	password?: string;
}

function isMailSettings(v: unknown): v is MailSettings {
	const o = v as Partial<MailSettings> | null;
	return (
		typeof o?.configured === 'boolean' &&
		typeof o.host === 'string' &&
		typeof o.port === 'number' &&
		typeof o.user === 'string' &&
		typeof o.from === 'string' &&
		typeof o.tls === 'string' &&
		typeof o.passwordSet === 'boolean'
	);
}

/** The fleet's mail settings (admin scope); null on a backend too old to have them. */
export async function fetchMail(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<MailSettings | null> {
	const res = await fetcher(`${backend.url}/api/v1/mail`, {
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: { Accept: 'application/json', ...authInit(token).headers }
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) throw new ScopeError(scopeMessage('admin'));
	if (res.status === 404 || res.status === 405) return null;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body: unknown = await res.json();
	if (!isMailSettings(body)) throw new Error('Unexpected response');
	return body;
}

/**
 * Saves (settings) or removes (null) the fleet's mail settings, committed on
 * the backend with the password encrypted; returns the commit. Throws
 * VerifyFirstError when a person must confirm with a passkey first.
 */
export async function saveMail(
	backend: Backend,
	token: string,
	settings: MailUpdate | null,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<string> {
	const res = await fetcher(`${backend.url}/api/v1/mail`, {
		method: settings === null ? 'DELETE' : 'PUT',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: settings === null ? undefined : JSON.stringify(settings)
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError('Changing mail settings needs an admin token, or signing in.');
	}
	if (res.status === 404)
		throw new NotFoundError(settings === null ? 'No mail settings to remove' : 'Not found');
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const o = (await res.json()) as { commit?: unknown };
	if (typeof o.commit !== 'string') throw new Error('Unexpected response');
	return o.commit;
}

/** Sends a test mail to `to` with the saved settings (admin scope). Throws with the reason. */
export async function testMail(
	backend: Backend,
	token: string,
	to: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<void> {
	const res = await fetcher(`${backend.url}/api/v1/mail/test`, {
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify({ to })
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429)
		throw new Error((await res.text()).trim() || 'Too many test mails; try again later');
	if (res.status === 403)
		throw new ScopeError('Sending a test needs an admin token, or signing in.');
	if (res.status === 404) throw new NotFoundError('Save the mail settings first');
	if (res.status !== 204) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
}

export type SignOnMode = 'integrated' | 'custom' | 'none';

/** The fleet's sign-on (GET /api/v1/signon). */
export interface SignOnSettings {
	/** The provider stack; '' without one. */
	provider: string;
	/** Templates the backend can register clients in (pocket-id). */
	kinds: string[];
	/** Stacks running one of kinds. */
	candidates: string[];
	/** Stacks whose template supports sign-on, or that set a mode. */
	stacks: { name: string; mode: SignOnMode; explicit: boolean }[];
}

/** A stack's sign-on (GET /api/v1/stacks/{name}/signon). */
export interface StackSignOn {
	/** The template declares spec.oidc. */
	supported: boolean;
	/** The mode in effect; set is stack.yaml's own ('' for the default). */
	mode: SignOnMode;
	set: SignOnMode | '';
	issuer?: string;
	clientID?: string;
	provider: string;
	/** The custom client secret is stored; absent without the edit scope. */
	secretSet?: boolean;
}

const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string');

function isSignOnSettings(v: unknown): v is SignOnSettings {
	const o = v as Partial<SignOnSettings> | null;
	return (
		typeof o?.provider === 'string' &&
		strings(o.kinds) &&
		strings(o.candidates) &&
		Array.isArray(o.stacks) &&
		o.stacks.every((s) => typeof s?.name === 'string' && typeof s.mode === 'string')
	);
}

function isStackSignOn(v: unknown): v is StackSignOn {
	const o = v as Partial<StackSignOn> | null;
	return (
		typeof o?.supported === 'boolean' &&
		typeof o.mode === 'string' &&
		typeof o.set === 'string' &&
		typeof o.provider === 'string'
	);
}

/** The fleet's sign-on; null on a backend too old to have it. */
export async function fetchSignOn(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<SignOnSettings | null> {
	try {
		return await apiGet(backend, token, '/api/v1/signon', isSignOnSettings, fetcher, timeoutMs);
	} catch (e) {
		if (e instanceof NotFoundError) return null;
		throw e;
	}
}

/** A stack's sign-on; null on a backend too old to have it. */
export async function fetchStackSignOn(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<StackSignOn | null> {
	try {
		return await apiGet(
			backend,
			token,
			`/api/v1/stacks/${encodeURIComponent(stack)}/signon`,
			isStackSignOn,
			fetcher,
			timeoutMs
		);
	} catch (e) {
		if (e instanceof NotFoundError) return null;
		throw e;
	}
}

/** A sign-on change: PUT or DELETE with a JSON body, answering the commit. */
async function signOnChange(
	backend: Backend,
	token: string,
	path: string,
	method: 'PUT' | 'DELETE',
	body: unknown,
	scope: string,
	fetcher: typeof fetch,
	timeoutMs: number
): Promise<string> {
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
		throw new ScopeError(scope);
	}
	if (res.status === 404) throw new NotFoundError((await res.text()).trim() || 'Not found');
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (res.status === 422) throw new InvalidEditError((await res.text()).trim());
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const o = (await res.json()) as { commit?: unknown };
	if (typeof o.commit !== 'string') throw new Error('Unexpected response');
	return o.commit;
}

/**
 * Names the fleet's sign-on provider (a stack), or with null removes it;
 * committed on the backend, returns the commit (admin scope).
 */
export function saveSignOn(
	backend: Backend,
	token: string,
	provider: string | null,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<string> {
	return signOnChange(
		backend,
		token,
		'/api/v1/signon',
		provider === null ? 'DELETE' : 'PUT',
		provider === null ? undefined : { provider },
		'Changing the sign-on provider needs an admin token, or signing in.',
		fetcher,
		timeoutMs
	);
}

/**
 * Sets a stack's sign-on in stack.yaml; mode '' goes back to the default.
 * The custom client secret goes with setSecret first.
 */
export function saveStackSignOn(
	backend: Backend,
	token: string,
	stack: string,
	update: { mode: SignOnMode | ''; issuer?: string; clientID?: string },
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<string> {
	return signOnChange(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/signon`,
		'PUT',
		update,
		'This token may not change the stack. That needs one with the edit scope.',
		fetcher,
		timeoutMs
	);
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
	checks: {
		name: string;
		status: 'ok' | 'warn' | 'fail';
		detail: string;
		fix?: string;
		/**
		 * A fix the app can start: dns-records is letCaddyKeepDNS, key-backup is
		 * backupKey (the backend records the copy, so the warning clears).
		 */
		action?: string;
	}[];
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
/** The domain a DNS check names: "dozzle: monitor.example.org doesn't resolve…". */
export function dnsDomain(detail: string): string {
	return /^[^:]+: (\S+) /.exec(detail)?.[1] ?? '';
}

/**
 * Turns on the backend's Caddy option "Create the sites' DNS records" for a
 * zone, committed there; returns the Caddy stack, whose plan shows the change.
 */
export async function letCaddyKeepDNS(
	backend: Backend,
	token: string,
	zone: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<{ stack: string; commit: string }> {
	const res = await fetcher(`${backend.url}/api/v1/dns-records`, {
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify({ zone })
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) throw new ScopeError(scopeMessage('admin'));
	if (res.status === 404)
		throw new Error('This backend is too old for that: update its NepFleet first.');
	if (res.status === 409)
		throw new ConflictError(
			"Caddy's stack has uncommitted changes on the server: commit them first."
		);
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const body = (await res.json()) as Record<string, unknown>;
	if (typeof body.stack !== 'string' || typeof body.commit !== 'string')
		throw new Error('Unexpected response');
	return { stack: body.stack, commit: body.commit };
}

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

/** A person who signs in to a backend, and their passkeys. */
export interface UserInfo {
	name: string;
	created: string;
	external?: boolean;
	codes: boolean;
	passkeys: { id: string; name: string; synced: boolean; uses: number; locked?: boolean }[];
}

function isUsers(v: unknown): v is UserInfo[] {
	return (
		Array.isArray(v) &&
		v.every((u) => {
			if (typeof u !== 'object' || u === null) return false;
			const o = u as Record<string, unknown>;
			return (
				typeof o.name === 'string' &&
				Array.isArray(o.passkeys) &&
				o.passkeys.every(
					(p) =>
						typeof p === 'object' &&
						p !== null &&
						typeof (p as Record<string, unknown>).id === 'string'
				)
			);
		})
	);
}

/** The people of a backend (admin scope); null when it has no accounts or is older. */
export async function fetchUsers(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<UserInfo[] | null> {
	try {
		return await apiGet(backend, token, '/api/v1/users', isUsers, fetcher, timeoutMs);
	} catch (e) {
		if (e instanceof NotFoundError) return null;
		if (e instanceof Error && e.message === 'HTTP 503') return null;
		throw e;
	}
}

/** Removes a person (passkey null) or one of their passkeys, by its whole ID. */
export async function removeAccess(
	backend: Backend,
	token: string,
	user: string,
	passkey: string | null,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<void> {
	const path =
		`/api/v1/users/${encodeURIComponent(user)}` +
		(passkey === null ? '' : `/passkeys/${encodeURIComponent(passkey)}`);
	const res = await fetcher(`${backend.url}${path}`, {
		method: 'DELETE',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: { Accept: 'application/json', ...authInit(token).headers }
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError('Managing people needs an admin token, or signing in.');
	}
	if (res.status === 404) throw new NotFoundError('No such person');
	if (res.status !== 204) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
}

/**
 * Adds hosts, addresses or ranges to a stack's egress allow list, in a commit.
 * It doesn't apply. Throws VerifyFirstError when a person must confirm first.
 */
export async function allowEgress(
	backend: Backend,
	token: string,
	stack: string,
	add: string[],
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<{ commit?: string; added: string[] }> {
	const res = await fetcher(
		`${backend.url}/api/v1/stacks/${encodeURIComponent(stack)}/egress/allow`,
		{
			method: 'POST',
			signal: AbortSignal.timeout(timeoutMs),
			credentials: authInit(token).credentials,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				...authInit(token).headers
			},
			body: JSON.stringify({ add })
		}
	);
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError('Changing the allow list needs a token with the edit scope.');
	}
	if (res.status === 404) throw new NotFoundError('No such stack, or the token does not cover it');
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (res.status === 422) throw new InvalidEditError((await res.text()).trim());
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const o = (await res.json()) as { commit?: unknown; added?: unknown };
	if (!Array.isArray(o.added)) throw new Error('Unexpected response');
	return {
		commit: typeof o.commit === 'string' ? o.commit : undefined,
		added: o.added as string[]
	};
}

/** The files a stack renders to, secrets masked (as nepfleet render). */
export function fetchRendered(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<{ path: string; content: string }[]> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/render`,
		(v: unknown): v is { path: string; content: string }[] =>
			Array.isArray(v) &&
			v.every(
				(f) =>
					typeof f === 'object' &&
					f !== null &&
					typeof (f as Record<string, unknown>).path === 'string' &&
					typeof (f as Record<string, unknown>).content === 'string'
			),
		fetcher,
		timeoutMs
	);
}

/**
 * Runs the backend's updates now, as nepfleet updates apply: a job (kind
 * updates) to follow with fetchJob. now also ignores the update window.
 */
export async function startUpdates(
	backend: Backend,
	token: string,
	now: boolean,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<Job> {
	const res = await fetcher(`${backend.url}/api/v1/updates/run`, {
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify({ now })
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403)
		throw new ScopeError(
			'Running updates needs a token with the apply scope that is not limited to stacks.'
		);
	if (res.status === 404)
		throw new NotFoundError('This backend is too old to run updates from here');
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (res.status !== 202) throw new Error(`HTTP ${res.status}`);
	const job: unknown = await res.json();
	if (!isJob(job)) throw new Error('Unexpected response');
	return job;
}

/**
 * The backend's age key, encrypted with age to the given public keys (age1… or
 * an SSH public key). Only a signed-in person may; throws VerifyFirstError when
 * they must confirm with a passkey first.
 */
export async function backupKey(
	backend: Backend,
	token: string,
	recipients: string[],
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<Blob> {
	const res = await fetcher(`${backend.url}/api/v1/key/backup`, {
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/octet-stream',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify({ recipients })
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError(
			'Only a person signed in to the backend can back up its key, not a token.'
		);
	}
	if (res.status === 404)
		throw new NotFoundError('This backend is too old to back up its key from here');
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	return res.blob();
}

/** One of a backend's spec.mirrors: its last successful push and last error. */
export interface MirrorStatus {
	url: string;
	ok?: string;
	error?: string;
}

const isMirrors = (v: unknown): v is MirrorStatus[] =>
	Array.isArray(v) &&
	v.every(
		(m) =>
			typeof m === 'object' && m !== null && typeof (m as Record<string, unknown>).url === 'string'
	);

/** The backend's mirrors (admin scope); null on an older backend. */
export async function fetchMirrors(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<MirrorStatus[] | null> {
	try {
		return await apiGet(backend, token, '/api/v1/mirror', isMirrors, fetcher, timeoutMs);
	} catch (e) {
		if (e instanceof NotFoundError) return null;
		throw e;
	}
}

/** Pushes the fleet repository to its mirrors now, and says how each went. */
export async function mirrorNow(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 200000
): Promise<MirrorStatus[]> {
	const res = await fetcher(`${backend.url}/api/v1/mirror`, {
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: { Accept: 'application/json', ...authInit(token).headers }
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) throw new ScopeError('Mirroring needs an admin token, or signing in.');
	if (res.status === 503) throw new Error('The backend is busy with another operation; try again');
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const v: unknown = await res.json();
	if (!isMirrors(v)) throw new Error('Unexpected response');
	return v;
}

/**
 * A backend's newest events (GET /api/v1/events), newest last, at most keep:
 * for the browser, where no control daemon merges them.
 */
export async function fetchEvents(
	backend: Backend,
	token: string,
	keep = 200,
	fetcher: typeof fetch = fetch,
	timeoutMs = 30000
): Promise<import('./notifications.ts').FleetEvent[]> {
	type E = import('./notifications.ts').FleetEvent;
	const isEvents = (v: unknown): v is E[] =>
		Array.isArray(v) &&
		v.every(
			(e) =>
				typeof e === 'object' &&
				e !== null &&
				typeof (e as Record<string, unknown>).id === 'number' &&
				typeof (e as Record<string, unknown>).title === 'string'
		);
	let all: E[] = [];
	let after = 0;
	// Oldest first, 500 a page: walk to the end, keeping the newest.
	for (let page = 0; page < 40; page++) {
		const got = await apiGet(
			backend,
			token,
			`/api/v1/events?after=${after}&limit=500`,
			isEvents,
			fetcher,
			timeoutMs
		);
		all = all.concat(got).slice(-keep);
		if (got.length < 500) break;
		after = got[got.length - 1]?.id ?? after;
	}
	return all;
}

/** Which templates run a plain stack's images (nepfleet template match). */
export interface TemplateMatches {
	template?: string;
	matches: {
		source: string;
		name: string;
		title?: string;
		version: string;
		same: { image: string; stack: string; template: string }[];
		onlyStack: string[];
		onlyTemplate: string[];
	}[];
}

export function fetchMatches(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<TemplateMatches> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/match`,
		(v: unknown): v is TemplateMatches =>
			typeof v === 'object' &&
			v !== null &&
			Array.isArray((v as Record<string, unknown>).matches) &&
			((v as Record<string, unknown>).matches as unknown[]).every(
				(m) =>
					typeof m === 'object' &&
					m !== null &&
					typeof (m as Record<string, unknown>).name === 'string' &&
					Array.isArray((m as Record<string, unknown>).same)
			),
		fetcher,
		timeoutMs
	);
}

/** The archives a stack can be restored from, newest first, and its volume keys. */
export interface Backups {
	folder: string;
	archives: string[];
	volumes: string[];
}

export function fetchBackups(
	backend: Backend,
	token: string,
	stack: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 130000
): Promise<Backups> {
	return apiGet(
		backend,
		token,
		`/api/v1/stacks/${encodeURIComponent(stack)}/backups`,
		(v: unknown): v is Backups =>
			typeof v === 'object' &&
			v !== null &&
			Array.isArray((v as Record<string, unknown>).archives) &&
			Array.isArray((v as Record<string, unknown>).volumes),
		fetcher,
		timeoutMs
	);
}

/**
 * Restores a stack's volumes from an archive, as a job (confirm repeats the
 * stack's name). Throws VerifyFirstError when a person must confirm first.
 */
export async function startRestore(
	backend: Backend,
	token: string,
	stack: string,
	req: { archive: string; volumes?: string[]; confirm: string },
	fetcher: typeof fetch = fetch,
	timeoutMs = 60000
): Promise<Job> {
	const res = await fetcher(`${backend.url}/api/v1/stacks/${encodeURIComponent(stack)}/restore`, {
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
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError('Restoring needs a token with the edit scope, or signing in.');
	}
	if (res.status === 404) throw new NotFoundError('No such stack, or the token does not cover it');
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (res.status === 422) throw new InvalidEditError((await res.text()).trim());
	if (res.status !== 202) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const job: unknown = await res.json();
	if (!isJob(job)) throw new Error('Unexpected response');
	return job;
}

/** A Compose project of a backend's host, and whether it's a stack already. */
export interface ComposeProject {
	name: string;
	status: string;
	configFiles: string[];
	stack: boolean;
}

export async function fetchComposeProjects(
	backend: Backend,
	token: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 70000
): Promise<ComposeProject[] | null> {
	try {
		return await apiGet(
			backend,
			token,
			'/api/v1/import/compose',
			(v: unknown): v is ComposeProject[] =>
				Array.isArray(v) &&
				v.every(
					(p) =>
						typeof p === 'object' &&
						p !== null &&
						typeof (p as Record<string, unknown>).name === 'string'
				),
			fetcher,
			timeoutMs
		);
	} catch (e) {
		if (e instanceof NotFoundError) return null;
		throw e;
	}
}

/** Imports a Compose project as a stack, adopted and committed. */
export async function importCompose(
	backend: Backend,
	token: string,
	project: string,
	encryptAll = false,
	fetcher: typeof fetch = fetch,
	timeoutMs = 330000
): Promise<{ stack: string; commit: string; log: string }> {
	const res = await fetcher(`${backend.url}/api/v1/import/compose`, {
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs),
		credentials: authInit(token).credentials,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...authInit(token).headers
		},
		body: JSON.stringify(encryptAll ? { project, encryptAll } : { project })
	});
	if (res.status === 401) throw new AuthError('The backend refused the token');
	if (res.status === 429) throw new AuthError('Too many failed attempts; wait a minute');
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new VerifyFirstError('Confirm it’s you with a passkey');
		throw new ScopeError(
			'Importing needs a token with the edit scope that is not limited to stacks, or signing in.'
		);
	}
	if (res.status === 409) throw new ConflictError((await res.text()).trim());
	if (res.status === 422) throw new InvalidEditError((await res.text()).trim());
	if (res.status !== 201) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	const o = (await res.json()) as { stack?: unknown; commit?: unknown; log?: unknown };
	if (typeof o.stack !== 'string' || typeof o.commit !== 'string')
		throw new Error('Unexpected response');
	return { stack: o.stack, commit: o.commit, log: typeof o.log === 'string' ? o.log : '' };
}
