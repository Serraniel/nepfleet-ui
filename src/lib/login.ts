// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Backend } from './backend.ts';

/** What a backend says about signing in; passkeys may be off. */
export interface AuthStatus {
	setupNeeded: boolean;
	signedIn: boolean;
	name?: string;
	/** Whether the signed-in user has sign-in codes on. */
	totp: boolean;
	/** Whether an identity provider can sign people in. */
	oidc: boolean;
	/** Whether passkeys are on. */
	passkeys: boolean;
	/** The signed-in user came through the provider, so can't add a passkey or codes. */
	external: boolean;
}

/** A new authenticator's secret, until a code proves it works. Keep it in memory only. */
export interface CodeSetup {
	ceremony: string;
	secret: string;
	url: string;
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

/** The backend wants a recent proof that it's still the person, by passkey. */
export class NeedsVerification extends Error {
	constructor() {
		super("Confirm it's you with a passkey you have, then try again");
		this.name = 'NeedsVerification';
	}
}

async function post(
	backend: Backend,
	path: string,
	body: unknown,
	fetcher: typeof fetch,
	refused = 'The backend refused this'
): Promise<Response> {
	const res = await fetcher(`${backend.url}/api/v1/auth/${path}`, {
		method: 'POST',
		credentials: 'include',
		signal: AbortSignal.timeout(120000),
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	if (res.status === 429) throw new Error('Too many failed attempts; wait a minute');
	if (res.status === 401) throw new Error(refused);
	if (res.status === 403) {
		const o = (await res.json().catch(() => null)) as { verify?: unknown } | null;
		if (o?.verify === true) throw new NeedsVerification();
		throw new Error('This page may not sign in here: check --allowed-origins');
	}
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
	return {
		setupNeeded: o.setupNeeded === true,
		signedIn: o.signedIn === true,
		name: o.name,
		totp: o.totp === true,
		oidc: o.oidc === true,
		// Backends from before this field only had passkeys.
		passkeys: o.passkeys !== false,
		external: o.external === true
	};
}

/** Where to send the browser to sign in through the identity provider. */
export function providerLoginUrl(backend: Backend, returnTo: string): string {
	return `${backend.url}/api/v1/auth/oidc/login?return=${encodeURIComponent(returnTo)}`;
}

/** Signs in with a code from an authenticator app, when no passkey is at hand. */
export async function signInWithCode(
	backend: Backend,
	name: string,
	code: string,
	fetcher: typeof fetch = fetch
): Promise<void> {
	await post(
		backend,
		'totp/login',
		{ name: name.trim(), code: code.trim() },
		fetcher,
		'Wrong name or code, or too many tries for this user'
	);
}

export async function beginCodes(
	backend: Backend,
	fetcher: typeof fetch = fetch
): Promise<CodeSetup> {
	const o = (await (await post(backend, 'totp/begin', undefined, fetcher)).json()) as CodeSetup;
	if (typeof o.ceremony !== 'string' || typeof o.secret !== 'string' || typeof o.url !== 'string') {
		throw new Error('Unexpected response');
	}
	return o;
}

/** Turns codes on, once one from the new authenticator proves it works. */
export async function finishCodes(
	backend: Backend,
	ceremonyId: string,
	code: string,
	fetcher: typeof fetch = fetch
): Promise<void> {
	await post(
		backend,
		`totp/finish?ceremony=${encodeURIComponent(ceremonyId)}`,
		{ code: code.trim() },
		fetcher,
		'That code is wrong; check the time on your device, and try again'
	);
}

export async function removeCodes(backend: Backend, fetcher: typeof fetch = fetch): Promise<void> {
	await post(backend, 'totp/remove', undefined, fetcher);
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

/**
 * Adds this device's passkey for the signed-in user. A sign-in that isn't recent
 * first proves it's still them, with a passkey they already have, so a stolen
 * session alone can't add one.
 */
export async function addPasskey(
	backend: Backend,
	passkeys: PasskeyApi = browserPasskeys(),
	fetcher: typeof fetch = fetch
): Promise<void> {
	const add = () =>
		ceremony(backend, 'passkeys/begin', 'passkeys/finish', undefined, passkeys.create, fetcher);
	try {
		await add();
	} catch (e) {
		if (!(e instanceof NeedsVerification)) throw e;
		await ceremony(backend, 'verify/begin', 'verify/finish', undefined, passkeys.get, fetcher);
		await add();
	}
}

/** Proves it's still the signed-in person, with a passkey they have; counts for 5 minutes. */
export function verifyIdentity(
	backend: Backend,
	passkeys: PasskeyApi = browserPasskeys(),
	fetcher: typeof fetch = fetch
): Promise<void> {
	return ceremony(backend, 'verify/begin', 'verify/finish', undefined, passkeys.get, fetcher);
}

export async function signOut(backend: Backend, fetcher: typeof fetch = fetch): Promise<void> {
	await post(backend, 'logout', undefined, fetcher);
}
