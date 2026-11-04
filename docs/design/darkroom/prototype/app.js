// Darkroom B+ prototype behaviour. Markup opts in with data attributes. Plain browser JS, no dependencies.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const { fmt } = window.AC;
  if (new URLSearchParams(location.search).get('display') === 'sans') document.documentElement.dataset.display = 'sans'; // serif is optional
  let lastInput = 'pointer';
  addEventListener('keydown', () => { lastInput = 'key'; }, true);
  addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);

  // figures: <span data-fig="october.net" data-f="usd">
  const get = (path) => path.split('.').reduce((o, k) => o?.[k], window.AC);
  $$('[data-fig]').forEach((el) => { const v = get(el.dataset.fig); el.textContent = fmt[el.dataset.f || 'usd'](v); });

  // the metric chart: dashed and neutral while a draft, solid in the one data hue once approved
  const chartEl = $('[data-chart]');
  const drawChart = (approved) => {
    if (!chartEl || !window.Charts) return;
    const css = getComputedStyle(chartEl);
    Charts.line(chartEl, {
      labels: AC.months,
      series: [{ name: 'Net revenue after fees', values: AC.net, dash: !approved, colour: approved ? css.getPropertyValue('--chart-1').trim() : css.getPropertyValue('--draft-line').trim() || css.getPropertyValue('--muted').trim() }],
      format: fmt.usd, tickFormat: fmt.k, min: 350000, endLabel: chartEl.dataset.endlabel !== 'off',
      height: () => (innerWidth < 720 ? 180 : Number(chartEl.dataset.height || 240)),
    });
  };

  // review: issue → ready → approved
  // Review states. Choreography (see SPEC): decision row leads (0ms, 220ms, opacity + 4px), chart crossfades
  // dashed → solid (40ms, 200ms, opacity only), caption fades with it, header status fades last (80ms).
  let running = [];
  const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const play = (el, frames, opts) => { if (el) running.push(el.animate(frames, { easing: EASE, fill: 'backwards', ...opts })); };
  const setState = (st, animate = false) => {
    const prev = document.body.dataset.state;
    running.forEach((a) => a.cancel()); running = [];
    $$('.chart-ghost').forEach((g) => g.remove());
    const before = new Set($$('[data-when]').filter((el) => !el.hidden));
    document.body.dataset.state = st;
    $$('[data-when]').forEach((el) => { el.hidden = !el.dataset.when.split(' ').includes(st); });
    const approvedChanged = (prev === 'approved') !== (st === 'approved') || !chartEl?.querySelector('svg');
    const ghost = animate && approvedChanged ? chartEl?.querySelector('svg')?.cloneNode(true) : null;
    if (approvedChanged) drawChart(st === 'approved');
    if (!animate) return finishState(st);
    const calm = reduceMotion() || lastInput === 'key' || st === 'issue' || prev === 'approved'; // undo and resets: together, opacity only, 140ms
    const shown = $$('[data-when]').filter((el) => !el.hidden && !before.has(el));
    const inDecision = shown.filter((el) => el.closest('.decision'));
    inDecision.forEach((el) => play(el, calm ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: calm ? 140 : 220 }));
    if (ghost) {
      // the outgoing line lives beside the chart (the chart helper redraws its own box on resize)
      const host = chartEl.parentElement; if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      ghost.classList.add('chart-ghost');
      ghost.style.cssText += `;position:absolute;left:${chartEl.offsetLeft}px;top:${chartEl.offsetTop}px;width:${chartEl.offsetWidth}px;pointer-events:none`;
      host.appendChild(ghost);
      const out = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: calm ? 140 : 200, delay: calm ? 0 : 40, easing: EASE, fill: 'forwards' });
      running.push(out); out.onfinish = () => ghost.remove();
      play(chartEl, [{ opacity: 0 }, { opacity: 1 }], { duration: calm ? 140 : 200, delay: calm ? 0 : 40 });
    }
    shown.filter((el) => !el.closest('.decision')).forEach((el) => {
      const isStatus = !!el.closest('.head');
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: calm ? 140 : 160, delay: calm ? 0 : (isStatus ? 80 : 40) });
    });
    finishState(st);
  };
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finishState = (st) => {
    const live = $('#live'); if (live) live.textContent = { ready: '3 test refunds excluded. Ready to approve.', approved: 'Approved. Version 1 is live for embeds.', issue: '', error: 'We couldn’t read your refunds.', loading: 'Loading the result.' }[st] ?? '';
  };
  if (document.body.dataset.state) setState(document.body.dataset.state); else drawChart(chartEl?.dataset.approved === 'true');
  const busy = (b, label, ms, then) => {
    const l = b.querySelector('[data-label]'); const was = l ? l.textContent : '';
    b.setAttribute('aria-busy', 'true'); if (l && label) l.textContent = label;
    setTimeout(() => { b.removeAttribute('aria-busy'); if (l) l.textContent = was; then(); }, ms);
  };
  let undoTimer = null;
  const armUndo = () => {
    const u = $('[data-undo]'); if (!u) return;
    clearInterval(undoTimer); let left = Number(u.dataset.undo || 10);
    const tick = () => { const n = $('[data-undo-left]'); if (n) n.textContent = left + ' s'; if (left-- <= 0) { clearInterval(undoTimer); u.hidden = true; } };
    u.hidden = false; tick(); undoTimer = setInterval(tick, 1000);
  };
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (b.dataset.busy) busy(b, b.dataset.busy, Number(b.dataset.ms || 700), () => { setState(go, true); if (go === 'approved') { armUndo(); $('[data-focus-after-approve]')?.focus(); } });
    else { if (go !== 'approved') clearInterval(undoTimer); setState(go, true); }
  }));
  // demo states for screenshots and QA: review.html?state=loading | error | ready | approved
  const qs = new URLSearchParams(location.search).get('state');
  if (qs && document.body.dataset.state) setState(qs);
  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { const b = $('[data-go="approved"]:not([hidden])'); if (b && b.offsetParent) { e.preventDefault(); b.click(); } }
  });

  // a side panel or sheet: [data-panel-open="id"], [data-panel-close]
  // The drawer stays mounted while it leaves, then hides; keyboard-opened drawers fade instead of travel.
  const isOpen = (p) => p && p.hasAttribute('data-open');
  let opener = null;
  const openPanel = (id, tab, kbd) => {
    const p = document.getElementById(id); if (!p) return;
    clearTimeout(p._hide); opener = document.activeElement;
    p.toggleAttribute('data-kbd', !!kbd); p.hidden = false; p.inert = false;
    void p.offsetWidth; // commit the closed state so the transition runs
    p.setAttribute('data-open', ''); document.body.classList.add('panel-open');
    $$(`[data-panel-open="${id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'true'));
    if (tab) selectTab(p, tab);
    (p.querySelector('[role="tab"][aria-selected="true"]') || p.querySelector('button'))?.focus({ preventScroll: true });
  };
  const closePanel = (p, kbd) => {
    if (!isOpen(p)) return;
    p.toggleAttribute('data-kbd', !!kbd); p.removeAttribute('data-open'); p.inert = true; document.body.classList.remove('panel-open');
    $$(`[data-panel-open="${p.id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'false'));
    p._hide = setTimeout(() => { p.hidden = true; }, 220);
    (opener && document.contains(opener) ? opener : $(`[data-panel-open="${p.id}"]`))?.focus({ preventScroll: true });
  };
  // a click that came from Enter/Space has detail 0: treat it as keyboard-initiated
  $$('[data-panel-open]').forEach((b) => b.addEventListener('click', (e) => {
    const p = document.getElementById(b.dataset.panelOpen), kbd = e.detail === 0;
    if (isOpen(p) && !b.dataset.tab) closePanel(p, kbd); else openPanel(b.dataset.panelOpen, b.dataset.tab, kbd);
  }));
  $$('[data-panel-close]').forEach((b) => b.addEventListener('click', (e) => closePanel(b.closest('[data-panel]'), e.detail === 0)));
  $$('[data-panel]').forEach((p) => { if (p.hidden) p.inert = true; });
  $$('[data-panel-scrim]').forEach((s) => s.addEventListener('click', () => closePanel($('[data-panel]'), false)));
  addEventListener('keydown', (e) => {
    const p = $('[data-panel]');
    if (e.key === 'Escape' && isOpen(p)) closePanel(p, true);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i' && p) { e.preventDefault(); isOpen(p) ? closePanel(p, true) : openPanel(p.id, null, true); }
  });

  // tabs: [role=tablist] > [role=tab][aria-controls]
  const selectTab = (root, id) => {
    $$('[role="tab"]', root).forEach((t) => { const on = t.getAttribute('aria-controls') === id; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    $$('[role="tabpanel"]', root).forEach((p) => { p.hidden = p.id !== id; });
  };
  $$('[role="tablist"]').forEach((list) => {
    const root = list.closest('[data-tabs]') || list.parentElement;
    $$('[role="tab"]', list).forEach((t, i, all) => {
      t.addEventListener('click', () => selectTab(root, t.getAttribute('aria-controls')));
      t.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return;
        const n = all[(i + d + all.length) % all.length]; n.focus(); n.click();
      });
    });
  });

  // segmented choice that swaps what it controls: [data-choice="group"] buttons with data-value; targets [data-for="group:value"]
  $$('[data-choice]').forEach((group) => {
    const name = group.dataset.choice;
    $$('button', group).forEach((b) => b.addEventListener('click', () => {
      $$('button', group).forEach((x) => x.setAttribute('aria-pressed', x === b));
      $$(`[data-for^="${name}:"]`).forEach((el) => { el.hidden = el.dataset.for !== `${name}:${b.dataset.value}`; });
      $$(`[data-text="${name}"]`).forEach((el) => { el.textContent = b.dataset.code || b.dataset.value; });
      $$(`[data-attr="${name}"]`).forEach((el) => { el.dataset.host = b.dataset.value; });
      if (name === 'host') drawChart(true); // the chart reads its colours from the host's tokens when it draws
    }));
  });

  // disclosure rows: <button aria-expanded aria-controls>
  // Disclosures grow from their header: height + opacity, 200ms open / 140ms close, cancellable mid-way.
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const region = (el, open) => {
    if (!el) return;
    const from = el.hidden ? 0 : el.getBoundingClientRect().height;
    el._anim?.cancel(); el.hidden = false;
    const to = open ? el.scrollHeight : 0;
    if (reduce()) { el.hidden = !open; if (open) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease' }); return; }
    el.style.overflow = 'hidden';
    el._anim = el.animate([{ height: from + 'px', opacity: open ? 0 : 1 }, { height: to + 'px', opacity: open ? 1 : 0 }],
      { duration: open ? 200 : 140, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    el._anim.onfinish = () => { el.style.overflow = ''; el.hidden = !open; el._anim = null; };
  };
  window.ACregion = region;
  $$('[data-disclose]').forEach((b) => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    if (b.dataset.disclose === 'one') $$('[data-disclose="one"]').forEach((x) => { if (x !== b && x.getAttribute('aria-expanded') === 'true') { x.setAttribute('aria-expanded', 'false'); region(document.getElementById(x.getAttribute('aria-controls')), false); } });
    b.setAttribute('aria-expanded', open); region(document.getElementById(b.getAttribute('aria-controls')), open);
  }));

  // copy: [data-copy] copies the text of its target (or its own data-copy text)
  // Copy buttons carry both labels in one grid cell, so the width and the text position never change.
  $$('[data-copy]').forEach((b) => {
    b.querySelectorAll(':scope > svg').forEach((svg) => svg.remove()); // the check lives in the stacked label now
    const l = b.querySelector('[data-label]'); if (!l || l.parentElement.classList.contains('lbl-stack')) return;
    const stack = document.createElement('span'); stack.className = 'lbl-stack'; l.replaceWith(stack); stack.appendChild(l);
    stack.insertAdjacentHTML('beforeend', '<span class="lbl-done" aria-hidden="true"><svg aria-hidden="true"><use href="icons.svg#check"/></svg>Copied</span>');
  });
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const src = b.dataset.copy.startsWith('#') ? $(b.dataset.copy) : null;
    const text = src ? $$('.ln', src).map((l) => '  '.repeat(Number(l.dataset.i || 0)) + l.textContent).join('\n') || src.textContent : b.dataset.copy;
    try { await navigator.clipboard.writeText(text); } catch { /* prototype: clipboard may be blocked */ }
    b.classList.add('is-done');
    const live = $('#live'); if (live) live.textContent = 'Copied to clipboard';
    clearTimeout(b._t); b._t = setTimeout(() => { b.classList.remove('is-done'); }, 1600);
  }));

  // home composer: the send control wakes up when there is a question
  const q = $('#q'), send = $('#send');
  if (q && send) {
    const sync = () => { const on = q.value.trim().length > 0; send.setAttribute('aria-disabled', !on); send.tabIndex = on ? 0 : -1; };
    q.addEventListener('input', sync); sync();
    const go = () => busy(send, 'Drafting', 650, () => { location.href = send.getAttribute('href'); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && q.value.trim()) { e.preventDefault(); go(); } });
    send.addEventListener('click', (e) => { e.preventDefault(); if (send.getAttribute('aria-disabled') !== 'true') go(); });
    $$('[data-idea]').forEach((b) => b.addEventListener('click', () => { q.value = b.dataset.idea; sync(); q.focus(); }));
  }

  // Clarify: one question at a time, answers kept per step, back keeps them, keyboard 1/2/↵
  const form = $('#clarify');
  if (form && window.CLARIFY) {
    const Q = window.CLARIFY, answers = Q.map(() => null); let step = 0;
    const opts = $('#q-options'), next = $('#q-next'), back = $('#q-back'), techBtn = $('#q-tech-btn'), tech = $('#q-tech');
    const render = (dir) => {
      const cur = Q[step];
      form.dataset.step = step; form.dataset.dir = dir || '';
      $('#q-count').textContent = `Question ${step + 1} of ${Q.length}`;
      $$('.q-bar i').forEach((i, k) => i.classList.toggle('on', k <= step));
      $('#q-title').textContent = cur.q; $('#q-why').textContent = cur.why;
      opts.innerHTML = cur.opts.map((o, i) => `<button type="button" class="opt" role="radio" aria-checked="${answers[step] === i}" tabindex="${(answers[step] ?? 0) === i ? 0 : -1}" data-i="${i}"><span class="radio" aria-hidden="true"></span><span><span class="t">${o[0]}</span>${o[2] ? '<span class="rec">Recommended</span>' : ''}<span class="e">${o[1]}</span></span><span class="key" aria-hidden="true">${i + 1}</span></button>`).join('');
      tech.innerHTML = `<div>${cur.tech[0]}</div><div style="color:var(--faint)">${cur.tech[1]}</div>`;
      tech.hidden = true; techBtn.setAttribute('aria-expanded', 'false');
      back.hidden = step === 0;
      next.querySelector('[data-label]').textContent = step === Q.length - 1 ? 'See the result' : 'Continue';
      next.setAttribute('aria-disabled', answers[step] === null);
      const body = $('#q-body'); body._anim?.cancel();
      if (dir) {
        const travel = !(lastInput === 'key' || reduce());
        const x = dir === 'back' ? -12 : 12;
        body._anim = body.animate(travel ? [{ opacity: 0, transform: `translateX(${x}px)` }, { opacity: 1, transform: 'none' }] : [{ opacity: 0 }, { opacity: 1 }],
          { duration: travel ? 220 : 120, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      }
    };
    const pick = (i, focus = true) => { answers[step] = i; $$('.opt', opts).forEach((o) => { const on = Number(o.dataset.i) === i; o.setAttribute('aria-checked', on); o.tabIndex = on ? 0 : -1; if (on && focus) o.focus(); }); next.setAttribute('aria-disabled', 'false'); };
    opts.addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (o) pick(Number(o.dataset.i)); });
    opts.addEventListener('keydown', (e) => { const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); const n = Q[step].opts.length; pick(((answers[step] ?? 0) + d + n) % n); } });
    techBtn.addEventListener('click', () => { const open = techBtn.getAttribute('aria-expanded') !== 'true'; techBtn.setAttribute('aria-expanded', open); region(tech, open); });
    const advance = () => {
      if (answers[step] === null) return;
      if (step < Q.length - 1) { step++; render('fwd'); $('#q-title').focus?.(); return; }
      busy(next, 'Building', 500, () => {
        form.hidden = true; const b = $('#building'); b.hidden = false; b.querySelector('h1').focus();
        setTimeout(() => { $('#b2').className = 'done'; $('#b2').innerHTML = '<svg aria-hidden="true" style="color:var(--ok)"><use href="icons.svg#check"/></svg>Matched refunds to charges'; $('#b3').className = ''; $('#b3').innerHTML = '<span class="spin" aria-hidden="true"></span>Checking against your Stripe payouts'; }, 900);
        setTimeout(() => { location.href = 'review.html'; }, form.dataset.stay ? 1e9 : 1900);
      });
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); advance(); });
    back.addEventListener('click', () => { step = Math.max(0, step - 1); render('back'); });
    $('#q-rec').addEventListener('click', () => { pick(Q[step].opts.findIndex((o) => o[2]), false); setTimeout(advance, 160); });
    addEventListener('keydown', (e) => {
      if (form.hidden || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      const n = Number(e.key); if (n >= 1 && n <= Q[step].opts.length) { e.preventDefault(); pick(n - 1); }
      if (e.key === 'Enter' && !document.activeElement.closest('button:not(.opt)')) { e.preventDefault(); advance(); }
      if (e.key === 'Escape' && step > 0) { step--; render('back'); }
    });
    $('#q-title').tabIndex = -1;
    if (new URLSearchParams(location.search).get('stay')) form.dataset.stay = '1';
    render();
  }
})();
