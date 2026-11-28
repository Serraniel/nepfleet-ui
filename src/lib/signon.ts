// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SignOnMode } from './backend.ts';

/**
 * Template inputs that the sign-on built-ins (NEPFLEET_OIDC_*) fill when
 * NepFleet manages sign-on: a template keeps them as overrides for a stack
 * without it. Other OIDC_* inputs (a button label, who may sign up) stay.
 */
const overrides = new Set([
	'OIDC_ENABLED',
	'OIDC_ISSUER',
	'OIDC_CLIENT_ID',
	'OIDC_CLIENT_SECRET',
	'OIDC_SCOPES'
]);

/** Whether an input is hidden in this sign-on mode: the built-ins fill it. */
export function hiddenBySignOn(input: string, mode: SignOnMode | undefined): boolean {
	return (mode === 'integrated' || mode === 'custom') && overrides.has(input);
}

/** The mode a stack gets without one in stack.yaml, as the backend decides. */
export function defaultSignOn(hasProvider: boolean, supported: boolean): SignOnMode {
	return hasProvider && supported ? 'integrated' : 'none';
}

/** What a mode means, for a choice. */
export const signOnLabels: Record<SignOnMode, string> = {
	integrated: 'Integrated: the fleet’s provider',
	custom: 'Custom: a provider of your own',
	none: 'None: the app’s own accounts'
};

/** An issuer is an http(s) URL with a host, as the backend checks. */
export function issuerError(v: string): string {
	try {
		const u = new URL(v.trim());
		if ((u.protocol === 'https:' || u.protocol === 'http:') && u.host) return '';
	} catch {
		/* not a URL */
	}
	return 'An http(s) URL, such as https://login.example.org';
}
