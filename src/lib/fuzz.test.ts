// Property-based tests: random input where the app meets data it doesn't
// control (a backend's answers, a template's inputs, a person's values).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fetchJob, fetchStacks, fetchTemplates } from './backend.ts';
import { checkInput, newCommand, shellQuote } from './inputs.ts';

/** What a POSIX shell makes of the words shellQuote produced. */
function shellWords(line: string): string[] {
	const words: string[] = [];
	let cur = '';
	let inWord = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === "'") {
			const end = line.indexOf("'", i + 1);
			cur += line.slice(i + 1, end);
			i = end;
			inWord = true;
		} else if (c === '\\') {
			cur += line[++i];
			inWord = true;
		} else if (c === ' ') {
			if (inWord) words.push(cur);
			cur = '';
			inWord = false;
		} else {
			cur += c;
			inWord = true;
		}
	}
	if (inWord) words.push(cur);
	return words;
}

describe('fuzz: shell quoting', () => {
	it('any word comes back as exactly that word', () => {
		fc.assert(
			fc.property(fc.string({ unit: 'binary' }), (s) => {
				expect(shellWords(shellQuote(s))).toEqual([s]);
			})
		);
	});
	it('the nepfleet new command keeps each value one argument', () => {
		fc.assert(
			fc.property(
				fc.dictionary(fc.stringMatching(/^[A-Z_]{1,8}$/), fc.string({ unit: 'binary' })),
				(values) => {
					const inputs = Object.keys(values).map((name) => ({ name, type: 'string' }));
					const words = shellWords(newCommand('app', 'app', 'local', inputs, values));
					const sets = words.filter((_, i) => words[i - 1] === '--set');
					for (const [k, v] of Object.entries(values)) {
						if (v !== '') expect(sets).toContain(`${k}=${v}`);
					}
				}
			)
		);
	});
});

describe('fuzz: input checks', () => {
	it('never throw, whatever the template and the value', () => {
		const types = [
			'string',
			'hostname',
			'url',
			'email',
			'int',
			'bool',
			'enum',
			'gpu',
			'device',
			'path',
			'secret',
			'x'
		];
		fc.assert(
			fc.property(
				fc.record({
					name: fc.string(),
					type: fc.constantFrom(...types),
					required: fc.boolean(),
					default: fc.option(fc.string(), { nil: undefined }),
					options: fc.option(fc.array(fc.string()), { nil: undefined }),
					pattern: fc.option(fc.string({ maxLength: 12 }), { nil: undefined })
				}),
				fc.string({ unit: 'binary' }),
				(inp, v) => {
					expect(typeof checkInput(inp, v)).toBe('string');
				}
			)
		);
	});
});

describe('fuzz: backend answers', () => {
	const backend = { id: 'b', url: 'https://fleet.example.org' };
	const answering = (body: unknown) =>
		(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
	it('odd JSON is refused as an Error, never a crash', async () => {
		await fc.assert(
			fc.asyncProperty(fc.jsonValue(), async (body) => {
				for (const call of [
					() => fetchJob(backend, 't', 'j', answering(body)),
					() => fetchStacks(backend, 't', answering(body)),
					() => fetchTemplates(backend, 't', answering(body))
				]) {
					try {
						await call();
					} catch (e) {
						// An Error saying the answer was unexpected, not a TypeError
						// from reading fields that aren't there.
						expect(e).toBeInstanceOf(Error);
						expect(e).not.toBeInstanceOf(TypeError);
					}
				}
			}),
			{ numRuns: 200 }
		);
	});
});
