'use strict';
const TradeView = {
  _state: null,
  _sides: { A: [], B: [] },
  _searchTimers: {},

  init(state) {
    this._state = state;
    this._bindSearch('A');
    this._bindSearch('B');
    this._bindPickAdder('A');
    this._bindPickAdder('B');

    document.getElementById('trade-clear-btn').addEventListener('click', () => this._clear());
    document.getElementById('trade-save-btn').addEventListener('click', () => this._save());
    document.getElementById('trade-load-btn').addEventListener('click', () => this._showLoad());
  },

  reload(state) { this._state = state; this._runAnalysis(); },

  _bindSearch(side) {
    const input   = document.getElementById(`search-${side.toLowerCase()}`);
    const results = document.getElementById(`results-${side.toLowerCase()}`);

    input.addEventListener('input', () => {
      clearTimeout(this._searchTimers[side]);
      const q = input.value.trim();
      if (q.length < 2) { results.classList.add('hidden'); return; }
      this._searchTimers[side] = setTimeout(() => this._doSearch(q, side), 200);
    });

    input.addEventListener('blur', () => setTimeout(() => results.classList.add('hidden'), 200));
    input.addEventListener('focus', () => { if (input.value.length >= 2) results.classList.remove('hidden'); });
  },

  async _doSearch(q, side) {
    const results = document.getElementById(`results-${side.toLowerCase()}`);
    try {
      const players = await App.api(`/api/players/search?q=${encodeURIComponent(q)}`);
      if (!players.length) { results.classList.add('hidden'); return; }

      results.innerHTML = players.slice(0, 15).map(p => `
        <div class="search-result-item" data-pid="${p.player_id}" data-name="${p.full_name}" data-pos="${p.position}" data-val="${p.ktc_sf_value}">
          <span class="pos-badge pos-${p.position}">${p.position}</span>
          <span class="result-name">${p.full_name}</span>
          <span style="color:var(--text-muted);font-size:11px">${p.nfl_team || 'FA'}</span>
          <span class="result-val">${p.ktc_sf_value ? p.ktc_sf_value.toLocaleString() : '—'}</span>
        </div>
      `).join('');

      results.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          const item = {
            type: 'player',
            player_id: el.dataset.pid,
            name: el.dataset.name,
            position: el.dataset.pos,
            value: parseInt(el.dataset.val) || 0,
          };
          this._addItem(side, item);
          document.getElementById(`search-${side.toLowerCase()}`).value = '';
          results.classList.add('hidden');
        });
      });

      results.classList.remove('hidden');
    } catch (_) { results.classList.add('hidden'); }
  },

  _bindPickAdder(side) {
    const s = side.toLowerCase();
    document.getElementById(`add-pick-${s}`).addEventListener('click', () => {
      const year  = document.getElementById(`pick-${s}-year`).value;
      const round = document.getElementById(`pick-${s}-round`).value;
      const tier  = document.getElementById(`pick-${s}-tier`).value;
      const ov    = parseInt(document.getElementById(`pick-${s}-override`).value) || 0;
      this._addItem(side, { type: 'pick', year, round, tier, override_value: ov || null });
      document.getElementById(`pick-${s}-override`).value = '';
    });
  },

  _addItem(side, item) {
    this._sides[side].push(item);
    this._renderItems(side);
    this._runAnalysis();
  },

  _removeItem(side, idx) {
    this._sides[side].splice(idx, 1);
    this._renderItems(side);
    this._runAnalysis();
  },

  _renderItems(side) {
    const s   = side.toLowerCase();
    const el  = document.getElementById(`items-${s}`);
    const totEl = document.getElementById(`total-${s}`);
    let total = 0;

    const rows = this._sides[side].map((item, i) => {
      let label, pos, val;
      if (item.type === 'player') {
        label = item.name;
        pos   = item.position;
        val   = item.value || 0;
      } else {
        label = `${item.year} Round ${item.round} (${item.tier})${item.override_value ? ' [manual]' : ''}`;
        pos   = 'PICK';
        val   = item.override_value || this._pickEstimate(item.year, item.round, item.tier);
      }
      total += val;
      const badge = pos !== 'PICK' ? `<span class="pos-badge pos-${pos}">${pos}</span>` : `<span style="color:var(--text-muted);font-size:11px">PICK</span>`;
      return `<div class="trade-item">
        ${badge}
        <span class="item-label">${label}</span>
        <span class="item-value">${val.toLocaleString()}</span>
        <button class="item-remove" data-side="${side}" data-idx="${i}">✕</button>
      </div>`;
    });

    el.innerHTML = rows.join('') || '<div style="padding:12px;color:var(--text-dim);font-size:12px">No items added</div>';
    el.querySelectorAll('.item-remove').forEach(btn => {
      btn.addEventListener('click', () => this._removeItem(btn.dataset.side, parseInt(btn.dataset.idx)));
    });

    totEl.textContent = `Total: ${total.toLocaleString()}`;
  },

  _pickEstimate(year, round, tier) {
    const table = {
      '2026-1-early': 7500, '2026-1-mid': 6200, '2026-1-late': 5000,
      '2026-2-early': 3200, '2026-2-mid': 2600, '2026-2-late': 2000,
      '2026-3-early': 1000, '2026-3-mid':  800, '2026-3-late':  600,
      '2027-1-early': 5500, '2027-1-mid': 4500, '2027-1-late': 3800,
      '2027-2-early': 2500, '2027-2-mid': 2000, '2027-2-late': 1600,
      '2027-3-early':  800, '2027-3-mid':  650, '2027-3-late':  500,
      '2028-1-early': 4500, '2028-1-mid': 3800, '2028-1-late': 3200,
      '2028-2-early': 2000, '2028-2-mid': 1600, '2028-2-late': 1200,
      '2028-3-early':  650, '2028-3-mid':  500, '2028-3-late':  400,
    };
    return table[`${year}-${round}-${tier}`] || 500;
  },

  async _runAnalysis() {
    const bar = document.getElementById('verdict-bar');
    if (!this._sides.A.length && !this._sides.B.length) {
      bar.className = 'verdict-bar';
      bar.textContent = 'Add players or picks to both sides to analyze.';
      return;
    }
    try {
      const result = await App.api('/api/trade/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sideA: this._sides.A, sideB: this._sides.B }),
      });

      const { side_a: a, side_b: b, verdict, winner } = result;
      const posA = Object.entries(a.positions || {}).map(([p, n]) => `+${n}${p}`).join(', ') || '—';
      const posB = Object.entries(b.positions || {}).map(([p, n]) => `+${n}${p}`).join(', ') || '—';
      const ageA = a.avg_age ? `avg age ${a.avg_age}` : '—';
      const ageB = b.avg_age ? `avg age ${b.avg_age}` : '—';

      bar.className = `verdict-bar ${winner ? (winner === 'A' ? 'verdict-a' : 'verdict-b') : 'verdict-fair'}`;
      bar.innerHTML = `<span style="font-size:16px;margin-right:12px">${verdict}</span>
        <span style="color:var(--text-muted);font-size:12px">
          A: ${a.total_value.toLocaleString()} (${posA}, ${ageA})  ·
          B: ${b.total_value.toLocaleString()} (${posB}, ${ageB})
        </span>`;
    } catch (_) {}
  },

  _clear() {
    this._sides.A = []; this._sides.B = [];
    this._renderItems('A'); this._renderItems('B');
    const bar = document.getElementById('verdict-bar');
    bar.className = 'verdict-bar';
    bar.textContent = 'Add players or picks to both sides to analyze.';
  },

  async _save() {
    const name = prompt('Name this trade scenario:');
    if (!name) return;
    try {
      await App.api('/api/trade/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sideA: this._sides.A, sideB: this._sides.B }),
      });
      App.toast('Trade scenario saved');
    } catch (e) { App.toast(`Save failed: ${e.message}`, 'error'); }
  },

  async _showLoad() {
    const scenarios = await App.api('/api/trade/scenarios').catch(() => []);
    if (!scenarios.length) { App.toast('No saved scenarios', 'error'); return; }

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border-mid);border-radius:var(--r);padding:20px;width:380px;max-height:80vh;overflow:auto">
        <div style="display:flex;justify-content:space-between;margin-bottom:14px">
          <strong>Load Trade Scenario</strong>
          <button onclick="this.closest('[style*=position]').remove()" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer">✕</button>
        </div>
        ${scenarios.map(s => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
            <span style="flex:1;font-size:13px">${s.name}</span>
            <span style="color:var(--text-dim);font-size:11px">${new Date(s.created_at * 1000).toLocaleDateString()}</span>
            <button class="btn btn-secondary btn-sm" data-id="${s.id}">Load</button>
          </div>
        `).join('')}
      </div>`;

    modal.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const data = await App.api(`/api/trade/scenarios/${btn.dataset.id}`);
        this._sides.A = data.data.sideA || [];
        this._sides.B = data.data.sideB || [];
        this._renderItems('A'); this._renderItems('B');
        this._runAnalysis();
        modal.remove();
      });
    });

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  },
};
