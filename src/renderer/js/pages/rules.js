(function () {
  const MM = window.MM;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const OPT = {
    any: 'Any problem', crash: 'Crash', disconnect: 'Disconnect', freeze: 'Freeze', stuck: 'Stuck loading',
    '<': 'Fewer than', '>': 'More than', '=': 'Exactly', on: 'On', off: 'Off', next: 'Swap now', start: 'Start', stop: 'Close', yes: 'Yes', no: 'No',
  };
  const PARAM = { kind: 'Problem', percent: 'Percent', minutes: 'Minutes', ms: 'Milliseconds', time: 'Time', days: 'Days', who: 'Which alts', game: 'Game', name: 'Preset', mode: 'Do', text: 'Text', state: 'Turn', seconds: 'Seconds', start: 'From', end: 'Until', op: 'Compare', n: 'Number', away: 'Away', on: 'Watcher' };
  const ICON = { problem: 'triangle-alert', gaveUp: 'octagon-x', launchFailed: 'circle-x', started: 'play', stopped: 'square-stop', allClosed: 'moon', ram: 'memory-stick', cpu: 'cpu', ping: 'signal', time: 'clock', every: 'repeat', away: 'coffee', back: 'user', gameUpdated: 'sparkles', outage: 'wifi-off', internetBack: 'wifi', loginWarning: 'key-round', appStarted: 'power' };
  const TEMPLATES = [
    { icon: 'volume-x', label: 'Say it out loud when an alt crashes', rules: [{ name: 'Say when an alt crashes', trigger: { type: 'problem', kind: 'crash' }, conditions: [], actions: [{ type: 'speak', text: '{account} crashed' }], cooldownSec: 30 }] },
    { icon: 'smartphone', label: 'Phone alert when the watcher gives up', rules: [{ name: 'Phone alert: watcher gave up', trigger: { type: 'gaveUp' }, conditions: [], actions: [{ type: 'alert', text: '{account}: {detail}' }], cooldownSec: 60 }] },
    { icon: 'leaf', label: 'Eco mode while I\'m away', rules: [{ name: 'Eco mode on when away', trigger: { type: 'away', minutes: 10 }, conditions: [], actions: [{ type: 'eco', state: 'on' }], cooldownSec: 60 }, { name: 'Eco mode off when back', trigger: { type: 'back' }, conditions: [], actions: [{ type: 'eco', state: 'off' }], cooldownSec: 60 }] },
    { icon: 'layout-grid', label: 'Tile windows when an alt starts', rules: [{ name: 'Tile when an alt starts', trigger: { type: 'started' }, conditions: [], actions: [{ type: 'wait', seconds: 5 }, { type: 'tile' }], cooldownSec: 20 }] },
    { icon: 'memory-stick', label: 'Trim RAM when it gets high', rules: [{ name: 'Trim RAM above 85%', trigger: { type: 'ram', percent: 85, minutes: 1 }, conditions: [], actions: [{ type: 'trim' }], cooldownSec: 600 }] },
    { icon: 'calendar-clock', label: 'Close everything at night', rules: [{ name: 'Close all at 02:00', trigger: { type: 'time', time: '02:00', days: [0, 1, 2, 3, 4, 5, 6] }, conditions: [], actions: [{ type: 'close', who: 'all' }], cooldownSec: 60 }] },
    { icon: 'image', label: 'Screenshot to Discord when an alt freezes', rules: [{ name: 'Freeze screenshot', trigger: { type: 'problem', kind: 'freeze' }, conditions: [], actions: [{ type: 'screenshot' }, { type: 'discord', text: '{account} froze in {game}' }], cooldownSec: 120 }] },
    { icon: 'wifi', label: 'Tell me when the internet is back', rules: [{ name: 'Internet back', trigger: { type: 'internetBack' }, conditions: [], actions: [{ type: 'notify', text: 'The internet is back. Rejoins are running again.' }], cooldownSec: 60 }] },
  ];

  MM.pages.rules = {
    render(root) {
      let data = { rules: [], catalog: null, log: [] }, accounts = [], presets = [];
      root.innerHTML = `
        <div class="page-head"><div><h1>Automations</h1><p>When something happens, MultiMenu does something for you.</p></div>
          <div class="actions"><button class="btn" data-act="importCode">${MM.icon('clipboard-paste')}Paste a code</button><button class="btn primary" data-act="new">${MM.icon('plus')}New automation</button></div></div>
        <div id="r-list" class="stack"></div>
        <div class="card" style="margin-top:16px"><h3>${MM.icon('wand-sparkles')}Ideas to start from</h3><div class="tpl-grid" id="r-tpl"></div></div>
        <div class="card" style="margin-top:16px"><h3>${MM.icon('history')}Recent runs<span class="right"><button class="btn sm ghost" data-act="clearLog">Clear</button></span></h3><div class="list" id="r-log"></div></div>`;

      const cat = () => data.catalog || { triggers: {}, conditions: {}, actions: {} };
      const optText = (k, v) => (PARAM[k] === 'Days' ? (v || []).map(d => DAYS[d]).join(', ') : OPT[v] || v);
      const describeParams = (spec, obj) => Object.keys(spec?.params || {}).filter(k => obj[k] !== '' && obj[k] != null).map(k => `${MM.t(PARAM[k] || k)}: ${optText(k, obj[k])}`).join(' · ');
      const sentence = (r) => {
        const t = cat().triggers[r.trigger.type];
        const tp = describeParams(t, r.trigger);
        const cs = r.conditions.map(c => `${MM.t(cat().conditions[c.type]?.label || c.type)} ${describeParams(cat().conditions[c.type], c)}`);
        const as = r.actions.map(a => `${MM.t(cat().actions[a.type]?.label || a.type)}${describeParams(cat().actions[a.type], a) ? ` (${describeParams(cat().actions[a.type], a)})` : ''}`);
        return `<div class="rule-when">${MM.icon(ICON[r.trigger.type] || 'zap', 15)}<b>${MM.esc(MM.t(t?.label || r.trigger.type))}</b>${tp ? `<span class="small muted" data-nt>${MM.esc(tp)}</span>` : ''}</div>
          ${cs.length ? `<div class="rule-if small muted">${MM.esc(MM.t('Only if'))}: <span data-nt>${MM.esc(cs.join(' · '))}</span></div>` : ''}
          <div class="rule-then">${as.map(x => `<span class="badge dim" data-nt>${MM.esc(x)}</span>`).join(MM.icon('chevrons-right', 13))}</div>`;
      };
      const renderList = () => {
        MM.$('#r-list', root).innerHTML = data.rules.length ? data.rules.map(r => `<div class="card rule ${r.enabled ? '' : 'off'}" data-id="${MM.esc(r.id)}">
            <div class="row nowrap"><label class="toggle" title="On / off"><input type="checkbox" data-toggle ${r.enabled ? 'checked' : ''}><span class="sw"></span></label><b class="rule-name" data-nt>${MM.esc(r.name)}</b><span class="spacer"></span>
              <span class="small dim">${r.runs ? `${MM.esc(MM.t('Ran {0} times').replace('{0}', r.runs))} · ${MM.fmt.ago(r.lastRunAt)}` : MM.esc(MM.t('Hasn\'t run yet'))}</span>
              <button class="btn sm" data-act="run">${MM.icon('play', 14)}Run now</button><button class="btn sm icon" data-act="edit" title="Edit">${MM.icon('pencil', 14)}</button><button class="btn sm icon" data-act="share" title="Share code">${MM.icon('link', 14)}</button><button class="btn sm icon danger" data-act="del" title="Delete">${MM.icon('trash-2', 14)}</button></div>
            ${sentence(r)}</div>`).join('')
          : `<div class="card">${MM.empty('zap', 'No automations yet', 'Start from an idea below, or make your own.')}</div>`;
      };
      const renderTpl = () => { MM.$('#r-tpl', root).innerHTML = TEMPLATES.map((t, i) => `<button class="tpl" data-act="tpl" data-i="${i}">${MM.icon(t.icon, 18)}<span>${MM.esc(t.label)}</span></button>`).join(''); };
      const renderLog = () => {
        MM.$('#r-log', root).innerHTML = data.log.length ? data.log.slice(0, 15).map(l => `<div class="item"><span class="small dim">${MM.fmt.clock(l.at)}</span><div class="grow"><div class="title" data-nt>${MM.esc(l.name)}${l.account ? ` · ${MM.esc(l.account)}` : ''}</div><div class="meta">${MM.esc(l.steps.join(' · '))}</div></div></div>`).join('')
          : MM.empty('history', 'Nothing has run yet', 'Each time an automation runs, what it did shows here.');
      };
      const load = async () => {
        const [d, a, p] = await Promise.all([MM.call('automations:list'), MM.call('accounts:list'), MM.call('presets:list')]);
        if (d) data = d;
        accounts = a?.accounts || []; presets = p || [];
        data.tags = a?.tags || [];
        renderList(); renderTpl(); renderLog();
      };

      // ---------- editor ----------
      const whoList = () => ['all', ...accounts.map(a => a.alias || a.displayName || a.username), ...(data.tags || []).map(t => `tag:${t.tag}`), 'tier:main', 'tier:important', 'tier:filler'];
      const paramInputs = (kind, spec, vals = {}) => Object.entries(spec?.params || {}).map(([k, t]) => {
        const v = vals[k];
        let ctl;
        if (Array.isArray(t)) ctl = `<select class="input sm" data-p="${k}">${t.map(o => `<option value="${MM.esc(o)}" ${v === o ? 'selected' : ''}>${MM.esc(OPT[o] || o)}</option>`).join('')}</select>`;
        else if (t === 'number') ctl = `<input class="input sm" type="number" min="0" data-p="${k}" value="${MM.esc(v ?? '')}" style="width:90px">`;
        else if (t === 'time') ctl = `<input class="input sm" type="time" data-p="${k}" value="${MM.esc(v || '08:00')}" style="width:110px">`;
        else if (t === 'days') { const set = new Set(v || [0, 1, 2, 3, 4, 5, 6]); ctl = `<div class="days" data-p="${k}" data-kind="days">${DAYS.map((d, i) => `<button type="button" data-d="${i}" class="${set.has(i) ? 'on' : ''}">${d}</button>`).join('')}</div>`; }
        else if (k === 'who') ctl = `<input class="input sm" data-p="${k}" list="rx-who" value="${MM.esc(v || '')}" placeholder="${MM.esc(MM.t(kind === 'action' ? 'Blank = the alt that started it' : 'Name, tag:farm or tier:filler'))}" style="min-width:200px">`;
        else if (k === 'name') ctl = `<input class="input sm" data-p="${k}" list="rx-presets" value="${MM.esc(v || '')}" style="min-width:180px">`;
        else ctl = `<input class="input sm" data-p="${k}" value="${MM.esc(v || '')}" maxlength="200" style="min-width:${k === 'text' ? 260 : 160}px" ${k === 'text' ? 'placeholder="{account} · {game} · {detail} · {time}"' : ''}>`;
        return `<label class="rx-param"><span class="small muted">${MM.esc(MM.t(PARAM[k] || k))}</span>${ctl}</label>`;
      }).join('');
      const readParams = (row) => {
        const out = {};
        row.querySelectorAll('[data-p]').forEach(el => {
          const k = el.dataset.p;
          if (el.dataset.kind === 'days') out[k] = [...el.querySelectorAll('.on')].map(b => Number(b.dataset.d));
          else if (el.type === 'number') out[k] = Number(el.value);
          else out[k] = el.value;
        });
        return out;
      };
      const rowHtml = (kind, defs, item) => `<div class="rx-row" data-kind="${kind}"><select class="input sm rx-type">${Object.entries(defs).map(([k, d]) => `<option value="${k}" ${item?.type === k ? 'selected' : ''}>${MM.esc(d.label)}</option>`).join('')}</select>
        <div class="rx-params">${paramInputs(kind, defs[item?.type || Object.keys(defs)[0]], item || {})}</div>
        <span class="spacer"></span>${kind === 'action' ? `<button class="btn sm icon ghost" data-rx="up" title="Move up">${MM.icon('chevrons-left', 13)}</button>` : ''}<button class="btn sm icon ghost danger" data-rx="del" title="Remove">${MM.icon('x', 13)}</button></div>`;

      const editor = async (rule) => {
        const c = cat();
        const v = rule || { name: '', trigger: { type: 'problem', kind: 'crash' }, conditions: [], actions: [{ type: 'rejoin' }], cooldownSec: 60, enabled: true };
        let out = null;
        const ok = await MM.modal({
          title: rule?.id ? `Edit “${rule.name}”` : 'New automation', icon: 'zap', wide: true,
          body: `<datalist id="rx-who">${whoList().map(w => `<option value="${MM.esc(w)}">`).join('')}</datalist><datalist id="rx-presets">${presets.map(p => `<option value="${MM.esc(p.name)}">`).join('')}</datalist>
            <div class="stack rx">
              <div class="field"><label>Name</label><input class="input" id="rx-name" maxlength="60" value="${MM.esc(v.name)}" placeholder="e.g. Rejoin farm alts at night"></div>
              <div class="rx-sec"><div class="lbl">${MM.icon('zap', 14)}When</div><div id="rx-trigger">${rowHtml('trigger', c.triggers, v.trigger).replace(/<button[^>]*data-rx="del"[\s\S]*?<\/button>/, '')}</div></div>
              <div class="rx-sec"><div class="lbl">${MM.icon('filter', 14)}Only if <span class="small dim">(optional)</span></div><div id="rx-conds">${v.conditions.map(x => rowHtml('cond', c.conditions, x)).join('')}</div><button class="btn sm ghost" data-add="cond">${MM.icon('plus', 13)}Add a check</button></div>
              <div class="rx-sec"><div class="lbl">${MM.icon('play', 14)}Then</div><div id="rx-acts">${v.actions.map(x => rowHtml('action', c.actions, x)).join('')}</div><button class="btn sm ghost" data-add="action">${MM.icon('plus', 13)}Add a step</button></div>
              <div class="row"><span class="small muted">Don't run again for</span><input class="input sm" type="number" min="0" max="86400" id="rx-cool" value="${v.cooldownSec}" style="width:90px"><span class="small muted">seconds</span></div>
              <p class="hint">In text you can use {account}, {game}, {detail}, {time}, {ram}, {cpu} and {clients}.</p>
            </div>`,
          onMount: (m) => {
            m.addEventListener('change', (e) => {
              const sel = e.target.closest('.rx-type'); if (!sel) return;
              const row = sel.closest('.rx-row'); const kind = row.dataset.kind;
              const defs = kind === 'trigger' ? c.triggers : kind === 'cond' ? c.conditions : c.actions;
              row.querySelector('.rx-params').innerHTML = paramInputs(kind, defs[sel.value], {});
            });
            m.addEventListener('click', (e) => {
              const d = e.target.closest('.days [data-d]'); if (d) { d.classList.toggle('on'); return; }
              const add = e.target.closest('[data-add]');
              if (add) { const kind = add.dataset.add; m.querySelector(kind === 'cond' ? '#rx-conds' : '#rx-acts').insertAdjacentHTML('beforeend', rowHtml(kind, kind === 'cond' ? c.conditions : c.actions, null)); return; }
              const b = e.target.closest('[data-rx]'); if (!b) return;
              const row = b.closest('.rx-row');
              if (b.dataset.rx === 'del') row.remove();
              if (b.dataset.rx === 'up' && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
            });
          },
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Save', value: true, cls: 'primary', icon: 'save', handler: async (m) => {
            const tRow = m.querySelector('#rx-trigger .rx-row');
            out = {
              id: rule?.id, name: m.querySelector('#rx-name').value, enabled: rule ? rule.enabled : true, cooldownSec: Number(m.querySelector('#rx-cool').value),
              trigger: { type: tRow.querySelector('.rx-type').value, ...readParams(tRow) },
              conditions: [...m.querySelectorAll('#rx-conds .rx-row')].map(r => ({ type: r.querySelector('.rx-type').value, ...readParams(r) })),
              actions: [...m.querySelectorAll('#rx-acts .rx-row')].map(r => ({ type: r.querySelector('.rx-type').value, ...readParams(r) })),
            };
            const r = await MM.call('automations:save', out);
            if (!r) return false;
          } }],
        });
        if (ok) { MM.toast('success', 'Automation saved'); load(); }
      };

      const rid = (b) => b.closest('[data-id]').dataset.id;
      MM.delegate(root, {
        new: () => editor(null),
        edit: (b) => editor(data.rules.find(r => r.id === rid(b))),
        del: async (b) => { const r = data.rules.find(x => x.id === rid(b)); if (await MM.confirm(`Delete “${r.name}”?`, '', { danger: true, ok: 'Delete' })) { await MM.call('automations:remove', r.id); load(); } },
        run: async (b) => { const r = await MM.busy(b, () => MM.call('automations:run', rid(b))); if (r) { MM.toast(r.ran ? 'success' : 'warn', r.ran ? 'Automation ran' : 'Didn\'t run', r.log ? r.log.steps.join(' · ') : 'Automations are paused for a few minutes.'); load(); } },
        share: (b) => MM.shareCode('rule', rid(b)),
        importCode: () => MM.importCode(),
        tpl: async (b) => {
          const t = TEMPLATES[+b.dataset.i];
          if (t.rules.length === 1) return editor({ ...t.rules[0] });
          for (const r of t.rules) await MM.call('automations:save', r);
          MM.toast('success', `Added ${t.rules.length} automations`, t.label); load();
        },
        clearLog: async () => { await MM.call('automations:clearLog'); data.log = []; renderLog(); },
      });
      root.addEventListener('change', async (e) => { if (e.target.matches('[data-toggle]')) { await MM.call('automations:enable', rid(e.target), e.target.checked); load(); } });
      load();
      const offs = [MM.on('automations:changed', load), MM.on('automations:ran', load)];
      return () => offs.forEach(f => f());
    },
  };
})();
