import { type HostUpdates, isHostUpdates } from './local.ts';

/** A machine's last host-updates answer and when it came. */
export interface Checked {
	value: HostUpdates;
	/** ISO time of the check. */
	at: string;
}

const KEY = 'nepfleet.hostUpdates';
/** Answers older than this are dropped: they say little about the machine now. */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

/** The remembered answers per machine, checked again on the way in. */
export function loadChecked(
	storage?: Pick<Storage, 'getItem'>,
	now = Date.now()
): Record<string, Checked> {
	const out: Record<string, Checked> = {};
	try {
		const raw = (storage ?? globalThis.localStorage)?.getItem(KEY);
		if (!raw) return out;
		const o = JSON.parse(raw) as unknown;
		if (typeof o !== 'object' || o === null || Array.isArray(o)) return out;
		for (const [name, c] of Object.entries(o as Record<string, unknown>)) {
			if (typeof c !== 'object' || c === null) continue;
			const { value, at } = c as Record<string, unknown>;
			const t = typeof at === 'string' ? Date.parse(at) : NaN;
			if (!isHostUpdates(value) || Number.isNaN(t) || now - t > MAX_AGE_MS) continue;
			out[name] = { value, at: at as string };
		}
	} catch {
		// unreadable or blocked storage: start empty
	}
	return out;
}

/** Remembers the answers; storage that refuses is fine. */
export function saveChecked(all: Record<string, Checked>, storage?: Pick<Storage, 'setItem'>) {
	try {
		(storage ?? globalThis.localStorage)?.setItem(KEY, JSON.stringify(all));
	} catch {
		// full or blocked: they just aren't remembered
	}
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(at: string, now = Date.now()): string {
	const s = Math.max(0, (now - Date.parse(at)) / 1000);
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	const d = Math.floor(s / 86400);
	return `${d} day${d === 1 ? '' : 's'} ago`;
}
