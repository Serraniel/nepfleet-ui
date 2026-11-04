// SPDX-License-Identifier: AGPL-3.0-or-later

/** A NepFleet backend this frontend connects to. */
export interface Backend {
	id: string;
	url: string;
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
	timeoutMs = 5000
): Promise<BackendInfo> {
	const res = await fetcher(`${backend.url}/api/v1/info`, {
		signal: AbortSignal.timeout(timeoutMs),
		credentials: 'include',
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body: unknown = await res.json();
	if (!isInfo(body)) throw new Error('Unexpected response: is this a NepFleet backend?');
	return body;
}
