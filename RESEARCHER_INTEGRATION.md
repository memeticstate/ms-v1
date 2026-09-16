# Researcher robustness integration — 2026-09-16

Reviewed the supplied `Memetic-State-Agentic-Researcher-2026-09-15.zip` against the current app at `50f4de3c15995df99045cbdf459b43537c1a3f54`. The export is an older full-app snapshot with useful researcher improvements. It must not replace the current application wholesale.

## Decisions

| Proposal | Current implementation and decision |
| --- | --- |
| Replace the 26-second request background job | Already superseded: our runner budgets 55 seconds, the Worker awaits successful POST-triggered processing, cron also processes jobs, and single-pass synthesis is available. Preserve these improvements. This is still bounded execution, not a durable long-running workflow. |
| Retain actionable failure reasons | Integrated. HTTP status, timeout, network, incomplete output and validation failures have bounded codes in the report, run error, and Investigation steps. The failed draft or review stage is identified correctly. |
| Trim lists and allow one correction | Integrated for tool research, single-pass synthesis and review. Validate every entry and citation before trimming; check an existing thesis before offering a shape correction. One correction is shared across the whole investigation and requires at least four seconds in that stage's existing budget. |
| Configurable output token ceiling | Integrated as `MEMETIC_RESEARCH_MAX_OUTPUT_TOKENS`. Preserve our current default of **1600**, rather than copying the older export's 2400. Valid integer range: 512–32000; invalid values use the default. Applies to drafting, review and correction. |
| Usage and monetary cost tracking | Still absent; not implemented in the supplied patch. Requires recording returned usage for successful and incomplete responses, including repair attempts, and explicit model pricing/version assumptions. Run quotas are not cost accounting. |
| Other model providers | Still OpenAI-only; not implemented in the supplied patch. Defer until there is a concrete provider/model requirement and protocol-specific tests. |
| Graduated tokens marked partial | Preserve the coverage warning. The current curve source cannot describe post-graduation pool trading. A completed review and complete evidence coverage are distinct; silently calling that missing coverage complete would overstate the report. |
| Git initialization and broad formatting | Already in a tracked GitHub repository. No reinitialization, global ignore changes or unrelated reformatting. |

## Compatibility and safety

- Preserve current single-pass mode, low reasoning effort, explicit usable/unavailable citation prompts and Robinhood Etherscan links.
- Preserve tool-source tracking without requiring readers to mutate the caller's source array.
- The export validated semantics after parsing and sliced before validating discarded entries. This adaptation rejects fabricated citations even alongside a shape error or beyond the display limit, and rejects a changed thesis before repair.
- Single-pass synthesis now rejects a mixed valid/invalid citation submission entirely. Previously it dropped invalid findings while retaining the answer; the answer could still refer to the discarded claim.
- Empty mandatory uncertainty/check/falsification lists remain invalid but may receive the single shape correction. Malformed JSON, invalid tools/calls, provider failures and invented citations do not receive automatic retries. Every corrected submission is validated again.
- Normal single-pass runs use two model calls; repair permits at most three. Tool-driven runs use at most four calls including review; repair permits at most five. A repair never adds source reads, extends deadlines or resets the run quota.
- Provider response bodies are bounded to 100,000 bytes, including error bodies. Logs retain HTTP status and a bounded provider error type, not provider message text or private prompts. Stored failure codes use an explicit vocabulary rather than accepting arbitrary short strings.
- Review failure keeps collected observations and the original dated thesis. No provisional draft is published.
- Report `steps[].code` is optional, so earlier stored reports still load. Run diagnostics use the existing error field; no database migration is needed.
- No changes to collector/indexer, D1 schema, authentication, entitlement checks, quotas, Worker entrypoint, deployment configuration, domains, dependencies or app design beyond the diagnostic text.

## Operation and remaining work

Set `MEMETIC_RESEARCH_MAX_OUTPUT_TOKENS` explicitly only when there is evidence that the chosen model needs a higher ceiling. A larger ceiling and the optional correction can increase usage; neither guarantees completion inside the current deadline. The existing default is unchanged.

Inspect the failing stage and code before rerunning. For example, `analysis_http_401` indicates a provider authentication rejection, `analysis_http_429` a provider rate/quota rejection, `analysis_incomplete_max_output_tokens` an exhausted response ceiling, and `review_invalid_citation` rejected evidence attribution. No provider HTTP failure is retried automatically.

Queues/Workflows remain a reasonable separate architecture change for longer research. They need coordinated job leases, duplicate-delivery handling, holder rechecks and usage accounting; adding a queue binding alone is insufficient. The current 60-second lease and 55-second runner are retained here.

This change is source-level integration. Model behavior is tested with controlled responses; no paid live model call or authenticated production holder session is implied. The Worker named `memetic-state-staging` now serves `memeticstate.com`: any future deployment to it is a live-site change, and must preserve the custom-domain configuration.

## Validation

- Production build passed with `npm run build`.
- TypeScript passed with `bash scripts/sites-env.sh -- node_modules/.bin/tsc --noEmit --incremental false`.
- All **197 tests passed** with `bash scripts/sites-env.sh -- node --test tests/*.test.mjs`, including 34 researcher tests.
- New coverage includes HTTP diagnostics and error-body bounds, abort/deadline handling, configurable ceilings, valid list trimming, repair context and limits in both draft modes, semantic rejection before repair, independent source readers, reviewed-answer publication, shared repair exhaustion, and D1 preservation of diagnostics and prior thesis snapshots.
- No database migration, deployment or DNS change was performed.
