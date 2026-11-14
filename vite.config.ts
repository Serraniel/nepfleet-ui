import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// The release's version: APP_VERSION when CI sets it, else package.json's
// (release-please keeps it current), so local and packaged builds show it too.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
	version?: string;
};
const version = (process.env.APP_VERSION || pkg.version || 'dev').replace(/^v/, '');

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter({ fallback: 'index.html' }),
			version: { name: version }
		})
	],
	define: {
		__APP_VERSION__: JSON.stringify(version)
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
