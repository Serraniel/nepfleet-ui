// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Job, NotFoundError, type Plan } from './backend.ts';

/** Failed job polls in a row before giving up on following an apply. */
const MAX_MISSES = 5;

/** A manual stack whose current plan has changes, and how applying it went. */
export interface Pending {
	backend: string;
	stack: string;
	plan: Plan;
	state: 'pending' | 'applying' | 'applied' | 'failed' | 'skipped' | 'not started';
	/** Why it failed, or why it was skipped. */
	reason?: string;
	progress?: Job['progress'];
}

/**
 * Whether Apply all may take a plan: it has changes and an id to apply it
 * by. A stack's first apply is left to its page, as the backend's own
 * reconcile does.
 */
export function applicable(p: Plan): boolean {
	return !!p.id && !p.first && (p.changes?.length ?? 0) > 0;
}

export interface Runner {
	/** Starts applying the item's plan; confirm is true for a confirmed destructive plan. */
	start(item: Pending, confirm: boolean): Promise<Job>;
	/** The job's state now. */
	job(item: Pending, id: string): Promise<Job>;
	sleep(ms: number): Promise<void>;
	/** True once the page is left: stop following (the backend goes on). */
	stopped?(): boolean;
}

/**
 * Applies the items one after another, in order, and stops at the first
 * failure: the rest are marked "not started". A destructive plan is only
 * applied when confirmed(item) says so; otherwise it is skipped. Items are
 * changed in place, so the page shows their progress. Returns whether every
 * item that ran succeeded.
 */
export async function applyAll(
	items: Pending[],
	runner: Runner,
	confirmed: (item: Pending) => boolean = () => false
): Promise<boolean> {
	for (const [i, item] of items.entries()) {
		if (runner.stopped?.()) return false;
		if (item.state === 'applied') continue;
		const destructive = (item.plan.destructive?.length ?? 0) > 0;
		if (destructive && !confirmed(item)) {
			item.state = 'skipped';
			item.reason = 'destructive: not confirmed';
			continue;
		}
		item.state = 'applying';
		item.reason = undefined;
		item.progress = undefined;
		let job: Job;
		try {
			job = await runner.start(item, destructive);
			let misses = 0;
			while (job.state === 'running') {
				item.progress = job.progress;
				await runner.sleep(2000);
				if (runner.stopped?.()) return false;
				try {
					job = await runner.job(item, job.id);
					misses = 0;
				} catch (e) {
					// The apply goes on without us (a restart, the network): ask
					// again a few times. A backend that forgot the job can't say.
					if (e instanceof NotFoundError)
						throw new Error("The backend no longer knows this job; check the stack's plan.");
					if (++misses > MAX_MISSES) throw e;
				}
			}
		} catch (e) {
			job = {
				id: '',
				stack: item.stack,
				kind: 'apply',
				state: 'failed',
				error: e instanceof Error ? e.message : String(e),
				log: '',
				by: ''
			};
		}
		item.progress = undefined;
		if (job.state === 'succeeded') {
			item.state = 'applied';
			continue;
		}
		item.state = 'failed';
		item.reason = job.error || 'the apply failed';
		for (const rest of items.slice(i + 1)) {
			if (rest.state === 'pending') rest.state = 'not started';
		}
		return false;
	}
	return true;
}
