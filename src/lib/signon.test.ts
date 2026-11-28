import { describe, expect, it } from 'vitest';
import { defaultSignOn, hiddenBySignOn, issuerError } from './signon.ts';

describe('hiddenBySignOn', () => {
	it('hides the overrides only when NepFleet fills them', () => {
		expect(hiddenBySignOn('OIDC_ISSUER', 'integrated')).toBe(true);
		expect(hiddenBySignOn('OIDC_CLIENT_SECRET', 'custom')).toBe(true);
		expect(hiddenBySignOn('OIDC_ISSUER', 'none')).toBe(false);
		expect(hiddenBySignOn('OIDC_ISSUER', undefined)).toBe(false);
		expect(hiddenBySignOn('OIDC_BUTTON_LABEL', 'integrated')).toBe(false);
		expect(hiddenBySignOn('DOMAIN', 'integrated')).toBe(false);
	});
});

describe('defaultSignOn', () => {
	it('is integrated only with a provider and a template that supports it', () => {
		expect(defaultSignOn(true, true)).toBe('integrated');
		expect(defaultSignOn(true, false)).toBe('none');
		expect(defaultSignOn(false, true)).toBe('none');
	});
});

describe('issuerError', () => {
	it('takes http(s) URLs with a host', () => {
		expect(issuerError('https://login.example.test')).toBe('');
		expect(issuerError('http://10.0.0.2:1411')).toBe('');
		expect(issuerError('login.example.test')).not.toBe('');
		expect(issuerError('ftp://login.example.test')).not.toBe('');
	});
});
