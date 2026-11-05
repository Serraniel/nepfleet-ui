// SPDX-License-Identifier: AGPL-3.0-or-later
export type Toast = { id: number; message: string; kind: 'info' | 'success' | 'error' };

class Toasts {
	list = $state<Toast[]>([]);
	#next = 1;

	/** Shows a message; errors stay until dismissed, others for `ms`. */
	push(message: string, kind: Toast['kind'] = 'info', ms = 5000) {
		const id = this.#next++;
		this.list.push({ id, message, kind });
		if (kind !== 'error') setTimeout(() => this.dismiss(id), ms);
		return id;
	}

	dismiss(id: number) {
		this.list = this.list.filter((t) => t.id !== id);
	}
}

export const toasts = new Toasts();
