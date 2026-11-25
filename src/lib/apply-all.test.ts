// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { type Pending, type Runner, applicable, applyAll } from './apply-all.ts';
import { type Job, NotFoundError, type Plan } from './backend.ts';

const plan = (over: Partial<Plan> = {}): Plan => ({
	id: 'p1',
	stack: 's',
	mode: 'compose',
	first: false,
	changes: [{ path: '.env', kind: 'changed' }],
	...over
});

const item = (stack: string, over: Partial<Plan> = {}): Pending => ({
	backend: 'b',
	stack,
	plan: plan({ stack, ...over }),
	state: 'pending'
});

const job = (stack: string, state: Job['state'], error?: string): Job => ({
	id: 'j-' + stack,
	stack,
	kind: 'apply',
	state,
	log: '',
	by: 'me',
	...(error ? { error } : {})
});

/** A runner whose jobs end as outcome says, after one running poll. */
function runner(outcome: Record<string, Job['state'] | Error>) {
	const started: { stack: string; confirm: boolean }[] = [];
	const r: Runner = {
		start: async (it, confirm) => {
			started.push({ stack: it.stack, confirm });
			const o = outcome[it.stack];
			if (o instanceof Error) throw o;
			return { ...job(it.stack, 'running'), progress: { step: 1, steps: 3, text: 'pull' } };
		},
		job: async (it) => {
			const o = outcome[it.stack] ?? 'succeeded';
			return job(
				it.stack,
				o as Job['state'],
				o === 'failed' ? 'unhealthy: rolled back' : undefined
			);
		},
		sleep: async () => {}
	};
	return { r, started };
}

describe('applicable', () => {
	it('takes plans with changes and an id, not first applies', () => {
		expect(applicable(plan())).toBe(true);
		expect(applicable(plan({ changes: [] }))).toBe(false);
		expect(applicable(plan({ changes: null }))).toBe(false);
		expect(applicable(plan({ id: undefined }))).toBe(false);
		expect(applicable(plan({ first: true }))).toBe(false);
	});
});

describe('applyAll', () => {
	it('applies each in order', async () => {
		const items = [item('a'), item('b')];
		const { r, started } = runner({});
		expect(await applyAll(items, r)).toBe(true);
		expect(started.map((s) => s.stack)).toEqual(['a', 'b']);
		expect(items.map((i) => i.state)).toEqual(['applied', 'applied']);
	});

	it('stops at the first failure', async () => {
		const items = [item('a'), item('b'), item('c')];
		const { r, started } = runner({ b: 'failed' });
		expect(await applyAll(items, r)).toBe(false);
		expect(started.map((s) => s.stack)).toEqual(['a', 'b']);
		expect(items.map((i) => i.state)).toEqual(['applied', 'failed', 'not started']);
		expect(items[1]?.reason).toBe('unhealthy: rolled back');
	});

	it('stops when the backend refuses to start', async () => {
		const items = [item('a'), item('b')];
		const { r } = runner({ a: new Error('the plan changed; review it again') });
		expect(await applyAll(items, r)).toBe(false);
		expect(items[0]).toMatchObject({
			state: 'failed',
			reason: 'the plan changed; review it again'
		});
		expect(items[1]?.state).toBe('not started');
	});

	it('applies a destructive plan only when confirmed, and says so', async () => {
		const items = [item('a', { destructive: ['volume data'] }), item('b', { destructive: ['x'] })];
		const { r, started } = runner({});
		expect(await applyAll(items, r, (i) => i.stack === 'b')).toBe(true);
		expect(started).toEqual([{ stack: 'b', confirm: true }]);
		expect(items.map((i) => i.state)).toEqual(['skipped', 'applied']);
	});

	it('runs again from where it stopped', async () => {
		const items = [item('a'), item('b')];
		items[0]!.state = 'applied';
		items[1]!.state = 'failed';
		const { r, started } = runner({});
		expect(await applyAll(items, r)).toBe(true);
		expect(started.map((s) => s.stack)).toEqual(['b']);
	});

	it('keeps following through a few failed polls, not a forgotten job', async () => {
		let polls = 0;
		const flaky: Runner = {
			start: async (it) => job(it.stack, 'running'),
			job: async (it) => {
				if (++polls < 3) throw new Error('network');
				return job(it.stack, 'succeeded');
			},
			sleep: async () => {}
		};
		const items = [item('a')];
		expect(await applyAll(items, flaky)).toBe(true);

		const forgot: Runner = {
			...flaky,
			job: async () => {
				throw new NotFoundError('gone');
			}
		};
		const again = [item('a')];
		expect(await applyAll(again, forgot)).toBe(false);
		expect(again[0]?.reason).toMatch(/no longer knows this job/);
	});
});
