// The baseline model: fingerprint Spectral violations, snapshot the CURRENT set
// into a machine-readable baseline, then ratchet a NEW lint result against it —
// baselined (already known → suppressed), new (fails the build), fixed (gone →
// baseline can shrink) — plus a warning budget and baseline-health checks. Pure
// data; no DOM, no network.
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// A Spectral `lint -f json` result item.
export interface Violation { code: string; message?: string; path?: (string | number)[]; severity?: number; source?: string; range?: any; }

export interface BaselineEntry {
  fingerprint: string; code: string; source?: string; path: string; count: number;
  message?: string; severity?: number;
}
export interface BaselineFile { version: string; created?: string; ruleset?: string; entries: BaselineEntry[]; }

export interface Budget { maxWarnings?: number | null; noIncreasePerRule?: boolean; }

export type ViolationState = 'baselined' | 'new' | 'fixed';
export interface ReconcileRow { v: Violation; state: ViolationState; fingerprint: string; }

export interface RuleBudgetRow { rule: string; baseline: number; current: number; delta: number; pass: boolean; }
export interface BudgetResult {
  pass: boolean;
  maxWarnings: number | null;
  totalWarnings: number;
  warningsPass: boolean;
  noIncreasePerRule: boolean;
  perRule: RuleBudgetRow[];
}
export interface ReconcileResult {
  rows: ReconcileRow[];
  counts: { total: number; baselined: number; neu: number; fixed: number };
  budgetResult: BudgetResult;
  staleEntries: BaselineEntry[];
  burndown: { baselineTotal: number; stillPresent: number; fixed: number; remaining: number; percentClosed: number };
}

const SEV = { error: 0, warn: 1, info: 2, hint: 3 } as const;

// ---- fingerprint ------------------------------------------------------------
// Normalize a JSONPath: join with '/', collapse pure-integer array indices to
// '*' so fingerprints survive array reordering on a legacy spec.
export function normalizePath(path?: (string | number)[]): string {
  return (path ?? []).map((seg) => (/^\d+$/.test(String(seg)) ? '*' : String(seg))).join('/');
}
export function fingerprint(v: Violation): string {
  return `${v.code}::${v.source ?? ''}::${normalizePath(v.path)}`;
}

// ---- snapshot ---------------------------------------------------------------
export function snapshot(violations: Violation[], meta?: { ruleset?: string; created?: string }): BaselineFile {
  const byFp = new Map<string, BaselineEntry>();
  for (const v of violations) {
    const fp = fingerprint(v);
    const existing = byFp.get(fp);
    if (existing) { existing.count++; continue; }
    byFp.set(fp, {
      fingerprint: fp, code: v.code, source: v.source, path: normalizePath(v.path),
      count: 1, message: v.message, severity: v.severity,
    });
  }
  const entries = [...byFp.values()].sort((a, b) => a.code.localeCompare(b.code) || (a.source ?? '').localeCompare(b.source ?? '') || a.path.localeCompare(b.path));
  return { version: '0.1', created: meta?.created ?? new Date().toISOString().slice(0, 10), ruleset: meta?.ruleset, entries };
}

// ---- parse / serialize ------------------------------------------------------
export function parseBaselineFile(text: string): BaselineFile {
  const t = text.trim();
  if (!t) return { version: '0.1', entries: [] };
  let doc: any;
  try { doc = JSON.parse(t); } catch { doc = parseYaml(t); }
  if (Array.isArray(doc)) doc = { version: '0.1', entries: doc };
  if (!doc || !Array.isArray(doc.entries)) throw new Error('Expected a baseline with an `entries:` list.');
  const entries: BaselineEntry[] = doc.entries.map((e: any, i: number) => {
    if (!e || !e.code) throw new Error(`Baseline entry ${i + 1} is missing a "code".`);
    const path = e.path != null ? String(e.path) : normalizePath(e.jsonpath);
    return {
      fingerprint: e.fingerprint ? String(e.fingerprint) : `${e.code}::${e.source ?? ''}::${path}`,
      code: String(e.code), source: e.source ? String(e.source) : undefined, path,
      count: Math.max(1, Number(e.count ?? 1) | 0), message: e.message, severity: e.severity,
    };
  });
  return { version: String(doc.version ?? '0.1'), created: doc.created ? String(doc.created) : undefined, ruleset: doc.ruleset ? String(doc.ruleset) : undefined, entries };
}
export function serializeBaseline(file: BaselineFile): string {
  return stringifyYaml({
    version: file.version || '0.1',
    ...(file.created ? { created: file.created } : {}),
    ...(file.ruleset ? { ruleset: file.ruleset } : {}),
    entries: file.entries.map((e) => ({
      fingerprint: e.fingerprint, code: e.code,
      ...(e.source ? { source: e.source } : {}),
      path: e.path, count: e.count,
      ...(e.message ? { message: e.message } : {}),
      ...(e.severity != null ? { severity: e.severity } : {}),
    })),
  });
}

// ---- reconcile / ratchet ----------------------------------------------------
export function reconcile(newViolations: Violation[], baseline: BaselineFile, budget: Budget = {}): ReconcileResult {
  const baseCount = new Map<string, number>();       // fingerprint → baselined count allowed to suppress
  const entryByFp = new Map<string, BaselineEntry>();
  for (const e of baseline.entries) { baseCount.set(e.fingerprint, (baseCount.get(e.fingerprint) ?? 0) + e.count); entryByFp.set(e.fingerprint, e); }

  // Classify each new violation: within a fingerprint group, the first N (the
  // baselined count) are suppressed; any surplus is NEW — the honest ratchet.
  const remaining = new Map<string, number>(baseCount);
  const seenNow = new Map<string, number>();
  const rows: ReconcileRow[] = newViolations.map((v) => {
    const fp = fingerprint(v);
    seenNow.set(fp, (seenNow.get(fp) ?? 0) + 1);
    const budgetLeft = remaining.get(fp) ?? 0;
    if (budgetLeft > 0) { remaining.set(fp, budgetLeft - 1); return { v, state: 'baselined', fingerprint: fp }; }
    return { v, state: 'new', fingerprint: fp };
  });

  // Fixed: baselined occurrences that no longer appear (per fingerprint delta).
  const staleEntries: BaselineEntry[] = [];
  for (const e of baseline.entries) {
    const now = seenNow.get(e.fingerprint) ?? 0;
    const based = baseCount.get(e.fingerprint) ?? 0;
    const fixedHere = Math.max(0, based - now);
    // attribute the fixed delta to this entry's own count (first entry wins for split fingerprints)
    let attribute = Math.min(fixedHere, e.count);
    for (let i = 0; i < attribute; i++) rows.push({ v: reconstruct(e), state: 'fixed', fingerprint: e.fingerprint });
    if (now === 0) staleEntries.push(e);
  }

  const baselined = rows.filter((r) => r.state === 'baselined').length;
  const neu = rows.filter((r) => r.state === 'new').length;
  const fixed = rows.filter((r) => r.state === 'fixed').length;

  // ---- warning budget ----
  const totalWarnings = newViolations.filter((v) => (v.severity ?? SEV.warn) === SEV.warn).length;
  const maxWarnings = budget.maxWarnings == null ? null : Number(budget.maxWarnings);
  const warningsPass = maxWarnings == null ? true : totalWarnings <= maxWarnings;

  // per-rule counts vs baseline
  const rules = new Set<string>();
  const baseByRule = new Map<string, number>();
  const curByRule = new Map<string, number>();
  for (const e of baseline.entries) { rules.add(e.code); baseByRule.set(e.code, (baseByRule.get(e.code) ?? 0) + e.count); }
  for (const v of newViolations) { rules.add(v.code); curByRule.set(v.code, (curByRule.get(v.code) ?? 0) + 1); }
  const noIncreasePerRule = !!budget.noIncreasePerRule;
  const perRule: RuleBudgetRow[] = [...rules].sort().map((rule) => {
    const b = baseByRule.get(rule) ?? 0, c = curByRule.get(rule) ?? 0;
    return { rule, baseline: b, current: c, delta: c - b, pass: !noIncreasePerRule || c <= b };
  });
  const perRulePass = !noIncreasePerRule || perRule.every((r) => r.pass);
  const budgetResult: BudgetResult = { pass: warningsPass && perRulePass, maxWarnings, totalWarnings, warningsPass, noIncreasePerRule, perRule };

  const baselineTotal = [...baseCount.values()].reduce((a, b) => a + b, 0);
  const remainingCount = baselineTotal - fixed;
  const burndown = {
    baselineTotal, stillPresent: baselined, fixed, remaining: remainingCount,
    percentClosed: baselineTotal ? Math.round((fixed / baselineTotal) * 100) : 0,
  };

  return { rows, counts: { total: rows.length, baselined, neu, fixed }, budgetResult, staleEntries, burndown };
}

function reconstruct(e: BaselineEntry): Violation {
  return { code: e.code, message: e.message, source: e.source, path: e.path ? e.path.split('/') : [], severity: e.severity };
}
