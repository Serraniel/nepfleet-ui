// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	type Job,
	type RemovalPlan,
	type RemovalReport,
	type RemoveRequest,
	isRemovalReport
} from './backend.ts';

/** The choices of the Remove stack dialog. */
export interface RemoveChoices {
	/** Back up the volumes first. */
	backup: boolean;
	/** Delete the volumes too; needs the stack's name typed. */
	deleteData: boolean;
	typed: string;
	/** Remove a system stack other stacks need. */
	force: boolean;
}

/** Where the dialog starts: a backup when the plan takes one, the data kept. */
export function defaultChoices(plan: RemovalPlan): RemoveChoices {
	return { backup: plan.backup, deleteData: false, typed: '', force: false };
}

/** Why the Remove button is off, or '' when it may go. */
export function whyNot(plan: RemovalPlan, c: RemoveChoices): string {
	if (plan.refused.length) return `It can't be removed: ${plan.refused.join('; ')}.`;
	if (plan.blocked.length && !c.force) return 'Other stacks need it: tick Remove anyway to go on.';
	if (c.backup && plan.backup && plan.backupUnavailable)
		return `No backup can be taken: ${plan.backupUnavailable}. Untick Back up first to remove it without one.`;
	if (c.deleteData && c.typed !== plan.stack) return `Type ${plan.stack} to delete its data.`;
	return '';
}

/** The stack has data to delete: volumes, or files in its working directory. */
export function hasData(plan: RemovalPlan): boolean {
	return plan.volumes.length > 0 || plan.workData.length > 0;
}

/** The request for a reviewed plan and the dialog's choices. */
export function removeRequest(plan: RemovalPlan, c: RemoveChoices): RemoveRequest {
	const req: RemoveRequest = { plan: plan.id };
	if (plan.backup && !c.backup) req.skipBackup = true;
	if (c.deleteData && hasData(plan)) {
		req.deleteData = true;
		req.confirm = c.typed;
	}
	if (c.force && plan.blocked.length) req.force = true;
	return req;
}

/** A finished removal job's report, if it sent one. */
export function reportOf(job: Job | null): RemovalReport | null {
	return job && isRemovalReport(job.result) ? job.result : null;
}
