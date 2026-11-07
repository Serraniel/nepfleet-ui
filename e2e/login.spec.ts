// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// A real server with passkeys on, and Chromium's virtual authenticator: a whole
// ceremony. On localhost, like the UI, so the Strict cookie counts as same-site.
const PORT = 17483;
const BACKEND = `http://localhost:${PORT}`;
const UI = 'http://localhost:4173';

let server: ChildProcess;
let state: string;
let setupToken = '';

test.beforeAll(async () => {
	state = mkdtempSync(join(tmpdir(), 'nepfleet-e2e-'));
	server = spawn(process.env.NEPFLEET_BIN ?? 'nepfleet', [
		'serve',
		'--listen',
		`127.0.0.1:${PORT}`,
		'--state',
		state,
		'--name',
		'passkey-backend',
		'--allowed-origins',
		UI,
		'--passkey-domain',
		'localhost',
		'--passkey-origins',
		UI
	]);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('no setup token from the server')), 10000);
		server.stderr?.on('data', (d: Buffer) => {
			const m = /setup token: (\S+)/.exec(d.toString());
			if (m?.[1]) {
				setupToken = m[1];
				clearTimeout(timer);
				resolve();
			}
		});
	});
});

test.afterAll(() => {
	server.kill();
	rmSync(state, { recursive: true, force: true });
});

test('first user, sign out, sign in again with the same passkey', async ({ page, context }) => {
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});

	await page.goto('/');
	await page.getByLabel('Backend URL').fill(BACKEND);
	await page.getByRole('button', { name: 'Add backend' }).click();
	await page.getByRole('link', { name: 'Stacks', exact: true }).click();

	await page.getByLabel('Setup token').fill(setupToken);
	await page.getByLabel('Your name').fill('Ada');
	await page.getByRole('button', { name: 'Create a passkey' }).click();
	await expect(page.getByText('Signed in as Ada')).toBeVisible();

	// A session works without any token form, and a reload keeps it.
	await expect(page.getByLabel('API token')).toHaveCount(0);
	await page.reload();
	await expect(page.getByText('Signed in as Ada')).toBeVisible();

	// The cookie is out of the page's reach, and nothing landed in storage.
	expect(await page.evaluate(() => document.cookie)).not.toContain('nepfleet_session');
	const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
	expect(stored).not.toContain(setupToken);

	await page.getByRole('button', { name: 'Sign out' }).click();
	const signIn = page.getByRole('button', { name: 'Sign in with a passkey' });
	await expect(signIn).toBeVisible();
	await signIn.click();
	await expect(page.getByText('Signed in as Ada')).toBeVisible();
});
