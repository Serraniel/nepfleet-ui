// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Route } from '@playwright/test';

// A stand-in backend, on a port nothing listens on, with a person signed in.
const BACKEND = 'http://127.0.0.1:17997';

test('mail settings: saved with a write-only password, then a test mail', async ({ page }) => {
	await page.addInitScript((url) => {
		localStorage.setItem('nepfleet-backends', JSON.stringify([{ id: 'b1', url }]));
		sessionStorage.setItem('nepfleet-token-b1', 'session');
	}, BACKEND);
	const saved: Record<string, unknown>[] = [];
	const tests: string[] = [];
	let mail = {
		configured: false,
		host: '',
		port: 0,
		user: '',
		from: '',
		tls: '',
		passwordSet: false
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
		if (path === '/api/v1/events') return json([]);
		if (path === '/api/v1/notifications/channels') return json({ channels: [] });
		if (path === '/api/v1/mail' && req.method() === 'GET') return json(mail);
		if (path === '/api/v1/mail' && req.method() === 'PUT') {
			const m = req.postDataJSON() as Record<string, unknown>;
			saved.push(m);
			mail = {
				configured: true,
				host: String(m.host),
				port: Number(m.port ?? (m.tls === 'tls' ? 465 : 587)),
				user: String(m.user ?? ''),
				from: String(m.from ?? ''),
				tls: String(m.tls ?? 'starttls'),
				passwordSet: m.password === undefined ? mail.passwordSet : m.password !== ''
			};
			return json({ commit: 'c'.repeat(40) });
		}
		if (path === '/api/v1/mail/test' && req.method() === 'POST') {
			const to = (req.postDataJSON() as { to: string }).to;
			tests.push(to);
			if (to === 'fail@example.test')
				return route.fulfill({
					status: 502,
					headers: cors,
					body: 'sending failed: logging in as fleet@example.test: 535 authentication failed'
				});
			return route.fulfill({ status: 204, headers: cors });
		}
		return route.fulfill({ status: 404, headers: cors, body: 'not here' });
	});

	await page.goto('/notifications');
	const form = page.getByRole('form', { name: /Mail settings of/ });
	await expect(form).toBeVisible();
	// Nothing to test before the settings exist.
	await expect(page.getByRole('button', { name: 'Send test mail' })).toHaveCount(0);

	await form.getByLabel('SMTP server').fill('smtp.example.test');
	await form.getByLabel('Encryption').selectOption('tls');
	await expect(form.getByLabel('Port')).toHaveAttribute('placeholder', '465');
	await form.getByLabel('User').fill('fleet@example.test');
	await form.getByLabel('Password', { exact: true }).fill('s3cret-pw');
	await form.getByLabel('From').fill('NepFleet <fleet@example.test>');
	await form.getByRole('button', { name: 'Save mail settings' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved in ccccccc' })).toBeVisible();
	expect(saved[0]).toEqual({
		host: 'smtp.example.test',
		tls: 'tls',
		user: 'fleet@example.test',
		from: 'NepFleet <fleet@example.test>',
		password: 's3cret-pw'
	});

	// The password is never shown again; saving without one keeps it.
	await expect(form.getByLabel('Password', { exact: true })).toHaveValue('');
	await expect(form.getByText('Stored. Leave empty to keep it.')).toBeVisible();
	await form.getByLabel('Port').fill('2465');
	await form.getByRole('button', { name: 'Save mail settings' }).click();
	await expect.poll(() => saved.length).toBe(2);
	expect(saved[1]).not.toHaveProperty('password');
	expect(saved[1]).toMatchObject({ port: 2465 });

	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

	// A test mail, then one the server refuses, with its reason.
	const testForm = page.getByRole('form', { name: /Send a test mail from/ });
	await testForm.getByLabel('Send a test mail to').fill('me@example.test');
	await testForm.getByRole('button', { name: 'Send test mail' }).click();
	await expect(
		page.getByRole('status').filter({ hasText: 'Sent. Check that it arrived.' })
	).toBeVisible();
	await testForm.getByLabel('Send a test mail to').fill('fail@example.test');
	await testForm.getByRole('button', { name: 'Send test mail' }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: '535 authentication failed' })
	).toBeVisible();
	expect(tests).toEqual(['me@example.test', 'fail@example.test']);
});
