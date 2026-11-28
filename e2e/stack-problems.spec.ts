// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// A stand-in backend, on a port nothing listens on, with a person signed in.
// Stack sure's template asks for ADMIN_EMAIL, which has no value; web is fine
// and has no problems field at all, as from a server before this.
const BACKEND = 'http://127.0.0.1:17992';

async function serve(page: Page) {
	await page.addInitScript((url) => {
		localStorage.setItem('nepfleet-backends', JSON.stringify([{ id: 'b1', url }]));
		sessionStorage.setItem('nepfleet-token-b1', 'session');
	}, BACKEND);
	const saved: Record<string, string>[] = [];
	await page.route(BACKEND + '/**', async (route: Route) => {
		const req = route.request();
		const cors = {
			'Access-Control-Allow-Origin': new URL(page.url()).origin,
			'Access-Control-Allow-Credentials': 'true',
			'Access-Control-Allow-Headers': 'Content-Type, Accept',
			'Access-Control-Allow-Methods': 'GET, POST, PUT'
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
		const stack = (name: string) => ({
			name,
			target: 'local',
			mode: 'compose',
			apply: 'auto',
			updates: 'patch',
			state: 'running',
			template: 'official/' + name + '@1.0.0'
		});
		if (path === '/api/v1/info') return json({ name: 'vps', version: '1', apiVersion: 'v1' });
		if (path === '/api/v1/auth/status') return json({ signedIn: true, name: 'admin' });
		if (path === '/api/v1/stacks')
			return json([
				{
					...stack('sure'),
					...(saved.length
						? {}
						: {
								problems: [
									{
										kind: 'missing-input',
										message: 'Required inputs without a value: Admin e-mail (ADMIN_EMAIL)',
										inputs: [{ name: 'ADMIN_EMAIL', title: 'Admin e-mail' }]
									}
								]
							})
				},
				stack('web')
			]);
		if (path === '/api/v1/stacks/sure/inputs' && req.method() === 'GET')
			return json({
				inputs: [
					{
						name: 'DOMAIN',
						type: 'hostname',
						title: 'Domain',
						required: true,
						set: true,
						value: 'sure.example.test'
					},
					{
						name: 'ADMIN_EMAIL',
						type: 'email',
						title: 'Admin e-mail',
						required: true,
						missing: !saved.length,
						set: saved.length > 0,
						value: saved[0]?.ADMIN_EMAIL
					}
				]
			});
		if (path === '/api/v1/stacks/sure/inputs' && req.method() === 'PUT') {
			saved.push((req.postDataJSON() as { values: Record<string, string> }).values);
			return json({ commit: 'c'.repeat(40) });
		}
		if (path === '/api/v1/stacks/sure/plan')
			return saved.length
				? json({ id: 'p', stack: 'sure', mode: 'compose', first: false, changes: null })
				: json({ error: 'ADMIN_EMAIL is required' }, 422);
		if (path === '/api/v1/stacks/sure/history') return json([]);
		return json({ error: 'not here' }, 404);
	});
	return saved;
}

test('a stack that misses a required input says so, from the list to its settings', async ({
	page
}) => {
	const saved = await serve(page);
	await page.goto('/stacks');
	const rows = page.getByRole('row');
	await expect(rows.filter({ hasText: 'sure' })).toContainText('Missing: Admin e-mail');
	await expect(rows.filter({ hasText: 'web' })).not.toContainText('Missing');
	await expect(page.getByText('2 stacks · 1 needs attention')).toBeVisible();
	await expect(
		page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name: 'Stacks, 1 needs attention' })
	).toBeVisible();

	await page.locator('#fs').selectOption('attention');
	await expect(rows.filter({ hasText: 'sure' })).toBeVisible();
	await expect(rows.filter({ hasText: 'web' })).toHaveCount(0);

	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

	await page.getByRole('link', { name: 'sure' }).click();
	const notice = page.getByRole('region', { name: 'Needs attention' });
	await expect(notice).toContainText('Missing: Admin e-mail');
	await notice.getByRole('button', { name: 'Fill in Admin e-mail' }).click();
	const field = page.getByRole('textbox', { name: /Admin e-mail/ });
	await expect(field).toBeFocused();
	await expect(field).toHaveAttribute('required', '');

	await field.fill('admin@example.test');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(notice).toHaveCount(0);
	expect(saved).toEqual([{ ADMIN_EMAIL: 'admin@example.test' }]);
});
