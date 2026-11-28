// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	ConflictError,
	type Job,
	type RemovalPlan,
	ScopeError,
	VerifyFirstError,
	fetchRemovalPlan,
	isRemovalPlan,
	startRemove
} from './backend.ts';
import { defaultChoices, removeRequest, reportOf, whyNot } from './remove.ts';

const plan = (over: Partial<RemovalPlan> = {}): RemovalPlan => ({
	id: 'p1',
	stack: 'wiki',
	mode: 'compose',
	directory: 'stacks/wiki',
	containers: ['wiki-web-1'],
	volumes: [{ name: 'wiki_data', key: 'data', backup: true }],
	workDir: '/var/lib/nepfleet/stacks/wiki',
	workData: [],
	warnings: [],
	backup: true,
	backupFolder: '/var/lib/nepfleet/removed',
	dns: ['wiki.example.test'],
	dnsProvider: 'cloudflare',
	dnsManual: [],
	monitors: ['Wiki'],
	tokens: [],
	blocked: [],
	refused: [],
	steps: ['stop the stack and back up its volumes', 'remove its containers and networks'],
	...over
});

describe('remove stack choices', () => {
	it('starts with the backup the plan takes and the data kept', () => {
		expect(defaultChoices(plan())).toEqual({
			backup: true,
			deleteData: false,
			typed: '',
			force: false
		});
		expect(defaultChoices(plan({ backup: false })).backup).toBe(false);
		expect(removeRequest(plan(), defaultChoices(plan()))).toEqual({ plan: 'p1' });
	});

	it('deletes the data only with the name typed', () => {
		const c = { ...defaultChoices(plan()), deleteData: true };
		expect(whyNot(plan(), c)).toBe('Type wiki to delete its data.');
		expect(whyNot(plan(), { ...c, typed: 'wik' })).not.toBe('');
		c.typed = 'wiki';
		expect(whyNot(plan(), c)).toBe('');
		expect(removeRequest(plan(), c)).toEqual({ plan: 'p1', deleteData: true, confirm: 'wiki' });
		// No volumes and no files: nothing to delete, nothing sent.
		expect(removeRequest(plan({ volumes: [] }), c)).toEqual({ plan: 'p1' });
		// A bind mount's files in the working directory are data too.
		expect(removeRequest(plan({ volumes: [], workData: ['config/'] }), c)).toEqual({
			plan: 'p1',
			deleteData: true,
			confirm: 'wiki'
		});
	});

	it('skips the backup only when asked', () => {
		const c = { ...defaultChoices(plan()), backup: false };
		expect(removeRequest(plan(), c)).toEqual({ plan: 'p1', skipBackup: true });
		// The plan takes none: nothing to skip.
		expect(removeRequest(plan({ backup: false }), c)).toEqual({ plan: 'p1' });
		const unavailable = plan({ backupUnavailable: 'the age command isn’t installed' });
		expect(whyNot(unavailable, defaultChoices(unavailable))).toContain('Untick Back up first');
		expect(whyNot(unavailable, c)).toBe('');
	});

	it('refuses what the plan refuses, and needs force for what it blocks', () => {
		const refused = plan({ refused: ['app takes DOMAIN from it'] });
		expect(whyNot(refused, { ...defaultChoices(refused), force: true })).toContain(
			'app takes DOMAIN'
		);
		const blocked = plan({ blocked: ['caddy is the ingress of web'] });
		const c = defaultChoices(blocked);
		expect(whyNot(blocked, c)).toContain('Remove anyway');
		c.force = true;
		expect(whyNot(blocked, c)).toBe('');
		expect(removeRequest(blocked, c)).toEqual({ plan: 'p1', force: true });
		// force goes only where the plan asks for it.
		expect(removeRequest(plan(), { ...defaultChoices(plan()), force: true })).toEqual({
			plan: 'p1'
		});
	});

	it("reads a finished job's report", () => {
		const job: Job = {
			id: 'j',
			stack: 'wiki',
			kind: 'remove',
			state: 'succeeded',
			log: '',
			by: 'a'
		};
		expect(reportOf(job)).toBeNull();
		expect(reportOf({ ...job, result: { removed: 'x' } })).toBeNull();
		const result = { commit: 'c1', removed: ['stacks/wiki'], kept: [], warnings: [] };
		expect(reportOf({ ...job, result })).toEqual(result);
		expect(reportOf(null)).toBeNull();
	});
});

describe('removal API', () => {
	const backend = { id: 'b', url: 'https://fleet.example.test' };

	it('reads the plan and checks its shape', async () => {
		let url = '';
		const ok = (async (u: string) => {
			url = u;
			return new Response(JSON.stringify(plan()));
		}) as unknown as typeof fetch;
		expect((await fetchRemovalPlan(backend, 't', 'wiki', ok)).id).toBe('p1');
		expect(url).toBe('https://fleet.example.test/api/v1/stacks/wiki/removal');
		expect(isRemovalPlan({ ...plan(), steps: undefined })).toBe(false);
		const older: Record<string, unknown> = { ...plan() };
		delete older.workData;
		delete older.warnings;
		expect(isRemovalPlan(older)).toBe(true);
		expect(older.workData).toEqual([]);
		expect(isRemovalPlan({ ...plan(), workData: [1] })).toBe(false);
		expect(isRemovalPlan({ ...plan(), volumes: [{ name: 1 }] })).toBe(false);
	});

	it('sends DELETE with the request and maps refusals', async () => {
		let sent: RequestInit | undefined;
		let url = '';
		const ok = (async (u: string, init: RequestInit) => {
			url = u;
			sent = init;
			return new Response(
				JSON.stringify({
					id: 'j',
					stack: 'wiki',
					kind: 'remove',
					state: 'running',
					log: '',
					by: 'a'
				}),
				{ status: 202 }
			);
		}) as unknown as typeof fetch;
		const req = { plan: 'p1', deleteData: true, confirm: 'wiki' };
		expect((await startRemove(backend, 't', 'wiki', req, ok)).kind).toBe('remove');
		expect(url).toBe('https://fleet.example.test/api/v1/stacks/wiki');
		expect(sent?.method).toBe('DELETE');
		expect(JSON.parse(String(sent?.body))).toEqual(req);

		const reply = (status: number, body: string) =>
			(async () => new Response(body, { status })) as unknown as typeof fetch;
		await expect(
			startRemove(
				backend,
				't',
				'wiki',
				req,
				reply(409, 'caddy is the ingress of web (force removes it anyway)\n')
			)
		).rejects.toThrow(new ConflictError('caddy is the ingress of web (force removes it anyway)'));
		await expect(
			startRemove(backend, 't', 'wiki', req, reply(403, '{"verify":true}'))
		).rejects.toBeInstanceOf(VerifyFirstError);
		await expect(
			startRemove(backend, 't', 'wiki', req, reply(403, 'forbidden'))
		).rejects.toBeInstanceOf(ScopeError);
	});
});
