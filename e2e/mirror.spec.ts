// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page, type Route } from '@playwright/test';

// A stand-in backend, on a port nothing listens on, with a person signed in.
const BACKEND = 'http://127.0.0.1:17997';
const URL_SSH = 'git@git.example.test:me/fleet.git';
const PUB =
	'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleExampleExampleExampleExampleExampl nepfleet-mirror';

type Mirror = {
	id: string;
	url: string;
	auth: string;
	publicKey?: string;
	ok?: string;
	error?: string;
};

async function fakeBackend(page: Page) {
	await page.addInitScript((url) => {
		localStorage.setItem('nepfleet-backends', JSON.stringify([{ id: 'b1', url }]));
		sessionStorage.setItem('nepfleet-token-b1', 'session');
	}, BACKEND);
	const state = {
		mirrors: [] as Mirror[],
		added: [] as unknown[],
		removed: [] as string[],
		keyOnForge: false
	};
	await page.route(BACKEND + '/**', async (route: Route) => {
		const req = route.request();
		const cors = {
			'Access-Control-Allow-Origin': new URL(page.url()).origin,
			'Access-Control-Allow-Credentials': 'true',
			'Access-Control-Allow-Headers': 'Content-Type, Accept',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE'
		};
		if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
		const path = new URL(req.url()).pathname;
		const json = (body: unknown, status = 200) =>
			route.fulfill({
				status,
				headers: cors,
				contentType: 'application/json',
				body: JSON.stringify(body)
			});
		if (path === '/api/v1/info') return json({ name: 'b', version: '1', apiVersion: 'v1' });
		if (path === '/api/v1/sync')
			return json({ enabled: false, remote: false, applied: [], failed: [], pending: [] });
		if (path === '/api/v1/mirror' && req.method() === 'GET') return json(state.mirrors);
		if (path === '/api/v1/mirror' && req.method() === 'POST') {
			state.mirrors = state.mirrors.map((m) =>
				state.keyOnForge
					? { ...m, ok: '2026-11-26T10:00:00Z', error: undefined }
					: {
							...m,
							error:
								'Permission denied (publickey). (is the deploy key added to the forge, with write access?)'
						}
			);
			return json(state.mirrors);
		}
		if (path === '/api/v1/mirror/remotes' && req.method() === 'POST') {
			const body = req.postDataJSON() as { url: string };
			state.added.push(body);
			const m: Mirror = { id: 'a1b2c3d4e5f6', url: body.url, auth: 'deploy-key', publicKey: PUB };
			state.mirrors.push(m);
			return json({ mirror: m, commit: 'abc' }, 201);
		}
		if (path.startsWith('/api/v1/mirror/remotes/') && req.method() === 'DELETE') {
			const id = path.split('/').pop() ?? '';
			state.removed.push(id);
			state.mirrors = state.mirrors.filter((m) => m.id !== id);
			return json({ commit: 'def' });
		}
		if (path === '/api/v1/doctor')
			return json({
				host: 'h',
				stacks: 1,
				checks: [
					state.mirrors.some((m) => m.ok)
						? { name: 'Repository mirror', status: 'ok', detail: URL_SSH }
						: state.mirrors.length
							? {
									name: 'Repository mirror',
									status: 'warn',
									detail: 'not mirrored from this host yet: ' + URL_SSH,
									action: 'mirror'
								}
							: {
									name: 'Repository mirror',
									status: 'warn',
									detail: 'the fleet repository has no second remote',
									fix: 'add a mirror in the app (Sync), or add spec.mirrors to fleet.yaml, then run nepfleet mirror',
									action: 'mirror'
								}
				],
				security: []
			});
		return route.fulfill({ status: 404, headers: cors, body: 'not here' });
	});
	return state;
}

test('Health sets up a mirror from its warning: deploy key, push, status', async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const state = await fakeBackend(page);
	await page.goto('/health');
	const warning = page.getByRole('listitem').filter({ hasText: 'Repository mirror' });
	await expect(warning).toContainText('no second remote');
	await warning.getByRole('button', { name: 'Set up a mirror…' }).click();

	// Credentials in a URL are refused before anything is sent.
	const field = page.getByLabel('Git URL of the mirror');
	await field.fill('https://bot:s3cr3t@git.example.test/fleet.git');
	await expect(page.getByText('No user name or token in the URL')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add mirror' })).toBeDisabled();

	await field.fill(URL_SSH);
	await page.getByRole('button', { name: 'Add mirror' }).click();

	// The deploy key to paste into the forge, with a copy button.
	const fresh = page.getByRole('status').filter({ hasText: 'deploy key with write access' });
	await expect(fresh).toContainText(PUB);
	expect(state.added).toEqual([{ url: URL_SSH }]);
	await fresh.getByRole('button', { name: 'Copy' }).click();
	await expect(fresh.getByRole('button', { name: 'Copied' })).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PUB);

	// Before the forge has the key, the push fails and says why.
	await page.getByRole('button', { name: 'Push now' }).click();
	await expect(page.getByText('is the deploy key added to the forge')).toBeVisible();
	await expect(fresh).toBeVisible();

	// With the key on the forge, it lands; the check clears.
	state.keyOnForge = true;
	await page.getByRole('button', { name: 'Push now' }).click();
	await expect(page.getByText(/last pushed (?!never)/)).toBeVisible();
	await expect(fresh).toHaveCount(0);
	await expect(warning).toHaveClass(/\bok\b/);
	await expect(page.getByRole('button', { name: /Set up a mirror|Mirrors…/ })).toHaveCount(0);
});

test('Sync lists mirrors and removes one', async ({ page }) => {
	const state = await fakeBackend(page);
	state.mirrors = [
		{
			id: 'a1b2c3d4e5f6',
			url: URL_SSH,
			auth: 'deploy-key',
			publicKey: PUB,
			ok: '2026-11-26T10:00:00Z'
		}
	];
	await page.goto('/sync');
	await expect(page.getByRole('heading', { name: 'Repository mirrors' })).toBeVisible();
	await expect(page.getByText(URL_SSH)).toBeVisible();
	await page.getByText('Deploy key', { exact: true }).click();
	await expect(page.getByText(PUB)).toBeVisible();

	await page.getByRole('button', { name: 'Remove', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Remove mirror' }).click();
	await expect(page.getByText('No mirrors')).toBeVisible();
	expect(state.removed).toEqual(['a1b2c3d4e5f6']);
});
