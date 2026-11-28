// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// Two stand-in backends, on ports nothing listens on, each with a person signed in.
const FLEETS = [
	{ id: 'b1', url: 'http://127.0.0.1:17994', name: 'vps' },
	{ id: 'b2', url: 'http://127.0.0.1:17993', name: 'home' }
];

async function serve(page: Page, fleets = FLEETS) {
	await page.addInitScript((list) => {
		localStorage.setItem(
			'nepfleet-backends',
			JSON.stringify(list.map(({ id, url }) => ({ id, url })))
		);
		for (const b of list) sessionStorage.setItem('nepfleet-token-' + b.id, 'session');
	}, fleets);
	for (const f of fleets) {
		await page.route(f.url + '/**', async (route: Route) => {
			const req = route.request();
			const cors = {
				'Access-Control-Allow-Origin': new URL(page.url()).origin,
				'Access-Control-Allow-Credentials': 'true',
				'Access-Control-Allow-Headers': 'Content-Type, Accept',
				'Access-Control-Allow-Methods': 'GET, POST'
			};
			if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
			const path = new URL(req.url()).pathname;
			const json = (body: unknown) =>
				route.fulfill({
					headers: cors,
					contentType: 'application/json',
					body: JSON.stringify(body)
				});
			if (path === '/api/v1/info') return json({ name: f.name, version: '1', apiVersion: 'v1' });
			if (path === '/api/v1/auth/status') return json({ signedIn: true, name: 'admin' });
			if (path === '/api/v1/stacks')
				return json([
					{
						name: 'web-' + f.name,
						target: 'local',
						mode: 'compose',
						apply: 'auto',
						updates: 'patch'
					}
				]);
			return route.fulfill({ status: 404, headers: cors, body: 'not here' });
		});
	}
}

const picker = (page: Page) => page.getByRole('combobox', { name: 'Fleet', exact: true });
const main = (page: Page) => page.getByRole('main');

test('the fleet picker narrows the pages to one fleet and keeps it', async ({ page }) => {
	await serve(page);
	await page.goto('/stacks');
	await expect(picker(page)).toHaveValue('');
	await expect(main(page)).toContainText('web-vps');
	await expect(main(page)).toContainText('web-home');

	await picker(page).selectOption('b2');
	await expect(page).toHaveURL(/[?&]fleet=b2/);
	await expect(main(page)).toContainText('web-home');
	await expect(main(page)).not.toContainText('web-vps');

	// The other pages follow, and their links keep the fleet in the address.
	await page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Health' })
		.click();
	await expect(page).toHaveURL(/\/health\?fleet=b2/);

	// Remembered for this viewer, also without the parameter.
	await page.goto('/stacks');
	await expect(picker(page)).toHaveValue('b2');
	await expect(main(page)).not.toContainText('web-vps');

	// A link names its fleet, and wins over the remembered one.
	await page.goto('/stacks?fleet=b1');
	await expect(picker(page)).toHaveValue('b1');
	await expect(main(page)).toContainText('web-vps');
	await expect(main(page)).not.toContainText('web-home');

	await picker(page).selectOption('');
	await expect(page).not.toHaveURL(/fleet=/);
	await expect(main(page)).toContainText('web-vps');
	await expect(main(page)).toContainText('web-home');

	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
});

test('the fleet picker hides with one backend', async ({ page }) => {
	await serve(page, FLEETS.slice(0, 1));
	await page.goto('/stacks?fleet=b2');
	await expect(main(page)).toContainText('web-vps');
	await expect(picker(page)).toHaveCount(0);
});
