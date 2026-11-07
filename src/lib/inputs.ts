// SPDX-License-Identifier: AGPL-3.0-or-later

/** A template input as the catalogue describes it (template spec). */
export interface TemplateInput {
	name: string;
	type: string;
	title?: string;
	description?: string;
	required?: boolean;
	default?: string;
	options?: string[];
	pattern?: string;
}

// The same rules as nepfleet's render.CheckInput, so the wizard and the
// backend agree on what is valid.
const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const PATH_NAME = /^[a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?$/;
const DEVICE = /^\/dev\/[A-Za-z0-9._+@/-]+$/;

/** Types where an empty value means "unset" (the default applies). */
export const TYPED = new Set(['enum', 'bool', 'int', 'hostname', 'url', 'email', 'gpu']);

/** Checks one value; returns an error message, or '' when valid. */
export function checkInput(inp: TemplateInput, v: string): string {
	if (v === '') return inp.required && !inp.default ? 'Required' : '';
	switch (inp.type) {
		case 'hostname':
			if (v.length > 253 || !HOSTNAME.test(v)) return 'Not a host name';
			break;
		case 'url': {
			let u: URL | undefined;
			try {
				u = new URL(v);
			} catch {
				/* invalid */
			}
			if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || !u.host)
				return 'Not an http(s) URL';
			break;
		}
		case 'email':
			if (!/^[^\s@<>"]+@[^\s@<>"]+$/.test(v)) return 'Not an e-mail address';
			break;
		case 'int':
			if (!/^[+-]?\d+$/.test(v)) return 'Not an integer';
			break;
		case 'bool':
			if (v !== 'true' && v !== 'false') return 'true or false';
			break;
		case 'enum':
			if (!inp.options?.includes(v)) return `One of ${inp.options?.join(', ')}`;
			break;
		case 'gpu':
			if (!['none', 'intel', 'amd', 'nvidia'].includes(v)) return 'none, intel, amd or nvidia';
			break;
		case 'device':
			if (!DEVICE.test(v) || v.includes('..')) return 'A device path under /dev';
			break;
		case 'path':
			if (v.startsWith('@')) {
				if (!PATH_NAME.test(v.slice(1))) return 'A path name from fleet.yaml spec.paths';
			} else if (!v.startsWith('/') && !v.startsWith('./')) {
				return 'Absolute, or starting with ./';
			}
			break;
	}
	if (inp.pattern) {
		let re: RegExp | undefined;
		try {
			re = new RegExp(inp.pattern);
		} catch {
			return ''; // Go RE2 syntax JS cannot read: the backend checks it
		}
		if (!re.test(v)) return `Must match ${inp.pattern}`;
	}
	return '';
}

/** Quotes a word for a POSIX shell. */
export function shellQuote(s: string): string {
	return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

/** Stack names follow nepfleet's rule. */
export const STACK_NAME = /^[a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?$/;

/**
 * The `nepfleet new` command for the wizard's answers. Secret inputs are
 * left out on purpose: nepfleet new asks for them, so they never pass
 * through the browser or land in shell history.
 */
export function newCommand(
	template: string,
	stack: string,
	target: string,
	inputs: TemplateInput[],
	values: Record<string, string>
): string {
	const words = ['nepfleet', 'new', template];
	if (stack && stack !== template) words.push(stack);
	if (target && target !== 'local') words.push('--target', target);
	for (const inp of inputs) {
		if (inp.type === 'secret') continue;
		const v = values[inp.name] ?? '';
		if (v === '' || v === inp.default) continue;
		words.push('--set', `${inp.name}=${v}`);
	}
	return words.map(shellQuote).join(' ');
}
