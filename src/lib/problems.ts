// SPDX-License-Identifier: AGPL-3.0-or-later
import type { StackInfo, StackProblem } from './backend.ts';

/**
 * A stack's problems, as the backend lists them: kept only when well formed,
 * so an odd answer can't break the list. Servers before this field have none.
 */
export function problemsOf(s: Pick<StackInfo, 'problems'>): StackProblem[] {
	if (!Array.isArray(s.problems)) return [];
	return s.problems.filter(
		(p): p is StackProblem => typeof p?.kind === 'string' && typeof p?.message === 'string'
	);
}

export function needsAttention(s: Pick<StackInfo, 'problems'>): boolean {
	return problemsOf(s).length > 0;
}

/** How many of these stacks have problems. */
export function attentionCount(list: readonly Pick<StackInfo, 'problems'>[]): number {
	return list.filter(needsAttention).length;
}

/** The missing inputs' names as people read them: their titles, else the name. */
export function missingNames(p: StackProblem): string[] {
	return (p.inputs ?? []).map((i) => i.title || i.name);
}

/** A few words for the Stacks list, e.g. "Missing: Admin e-mail". */
export function problemShort(p: StackProblem): string {
	switch (p.kind) {
		case 'missing-input': {
			const names = missingNames(p);
			return names.length ? 'Missing: ' + names.join(', ') : 'Missing values';
		}
		case 'template':
			return "Template can't be used";
		case 'plan':
			return "Can't be planned";
		case 'update-blocked':
			return 'Update waits for you';
		default:
			return 'Needs attention';
	}
}

/** The first problem in a few words, and how many more: one line per row. */
export function rowText(s: Pick<StackInfo, 'problems'>): string {
	const [first, ...rest] = problemsOf(s);
	if (!first) return '';
	return problemShort(first) + (rest.length ? ` (+${rest.length})` : '');
}

/** How to fix one, for the stack page. */
export function problemFix(p: StackProblem): string {
	switch (p.kind) {
		case 'missing-input':
			return "Fill in the settings below and save. Until then it isn't planned, so it gets no updates.";
		case 'template':
			return 'Pick a template version this NepFleet can use in Edit files, or update NepFleet.';
		case 'plan':
			return 'Look at the plan below for the details, then fix it in Edit files.';
		case 'update-blocked':
			return 'Review the plan below and apply it, or set the template version in Edit files.';
		default:
			return '';
	}
}

/** "9 stacks · 2 need attention", for a backend's card. */
export function stackCount(list: readonly Pick<StackInfo, 'problems'>[]): string {
	const n = list.length;
	const bad = attentionCount(list);
	const total = `${n} ${n === 1 ? 'stack' : 'stacks'}`;
	return bad ? `${total} · ${bad} ${bad === 1 ? 'needs' : 'need'} attention` : total;
}
