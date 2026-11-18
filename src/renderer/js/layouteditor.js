// Custom layout editor: draw zones on a picture of your monitor. Drag on an empty spot to
// draw a zone, drag a zone to move it, drag its corner to resize, × to remove. Windows go
// into the zones in number order.
(function () {
  const MM = window.MM;
  const STARTS = {
    empty: [],
    halves: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }],
    grid2: [0, 1].flatMap(r => [0, 1].map(c => ({ x: c / 2, y: r / 2, w: 0.5, h: 0.5 }))),
    grid3: [0, 1, 2].flatMap(r => [0, 1, 2].map(c => ({ x: c / 3, y: r / 3, w: 1 / 3, h: 1 / 3 }))),
    main: [{ x: 0, y: 0, w: 0.625, h: 1 }, { x: 0.625, y: 0, w: 0.375, h: 1 / 3 }, { x: 0.625, y: 1 / 3, w: 0.375, h: 1 / 3 }, { x: 0.625, y: 2 / 3, w: 0.375, h: 1 / 3 }],
    bigTwo: [{ x: 0, y: 0, w: 0.5, h: 0.6 }, { x: 0.5, y: 0, w: 0.5, h: 0.6 }, ...[0, 1, 2, 3, 4, 5].map(c => ({ x: c / 6, y: 0.6, w: 1 / 6, h: 0.4 }))],
  };
  const START_NAMES = { empty: 'Empty', halves: 'Two halves', grid2: '2 × 2', grid3: '3 × 3', main: 'Main + 3', bigTwo: '2 big + 6 small' };

  /** A 48×30 icon of zones, for the layout picker. */
  MM.zonesIcon = (zones) => zones.slice(0, 40).map(z => `<rect x="${(2 + z.x * 44).toFixed(1)}" y="${(2 + z.y * 26).toFixed(1)}" width="${Math.max(1, z.w * 44 - 1.5).toFixed(1)}" height="${Math.max(1, z.h * 26 - 1.5).toFixed(1)}" rx="1.2"/>`).join('');

  MM.openLayoutEditor = async (existing) => {
    const pv = await MM.call('tiler:preview', { sampleCount: 0 });
    if (!pv) return null;
    const wa = pv.display.workArea;
    const aspect = wa.width / Math.max(1, wa.height);
    let zones = (existing?.zones || STARTS.grid2).map(z => ({ ...z }));
    let snap = true;
    const STEP = 1 / 48;
    const snapV = (v) => (snap ? Math.round(v / STEP) * STEP : v);
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    let saved = null;

    const ok = await MM.modal({
      title: existing ? 'Edit layout' : 'Draw your own layout', icon: 'layout-template', wide: true,
      desc: 'Drag on an empty spot to draw a zone. Drag a zone to move it, its corner to resize it. Windows fill the zones in number order; extra windows go into the zones again, a little offset.',
      body: `<div class="row" style="gap:10px;margin-bottom:10px;align-items:flex-end">
          <div class="field" style="flex:1;margin:0"><label>Name</label><input class="input" id="le-name" maxlength="40" value="${MM.esc(existing?.name || MM.t('My layout'))}"></div>
          <div class="field" style="margin:0"><label>Start from</label><select class="input" id="le-start"><option value="">${MM.esc(MM.t('Choose…'))}</option>${Object.entries(START_NAMES).map(([k, v]) => `<option value="${k}">${MM.esc(MM.t(v))}</option>`).join('')}<option value="current">${MM.esc(MM.t('Current layout'))}</option></select></div>
          <label class="check-lbl" style="margin-bottom:8px"><input type="checkbox" id="le-snap" checked> ${MM.esc(MM.t('Snap to grid'))}</label>
        </div>
        <div class="le-stage" id="le-stage" style="aspect-ratio:${aspect.toFixed(4)}"></div>
        <div class="row" style="justify-content:space-between;margin-top:8px"><span class="small muted" id="le-count"></span><span class="small muted" data-nt>${MM.esc(`${pv.display.width} × ${pv.display.height}`)}</span></div>`,
      buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Save and use', value: true, cls: 'primary', handler: async (m) => {
        if (!zones.length) { MM.toast('warn', 'Draw at least one zone'); return false; }
        try { saved = await MM.api('customlayouts:save', { id: existing?.id, name: m.querySelector('#le-name').value, zones }); } catch (e) { MM.toast('error', 'Not saved', e.message); return false; }
        return true;
      } }],
      onMount: (m) => {
        const stage = m.querySelector('#le-stage');
        const draw = () => {
          stage.innerHTML = zones.map((z, i) => `<div class="le-zone" data-i="${i}" style="left:${z.x * 100}%;top:${z.y * 100}%;width:${z.w * 100}%;height:${z.h * 100}%">
              <b>${i + 1}</b><button class="le-x" data-del="${i}" title="${MM.esc(MM.t('Remove'))}">×</button><i class="le-h" data-res="${i}"></i></div>`).join('');
          m.querySelector('#le-count').textContent = MM.t('{0} zones').replace('{0}', zones.length);
        };
        draw();
        m.querySelector('#le-snap').addEventListener('change', (e) => { snap = e.target.checked; });
        m.querySelector('#le-start').addEventListener('change', (e) => {
          const v = e.target.value;
          if (v === 'current') zones = pv.cells.length ? pv.cells.map(c => ({ x: (c.x * pv.display.width - wa.x) / wa.width, y: (c.y * pv.display.height - wa.y) / wa.height, w: c.w * pv.display.width / wa.width, h: c.h * pv.display.height / wa.height })) : STARTS.grid2.map(z => ({ ...z }));
          else if (STARTS[v]) zones = STARTS[v].map(z => ({ ...z }));
          e.target.value = '';
          draw();
        });
        const pos = (e) => { const r = stage.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }; };
        let drag = null;
        stage.addEventListener('pointerdown', (e) => {
          const del = e.target.closest('[data-del]');
          if (del) { zones.splice(Number(del.dataset.del), 1); draw(); return; }
          const p = pos(e);
          const res = e.target.closest('[data-res]');
          const zone = e.target.closest('.le-zone');
          if (res) drag = { mode: 'resize', i: Number(res.dataset.res) };
          else if (zone) { const i = Number(zone.dataset.i); drag = { mode: 'move', i, dx: p.x - zones[i].x, dy: p.y - zones[i].y }; }
          else {
            if (zones.length >= 40) { MM.toast('warn', 'At most 40 zones'); return; }
            zones.push({ x: snapV(p.x), y: snapV(p.y), w: 0.02, h: 0.02 });
            drag = { mode: 'new', i: zones.length - 1, ox: snapV(p.x), oy: snapV(p.y) };
            draw();
          }
          stage.setPointerCapture(e.pointerId);
          e.preventDefault();
        });
        stage.addEventListener('pointermove', (e) => {
          if (!drag) return;
          const p = pos(e);
          const z = zones[drag.i];
          if (drag.mode === 'move') {
            z.x = clamp(snapV(p.x - drag.dx), 0, 1 - z.w); z.y = clamp(snapV(p.y - drag.dy), 0, 1 - z.h);
          } else if (drag.mode === 'resize') {
            z.w = clamp(snapV(p.x) - z.x, 0.03, 1 - z.x); z.h = clamp(snapV(p.y) - z.y, 0.03, 1 - z.y);
          } else {
            const x2 = snapV(p.x), y2 = snapV(p.y);
            z.x = Math.min(drag.ox, x2); z.y = Math.min(drag.oy, y2); z.w = Math.max(0.02, Math.abs(x2 - drag.ox)); z.h = Math.max(0.02, Math.abs(y2 - drag.oy));
          }
          const el = stage.querySelector(`.le-zone[data-i="${drag.i}"]`);
          if (el) Object.assign(el.style, { left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` });
        });
        const end = () => {
          if (!drag) return;
          const z = zones[drag.i];
          if (drag.mode === 'new' && (z.w < 0.03 || z.h < 0.03)) zones.splice(drag.i, 1); // a click, not a drag
          drag = null;
          draw();
        };
        stage.addEventListener('pointerup', end);
        stage.addEventListener('pointercancel', end);
      },
    });
    if (!ok || !saved) return null;
    await MM.setSetting('tiling.layout', `custom:${saved.id}`);
    MM.toast('success', 'Layout saved', MM.t('"{0}" is now your layout. Press Tile windows to use it.').replace('{0}', saved.name));
    return saved;
  };
})();
