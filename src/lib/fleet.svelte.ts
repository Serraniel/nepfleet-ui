// SPDX-License-Identifier: AGPL-3.0-or-later
import { backends } from './backends.svelte.ts';
import { KEY, backendsIn, effective, unreadIn } from './fleet.ts';
import { local } from './local.svelte.ts';

function stored(): string {
	try {
		return localStorage.getItem(KEY) ?? '';
	} catch {
		return ''; // storage disabled: all fleets, and the pick lasts for this page
	}
}

/** The fleet the multi-backend pages show: one backend, or all. */
class Fleet {
	/** What the viewer picked, '' for all. It may name a backend not connected yet. */
	pick = $state(stored());
	/** The fleet in effect, '' for all. */
	current = $derived(effective(this.pick, backends.list));
	/** The backends the pages list. */
	visible = $derived(backendsIn(backends.list, this.current));

	/** The picker is only worth showing with two or more backends. */
	get choosable() {
		return backends.list.length > 1;
	}

	/** Unread daemon events in this fleet: the Notifications badge. */
	get unread() {
		return this.current ? unreadIn(local.events, local.seen, this.current) : local.unread;
	}

	set(id: string) {
		if (id === this.pick) return;
		this.pick = id;
		try {
			if (id) localStorage.setItem(KEY, id);
			else localStorage.removeItem(KEY);
		} catch {
			// not kept, still applied
		}
	}
}

export const fleet = new Fleet();
