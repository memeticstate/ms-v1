# Memetic State identity v2 — Privy migration

## Goal

Replace ChatGPT-first authentication with a Memetic State-owned identity graph powered by Privy while preserving D1 as the canonical product database.

Public research remains anonymous. Authentication is only required for durable Watchtower state, alerts, future paid research services, and holder-gated Premium Interpretation.

## Identity model

A Memetic State member is keyed by a stable provider user ID and may have multiple linked accounts:

- external EVM wallet(s),
- email,
- Google,
- future social or embedded-wallet accounts.

Privy authenticates the session. D1 stores product state, entitlements, linked wallets, token-gate results, usage, Watchtower state, and operator-visible member metadata.

## Rollout

The code ships with a migration switch so production does not lose the currently working Research Passport before Privy credentials are installed.

- `MEMETIC_AUTH_MODE=chatgpt` — current Sites dispatcher auth.
- `MEMETIC_AUTH_MODE=privy` — Privy access-token auth.

Client configuration:

- `NEXT_PUBLIC_PRIVY_APP_ID=<Privy app id>`

Server configuration:

- `PRIVY_APP_ID=<same app id>` (falls back to `NEXT_PUBLIC_PRIVY_APP_ID` where available)
- `PRIVY_APP_SECRET=<server secret>`
- optional `PRIVY_JWT_VERIFICATION_KEY=<verification key>` to avoid remote key discovery during token verification
- `MEMETIC_AUTH_MODE=privy`

Do not switch `MEMETIC_AUTH_MODE` until the Privy app is configured and a smoke test succeeds.

## Privy dashboard

Configure login methods in this order:

1. Wallet
2. Email
3. Google

Do not automatically create an embedded wallet in v2. The first token gate should evaluate wallets the user intentionally controls. Embedded wallets can be introduced later when Memetic State needs transaction signing.

Add `memeticstate.com` as the production origin/base domain and enable the production environment before launch.

## Robinhood Chain

Privy supports custom EVM-compatible chains. Memetic State uses Robinhood Chain ID `4663`. The client provider defines it as a custom viem chain and includes it in `supportedChains`.

Holder checks remain server-side and continue to use the existing quorum RPC adapter. Privy is an identity/wallet connector; it does not become the source of truth for token eligibility.

## Backend contract

Authenticated client requests carry:

`Authorization: Bearer <Privy access token>`

The backend verifies the token and maps the Privy DID to the existing `member_profiles.user_id` key. Existing entitlement tables therefore require no destructive migration.

During rollout the auth adapter can still read the current Sites authentication headers while `MEMETIC_AUTH_MODE=chatgpt`.

## Launch smoke test

Before flipping production:

1. Anonymous visitor can open the entire public observatory.
2. Wallet login creates/updates one `member_profiles` row.
3. Email login creates/updates one `member_profiles` row.
4. Logging back in restores Watchtower state.
5. Connecting a second wallet does not create a second product account.
6. Wallet ownership is visible in `linked_wallets`.
7. Holder-gate refresh is server verified and fails closed without quorum.
8. Logout removes access to durable account state but not public research.
9. No access token, identity token, app secret, signature, or wallet challenge is written to application logs.
10. The admin/member ledger can enumerate members without exposing secrets.
