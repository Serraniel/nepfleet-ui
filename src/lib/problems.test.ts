import { describe, expect, it } from 'vitest';
import { ProblemsError, type StackProblem, responseError } from './backend.ts';
import {
	attentionCount,
	missingNames,
	needsAttention,
	problemFix,
	problemShort,
	problemsOf,
	rowText,
	stackCount
} from './problems.ts';

// The case from the issue: sure's template asks for ADMIN_EMAIL, which has no value.
const missing: StackProblem = {
	kind: 'missing-input',
	message: 'Required inputs without a value: Admin e-mail (ADMIN_EMAIL)',
	inputs: [{ name: 'ADMIN_EMAIL', title: 'Admin e-mail' }]
};
const sure: { name: string; problems?: StackProblem[] } = { name: 'sure', problems: [missing] };
const fine: { name: string; problems?: StackProblem[] } = { name: 'web' };

describe('stack problems', () => {
	it('come from servers that send them, and old ones have none', () => {
		expect(problemsOf(sure)).toEqual([missing]);
		expect(problemsOf(fine)).toEqual([]);
		expect(problemsOf({ problems: 'odd' as never })).toEqual([]);
		expect(problemsOf({ problems: [null, { kind: 'plan' }, missing] as never })).toEqual([missing]);
		expect(needsAttention(sure)).toBe(true);
		expect(needsAttention(fine)).toBe(false);
	});
	it('say in a few words what is wrong', () => {
		expect(problemShort(missing)).toBe('Missing: Admin e-mail');
		expect(problemShort({ kind: 'missing-input', message: 'm', inputs: [{ name: 'A' }] })).toBe(
			'Missing: A'
		);
		expect(problemShort({ kind: 'template', message: 'm' })).toBe("Template can't be used");
		expect(problemShort({ kind: 'plan', message: 'm' })).toBe("Can't be planned");
		expect(problemShort({ kind: 'update-blocked', message: 'm' })).toBe('Update waits for you');
		expect(problemShort({ kind: 'new-kind', message: 'm' })).toBe('Needs attention');
		expect(missingNames(missing)).toEqual(['Admin e-mail']);
		for (const kind of ['missing-input', 'template', 'plan', 'update-blocked'])
			expect(problemFix({ kind, message: '' })).not.toBe('');
	});
	it('show one line per row', () => {
		expect(rowText(sure)).toBe('Missing: Admin e-mail');
		expect(rowText({ problems: [missing, { kind: 'plan', message: 'x' }] })).toBe(
			'Missing: Admin e-mail (+1)'
		);
		expect(rowText(fine)).toBe('');
	});
	it('come with a plan the backend refused (422), and older answers stay plain', async () => {
		const res = (body: string, status = 422) => new Response(body, { status });
		const e = await responseError(
			res(JSON.stringify({ error: 'sure: ADMIN_EMAIL is required', problems: [missing] }))
		);
		expect(e).toBeInstanceOf(ProblemsError);
		expect(e.message).toBe('sure: ADMIN_EMAIL is required');
		expect((e as ProblemsError).problems).toEqual([missing]);
		const plain = await responseError(res('the stack cannot be read; see the server log', 500));
		expect(plain).not.toBeInstanceOf(ProblemsError);
		expect(plain.message).toBe('the stack cannot be read; see the server log');
		const odd = await responseError(res(JSON.stringify({ error: 'x', problems: 'no' })));
		expect(odd).not.toBeInstanceOf(ProblemsError);
	});
	it('are counted per backend', () => {
		expect(attentionCount([sure, fine, sure])).toBe(2);
		expect(stackCount([sure, fine])).toBe('2 stacks · 1 needs attention');
		expect(stackCount([sure, sure, fine])).toBe('3 stacks · 2 need attention');
		expect(stackCount([fine])).toBe('1 stack');
		expect(stackCount([])).toBe('0 stacks');
	});
});
