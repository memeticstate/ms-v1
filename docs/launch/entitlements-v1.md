# Memetic State Entitlements v1

## Outcome

Entitlements v1 turns the supporter-utility thesis into a real, auditable account boundary without activating a transferable token.

- ChatGPT sign-in owns the account session.
- A one-time EIP-191 signature proves and links an EVM wallet.
- The free Field plan includes five durable, cross-device Watchtower slots.
- Founding, ordinary paid, administrative and future token grants share one server-side allowance model.
- Monthly usage is recorded in idempotent product units.
- Premium Interpretation can be granted by a configured, quorum-verified holder check; the adapter remains disabled until an operator explicitly enables it.
- Canonical events, methodology, integrity and rankings remain public.

## Identity and proof

The Sites dispatcher owns authentication. Memetic State does not issue its own password or session cookie. A wallet signature is an ownership attestation attached to that account, not the login mechanism.

Each wallet challenge binds:

- The stable account ID.
- The wallet address.
- Robinhood Chain ID 4663.
- A unique challenge ID.
- The Site origin.
- Issue and expiry times.

Challenges expire after five minutes and are consumed once. Signing does not submit a transaction or approve spending.

## Capacity model

| Capability | Field | Founding | Researcher | Team |
| --- | ---: | ---: | ---: | ---: |
| Durable Watchtower slots | 5 | 50 | 100 | 500 |
| Alert routes | 0 | 2 | 3 | 10 |
| Reports per month | 0 | 8 | 20 | 100 |
| Export rows per month | 0 | 25,000 | 100,000 | 1,000,000 |
| API requests per month | 0 | 10,000 | 50,000 | 500,000 |
| Team seats | 1 | 3 | 1 | 5 |

These are initial product limits, not token economics. Paid and token-backed grants resolve into the same capability vocabulary. Active grants use the highest applicable allowance per capability rather than stacking silently.

## Durable records

- `member_profiles`: account identity and display metadata.
- `wallet_link_challenges`: expiring, one-time ownership proofs.
- `linked_wallets`: verified account-to-wallet links.
- `token_gate_checks`: short-lived, auditable holder-verification results.
- `entitlement_grants`: time-bounded capacity sources.
- `entitlement_usage`: idempotent monthly usage units.
- `watchtower_watches`: cross-device saved launch state.

## Premium holder gate

The first token-backed surface is intentionally narrow: a linked wallet can unlock Premium Interpretation when its current balance is at least 5 basis points (0.05%) of the configured token's total supply on Robinhood Chain. Raw PONS evidence, methodology, integrity and rankings stay public.

The server checks `totalSupply()` and `balanceOf(wallet)` against a quorum of independent Robinhood Chain RPC providers. Eligibility uses integer math (`balance * 10,000 >= totalSupply * 5`), never a floating-point percentage. Responses are cached for ten minutes, checks that cannot reach quorum fail closed, and the active grant is revoked when a wallet falls below the threshold or the check expires.

Runtime activation requires all of the following production bindings:

- `MEMETIC_TOKEN_ENTITLEMENTS_ENABLED=true`.
- `MEMETIC_TOKEN_CONTRACT_ADDRESS=<the deployed token contract>`.
- At least two healthy RPC providers (managed URLs may be supplied through `MEMETIC_TOKEN_RPC_URLS`; the adapter also has public Robinhood Chain fallbacks).

The adapter reports `disabled`, `configuration_required` or `ready`. A missing or malformed contract address, insufficient provider quorum, chain mismatch, stale block set or disagreeing provider results never grants access. Wallet linking itself remains a signature-only ownership proof; it does not submit a transaction or request spending approval.

## Public boundary

The following never require the Passport or a token:

- Canonical PONS events and protocol state.
- Evidence provenance and collection integrity.
- Methodology and score definitions.
- Rankings and ordinary public research views.
- Device-local watchlists and public exports already available in the product.

The Passport meters server persistence and future scarce services. It does not meter truth.
