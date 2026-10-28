// Anamnez status page. Static: reads the uptime history that Upptime keeps in the public
// Ko8a/anamnez-status repo (history/summary.json) and its incidents (issues labelled "status").
// Open with ?demo to preview with generated data.
const CONFIG = {
  owner: 'Ko8a',
  repo: 'anamnez-status',
  branch: 'master',
  // first day of monitoring: older days are drawn as "no data", not as uptime
  since: '2026-10-23',
  // e.g. a Telegram channel; the button is hidden while empty
  subscribeUrl: '',
  pastDays: 14,
  refreshMs: 5 * 60 * 1000,
  timeZone: 'Asia/Almaty',
  // slugs are the ones Upptime derived from the site names (history/*.yml)
  components: [
    { slug: 'prilozhenie-dlya-vrachej', name: 'Приложение для врачей', desc: 'app.anamnez.kz — приём, пациенты, документы' },
    { slug: 'api', name: 'API', desc: 'Сервер приложения и база данных' },
    { slug: 'ii-anamnez-copilot-raspoznavanie-rechi', name: 'ИИ', desc: 'Анамнез, Copilot, распознавание речи' },
    { slug: 'sajt-anamnez-kz', name: 'Сайт anamnez.kz', desc: 'Информационный сайт' },
  ],
};

const DAYS = 90;
const DAY_MS = 864e5;
const MINOR_LIMIT_MIN = 60; // up to an hour down in a day is drawn amber, longer red

const RAW = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}`;
const ISSUES = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/issues?state=all&labels=status&per_page=100`;
const DEMO = new URLSearchParams(location.search).has('demo');

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDayLocal = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: CONFIG.timeZone });
const fmtTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.timeZone });
const fmtPct = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const localKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timeZone }).format(d); // YYYY-MM-DD

const STATE_TEXT = { ok: 'Работает', minor: 'Замедлено', major: 'Недоступно', none: 'Нет данных' };

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function duration(min) {
  min = Math.max(1, Math.round(min));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Last 90 UTC days, oldest first, as YYYY-MM-DD (Upptime keys dailyMinutesDown by UTC date). */
function dayKeys() {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return Array.from({ length: DAYS }, (_, i) => new Date(today - (DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

function dayLevel(minutes) {
  if (!minutes) return 'ok';
  return minutes < MINOR_LIMIT_MIN ? 'minor' : 'major';
}

function siteState(site) {
  if (!site) return 'none';
  return { up: 'ok', degraded: 'minor', down: 'major' }[site.status] || 'none';
}

/** Upptime opens issues titled "🛑 <name> is down" / "⚠️ <name> has degraded performance". */
function parseIncident(issue) {
  const raw = issue.title.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  let title = raw, level = 'major';
  let m;
  if ((m = raw.match(/^(.*) is down$/i))) title = `${m[1]}: сервис недоступен`;
  else if ((m = raw.match(/^(.*) has degraded performance$/i))) { title = `${m[1]}: замедленная работа`; level = 'minor'; }
  const slugs = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const comp = CONFIG.components.find((c) => slugs.includes(c.slug));
  return {
    number: issue.number,
    title,
    level,
    slug: comp && comp.slug,
    // the incident's own page on this site (not GitHub)
    url: `#incident-${issue.number}`,
    open: issue.state === 'open',
    start: new Date(issue.created_at),
    end: issue.closed_at ? new Date(issue.closed_at) : null,
  };
}

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function load() {
  if (DEMO) return demoData();
  const [summary, issues] = await Promise.all([
    getJSON(`${RAW}/history/summary.json`),
    // incidents are optional: the page still works if the GitHub API rate limit is hit
    getJSON(ISSUES).catch(() => []),
  ]);
  return {
    sites: Object.fromEntries(summary.map((s) => [s.slug, s])),
    incidents: issues.filter((i) => !i.pull_request).map(parseIncident),
  };
}

function render({ sites, incidents }) {
  const keys = dayKeys();
  const states = CONFIG.components.map((c) => siteState(sites[c.slug]));
  const openIncidents = incidents.filter((i) => i.open);

  // overall banner
  const down = states.filter((s) => s === 'major').length;
  const slow = states.filter((s) => s === 'minor').length;
  const banner = $('#banner');
  let level = 'ok', text = 'Все системы работают';
  if (down === states.length) { level = 'major'; text = 'Серьёзный сбой: сервисы недоступны'; }
  else if (down) { level = 'major'; text = `Частичный сбой: ${down} ${plural(down, 'сервис недоступен', 'сервиса недоступны', 'сервисов недоступны')}`; }
  else if (slow || openIncidents.length) { level = 'minor'; text = 'Часть сервисов работает с замедлением'; }
  banner.className = `main-view banner ${level}`;
  banner.querySelector('.banner-text').textContent = text;

  // active incidents
  const active = $('#active');
  active.hidden = !openIncidents.length;
  active.innerHTML = openIncidents.map((i) => `
    <article class="incident-card ${i.level}">
      <h3>${esc(i.title)}</h3>
      <p><span class="stage">Расследуем</span> — начался ${fmtTime.format(i.start)}, ${fmtDayLocal.format(i.start)}
        <a href="${esc(i.url)}">Подробнее</a></p>
    </article>`).join('');

  // components with 90/60/30-day history
  const since = CONFIG.since;
  $('.days-n').innerHTML = windows((n) => `${n} дней`);
  $('#components').innerHTML = CONFIG.components.map((c, ci) => {
    const site = sites[c.slug];
    const down = (site && site.dailyMinutesDown) || {};
    const bars = keys.map((k, i) => {
      let lvl = !site || k < since ? 'none' : dayLevel(down[k]);
      // today's minutes are summarised once a day, so trust the live status for the last bar
      if (i === DAYS - 1 && site && states[ci] !== 'ok' && lvl !== 'major') lvl = states[ci];
      return `<span class="bar bar-${lvl}" data-c="${ci}" data-d="${k}" data-l="${lvl}" data-m="${down[k] || 0}"></span>`;
    }).join('');
    const pct = (n) => {
      const days = keys.slice(-n).filter((k) => site && k >= since);
      if (!days.length) return 'нет данных';
      const lost = days.reduce((sum, k) => sum + (down[k] || 0), 0);
      return `${fmtPct.format(Math.max(0, 100 * (1 - lost / (days.length * 1440))))} % доступность`;
    };
    return `
      <div class="comp">
        <div class="comp-head">
          <span class="comp-name">${esc(c.name)}<span class="comp-desc">${esc(c.desc)}</span></span>
          <span class="state ${states[ci]}">${STATE_TEXT[states[ci]]}</span>
        </div>
        <div class="bars" role="img" aria-label="${esc(c.name)}: ${esc(pct(DAYS))} за ${DAYS} дней">${bars}</div>
        <div class="comp-foot">
          <span>${windows((n) => `${n} дней назад`)}</span><span class="rule"></span>
          <span class="pct">${windows(pct)}</span><span class="rule"></span>
          <span>Сегодня</span>
        </div>
      </div>`;
  }).join('');

  // past incidents, by local day
  const byDay = {};
  for (const i of incidents) (byDay[localKey(i.start)] ||= []).push(i);
  const now = Date.now();
  // no days before monitoring began: "no incidents" there would claim more than we know
  const pastDates = Array.from({ length: CONFIG.pastDays }, (_, d) => new Date(now - d * DAY_MS))
    .filter((date) => localKey(date) >= CONFIG.since);
  $('#past').innerHTML = pastDates.map((date) => {
    const list = (byDay[localKey(date)] || []).sort((a, b) => b.start - a.start);
    const body = list.length ? list.map((i) => `
      <div class="past-item ${i.level}">
        <a href="${esc(i.url)}">${esc(i.title)}</a>
        <p>${i.end
          ? `Решён · ${fmtTime.format(i.start)} – ${fmtTime.format(i.end)} · ${duration((i.end - i.start) / 6e4)}`
          : `Продолжается с ${fmtTime.format(i.start)}`}</p>
      </div>`).join('') : '<p class="empty">Инцидентов не было.</p>';
    return `<div class="day"><h3>${fmtDayLocal.format(date)}</h3>${body}</div>`;
  }).join('');

  $('#checked').textContent = `Обновлено в ${fmtTime.format(new Date())}${DEMO ? ' · демо-данные' : ''}`;
  bindTips(sites, incidents);
  last = { sites, incidents };
  route();
}

// ── incident page: #incident-<number> ──────────────────────────────────────────────
let last = null;

/** Upptime's own comments (English, technical) — the timeline shows them as plain events instead */
const AUTO_COMMENT = /^\*\*Resolved|is back up|was down|HTTP code|response time|degraded performance/i;

/** comment text → safe HTML: paragraphs, **bold**, links */
function prose(text) {
  return esc(text.trim())
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener">$1</a>')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const at = (d) => `${fmtTime.format(d)}, ${fmtDayLocal.format(d)}`;

async function showIncident(number) {
  const page = $('#incident');
  const inc = last && last.incidents.find((i) => i.number === number);
  if (!inc) {
    page.innerHTML = `<a class="back" href="#">← Все сервисы</a><div class="card inc-card"><h1>Инцидент не найден</h1>
      <p class="muted">Возможно, ссылка устарела. Текущее состояние — на главной странице.</p></div>`;
    return;
  }
  const comp = CONFIG.components.find((c) => c.slug === inc.slug);
  const head = `<a class="back" href="#">← Все сервисы</a>
    <div class="card inc-card ${inc.level}">
      <span class="state ${inc.open ? inc.level : 'ok'}">${inc.open ? 'Продолжается' : 'Решён'}</span>
      <h1>${esc(inc.title)}</h1>
      ${comp ? `<p class="muted">${esc(comp.name)} — ${esc(comp.desc)}</p>` : ''}
      <dl class="inc-facts">
        <div><dt>Начало</dt><dd>${at(inc.start)}</dd></div>
        <div><dt>${inc.end ? 'Восстановлено' : 'Сейчас'}</dt><dd>${inc.end ? at(inc.end) : 'устраняем'}</dd></div>
        <div><dt>Длительность</dt><dd>${duration(((inc.end || new Date()) - inc.start) / 6e4)}</dd></div>
      </dl>
    </div>
    <h2 class="inc-h">Обновления</h2>`;
  page.innerHTML = head + '<div class="card timeline"><p class="muted">Загружаем…</p></div>';
  let comments = [];
  try {
    if (!DEMO) comments = await getJSON(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/issues/${number}/comments?per_page=100`);
  } catch {
    // rate limit — the facts above are still right
  }
  const events = [
    { at: inc.start, text: '<p>Автоматическая проверка обнаружила, что сервис не отвечает.</p>' },
    ...comments
      .filter((c) => c.body && !AUTO_COMMENT.test(c.body))
      .map((c) => ({ at: new Date(c.created_at), text: prose(c.body) })),
    ...(inc.end ? [{ at: inc.end, text: '<p>Сервис снова работает в обычном режиме.</p>' }] : []),
  ].sort((a, b) => b.at - a.at);
  page.querySelector('.timeline').innerHTML = events
    .map((e) => `<div class="ev"><span class="ev-time">${at(e.at)}</span><div class="ev-text">${e.text}</div></div>`)
    .join('');
}

/** main view or one incident, by the address hash */
function route() {
  const m = location.hash.match(/^#incident-(\d+)$/);
  const page = $('#incident');
  document.querySelectorAll('.main-view').forEach((el) => (el.hidden = !!m));
  $('#active').hidden = !!m || !(last && last.incidents.some((i) => i.open));
  page.hidden = !m;
  if (m) {
    showIncident(Number(m[1]));
    window.scrollTo(0, 0);
  }
}
window.addEventListener('hashchange', route);

/** One span per responsive window; CSS shows the one matching the visible bar count. */
function windows(fn) {
  return [90, 60, 30].map((n) => `<span class="days-${n}">${esc(fn(n))}</span>`).join('');
}

function bindTips(sites, incidents) {
  const tip = $('#tip');
  let current = null;
  const hide = () => { tip.hidden = true; current && current.classList.remove('on'); current = null; };
  const show = (bar) => {
    if (current) current.classList.remove('on');
    current = bar;
    bar.classList.add('on');
    const { c, d, l, m } = bar.dataset;
    const comp = CONFIG.components[c];
    const day = incidents.filter((i) => i.slug === comp.slug && i.start.toISOString().slice(0, 10) === d);
    const line = {
      ok: 'Сбоев не было',
      minor: Number(m) ? `Недоступен ${duration(Number(m))}` : 'Замедленная работа',
      major: Number(m) ? `Недоступен ${duration(Number(m))}` : 'Сервис недоступен',
      none: 'Нет данных за этот день',
    }[l];
    tip.innerHTML = `<strong>${fmtDate.format(new Date(d))}</strong>
      <div class="tip-row"><i class="bar-${l}"></i>${line}</div>
      ${day.length ? `<ul>${day.map((i) => `<li>${esc(i.title)}</li>`).join('')}</ul>` : ''}`;
    tip.hidden = false;
    const r = bar.getBoundingClientRect();
    const w = tip.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), document.documentElement.clientWidth - w - 8);
    tip.style.left = `${left + scrollX}px`;
    tip.style.top = `${r.bottom + scrollY + 8}px`;
  };
  const comps = $('#components');
  comps.onmouseover = (e) => e.target.classList.contains('bar') && show(e.target);
  comps.onmouseleave = hide;
  comps.onclick = (e) => (e.target.classList.contains('bar') ? (current === e.target ? hide() : show(e.target)) : hide());
}

async function refresh() {
  try {
    render(await load());
  } catch (err) {
    console.error(err);
    if (!$('#components').children.length) {
      const banner = $('#banner');
      banner.className = 'main-view banner error';
      banner.querySelector('.banner-text').textContent = 'Не удалось загрузить данные мониторинга. Обновите страницу чуть позже.';
    }
  }
}

function demoData() {
  const keys = dayKeys();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sites = {}, incidents = [];
  CONFIG.components.forEach((c, ci) => {
    const daily = {};
    keys.forEach((k, i) => {
      const r = rnd();
      if (r > 0.96) daily[k] = Math.ceil(rnd() * (ci === 2 ? 180 : 40));
      if (daily[k] && i > DAYS - CONFIG.pastDays) {
        const start = new Date(`${k}T0${3 + ci}:12:00Z`);
        incidents.push({ number: 900 + incidents.length, url: `#incident-${900 + incidents.length}`, title: `${c.name}: сервис недоступен`, level: 'major', slug: c.slug, open: false,
          start, end: new Date(+start + daily[k] * 6e4) });
      }
    });
    sites[c.slug] = { slug: c.slug, status: c.slug === 'ai' ? 'degraded' : 'up', dailyMinutesDown: daily };
  });
  incidents.push({ number: 999, url: '#incident-999', title: 'ИИ: замедленная работа', level: 'minor', slug: 'ii-anamnez-copilot-raspoznavanie-rechi', open: true, start: new Date(Date.now() - 23 * 6e4), end: null });
  CONFIG.since = keys[0];
  return { sites, incidents };
}

if (CONFIG.subscribeUrl) {
  const a = $('#subscribe');
  a.href = CONFIG.subscribeUrl;
  a.hidden = false;
}
refresh();
setInterval(refresh, CONFIG.refreshMs);
