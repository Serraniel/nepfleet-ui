import { describe, expect, it } from 'vitest';
import { fetchInfo, normalizeUrl } from './backend.ts';

describe('normalizeUrl', () => {
	it('accepts https and strips trailing slashes', () => {
		expect(normalizeUrl(' https://fleet.example.org/ ')).toBe('https://fleet.example.org');
		expect(normalizeUrl('https://example.org/nepfleet//')).toBe('https://example.org/nepfleet');
	});
	it('allows plain http only on loopback', () => {
		expect(normalizeUrl('http://localhost:7480')).toBe('http://localhost:7480');
		expect(() => normalizeUrl('http://192.168.1.2:7480')).toThrow(/https/);
	});
	it('rejects credentials, queries and garbage', () => {
		expect(() => normalizeUrl('https://u:p@example.org')).toThrow(/credentials/);
		expect(() => normalizeUrl('https://example.org/?x=1')).toThrow(/query/);
		expect(() => normalizeUrl('not a url')).toThrow(/valid/);
	});
});

describe('fetchInfo', () => {
	const backend = { id: 'a', url: 'https://fleet.example.org' };
	it('returns valid info', async () => {
		const info = { name: 'home', version: '0.1.0', apiVersion: 'v1' };
		const fake = (async () => new Response(JSON.stringify(info))) as typeof fetch;
		await expect(fetchInfo(backend, fake)).resolves.toEqual(info);
	});
	it('rejects foreign responses', async () => {
		const fake = (async () => new Response('{"hello":"world"}')) as typeof fetch;
		await expect(fetchInfo(backend, fake)).rejects.toThrow(/NepFleet/);
	});
});
