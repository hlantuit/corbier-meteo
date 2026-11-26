// D3 charts. Every chart re-renders on resize and language change through `mount()`.
import { t, fmt, getLang } from './i18n.js';
import { COLORS, SITE, MODELS } from './config.js';

const d3 = window.d3;
const HOUR = 3600e3;

// ---------- infrastructure ----------
const mounted = new Map();
export function mount(el, render) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  mounted.set(el, render);
  safeRender(el, render);
}
function safeRender(el, render) {
  try { el.innerHTML = ''; render(el, Math.max(280, el.clientWidth)); } catch (e) { console.error(e); el.innerHTML = `<div class="error">${t('misc.error')}</div>`; }
}
let rTimer;
const ro = new ResizeObserver(() => { clearTimeout(rTimer); rTimer = setTimeout(() => mounted.forEach((r, el) => safeRender(el, r)), 150); });
export function observe(el) { ro.observe(el); }
window.addEventListener('langchange', () => mounted.forEach((r, el) => safeRender(el, r)));

// Paris local time as a shifted UTC timestamp (lets d3.scaleUtc produce local ticks)
const offCache = new Map();
export function paris(ms) {
  const h = Math.floor(ms / HOUR);
  if (!offCache.has(h)) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
    const g = k => +parts.find(p => p.type === k).value;
    offCache.set(h, Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - Math.floor(ms / 60000) * 60000);
  }
  return ms + offCache.get(h);
}
const locale = () => (getLang() === 'fr' ? 'fr-FR' : 'en-GB');
const fmtUtc = (ms, o) => new Intl.DateTimeFormat(locale(), { ...o, timeZone: 'UTC' }).format(new Date(ms));
const dayLabel = ms => fmtUtc(ms, { weekday: 'short', day: 'numeric' });
const hourLabel = ms => fmtUtc(ms, { hour: '2-digit', minute: '2-digit' });

// Solar elevation (degrees) — NOAA approximation, good enough for night shading
export function solarElevation(ms, lat = SITE.lat, lon = SITE.lon) {
  const d = new Date(ms); const rad = Math.PI / 180;
  const jd = ms / 864e5 + 2440587.5; const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360; const g = (357.528 + 0.9856003 * n) % 360;
  const lambda = L + 1.915 * Math.sin(g * rad) + 0.02 * Math.sin(2 * g * rad);
  const eps = 23.439 - 0.0000004 * n;
  const dec = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const ra = Math.atan2(Math.cos(eps * rad) * Math.sin(lambda * rad), Math.cos(lambda * rad));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad + 0 * d;
}

// Tooltip
const tip = () => document.getElementById('tooltip');
export function showTip(evt, html) {
  const el = tip(); el.innerHTML = html; el.classList.add('show');
  const pad = 14; const w = el.offsetWidth, h = el.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
  el.style.left = x + 'px'; el.style.top = y + 'px';
}
export function hideTip() { tip().classList.remove('show'); }
const row = (key, val, sw) => `<div class="tt-row"><span class="tt-key">${sw ? `<span class="sw" style="width:10px;height:3px;border-radius:2px;background:${sw};display:inline-block"></span>` : ''}${key}</span><b>${val}</b></div>`;

export function legend(el, items) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  el.innerHTML = items.map(i => `<span class="k"${i.id ? ` data-id="${i.id}"` : ''}><span class="${i.shape || 'sw'}" style="background:${i.color};${i.border ? `border:1px solid ${i.border};` : ''}"></span>${i.label}</span>`).join('');
}

function svgIn(el, w, h) {
  return d3.select(el).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h).attr('role', 'img');
}

function nightBands(g, x, t0, t1, y0, y1) {
  const bands = []; let start = null;
  for (let tt = t0; tt <= t1; tt += HOUR / 2) {
    const night = solarElevation(tt) < -0.8;
    if (night && start === null) start = tt;
    if (!night && start !== null) { bands.push([start, tt]); start = null; }
  }
  if (start !== null) bands.push([start, t1]);
  g.selectAll('rect.night').data(bands).join('rect').attr('class', 'night')
    .attr('x', d => x(paris(d[0]))).attr('width', d => Math.max(0, x(paris(d[1])) - x(paris(d[0]))))
    .attr('y', y0).attr('height', y1 - y0);
}

// ========== 1. 48-hour meteogram (stacked panels sharing a time axis) ==========
export function meteogram(el, data) {
  mount(el, (node, W) => {
    const { c1550, c2265, c1300, now, obs } = data;
    const O = (obs || []).filter(o => o.time >= now - 24 * HOUR && o.time <= now);
    const t0 = now - (O.length ? 24 : 2) * HOUR; const t1 = now + 48 * HOUR;
    const sel = a => a.filter(d => d.time >= t0 && d.time <= t1 && d.n > 0);
    const A = sel(c1550), S = sel(c2265), V = sel(c1300);
    const OT = O.filter(o => o.t !== null && o.t !== undefined);
    if (!A.length) throw new Error('no data');
    const m = { l: 46, r: 64, t: 30, b: 26 };
    const panels = [
      { key: 'temp', h: 150, title: t('h48.temp') + ' (°C)' },
      { key: 'precip', h: 96, title: t('h48.precip') + ' (mm/h)' },
      { key: 'line', h: 120, title: t('h48.snowline') + ' (m)' },
      { key: 'wind', h: 86, title: t('h48.wind') + ' (km/h)' },
      { key: 'cloud', h: 46, title: t('h48.cloud') },
    ];
    const gap = 26; const H = m.t + panels.reduce((s, p) => s + p.h + gap, 0) + m.b;
    const svg = svgIn(node, W, H);
    const x = d3.scaleUtc().domain([paris(t0), paris(t1)]).range([m.l, W - m.r]);
    let y = m.t; panels.forEach(p => { p.y0 = y + 16; p.y1 = y + p.h; y += p.h + gap; });
    const root = svg.append('g');
    // night shading + day separators
    nightBands(root.append('g'), x, t0, t1, m.t, H - m.b);
    const days = d3.utcDay.range(new Date(paris(t0)), new Date(paris(t1)));
    root.append('g').selectAll('line').data(days).join('line').attr('class', 'day-sep')
      .attr('x1', d => x(d)).attr('x2', d => x(d)).attr('y1', m.t).attr('y2', H - m.b);
    root.append('g').selectAll('text').data(days.filter(d => x(d) < W - m.r - 60)).join('text').attr('class', 'day-label')
      .attr('x', d => x(d) + 6).attr('y', 14).text(d => dayLabel(+d));

    const px = d => x(paris(d.time));
    for (const p of panels) {
      const g = root.append('g');
      g.append('text').attr('class', 'panel-title').attr('x', m.l).attr('y', p.y0 - 6).text(p.title);
      if (p.key === 'temp') {
        const vals = [...A.flatMap(d => [d.tMin, d.tMax]), ...S.map(d => d.t), ...V.map(d => d.t), ...OT.map(o => o.t)].filter(v => v !== null);
        const yy = d3.scaleLinear().domain(d3.extent([...vals, 0])).nice().range([p.y1, p.y0]);
        g.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(''));
        g.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(4).tickSize(0).tickPadding(8)).call(s => s.select('.domain').remove());
        g.append('line').attr('class', 'ref-line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', yy(0)).attr('y2', yy(0)).attr('stroke', '#5aa9ff').attr('opacity', .6);
        g.append('path').datum(A).attr('fill', 'rgba(234,241,251,.10)').attr('d', d3.area().x(px).y0(d => yy(d.tMin)).y1(d => yy(d.tMax)).curve(d3.curveMonotoneX));
        const line = d3.line().x(px).y(d => yy(d.t)).curve(d3.curveMonotoneX).defined(d => d.t !== null);
        const series = [{ d: V, c: '#2370cd', w: 1.6, lab: '1 300 m' }, { d: S, c: '#9dc8f7', w: 1.6, lab: '2 265 m' }, { d: A, c: COLORS.consensus, w: 2.4, lab: '1 550 m' }];
        series.forEach(s => g.append('path').datum(s.d).attr('fill', 'none').attr('stroke', s.c).attr('stroke-width', s.w).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round').attr('d', line));
        g.selectAll('circle.obs').data(OT).join('circle').attr('class', 'obs').attr('cx', d => x(paris(d.time))).attr('cy', d => yy(d.t)).attr('r', 2.6).attr('fill', COLORS.obs).attr('stroke', '#0b1220').attr('stroke-width', 1);
        // end labels with collision avoidance
        const ends = series.map(s => ({ y: yy(s.d[s.d.length - 1].t), lab: s.lab, c: s.c })).sort((a, b) => a.y - b.y);
        for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
        ends.forEach(e => {
          g.append('circle').attr('cx', W - m.r + 6).attr('cy', e.y).attr('r', 3.5).attr('fill', e.c);
          g.append('text').attr('class', 'tick').attr('x', W - m.r + 14).attr('y', e.y + 4).text(e.lab);
        });
        p.y = yy;
      }
      if (p.key === 'precip') {
        const maxP = Math.max(1, d3.max(A.filter(d => !O.length || d.time > now), d => d.p || 0), d3.max(O, o => o.rr || 0) || 0);
        const yy = d3.scaleLinear().domain([0, maxP]).nice().range([p.y1, p.y0]);
        g.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(3).tickSize(-(W - m.l - m.r)).tickFormat(''));
        g.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(3).tickSize(0).tickPadding(8)).call(s => s.select('.domain').remove());
        const bw = Math.max(2, Math.min(12, (x(paris(now + HOUR)) - x(paris(now))) - 2));
        // past hours: what was measured; future: the forecast split into rain and snow
        const bars = A.filter(d => d.p > 0.02 && (!O.length || d.time > now));
        g.selectAll('rect.obs').data(O.filter(o => o.rr > 0)).join('rect').attr('class', 'obs').attr('x', o => x(paris(o.time)) - bw).attr('width', bw).attr('y', o => yy(o.rr)).attr('height', o => Math.max(0, yy(0) - yy(o.rr))).attr('fill', COLORS.obs).attr('opacity', .85).attr('rx', 1.5);
        if (O.length) {
          const hs = O.filter(o => o.hs !== null && o.hs !== undefined); let lo = hs.length ? hs[0].hs : 0, rise = 0; hs.forEach(o => { lo = Math.min(lo, o.hs); rise = Math.max(rise, o.hs - lo); });
          const rr = d3.sum(O, o => o.rr || 0);
          g.append('text').attr('class', 'tick').attr('x', x(paris(t0)) + 6).attr('y', p.y0 + 10).attr('fill', COLORS.obs)
            .text(getLang() === 'fr' ? `mesuré : ${fmt(rr, 0)} mm${rise >= 2 ? ` · +${fmt(rise, 0)} cm` : ''}` : `measured: ${fmt(rr, 0)} mm${rise >= 2 ? ` · +${fmt(rise, 0)} cm` : ''}`);
        }
        g.selectAll('rect.rain').data(bars).join('rect').attr('x', d => px(d) - bw).attr('width', bw).attr('y', d => yy(d.rain)).attr('height', d => Math.max(0, yy(0) - yy(d.rain))).attr('fill', COLORS.rain).attr('rx', 1.5);
        g.selectAll('rect.snow').data(bars).join('rect').attr('x', d => px(d) - bw).attr('width', bw).attr('y', d => yy(d.p)).attr('height', d => Math.max(0, yy(d.rain) - yy(d.p) - (d.rain > 0.02 ? 1 : 0))).attr('fill', COLORS.snow).attr('rx', 1.5);
        // 48 h totals
        const fut = A.filter(d => d.time > now);
        const cm = d3.sum(fut, d => d.cm || 0), mm = d3.sum(fut, d => d.rain || 0);
        g.append('text').attr('class', 'tick').attr('x', W - m.r + 8).attr('y', p.y0 + 10).attr('fill', COLORS.snow).text(`${fmt(cm, 0)} cm`);
        g.append('text').attr('class', 'tick').attr('x', W - m.r + 8).attr('y', p.y0 + 26).text(`${fmt(mm, 0)} mm`);
        g.append('text').attr('class', 'ref-text').attr('x', W - m.r + 8).attr('y', p.y0 + 40).text('48 h');
        p.y = yy;
      }
      if (p.key === 'line') {
        const yy = d3.scaleLinear().domain([800, 3200]).range([p.y1, p.y0]).clamp(true);
        g.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).tickValues([1000, 1500, 2000, 2500, 3000]).tickSize(0).tickPadding(8).tickFormat(d => fmt(d))).call(s => s.select('.domain').remove());
        // snow zone above the line, rain zone below
        const area = d3.area().x(px).curve(d3.curveMonotoneX).defined(d => d.line !== null);
        g.append('path').datum(A).attr('fill', 'rgba(62,142,247,.13)').attr('d', area.y0(yy(800)).y1(d => yy(d.line)));
        g.append('path').datum(A).attr('fill', 'rgba(223,243,255,.08)').attr('d', d3.area().x(px).curve(d3.curveMonotoneX).defined(d => d.line !== null).y0(d => yy(d.line)).y1(yy(3200)));
        g.append('path').datum(A).attr('fill', 'rgba(223,243,255,.10)').attr('d', d3.area().x(px).curve(d3.curveMonotoneX).defined(d => d.lineMin !== null).y0(d => yy(d.lineMin)).y1(d => yy(d.lineMax)));
        g.append('path').datum(A).attr('fill', 'none').attr('stroke', COLORS.snow).attr('stroke-width', 2.2).attr('d', d3.line().x(px).y(d => yy(d.line)).curve(d3.curveMonotoneX).defined(d => d.line !== null));
        [[1550, 'Le Corbier'], [2265, 'Pte du Corbier']].forEach(([z, lab]) => {
          g.append('line').attr('class', 'ref-line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', yy(z)).attr('y2', yy(z)).attr('opacity', .9);
          g.append('text').attr('class', 'ref-text').attr('x', W - m.r + 8).attr('y', yy(z) + 4).text(lab);
        });
        g.append('text').attr('class', 'ref-text').attr('x', m.l + 8).attr('y', p.y1 - 6).text(t('leg.rain'));
        g.append('text').attr('class', 'ref-text').attr('x', m.l + 8).attr('y', p.y0 + 12).text(t('leg.snow'));
        p.y = yy;
      }
      if (p.key === 'wind') {
        const yy = d3.scaleLinear().domain([0, Math.max(30, d3.max(A, d => d.gust || 0))]).nice().range([p.y1, p.y0]);
        g.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(3).tickSize(-(W - m.l - m.r)).tickFormat(''));
        g.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(3).tickSize(0).tickPadding(8)).call(s => s.select('.domain').remove());
        g.append('path').datum(A).attr('fill', 'rgba(152,135,239,.16)').attr('d', d3.area().x(px).y0(d => yy(d.wind || 0)).y1(d => yy(d.gust || 0)).curve(d3.curveMonotoneX));
        g.append('path').datum(A).attr('fill', 'none').attr('stroke', '#9887ef').attr('stroke-width', 2).attr('d', d3.line().x(px).y(d => yy(d.wind || 0)).curve(d3.curveMonotoneX));
        const arrows = A.filter(d => d.dir !== null && Math.round(d.time / HOUR) % 3 === 0);
        g.selectAll('path.arr').data(arrows).join('path').attr('class', 'arr')
          .attr('d', 'M0,-6 L3.5,3 L0,1 L-3.5,3 Z').attr('fill', COLORS.ink2)
          .attr('transform', d => `translate(${px(d)},${p.y0 - 0}) rotate(${(d.dir + 180) % 360})`);
        p.y = yy;
      }
      if (p.key === 'cloud') {
        const rows = [['cloudHigh', 'H'], ['cloudMid', 'M'], ['cloudLow', 'B']];
        const rh = (p.y1 - p.y0) / 3; const cw = Math.max(1, x(paris(now + HOUR)) - x(paris(now)));
        rows.forEach(([k, lab], ri) => {
          g.selectAll(`rect.c${ri}`).data(A).join('rect').attr('x', d => px(d) - cw).attr('width', cw + 0.5).attr('y', p.y0 + ri * rh).attr('height', rh - 2)
            .attr('fill', '#c9d6ea').attr('opacity', d => ((d[k] || 0) / 100) * 0.85);
          g.append('text').attr('class', 'tick').attr('x', m.l - 10).attr('y', p.y0 + ri * rh + rh / 2 + 3).attr('text-anchor', 'end').text(getLang() === 'fr' ? lab : lab.replace('B', 'L'));
        });
      }
    }
    // x axis
    root.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b + 4})`)
      .call(d3.axisBottom(x).ticks(d3.utcHour.every(W < 600 ? 12 : 6)).tickSize(0).tickPadding(6).tickFormat(d => hourLabel(+d))).call(s => s.select('.domain').remove());
    // now marker
    root.append('line').attr('class', 'now-line').attr('x1', x(paris(now))).attr('x2', x(paris(now))).attr('y1', 30).attr('y2', H - m.b);
    root.append('text').attr('class', 'now-text').attr('x', x(paris(now)) + 5).attr('y', 26).text(getLang() === 'fr' ? 'MAINTENANT' : 'NOW');
    // hover
    const cross = root.append('line').attr('stroke', COLORS.ink).attr('stroke-width', 1).attr('opacity', 0).attr('y1', m.t).attr('y2', H - m.b);
    const bis = d3.bisector(d => paris(d.time)).center;
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', evt => {
        const [mx] = d3.pointer(evt); const i = bis(A, +x.invert(mx)); const d = A[i]; if (!d) return;
        cross.attr('x1', px(d)).attr('x2', px(d)).attr('opacity', .5);
        const s = S[Math.min(i, S.length - 1)], v = V[Math.min(i, V.length - 1)];
        const o = d.time <= now ? O.find(r => r.time === d.time) : null;
        showTip(evt, `<div class="tt-title">${dayLabel(paris(d.time))} · ${hourLabel(paris(d.time))}</div>` +
          row('1 550 m', `${fmt(d.t, 1)} °C`, COLORS.consensus) + row('2 265 m', `${fmt(s && s.t, 1)} °C`, '#9dc8f7') + row('1 300 m', `${fmt(v && v.t, 1)} °C`, '#2370cd') +
          row(t('leg.snow'), `${fmt(d.cm, 1)} cm`, COLORS.snow) + row(t('leg.rain'), `${fmt(d.rain, 1)} mm`, COLORS.rain) +
          row(t('now.snowline'), d.line !== null ? `${fmt(Math.round(d.line / 50) * 50)} m` : '–') +
          row(t('now.wind'), `${fmt(d.wind, 0)} / ${fmt(d.gust, 0)} km/h`) +
          (o ? row(getLang() === 'fr' ? 'Mesuré St-Jean' : 'Measured St-Jean', `${fmt(o.t, 1)} °C · ${fmt(o.rr, 1)} mm${o.hs !== null && o.hs !== undefined ? ` · ${fmt(o.hs, 0)} cm` : ''}`, COLORS.obs) : '') +
          `<div class="tt-row" style="margin-top:4px"><span>${t('misc.lead')}</span><b>${d.n} ${getLang() === 'fr' ? 'modèles' : 'models'}</b></div>`);
      })
      .on('pointerleave', () => { cross.attr('opacity', 0); hideTip(); });
  });
}

// Isolate one series of a multi-line chart (others dimmed); id null restores all
export function highlight(el, id) {
  const root = typeof el === 'string' ? document.getElementById(el) : el; if (!root) return;
  root.querySelectorAll('path[data-id]').forEach(p => {
    const on = p.dataset.id === id;
    p.style.opacity = !id || on ? '' : '0.1';
    p.style.strokeWidth = on && id !== 'consensus' ? '3px' : '';
    if (on) p.parentNode.appendChild(p);
  });
}

// ========== 2. Fresh snow by elevation ==========
export function altitudeChart(el, rows) {
  // rows: [{ z, label, cons, min, max, models: {id: cm} }]
  mount(el, (node, W) => {
    const m = { l: 92, r: 54, t: 10, b: 30 };
    const H = 300; const svg = svgIn(node, W, H);
    const y = d3.scaleBand().domain(rows.map(r => r.z).sort((a, b) => b - a)).range([m.t, H - m.b]).padding(0.32);
    const maxV = Math.max(5, d3.max(rows, r => r.max || 0), d3.max(rows, r => r.cons || 0));
    const x = d3.scaleLinear().domain([0, maxV]).nice().range([m.l, W - m.r]);
    // ridge silhouette in the background
    const ridge = d3.area().x(d => d[0]).y0(H - m.b).y1(d => d[1]).curve(d3.curveCatmullRom);
    const pts = [[m.l - 80, H - m.b - 10], [m.l + (W - m.l) * 0.15, H - m.b - 70], [m.l + (W - m.l) * 0.32, H - m.b - 120], [m.l + (W - m.l) * 0.45, H - m.b - 210], [m.l + (W - m.l) * 0.6, H - m.b - 160], [m.l + (W - m.l) * 0.75, H - m.b - 235], [W, H - m.b - 120]];
    svg.append('path').datum(pts).attr('d', ridge).attr('fill', 'url(#ridgeGrad)');
    const defs = svg.append('defs');
    const lg = defs.append('linearGradient').attr('id', 'ridgeGrad').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
    lg.append('stop').attr('offset', 0).attr('stop-color', 'rgba(223,243,255,.10)');
    lg.append('stop').attr('offset', 1).attr('stop-color', 'rgba(223,243,255,0)');
    const bg = defs.append('linearGradient').attr('id', 'barGrad').attr('x1', 0).attr('x2', 1);
    bg.append('stop').attr('offset', 0).attr('stop-color', '#7fd4ff');
    bg.append('stop').attr('offset', 1).attr('stop-color', '#dff3ff');
    svg.append('g').attr('class', 'grid').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(4).tickSize(-(H - m.t - m.b)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(8).tickFormat(d => `${fmt(d)} cm`)).call(s => s.select('.domain').remove());
    const g = svg.append('g');
    rows.forEach(r => {
      const yy = y(r.z), bh = y.bandwidth();
      g.append('text').attr('class', 'tick').attr('x', m.l - 12).attr('y', yy + bh / 2 - 2).attr('text-anchor', 'end').attr('fill', COLORS.ink).style('font-weight', 700).text(`${fmt(r.z)} m`);
      g.append('text').attr('class', 'ref-text').attr('x', m.l - 12).attr('y', yy + bh / 2 + 11).attr('text-anchor', 'end').text(r.short);
      if (r.min !== null && r.max !== null) g.append('line').attr('x1', x(r.min)).attr('x2', x(r.max)).attr('y1', yy + bh / 2).attr('y2', yy + bh / 2).attr('stroke', COLORS.ink2).attr('stroke-width', 1.5);
      const bar = g.append('rect').attr('x', x(0)).attr('y', yy + bh * 0.2).attr('height', bh * 0.6).attr('rx', 4).attr('fill', 'url(#barGrad)').attr('width', 0);
      bar.transition().duration(700).attr('width', Math.max(2, x(r.cons || 0) - x(0)));
      g.append('text').attr('class', 'tick').attr('x', x(Math.max(r.cons || 0, r.max || 0)) + 8).attr('y', yy + bh / 2 + 4).attr('fill', COLORS.ink).style('font-weight', 800).style('font-size', '12.5px').text(`${fmt(r.cons, 0)} cm`);
      g.append('rect').attr('x', m.l).attr('y', yy).attr('width', W - m.l - m.r).attr('height', bh).attr('fill', 'transparent')
        .on('pointermove', evt => showTip(evt, `<div class="tt-title">${fmt(r.z)} m · ${r.short}</div>` + row(t('leg.consensus'), `${fmt(r.cons, 0)} cm`, COLORS.snow) + row(t('leg.range'), `${fmt(r.min, 0)} – ${fmt(r.max, 0)} cm`) +
          Object.entries(r.models).sort((a, b) => b[1] - a[1]).map(([id, v]) => { const md = MODELS.find(mm => mm.id === id); return row(md ? md.short : id, `${fmt(v, 0)} cm`, md && md.color ? md.color : '#6b7d97'); }).join('')))
        .on('pointerleave', hideTip);
    });
  });
}

// ========== 3. Ensemble: daily fresh snow boxes ==========
export function ensembleDaily(el, st, now, past = []) {
  mount(el, (node, W) => {
    const m = { l: 40, r: 16, t: 26, b: 40 };
    const H = 240; const svg = svgIn(node, W, H);
    const days = st.days.map((d, i) => ({ d, i, q: st.dq[i] })).filter(o => o.q);
    const obs = past.filter(p => days.length && p.d < days[0].d);
    const x = d3.scaleBand().domain([...obs.map(o => o.d), ...days.map(o => o.d)]).range([m.l, W - m.r]).padding(0.38);
    const maxV = Math.max(10, d3.max(days, o => o.q.p90), d3.max(obs, o => o.cm) || 0);
    const y = d3.scaleLinear().domain([0, maxV]).nice().range([H - m.b, m.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8)).call(s => s.select('.domain').remove());
    svg.append('text').attr('class', 'ref-text').attr('x', m.l).attr('y', 12).text('cm');
    const bw = Math.min(24, x.bandwidth());
    const g = svg.append('g');
    const narrowAll = x.bandwidth() < 30;
    const dayTicks = (cx, dt, k) => {
      if (!narrowAll) g.append('text').attr('class', 'tick').attr('x', cx).attr('y', H - m.b + 16).attr('text-anchor', 'middle').text(fmtUtc(+dt, { weekday: 'short' }));
      if (!narrowAll || k % 2 === 0) g.append('text').attr('class', 'tick').attr('x', cx).attr('y', H - m.b + (narrowAll ? 16 : 30)).attr('text-anchor', 'middle').attr('fill', narrowAll ? COLORS.ink2 : COLORS.ink3).text(fmtUtc(+dt, { day: 'numeric' }));
    };
    // measured days, left of today
    obs.forEach((o, k) => {
      const cx = x(o.d) + x.bandwidth() / 2; const dt = new Date(o.d + 'T12:00:00Z');
      const h = Math.max(o.cm > 0 ? 2 : 1, y(0) - y(o.cm));
      g.append('rect').attr('x', cx - bw / 2).attr('width', bw).attr('y', y(0) - h).attr('height', h).attr('rx', 4).attr('fill', COLORS.obs).attr('opacity', o.cm > 0 ? 0.9 : 0.35);
      if (o.cm >= 1) g.append('text').attr('class', 'tick').attr('x', cx).attr('y', y(o.cm) - 6).attr('text-anchor', 'middle').attr('fill', COLORS.obs).style('font-weight', 800).text(fmt(o.cm, 0));
      dayTicks(cx, dt, k - obs.length);
      g.append('rect').attr('x', x(o.d)).attr('width', x.bandwidth()).attr('y', m.t).attr('height', H - m.t - m.b).attr('fill', 'transparent')
        .on('pointermove', evt => showTip(evt, `<div class="tt-title">${fmtUtc(+dt, { weekday: 'long', day: 'numeric', month: 'long' })}</div>` +
          row(getLang() === 'fr' ? 'Neige fraîche mesurée' : 'Measured fresh snow', `${fmt(o.cm, 0)} cm`, COLORS.obs) +
          (o.mm !== null && o.mm !== undefined ? row(getLang() === 'fr' ? 'Précipitations' : 'Precipitation', `${fmt(o.mm, 1)} mm`) : '') +
          `<div class="tt-row" style="margin-top:4px"><span>${o.src === 'corbier' ? (getLang() === 'fr' ? 'Relevé du Corbier, 1 585 m' : 'Le Corbier report, 1,585 m') : (getLang() === 'fr' ? 'Hausse de la hauteur de neige, St-Jean-d’Arves' : 'Rise of snow depth, St-Jean-d’Arves')}</span></div>`))
        .on('pointerleave', hideTip);
    });
    if (obs.length) {
      const xs = x(days[0].d) - x.step() * x.paddingInner() / 2 - 1;
      g.append('line').attr('x1', xs).attr('x2', xs).attr('y1', m.t - 2).attr('y2', H - m.b + 6).attr('stroke', COLORS.ink3).attr('stroke-dasharray', '3 3');
      g.append('text').attr('class', 'ref-text').attr('x', xs - 6).attr('y', m.t - 8).attr('text-anchor', 'end').attr('fill', COLORS.obs).text(getLang() === 'fr' ? 'mesuré' : 'measured');
    }
    days.forEach(o => {
      const cx = x(o.d) + x.bandwidth() / 2; const q = o.q;
      g.append('line').attr('x1', cx).attr('x2', cx).attr('y1', y(q.p10)).attr('y2', y(q.p90)).attr('stroke', COLORS.glacier || '#7fd4ff').attr('stroke-width', 1.5).attr('opacity', .8);
      g.append('rect').attr('x', cx - bw / 2).attr('width', bw).attr('y', y(q.p75)).attr('height', Math.max(1.5, y(q.p25) - y(q.p75))).attr('rx', 4).attr('fill', 'rgba(127,212,255,.35)');
      g.append('line').attr('x1', cx - bw / 2).attr('x2', cx + bw / 2).attr('y1', y(q.p50)).attr('y2', y(q.p50)).attr('stroke', COLORS.snow).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
      // probability of ≥1 cm as a small pill above
      const pr = Math.round(q.pAny * 100); const narrow = narrowAll; const k = days.indexOf(o);
      if ((!narrow || k % 2 === 0) && !(obs.length && k === 0 && narrow)) g.append('text').attr('class', 'tick').attr('x', cx).attr('y', m.t - 8).attr('text-anchor', 'middle').attr('fill', pr >= 50 ? COLORS.snow : COLORS.ink3).style('font-weight', pr >= 50 ? 800 : 600).text(`${pr}%`);
      const dt = new Date(o.d + 'T12:00:00Z');
      dayTicks(cx, dt, k);
      g.append('rect').attr('x', x(o.d)).attr('width', x.bandwidth()).attr('y', m.t).attr('height', H - m.t - m.b).attr('fill', 'transparent')
        .on('pointermove', evt => showTip(evt, `<div class="tt-title">${fmtUtc(+dt, { weekday: 'long', day: 'numeric', month: 'long' })}</div>` +
          row(t('leg.median'), `${fmt(q.p50, 0)} cm`, COLORS.snow) + row('25 – 75 %', `${fmt(q.p25, 0)} – ${fmt(q.p75, 0)} cm`) + row('10 – 90 %', `${fmt(q.p10, 0)} – ${fmt(q.p90, 0)} cm`) +
          row(t('misc.prob') + ' ≥ 1 cm', `${pr} %`)))
        .on('pointerleave', hideTip);
    });
  });
}

// ========== 4. Ensemble temperature plume ==========
export function ensembleTemp(el, ens, st) {
  mount(el, (node, W) => {
    const m = { l: 40, r: 14, t: 12, b: 28 };
    const H = 270; const svg = svgIn(node, W, H);
    const T = ens.time.map(paris);
    const x = d3.scaleUtc().domain(d3.extent(T)).range([m.l, W - m.r]);
    const vals = st.tq.filter(Boolean);
    const y = d3.scaleLinear().domain([Math.min(-12, d3.min(vals, q => q.p10) - 2), Math.max(6, d3.max(vals, q => q.p90) + 2)]).nice().range([H - m.b, m.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8).tickFormat(d => `${d}°`)).call(s => s.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b + 4})`).call(d3.axisBottom(x).ticks(d3.utcDay.every(W < 600 ? 3 : 2)).tickSize(0).tickPadding(6).tickFormat(d => dayLabel(+d))).call(s => s.select('.domain').remove());
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', '#5aa9ff').attr('opacity', .6);
    const line = d3.line().x((d, i) => x(T[i])).y(d => y(d)).defined(d => d !== null && d !== undefined).curve(d3.curveMonotoneX);
    const g = svg.append('g');
    ens.members.forEach(mm => g.append('path').datum(mm.temperature_2m.map((v, i) => (v === null || v === undefined ? null : v - (st.corr ? st.corr[i] : 0)))).attr('fill', 'none').attr('stroke', '#5aa9ff').attr('stroke-opacity', .13).attr('stroke-width', 1).attr('d', line));
    const qd = st.tq.map((q, i) => ({ q, i })).filter(o => o.q);
    g.append('path').datum(qd).attr('fill', 'rgba(127,212,255,.16)').attr('d', d3.area().x(o => x(T[o.i])).y0(o => y(o.q.p10)).y1(o => y(o.q.p90)).curve(d3.curveMonotoneX));
    g.append('path').datum(qd).attr('fill', 'none').attr('stroke', COLORS.consensus).attr('stroke-width', 2.2).attr('d', d3.line().x(o => x(T[o.i])).y(o => y(o.q.p50)).curve(d3.curveMonotoneX));
    const cross = svg.append('line').attr('stroke', COLORS.ink).attr('opacity', 0).attr('y1', m.t).attr('y2', H - m.b);
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', evt => {
        const [mx] = d3.pointer(evt); const i = d3.bisector(v => v).center(T, +x.invert(mx)); const q = st.tq[i]; if (!q) return;
        cross.attr('x1', x(T[i])).attr('x2', x(T[i])).attr('opacity', .45);
        showTip(evt, `<div class="tt-title">${dayLabel(T[i])} · ${hourLabel(T[i])}</div>` + row(t('leg.median'), `${fmt(q.p50, 1)} °C`, COLORS.consensus) + row('10 – 90 %', `${fmt(q.p10, 1)} … ${fmt(q.p90, 1)} °C`, '#7fd4ff'));
      }).on('pointerleave', () => { cross.attr('opacity', 0); hideTip(); });
  });
}

// ========== 5. Ensemble cumulative fan ==========
export function ensembleCum(el, st) {
  mount(el, (node, W) => {
    const m = { l: 40, r: 50, t: 12, b: 28 };
    const H = 270; const svg = svgIn(node, W, H);
    const D = st.days.map(d => Date.parse(d + 'T12:00:00Z'));
    const data = st.cq.map((q, i) => ({ q, x: D[i] })).filter(o => o.q);
    const x = d3.scaleUtc().domain(d3.extent(D)).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, Math.max(20, d3.max(data, o => o.q.p90))]).nice().range([H - m.b, m.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8)).call(s => s.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b + 4})`).call(d3.axisBottom(x).ticks(d3.utcDay.every(W < 500 ? 4 : 3)).tickSize(0).tickPadding(6).tickFormat(d => dayLabel(+d))).call(s => s.select('.domain').remove());
    const area = (a, b) => d3.area().x(o => x(o.x)).y0(o => y(o.q[a])).y1(o => y(o.q[b])).curve(d3.curveMonotoneX);
    svg.append('path').datum(data).attr('fill', 'rgba(127,212,255,.14)').attr('d', area('p10', 'p90'));
    svg.append('path').datum(data).attr('fill', 'rgba(127,212,255,.26)').attr('d', area('p25', 'p75'));
    svg.append('path').datum(data).attr('fill', 'none').attr('stroke', COLORS.snow).attr('stroke-width', 2.4).attr('d', d3.line().x(o => x(o.x)).y(o => y(o.q.p50)).curve(d3.curveMonotoneX));
    const last = data[data.length - 1];
    if (last) {
      [['p90', '90 %'], ['p50', t('leg.median')], ['p10', '10 %']].forEach(([k, lab]) => svg.append('text').attr('class', 'tick').attr('x', x(last.x) + 6).attr('y', y(last.q[k]) + 4).attr('fill', k === 'p50' ? COLORS.snow : COLORS.ink2).text(`${fmt(last.q[k], 0)}`));
      svg.append('text').attr('class', 'ref-text').attr('x', W - m.r + 6).attr('y', m.t + 4).text('cm');
    }
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', evt => {
        const [mx] = d3.pointer(evt); const i = d3.bisector(o => o.x).center(data, +x.invert(mx)); const o = data[i]; if (!o) return;
        showTip(evt, `<div class="tt-title">${fmtUtc(o.x, { weekday: 'long', day: 'numeric', month: 'short' })}</div>` + row(t('leg.median'), `${fmt(o.q.p50, 0)} cm`, COLORS.snow) + row('25 – 75 %', `${fmt(o.q.p25, 0)} – ${fmt(o.q.p75, 0)} cm`) + row('10 – 90 %', `${fmt(o.q.p10, 0)} – ${fmt(o.q.p90, 0)} cm`));
      }).on('pointerleave', hideTip);
  });
}

// ========== 6. Model comparison ==========
export function comparator(el, series, consensusSeries, opts) {
  // series: [{ id, short, color, values: [{time, v}] }], consensusSeries: [{time, v}]
  mount(el, (node, W) => {
    const m = { l: 48, r: 84, t: 12, b: 28 };
    const H = 340; const svg = svgIn(node, W, H);
    const all = series.flatMap(s => s.values).concat(consensusSeries).filter(d => d.v !== null && d.v !== undefined);
    if (!all.length) throw new Error('no data');
    const x = d3.scaleUtc().domain(d3.extent(all, d => paris(d.time))).range([m.l, W - m.r]);
    const ext = d3.extent(all, d => d.v); if (opts.zeroBased) ext[0] = 0;
    const y = d3.scaleLinear().domain(ext).nice().range([H - m.b, m.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8).tickFormat(d => fmt(d))).call(s => s.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b + 4})`).call(d3.axisBottom(x).ticks(d3.utcDay.every(W < 700 ? 3 : 1)).tickSize(0).tickPadding(6).tickFormat(d => dayLabel(+d))).call(s => s.select('.domain').remove());
    svg.append('text').attr('class', 'ref-text').attr('x', m.l).attr('y', m.t - 2).text(opts.unit);
    if (opts.zeroLine) svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', '#5aa9ff').attr('opacity', .6);
    const line = d3.line().x(d => x(paris(d.time))).y(d => y(d.v)).defined(d => d.v !== null && d.v !== undefined).curve(d3.curveMonotoneX);
    const g = svg.append('g');
    series.filter(s => !s.color).forEach(s => g.append('path').datum(s.values).attr('data-id', 'extra').attr('fill', 'none').attr('stroke', '#6b7d97').attr('stroke-width', 1.2).attr('opacity', .7).attr('d', line));
    series.filter(s => s.color).forEach(s => g.append('path').datum(s.values).attr('data-id', s.id).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 1.8).attr('stroke-linecap', 'round').attr('d', line));
    g.append('path').datum(consensusSeries).attr('data-id', 'consensus').attr('fill', 'none').attr('stroke', COLORS.consensus).attr('stroke-width', 3).attr('stroke-linecap', 'round').attr('d', line);
    if (opts.focus) highlight(node, opts.focus);
    // end labels for cumulative views (models end at different times)
    if (opts.endLabels) {
      const ends = series.concat([{ short: t('leg.consensus').split(' ')[0], color: COLORS.consensus, values: consensusSeries }]).map(s => {
        const v = s.values.filter(d => d.v !== null && d.v !== undefined); const l = v[v.length - 1];
        return l ? { y: y(l.v), x: x(paris(l.time)), lab: `${s.short} ${fmt(l.v, 0)}`, c: s.color || '#6b7d97' } : null;
      }).filter(Boolean).filter(e => e.x > W - m.r - 40).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
      ends.forEach(e => { svg.append('circle').attr('cx', W - m.r + 6).attr('cy', e.y).attr('r', 3).attr('fill', e.c); svg.append('text').attr('class', 'tick').attr('x', W - m.r + 13).attr('y', e.y + 4).style('font-size', '10.5px').text(e.lab); });
    }
    const T = consensusSeries.map(d => paris(d.time));
    const cross = svg.append('line').attr('stroke', COLORS.ink).attr('opacity', 0).attr('y1', m.t).attr('y2', H - m.b);
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', evt => {
        const [mx] = d3.pointer(evt); const i = d3.bisector(v => v).center(T, +x.invert(mx)); const tt = consensusSeries[i] && consensusSeries[i].time; if (!tt) return;
        cross.attr('x1', x(paris(tt))).attr('x2', x(paris(tt))).attr('opacity', .45);
        const rows = series.map(s => { const d = s.values.find(v => v.time === tt); return d && d.v !== null && d.v !== undefined ? { lab: s.short, v: d.v, c: s.color || '#6b7d97' } : null; }).filter(Boolean).sort((a, b) => b.v - a.v);
        showTip(evt, `<div class="tt-title">${dayLabel(paris(tt))} · ${hourLabel(paris(tt))}</div>` + row(t('leg.consensus'), `${fmt(consensusSeries[i].v, opts.digits)} ${opts.unit}`, COLORS.consensus) + rows.map(r => row(r.lab, `${fmt(r.v, opts.digits)}`, r.c)).join(''));
      }).on('pointerleave', () => { cross.attr('opacity', 0); hideTip(); });
  });
}

// ========== 7. Anomaly bars (weekly / monthly) ==========
export function anomalyBars(el, items, opts) {
  // items: [{ label, sub, v, members?: [..], systems?: [{name, v}] }]
  mount(el, (node, W) => {
    const m = { l: 44, r: 12, t: 16, b: 44 };
    const H = 270; const svg = svgIn(node, W, H);
    const vals = items.flatMap(i => [i.v, ...(i.lo !== undefined ? [i.lo, i.hi] : []), ...((i.systems || []).map(s => s.v))]).filter(v => v !== null && v !== undefined);
    const ext = Math.max(opts.minExt || 1, d3.max(vals, v => Math.abs(v)) || 1) * 1.15;
    const y = d3.scaleLinear().domain([-ext, ext]).nice().range([H - m.b, m.t]);
    const x = d3.scaleBand().domain(items.map((_, i) => i)).range([m.l, W - m.r]).padding(0.35);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8).tickFormat(d => (d > 0 ? '+' : '') + fmt(d, opts.digits || 0))).call(s => s.select('.domain').remove());
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', '#55657d');
    svg.append('text').attr('class', 'ref-text').attr('x', m.l).attr('y', m.t - 4).text(opts.unit);
    const bw = Math.min(26, x.bandwidth());
    items.forEach((it, i) => {
      const cx = x(i) + x.bandwidth() / 2; const v = it.v;
      if (it.lo !== undefined && it.lo !== null) svg.append('line').attr('x1', cx).attr('x2', cx).attr('y1', y(it.lo)).attr('y2', y(it.hi)).attr('stroke', COLORS.ink3).attr('stroke-width', 1.5);
      if (v !== null && v !== undefined) {
        const c = v >= 0 ? opts.pos : opts.neg; const y0 = y(0), y1 = y(v);
        const h = Math.abs(y1 - y0); const r = Math.min(4, h);
        const top = Math.min(y0, y1);
        // rounded data-end, square at the baseline
        const path = v >= 0
          ? `M${cx - bw / 2},${y0} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${y0} Z`
          : `M${cx - bw / 2},${y0} V${y1 - r} Q${cx - bw / 2},${y1} ${cx - bw / 2 + r},${y1} H${cx + bw / 2 - r} Q${cx + bw / 2},${y1} ${cx + bw / 2},${y1 - r} V${y0} Z`;
        svg.append('path').attr('d', path).attr('fill', c);
        svg.append('text').attr('class', 'tick').attr('x', cx).attr('y', v >= 0 ? y1 - 6 : y1 + 14).attr('text-anchor', 'middle').attr('fill', COLORS.ink).style('font-weight', 700).text((v > 0 ? '+' : '') + fmt(v, opts.digits || 0));
      }
      (it.systems || []).forEach((s, k) => svg.append('circle').attr('cx', cx + (k - (it.systems.length - 1) / 2) * 3).attr('cy', y(s.v)).attr('r', 3).attr('fill', '#c9d6ea').attr('stroke', COLORS.surface).attr('stroke-width', 1.5));
      svg.append('text').attr('class', 'tick').attr('x', cx).attr('y', H - m.b + 16).attr('text-anchor', 'middle').attr('fill', COLORS.ink).text(it.label);
      if (it.sub) svg.append('text').attr('class', 'tick').attr('x', cx).attr('y', H - m.b + 30).attr('text-anchor', 'middle').attr('fill', COLORS.ink3).text(it.sub);
      svg.append('rect').attr('x', x(i)).attr('width', x.bandwidth()).attr('y', m.t).attr('height', H - m.t - m.b).attr('fill', 'transparent')
        .on('pointermove', evt => showTip(evt, `<div class="tt-title">${it.title || it.label}</div>` + row(opts.name, v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${fmt(v, opts.digits || 1)} ${opts.unit}`) +
          (it.lo !== undefined && it.lo !== null ? row('10 – 90 %', `${fmt(it.lo, 1)} … ${fmt(it.hi, 1)}`) : '') + (it.extra || '') + (it.systems || []).map(s => row(s.name, `${s.v > 0 ? '+' : ''}${fmt(s.v, 1)}`)).join('')))
        .on('pointerleave', hideTip);
    });
  });
}

// ========== 8. Verification heatmap (HTML table) ==========
export function verificationTable(el, verif, metric) {
  if (typeof el === 'string') el = document.getElementById(el);
  const order = ['meteoswiss_icon_ch1', 'meteoswiss_icon_ch2', 'icon_d2', 'italia_meteo_arpae_icon_2i', 'meteofrance_arome_france_hd', 'meteofrance_arome_france',
    'icon_eu', 'meteofrance_arpege_europe', 'ecmwf_aifs025_single', 'ecmwf_ifs', 'ukmo_global_deterministic_10km', 'gfs_seamless', 'mean_hires', 'mean_all'];
  const M = {
    temp: { get: s => s.t && s.t[0], better: 'low', dom: [0.8, 3.2], digits: 1 },
    tempraw: { get: s => s.t && s.t[1], better: 'low', dom: [0.8, 5], digits: 1 },
    precip: { get: s => s.p && s.p[0], better: 'high', dom: [0.25, 0.78], digits: 2 },
    snow: { get: s => s.s && s.s[0], better: 'high', dom: [0.15, 0.66], digits: 2 },
  }[metric];
  const leads = [0, 1, 2, 3, 4, 5, 6, 7];
  const ramp = d3.scaleSequential(d3.interpolateRgbBasis(['#14233a', '#1b64be', '#338ced', '#84b9f3', '#dff3ff'])).domain(M.better === 'low' ? [M.dom[1], M.dom[0]] : M.dom).clamp(true);
  const best = leads.map(L => {
    const v = order.filter(id => !id.startsWith('mean')).map(id => verif.scores[id] && verif.scores[id][L] ? M.get(verif.scores[id][L]) : null).filter(x => x !== null && x !== undefined);
    return v.length ? (M.better === 'low' ? Math.min(...v) : Math.max(...v)) : null;
  });
  let html = `<table class="vtable"><thead><tr><th></th>${leads.map(L => `<th>${getLang() === 'fr' ? 'J' : 'D'}${L === 0 ? '0' : '+' + L}</th>`).join('')}</tr></thead><tbody>`;
  order.forEach(id => {
    if (!verif.scores[id]) return;
    const lab = verif.models[id] || [id, ''];
    const isBlend = id.startsWith('mean');
    const name = isBlend ? (id === 'mean_hires' ? (getLang() === 'fr' ? 'Moyenne modèles km' : 'Km-scale average') : (getLang() === 'fr' ? 'Moyenne tous modèles' : 'All-model average')) : lab[0];
    html += `<tr class="${isBlend ? 'blend' : ''}${id === 'mean_hires' ? ' sep' : ''}"><th class="row">${name}<small>${isBlend ? '' : lab[1]}</small></th>`;
    leads.forEach((L, li) => {
      const s = verif.scores[id][L]; const v = s ? M.get(s) : null;
      if (v === null || v === undefined) { html += '<td class="na">·</td>'; return; }
      const bg = ramp(v); const lum = d3.hsl(bg).l; const isBest = !isBlend && best[li] !== null && v === best[li];
      html += `<td style="background:${bg};color:${lum > 0.55 ? '#071020' : '#eaf1fb'};${isBest ? 'box-shadow:0 0 0 2px #ffffff inset;' : ''}" title="${name} · ${L}">${fmt(v, M.digits)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ========== 9. Archive: cumulative snowfall vs climatology ==========
export function archiveCum(el, clim) {
  mount(el, (node, W) => {
    const m = { l: 44, r: 92, t: 12, b: 28 };
    const H = 300; const svg = svgIn(node, W, H);
    const n = clim.pct.p50.length;
    const base = Date.UTC(2001, 10, 1); // 1 Nov, non-leap reference
    const X = i => base + i * 864e5;
    const x = d3.scaleUtc().domain([X(0), X(n - 1)]).range([m.l, W - m.r]);
    const ymax = Math.max(d3.max(clim.pct.p90), d3.max(clim.current.filter(v => v !== null)) || 0, d3.max(clim.last || [0]));
    const y = d3.scaleLinear().domain([0, ymax]).nice().range([H - m.b, m.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8)).call(s => s.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b + 4})`).call(d3.axisBottom(x).ticks(d3.utcMonth.every(1)).tickSize(0).tickPadding(6).tickFormat(d => fmtUtc(+d, { month: 'short' }))).call(s => s.select('.domain').remove());
    svg.append('text').attr('class', 'ref-text').attr('x', m.l).attr('y', m.t - 2).text('cm');
    const idx = d3.range(n);
    const area = (a, b) => d3.area().x(i => x(X(i))).y0(i => y(clim.pct[a][i])).y1(i => y(clim.pct[b][i])).curve(d3.curveMonotoneX);
    svg.append('path').datum(idx).attr('fill', 'rgba(147,163,184,.14)').attr('d', area('p10', 'p90'));
    svg.append('path').datum(idx).attr('fill', 'rgba(147,163,184,.20)').attr('d', area('p25', 'p75'));
    svg.append('path').datum(idx).attr('fill', 'none').attr('stroke', COLORS.ink2).attr('stroke-width', 1.6).attr('d', d3.line().x(i => x(X(i))).y(i => y(clim.pct.p50[i])).curve(d3.curveMonotoneX));
    const line = arr => d3.line().x((v, i) => x(X(i))).y(v => y(v)).defined(v => v !== null).curve(d3.curveMonotoneX)(arr);
    if (clim.last) svg.append('path').attr('d', line(clim.last)).attr('fill', 'none').attr('stroke', '#9887ef').attr('stroke-width', 1.6);
    svg.append('path').attr('d', line(clim.current)).attr('fill', 'none').attr('stroke', COLORS.snow).attr('stroke-width', 2.8);
    const ci = clim.current.reduce((a, v, i) => (v !== null ? i : a), -1);
    if (ci >= 0) {
      svg.append('circle').attr('cx', x(X(ci))).attr('cy', y(clim.current[ci])).attr('r', 5).attr('fill', COLORS.snow).attr('stroke', COLORS.surface).attr('stroke-width', 2);
      svg.append('text').attr('class', 'tick').attr('x', x(X(ci)) + 9).attr('y', y(clim.current[ci]) - 8).attr('fill', COLORS.ink).style('font-weight', 800).text(`${fmt(clim.current[ci], 0)} cm`);
    }
    const lastI = n - 1;
    [['p50', t('leg.normal')], ['p90', '90 %'], ['p10', '10 %']].forEach(([k, lab]) => svg.append('text').attr('class', 'tick').attr('x', W - m.r + 6).attr('y', y(clim.pct[k][lastI]) + 4).text(`${lab}`));
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', evt => {
        const [mx] = d3.pointer(evt); const i = Math.max(0, Math.min(n - 1, Math.round((+x.invert(mx) - base) / 864e5)));
        showTip(evt, `<div class="tt-title">${fmtUtc(X(i), { day: 'numeric', month: 'long' })}</div>` + row(t('leg.thisSeason'), clim.current[i] === null ? '–' : `${fmt(clim.current[i], 0)} cm`, COLORS.snow) +
          (clim.last ? row(clim.lastLabel, `${fmt(clim.last[i], 0)} cm`, '#9887ef') : '') + row(t('leg.normal'), `${fmt(clim.pct.p50[i], 0)} cm`, COLORS.ink2) + row('10 – 90 %', `${fmt(clim.pct.p10[i], 0)} – ${fmt(clim.pct.p90[i], 0)} cm`));
      }).on('pointerleave', hideTip);
  });
}

// ========== 10. Archive: station snow depth by season ==========
export function archiveDepth(el, seasons) {
  // seasons: [{ label, values: [cm per day since 1 Nov], current }]
  mount(el, (node, W) => {
    const m = { l: 40, r: 24, t: 12, b: 28 };
    const H = 300; const svg = svgIn(node, W, H);
    const n = 181; const base = Date.UTC(2001, 10, 1); const X = i => base + i * 864e5;
    const x = d3.scaleUtc().domain([X(0), X(n - 1)]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, Math.max(40, d3.max(seasons.flatMap(s => s.values.filter(v => v !== null))))]).nice().range([H - m.b, m.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8)).call(s => s.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b + 4})`).call(d3.axisBottom(x).ticks(d3.utcMonth.every(1)).tickSize(0).tickPadding(6).tickFormat(d => fmtUtc(+d, { month: 'short' }))).call(s => s.select('.domain').remove());
    svg.append('text').attr('class', 'ref-text').attr('x', m.l).attr('y', m.t - 2).text('cm');
    const pal = ['#9887ef', '#00a888', '#e24d8b', '#d28e05'];
    const line = d3.line().x((v, i) => x(X(i))).y(v => y(v)).defined(v => v !== null).curve(d3.curveMonotoneX);
    const ends = [];
    seasons.forEach((s, k) => {
      const c = s.current ? COLORS.snow : pal[k % pal.length];
      if (s.current) svg.append('path').attr('d', d3.area().x((v, i) => x(X(i))).y0(y(0)).y1(v => y(v)).defined(v => v !== null).curve(d3.curveMonotoneX)(s.values)).attr('fill', 'rgba(223,243,255,.10)');
      svg.append('path').attr('d', line(s.values)).attr('fill', 'none').attr('stroke', c).attr('stroke-width', s.current ? 2.8 : 1.6);
      const li = s.values.reduce((a, v, i) => (v !== null ? i : a), -1);
      if (li >= 0) ends.push({ y: y(s.values[li]), xx: x(X(li)), lab: s.label, c, cur: s.current, v: s.values[li] });
    });
    ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ends.forEach(e => {
      if (e.cur) { svg.append('circle').attr('cx', e.xx).attr('cy', e.y).attr('r', 4.5).attr('fill', e.c).attr('stroke', COLORS.surface).attr('stroke-width', 2); svg.append('text').attr('class', 'tick').attr('x', e.xx + 8).attr('y', e.y - 8).attr('fill', COLORS.ink).style('font-weight', 800).text(`${fmt(e.v, 0)} cm`); }
    });
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', evt => {
        const [mx] = d3.pointer(evt); const i = Math.max(0, Math.min(n - 1, Math.round((+x.invert(mx) - base) / 864e5)));
        showTip(evt, `<div class="tt-title">${fmtUtc(X(i), { day: 'numeric', month: 'long' })}</div>` + seasons.map((s, k) => row(s.label + (s.source === 'auto' ? " (St-Jean)" : ''), s.values[i] === null || s.values[i] === undefined ? '–' : `${fmt(s.values[i], 0)} cm`, s.current ? COLORS.snow : pal[k % pal.length])).join(''));
      }).on('pointerleave', hideTip);
  });
}

// ========== 11. Archive: snowfall per winter + trend ==========
export function archiveTotals(el, clim) {
  mount(el, (node, W) => {
    const m = { l: 44, r: 16, t: 14, b: 28 };
    const H = 250; const svg = svgIn(node, W, H);
    const d = clim.winters.filter(w => w.snow !== null);
    const x = d3.scaleBand().domain(d.map(w => w.year)).range([m.l, W - m.r]).padding(0.18);
    const y = d3.scaleLinear().domain([0, d3.max(d, w => w.snow)]).nice().range([H - m.b, m.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8)).call(s => s.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b + 4})`).call(d3.axisBottom(x).tickValues(d.map(w => w.year).filter(yy => yy % 10 === 0)).tickSize(0).tickPadding(6)).call(s => s.select('.domain').remove());
    svg.append('text').attr('class', 'ref-text').attr('x', m.l).attr('y', m.t - 4).text('cm');
    const bw = Math.min(24, x.bandwidth());
    svg.append('g').selectAll('rect').data(d).join('rect')
      .attr('x', w => x(w.year) + (x.bandwidth() - bw) / 2).attr('width', bw).attr('y', w => y(w.snow)).attr('height', w => y(0) - y(w.snow)).attr('rx', Math.min(2, bw / 3))
      .attr('fill', w => (w.partial ? 'rgba(223,243,255,.35)' : '#338ced')).attr('opacity', w => (w.partial ? 1 : 0.9))
      .on('pointermove', (evt, w) => showTip(evt, `<div class="tt-title">${getLang() === 'fr' ? 'Hiver' : 'Winter'} ${w.year - 1}-${String(w.year).slice(2)}${w.partial ? (getLang() === 'fr' ? ' (en cours)' : ' (so far)') : ''}</div>` + row(t('leg.snow'), `${fmt(w.snow, 0)} cm`, '#338ced') + row('T déc.–fév.', `${fmt(w.tdjf, 1)} °C`)))
      .on('pointerleave', hideTip);
    // linear trend on complete winters
    const full = d.filter(w => !w.partial);
    const reg = linreg(full.map(w => w.year), full.map(w => w.snow));
    const x0 = full[0].year, x1 = full[full.length - 1].year;
    svg.append('line').attr('x1', x(x0) + x.bandwidth() / 2).attr('x2', x(x1) + x.bandwidth() / 2).attr('y1', y(reg.a + reg.b * x0)).attr('y2', y(reg.a + reg.b * x1)).attr('stroke', COLORS.warm).attr('stroke-width', 2);
    const perDec = reg.b * 10; const rel = perDec / d3.mean(full, w => w.snow) * 100;
    svg.append('text').attr('class', 'tick').attr('x', W - m.r).attr('y', m.t + 4).attr('text-anchor', 'end').attr('fill', COLORS.ink).style('font-weight', 700)
      .text(`${getLang() === 'fr' ? 'Tendance' : 'Trend'} ${perDec > 0 ? '+' : ''}${fmt(perDec, 0)} cm / ${getLang() === 'fr' ? 'décennie' : 'decade'} (${rel > 0 ? '+' : ''}${fmt(rel, 0)} %)`);
  });
}
function linreg(xs, ys) {
  const n = xs.length; const mx = d3.mean(xs), my = d3.mean(ys);
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxy / sxx; return { a: my - b * mx, b };
}

// ========== 12. Winter stripes (DJF temperature anomaly) ==========
export function winterStripes(el, clim) {
  mount(el, (node, W) => {
    const d = clim.winters.filter(w => w.tdjf !== null && !w.partial);
    const ref = d3.mean(d.filter(w => w.year >= 1971 && w.year <= 2000), w => w.tdjf);
    const H = 130; const svg = svgIn(node, W, H + 22);
    const x = d3.scaleBand().domain(d.map(w => w.year)).range([0, W]);
    const ext = d3.max(d, w => Math.abs(w.tdjf - ref));
    const col = d3.scaleDiverging(d3.interpolateRgbBasis(['#0e3d7e', '#2370cd', '#84b9f3', '#383838', '#f18a59', '#dc3c3d', '#7a1416'])).domain([-ext, 0, ext]);
    svg.append('g').selectAll('rect').data(d).join('rect').attr('x', w => x(w.year)).attr('width', x.bandwidth() + 0.6).attr('y', 0).attr('height', H).attr('fill', w => col(w.tdjf - ref))
      .on('pointermove', (evt, w) => showTip(evt, `<div class="tt-title">${getLang() === 'fr' ? 'Hiver' : 'Winter'} ${w.year - 1}-${String(w.year).slice(2)}</div>` + row(getLang() === 'fr' ? 'Temp. moy. déc.–fév.' : 'Mean temp. Dec–Feb', `${fmt(w.tdjf, 1)} °C`) + row(getLang() === 'fr' ? 'Écart 1971–2000' : 'vs 1971–2000', `${w.tdjf - ref > 0 ? '+' : ''}${fmt(w.tdjf - ref, 1)} °C`)))
      .on('pointerleave', hideTip);
    svg.append('text').attr('class', 'tick').attr('x', 0).attr('y', H + 16).text(d[0].year);
    svg.append('text').attr('class', 'tick').attr('x', W).attr('y', H + 16).attr('text-anchor', 'end').text(d[d.length - 1].year);
  });
}
