// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Backend, Status } from './backend.ts';
import type { FleetEvent } from './notifications.ts';

/** Where the last pick is kept, per viewer. '' or nothing means all fleets. */
export const KEY = 'nepfleet-fleet';
/** The URL parameter that names the fleet, so a link opens the same view. */
export const PARAM = 'fleet';

/**
 * The fleet in effect: the pick, while that backend exists and there is more
 * than one. Otherwise all ('').
 * A pick for a backend that isn't there yet (a remote the daemon connects a
 * moment later) is kept, and applies once it arrives.
 */
export function effective(pick: string, list: readonly Backend[]): string {
	if (!pick || list.length < 2) return '';
	return list.some((b) => b.id === pick) ? pick : '';
}

/** The backends a page shows for a fleet: one, or all of them. */
export function backendsIn(list: Backend[], fleet: string): Backend[] {
	return fleet ? list.filter((b) => b.id === fleet) : list;
}

/** A path with the fleet in its query, so moving between pages keeps it. */
export function withFleet(path: string, fleet: string): string {
	return fleet ? `${path}?${PARAM}=${encodeURIComponent(fleet)}` : path;
}

/** The name the picker shows: the label, the backend's own name, or its host. */
export function fleetName(b: Backend, status?: Status): string {
	if (b.label) return b.label;
	if (status?.state === 'online') return status.info.name;
	try {
		return new URL(b.url).host;
	} catch {
		return b.url;
	}
}

/**
 * Whether a daemon event is about a fleet. The daemon names its remotes, and
 * each one is the backend 'local:<name>'; anything else has no daemon events.
 */
export function eventInFleet(e: FleetEvent, fleet: string): boolean {
	return !fleet || (!!e.fleet && 'local:' + e.fleet === fleet);
}

/** Unread daemon events of one fleet. */
export function unreadIn(events: readonly FleetEvent[], seen: number, fleet: string): number {
	return events.filter((e) => e.id > seen && eventInFleet(e, fleet)).length;
}
