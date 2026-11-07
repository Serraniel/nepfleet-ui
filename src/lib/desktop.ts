// SPDX-License-Identifier: AGPL-3.0-or-later

/** Whether this page runs inside the desktop app. */
export function isDesktop(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Starts the control daemon through the desktop app and says how to reach it. */
export async function startDaemon(): Promise<{ url: string; token: string }> {
	const { invoke } = await import('@tauri-apps/api/core');
	return invoke('control_start');
}
