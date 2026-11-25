// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Route } from '@playwright/test';

// A stand-in backend, on a port nothing listens on, with a person signed in.
const BACKEND = 'http://127.0.0.1:17998';
const KEY =
	'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleExampleExampleExampleExampleExampl you@laptop';

test('Health offers a key backup for the Key copy warning, and the warning clears', async ({
	page
}) => {
	await page.addInitScript((url) => {
		localStorage.setItem('nepfleet-backends', JSON.stringify([{ id: 'b1', url }]));
		sessionStorage.setItem('nepfleet-token-b1', 'session');
	}, BACKEND);
	let backedUp: string[] | null = null;
	await page.route(BACKEND + '/**', async (route: Route) => {
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
			route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
		if (path === '/api/v1/info') return json({ name: 'b', version: '1', apiVersion: 'v1' });
		if (path === '/api/v1/mirror') return json([]);
		if (path === '/api/v1/doctor')
			return json({
				host: 'h',
				stacks: 1,
				checks: [
					backedUp
						? { name: 'Key copy', status: 'ok', detail: 'copied 2026-11-25 (recipients)' }
						: {
								name: 'Key copy',
								status: 'warn',
								detail: 'no copy of the age key is known: losing it loses every secret',
								fix: 'nepfleet key backup --out /media/usb/nepfleet-key.age',
								action: 'key-backup'
							}
				],
				security: []
			});
		if (path === '/api/v1/key/backup' && req.method() === 'POST') {
			backedUp = (req.postDataJSON() as { recipients: string[] }).recipients;
			return route.fulfill({
				headers: cors,
				contentType: 'application/octet-stream',
				body: '-----BEGIN AGE ENCRYPTED FILE-----\n'
			});
		}
		return route.fulfill({ status: 404, headers: cors, body: 'not here' });
	});

	await page.goto('/health');
	const warning = page.getByRole('listitem').filter({ hasText: 'Key copy' });
	await expect(warning).toContainText('no copy of the age key is known');
	await warning.getByRole('button', { name: 'Back up the key…' }).click();
	await page.getByLabel('Public keys, one per line').fill(KEY);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download encrypted key' }).click();
	expect((await download).suggestedFilename()).toBe('nepfleet-age-key.age');
	expect(backedUp).toEqual([KEY]);

	// The backend recorded it: the check runs again and the warning is gone.
	await expect(page.getByRole('status').filter({ hasText: 'recorded the copy' })).toBeVisible();
	await expect(warning).toContainText('copied 2026-11-25');
	await expect(page.getByRole('button', { name: 'Back up the key…' })).toHaveCount(0);
});
