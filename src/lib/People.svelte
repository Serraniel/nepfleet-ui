<script lang="ts">
	import {
		type Backend,
		type UserInfo,
		VerifyFirstError,
		fetchUsers,
		removeAccess
	} from '#lib/backend.ts';
	import { verifyIdentity } from '#lib/login.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = { backend: Backend; token: string };
	let { backend, token }: Props = $props();

	let users = $state<UserInfo[] | null | undefined>(undefined);
	let error = $state('');
	let busy = $state(false);

	async function load() {
		try {
			users = await fetchUsers(backend, token);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void load();
	});

	async function remove(user: string, passkey: string | null) {
		busy = true;
		error = '';
		const send = () => removeAccess(backend, token, user, passkey);
		try {
			try {
				await send();
			} catch (e) {
				if (!(e instanceof VerifyFirstError)) throw e;
				await verifyIdentity(backend);
				await send();
			}
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<h3>People</h3>
{#if users === undefined && !error}
	<p class="muted">Loading…</p>
{:else if users === null}
	<p class="muted">No accounts on this backend: it signs in with tokens only.</p>
{:else if users}
	<ul class="people">
		{#each users as u (u.name)}
			<li>
				<div class="who">
					<strong>{u.name}</strong>
					<span class="muted"
						>{u.external
							? 'through the identity provider'
							: `${u.passkeys.length} passkey(s)`}{u.codes ? ', sign-in codes on' : ''}</span
					>
					<Button variant="danger" disabled={busy} onclick={() => remove(u.name, null)}
						>Remove person</Button
					>
				</div>
				{#if u.passkeys.length}
					<ul class="keys">
						{#each u.passkeys as p (p.id)}
							<li>
								<code>{p.name}</code>
								<span class="muted"
									>{p.synced ? 'synced' : 'security key or phone'}, used {p.uses} time(s)</span
								>
								{#if p.locked}<strong class="error">Locked: may have been copied</strong>{/if}
								<Button variant="ghost" disabled={busy} onclick={() => remove(u.name, p.id)}
									>Remove passkey</Button
								>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
	.people,
	.keys {
		list-style: none;
		padding: 0;
	}
	.keys {
		padding-left: 1rem;
	}
	.who,
	.keys li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.2rem 0;
	}
	.muted {
		color: var(--muted);
	}
	.error {
		color: var(--err);
	}
</style>
