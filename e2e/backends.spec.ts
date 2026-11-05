// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const BACKEND = 'http://127.0.0.1:17481';

async function axe(page: Page) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test('adds a real backend and shows it online', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Backends' })).toBeVisible();
	await page.getByLabel('Backend URL').fill(BACKEND);
	await page.getByRole('button', { name: 'Add backend' }).click();
	const card = page.getByRole('listitem').filter({ hasText: BACKEND });
	await expect(card).toContainText('Online');
	await expect(card).toContainText('e2e-backend');

	// Persisted across reloads, and removable.
	await page.reload();
	await expect(page.getByRole('listitem').filter({ hasText: BACKEND })).toContainText('Online');
	await page.getByRole('button', { name: 'Remove' }).click();
	await expect(page.getByText('No backends yet')).toBeVisible();
});

test('refuses plain http beyond loopback', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Backend URL').fill('http://192.168.1.2:7480');
	await page.getByRole('button', { name: 'Add backend' }).click();
	await expect(page.getByRole('alert')).toContainText('https');
});

test('theme: system by default, override persists', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/');
	await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.getByRole('radio', { name: 'Light' }).check();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	// Keyboard: arrows move within the radio group.
	await page.getByRole('radio', { name: 'Light' }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

for (const scheme of ['light', 'dark'] as const) {
	test(`no accessibility violations (${scheme}, empty and with a backend)`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: scheme });
		await page.goto('/');
		await axe(page);
		await page.getByLabel('Backend URL').fill(BACKEND);
		await page.getByRole('button', { name: 'Add backend' }).click();
		await expect(page.getByRole('listitem').filter({ hasText: BACKEND })).toContainText('Online');
		await axe(page);
	});
}
