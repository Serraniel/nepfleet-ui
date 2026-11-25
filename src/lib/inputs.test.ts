import { describe, expect, it } from 'vitest';
import {
	checkInput,
	groupInputs,
	helpText,
	newCommand,
	shellQuote,
	splitInputs
} from './inputs.ts';

describe('checkInput', () => {
	it('follows the backend rules', () => {
		expect(checkInput({ name: 'D', type: 'hostname' }, 'photos.example.org')).toBe('');
		expect(checkInput({ name: 'D', type: 'hostname' }, 'not a host')).not.toBe('');
		expect(checkInput({ name: 'U', type: 'url' }, 'ftp://x')).not.toBe('');
		expect(checkInput({ name: 'U', type: 'url' }, 'https://x.example')).toBe('');
		expect(checkInput({ name: 'P', type: 'path' }, 'relative')).not.toBe('');
		expect(checkInput({ name: 'P', type: 'path' }, '@media')).toBe('');
		expect(checkInput({ name: 'E', type: 'enum', options: ['a', 'b'] }, 'c')).not.toBe('');
		expect(checkInput({ name: 'I', type: 'int' }, '12')).toBe('');
		expect(checkInput({ name: 'X', type: 'string', pattern: '^[0-9]+$' }, 'x')).not.toBe('');
	});
	it('knows required and defaults', () => {
		expect(checkInput({ name: 'D', type: 'hostname', required: true }, '')).toBe('Required');
		expect(checkInput({ name: 'P', type: 'int', required: true, default: '1' }, '')).toBe('');
	});
});

describe('newCommand', () => {
	it('quotes values and leaves secrets out', () => {
		const cmd = newCommand(
			'immich',
			'photos',
			'nas',
			[
				{ name: 'DOMAIN', type: 'hostname' },
				{ name: 'TITLE', type: 'string' },
				{ name: 'PW', type: 'secret' },
				{ name: 'PORT', type: 'int', default: '80' }
			],
			{ DOMAIN: 'photos.example.org', TITLE: "Bob's photos", PW: 'hunter2', PORT: '80' }
		);
		expect(cmd).toBe(
			"nepfleet new immich photos --target nas --set DOMAIN=photos.example.org --set 'TITLE=Bob'\\''s photos'"
		);
		expect(cmd).not.toContain('hunter2');
	});
	it('quotes for the shell', () => {
		expect(shellQuote('a b')).toBe("'a b'");
		expect(shellQuote('$(x)')).toBe("'$(x)'");
	});
});

describe('helpText', () => {
	const provider = {
		name: 'PROVIDER',
		type: 'enum',
		options: ['none', 'cloudflare'],
		default: 'none'
	};
	const token = {
		name: 'TOKEN',
		type: 'secret',
		description: 'a token',
		helpFrom: 'PROVIDER',
		help: { cloudflare: 'Zone → DNS → Edit' }
	};
	const inputs = [provider, token];
	it('shows the help for the chosen value', () => {
		expect(helpText(token, inputs, { PROVIDER: 'cloudflare' })).toBe('Zone → DNS → Edit');
	});
	it('falls back to the description, also for the default value', () => {
		expect(helpText(token, inputs, {})).toBe('a token');
		expect(helpText(token, inputs, { PROVIDER: 'none' })).toBe('a token');
	});
	it("ignores keys that aren't the template's own", () => {
		expect(helpText(token, inputs, { PROVIDER: 'toString' })).toBe('a token');
	});
});

describe('splitInputs', () => {
	const inp = (name: string, required = false, def?: string) => ({ name, required, default: def });
	it('puts inputs without a default first, the rest grouped by prefix', () => {
		const { required, optional } = splitInputs([
			inp('OIDC_ISSUER'),
			inp('DOMAIN', true),
			inp('TZ', false, 'UTC'),
			inp('OIDC_CLIENT_ID'),
			inp('ADMIN_EMAIL', true),
			inp('MODE', true, 'a'),
			inp('SMTP_HOST'),
			inp('LOG_LEVEL', false, 'info')
		]);
		expect(required.map((i) => i.name)).toEqual(['DOMAIN', 'ADMIN_EMAIL']);
		expect(optional.map((g) => [g.prefix, g.inputs.map((i) => i.name)])).toEqual([
			['OIDC', ['OIDC_ISSUER', 'OIDC_CLIENT_ID']],
			['', ['TZ']],
			['', ['MODE']],
			['', ['SMTP_HOST']], // a prefix of one is no group
			['', ['LOG_LEVEL']]
		]);
	});
	it('keeps names without an underscore, or starting with one, on their own', () => {
		expect(groupInputs([inp('_A'), inp('_B'), inp('A')]).map((g) => g.prefix)).toEqual([
			'',
			'',
			''
		]);
	});
});
