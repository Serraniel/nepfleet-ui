// SPDX-License-Identifier: AGPL-3.0-or-later
export type Theme = 'light' | 'dark';

const KEY = 'nepfleet-theme';

class ThemeState {
	current = $state<Theme>((document.documentElement.dataset.theme as Theme) ?? 'light');

	toggle() {
		this.current = this.current === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = this.current;
		localStorage.setItem(KEY, this.current);
	}
}

export const theme = new ThemeState();
