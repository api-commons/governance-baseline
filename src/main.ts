import './style.css';
import { snapshot, serializeBaseline, parseBaselineFile, reconcile, type Violation, type Budget, type ReconcileResult, type BaselineEntry, type RuleBudgetRow } from './baseline';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const val = (s: string) => ($(s) as HTMLTextAreaElement | HTMLInputElement).value;
const setVal = (s: string, v: string) => { ($(s) as HTMLTextAreaElement | HTMLInputElement).value = v; };
const ptr = (p?: (string | number)[]) => '/' + (p ?? []).join('/');

let sampleResults = '', sampleBaseline = '';

init();
async function init() {
  wire();
  try {
    [sampleResults, sampleBaseline] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}sample-spectral.json`).then((r) => r.text()),
      fetch(`${import.meta.env.BASE_URL}sample-baseline.yaml`).then((r) => r.text()),
    ]);
    setVal('#results-text', sampleResults);
    setVal('#baseline-text', sampleBaseline);
    run();
  } catch (e) { $('#report').innerHTML = `<div class="cov-error">Couldn't load samples. ${esc((e as Error).message)}</div>`; }
}

function wire() {
  $('#reconcile').addEventListener('click', run);
  $('#load-sample').addEventListener('click', () => { setVal('#results-text', sampleResults); setVal('#baseline-text', sampleBaseline); run(); });
  $('#snapshot').addEventListener('click', doSnapshot);
  $('#up-results').addEventListener('click', () => $('#file-results').click());
  $('#up-baseline').addEventListener('click', () => $('#file-baseline').click());
  $('#file-results').addEventListener('change', (e) => readFile(e, '#results-text'));
  $('#file-baseline').addEventListener('change', (e) => readFile(e, '#baseline-text'));
  $('#dl-baseline').addEventListener('click', () => download('governance-baseline.yaml', val('#baseline-text'), 'text/yaml'));
  $('#b-noincrease').addEventListener('change', run);
  $('#b-maxwarn').addEventListener('input', run);
  $('#engage-ae').addEventListener('click', () => { location.href = 'mailto:info@apievangelist.com?subject=' + encodeURIComponent('API governance — baseline & ratchet on a legacy estate'); });
  $('#nav-about').addEventListener('click', (e) => { e.preventDefault(); about(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('about-modal')?.remove(); });
}

function readFile(e: Event, target: string) {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => { setVal(target, String(r.result)); run(); }; r.readAsText(f);
}

function parseResults(): Violation[] {
  const violations = JSON.parse(val('#results-text') || '[]');
  if (!Array.isArray(violations)) throw new Error('Expected a JSON array of Spectral results.');
  return violations;
}

function doSnapshot() {
  let violations: Violation[];
  try { violations = parseResults(); }
  catch (e) { return err(`Couldn't parse Spectral results: ${(e as Error).message}`); }
  const file = snapshot(violations);
  const yaml = serializeBaseline(file);
  setVal('#baseline-text', yaml);
  download('governance-baseline.yaml', yaml, 'text/yaml');
  run();
}

function currentBudget(): Budget {
  const raw = val('#b-maxwarn').trim();
  return { noIncreasePerRule: ($('#b-noincrease') as HTMLInputElement).checked, maxWarnings: raw === '' ? null : Math.max(0, Number(raw) | 0) };
}

let lastNew: Violation[] = [];
function run() {
  let violations: Violation[], baseline;
  try { violations = parseResults(); }
  catch (e) { return err(`Couldn't parse Spectral results: ${(e as Error).message}`); }
  try { baseline = parseBaselineFile(val('#baseline-text')); }
  catch (e) { return err(`Couldn't parse baseline: ${(e as Error).message}`); }

  const r = reconcile(violations, baseline, currentBudget());
  lastNew = r.rows.filter((row) => row.state === 'new').map((row) => row.v);
  const gate = r.counts.neu === 0 && r.budgetResult.pass;
  $('#status').innerHTML = `<b>${violations.length}</b> results · <b>${baseline.entries.length}</b> baseline entries · <b style="color:${r.counts.neu ? 'var(--error)' : 'var(--ok)'}">${r.counts.neu}</b> new · <b style="color:${gate ? 'var(--ok)' : 'var(--error)'}">${gate ? 'PASS' : 'FAIL'}</b>`;
  render(r, baseline.entries.length);
}
function err(msg: string) { $('#report').innerHTML = `<div class="cov-error">${esc(msg)}</div>`; }

function render(r: ReconcileResult, baselineCount: number) {
  const order = { new: 0, baselined: 1, fixed: 2 } as const;
  const rows = [...r.rows].sort((a, b) => order[a.state] - order[b.state]);
  const gate = r.counts.neu === 0 && r.budgetResult.pass;
  const bud = r.budgetResult;
  const budgetLabel = bud.maxWarnings == null ? 'no cap' : `${bud.totalWarnings}/${bud.maxWarnings}`;

  $('#report').innerHTML = `
    <div class="hero">
      <div class="gauge">
        <div class="gauge-num" style="color:${r.counts.neu ? 'var(--error)' : 'var(--ok)'}">${r.counts.neu}</div>
        <div class="gauge-cap">NEW violations<br>not in the baseline</div>
        <div class="gate ${gate ? 'pass' : 'fail'}">${gate ? '✓ gate passes' : '✗ gate fails'}</div>
      </div>
      <div class="facts">
        <div class="fact"><b>${r.counts.total - r.counts.fixed}</b><span>results this run</span></div>
        <div class="fact"><b>${r.counts.baselined}</b><span>baselined (suppressed)</span></div>
        <div class="fact ${r.counts.fixed ? 'okf' : ''}"><b>${r.counts.fixed}</b><span>fixed (baseline can shrink)</span></div>
        <div class="fact ${bud.warningsPass ? '' : 'errf'}"><b>${budgetLabel}</b><span>warning budget</span></div>
        <div class="fact ${r.staleEntries.length ? 'warnf' : ''}"><b>${r.staleEntries.length}</b><span>stale entries (remove)</span></div>
      </div>
    </div>
    <p class="hint small">A <strong>baseline</strong> records the violations you have <em>today</em> so you can adopt a ruleset on a legacy estate without a wall of red. The ratchet then fails only <strong>NEW</strong> violations; <strong>baselined</strong> ones are suppressed, and anything you clean up shows as <strong>fixed</strong> so the baseline shrinks. A baselined violation that no longer occurs is <strong>stale</strong> — remove it to keep the baseline honest.</p>

    <div class="cols">
      <section class="panel">
        <h3>Violations <span class="muted">(${r.counts.total - r.counts.fixed} this run)</span></h3>
        <p class="small">New first — these are what fail the gate. Baselined ones are suppressed but shown for the record; fixed ones are gone.</p>
        <div class="vlist">${rows.map(vrow).join('')}</div>
      </section>
      <section class="panel">
        <h3>Per-rule budget <span class="muted">(${bud.perRule.length} rules)</span></h3>
        <p class="small">${bud.noIncreasePerRule ? 'Enforcing “count must not increase per rule.”' : 'Per-rule enforcement off — showing counts vs. baseline for reference.'}</p>
        <div class="btable">
          <div class="brow brow-head"><span>rule</span><span class="num">base</span><span class="num">now</span><span class="num">Δ</span><span class="verdict">${bud.noIncreasePerRule ? 'gate' : ''}</span></div>
          ${bud.perRule.map(brow).join('')}
        </div>
        <div class="burn">
          <h3 style="margin:.2rem 0 .4rem;font-size:.92rem">Baseline burn-down</h3>
          <div class="bar"><i style="width:${r.burndown.percentClosed}%"></i></div>
          <div class="burn-legend"><span><b>${r.burndown.fixed}</b> fixed of <b>${r.burndown.baselineTotal}</b> baselined</span><span><b>${r.burndown.percentClosed}%</b> closed · <b>${r.burndown.remaining}</b> remaining</span></div>
          <div>
            <h3 style="margin:.6rem 0 .3rem;font-size:.92rem">Stale entries <span class="muted">(${r.staleEntries.length})</span></h3>
            ${r.staleEntries.length ? `<div class="stale-list">${r.staleEntries.map(srow).join('')}</div>` : '<div class="empty">No stale entries — every baselined violation still occurs.</div>'}
          </div>
        </div>
      </section>
    </div>

    <div class="export-bar">
      <button class="ghost-btn" id="dl-new" type="button">Download new violations (${lastNew.length}) ↓</button>
      <button class="ghost-btn" id="dl-shrunk" type="button">Download shrunk baseline ↓</button>
      <span class="muted small">Gate your build on the NEW set; commit the shrunk baseline (stale entries removed) to ratchet down.</span>
    </div>`;
  $('#dl-new').addEventListener('click', () => download('spectral-new.json', JSON.stringify(lastNew, null, 2), 'application/json'));
  $('#dl-shrunk').addEventListener('click', () => downloadShrunk(r));
  void baselineCount;
}

function vrow(row: ReconcileResult['rows'][number]): string {
  const label = row.state === 'baselined' ? 'baselined' : row.state === 'fixed' ? 'fixed' : 'new';
  return `<div class="vrow ${row.state}"><span class="vstate ${row.state}">${label}</span>
    <div class="vmain"><div class="vcode">${esc(row.v.code)}</div><div class="vpath">${esc(ptr(row.v.path))}${row.v.source ? ' · ' + esc(row.v.source) : ''}</div></div></div>`;
}

function brow(b: RuleBudgetRow): string {
  const over = !b.pass;
  const dcls = b.delta > 0 ? 'up' : b.delta < 0 ? 'down' : '';
  const dtxt = b.delta > 0 ? `+${b.delta}` : String(b.delta);
  return `<div class="brow ${over ? 'over' : 'pass'}">
    <span class="rname" title="${esc(b.rule)}">${esc(b.rule)}</span>
    <span class="num">${b.baseline}</span><span class="num">${b.current}</span>
    <span class="num delta ${dcls}">${dtxt}</span>
    <span class="verdict ${over ? 'over' : 'pass'}">${over ? 'over' : b.delta < 0 ? '↓' : 'ok'}</span>
  </div>`;
}

function srow(e: BaselineEntry): string {
  return `<div class="sr"><div class="sr-top"><span class="sr-code">${esc(e.code)}</span><span class="badge-stale">stale</span></div>
    <div class="sr-path">${esc('/' + e.path)}${e.source ? ' · ' + esc(e.source) : ''}${e.count > 1 ? ' · ×' + e.count : ''}</div></div>`;
}

// Shrink the baseline: drop stale entries and decrement counts for partially-fixed fingerprints.
function downloadShrunk(r: ReconcileResult) {
  let file;
  try { file = parseBaselineFile(val('#baseline-text')); } catch { return; }
  const staleFps = new Set(r.staleEntries.map((e) => e.fingerprint));
  const fixedByFp = new Map<string, number>();
  for (const row of r.rows) if (row.state === 'fixed') fixedByFp.set(row.fingerprint, (fixedByFp.get(row.fingerprint) ?? 0) + 1);
  file.entries = file.entries.filter((e) => !staleFps.has(e.fingerprint)).map((e) => {
    const shrink = Math.min(e.count, fixedByFp.get(e.fingerprint) ?? 0);
    return { ...e, count: e.count - shrink };
  }).filter((e) => e.count > 0);
  file.created = new Date().toISOString().slice(0, 10);
  download('governance-baseline.yaml', serializeBaseline(file), 'text/yaml');
}

function download(name: string, content: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

function about() {
  const el = document.createElement('div');
  el.id = 'about-modal';
  el.innerHTML = `<div class="about-backdrop"></div><div class="about-card">
    <button class="detail-close" id="about-close">&times;</button>
    <h2>Adopt governance without a wall of red</h2>
    <p>Introduce a Spectral ruleset to an existing API and everything lights up at once — every operation missing a description, every legacy path without tags. The signal drowns: real, new problems are indistinguishable from the years of debt you already knew about. Teams respond by turning the rules off.</p>
    <p>A <strong>baseline</strong> is the honest way in. You <strong>snapshot</strong> the violations you have today into a small machine-readable file — each one fingerprinted by rule code, source file, and normalized path, with a count. From then on the ruleset runs at full strength, but the gate <strong>ratchets</strong>: it fails only <strong>NEW</strong> violations. Baselined ones are suppressed, and anything you clean up shows as <strong>fixed</strong> so the baseline shrinks toward zero.</p>
    <p>A <strong>warning budget</strong> adds a ceiling — a maximum number of warnings, or a rule that per-rule counts can never increase — so debt can only go down. A baselined violation that no longer occurs is <strong>stale</strong>: remove it to keep the baseline honest, and watch the burn-down.</p>
    <p class="muted small">Runs entirely in your browser. Nothing you paste leaves the page.</p>
  </div>`;
  document.body.appendChild(el);
  el.querySelector('#about-close')!.addEventListener('click', () => el.remove());
  el.querySelector('.about-backdrop')!.addEventListener('click', () => el.remove());
}
