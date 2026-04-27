'use strict';
const PicksView = {
  _state: null,

  YEARS:  ['2026', '2027', '2028'],
  ROUNDS: ['1', '2', '3'],
  ROUND_CLASS: { '1': 'picks-r1', '2': 'picks-r2', '3': 'picks-r3' },

  init(state) {
    this._state = state;
    this._render();
    document.getElementById('picks-tier-select').addEventListener('change', () => this._reload());
    document.getElementById('picks-sort-select').addEventListener('change', () => this._render());
  },

  reload(state) { this._state = state; this._reload(); },

  async _reload() {
    const tier = document.getElementById('picks-tier-select').value;
    try {
      const data = await App.api(`/api/picks?tier=${tier}`);
      this._state.picks     = data.picks;
      this._state.picksMeta = data.rosterMeta;
      this._render();
    } catch (e) { App.toast(`Picks error: ${e.message}`, 'error'); }
  },

  _render() {
    this._buildHeader();
    this._buildRows();
  },

  _buildHeader() {
    const tr = document.querySelector('#picks-thead tr');
    const cells = [
      '<th style="width:45px">Rank</th>',
      '<th style="width:200px">Team</th>',
      ...this.YEARS.flatMap(y => this.ROUNDS.map(r => `<th style="width:65px;color:${this._roundColor(r)}">${y} R${r}</th>`)),
      '<th style="width:65px"># Picks</th>',
      '<th style="width:90px">Total KTC</th>',
    ];
    tr.innerHTML = cells.join('');
  },

  _roundColor(r) { return { '1': '#ff8a80', '2': '#ffd180', '3': '#b9f6ca' }[r]; },

  _buildRows() {
    const sort = document.getElementById('picks-sort-select').value;
    const meta = [...this._state.picksMeta];
    meta.sort((a, b) => {
      if (sort === 'total_ktc')  return b.total_ktc - a.total_ktc;
      if (sort === 'num_picks')  return b.num_picks - a.num_picks;
      return a.team_name.localeCompare(b.team_name);
    });

    const maxKtc = Math.max(...meta.map(m => m.total_ktc), 1);

    const rows = meta.map((team, i) => {
      const picks = this._state.picks[team.roster_id] || [];
      const grid  = {};
      for (const p of picks) {
        const key = `${p.year}-${p.round}`;
        (grid[key] = grid[key] || []).push(p);
      }

      const isMyTeam  = App.isMyTeam(team.team_name);
      const rowClass  = isMyTeam ? 'my-team-row' : (i % 2 === 0 ? '' : 'alt-row');
      const nameClass = isMyTeam ? 'my-team' : '';

      const cells = this.YEARS.flatMap(y => this.ROUNDS.map(r => {
        const key    = `${y}-${r}`;
        const cellPs = grid[key] || [];
        if (!cellPs.length) return `<td><span class="picks-cell empty">—</span></td>`;
        const cls  = this.ROUND_CLASS[r];
        const disp = cellPs.map(p => {
          const isOwn = p.original_owner_id === team.roster_id;
          return isOwn ? 'Own' : p.original_team.split(' ')[0].slice(0, 5);
        }).join(', ');
        return `<td><span class="picks-cell ${cls}" title="${cellPs.map(p=>p.original_team).join(', ')}">${disp}</span></td>`;
      }));

      const numColor = team.num_picks >= 7 ? 'pick-rich' : team.num_picks >= 5 ? 'pick-mid' : 'pick-poor';
      const pct = team.total_ktc / maxKtc;
      const barW = Math.round(pct * 70);

      return `<tr class="${rowClass}" style="background:var(--bg-card)">
        <td style="color:var(--text-dim)">${i + 1}</td>
        <td class="${nameClass}">${team.team_name}</td>
        ${cells.join('')}
        <td class="${numColor}" style="text-align:center;font-weight:700">${team.num_picks}</td>
        <td>
          <div class="ktc-bar-cell">
            <div class="ktc-bar-fill" style="width:${barW}px"></div>
            <span class="ktc-bar-label">${team.total_ktc.toLocaleString()}</span>
          </div>
        </td>
      </tr>`;
    });

    document.getElementById('picks-tbody').innerHTML = rows.join('');
  },
};
