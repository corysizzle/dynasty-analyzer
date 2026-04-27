'use strict';
const RosterView = {
  _state: null,
  _sortKey: 'slot',
  _sortAsc: true,

  init(state) {
    this._state = state;
    this._populateTeams();
    document.getElementById('roster-team-select').addEventListener('change', () => this._render());
    document.getElementById('roster-sort-select').addEventListener('change', e => {
      this._sortKey = e.target.value;
      this._render();
    });
  },

  reload(state) { this._state = state; this._populateTeams(); },

  _populateTeams() {
    const sel = document.getElementById('roster-team-select');
    const names = this._state.rosters.map(r => r.team_name).sort();
    sel.innerHTML = names.map(n => `<option value="${n}" ${n === 'Thomas the Tank Engine' ? 'selected' : ''}>${n}</option>`).join('');
    this._render();
  },

  _render() {
    const teamName = document.getElementById('roster-team-select').value;
    const roster = this._state.rosters.find(r => r.team_name === teamName);
    if (!roster) return;

    let players = [...roster.players];

    const key = this._sortKey;
    players.sort((a, b) => {
      if (key === 'slot') {
        const ord = { Starter: 0, Taxi: 1, Bench: 2, IR: 3 };
        const sa = ord[a.slot] ?? 9, sb = ord[b.slot] ?? 9;
        if (sa !== sb) return sa - sb;
        return b.ktc_sf_value - a.ktc_sf_value;
      }
      const va = a[key] ?? '', vb = b[key] ?? '';
      if (typeof va === 'number') return va - vb;
      return String(va).localeCompare(String(vb));
    });

    const totalKtc = players.reduce((s, p) => s + (p.ktc_sf_value || 0), 0);
    document.getElementById('roster-total').textContent = `Total KTC (SF): ${totalKtc.toLocaleString()}`;

    const tbody = document.getElementById('roster-tbody');
    const starters = players.filter(p => p.slot === 'Starter');
    const bench    = players.filter(p => p.slot !== 'Starter');

    const rows = [];
    rows.push(this._sectionRow('— STARTERS —'));
    starters.forEach(p => rows.push(this._playerRow(p)));
    rows.push(this._sectionRow('— BENCH / TAXI / IR —'));
    bench.forEach(p => rows.push(this._playerRow(p)));

    tbody.innerHTML = rows.join('');
  },

  _sectionRow(label) {
    return `<tr class="section-header"><td colspan="7">${label}</td></tr>`;
  },

  _playerRow(p) {
    const pos = p.position;
    const posClass = `pos-${pos}`;
    const rowClass = `row-${pos}`;
    const flag = p.aging_flag ? '<span class="aging-flag">⚠</span>' : '';
    const ktcFmt = p.ktc_sf_value ? p.ktc_sf_value.toLocaleString() : '—';
    return `<tr class="${rowClass}">
      <td style="color:var(--text-muted);font-size:12px">${p.slot}</td>
      <td style="font-weight:500">${p.name}</td>
      <td><span class="pos-badge ${posClass}">${pos}</span></td>
      <td style="color:var(--text-muted)">${p.nfl_team}</td>
      <td>${p.age || '—'}</td>
      <td style="color:var(--accent);font-weight:600">${ktcFmt}</td>
      <td>${flag}</td>
    </tr>`;
  },
};
