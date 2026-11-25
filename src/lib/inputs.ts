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
	/** An enum input whose current value picks the text in help. */
	helpFrom?: string;
	help?: Record<string, string>;
}

/**
 * What to show under an input: the help for the current value of its
 * helpFrom input (else that input's default), else its description. The
 * same as nepfleet's Spec.HelpText.
 */
export function helpText(
	inp: TemplateInput,
	inputs: TemplateInput[],
	values: Record<string, string>
): string {
	if (inp.helpFrom && inp.help) {
		const v = values[inp.helpFrom] || inputs.find((i) => i.name === inp.helpFrom)?.default || '';
		const h = Object.hasOwn(inp.help, v) ? inp.help[v] : undefined;
		if (h !== undefined) return h;
	}
	return inp.description ?? '';
}

/** What ordering needs from an input; fits template and stack inputs. */
interface Orderable {
	name: string;
	required?: boolean;
	default?: string;
}

/** Required without a default: nothing applies unless the user fills it. */
export function needsValue(i: Orderable): boolean {
	return !!i.required && !i.default;
}

/** Inputs shown together; prefix is '' for an input on its own. */
export interface InputGroup<T> {
	prefix: string;
	inputs: T[];
}

/** The name up to the first underscore: OIDC for OIDC_ISSUER. */
function prefixOf(name: string): string {
	const at = name.indexOf('_');
	return at > 0 ? name.slice(0, at) : '';
}

/**
 * Groups inputs that share a name prefix (OIDC_*, SMTP_*), so related
 * fields stay together. A prefix only forms a group when 2+ inputs share
 * it; the group takes the place of its first member, the rest keep the
 * template's order. Templates have no group hint yet, so the prefix is
 * the best guess.
 */
export function groupInputs<T extends Orderable>(inputs: T[]): InputGroup<T>[] {
	const count = new Map<string, number>();
	for (const i of inputs) {
		const p = prefixOf(i.name);
		if (p) count.set(p, (count.get(p) ?? 0) + 1);
	}
	const out: InputGroup<T>[] = [];
	const byPrefix = new Map<string, InputGroup<T>>();
	for (const i of inputs) {
		const p = prefixOf(i.name);
		if (!p || (count.get(p) ?? 0) < 2) {
			out.push({ prefix: '', inputs: [i] });
			continue;
		}
		let g = byPrefix.get(p);
		if (!g) {
			g = { prefix: p, inputs: [] };
			byPrefix.set(p, g);
			out.push(g);
		}
		g.inputs.push(i);
	}
	return out;
}

/**
 * Splits a form's inputs: the ones that need a value first, in template
 * order; the rest (a default, or optional) grouped by prefix.
 */
export function splitInputs<T extends Orderable>(
	inputs: T[]
): { required: T[]; optional: InputGroup<T>[] } {
	return {
		required: inputs.filter(needsValue),
		optional: groupInputs(inputs.filter((i) => !needsValue(i)))
	};
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
