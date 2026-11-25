// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { PRESETS, applyPreset, isNtfyStack, ntfyUrl, randomTopic } from './notify-setup.ts';

const stack = (template?: string) => ({
	name: 's',
	target: 'local',
	mode: 'compose',
	apply: 'auto',
	updates: 'patch',
	template
});

describe('isNtfyStack', () => {
	it('matches the ntfy template from any source', () => {
		expect(isNtfyStack(stack('official/ntfy@0.2.4'))).toBe(true);
		expect(isNtfyStack(stack('ntfy'))).toBe(true);
		expect(isNtfyStack(stack('official/ntfy-relay@1'))).toBe(false);
		expect(isNtfyStack(stack('official/gotify@1'))).toBe(false);
		expect(isNtfyStack(stack())).toBe(false);
	});
});

describe('ntfyUrl', () => {
	it('builds the shoutrrr URL', () => {
		expect(ntfyUrl('https://ntfy.example.test', 'nepfleet')).toBe(
			'ntfy://ntfy.example.test/nepfleet'
		);
		expect(ntfyUrl('ntfy.example.test/', 'alerts')).toBe('ntfy://ntfy.example.test/alerts');
	});
	it('keeps a port and a path prefix', () => {
		expect(ntfyUrl('https://example.test:8443/ntfy/', 'a')).toBe('ntfy://example.test:8443/ntfy/a');
	});
	it('asks for http when the server is plain http', () => {
		expect(ntfyUrl('http://192.168.1.5:8080', 'a')).toBe('ntfy://192.168.1.5:8080/a?scheme=http');
	});
	it('puts a token in as the password, escaped', () => {
		expect(ntfyUrl('https://ntfy.example.test', 'a', ' tk_a/b ')).toBe(
			'ntfy://:tk_a%2Fb@ntfy.example.test/a'
		);
	});
	it('refuses bad topics and schemes', () => {
		expect(() => ntfyUrl('https://ntfy.example.test', 'a b')).toThrow(/topic/);
		expect(() => ntfyUrl('https://ntfy.example.test', '')).toThrow(/topic/);
		expect(() => ntfyUrl('ftp://ntfy.example.test', 'a')).toThrow(/http/);
	});
});

describe('randomTopic', () => {
	it('is a valid, different topic each time', () => {
		const a = randomTopic();
		expect(a).toMatch(/^nepfleet-[a-z0-9]{12}$/);
		expect(randomTopic()).not.toBe(a);
	});
});

describe('applyPreset', () => {
	const problems = PRESETS.find((p) => p.id === 'problems')!;
	const everything = PRESETS.find((p) => p.id === 'everything')!;

	it('replaces the channel’s routes and keeps the others', () => {
		const out = applyPreset(
			[
				{ channels: ['phone'], events: ['*'], stacks: [], minSeverity: 'warning' },
				{ channels: ['phone', 'chat'], events: ['apply.*'], stacks: ['web'] },
				{ channels: ['chat'], events: [], stacks: [] }
			],
			'phone',
			problems
		);
		expect(out).toEqual([
			{ channels: ['chat'], events: ['apply.*'], stacks: ['web'] },
			{ channels: ['chat'], events: [], stacks: [] },
			{ channels: ['phone'], ...problems.route }
		]);
		expect(out.at(-1)?.events).toContain('backup.failed');
		expect(out.at(-1)?.minSeverity).toBe('warning');
	});

	it('leaves out the severity when the preset has none', () => {
		expect(applyPreset([], 'phone', everything)).toEqual([
			{ channels: ['phone'], events: [], stacks: [] }
		]);
	});
});
