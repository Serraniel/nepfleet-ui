// SPDX-License-Identifier: AGPL-3.0-or-later
import { isDesktop } from './desktop.ts';

/** An event from the fleets, as the control daemon merges them. */
export interface FleetEvent {
	id: number;
	time: string;
	name: string;
	severity: string;
	stack?: string;
	host?: string;
	fleet?: string;
	title: string;
	message?: string;
}

export type MinSeverity = 'info' | 'warning' | 'error';

const RANK: Record<string, number> = { info: 0, warning: 1, error: 2 };

/** Whether an event is at least as severe as asked; unknown ones count as info. */
export function atLeast(severity: string, min: MinSeverity): boolean {
	return (RANK[severity] ?? 0) >= (RANK[min] ?? 0);
}

/** Where an event links to, if it is about a stack of a known fleet. */
export function eventHref(e: FleetEvent): string | undefined {
	if (!e.fleet || !e.stack) return undefined;
	return `/stacks/${encodeURIComponent('local:' + e.fleet)}/${encodeURIComponent(e.stack)}`;
}

const SETTINGS_KEY = 'nepfleet-os-notifications';

/** Off until the user turns it on. No secrets in here: only a preference. */
export interface OsSettings {
	enabled: boolean;
	minSeverity: MinSeverity;
}

export function loadOsSettings(): OsSettings {
	try {
		const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<OsSettings>;
		const min = raw.minSeverity;
		return {
			enabled: raw.enabled === true,
			minSeverity: min === 'info' || min === 'error' ? min : 'warning'
		};
	} catch {
		return { enabled: false, minSeverity: 'warning' };
	}
}

export function saveOsSettings(s: OsSettings) {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** Asks the system for permission, and reports whether it was given. */
export async function requestOsPermission(): Promise<boolean> {
	if (isDesktop()) {
		const n = await import('@tauri-apps/plugin-notification');
		return (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted';
	}
	if (typeof Notification === 'undefined') return false;
	return (await Notification.requestPermission()) === 'granted';
}

/** Shows one notification. The title and body are only ever plain text. */
export async function showOsNotification(e: FleetEvent) {
	const title = e.fleet ? `${e.fleet}: ${e.title}` : e.title;
	// Only the first line: messages can hold a container's log lines.
	const body = (e.message ?? '').split('\n', 1)[0] ?? '';
	if (isDesktop()) {
		const n = await import('@tauri-apps/plugin-notification');
		n.sendNotification({ title, body });
		return;
	}
	if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
		new Notification(title, { body, tag: `nepfleet-${e.id}` });
	}
}
