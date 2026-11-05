// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const scheme of ['light', 'dark'] as const) {
	test(`design system has no accessibility violations (${scheme})`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: scheme });
		await page.goto('/design');
		for (const tab of ['Changes', 'Empty state']) {
			await page.getByRole('tab', { name: tab }).click();
			const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
			expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
		}
		await page.getByRole('button', { name: 'Open dialog' }).click();
		await expect(page.getByRole('dialog', { name: 'Apply vaultwarden?' })).toBeVisible();
		const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
		expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
	});
}

test('tabs follow the ARIA keyboard pattern', async ({ page }) => {
	await page.goto('/design');
	await page.getByRole('tab', { name: 'Changes' }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('tab', { name: 'Empty state' })).toBeFocused();
	await expect(page.getByRole('tab', { name: 'Empty state' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await page.keyboard.press('Home');
	await expect(page.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByText('+2')).toBeVisible(); // diff counts: image line changed, restart added
});

test('dialog traps focus, closes on Escape and returns focus', async ({ page }) => {
	await page.goto('/design');
	const opener = page.getByRole('button', { name: 'Open dialog' });
	await opener.click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(opener).toBeFocused();
});

test('toasts: errors are announced as alerts and stay', async ({ page }) => {
	await page.goto('/design');
	await page.getByRole('button', { name: 'Error toast' }).click();
	await expect(page.getByRole('alert')).toContainText('health check timed out');
	await page.getByRole('button', { name: /^Dismiss: Apply failed: health/ }).click();
	await expect(page.getByText('health check timed out')).toBeHidden();
	await page.getByRole('button', { name: 'Success toast' }).click();
	await expect(page.getByRole('status')).toContainText('applied');
});

test('toasts raised while a dialog is open show inside it', async ({ page }) => {
	await page.goto('/design');
	await page.getByRole('button', { name: 'Open dialog' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Fail while open' }).click();
	await expect(dialog.getByRole('alert')).toContainText('image not found');
	await dialog.getByRole('button', { name: 'Dismiss: Apply failed: image not found' }).click();
	await expect(page.getByText('image not found')).toBeHidden();
});
