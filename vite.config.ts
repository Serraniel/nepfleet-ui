import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vitest/config';

const version = (process.env.APP_VERSION || 'dev').replace(/^v/, '');

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
