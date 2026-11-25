// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// A stand-in backend, on a port nothing listens on, with a person signed in.
const BACKEND = 'http://127.0.0.1:17997';

type Mode = 'integrated' | 'custom' | 'none';

const wiki = {
	name: 'wiki',
	title: 'Wiki',
	tier: 'app',
	version: '1.0.0',
	supports: { sso: true },
	inputs: [
		{ name: 'DOMAIN', type: 'hostname', required: true },
		{ name: 'OIDC_ISSUER', type: 'url' },
		{ name: 'OIDC_CLIENT_ID', type: 'string' },
		{ name: 'OIDC_CLIENT_SECRET', type: 'secret' },
		{ name: 'OIDC_BUTTON_LABEL', type: 'string' }
	],
	generate: [],
	oidc: { redirect: '/auth/oidc/callback' }
};

async function mockBackend(page: Page, opts: { provider: string; candidates: string[] }) {
	await page.addInitScript((url) => {
		localStorage.setItem('nepfleet-backends', JSON.stringify([{ id: 'b1', url }]));
		sessionStorage.setItem('nepfleet-token-b1', 'session');
	}, BACKEND);
	const seen = {
		provider: opts.provider,
		providerPuts: [] as string[],
		created: [] as Record<string, unknown>[],
		secrets: [] as { key: string; value: string }[],
		stackPuts: [] as Record<string, unknown>[],
		stackMode: (opts.provider ? 'integrated' : 'none') as Mode,
		stackSet: '' as Mode | '',
		secretSet: false
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
		const method = req.method();
		const json = (body: unknown, status = 200) =>
			route.fulfill({
				status,
				headers: cors,
				contentType: 'application/json',
				body: JSON.stringify(body)
			});
		if (path === '/api/v1/info') return json({ name: 'b', version: '1', apiVersion: 'v1' });
		if (path === '/api/v1/events') return json([]);
		if (path === '/api/v1/features') return json([]);
		if (path === '/api/v1/notifications/channels') return json({ channels: [] });
		if (path === '/api/v1/stacks' && method === 'GET')
			return json([
				{ name: 'wiki', target: 'local', mode: 'compose', apply: 'manual', updates: 'minor' }
			]);
		if (path === '/api/v1/templates') return json([{ source: 'official', templates: [wiki] }]);
		if (path === '/api/v1/signon' && method === 'GET')
			return json({
				provider: seen.provider,
				kinds: ['pocket-id'],
				candidates: opts.candidates,
				stacks: [{ name: 'wiki', mode: seen.provider ? 'integrated' : 'none', explicit: false }]
			});
		if (path === '/api/v1/signon' && method === 'PUT') {
			const p = (req.postDataJSON() as { provider: string }).provider;
			seen.providerPuts.push(p);
			seen.provider = p;
			return json({ commit: 'a'.repeat(40) });
		}
		if (path === '/api/v1/stacks' && method === 'POST') {
			seen.created.push(req.postDataJSON() as Record<string, unknown>);
			return json({ name: 'wiki', commit: 'b'.repeat(40) }, 201);
		}
		if (path === '/api/v1/stacks/wiki/signon' && method === 'GET')
			return json({
				supported: true,
				mode: seen.stackMode,
				set: seen.stackSet,
				provider: seen.provider,
				secretSet: seen.secretSet,
				...(seen.stackMode === 'custom'
					? { issuer: 'https://login.example.test', clientID: 'wiki-app' }
					: {})
			});
		if (path === '/api/v1/stacks/wiki/signon' && method === 'PUT') {
			const u = req.postDataJSON() as { mode: Mode | '' };
			seen.stackPuts.push(u);
			seen.stackSet = u.mode;
			seen.stackMode = u.mode || (seen.provider ? 'integrated' : 'none');
			return json({ commit: 'c'.repeat(40) });
		}
		const sec = /^\/api\/v1\/stacks\/wiki\/secrets\/([A-Z_]+)$/.exec(path);
		if (sec && method === 'PUT') {
			seen.secrets.push({
				key: sec[1] ?? '',
				value: (req.postDataJSON() as { value: string }).value
			});
			seen.secretSet = true;
			return json({ commit: 'd'.repeat(40) });
		}
		if (path === '/api/v1/stacks/wiki/inputs')
			return json({
				inputs: [
					{
						name: 'DOMAIN',
						type: 'hostname',
						required: true,
						set: true,
						value: 'wiki.example.test'
					},
					{ name: 'OIDC_ISSUER', type: 'url', set: false },
					{ name: 'OIDC_BUTTON_LABEL', type: 'string', set: false }
				]
			});
		return route.fulfill({ status: 404, headers: cors, body: 'not here' });
	});
	return seen;
}

test('Features: pick the Pocket ID stack as the provider, then see who uses it', async ({
	page
}) => {
	const seen = await mockBackend(page, { provider: '', candidates: ['id'] });
	await page.goto('/features');
	const card = page.getByRole('group', { name: 'Sign-on' });
	await expect(card).toContainText('No provider: apps use their own accounts.');
	await expect(card).toContainText('Own accounts: wiki');
	await expect(card.getByLabel('Provider')).toHaveValue('id');

	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

	await card.getByRole('button', { name: 'Use for sign-on' }).click();
	await expect(card).toContainText('Users sign in through id.');
	await expect(card).toContainText('Integrated: wiki');
	await expect(card.getByRole('status').filter({ hasText: 'Saved in aaaaaaa' })).toBeVisible();
	expect(seen.providerPuts).toEqual(['id']);
});

test('Features: without a Pocket ID stack, it offers to create one', async ({ page }) => {
	await mockBackend(page, { provider: '', candidates: [] });
	await page.goto('/features');
	const card = page.getByRole('group', { name: 'Sign-on' });
	await expect(card.getByRole('link', { name: 'Create a Pocket ID stack…' })).toHaveAttribute(
		'href',
		'/templates?backend=b1&template=pocket-id'
	);
});

test('New stack: integrated by default hides the OIDC overrides; custom sends its own', async ({
	page
}) => {
	const seen = await mockBackend(page, { provider: 'id', candidates: ['id'] });
	await page.goto('/templates?backend=b1&template=wiki');
	const mode = page.getByLabel('Sign-on');
	await expect(mode).toHaveValue('integrated');
	await expect(page.locator('#f-OIDC_ISSUER')).toHaveCount(0);
	await expect(page.locator('#f-OIDC_CLIENT_SECRET')).toHaveCount(0);
	await expect(page.locator('#f-OIDC_BUTTON_LABEL')).toHaveCount(1);

	// None: the template's own OIDC settings are back.
	await mode.selectOption('none');
	await expect(page.locator('#f-OIDC_ISSUER')).toHaveCount(1);

	await mode.selectOption('custom');
	await expect(page.locator('#f-OIDC_ISSUER')).toHaveCount(0);
	await page.locator('#f-DOMAIN').fill('wiki.example.test');
	const create = page.getByRole('button', { name: 'Create stack' });
	await expect(create).toBeDisabled();
	await page.getByLabel('Issuer').fill('https://login.example.test');
	await page.getByLabel('Client ID').fill('wiki-app');
	await page.getByLabel('Client secret').fill('s3cret-client');
	await create.click();
	await expect.poll(() => seen.created.length).toBe(1);
	expect(seen.created[0]).toMatchObject({
		template: 'wiki',
		values: { DOMAIN: 'wiki.example.test' },
		signOn: {
			mode: 'custom',
			issuer: 'https://login.example.test',
			clientID: 'wiki-app',
			clientSecret: 's3cret-client'
		}
	});
});

test('New stack: the default sign-on is left to the backend', async ({ page }) => {
	const seen = await mockBackend(page, { provider: 'id', candidates: ['id'] });
	await page.goto('/templates?backend=b1&template=wiki');
	await expect(page.getByLabel('Sign-on')).toHaveValue('integrated');
	await page.locator('#f-DOMAIN').fill('wiki.example.test');
	await page.getByRole('button', { name: 'Create stack' }).click();
	await expect.poll(() => seen.created.length).toBe(1);
	expect(seen.created[0]).not.toHaveProperty('signOn');
});

test('Stack page: switch to a custom provider, secret first', async ({ page }) => {
	const seen = await mockBackend(page, { provider: 'id', candidates: ['id'] });
	await page.goto('/stacks/b1/wiki');
	const section = page.getByRole('region', { name: 'Sign-on' });
	const mode = section.getByLabel('How users sign in');
	await expect(mode).toHaveValue('integrated');
	// Integrated: NepFleet fills OIDC_ISSUER, so it isn't offered.
	await expect(page.locator('#input-wiki-OIDC_BUTTON_LABEL')).toHaveCount(1);
	await expect(page.locator('#input-wiki-OIDC_ISSUER')).toHaveCount(0);

	await mode.selectOption('custom');
	await section.getByLabel('Issuer').fill('https://login.example.test');
	await section.getByLabel('Client ID').fill('wiki-app');
	const save = section.getByRole('button', { name: 'Save sign-on' });
	await expect(save).toBeDisabled(); // no secret stored yet
	await section.getByLabel('Client secret').fill('s3cret-client');
	await save.click();
	await expect(section.getByRole('status')).toContainText('Saved in ccccccc');
	expect(seen.secrets).toEqual([{ key: 'NEPFLEET_OIDC_CLIENT_SECRET', value: 's3cret-client' }]);
	expect(seen.stackPuts).toEqual([
		{ mode: 'custom', issuer: 'https://login.example.test', clientID: 'wiki-app' }
	]);
	await expect(section.getByLabel('Client secret')).toHaveValue('');

	// Back to the default: stack.yaml's spec.signOn goes.
	await mode.selectOption('integrated');
	await save.click();
	await expect.poll(() => seen.stackPuts.length).toBe(2);
	expect(seen.stackPuts[1]).toEqual({ mode: '' });
});
