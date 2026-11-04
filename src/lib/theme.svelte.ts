// SPDX-License-Identifier: AGPL-3.0-or-later
import { KEY, parsePreference, resolve, type Preference, type Theme } from './theme.ts';

export type { Preference, Theme };

function stored(): string | null {
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null; // storage disabled: follow the system
	}
}

class ThemeState {
	#media = matchMedia('(prefers-color-scheme: dark)');
	#systemDark = $state(this.#media.matches);
	preference = $state<Preference>(parsePreference(stored()));
	current = $derived<Theme>(resolve(this.preference, this.#systemDark));

	constructor() {
		// Follow the system live, e.g. when it switches to dark at night.
		this.#media.addEventListener('change', (e) => {
			this.#systemDark = e.matches;
			this.#apply();
		});
	}

	set(pref: Preference) {
		this.preference = pref;
		try {
			if (pref === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, pref);
		} catch {
			// not persisted, still applied
		}
		this.#apply();
	}

	#apply() {
		document.documentElement.dataset.theme = this.current;
	}
}

export const theme = new ThemeState();
