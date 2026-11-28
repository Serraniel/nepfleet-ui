<script lang="ts">
	import {
		type Backend,
		type StackInput,
		ConflictError,
		VerifyFirstError,
		fetchStackInputs,
		setStackInputs
	} from '#lib/backend.ts';
	import { splitInputs } from '#lib/inputs.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import Button from '#lib/ui/Button.svelte';

	/**
	 * A stack's settings: the inputs of its template, as a form. What the
	 * stack waits for (a newer template asks for a value) comes first; secrets
	 * are written, never shown. One save sets them all in one commit, and the
	 * backend knows which go encrypted.
	 */
	type Props = {
		backend: Backend;
		token: string;
		stack: string;
		/** After a save: the plan changed. */
		onSaved?: () => void;
		/** Inputs not to offer, such as the ones sign-on fills. */
		hide?: (name: string) => boolean;
	};
	let { backend, token, stack, onSaved, hide }: Props = $props();

	let inputs = $state<StackInput[] | null>(null);
	let loadError = $state('');
	let values = $state<Record<string, string>>({});
	let busy = $state(false);
	let error = $state('');
	let done = $state('');

	async function load() {
		loadError = '';
		try {
			const ins = await fetchStackInputs(backend, token, stack);
			inputs = ins;
			const v: Record<string, string> = {};
			for (const i of ins) v[i.name] = i.secret ? '' : (i.value ?? '');
			values = v;
		} catch (e) {
			// An older backend has no inputs API: the section stays away.
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void load();
	});

	const missing = $derived((inputs ?? []).filter((i) => i.missing));
	// The rest in the creation form's order: required ones first, then the
	// others with inputs that share a prefix (OIDC_*) kept together.
	const others = $derived.by(() => {
		const { required, optional } = splitInputs(
			(inputs ?? []).filter((i) => !i.missing && !hide?.(i.name))
		);
		return [...required.map((i) => ({ prefix: '', inputs: [i] })), ...optional];
	});
	const otherCount = $derived(others.reduce((n, g) => n + g.inputs.length, 0));

	/** What changed: secrets typed in, other values that differ from the stored one. */
	function changed(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const i of inputs ?? []) {
			const v = values[i.name] ?? '';
			if (v === '') continue;
			if (i.secret || v !== (i.value ?? '')) out[i.name] = v;
		}
		return out;
	}
	const dirty = $derived(Object.keys(changed()).length > 0);
	const missingFilled = $derived(missing.every((i) => (values[i.name] ?? '') !== ''));

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const send = changed();
		if (busy || Object.keys(send).length === 0) return;
		busy = true;
		error = '';
		done = '';
		try {
			let commit: string;
			try {
				commit = await setStackInputs(backend, token, stack, send);
			} catch (err) {
				if (!(err instanceof VerifyFirstError)) throw err;
				await verifyIdentity(backend);
				commit = await setStackInputs(backend, token, stack, send);
			}
			done = `Saved ${Object.keys(send).sort().join(', ')} in ${commit.slice(0, 7)}. A stack that applies by itself does so now; otherwise apply it below.`;
			await load();
			onSaved?.();
		} catch (err) {
			error =
				err instanceof ConflictError
					? `${err.message}. Try again in a moment.`
					: err instanceof Error
						? err.message
						: String(err);
		} finally {
			busy = false;
		}
	}

	const kind = (i: StackInput) =>
		i.secret
			? 'password'
			: i.type === 'email'
				? 'email'
				: i.type === 'int'
					? 'number'
					: i.type === 'url'
						? 'url'
						: 'text';
</script>

{#snippet field(i: StackInput)}
	{@const id = `input-${stack}-${i.name}`}
	<div class="field">
		<label for={id}>
			{i.title || i.name}{#if i.missing}<span class="req" aria-hidden="true">*</span>{/if}
			<code>{i.name}</code>
		</label>
		{#if i.type === 'bool'}
			<select {id} bind:value={values[i.name]} required={i.missing}>
				<option value="">{i.default ? `default (${i.default})` : '—'}</option>
				<option value="true">true</option>
				<option value="false">false</option>
			</select>
		{:else if i.type === 'enum' && i.options?.length}
			<select {id} bind:value={values[i.name]} required={i.missing}>
				<option value="">{i.default ? `default (${i.default})` : '—'}</option>
				{#each i.options as o (o)}<option value={o}>{o}</option>{/each}
			</select>
		{:else if i.type === 'text'}
			<textarea
				{id}
				bind:value={values[i.name]}
				rows="3"
				placeholder={i.default}
				required={i.missing}></textarea>
		{:else}
			<input
				{id}
				type={kind(i)}
				bind:value={values[i.name]}
				required={i.missing}
				pattern={i.pattern}
				autocomplete={i.secret ? 'new-password' : 'off'}
				placeholder={i.secret && i.set ? 'unchanged (kept encrypted)' : i.default}
			/>
		{/if}
		{#if i.description}<small>{i.description}</small>{/if}
	</div>
{/snippet}

{#if inputs && inputs.length > 0}
	<section aria-labelledby="inputs-h-{stack}" class:needs={missing.length > 0}>
		<h2 id="inputs-h-{stack}">{missing.length > 0 ? 'Needs values' : 'Settings'}</h2>
		<form onsubmit={save}>
			{#if missing.length > 0}
				<p role="status">
					The stack's template asks for {missing.length === 1 ? 'a value' : 'values'} it doesn't have
					yet, so it waits. Fill {missing.length === 1 ? 'it' : 'them'} in: secrets are stored encrypted
					and never shown again.
				</p>
				{#each missing as i (i.name)}{@render field(i)}{/each}
			{/if}
			{#if others.length > 0}
				<details open={missing.length === 0 ? undefined : false}>
					<summary>
						{missing.length > 0 ? 'Other settings' : 'Change settings'} ({otherCount})
					</summary>
					{#each others as g (g.prefix || g.inputs.map((i) => i.name).join())}
						{#if g.prefix}
							<details class="group">
								<summary>{g.prefix} ({g.inputs.length})</summary>
								{#each g.inputs as i (i.name)}{@render field(i)}{/each}
							</details>
						{:else}
							{#each g.inputs as i (i.name)}{@render field(i)}{/each}
						{/if}
					{/each}
				</details>
			{/if}
			<Button
				variant={missing.length > 0 ? 'primary' : 'default'}
				type="submit"
				{busy}
				disabled={!dirty || (missing.length > 0 && !missingFilled)}
			>
				{busy ? 'Saving… (waits for a running apply)' : 'Save'}
			</Button>
		</form>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if done}<p role="status">{done}</p>{/if}
	</section>
{:else if loadError && !loadError.includes('404')}
	<p class="muted">Settings: {loadError}</p>
{/if}

<style>
	section.needs {
		border: 1px solid var(--accent);
		border-radius: calc(var(--radius) + 4px);
		padding: 1rem 1.1rem;
		margin: 1rem 0;
	}
	form {
		display: grid;
		gap: 0.8rem;
		max-width: 40rem;
	}
	.field {
		display: grid;
		gap: 0.25rem;
	}
	label code {
		color: var(--muted);
		font-size: 0.85em;
		margin-left: 0.4rem;
	}
	.req {
		color: var(--err);
		margin-left: 0.15rem;
	}
	input,
	select,
	textarea {
		font: inherit;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: inherit;
	}
	small,
	.muted {
		color: var(--muted);
	}
	summary {
		cursor: pointer;
		margin: 0.3rem 0;
	}
	details .field {
		margin: 0.6rem 0;
	}
	details.group {
		border-left: 3px solid var(--border);
		padding-left: 0.8rem;
	}
	.error {
		color: var(--err);
	}
</style>
