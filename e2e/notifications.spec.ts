// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page, type Route } from '@playwright/test';

// A stand-in backend, on a port nothing listens on, with a person signed in.
const BACKEND = 'http://127.0.0.1:17997';

type Routes = { channels: string[]; events: string[]; stacks: string[]; minSeverity?: string }[];

async function mockBackend(page: Page, stacks: Record<string, unknown>[]) {
	await page.addInitScript((url) => {
		localStorage.setItem('nepfleet-backends', JSON.stringify([{ id: 'b1', url }]));
		sessionStorage.setItem('nepfleet-token-b1', 'session');
	}, BACKEND);
	const seen = {
		channels: [] as string[],
		puts: [] as { name: string; url: string; minSeverity: string }[],
		routes: [{ channels: ['chat'], events: ['apply.*'], stacks: [] }] as Routes,
		tests: [] as string[],
		deliveries: {} as Record<string, { at: string; ok: boolean; delivered?: string }>
	};
	await page.route(BACKEND + '/**', async (route: Route) => {
		const req = route.request();
		const cors = {
			'Access-Control-Allow-Origin': new URL(page.url()).origin,
			'Access-Control-Allow-Credentials': 'true',
			'Access-Control-Allow-Headers': 'Content-Type, Accept',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'
		};
		if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
		const path = new URL(req.url()).pathname;
		const json = (body: unknown) =>
			route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
		if (path === '/api/v1/info') return json({ name: 'b', version: '1', apiVersion: 'v1' });
		if (path === '/api/v1/features') return json([]);
		if (path === '/api/v1/stacks') return json(stacks);
		if (path === '/api/v1/notifications/channels')
			return json({ channels: seen.channels, deliveries: seen.deliveries });
		const ch = /^\/api\/v1\/notifications\/channels\/([^/]+)(\/test)?$/.exec(path);
		if (ch && req.method() === 'PUT') {
			const name = decodeURIComponent(ch[1] ?? '');
			const body = req.postDataJSON() as { url: string; minSeverity: string };
			seen.puts.push({ name, ...body });
			seen.channels.push(name);
			// As the backend does: a route at the chosen severity for a new channel.
			seen.routes.push({ channels: [name], events: [], stacks: [], minSeverity: body.minSeverity });
			return json({ commit: 'abc1234def' });
		}
		if (ch?.[2] && req.method() === 'POST') {
			const name = decodeURIComponent(ch[1] ?? '');
			seen.tests.push(name);
			const at = new Date().toISOString();
			seen.deliveries[name] = { at, ok: true, delivered: at };
			return route.fulfill({ status: 204, headers: cors });
		}
		if (path === '/api/v1/notifications/routes' && req.method() === 'GET')
			return json({ routes: seen.routes });
		if (path === '/api/v1/notifications/routes' && req.method() === 'PUT') {
			seen.routes = (req.postDataJSON() as { routes: Routes }).routes;
			return json({ commit: 'def5678abc' });
		}
		return route.fulfill({ status: 404, headers: cors, body: 'not here' });
	});
	return seen;
}

test('Features leads through an ntfy channel in the fleet, its routes and a test', async ({
	page
}) => {
	const seen = await mockBackend(page, [
		{
			name: 'push',
			target: 'local',
			mode: 'compose',
			apply: 'auto',
			updates: 'minor',
			template: 'official/ntfy@0.2.4',
			url: 'https://ntfy.example.test',
			state: 'running'
		}
	]);

	await page.goto('/features');
	const card = page.getByRole('group', { name: 'Notifications' });
	await expect(card).toContainText('No channels yet');
	await card.getByRole('link', { name: 'Set up notifications…' }).click();
	await expect(page).toHaveURL(/\/notifications\/setup\?backend=b1$/);

	// The running ntfy stack is found and offered with its address.
	await expect(page.getByRole('radio', { name: /ntfy in this fleet: push/ })).toBeChecked();
	await expect(page.getByLabel('Server', { exact: true })).toHaveValue('https://ntfy.example.test');
	await expect(page.getByLabel('Topic', { exact: true })).toHaveValue('nepfleet');
	await page.getByLabel('Access token (optional)').fill('tk_example');
	await page.getByRole('button', { name: 'Add channel' }).click();

	await expect(page.getByRole('heading', { name: 'What should ntfy get?' })).toBeVisible();
	expect(seen.puts).toEqual([
		{ name: 'ntfy', url: 'ntfy://:tk_example@ntfy.example.test/nepfleet', minSeverity: 'warning' }
	]);

	// Problems only replaces the channel's own route; the other channel keeps its own.
	await expect(page.getByRole('radio', { name: /Problems only/ })).toBeChecked();
	await page.getByRole('button', { name: 'Save and continue' }).click();
	await expect(page.getByRole('heading', { name: 'Send a test to ntfy' })).toBeVisible();
	expect(seen.routes).toHaveLength(2);
	expect(seen.routes[0]).toEqual({ channels: ['chat'], events: ['apply.*'], stacks: [] });
	expect(seen.routes[1]).toMatchObject({ channels: ['ntfy'], minSeverity: 'warning' });
	expect(seen.routes[1]?.events).toEqual(
		expect.arrayContaining(['apply.failed', 'container.*', 'backup.failed', 'security.*'])
	);

	await page.getByRole('button', { name: 'Send test' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Sent.' })).toBeVisible();
	expect(seen.tests).toEqual(['ntfy']);

	// The wizard ends on the Notifications page.
	await page.getByRole('link', { name: 'Done: see notifications' }).click();
	await expect(page).toHaveURL(/\/notifications$/);
	// The test is the channel's last delivery.
	await expect(page.getByText('last delivered just now')).toBeVisible();
	await page.goto('/features');
	await expect(card).toContainText('ntfy (last delivered just now)');
});

test('Without an ntfy stack, it offers to create one or use another server', async ({ page }) => {
	await mockBackend(page, [
		{ name: 'web', target: 'local', mode: 'compose', apply: 'auto', updates: 'patch' }
	]);

	await page.goto('/notifications/setup?backend=b1');
	await expect(page.getByRole('radio', { name: /An ntfy server elsewhere/ })).toBeChecked();
	await expect(page.getByLabel('Server', { exact: true })).toHaveValue('https://ntfy.sh');
	// A public server: a topic nobody guesses.
	await expect(page.getByLabel('Topic', { exact: true })).toHaveValue(/^nepfleet-[a-z0-9]{12}$/);

	await page.getByRole('radio', { name: /Run ntfy in this fleet/ }).check();
	await expect(page.getByRole('link', { name: 'Create an ntfy stack…' })).toHaveAttribute(
		'href',
		'/templates?backend=b1&template=ntfy'
	);

	// Other providers: the usual channel form.
	await page.getByRole('radio', { name: /Another service/ }).check();
	await expect(page.getByRole('form', { name: /Add a channel to/ })).toBeVisible();
});
