# Governance Baseline / Ratchet

A browser-first tool that makes Spectral/Spotlight governance **adoptable on a legacy estate
without a wall of red** — snapshot the violations you have today, then ratchet so the build
**fails only NEW violations** while the debt you already knew about burns down to zero. No
backend, no accounts; runs entirely in your browser. Live at
**[baseline.apicommons.org](https://baseline.apicommons.org)**.

## Why this exists

Point a real ruleset at an API that predates it and everything lights up at once: every
operation missing a description, every legacy path without tags, every schema quirk you'd
already triaged. The signal drowns — a genuinely *new* problem is indistinguishable from years
of known debt — so teams do the rational thing and turn the rules off.

Our [State of Spectral](https://apievangelist.com/) survey of ~1,000 real GitHub Actions
Spectral pipelines found this is the number-one reason governance stalls: the ruleset is
strong, but there's no honest way to switch it on. And it matches what Spectral maintainers say
out loud — introducing rules to an existing spec is finicky, because *everything becomes a
warning and the real issues drown*. The recurring ask was simply: **"warnings can't exceed N."**

A **baseline** answers that. It records the current set of violations — each fingerprinted by
**rule code + source file + normalized JSONPath**, with a count — so the ruleset can run at full
strength while the gate only reacts to what's new. A **warning budget** enforces the "can't
exceed N" ceiling. Together they let debt only ever go *down*.

## What it reports

Paste your latest `spectral lint -f json` output and a saved baseline, and it reconciles them:

- **Violations** are classified **baselined** (already in the baseline — suppressed), **new**
  (not in the baseline — **fails the build**), or **fixed** (was baselined, no longer present —
  the baseline can shrink). The headline is the **new** count: the honest failing set.
- **Warning budget** — a configurable policy: a **max total warnings** ceiling, and/or
  **"count must not increase per rule."** The gate shows pass/fail against the budget, with a
  per-rule table of baseline vs. current counts.
- **Baseline health** — **stale** entries (baselined violations that no longer occur → remove
  them to keep the baseline honest) and a **burn-down** showing how the baselined count is
  trending toward zero.

Click **Snapshot baseline** to generate and download a baseline from the current results, or
bring your own. Download the **new violations** to gate your build on, and the **shrunk
baseline** (stale entries dropped, fixed counts decremented) to commit and ratchet down.

The baseline is a small, machine-readable file:

```yaml
version: "0.1"
created: "2026-05-01"
ruleset: .spectral.yaml
entries:
  - fingerprint: "operation-tags::apis/invoices.yaml::paths//v1/legacy/get/tags"
    code: operation-tags
    source: apis/invoices.yaml
    path: paths//v1/legacy/get/tags
    count: 1
```

## Develop

```bash
npm install
npm run dev
npm run build     # → dist/
```

Pure client-side; no data build. The samples in `public/` demonstrate every state — baselined,
new, fixed, stale, and an over-budget rule.

## Privacy

Everything runs client-side. The lint results and baseline you paste never leave the page —
there is no server.

Part of the [API Commons](https://apicommons.org/tools/) governance tools, alongside
[Governance Coverage](https://github.com/api-commons/governance-coverage),
[Governance Waivers](https://github.com/api-commons/governance-waivers),
[API Validator](https://github.com/api-commons/api-validator),
[Spectral Ruleset Studio](https://github.com/api-commons/spectral-ruleset-studio), and the
[API Governance Graph](https://github.com/api-commons/api-governance-graph).

---

A project of [API Evangelist](https://apievangelist.com), maintained openly under
[API Commons](https://apicommons.org). Free to fork; API Evangelist offers expert API
governance services — including standing up a real baseline-and-ratchet rollout — when you want
help. Apache-2.0.
