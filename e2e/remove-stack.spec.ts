// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page, type Route } from '@playwright/test';

// A stand-in backend, on a port nothing listens on, with a person signed in.
const BACKEND = 'http://127.0.0.1:17995';

const removal = (stack: string, over: Record<string, unknown> = {}) => ({
	id: 'p-' + stack,
	stack,
	mode: 'compose',
	directory: 'stacks/' + stack,
	containers: [stack + '-web-1'],
	volumes: [{ name: stack + '_data', key: 'data', backup: true }],
	backup: true,
	backupFolder: '/var/lib/nepfleet/removed',
	dns: [stack + '.example.test'],
	dnsProvider: 'cloudflare',
	dnsManual: ['old.example.test: not under example.test, the zone caddy keeps records in'],
	monitors: ['Wiki'],
	tokens: ['stack:' + stack + '/NOTIFY_TOKEN'],
	blocked: [],
	refused: [],
	steps: [
		'stop the stack and back up its volumes (' + stack + '_data) to /var/lib/nepfleet/removed',
		'remove its containers and networks (docker compose down)',
		'remove stacks/' +
			stack +
			' in one commit, chore(' +
			stack +
			'): remove the stack (history keeps it)'
	],
	...over
});

// mock answers the stack page and the removal endpoints; removals collects
// what DELETE sent.
async function mock(page: Page, plans: Record<string, unknown>) {
	await page.addInitScript((url) => {
		localStorage.setItem('nepfleet-backends', JSON.stringify([{ id: 'b1', url }]));
		sessionStorage.setItem('nepfleet-token-b1', 'session');
	}, BACKEND);
	const removals: { stack: string; body: unknown }[] = [];
	let polls = 0;
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
			return json(
				Object.keys(plans).map((name) => ({
					name,
					target: 'local',
					mode: 'compose',
					apply: 'manual',
					updates: 'patch'
				}))
			);
		const m = /^\/api\/v1\/stacks\/([^/]+)(\/removal)?$/.exec(path);
		if (m?.[2] && req.method() === 'GET') return json(plans[m[1] ?? '']);
		if (m && !m[2] && req.method() === 'DELETE') {
			const stack = m[1] ?? '';
			removals.push({ stack, body: req.postDataJSON() });
			return json({ id: 'j-rm', stack, kind: 'remove', state: 'running', log: '', by: 'me' }, 202);
		}
		if (path === '/api/v1/jobs/j-rm') {
			polls++;
			if (polls < 2)
				return json({
					id: 'j-rm',
					stack: 'wiki',
					kind: 'remove',
					state: 'running',
					log: 'wiki: step 2/5: remove the containers and networks\n',
					by: 'me',
					progress: { step: 2, steps: 5, text: 'remove the containers and networks' }
				});
			return json({
				id: 'j-rm',
				stack: 'wiki',
				kind: 'remove',
				state: 'succeeded',
				log: 'wiki: removed\n',
				by: 'me',
				result: {
					commit: 'c0ffee',
					backup: '/var/lib/nepfleet/removed/wiki-20261128-150706.tar.gz.age',
					removed: ['containers: wiki-web-1', 'stacks/wiki, in commit c0ffee', 'volume wiki_data'],
					kept: [
						'DNS AAAA wiki.example.test (2001:db8::99): points elsewhere, not only at this host'
					],
					warnings: []
				}
			});
		}
		return route.fulfill({ status: 404, headers: cors, body: 'not here' });
	});
	return removals;
}

test('Remove stack shows the plan, deletes the data only when typed, and reports', async ({
	page
}) => {
	const removals = await mock(page, { wiki: removal('wiki') });
	await page.goto('/stacks/b1/wiki');
	await page.getByRole('button', { name: 'Remove stack…' }).click();
	const dialog = page.getByRole('dialog', { name: 'Remove wiki?' });
	await expect(dialog).toContainText('remove stacks/wiki in one commit');
	await expect(dialog).toContainText('old.example.test');
	await expect(dialog.getByLabel('Back up first')).toBeChecked();
	await expect(dialog.getByLabel('Delete the data too')).not.toBeChecked();

	const remove = dialog.getByRole('button', { name: 'Remove', exact: true });
	await expect(remove).toBeEnabled();
	await dialog.getByLabel('Delete the data too').check();
	await expect(remove).toBeDisabled();
	await expect(dialog).toContainText('Only the backup keeps it.');
	await dialog.getByLabel('Type wiki to delete its data').fill('wiki');
	await expect(remove).toBeEnabled();
	await remove.click();

	await expect(dialog.getByRole('progressbar')).toBeVisible();
	await expect(dialog).toContainText('wiki is removed.', { timeout: 10000 });
	await expect(dialog.getByRole('list', { name: 'Removed' })).toContainText('volume wiki_data');
	await expect(dialog.getByRole('list', { name: 'Kept' })).toContainText('points elsewhere');
	await expect(dialog).toContainText('wiki-20261128-150706.tar.gz.age');
	await expect(dialog.getByRole('link', { name: 'Back to the stacks' })).toBeVisible();
	expect(removals).toEqual([
		{ stack: 'wiki', body: { plan: 'p-wiki', deleteData: true, confirm: 'wiki' } }
	]);
});

test('Remove stack refuses what the plan refuses and needs Remove anyway for a needed system stack', async ({
	page
}) => {
	const removals = await mock(page, {
		app: removal('app', {
			refused: ['web takes UPSTREAM from it: change that value of web first']
		}),
		caddy: removal('caddy', {
			volumes: [],
			backup: false,
			dns: [],
			dnsManual: [],
			blocked: ['caddy is the ingress of wiki: their sites stop answering on their domains']
		})
	});
	await page.goto('/stacks/b1/app');
	await page.getByRole('button', { name: 'Remove stack…' }).click();
	let dialog = page.getByRole('dialog', { name: 'Remove app?' });
	// The dialog's toaster is an alert region too.
	await expect(dialog.getByRole('alert').filter({ hasText: "It can't be removed" })).toContainText(
		'web takes UPSTREAM from it'
	);
	await expect(dialog.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Cancel' }).click();

	await page.goto('/stacks/b1/caddy');
	await page.getByRole('button', { name: 'Remove stack…' }).click();
	dialog = page.getByRole('dialog', { name: 'Remove caddy?' });
	await expect(dialog).toContainText('ingress of wiki');
	await expect(dialog.getByLabel('Back up first')).toBeDisabled();
	const remove = dialog.getByRole('button', { name: 'Remove', exact: true });
	await expect(remove).toBeDisabled();
	await dialog.getByLabel('Remove anyway').check();
	await expect(remove).toBeEnabled();
	await remove.click();
	await expect
		.poll(() => removals)
		.toEqual([{ stack: 'caddy', body: { plan: 'p-caddy', force: true } }]);
});
