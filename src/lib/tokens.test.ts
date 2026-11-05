// The theme tokens must meet WCAG 2.2 AA in both themes: 4.5:1 for text,
// 3:1 for focus rings and status dots. Parsed from app.css, so a colour
// change that breaks contrast fails here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

function theme(name: string): Record<string, string> {
	const block = css.match(new RegExp(`\\[data-theme='${name}'\\]\\s*{([^}]*)}`))?.[1] ?? '';
	return Object.fromEntries(
		[...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]])
	);
}

function luminance(hex: string): number {
	const [r = 0, g = 0, b = 0] = [1, 3, 5]
		.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const [x = 0, y = 0] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
}

const text: [string, string][] = [
	['text', 'bg'],
	['text', 'surface'],
	['text', 'surface-2'],
	['muted', 'bg'],
	['muted', 'surface'],
	['muted', 'surface-2'],
	['accent-text', 'accent'],
	['danger-text', 'danger'],
	['err', 'surface'],
	['err', 'bg'],
	['ok', 'surface'],
	['warn', 'surface'],
	['add-text', 'add-bg'],
	['add-text', 'surface'],
	['del-text', 'surface'],
	['del-text', 'del-bg'],
	['accent', 'surface'],
	['accent', 'bg']
];
const nonText: [string, string][] = [
	['accent', 'surface-2'],
	['ok', 'surface'],
	['err', 'surface'],
	['input-border', 'bg'],
	['input-border', 'surface']
];

for (const name of ['light', 'dark']) {
	describe(`${name} theme`, () => {
		const t = theme(name);
		it.each(text)('%s on %s is at least 4.5:1', (fg, bg) => {
			expect(t[fg], fg).toBeDefined();
			expect(t[bg], bg).toBeDefined();
			expect(contrast(t[fg] ?? '', t[bg] ?? '')).toBeGreaterThanOrEqual(4.5);
		});
		it.each(nonText)('%s on %s is at least 3:1', (fg, bg) => {
			expect(contrast(t[fg] ?? '', t[bg] ?? '')).toBeGreaterThanOrEqual(3);
		});
	});
}
