// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Backend } from './backend.ts';

/** What a backend says about signing in; passkeys may be off. */
export interface AuthStatus {
	setupNeeded: boolean;
	signedIn: boolean;
	name?: string;
}

/** The browser's passkey API, passed in so tests can stand in for it. */
export interface PasskeyApi {
	create(options: unknown): Promise<unknown>;
	get(options: unknown): Promise<unknown>;
}

interface JsonCredential {
	toJSON(): unknown;
}

interface PublicKeyCredentialJson {
	parseCreationOptionsFromJSON(o: unknown): PublicKeyCredentialCreationOptions;
	parseRequestOptionsFromJSON(o: unknown): PublicKeyCredentialRequestOptions;
}

/** The real one; a browser without it can't use passkeys. */
export function browserPasskeys(): PasskeyApi {
	const pk = (globalThis as unknown as { PublicKeyCredential?: PublicKeyCredentialJson })
		.PublicKeyCredential;
	if (!pk?.parseCreationOptionsFromJSON || !navigator.credentials) {
		throw new Error('This browser has no passkey support');
	}
	return {
		create: (o) => navigator.credentials.create({ publicKey: pk.parseCreationOptionsFromJSON(o) }),
		get: (o) => navigator.credentials.get({ publicKey: pk.parseRequestOptionsFromJSON(o) })
	};
}

async function post(
	backend: Backend,
	path: string,
	body: unknown,
	fetcher: typeof fetch
): Promise<Response> {
	const res = await fetcher(`${backend.url}/api/v1/auth/${path}`, {
		method: 'POST',
		credentials: 'include',
		signal: AbortSignal.timeout(120000),
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	if (res.status === 429) throw new Error('Too many failed attempts; wait a minute');
	if (res.status === 401) throw new Error('The backend refused this');
	if (res.status === 403)
		throw new Error('This page may not sign in here: check --allowed-origins');
	if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
	return res;
}

interface Begun {
	ceremony: string;
	options: { publicKey: unknown };
}

function isBegun(v: unknown): v is Begun {
	const o = v as Partial<Begun> | null;
	return typeof o?.ceremony === 'string' && typeof o.options?.publicKey === 'object';
}

async function ceremony(
	backend: Backend,
	begin: string,
	finish: string,
	body: unknown,
	ask: (options: unknown) => Promise<unknown>,
	fetcher: typeof fetch
): Promise<void> {
	const begun: unknown = await (await post(backend, begin, body, fetcher)).json();
	if (!isBegun(begun)) throw new Error('Unexpected response');
	let credential: unknown;
	try {
		credential = await ask(begun.options.publicKey);
	} catch (e) {
		if (e instanceof Error && e.name === 'NotAllowedError')
			throw new Error('Cancelled, or no passkey for this backend');
		throw e;
	}
	if (!credential) throw new Error('No passkey was used');
	await post(
		backend,
		`${finish}?ceremony=${encodeURIComponent(begun.ceremony)}`,
		(credential as JsonCredential).toJSON(),
		fetcher
	);
}

/** Null when the backend has passkeys off, or doesn't know them yet. */
export async function fetchAuthStatus(
	backend: Backend,
	fetcher: typeof fetch = fetch
): Promise<AuthStatus | null> {
	const res = await fetcher(`${backend.url}/api/v1/auth/status`, {
		credentials: 'include',
		signal: AbortSignal.timeout(5000),
		headers: { Accept: 'application/json' }
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const o = (await res.json()) as Partial<AuthStatus>;
	return { setupNeeded: o.setupNeeded === true, signedIn: o.signedIn === true, name: o.name };
}

/** Signs in; the session cookie stays out of reach of this page's scripts. */
export function signIn(
	backend: Backend,
	passkeys: PasskeyApi = browserPasskeys(),
	fetcher: typeof fetch = fetch
): Promise<void> {
	return ceremony(backend, 'login/begin', 'login/finish', undefined, passkeys.get, fetcher);
}

/** Creates the first user with the one-time token from the server's log. */
export function setUp(
	backend: Backend,
	setupToken: string,
	name: string,
	passkeys: PasskeyApi = browserPasskeys(),
	fetcher: typeof fetch = fetch
): Promise<void> {
	return ceremony(
		backend,
		'setup/begin',
		'setup/finish',
		{ setupToken: setupToken.trim(), name: name.trim() },
		passkeys.create,
		fetcher
	);
}

/** Adds this device's passkey for the signed-in user. */
export function addPasskey(
	backend: Backend,
	passkeys: PasskeyApi = browserPasskeys(),
	fetcher: typeof fetch = fetch
): Promise<void> {
	return ceremony(
		backend,
		'passkeys/begin',
		'passkeys/finish',
		undefined,
		passkeys.create,
		fetcher
	);
}

export async function signOut(backend: Backend, fetcher: typeof fetch = fetch): Promise<void> {
	await post(backend, 'logout', undefined, fetcher);
}
