/* 2026 ballot measures vs. statewide races — interactive map
 * Data: data/ballot_data.js (written by ballot_pipeline.py) and data/us_states_topo.js (us-atlas). */
(function () {
  'use strict';

  const D = window.BALLOT_DATA;
  const TOPO = window.US_STATES_TOPO;
  if (!D || !TOPO || !window.d3 || !window.topojson) {
    document.body.insertAdjacentHTML('afterbegin',
      '<p style="padding:16px;font-family:system-ui">The map data did not load. Check that the data/ and assets/ folders were uploaded.</p>');
    return;
  }

  // ---------------------------------------------------------------- constants
  const GAP_LIMIT = 25;              // colour saturates at ±25 pts
  const SHARE_DOMAIN = [20, 50, 80]; // measures view: avg. conservative-position share
  const NAME2ABBR = {};
  Object.entries(D.states).forEach(([a, n]) => { NAME2ABBR[n] = a; });
  const PARTY = { Conservative: { code: 'R', name: 'Republican' }, Liberal: { code: 'D', name: 'Democratic' } };
  const OFFICE_LABEL = { Governor: 'Governor', Senate: 'U.S. Senate' };
  const OFFICE_SEL_LABEL = { Governor: 'Governor', Senate: 'U.S. Senate', Either: 'Governor, else Senate' };
  const SHARE_LABEL = { '2p': 'two-party', raw: 'raw' };
  const ALLOWED = {
    view: ['measures', 'gap'], pos: ['Conservative', 'Liberal'],
    office: ['Governor', 'Senate', 'Either'], share: ['2p', 'raw'],
  };
  const RAMP = {
    light: {
      mid: '#f0efec',
      blue: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
      red: ['#fdd6d0', '#f4afa6', '#e7867c', '#d85a53', '#b2413d', '#8a2d2b', '#621c1b'],
      gray: ['#e2dfda', '#c3c0bb', '#a4a29d', '#86847f', '#6a6863', '#504e49', '#373531'],
    },
    dark: {
      mid: '#383835',
      blue: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
      red: ['#8a2d2b', '#b2413d', '#d85a53', '#e7867c', '#f4afa6'],
      gray: ['#504e49', '#6a6863', '#86847f', '#a4a29d', '#c3c0bb'],
    },
  };

  const S = { view: 'measures', topic: 'All', pos: 'Conservative', office: 'Either', share: '2p', noSide: false, pinned: null, sort: null };

  // ---------------------------------------------------------------- helpers
  const f1 = d3.format('.1f');
  const MINUS = '−';
  const signed = v => (v >= 0.05 ? '+' : v <= -0.05 ? MINUS : '±') + f1(Math.abs(v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const $ = s => document.querySelector(s);
  const MEAS = new Map(D.measures.map(m => [m.uid, m]));
  const RACES = d3.group(D.races, r => r.abbr);
  const race = (abbr, office) => (RACES.get(abbr) || []).find(r => r.office === office) || null;
  const isCoded = m => (m.yes_position === 'Conservative' || m.yes_position === 'Liberal') && m.yes_share != null;
  const consShare = m => (m.yes_position === 'Conservative' ? m.yes_share : 100 - m.yes_share);
  const inTopic = m => S.topic === 'All' || m.topic === S.topic;
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  const canHover = window.matchMedia ? window.matchMedia('(hover: hover)').matches : true;
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t === 'dark' || (t !== 'light' && mq.matches);
  };

  function officeFor(abbr) {
    if (S.office === 'Either') return race(abbr, 'Governor') ? 'Governor' : (race(abbr, 'Senate') ? 'Senate' : null);
    return race(abbr, S.office) ? S.office : null;
  }

  function diverging(neg, pos, domain) {
    const R = RAMP[isDark() ? 'dark' : 'light'];
    const stops = R[neg].slice().reverse().concat([R.mid], R[pos]);
    return d3.scaleDiverging(d3.piecewise(d3.interpolateLab, stops)).domain(domain).clamp(true);
  }
  const currentScale = () => (S.view === 'measures'
    ? diverging('blue', 'red', SHARE_DOMAIN)
    : diverging('gray', S.pos === 'Conservative' ? 'red' : 'blue', [-GAP_LIMIT, 0, GAP_LIMIT]));

  // ---------------------------------------------------------------- data views
  function computeMeasures() {
    const rows = D.measures.filter(inTopic);
    const states = new Map();
    for (const [abbr, list] of d3.group(rows, m => m.abbr)) {
      list.sort((a, b) => natural(a.measure_id, b.measure_id));
      const coded = list.filter(isCoded);
      states.set(abbr, { abbr, value: coded.length ? d3.mean(coded, consShare) : null, nCoded: coded.length, measures: list });
    }
    return { rows, states, nov: new Map() };
  }

  function computeGap() {
    const gk = 'gap_' + S.share, ck = 'candidate_share_' + S.share;
    let rows = D.comparisons.filter(c => c.position === S.pos && inTopic(c));
    if (!S.noSide) rows = rows.filter(c => c.position_side === 'Yes');
    rows = rows.filter(c => c.office === officeFor(c.abbr) && c[gk] != null);
    rows.sort((a, b) => natural(a.measure_id, b.measure_id));
    const states = new Map();
    for (const [abbr, list] of d3.group(rows, r => r.abbr)) {
      states.set(abbr, { abbr, value: d3.mean(list, r => r[gk]), rows: list, race: race(abbr, list[0].office), candShare: list[0][ck] });
    }
    const nov = new Map();
    for (const [abbr, list] of d3.group(D.measures.filter(inTopic), m => m.abbr)) {
      if (!states.has(abbr)) nov.set(abbr, { abbr, measures: list.sort((a, b) => natural(a.measure_id, b.measure_id)), reason: reasonFor(abbr, list) });
    }
    return { rows, states, nov };
  }

  function reasonFor(abbr, list) {
    const off = officeFor(abbr);
    if (!off) {
      return S.office === 'Either'
        ? 'No Governor or U.S. Senate result for this state in the workbook.'
        : `No ${OFFICE_LABEL[S.office]} result for this state in the workbook.`;
    }
    const coded = list.filter(isCoded);
    if (!coded.length) return 'No ideologically coded measure with a reported vote share here.';
    if (!S.noSide && !coded.some(m => m.yes_position === S.pos)) {
      return `No measure here where a Yes vote was the ${S.pos.toLowerCase()} position. Tick “Also count measures where this position was the No vote” to include the others.`;
    }
    if (S.share === 'raw') return 'Raw candidate shares are not available for this race.';
    return 'No comparison available.';
  }

  const compute = () => (S.view === 'measures' ? computeMeasures() : computeGap());

  // ---------------------------------------------------------------- html bits
  function statusHTML(st) {
    if (st === 'Passed') return '<b>✓</b> Passed';
    if (st === 'Failed') return '<b>✗</b> Failed';
    if (st === 'Leading Yes (uncalled)') return '<b>○</b> Leading Yes · uncalled';
    if (st === 'Leading No (uncalled)') return '<b>○</b> Leading No · uncalled';
    return esc(st);
  }
  function shareText(m) {
    if (m.yes_share != null) return `${m.yes_share_approx ? '≈' : ''}${f1(m.yes_share)}% yes`;
    if (m.pct_yes_reported_text) return `Reported: “${esc(m.pct_yes_reported_text)}”`;
    return 'Share not reported';
  }
  function posTag(m) {
    if (m.yes_position === 'Conservative') return '<span class="tag cons">Yes = conservative</span>';
    if (m.yes_position === 'Liberal') return '<span class="tag lib">Yes = liberal</span>';
    return '<span class="tag">Mixed / nonpartisan</span>';
  }
  function ybar(m) {
    if (m.yes_share == null) return '';
    return `<span class="ybar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, m.yes_share))}%"></i><em></em></span>`;
  }
  function raceText(r) {
    if (!r) return '';
    const w = r.winner_party === 'D' ? r.dem_raw : r.rep_raw;
    const wTxt = w != null ? ` ${f1(w)}%` : '';
    return `${esc(r.race_label)}: ${esc(r.winner)} (${esc(r.winner_party)})${wTxt}`;
  }
  function raceLine(abbr) {
    const rs = RACES.get(abbr) || [];
    return rs.map(raceText).join(' · ');
  }
  function raceFlags(r) {
    if (!r || !r.data_flags) return '';
    const f = r.data_flags.split('; ').filter(x => !/runner-up assumed/.test(x));
    return f.length ? `<div class="flag">⚠ ${esc(r.race_label)}: ${esc(f.join('; '))}</div>` : '';
  }
  function measureItemCompact(m) {
    const pos = m.yes_position === 'Conservative' ? 'Yes = cons.' : m.yes_position === 'Liberal' ? 'Yes = lib.' : 'Mixed';
    const sh = m.yes_share != null ? `${m.yes_share_approx ? '≈' : ''}${f1(m.yes_share)}% yes` : (m.pct_yes_reported_text ? esc(m.pct_yes_reported_text) : 'no share');
    return `<li class="c">
      <div class="mrow1"><span class="mname">${esc(m.measure_id)}</span><span class="status">${statusHTML(m.status)}</span></div>
      <div class="mrow1 sub"><span class="mdesc one">${esc(m.description)}</span><span class="shr">${sh} <small>${pos}</small></span></div>
    </li>`;
  }
  function measureItem(m) {
    const note = m.from_note ? ' <span class="tag">from workbook note</span>' : '';
    const topic = S.topic === 'All' ? ` <span class="tag">${esc(m.topic)}</span>` : '';
    return `<li>
      <div class="mrow1"><span class="mname">${esc(m.measure_id)}</span><span class="status">${statusHTML(m.status)}</span></div>
      <div class="mdesc">${esc(m.description)}</div>
      <div class="mrow2">${ybar(m)}<span>${shareText(m)}</span>${posTag(m)}${topic}${note}</div>
    </li>`;
  }
  function dumbbell(c, scale) {
    const ck = 'candidate_share_' + S.share, gk = 'gap_' + S.share;
    const x = d3.scaleLinear().domain([0, 100]).range([6, 114]);
    const a = x(c[ck]), b = x(c.position_share);
    const hue = S.pos === 'Conservative' ? 'var(--cons)' : 'var(--lib)';
    const seg = c[gk] >= 0 ? scale(GAP_LIMIT * 0.75) : scale(-GAP_LIMIT * 0.75);
    return `<svg class="dumbbell" width="120" height="14" viewBox="0 0 120 14" aria-hidden="true">
      <line class="track" x1="6" x2="114" y1="7" y2="7"/><line class="mid" x1="${x(50)}" x2="${x(50)}" y1="1" y2="13"/>
      <line x1="${a}" x2="${b}" y1="7" y2="7" stroke="${seg}" stroke-width="3"/>
      <circle class="cand" cx="${a}" cy="7" r="4"/><circle cx="${b}" cy="7" r="4.5" fill="${hue}"/></svg>`;
  }
  function gapItem(c, scale) {
    const m = MEAS.get(c.uid) || {};
    const ck = 'candidate_share_' + S.share, gk = 'gap_' + S.share;
    const approx = c.measure_share_approx ? '≈' : '';
    return `<li>
      <div class="mrow1"><span class="mname">${esc(c.measure_id)}</span><span class="status">${statusHTML(c.status)}</span></div>
      <div class="mdesc">${esc(m.description)}</div>
      <div class="mrow2">${dumbbell(c, scale)}
        <span>${esc(S.pos)} side (${esc(c.position_side)}) ${approx}${f1(c.position_share)}% vs. ${esc(c.party)} ${f1(c[ck])}% → <b>${signed(c[gk])}</b></span></div>
    </li>`;
  }

  function stateHTML(abbr, V, scale, full) {
    const name = D.states[abbr] || abbr;
    const s = V.states.get(abbr);
    let html = '';
    if (S.view === 'measures') {
      const rl = raceLine(abbr);
      if (!s) {
        return { title: name, html: `<div class="tt-meta">${rl ? rl + '<br>' : ''}No ballot measures in the workbook${S.topic === 'All' ? '' : ' for this topic'}.</div>` };
      }
      html += `<div class="tt-meta">${s.measures.length} measure${s.measures.length > 1 ? 's' : ''}${rl ? ' · ' + rl : ''}</div>`;
      if (s.value != null) {
        html += `<p class="tt-kpi">Avg. vote for the conservative position: <b>${f1(s.value)}%</b> across ${s.nCoded} coded measure${s.nCoded > 1 ? 's' : ''}</p>`;
      } else {
        html += '<p class="tt-kpi">No ideologically coded measure with a reported vote share.</p>';
      }
      html += full ? `<ul class="mlist">${s.measures.map(measureItem).join('')}</ul>`
        : `<ul class="mlist compact">${s.measures.map(measureItemCompact).join('')}</ul><p class="tt-hint">Click the state to pin full details.</p>`;
      return { title: name, html };
    }
    // gap view
    const P = PARTY[S.pos];
    if (s) {
      const r = s.race;
      const ahead = s.value >= 0 ? 'ahead of' : 'behind';
      const won = r.winner_party === P.code;
      html += `<div class="tt-meta">${raceText(r)} · ${P.name} ${won ? 'winner' : 'runner-up'}’s share: <b>${f1(s.candShare)}%</b> (${SHARE_LABEL[S.share]})</div>`;
      html += `<p class="tt-kpi">Average gap: <b>${signed(s.value)} pts</b> — the ${S.pos.toLowerCase()} position ran ${ahead} the ${P.name} candidate (${s.rows.length} measure${s.rows.length > 1 ? 's' : ''})</p>`;
      html += `<ul class="mlist">${s.rows.map(c => gapItem(c, scale)).join('')}</ul>`;
      html += raceFlags(r);
      return { title: `${name} — ${OFFICE_LABEL[r.office]}`, html };
    }
    const nv = V.nov.get(abbr);
    const rl = raceLine(abbr);
    if (nv) {
      html += `<div class="tt-meta">${rl || 'No Governor or Senate result in the workbook'}</div>`;
      html += `<p class="tt-kpi">${esc(nv.reason)}</p>`;
      html += full ? `<ul class="mlist">${nv.measures.map(measureItem).join('')}</ul>`
        : `<ul class="mlist compact">${nv.measures.map(measureItemCompact).join('')}</ul>`;
      return { title: name, html };
    }
    html += `<div class="tt-meta">${rl ? rl + '<br>' : ''}No ballot measures in the workbook${S.topic === 'All' ? '' : ' for this topic'}.</div>`;
    return { title: name, html };
  }

  // ---------------------------------------------------------------- map setup
  const svg = d3.select('#map');
  const path = d3.geoPath();
  const features = topojson.feature(TOPO, TOPO.objects.states).features
    .filter(f => NAME2ABBR[f.properties.name]);
  features.forEach(f => {
    f.abbr = NAME2ABBR[f.properties.name];
    // label anchor = centroid of the largest polygon (keeps MI, HI, etc. on land)
    let best = f, area = 0;
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map(c => ({ type: 'Polygon', coordinates: c })) : [f.geometry];
    polys.forEach(p => { const a = path.area(p); if (a > area) { area = a; best = p; } });
    f.anchor = path.centroid(best);
    f.labelArea = area;
  });
  const NUDGE = { FL: [14, 8], LA: [-12, 2], MI: [10, 14], KY: [6, 2], CA: [-8, 0], ID: [0, 16], NC: [6, 0], VA: [8, 2], WV: [-2, 4], MN: [-6, 0], NY: [6, 0], AK: [0, 0], HI: [0, 0], NV: [0, -8] };
  features.forEach(f => { const n = NUDGE[f.abbr]; if (n) f.anchor = [f.anchor[0] + n[0], f.anchor[1] + n[1]]; });
  const FEAT = new Map(features.map(f => [f.abbr, f]));

  const defs = svg.append('defs');
  const pat = defs.append('pattern').attr('id', 'hatch').attr('width', 6).attr('height', 6)
    .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
  pat.append('rect').attr('width', 6).attr('height', 6).style('fill', 'var(--nov)');
  pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).style('stroke', 'var(--nov-ink)').attr('stroke-width', 2);

  const gStates = svg.append('g').attr('class', 'states');
  const statePaths = gStates.selectAll('path').data(features, d => d.abbr).join('path')
    .attr('class', 'state').attr('d', path).attr('tabindex', 0).attr('data-abbr', d => d.abbr);
  const gLabels = svg.append('g').attr('class', 'labels');
  const hlHover = svg.append('path').attr('class', 'hl').style('display', 'none');
  const hlPin = svg.append('path').attr('class', 'hl pinned').style('display', 'none');

  // ---------------------------------------------------------------- tooltip
  const tip = $('#tooltip');
  const wrap = $('#map-wrap');
  let V = null, SCALE = null;

  function placeTip(x, y) {
    const W = wrap.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 16, top = y + 14;
    if (left + tw > W) left = x - tw - 16;
    if (left < 0) left = Math.max(0, Math.min(W - tw, x - tw / 2));
    const vh = window.innerHeight, rectTop = wrap.getBoundingClientRect().top;
    if (rectTop + top + th > vh - 8) top = Math.max(-rectTop + 8, y - th - 14);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function showTip(abbr, x, y) {
    const c = stateHTML(abbr, V, SCALE, false);
    tip.innerHTML = `<p class="tt-title">${esc(c.title)}</p>${c.html}`;
    tip.hidden = false;
    placeTip(x, y);
    highlight(abbr);
  }
  function hideTip() { tip.hidden = true; highlight(null); }
  function anchorPoint(abbr) {
    const f = FEAT.get(abbr), r = svg.node().getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const k = r.width / 975;
    return [r.left - wr.left + f.anchor[0] * k, r.top - wr.top + f.anchor[1] * k];
  }
  function highlight(abbr) {
    if (!abbr) { hlHover.style('display', 'none'); d3.selectAll('.rank li').classed('is-active', false); return; }
    hlHover.attr('d', path(FEAT.get(abbr))).style('display', null);
    d3.selectAll('.rank li').classed('is-active', d => d && d.abbr === abbr);
  }

  statePaths
    .on('pointermove', (ev, d) => {
      if (ev.pointerType !== 'mouse') return;
      const r = wrap.getBoundingClientRect();
      showTip(d.abbr, ev.clientX - r.left, ev.clientY - r.top);
    })
    .on('pointerleave', hideTip)
    .on('click', (ev, d) => { togglePin(d.abbr, ev.pointerType && ev.pointerType !== 'mouse'); })
    .on('focus', (ev, d) => { const [x, y] = anchorPoint(d.abbr); showTip(d.abbr, x, y); })
    .on('blur', hideTip)
    .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); togglePin(d.abbr, false); } });

  // ---------------------------------------------------------------- pin / detail
  function togglePin(abbr, reveal) {
    S.pinned = S.pinned === abbr ? null : abbr;
    S.sort = S.sort; // keep
    render();
    if (S.pinned && reveal) $('#detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  $('#detail-close').addEventListener('click', () => { S.pinned = null; render(); });

  function renderDetail() {
    const box = $('#detail');
    if (!S.pinned) { box.hidden = true; hlPin.style('display', 'none'); return; }
    const c = stateHTML(S.pinned, V, SCALE, true);
    $('#detail-title').textContent = c.title;
    $('#detail-body').innerHTML = c.html;
    box.hidden = false;
    hlPin.attr('d', path(FEAT.get(S.pinned))).style('display', null);
  }

  // ---------------------------------------------------------------- render pieces
  function fillFor(abbr) {
    const s = V.states.get(abbr);
    if (s && s.value != null) return SCALE(s.value);
    if (s || V.nov.has(abbr)) return 'url(#hatch)';
    return 'var(--empty)';
  }

  function renderMap() {
    statePaths.style('fill', d => fillFor(d.abbr))
      .attr('aria-label', d => {
        const s = V.states.get(d.abbr);
        const name = D.states[d.abbr];
        if (s && s.value != null) return S.view === 'measures' ? `${name}: average conservative-position vote ${f1(s.value)}%` : `${name}: gap ${signed(s.value)} points`;
        if (s || V.nov.has(d.abbr)) return `${name}: measures on the ballot, no value`;
        return `${name}: no data`;
      });
    const lab = features.filter(f => { const s = V.states.get(f.abbr); return s && s.value != null && f.labelArea > 1300; });
    const g = gLabels.selectAll('text').data(lab, d => d.abbr).join(enter => {
      const t = enter.append('text').attr('class', 'lbl');
      t.append('tspan').attr('class', 'ab');
      t.append('tspan').attr('class', 'val').attr('dy', '1.15em');
      return t;
    });
    g.attr('transform', d => `translate(${d.anchor[0]},${d.anchor[1] - 6})`)
      .style('fill', d => (d3.lab(SCALE(V.states.get(d.abbr).value)).l < 58 ? '#ffffff' : '#0b0b0b'));
    g.select('.ab').attr('x', 0).text(d => d.abbr);
    g.select('.val').attr('x', 0).text(d => {
      const v = V.states.get(d.abbr).value;
      return S.view === 'measures' ? `${Math.round(v)}%` : `${v >= 0.5 ? '+' : v <= -0.5 ? MINUS : '±'}${Math.round(Math.abs(v))}`;
    });
  }

  function renderLegend() {
    const dom = SCALE.domain();
    const stops = d3.range(0, 1.0001, 0.05).map(t => `${SCALE(dom[0] + t * (dom[2] - dom[0]))} ${Math.round(t * 100)}%`);
    let title, ticks, ends, novLabel;
    if (S.view === 'measures') {
      title = 'Average vote for the conservative position across ideologically coded measures';
      ticks = ['≤20%', '35%', '50%', '65%', '≥80%'];
      ends = ['← More liberal', 'More conservative →'];
      novLabel = 'On the ballot, but no coded measure with a vote share';
    } else {
      const P = PARTY[S.pos];
      title = `Gap: ${S.pos.toLowerCase()} position minus ${P.name} candidate (pts)`;
      ticks = [`≤${MINUS}25`, `${MINUS}12.5`, '0', '+12.5', '≥+25'];
      ends = [`← Behind ${P.code} candidate`, `Ahead of ${P.code} candidate →`];
      novLabel = 'Measures on the ballot, no comparison available';
    }
    $('#legend').innerHTML = `
      <div class="ramp">
        <div class="ramp-title">${esc(title)}</div>
        <div class="bar" style="background:linear-gradient(90deg, ${stops.join(',')})"></div>
        <div class="ticks">${ticks.map((t, i) => `<span style="left:${i * 25}%">${t}</span>`).join('')}</div>
        <div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>
      </div>
      <div class="keys">
        <span class="key"><span class="sw nov"></span>${esc(novLabel)}</span>
        <span class="key"><span class="sw empty"></span>No measures in the workbook${S.topic === 'All' ? '' : ' for this topic'}</span>
      </div>`;
  }

  function renderRank() {
    const entries = Array.from(V.states.values()).filter(s => s.value != null)
      .sort((a, b) => d3.descending(a.value, b.value) || natural(a.abbr, b.abbr));
    const center = S.view === 'measures' ? 50 : 0, half = S.view === 'measures' ? 30 : GAP_LIMIT;
    const pos = v => 50 + Math.max(-1, Math.min(1, (v - center) / half)) * 50;
    const list = d3.select('#rank').selectAll('li').data(entries, d => d.abbr).join('li')
      .attr('tabindex', 0)
      .classed('is-pinned', d => d.abbr === S.pinned)
      .html(d => {
        const x = pos(d.value), l = Math.min(50, x), w = Math.max(1.5, Math.abs(x - 50));
        const r = S.view === 'gap' ? d.race : null;
        const sub = S.view === 'gap' ? `<small>${r.office === 'Governor' ? 'Gov' : 'Sen'} · ${d.rows.length}</small>` : `<small>${d.nCoded}</small>`;
        const val = S.view === 'measures' ? `${f1(d.value)}%` : signed(d.value);
        return `<span class="nm">${esc(D.states[d.abbr])}${sub}</span>
          <span class="bar"><span class="axis"></span><i style="left:${l}%;width:${w}%;background:${SCALE(d.value)}"></i></span>
          <span class="val">${val}</span>`;
      })
      .on('mouseenter', (ev, d) => { if (canHover) { const [x, y] = anchorPoint(d.abbr); showTip(d.abbr, x, y); } })
      .on('mouseleave', hideTip)
      .on('focus', (ev, d) => highlight(d.abbr))
      .on('blur', () => highlight(null))
      .on('click', (ev, d) => togglePin(d.abbr, !canHover))
      .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); togglePin(d.abbr, false); } });
    list.order();
    const empty = $('#rank-empty');
    if (!entries.length) {
      empty.hidden = false;
      empty.textContent = S.view === 'gap'
        ? (!S.noSide ? `No state has a ${S.pos.toLowerCase()}-Yes measure and a matching race for this selection. Try ticking “Also count measures where this position was the No vote”, or another topic or race.` : 'No comparisons for this selection.')
        : 'No ideologically coded measures with a vote share for this topic.';
    } else if (S.view === 'gap' && !S.noSide) {
      const saved = S.noSide; S.noSide = true; const more = computeGap().states.size - entries.length; S.noSide = saved;
      empty.hidden = more <= 0;
      empty.textContent = more > 0 ? `${more} more state${more > 1 ? 's' : ''} appear if you tick “Also count measures where this position was the No vote”.` : '';
    } else empty.hidden = true;
    if (S.view === 'measures') {
      $('#rank-title').textContent = 'Average vote for the conservative position';
      $('#rank-sub').textContent = 'Small number = coded measures. Hover a row to find the state; click to pin it.';
    } else {
      $('#rank-title').textContent = `Average gap vs. ${PARTY[S.pos].name} candidate (pts)`;
      $('#rank-sub').textContent = 'Race used · number of measures. Hover a row to find the state; click to pin it.';
    }
  }

  function stat(k, v, d) { return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`; }

  function renderStats() {
    let html = '';
    if (S.view === 'measures') {
      const rows = V.rows, n = rows.length;
      const passed = rows.filter(m => m.status === 'Passed').length;
      const failed = rows.filter(m => m.status === 'Failed').length;
      const unc = n - passed - failed;
      const coded = rows.filter(m => m.winning_side_ideology === 'Conservative' || m.winning_side_ideology === 'Liberal');
      const consW = coded.filter(m => m.winning_side_ideology === 'Conservative').length;
      const withShare = rows.filter(isCoded);
      html += stat('Measures', n, `in ${V.states.size} state${V.states.size === 1 ? '' : 's'}`);
      html += stat('Passed', passed, `${failed} failed · ${unc} uncalled`);
      html += stat('Conservative side won', coded.length ? `${consW} of ${coded.length}` : '—', 'ideologically coded measures');
      html += stat('Avg. conservative-position vote', withShare.length ? `${f1(d3.mean(withShare, consShare))}%` : '—', `${withShare.length} measures with a vote share`);
    } else {
      const vals = Array.from(V.states.values());
      const P = PARTY[S.pos];
      const ahead = vals.filter(s => s.value > 0).length;
      html += stat('States compared', vals.length, OFFICE_SEL_LABEL[S.office]);
      html += stat('Measure comparisons', V.rows.length, S.noSide ? 'Yes- and No-side positions' : `measures where Yes = ${S.pos.toLowerCase()}`);
      html += stat('Median state gap', vals.length ? `${signed(d3.median(vals, s => s.value))} pts` : '—', `vs. ${P.name} candidate (${SHARE_LABEL[S.share]})`);
      html += stat('Position ran ahead', vals.length ? `${ahead} of ${vals.length}` : '—', `states where the ${S.pos.toLowerCase()} side beat the ${P.name} share`);
    }
    $('#stats').innerHTML = html;
  }

  // table ------------------------------------------------------------------
  const COLS = {
    measures: [
      { key: 'state', label: 'State', get: m => m.state },
      { key: 'measure', label: 'Measure', get: m => m.measure_id, html: m => `<div class="mname">${esc(m.measure_id)}</div><div class="mdesc">${esc(m.description)}</div>`, cmp: natural },
      { key: 'topic', label: 'Topic', get: m => m.topic },
      { key: 'status', label: 'Result', get: m => m.status, html: m => `<span class="status">${statusHTML(m.status)}</span>` },
      { key: 'yes', label: '% Yes', num: true, get: m => m.yes_share, html: m => (m.yes_share != null ? `${m.yes_share_approx ? '≈' : ''}${f1(m.yes_share)}` : `<span class="mdesc">${esc(m.pct_yes_reported_text || '—')}</span>`) },
      { key: 'pos', label: 'Yes position', get: m => m.yes_position },
      { key: 'src', label: 'Source', get: m => m.source, html: m => `<span class="mdesc">${esc(m.source)}</span>` },
    ],
    gap: [
      { key: 'state', label: 'State', get: c => c.state },
      { key: 'measure', label: 'Measure', get: c => c.measure_id, html: c => `<div class="mname">${esc(c.measure_id)}</div><div class="mdesc">${esc((MEAS.get(c.uid) || {}).description)}</div>`, cmp: natural },
      { key: 'topic', label: 'Topic', get: c => c.topic },
      { key: 'race', label: 'Race', get: c => c.race_label },
      { key: 'side', label: 'Side', get: c => c.position_side },
      { key: 'pshare', label: 'Position %', num: true, get: c => c.position_share, html: c => `${c.measure_share_approx ? '≈' : ''}${f1(c.position_share)}` },
      { key: 'cand', label: 'Candidate', get: c => c.candidate, html: c => `${esc(c.candidate)} (${esc(c.party)})` },
      { key: 'cshare', label: 'Candidate %', num: true, get: c => c['candidate_share_' + S.share], html: c => f1(c['candidate_share_' + S.share]) },
      { key: 'gap', label: 'Gap (pts)', num: true, get: c => c['gap_' + S.share], html: c => `<b>${signed(c['gap_' + S.share])}</b>` },
    ],
  };

  function renderTable() {
    const cols = COLS[S.view];
    let rows = V.rows.slice();
    if (S.pinned) rows = rows.filter(r => r.abbr === S.pinned);
    const sort = S.sort && cols.find(c => c.key === S.sort.key) ? S.sort : { key: 'state', dir: 1 };
    const col = cols.find(c => c.key === sort.key);
    rows.sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const r = col.num ? va - vb : (col.cmp || natural)(va, vb);
      return r * sort.dir || natural(a.measure_id, b.measure_id);
    });
    const head = `<thead><tr>${cols.map(c => `<th scope="col" class="${c.num ? 'num' : ''}" data-key="${c.key}" tabindex="0" aria-sort="${c.key === sort.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.label}</th>`).join('')}</tr></thead>`;
    const body = rows.length
      ? rows.map(r => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.get(r))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="mdesc">No rows for this selection.</td></tr>`;
    const t = $('#table');
    t.innerHTML = head + `<tbody>${body}</tbody>`;
    t.querySelectorAll('th').forEach(th => {
      const go = () => {
        const k = th.dataset.key;
        S.sort = { key: k, dir: sort.key === k ? -sort.dir : (cols.find(c => c.key === k).num ? -1 : 1) };
        renderTable();
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    $('#table-title').textContent = S.view === 'measures' ? 'Measures' : 'Measure-by-measure comparisons';
    const pinTxt = S.pinned ? ` · filtered to ${D.states[S.pinned]} (click the state again or “Unpin state” to clear)` : '';
    $('#table-sub').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}${S.topic === 'All' ? '' : ' · ' + S.topic}${pinTxt}`;
  }

  function renderTitles() {
    const topic = S.topic === 'All' ? 'All topics' : S.topic;
    if (S.view === 'measures') {
      $('#map-title').textContent = `Ballot measures by state — ${topic}`;
      $('#map-sub').textContent = 'Color shows the average vote for the conservative position on each state’s ideologically coded measures. Hover a state for every measure, its result and % yes.';
    } else {
      const P = PARTY[S.pos];
      $('#map-title').textContent = `${S.pos} positions vs. the ${P.name} ${OFFICE_SEL_LABEL[S.office]} candidate — ${topic}`;
      $('#map-sub').textContent = `Gap = vote share for the ${S.pos.toLowerCase()} position − ${P.name} candidate’s ${SHARE_LABEL[S.share]} share. ` +
        (S.noSide ? 'Includes measures where the position was the Yes or the No vote.' : `Only measures where a Yes vote was the ${S.pos.toLowerCase()} position.`);
    }
  }

  // ---------------------------------------------------------------- controls
  function buildTopicSelect() {
    const counts = d3.rollup(D.measures, v => v.length, m => m.topic);
    const sel = $('#ctl-topic');
    sel.innerHTML = `<option value="All">All topics (${D.measures.length})</option>` +
      D.topics.map(t => `<option value="${esc(t)}">${esc(t)} (${counts.get(t) || 0})</option>`).join('');
  }
  function syncControls() {
    document.querySelectorAll('input[name="view"]').forEach(i => { i.checked = i.value === S.view; });
    document.querySelectorAll('input[name="pos"]').forEach(i => { i.checked = i.value === S.pos; });
    document.querySelectorAll('input[name="office"]').forEach(i => { i.checked = i.value === S.office; });
    document.querySelectorAll('input[name="share"]').forEach(i => { i.checked = i.value === S.share; });
    $('#ctl-noside').checked = S.noSide;
    $('#ctl-topic').value = S.topic;
    document.body.classList.toggle('view-gap', S.view === 'gap');
  }
  function bindControls() {
    ['view', 'pos', 'office', 'share'].forEach(name => {
      document.querySelectorAll(`input[name="${name}"]`).forEach(i => i.addEventListener('change', () => {
        if (i.checked) { S[name] = i.value; S.sort = null; render(); }
      }));
    });
    $('#ctl-noside').addEventListener('change', e => { S.noSide = e.target.checked; render(); });
    $('#ctl-topic').addEventListener('change', e => { S.topic = e.target.value; render(); });
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    ['view', 'pos', 'office', 'share'].forEach(k => { if (ALLOWED[k].includes(p.get(k))) S[k] = p.get(k); });
    const t = p.get('topic');
    if (t && (t === 'All' || D.topics.includes(t))) S.topic = t;
    S.noSide = p.get('noside') === '1';
    const st = p.get('state');
    if (st && D.states[st]) S.pinned = st;
  }
  function writeHash() {
    const p = new URLSearchParams({ view: S.view, topic: S.topic });
    if (S.view === 'gap') { p.set('pos', S.pos); p.set('office', S.office); p.set('share', S.share); if (S.noSide) p.set('noside', '1'); }
    if (S.pinned) p.set('state', S.pinned);
    history.replaceState(null, '', '#' + p.toString());
  }

  // ---------------------------------------------------------------- main
  function render() {
    V = compute();
    SCALE = currentScale();
    syncControls();
    renderTitles();
    renderMap();
    renderLegend();
    renderRank();
    renderStats();
    renderDetail();
    renderTable();
    hideTip();
    writeHash();
  }

  $('#asof').textContent = `2026 general election · ${D.meta.as_of}`;
  $('#log').innerHTML = (D.meta.processing_log || []).map(l => `<li>${esc(l)}</li>`).join('');
  buildTopicSelect();
  readHash();
  bindControls();
  render();
  if (mq.addEventListener) mq.addEventListener('change', render);
  window.addEventListener('hashchange', () => { readHash(); render(); });
})();
