// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, devices } from '@playwright/test';

// The UI (vite preview of the static build) against a real `nepfleet serve`.
// NEPFLEET_BIN points at the nepfleet binary; CI installs it from main.
const backend = process.env.NEPFLEET_BIN ?? 'nepfleet';

export default defineConfig({
	testDir: 'e2e',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: [
		{
			command: 'npm run build && npx vite preview --port 4173 --strictPort',
			url: 'http://localhost:4173',
			reuseExistingServer: !process.env.CI
		},
		{
			command: `${backend} serve --listen 127.0.0.1:17481 --name e2e-backend --allowed-origins http://localhost:4173`,
			url: 'http://127.0.0.1:17481/healthz',
			reuseExistingServer: false
		}
	]
});
