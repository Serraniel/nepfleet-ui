// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const DAEMON = 'http://127.0.0.1:17999';
const TOKEN = 'nfc_' + 'a'.repeat(43);

/** A stand-in for the control daemon, on a port nothing listens on. */
async function mockDaemon(page: Page, events: { id: number; [k: string]: unknown }[] = []) {
	const remotes: Record<string, unknown>[] = [];
	const seen: string[] = [];
	let seenId = 0;
	await page.route(DAEMON + '/**', async (route: Route) => {
		const req = route.request();
		const cors = {
			'Access-Control-Allow-Origin': new URL(page.url()).origin,
			'Access-Control-Allow-Headers': 'Authorization, Content-Type',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE'
		};
		if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
		const path = new URL(req.url()).pathname;
		seen.push(`${req.method()} ${path} ${req.headers()['authorization'] ?? ''}`);
		const json = (status: number, body: unknown) =>
			route.fulfill({
				status,
				headers: cors,
				contentType: 'application/json',
				body: JSON.stringify(body)
			});
		if (req.headers()['authorization'] !== `Bearer ${TOKEN}`)
			return json(401, { error: 'unauthorized' });
		if (path === '/v1/remotes' && req.method() === 'GET') return json(200, remotes);
		if (path === '/v1/remotes' && req.method() === 'POST') {
			const r = {
				name: 'nas',
				address: 'ssh://me@nas',
				tunnel: 'off',
				next: 'A NepFleet is here: connect to it.',
				report: {
					os: 'Arch Linux',
					arch: 'x86_64',
					docker: true,
					dockerRunning: true,
					dockerVersion: '29',
					containers: 3,
					nepfleetRunning: true
				}
			};
			remotes.push(r);
			return json(201, r);
		}
		if (path === '/v1/remotes/nas/connect') {
			Object.assign(remotes[0] ?? {}, { tunnel: 'up', connect: true });
			return json(200, remotes[0]);
		}
		if (path === '/v1/remotes/nas/api/v1/info')
			return json(200, { name: 'nas-server', version: '1', apiVersion: 'v1' });
		if (path === '/v1/remotes/nas/api/v1/stacks')
			return json(200, [
				{ name: 'photos', target: 'local', mode: 'compose', apply: 'auto', updates: 'patch' }
			]);
		if (path === '/v1/events')
			return json(200, {
				events: events.filter((e) => e.id > Number(new URL(req.url()).searchParams.get('after'))),
				unread: events.filter((e) => e.id > seenId).length,
				seen: seenId
			});
		if (path === '/v1/events/seen') {
			seenId = (req.postDataJSON() as { id: number }).id;
			return route.fulfill({ status: 204, headers: cors });
		}
		return json(404, { error: 'not here' });
	});
	return seen;
}

test('adds a machine, connects it, and its stacks show up', async ({ page }) => {
	const seen = await mockDaemon(page);
	await page.goto('/fleets');
	await expect(page.getByRole('heading', { name: 'Fleets', exact: true })).toBeVisible();

	await page.getByLabel('Daemon address').fill(DAEMON);
	await page.getByLabel('Token').fill('not-a-token');
	await page.getByRole('button', { name: 'Connect' }).click();
	await expect(page.getByText('The token comes from: nepfleet control token')).toBeVisible();

	await page.getByLabel('Token').fill(TOKEN);
	await page.getByRole('button', { name: 'Connect' }).click();
	await expect(page.getByText('No machines yet')).toBeVisible();

	await page.getByLabel('SSH address').fill('ssh://me@nas');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	const card = page.getByRole('listitem').filter({ hasText: 'ssh://me@nas' });
	await expect(card).toContainText('Arch Linux, x86_64');
	await expect(card).toContainText('Not connected');

	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

	await card.getByRole('button', { name: 'Connect' }).click();
	await expect(card).toContainText('Connected');

	// A client-side move keeps the token, which lives in memory.
	await page.getByRole('link', { name: 'Stacks', exact: true }).first().click();
	await expect(page.getByRole('link', { name: 'photos' })).toBeVisible();
	expect(seen).toContain(`GET /v1/remotes/nas/api/v1/stacks Bearer ${TOKEN}`);
	// The token was never put where it outlives the tab.
	expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('nfc_');
});

test('in the desktop app it connects by itself', async ({ page }) => {
	await mockDaemon(page);
	await page.addInitScript(
		([url, token]) => {
			(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
				invoke: async (cmd: string) => {
					if (cmd !== 'control_start') throw new Error('unexpected command ' + cmd);
					return { url, token };
				}
			};
		},
		[DAEMON, TOKEN]
	);
	await page.goto('/fleets');
	await expect(page.getByText('No machines yet')).toBeVisible();
	await expect(page.getByLabel('Token')).toHaveCount(0);
});

test('the desktop app says when nepfleet is missing', async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke: () => Promise.reject('The nepfleet command was not found. Install NepFleet first.')
		};
	});
	await page.goto('/fleets');
	await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
	await expect(page.getByText('The nepfleet command was not found')).toBeVisible();
});

test('notifications: unread count, list, read, and system notifications only when asked', async ({
	page,
	context
}) => {
	await context.grantPermissions(['notifications']);
	await page.addInitScript(() => {
		const shown: string[] = [];
		(window as unknown as Record<string, unknown>).shownNotifications = shown;
		class Fake {
			static permission = 'granted';
			static requestPermission = async () => 'granted';
			constructor(title: string) {
				shown.push(title);
			}
		}
		(window as unknown as Record<string, unknown>).Notification = Fake;
	});
	const events: { id: number; [k: string]: unknown }[] = [
		{
			id: 1,
			time: '2026-11-07T10:00:00Z',
			name: 'apply.failed',
			severity: 'error',
			fleet: 'nas',
			stack: 'web',
			title: 'applying web failed',
			message: 'compose failed\n<img src=x onerror=alert(1)>'
		}
	];
	await mockDaemon(page, events);
	await page.goto('/fleets');
	await page.getByLabel('Daemon address').fill(DAEMON);
	await page.getByLabel('Token').fill(TOKEN);
	await page.getByRole('button', { name: 'Connect' }).click();
	const link = page.getByRole('link', { name: 'Notifications, 1 unread' });
	await expect(link).toBeVisible();
	await link.click();

	// Text from a fleet stays text, and links go to the stack.
	const title = page.getByRole('link', { name: 'applying web failed' });
	await expect(title).toHaveAttribute('href', '/stacks/local%3Anas/web');
	await page.getByText('Details').click();
	await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
	await expect(page.locator('main img, li img')).toHaveCount(0);

	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

	await page.getByRole('button', { name: 'Mark all read' }).click();
	await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();

	// Off by default: a new event shows up, but nothing pops up.
	events.push({
		id: 2,
		time: '2026-11-07T10:01:00Z',
		name: 'container.oom',
		severity: 'error',
		fleet: 'nas',
		title: 'first'
	});
	await expect(page.getByText('first')).toBeVisible({ timeout: 10000 });
	expect(
		await page.evaluate(
			() => (window as unknown as { shownNotifications: string[] }).shownNotifications
		)
	).toEqual([]);

	// Asked for: errors pop up, below the chosen severity they don't.
	await page.getByLabel('Show system notifications on this device').check();
	events.push({
		id: 3,
		time: '2026-11-07T10:02:00Z',
		name: 'x',
		severity: 'info',
		fleet: 'nas',
		title: 'quiet'
	});
	events.push({
		id: 4,
		time: '2026-11-07T10:02:01Z',
		name: 'y',
		severity: 'error',
		fleet: 'nas',
		title: 'loud'
	});
	await expect(page.getByText('loud')).toBeVisible({ timeout: 10000 });
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as { shownNotifications: string[] }).shownNotifications
			)
		)
		.toEqual(['nas: loud']);
});
