// SPDX-License-Identifier: AGPL-3.0-or-later
export type Theme = 'light' | 'dark';
export type Preference = Theme | 'system';

export const KEY = 'nepfleet-theme';
export const preferences: readonly Preference[] = ['system', 'light', 'dark'];

/** Reads a stored preference; anything unknown means "follow the system". */
export function parsePreference(stored: string | null | undefined): Preference {
	return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** The theme to show for a preference. */
export function resolve(pref: Preference, systemDark: boolean): Theme {
	if (pref === 'system') return systemDark ? 'dark' : 'light';
	return pref;
}
