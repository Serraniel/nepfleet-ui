// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Route } from '@playwright/test';

// A stand-in backend, on a port nothing listens on, with a person signed in.
const BACKEND = 'http://127.0.0.1:17996';

const stack = (name: string, apply: string) => ({
	name,
	target: 'local',
	mode: 'compose',
	apply,
	updates: 'patch'
});

const change = [{ path: '.env', kind: 'changed' }];

const plans: Record<string, Record<string, unknown>> = {
	web: { id: 'p-web', stack: 'web', mode: 'compose', first: false, changes: change },
	db: {
		id: 'p-db',
		stack: 'db',
		mode: 'compose',
		first: false,
		changes: change,
		destructive: ['volume data of db is removed']
	},
	auto: { id: 'p-auto', stack: 'auto', mode: 'compose', first: false, changes: change },
	fresh: { id: 'p-fresh', stack: 'fresh', mode: 'compose', first: true, changes: change },
	same: { id: 'p-same', stack: 'same', mode: 'compose', first: false, changes: [] },
	broken: { id: 'p-broken', stack: 'broken', mode: 'compose', first: false, changes: change },
	last: { id: 'p-last', stack: 'last', mode: 'compose', first: false, changes: change }
};

test('Apply all applies manual stacks in order and stops at the first failure', async ({
	page
}) => {
	await page.addInitScript((url) => {
		localStorage.setItem('nepfleet-backends', JSON.stringify([{ id: 'b1', url }]));
		sessionStorage.setItem('nepfleet-token-b1', 'session');
	}, BACKEND);
	const applied: { stack: string; plan: string; confirmDestructive: boolean }[] = [];
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
		const json = (body: unknown, status = 200) =>
			route.fulfill({
				status,
				headers: cors,
				contentType: 'application/json',
				body: JSON.stringify(body)
			});
		if (path === '/api/v1/info') return json({ name: 'b', version: '1', apiVersion: 'v1' });
		if (path === '/api/v1/stacks')
			return json([
				stack('web', 'manual'),
				stack('db', 'manual'),
				stack('auto', 'auto'),
				stack('fresh', 'manual'),
				stack('same', 'manual'),
				stack('broken', 'manual'),
				stack('last', 'manual')
			]);
		const plan = /^\/api\/v1\/stacks\/([^/]+)\/plan$/.exec(path);
		if (plan) return json(plans[plan[1] ?? '']);
		const apply = /^\/api\/v1\/stacks\/([^/]+)\/apply$/.exec(path);
		if (apply && req.method() === 'POST') {
			const s = apply[1] ?? '';
			const body = req.postDataJSON() as { plan: string; confirmDestructive: boolean };
			applied.push({ stack: s, ...body });
			const job = { id: 'j-' + s, stack: s, kind: 'apply', state: 'running', log: '', by: 'me' };
			return json(job, 202);
		}
		const job = /^\/api\/v1\/jobs\/j-([^/]+)$/.exec(path);
		if (job) {
			const s = job[1] ?? '';
			const failed = s === 'broken';
			return json({
				id: 'j-' + s,
				stack: s,
				kind: 'apply',
				state: failed ? 'failed' : 'succeeded',
				log: '',
				by: 'me',
				...(failed ? { error: 'broken is unhealthy: rolled back' } : {})
			});
		}
		return route.fulfill({ status: 404, headers: cors, body: 'not here' });
	});

	await page.goto('/updates');
	await page.getByRole('button', { name: 'Check manual stacks' }).click();
	const list = page.getByRole('list', { name: 'Stacks with pending changes' });
	await expect(list.getByRole('listitem')).toHaveCount(4);
	await expect(list).toContainText('web');
	await expect(list).not.toContainText('auto');
	// A first apply is left to its page; no changes is up to date.
	await expect(page.getByText('not applied yet')).toBeVisible();
	await expect(page.getByText('1 up to date.')).toBeVisible();

	await page.getByRole('button', { name: 'Apply all (4)' }).click();
	const dialog = page.getByRole('dialog', { name: 'Apply 4 stacks?' });
	await expect(dialog).toContainText('volume data of db is removed');
	// db isn't confirmed: it's skipped.
	await dialog.getByRole('button', { name: 'Apply all' }).click();

	const row = (name: string) => list.getByRole('listitem').filter({ hasText: name });
	await expect(row('broken')).toContainText('failed: broken is unhealthy: rolled back');
	await expect(row('web')).toContainText('applied');
	await expect(row('db')).toContainText('skipped: destructive: not confirmed');
	await expect(row('last')).toContainText('not started');
	expect(applied).toEqual([
		{ stack: 'web', plan: 'p-web', confirmDestructive: false },
		{ stack: 'broken', plan: 'p-broken', confirmDestructive: false }
	]);

	// Again, with db confirmed: web is done, broken is retried and fails again.
	await page.getByRole('button', { name: 'Apply all (3)' }).click();
	const again = page.getByRole('dialog', { name: 'Apply 3 stacks?' });
	await again.getByLabel(/Type db to include it/).fill('db');
	await again.getByRole('button', { name: 'Apply all' }).click();
	await expect(row('db')).toContainText('applied');
	await expect(row('broken')).toContainText('failed');
	expect(applied.slice(2)).toEqual([
		{ stack: 'db', plan: 'p-db', confirmDestructive: true },
		{ stack: 'broken', plan: 'p-broken', confirmDestructive: false }
	]);
});
