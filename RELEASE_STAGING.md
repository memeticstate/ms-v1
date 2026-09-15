# Memetic State: Simple experience staging review

Base: `infra/cloudflare-staging-v62` at `e4d30bc6eefe65b370cdb4df5ac32a26ac5d84fc`.
Review branch: `work/simple-experience-v62`. Target: `infra/cloudflare-staging-v62`.

This change is implemented and locally verified. It has not been deployed to the staging Worker or production.

## Release ledger

- Implemented: default `/app` with NOW, CHANGED and NEW, token search, and desktop/mobile navigation.
- Implemented: `/app/token/[address]` Token Brief with deterministic state, dated transition, trades, actors, trade activity versus prior window, current sampled holders, source coverage, and progressive evidence disclosure.
- Implemented: Ask, Save and Full evidence actions preserve the selected token.
- Implemented: dedicated `/app/observe`, `/app/research` and `/app/saved`; all existing Observatory instruments retained.
- Implemented: ASK / TOKEN BRIEF / SAVED navigation for holder research; existing server access controls retained.
- Implemented: bounded read-only state-history and state-change endpoints backed by persisted D1 observations. Hourly heartbeat observations no longer obscure material transitions.
- Implemented: Saved supports every canonical state and displays deterioration without synthesizing discovery alerts. New-device saves preserve existing account watch rules and dates.
- Implemented: **Canonical Robinhood Chain explorer upgraded to Robinhood Etherscan across token, transaction, contract and wallet surfaces.** Saved historical source links normalize on display; API/RPC destinations remain separate.
- Implemented: existing deep links and documentation links lead to the new dedicated routes, preserving token, habitat and observation-window context.

The RPC collector, deterministic classifier, D1 schema, production hosting configuration, and holder threshold were not replaced. This is not a new scoring engine or an Etherscan API ingestion migration.

## Evidence semantics

- NOW selects canonical eligible readings and canonical stress only while state evidence is current. Stress remains ineligible for the discovery shortlist.
- CHANGED shows the latest material persisted transition per token within 24 hours (up to 60), independently of current activity rank. Its dated states are not presented as current token metrics.
- NEW uses confirmed launch events from the bounded factory window. Metrics appear only when matching current canonical evidence includes the launch block.
- Percent change means trade-count change versus the prior indexed pulse, not price return. A missing baseline stays missing.
- Holder counts use the existing ten-minute observation freshness rule and retain their sampled basis.
- `stressed → unverified` means stress is no longer confirmed; it is not recovery. Current guidance takes precedence over an older transition into a different state.
- Raw quote amounts are shown as flow direction until normalized amounts are available; no quote-token decimals are guessed.
- Missing, delayed, failed and future-dated evidence are explicit. X/social configuration is never inferred from trading data.

## Completed verification

- Existing lockfile installation succeeded without dependency changes.
- `npm test`: production build succeeded; **179 tests passed, zero failed**.
- `npx tsc --noEmit --incremental false`: passed.
- `git diff --check`: passed.
- Added executable regression coverage for navigation, rendered routes, legacy links, state-history queries, stress/recovery, freshness, sampled holders, unknown baselines, raw flow direction, Watchtower state validation, and explorer/API separation.
- Production Wrangler configuration, RPC transport, deterministic research classifier, dependency versions and D1 migrations are unchanged.

## Required staging review — still pending

1. Deploy this branch to `memetic-state-staging` only. The compiled deployment configuration is `dist/server/wrangler.json` and the expected public staging origin is `https://memetic-state-staging.memeticstate.workers.dev`.
2. Capture desktop and approximately 390px mobile screenshots of Simple NOW, CHANGED, Token Brief, and the advanced Observatory. Review wrapping, tap targets, scrolling, search, drawers and navigation on the actual deployment.
3. Smoke-test Privy wallet/email/Google login, below-threshold denial, 0.1% holder access, access expiry and refresh, Research, and Save/account restore.
4. Compare visible deterministic readings against the existing canonical evidence on the same tokens and observation blocks.
5. Observe collector freshness and persistent state memory for several hours.
6. Verify rendered external explorer links, including saved research and wallet UI, use Robinhood Etherscan.

The user explicitly approved publishing these changes to `memeticstate/ms-v1` on `work/simple-experience-v62`. GitHub write access was rechecked and is now enabled (`push: true`); the initial publication blocker has been resolved.

Cloudflare deployment credentials were unavailable in this Work session. Browser policy blocked the local preview and shared-file preview, so no screenshots or live authentication/soak results are claimed. The production build and executable tests were verified separately from browser review.

`memeticstate.com`, its DNS, the existing ChatGPT Sites production, and the running staging deployment were left unchanged. Production-domain cutover remains a separate later release decision after the checks above pass.
