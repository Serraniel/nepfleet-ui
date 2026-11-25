// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ChannelDelivery, NotifyRoute, StackInfo } from './backend.ts';
import { ago } from './hostupdates-cache.ts';

/** Whether a stack runs the ntfy template (its template is source/name@version). */
export function isNtfyStack(s: StackInfo): boolean {
	return /(^|\/)ntfy(@|$)/.test(s.template ?? '');
}

/** What ntfy accepts as a topic. */
export const NTFY_TOPIC = /^[-_A-Za-z0-9]{1,64}$/;

/**
 * The shoutrrr URL for a topic on an ntfy server. An access token goes in
 * as the password with an empty user, which ntfy accepts; plain http needs
 * shoutrrr's scheme parameter, as it defaults to https.
 */
export function ntfyUrl(server: string, topic: string, token = ''): string {
	const raw = server.trim();
	const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
	if (u.protocol !== 'https:' && u.protocol !== 'http:')
		throw new Error('The server is an http or https address.');
	if (!NTFY_TOPIC.test(topic)) throw new Error('A topic is 1 to 64 letters, digits, - or _.');
	const path = u.pathname.replace(/\/+$/, '');
	const auth = token.trim() ? `:${encodeURIComponent(token.trim())}@` : '';
	const scheme = u.protocol === 'http:' ? '?scheme=http' : '';
	return `ntfy://${auth}${u.host}${path}/${topic}${scheme}`;
}

/** A topic hard to guess, for a public server where anyone may subscribe to a known one. */
export function randomTopic(prefix = 'nepfleet'): string {
	const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return `${prefix}-${Array.from(bytes, (b) => abc[b % abc.length]).join('')}`;
}

export interface RoutePreset {
	id: string;
	title: string;
	what: string;
	route: Omit<NotifyRoute, 'channels'>;
}

export const PRESETS: RoutePreset[] = [
	{
		id: 'problems',
		title: 'Problems only',
		what: 'Failed and rolled-back applies, container and host trouble, failed backups, security findings and alerts from other tools; warnings and errors.',
		route: {
			events: [
				'apply.failed',
				'apply.rolled_back',
				'container.*',
				'host.*',
				'backup.failed',
				'security.*',
				'egress.denied',
				'alert.*'
			],
			stacks: [],
			minSeverity: 'warning'
		}
	},
	{
		id: 'warnings',
		title: 'Warnings and errors',
		what: 'Every event at warning or above, including pending applies.',
		route: { events: [], stacks: [], minSeverity: 'warning' }
	},
	{
		id: 'everything',
		title: 'Everything',
		what: 'Every event, also successful applies and available updates.',
		route: { events: [], stacks: [] }
	}
];

/**
 * The routes with one channel's sending replaced by a preset: the channel
 * leaves every route (those left without channels go), and gets one route
 * of its own. Other channels keep their routes.
 */
export function applyPreset(
	routes: NotifyRoute[],
	channel: string,
	preset: RoutePreset
): NotifyRoute[] {
	const kept = routes
		.map((r) => ({ ...r, channels: r.channels.filter((c) => c !== channel) }))
		.filter((r) => r.channels.length > 0);
	return [
		...kept,
		{
			channels: [channel],
			events: [...preset.route.events],
			stacks: [...preset.route.stacks],
			...(preset.route.minSeverity ? { minSeverity: preset.route.minSeverity } : {})
		}
	];
}

/**
 * What a channel's last delivery says: "last delivered 5 min ago", or
 * "last attempt failed 2 h ago: <reason>" (with when it last went out, if
 * ever). Undefined: nothing sent yet, or the backend doesn't record it.
 */
export function deliveryText(
	d: ChannelDelivery | undefined,
	now = Date.now()
): { ok: boolean; text: string } | undefined {
	if (!d) return undefined;
	if (d.ok) return { ok: true, text: `last delivered ${ago(d.at, now)}` };
	const before = d.delivered ? ` (last delivered ${ago(d.delivered, now)})` : '';
	const why = d.error ? `: ${d.error}` : '';
	return { ok: false, text: `last attempt failed ${ago(d.at, now)}${before}${why}` };
}
