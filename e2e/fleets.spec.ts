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
	const rollbacks: boolean[] = [];
	const inputsSaved: Record<string, string>[] = [];
	await page.route(DAEMON + '/**', async (route: Route) => {
		const req = route.request();
		const cors = {
			'Access-Control-Allow-Origin': new URL(page.url()).origin,
			'Access-Control-Allow-Headers': 'Authorization, Content-Type',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE'
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
		if (path === '/v1/remotes/nas/api/v1/stacks/photos/inputs' && req.method() === 'GET')
			return json(200, {
				inputs: [
					{
						name: 'DOMAIN',
						type: 'hostname',
						title: 'Domain',
						required: true,
						set: true,
						value: 'photos.example.test'
					},
					{
						name: 'ADMIN_EMAIL',
						type: 'email',
						title: 'Admin e-mail',
						required: true,
						missing: !inputsSaved.length
					},
					{
						name: 'ADMIN_PASSWORD',
						type: 'secret',
						title: 'Admin password',
						required: true,
						secret: true,
						missing: !inputsSaved.length,
						set: inputsSaved.length > 0
					}
				]
			});
		if (path === '/v1/remotes/nas/api/v1/stacks/photos/inputs' && req.method() === 'PUT') {
			inputsSaved.push((req.postDataJSON() as { values: Record<string, string> }).values);
			return json(200, { commit: 'c'.repeat(40) });
		}
		if (path === '/v1/remotes/nas/api/v1/stacks/photos/plan')
			return json(200, { id: 'p', stack: 'photos', mode: 'compose', first: false, changes: null });
		if (path === '/v1/remotes/nas/api/v1/stacks/photos/history')
			return json(200, [
				{
					commit: 'a'.repeat(40),
					date: '2026-11-07T10:00:00Z',
					author: 'A',
					subject: 'now',
					applied: true
				},
				{ commit: 'b'.repeat(40), date: '2026-11-06T10:00:00Z', author: 'A', subject: 'before' }
			]);
		if (path === '/v1/remotes/nas/api/v1/stacks/photos/rollback') {
			const confirmed = (req.postDataJSON() as { confirmDestructive: boolean }).confirmDestructive;
			rollbacks.push(confirmed);
			return json(202, {
				id: confirmed ? 'good' : 'refused',
				stack: 'photos',
				kind: 'rollback',
				state: confirmed ? 'succeeded' : 'failed',
				error: confirmed ? undefined : 'the plan has destructive changes; confirm them to apply',
				log: 'rolling back\n',
				by: 'ci'
			});
		}
		return json(404, { error: 'not here' });
	});
	return Object.assign(seen, { rollbacks, inputsSaved });
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

test('rolling back: refused while destructive, then only with the name typed', async ({ page }) => {
	const mock = await mockDaemon(page);
	await page.goto('/fleets');
	await page.getByLabel('Daemon address').fill(DAEMON);
	await page.getByLabel('Token').fill(TOKEN);
	await page.getByRole('button', { name: 'Connect' }).click();
	await page.getByLabel('SSH address').fill('ssh://me@nas');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('button', { name: 'Connect' }).click();
	await page.getByRole('link', { name: 'Stacks', exact: true }).first().click();
	await page.getByRole('link', { name: 'photos' }).click();

	// The running version has no button, the older one does.
	await expect(page.getByText('running', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Roll back to bbbbbbb' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Volume data is not rolled back');
	await dialog.getByRole('button', { name: 'Roll back', exact: true }).click();
	await expect(
		page.getByText('Nothing changed. The old version would remove things.')
	).toBeVisible();
	expect(mock.rollbacks).toEqual([false]);

	await page.getByRole('button', { name: 'Review and roll back anyway…' }).click();
	const confirm = dialog.getByRole('button', { name: 'Roll back', exact: true });
	await expect(confirm).toBeDisabled();
	await dialog.getByLabel('Type the stack name to confirm').fill('photos');
	await confirm.click();
	await expect(page.getByText('Rolled back.', { exact: true })).toBeVisible();
	expect(mock.rollbacks).toEqual([false, true]);
});

test('a setup that needed a key unlocked plans the same kind again', async ({ page }) => {
	const kinds: string[] = [];
	let unlocked = false;
	await page.route(DAEMON + '/**', async (route: Route) => {
		const req = route.request();
		const cors = {
			'Access-Control-Allow-Origin': new URL(page.url()).origin,
			'Access-Control-Allow-Headers': 'Authorization, Content-Type',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE'
		};
		if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
		const url = new URL(req.url());
		const json = (status: number, body: unknown) =>
			route.fulfill({
				status,
				headers: cors,
				contentType: 'application/json',
				body: JSON.stringify(body)
			});
		if (url.pathname === '/v1/info')
			return json(200, { version: 'edge', commit: 'abc1234', pid: 1 });
		if (url.pathname === '/v1/events') return json(200, { events: [], unread: 0, seen: 0 });
		if (url.pathname === '/v1/remotes')
			return json(200, [
				{
					name: 'vps',
					address: 'ssh://me@vps',
					tunnel: 'off',
					report: {
						kernel: 'Linux',
						os: 'Arch Linux',
						arch: 'x86_64',
						docker: true,
						dockerRunning: true,
						compose: true,
						nepfleetRunning: true,
						nepfleetImage: 'ghcr.io/serraniel/nepfleet:edge@sha256:' + 'a'.repeat(64)
					}
				}
			]);
		if (url.pathname === '/v1/keys/unlock') {
			unlocked = true;
			return route.fulfill({ status: 204, headers: cors });
		}
		if (url.pathname === '/v1/remotes/vps/setup' && req.method() === 'GET') {
			const kind = url.searchParams.get('kind') ?? '';
			kinds.push(kind);
			if (!unlocked)
				return json(502, {
					error: 'SSH refused the login, and your key has a passphrase',
					lockedKeys: ['/home/me/.ssh/id_rsa']
				});
			return json(200, {
				kind,
				id: 'plan-1',
				steps: [{ text: 'keep the current compose.yaml', root: false }]
			});
		}
		return json(404, { error: 'not here' });
	});
	await page.addInitScript(
		([u, t]) => {
			(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
				invoke: async (cmd: string) => {
					if (cmd === 'control_start') return { url: u, token: t };
					if (cmd === 'nepfleet_version') return 'nepfleet edge (abc1234)';
					throw new Error('unexpected command ' + cmd);
				}
			};
		},
		[DAEMON, TOKEN]
	);
	await page.goto('/fleets');
	await page.getByRole('button', { name: 'Update NepFleet to edge…' }).click();
	await page.getByLabel('Passphrase').fill('secret');
	await page.getByRole('button', { name: 'Unlock' }).click();

	const dialog = page.getByRole('dialog', { name: 'Update NepFleet on vps' });
	await expect(dialog).toContainText('keep the current compose.yaml');
	expect(kinds).toEqual(['update', 'update']);
});

test('a stack that waits for values asks for them, and saves them in one go', async ({ page }) => {
	const mock = await mockDaemon(page);
	await page.goto('/fleets');
	await page.getByLabel('Daemon address').fill(DAEMON);
	await page.getByLabel('Token').fill(TOKEN);
	await page.getByRole('button', { name: 'Connect' }).click();
	await page.getByLabel('SSH address').fill('ssh://me@nas');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('button', { name: 'Connect' }).click();
	await page.getByRole('link', { name: 'Stacks', exact: true }).first().click();
	await page.getByRole('link', { name: 'photos' }).click();

	await expect(page.getByRole('heading', { name: 'Needs values' })).toBeVisible();
	const save = page.getByRole('button', { name: 'Save' });
	await expect(save).toBeDisabled();
	await page.getByLabel(/Admin e-mail/).fill('admin@example.test');
	await page.getByLabel(/Admin password/).fill('long-enough-1');
	await save.click();
	await expect(page.getByText(/Saved ADMIN_EMAIL, ADMIN_PASSWORD in ccccccc/)).toBeVisible();
	expect(mock.inputsSaved).toEqual([
		{ ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD: 'long-enough-1' }
	]);
	// Nothing is missing any more: the section is plain settings again.
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	await expect(page.getByText('Change settings (3)')).toBeVisible();
});
