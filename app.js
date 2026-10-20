'use strict';
(() => {
  // ------------------------------------------------------------------------------------------- storage
  const KEY = 'svitlo.v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let store = Object.assign({lang: null, addresses: [], active: 0, push: false}, load());
  store.prefs = Object.assign({changed: true, tomorrow: true, soon: true, subch: true}, store.prefs);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
  const L = () => window.I18N[store.lang] || window.I18N.uk;
  const app = document.getElementById('app');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const svg = (paths, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const IC = {
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    swap: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 21h4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  };

  // ------------------------------------------------------------------------------------------- time (always Kyiv)
  const FMT = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  // the device clock, corrected by the server's when they differ by more than a minute (a phone with a wrong clock)
  let skew = 0;
  try { skew = +localStorage.getItem(KEY + '.skew') || 0; } catch {}
  const now = () => Date.now() + skew;
  function kyiv(d = new Date(now())) {
    const p = Object.fromEntries(FMT.formatToParts(d).map((x) => [x.type, x.value]));
    return {date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute};
  }
  const hm = (slot) => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
  const dur = (mins) => L().dur(Math.floor(mins / 60), mins % 60);
  const durH = (mins) => `<span class="nw">${esc(dur(mins))}</span>`;
  const dayName = (iso) => new Intl.DateTimeFormat(L().locale, {day: 'numeric', month: 'long', timeZone: 'UTC'}).format(new Date(iso + 'T12:00:00Z'));
  function windows(bits) {
    const out = [];
    if (!bits) return out;
    for (let i = 0; i < 48; i++) if (bits[i] && !bits[i - 1]) { let j = i; while (bits[j + 1]) j++; out.push([i, j + 1]); i = j; }
    return out;
  }

  // ------------------------------------------------------------------------------------------- data
  // the page lives on GitHub Pages; the schedule and notifications come from the Oracle server
  const API = location.hostname.endsWith('github.io') ? 'https://clockweather.duckdns.org/svitlo/api/' : 'api/';
  let data = null; // /api/state
  let offline = false;
  try { data = JSON.parse(localStorage.getItem(KEY + '.state')); } catch {}
  const api = async (p, opt) => {
    const r = await fetch(API + p, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  };
  async function refresh() {
    try {
      const t0 = Date.now();
      data = await api('state');
      offline = false;
      if (data.now) {
        const s = data.now - (t0 + Date.now()) / 2;
        skew = Math.abs(s) > 60e3 ? Math.round(s) : 0;
        try { localStorage.setItem(KEY + '.skew', String(skew)); } catch {}
      }
      try { localStorage.setItem(KEY + '.state', JSON.stringify(data)); } catch {}
    } catch { offline = true; }
    if (view === 'main') render();
  }
  const day = (date) => data?.days?.find((d) => d.date === date);

  /** Re-reads each address's sub-queue (Zhytomyroblenergo moves addresses between queues now and then). */
  async function recheck() {
    let changed = false;
    for (const a of store.addresses) {
      try {
        const {sub} = await api(`resolve?rem=${a.rem}&place=${a.place}&street=${a.street}&type=${a.type || 'home'}&house=${encodeURIComponent(a.house || '')}`);
        if (sub && sub !== a.sub) { a.was = a.sub; a.sub = sub; changed = true; }
      } catch {}
    }
    if (changed) { save(); syncPush(); if (view === 'main') render(); }
  }

  // ------------------------------------------------------------------------------------------- views
  let view = !store.lang ? 'welcome' : store.addresses.length ? 'main' : 'form';
  let form = null; // address being edited
  let gridDay = 'today';
  let noticeDay = 'today';

  function render() {
    document.documentElement.lang = store.lang === 'ru' ? 'ru' : store.lang === 'en' ? 'en' : 'uk';
    document.title = L().title;
    if (view === 'welcome') return renderWelcome();
    if (view === 'form') return renderForm();
    return renderMain();
  }

  // ---------- welcome: language
  function renderWelcome() {
    const pick = store.lang || 'uk';
    const opt = (k, name) => `<button class="lang-opt ${pick === k ? 'sel' : ''}" role="radio" aria-checked="${pick === k}" data-lang="${k}"><span>${name}</span>${pick === k ? svg(IC.check, 'hot') : ''}</button>`;
    app.innerHTML = `<main class="narrow welcome">
      <div class="hero"><div class="tile hot-tile big">${svg(IC.bolt)}</div>
        <h1>${esc(L().title)}</h1><p class="muted">Оберіть мову · Выберите язык · Choose language</p></div>
      <div class="lang-list" role="radiogroup">${opt('uk', 'Українська')}${opt('ru', 'Русский')}${opt('en', 'English')}</div>
      <button class="primary" id="go">${esc(L().next)}</button>
      <p class="muted center small">${esc(L().welcomeNote)}</p></main>`;
    if (!store.lang) store.lang = 'uk';
    app.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { store.lang = b.dataset.lang; render(); });
    app.querySelector('#go').onclick = () => { save(); view = store.addresses.length ? 'main' : 'form'; form = null; render(); };
  }

  // ---------- main
  function header() {
    const t = L();
    const langs = ['uk', 'ru', 'en'].map((k) => `<button class="seg ${store.lang === k ? 'on' : ''}" aria-pressed="${store.lang === k}" data-lang="${k}">${k === 'uk' ? 'UA' : k.toUpperCase()}</button>`).join('');
    const {date, min} = kyiv();
    const g = day(date)?.grid;
    const tabs = store.addresses.map((a, i) => {
      const bit = g?.[a.sub]?.[Math.floor(min / 30)];
      const dot = bit == null ? '' : `<i class="dot ${bit ? 'off' : ''}" title="${esc(bit ? t.off : t.on)}"></i>`;
      return `<button class="chip ${i === store.active ? 'on' : ''}" data-tab="${i}">${dot}${esc(a.label)}${a.sub ? `<span class="chip-sub">${a.sub}</span>` : ''}</button>`;
    }).join('');
    return `<header class="top">
      <div class="brand">${svg(IC.bolt, 'hot')}<span class="name">${esc(t.title)}</span><span class="muted small">${esc(t.oblenergo)}</span></div>
      <div class="segs" role="group" aria-label="Language">${langs}</div>
    </header>
    <div class="addr-row"><nav class="chips" id="chips">${tabs}</nav>
      ${store.addresses.length < 10 ? `<button class="chip dashed" id="add" aria-label="${esc(t.address)}">${svg(IC.plus)}<span class="lbl">${esc(t.address)}</span></button>` : ''}</div>`;
  }

  function scale(cls = '') {
    let s = '';
    for (let k = 0; k <= 24; k++) {
      const major = k % 3 === 0;
      const tx = k === 0 ? '0' : k === 24 ? '-100%' : '-50%';
      s += `<i class="tick ${major ? 'maj' : ''}" data-l="${k / 24 * 100}"></i><span class="hl ${major ? 'maj' : ''}" data-l="${k / 24 * 100}" data-tx="${tx}">${String(k).padStart(2, '0')}</span>`;
    }
    return `<div class="scale ${cls}">${s}</div>`;
  }
  const cells = (bits, past = -1, label = '') => bits.map((b, i) =>
    `<i class="c ${b ? 'x' : ''} ${i < past ? 'past' : ''}" title="${label}${hm(i)}–${hm(i + 1)}"></i>`).join('');
  const nowLine = (min) => `<i class="now" data-l="${min / 1440 * 100}"></i>`;
  // the page's CSP forbids inline style attributes: positions travel in data-* and are applied through the CSSOM
  function applyPositions(root) {
    root.querySelectorAll('[data-l]').forEach((el) => {
      el.style.left = el.dataset.l + '%';
      if (el.dataset.tx) el.style.transform = `translateX(${el.dataset.tx})`;
    });
  }

  function renderMain() {
    const t = L();
    if (store.active >= store.addresses.length) store.active = 0;
    const a = store.addresses[store.active];
    const {date, min} = kyiv();
    const todayD = day(date);
    const tomorrowIso = kyiv(new Date(now() + 864e5)).date;
    const tomorrowD = day(tomorrowIso);
    const bits = todayD?.grid?.[a.sub];
    const tbits = tomorrowD?.grid?.[a.sub];
    const slot = Math.floor(min / 30);
    const stale = offline || data?.error || (data?.fetchedAt && now() - data.fetchedAt > 40 * 60e3);

    // status
    let isOff = false, headline = '', detail = '';
    if (!a.sub) { headline = t.unknownSub; }
    else if (!bits) { headline = t.noToday; }
    else {
      isOff = !!bits[slot];
      if (isOff) {
        let e = slot; while (bits[e + 1]) e++;
        let endMin = (e + 1) * 30;
        if (e === 47 && tbits?.[0]) { let k = 0; while (tbits[k + 1]) k++; endMin = 1440 + (k + 1) * 30; }
        headline = t.off;
        detail = t.backAt(hm((endMin / 30) % 48), durH(endMin - min));
      } else {
        headline = t.on;
        let s = slot + 1; while (s < 48 && !bits[s]) s++;
        if (s < 48) { let e = s; while (bits[e + 1]) e++; detail = t.nextOff(hm(s), hm(e + 1), durH(s * 30 - min)); }
        else if (tbits && tbits.some(Boolean)) { const w = windows(tbits)[0]; detail = t.nextOff(hm(w[0]), hm(w[1]), durH(1440 - min + w[0] * 30)); }
        else detail = esc(windows(bits).length ? t.noMore : t.noneToday);
      }
    }
    const addrLine = `${a.placeName.replace(/^(місто|село|селище|смт)\s+/i, '')}, ${a.streetName}${a.house ? ', ' + a.house : ''}`;
    const upd = data?.updated ? `${t.updated} ${data.updated.slice(11, 16)}${data.updated.slice(0, 10) !== date ? ' ' + data.updated.slice(8, 10) + '.' + data.updated.slice(5, 7) : ''}` : '';

    const bar = (b, nowMin, past, label) => `<div class="bar">${cells(b, past, label)}${nowMin != null ? nowLine(nowMin) : ''}</div>${scale()}`;
    const banner = a.was && a.was !== a.sub ? `<div class="banner" role="status">${svg(IC.swap, 'hot')}
      <div class="grow"><b>${esc(t.changed(a.was, a.sub))}</b><span class="muted small">${esc(a.label)} · ${esc(addrLine)} · ${esc(t.changedDesc)}</span></div>
      <button class="ghost" id="gotit">${esc(t.gotIt)}</button></div>` : '';

    // outages list
    const wl = windows(bits).map(([s, e]) => {
      const past = e * 30 <= min, cur = s * 30 <= min && min < e * 30;
      const r = past ? t.passed : cur ? t.nowLbl : dur(s * 30 - min);
      return `<li class="${past ? 'past' : ''}"><span class="${past ? '' : 'hot'}">${hm(s)}–${hm(e)}</span><span class="muted">${esc(r)}</span></li>`;
    }).join('');
    const offMin = (bits || []).reduce((n, b) => n + b * 30, 0);

    // notices
    const nlist = (data?.notices || []).filter((n) => n.date >= date);
    const nSel = nlist.find((n) => n.date === (noticeDay === 'tomorrow' ? tomorrowIso : date)) || nlist[0];
    const nTabs = nlist.length > 1 ? `<div class="segs small-segs">${nlist.slice(0, 2).map((n) => `<button class="seg ${n === nSel ? 'on' : ''}" data-nd="${n.date === date ? 'today' : 'tomorrow'}">${esc(n.date === date ? t.today : n.date === tomorrowIso ? t.tomorrow : dayName(n.date))}</button>`).join('')}</div>` : '';
    const notices = (nSel ? [nSel] : []).map((n) => `
      <div class="notice">${nlist.length > 1 ? '' : `<div class="sub-h">${n.date === date ? esc(t.today) : n.date === tomorrowIso ? esc(t.tomorrow) : esc(dayName(n.date))}</div>`}
      ${n.ranges.map((r) => {
        const active = n.date === date && min >= toMin(r.from) && min < toMin(r.to);
        return `<div class="row ${active ? 'strong' : ''}"><span>${r.from}–${r.to}</span><span>${esc(r.queues === 0 ? t.noLimits : r.queues != null ? t.queues(r.queues) : r.text)}</span></div>`;
      }).join('')}</div>`).join('');

    // all sub-queues
    const gd = gridDay === 'tomorrow' && tomorrowD ? tomorrowD : todayD;
    const gIsToday = gd === todayD;
    const subsRows = gd ? Object.keys(gd.grid).sort().map((k) => `<div class="srow ${k === a.sub ? 'mine' : ''}"><span class="sname">${k}</span>
      <div class="sbar">${cells(gd.grid[k], gIsToday ? slot : -1, k + ' · ')}${gIsToday ? nowLine(min) : ''}</div></div>`).join('') : '';
    const ticks = Array.from({length: 23}, (_, j) => `<i class="sep ${(j + 1) % 3 ? '' : 'maj'}" data-l="${(j + 1) / 24 * 100}"></i>`).join('');

    app.innerHTML = `<main class="wide">${header()}${banner}
      ${offline ? `<p class="warn small">${esc(t.offline)}</p>` : ''}
      <div class="cols"><div class="left">
        <section class="card status o1">
          <div class="meta"><span>${svg(IC.pin)}${esc(addrLine)}${a.type === 'biz' ? ' · ' + esc(t.bizTag) : ''} · ${esc(t.sub)} ${esc(a.sub || '—')}</span>
            <span class="${stale ? 'warn' : ''}">${esc(upd)}${stale ? ' · ' + esc(t.stale) : ''}<button class="link" id="edit">${svg(IC.edit)}${esc(t.edit)}</button></span></div>
          <div class="state"><div class="tile ${a.sub && bits && !isOff ? 'hot-tile' : ''} big">${svg(IC.bolt)}</div>
            <div><div class="headline">${esc(headline)}</div><div class="detail">${detail}</div></div></div>
          ${bits ? `<div class="day"><div class="sub-h">${esc(t.today)}, ${esc(dayName(date))}</div>${bar(bits, min, slot, '')}</div>` : ''}
          ${a.sub ? `<div class="day"><div class="sub-h">${esc(t.tomorrow)}, ${esc(dayName(tomorrowIso))}</div>
            ${tbits ? bar(tbits, null, -1, '') : `<div class="placeholder">${esc(t.notYet)}</div>`}</div>` : ''}
          <div class="legend"><span><i class="c x"></i>${esc(t.legOff)}</span><span><i class="c"></i>${esc(t.legOn)}</span></div>
        </section>
        </div>
        <aside>
          ${bits ? `<section class="card o2"><h2>${esc(t.outages)}</h2>${wl ? `<ul class="wins">${wl}</ul><p class="muted small">${esc(t.totalOff(t.hours(Math.floor(offMin / 60), offMin % 60)))}</p>` : `<p class="muted">${esc(t.noneToday)}</p>`}</section>` : ''}
          ${notices ? `<section class="card o3"><div class="card-h"><h2>${esc(t.applied)}</h2>${nTabs}</div>${notices}</section>` : ''}
        </aside>
      </div>
      ${gd ? `<section class="card all o5"><div class="all-h"><h2>${esc(t.all)}</h2>
          ${tomorrowD ? `<div class="segs small-segs"><button class="seg ${gIsToday ? 'on' : ''}" data-gd="today">${esc(t.today)}</button><button class="seg ${!gIsToday ? 'on' : ''}" data-gd="tomorrow">${esc(t.tomorrow)}</button></div>` : ''}
          <a href="https://www.ztoe.com.ua/unhooking-search.php" target="_blank" rel="noopener">${esc(t.openSite)}</a></div>
        <div class="srow head"><span class="sname"></span>${scale('top')}</div>
        <div class="sgrid"><div class="seps">${ticks}</div>${subsRows}</div></section>` : ''}
      ${pushCard()}
      <p class="muted small center foot">${svg(IC.lock)}${esc(store.push ? t.footerPush : t.footer)}</p>
    </main>`;
    applyPositions(app);

    app.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { store.lang = b.dataset.lang; save(); syncPush(); render(); });
    app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { store.active = +b.dataset.tab; save(); render(); });
    app.querySelectorAll('[data-gd]').forEach((b) => b.onclick = () => { gridDay = b.dataset.gd; render(); });
    app.querySelectorAll('[data-nd]').forEach((b) => b.onclick = () => { noticeDay = b.dataset.nd; render(); });
    const addB = app.querySelector('#add');
    if (addB) addB.onclick = () => openForm(null);
    wireChips();
    app.querySelector('#edit').onclick = () => openForm(store.active);
    const g = app.querySelector('#gotit');
    if (g) g.onclick = () => { delete a.was; save(); render(); };
    wirePush();
  }
  /** Many addresses: the chips become one swipeable row (no scrollbar), faded at the edge that has more,
      the mouse wheel scrolls it sideways, and the active chip is kept in view. */
  function wireChips() {
    const c = app.querySelector('#chips');
    if (!c) return;
    const fade = () => {
      const more = c.scrollWidth - c.clientWidth;
      c.classList.toggle('fade-r', more > 2 && c.scrollLeft < more - 2);
      c.classList.toggle('fade-l', c.scrollLeft > 2);
    };
    c.scrollLeft = chipScroll;
    const act = c.querySelector('.chip.on');
    if (act && (act.offsetLeft < c.scrollLeft || act.offsetLeft + act.offsetWidth > c.scrollLeft + c.clientWidth)) c.scrollLeft = act.offsetLeft - 16;
    c.onscroll = () => { chipScroll = c.scrollLeft; fade(); };
    c.onwheel = (e) => { if (c.scrollWidth > c.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { c.scrollLeft += e.deltaY; e.preventDefault(); } };
    fade();
  }
  let chipScroll = 0;
  const toMin = (s) => { const [h, m] = s.split(':'); return +h * 60 + +m; };

  // ---------- push
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;
  let pushMsg = '';
  // the notification settings are locked against accidental taps: "Change" unlocks them, and they lock again
  // on "Done" or after 30 s without changes
  let pushUnlocked = false, lockTimer = 0;
  const relockLater = () => { clearTimeout(lockTimer); lockTimer = setTimeout(() => { pushUnlocked = false; if (view === 'main') render(); }, 30e3); };
  function pushCard() {
    const t = L();
    let body;
    if (!pushSupported()) body = `<p class="muted small">${esc(isIos() ? t.notifIos : t.notifUnsupported)}</p>`;
    else body = `<div class="push-ctl">
      <label class="switch"><input type="checkbox" id="push" ${store.push ? 'checked' : ''} ${pushUnlocked ? '' : 'disabled'}><span class="knob"></span><span>${esc(t.notifToggle)}</span></label>
      <div class="btns">${store.push ? `<button class="ghost" id="ptest">${esc(t.notifTest)}</button>` : ''}
      <button class="lockbtn ${pushUnlocked ? 'open' : ''}" id="plock" aria-pressed="${!pushUnlocked}" title="${esc(t.lockedHint)}">${svg(pushUnlocked ? IC.unlock : IC.lock)}${esc(pushUnlocked ? t.lockDone : t.unlock)}</button></div></div>
      ${pushMsg ? `<p class="small warn full">${esc(pushMsg)}</p>` : ''}
      <div class="prefs full ${store.push ? '' : 'off'} ${pushUnlocked ? '' : 'locked'}" role="group" aria-label="${esc(t.notifPick)}">
        ${[['changed', t.pChanged], ['tomorrow', t.pTomorrow], ['soon', t.pSoon], ['subch', t.pSubch]].map(([k, [name, desc]]) => `
        <label class="pref"><input type="checkbox" data-pref="${k}" ${store.prefs[k] ? 'checked' : ''} ${store.push && pushUnlocked ? '' : 'disabled'}><span class="box">${svg(IC.check)}</span>
          <span class="ptxt"><b>${esc(name)}</b><span class="muted small">${esc(desc)}</span></span></label>`).join('')}</div>`;
    return `<section class="card push o6 ${pushUnlocked ? '' : 'is-locked'}"><div class="grow"><h2>${svg(IC.bell)}${esc(t.notif)}</h2></div>${body}</section>`;
  }
  const b64 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  const payload = (subscription) => JSON.stringify({subscription, lang: store.lang, prefs: store.prefs,
    addresses: store.addresses.map(({label, rem, place, street, house, type, sub}) => ({label, rem, place, street, house, type: type || 'home', sub}))});
  async function currentSub() { const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
  async function syncPush() {
    if (!store.push || !pushSupported()) return;
    try { const s = await currentSub(); if (s) await api('subscribe', {method: 'POST', headers: {'content-type': 'application/json'}, body: payload(s)}); } catch {}
  }
  function wirePush() {
    const box = app.querySelector('#push');
    if (box) box.onchange = async () => {
      const t = L();
      pushMsg = '';
      try {
        if (box.checked) {
          if (await Notification.requestPermission() !== 'granted') throw new Error(t.notifDenied);
          const reg = await navigator.serviceWorker.ready;
          const {key} = await api('vapid');
          const s = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64(key)});
          await api('subscribe', {method: 'POST', headers: {'content-type': 'application/json'}, body: payload(s)});
          store.push = true;
        } else {
          const s = await currentSub();
          if (s) { await api('unsubscribe', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({endpoint: s.endpoint})}).catch(() => {}); await s.unsubscribe(); }
          store.push = false;
        }
      } catch (e) { store.push = false; pushMsg = e.message === t.notifDenied ? e.message : t.notifFail; }
      save(); relockLater(); render();
    };
    app.querySelectorAll('[data-pref]').forEach((c) => c.onchange = () => { store.prefs[c.dataset.pref] = c.checked; save(); syncPush(); relockLater(); });
    const lb = app.querySelector('#plock');
    if (lb) lb.onclick = () => { pushUnlocked = !pushUnlocked; if (pushUnlocked) relockLater(); else clearTimeout(lockTimer); render(); };
    const tb = app.querySelector('#ptest');
    if (tb) tb.onclick = async () => {
      try { const s = await currentSub(); await api('test', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({endpoint: s.endpoint})}); tb.textContent = L().notifSent; }
      catch { await syncPush(); tb.textContent = L().notifFail; }
    };
  }

  // ---------- address form
  function openForm(index) {
    const a = index == null ? null : store.addresses[index];
    form = a ? {index, ...a} : {index: null, label: store.addresses.length ? L().addrN(store.addresses.length + 1) : L().home,
      rem: null, remName: '', place: null, placeName: '', street: null, streetName: '', house: '', type: 'home', sub: null};
    form.type ||= 'home';
    form.lists = {};
    view = 'form';
    render();
    if (a) loadLists();
  }
  async function loadLists() {
    const f = form;
    try {
      if (f.rem && !f.lists.places) f.lists.places = await api(`places?rem=${f.rem}`);
      if (f.place && !f.lists.streets) f.lists.streets = await api(`streets?rem=${f.rem}&place=${f.place}`);
      if (f.street && !f.lists.houses) { const h = await api(`houses?rem=${f.rem}&place=${f.place}&street=${f.street}&type=${f.type}`); f.lists.houses = h.houses; f.lists.streetSub = h.sub; }
      f.err = '';
    } catch { f.err = L().loadFail; }
    if (form === f && view === 'form') { updateResult(); }
  }

  function renderForm() {
    const t = L();
    if (!form) openForm(null);
    const f = form;
    const rems = data?.rems || [];
    const canBack = store.addresses.length > 0;
    app.innerHTML = `<main class="narrow">
      <header class="formtop">${canBack ? `<button class="round" id="back" aria-label="${esc(t.back)}">${svg(IC.back)}</button>` : `<div class="tile hot-tile">${svg(IC.bolt)}</div>`}
        <h1>${esc(f.index == null ? t.newAddr : t.editAddr)}</h1>
        ${!canBack ? `<div class="segs right" role="group">${['uk', 'ru', 'en'].map((k) => `<button class="seg ${store.lang === k ? 'on' : ''}" data-lang="${k}">${k === 'uk' ? 'UA' : k.toUpperCase()}</button>`).join('')}</div>` : ''}</header>
      <form class="card form" id="f" autocomplete="off">
        <div class="field"><label for="f-name">${esc(t.fName)}</label><input id="f-name" maxlength="40" value="${esc(f.label)}"></div>
        <div class="field"><span class="flabel" id="f-type-l">${esc(t.fType)}</span><div class="segs wide-segs" role="radiogroup" aria-labelledby="f-type-l">
          ${['home', 'biz'].map((k) => `<button type="button" role="radio" aria-checked="${f.type === k}" class="seg ${f.type === k ? 'on' : ''}" data-type="${k}">${esc(k === 'home' ? t.tHome : t.tBiz)}</button>`).join('')}</div></div>
        <div class="field"><label for="f-rem">${esc(t.fRem)}</label><select id="f-rem"><option value="">${esc(t.chooseRem)}</option>
          ${rems.map((r) => `<option value="${r.id}" ${r.id === f.rem ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        ${combo('place', t.fPlace, t.phPlace, f.placeName, !f.rem)}
        ${combo('street', t.fStreet, t.phStreet, f.streetName, !f.place)}
        ${combo('house', t.fHouse, t.phHouse, f.house, !f.street)}
        <div id="result"></div>
        <button class="primary" type="submit" id="save">${esc(t.save)}</button>
        ${f.index != null ? `<button class="ghost danger" type="button" id="del">${esc(t.del)}</button>` : ''}
      </form>
      <p class="muted small privacy">${svg(IC.lock)}<span>${esc(t.privacy)}</span></p></main>`;
    if (!rems.length) api('state').then((d) => { data = d; if (view === 'form' && form === f) renderForm(); }).catch(() => {});

    app.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { store.lang = b.dataset.lang; save(); render(); });
    const back = app.querySelector('#back');
    if (back) back.onclick = () => { view = 'main'; form = null; render(); };
    app.querySelector('#f-name').oninput = (e) => { f.label = e.target.value; };
    app.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => {
      if (f.type === b.dataset.type) return;
      f.type = b.dataset.type; delete f.lists.houses; delete f.lists.streetSub; renderForm(); loadLists();
    });
    app.querySelector('#f-rem').onchange = (e) => {
      const r = rems.find((x) => x.id === +e.target.value);
      Object.assign(f, {rem: r ? r.id : null, remName: r ? r.name : '', place: null, placeName: '', street: null, streetName: '', house: '', sub: null, lists: {}});
      renderForm(); loadLists();
    };
    wireCombo('place', () => f.lists.places, (v) => { Object.assign(f, {place: v.id, placeName: v.name, street: null, streetName: '', house: '', sub: null}); f.lists = {places: f.lists.places}; renderForm(); loadLists(); });
    wireCombo('street', () => f.lists.streets, (v) => { Object.assign(f, {street: v.id, streetName: v.name, house: '', sub: null}); f.lists = {places: f.lists.places, streets: f.lists.streets}; renderForm(); loadLists(); });
    wireCombo('house', () => f.lists.houses?.map((h) => ({id: h.house, name: h.house, hint: h.sub})), (v) => { f.house = v.name; updateResult(); }, true);
    app.querySelector('#f').onsubmit = (e) => {
      e.preventDefault();
      updateResult();
      if (!f.street) return;
      const rec = {label: (f.label || '').trim() || t.home, rem: f.rem, remName: f.remName, place: f.place, placeName: f.placeName,
        street: f.street, streetName: f.streetName, house: (f.house || '').trim(), type: f.type, sub: f.sub};
      if (f.index == null) { store.addresses.push(rec); store.active = store.addresses.length - 1; } else store.addresses[f.index] = rec;
      save(); syncPush();
      view = 'main'; form = null; render();
    };
    const del = app.querySelector('#del');
    if (del) del.onclick = () => { store.addresses.splice(f.index, 1); store.active = 0; save(); syncPush(); form = null; view = store.addresses.length ? 'main' : 'form'; render(); };
    updateResult();
  }

  function combo(name, label, ph, value, disabled) {
    return `<div class="field combo" id="c-${name}"><label for="f-${name}">${esc(label)}</label>
      <input id="f-${name}" placeholder="${esc(ph)}" value="${esc(value)}" ${disabled ? 'disabled' : ''} role="combobox" aria-expanded="false" aria-controls="l-${name}" aria-autocomplete="list">
      <div class="list" id="l-${name}" role="listbox" hidden></div><div class="hint small muted"></div></div>`;
  }
  const normq = (s) => s.toLowerCase().replace(/[ʼ’'`"«»]/g, '').replace(/ё/g, 'е');
  function wireCombo(name, items, onPick, free) {
    const input = app.querySelector(`#f-${name}`), list = app.querySelector(`#l-${name}`);
    let shown = [], hi = 0;
    const draw = () => {
      const all = items() || [];
      const q = normq(input.value.trim());
      shown = (q ? all.filter((x) => normq(x.name).includes(q)) : all)
        .sort((a, b) => q ? (normq(a.name).indexOf(q) - normq(b.name).indexOf(q)) : 0).slice(0, 8);
      hi = Math.min(hi, Math.max(shown.length - 1, 0));
      if (!all.length && !q) { close(); return; }
      list.innerHTML = shown.length ? shown.map((x, i) => `<button type="button" role="option" class="opt ${i === hi ? 'hi' : ''}" data-i="${i}"><span>${esc(x.name)}</span>${x.hint ? `<span class="muted small">${esc(x.hint)}</span>` : ''}</button>`).join('')
        : (all.length ? `<div class="opt none muted">${esc(L().nothing)}</div>` : `<div class="opt none muted">${esc(L().loading)}</div>`);
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      list.querySelectorAll('[data-i]').forEach((b) => b.onmousedown = (e) => { e.preventDefault(); pick(shown[+b.dataset.i]); });
    };
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    const pick = (x) => { if (!x) return; input.value = x.name; close(); onPick(x); };
    input.onfocus = draw;
    input.oninput = () => { hi = 0; draw(); if (free) { form.house = input.value; updateResult(); } };
    input.onblur = () => setTimeout(close, 120);
    input.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { hi = Math.min(hi + 1, shown.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { hi = Math.max(hi - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && !list.hidden && shown[hi]) { pick(shown[hi]); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    };
    if (document.activeElement === document.body && !input.disabled && !input.value && name !== 'house') { /* leave focus to the user */ }
  }

  function updateResult() {
    const f = form, t = L();
    const box = app.querySelector('#result');
    if (!box) return;
    const hint = app.querySelector('#c-house .hint');
    let sub = null, msg = '';
    if (f.street && f.lists.houses) {
      const h = normq((f.house || '').replace(/\s+/g, ''));
      if (h) {
        const m = f.lists.houses.find((x) => normq(x.house.replace(/\s+/g, '')) === h);
        sub = m ? m.sub : null;
        if (!m) msg = f.lists.streetSub ? '' : t.houseUnknown;
        if (!m && f.lists.streetSub) sub = f.lists.streetSub;
      } else { sub = f.lists.streetSub; if (!sub) msg = t.needHouse; }
      if (hint) hint.textContent = f.lists.streetSub ? t.houseOptional : '';
    } else if (f.street) msg = t.loading;
    if (f.err) msg = f.err;
    f.sub = sub;
    box.innerHTML = sub ? `<div class="result">${svg(IC.bolt, 'hot')}<div><b>${esc(t.result(sub.split('.')[0], sub))}</b>
      <span class="muted small">${esc(f.streetName)}${f.house ? ', ' + esc(f.house) : ''}</span></div></div>`
      : msg ? `<p class="muted small">${esc(msg)}</p>` : '';
    const s = app.querySelector('#save');
    if (s) s.disabled = !sub;
  }

  // ------------------------------------------------------------------------------------------- start
  render();
  refresh().then(() => { if (store.addresses.length) recheck(); });
  setInterval(() => { if (view === 'main' && !document.hidden) render(); }, 30e3);
  setInterval(() => { if (!document.hidden) refresh(); }, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
