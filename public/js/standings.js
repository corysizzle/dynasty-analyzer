'use strict';
const StandingsView = {
  _state: null,
  _chart: null,
  _view: 'table',

  LABEL_CHIP: {
    Contender:  'chip chip-contender',
    Balanced:   'chip chip-balanced',
    Rebuilding: 'chip chip-rebuilding',
  },

  init(state) {
    this._state = state;
    this._render();

    document.getElementById('standings-table-btn').addEventListener('click', () => this._switchView('table'));
    document.getElementById('standings-chart-btn').addEventListener('click', () => this._switchView('chart'));
  },

  reload(state) { this._state = state; this._render(); },

  _switchView(view) {
    this._view = view;
    document.querySelectorAll('.toggle-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.getElementById('standings-table-view').style.display = view === 'table' ? 'flex' : 'none';
    document.getElementById('standings-chart-view').style.display = view === 'chart'  ? '' : 'none';
    if (view === 'chart') this._renderChart();
  },

  _render() {
    this._renderTable();
    if (this._view === 'chart') this._renderChart();
  },

  _renderTable() {
    const rankings = this._state.standings;
    const maxKtc   = Math.max(...rankings.map(r => r.ktc_total), 1);

    const rows = rankings.map(r => {
      const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
      const rank   = medals[r.rank] || r.rank;
      const record = `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`;
      const isMyTeam = App.isMyTeam(r.team_name);
      const rowClass  = isMyTeam ? 'my-team-row' : '';
      const nameClass = isMyTeam ? 'my-team' : '';
      const chip  = this.LABEL_CHIP[r.label] || 'chip';
      const barW  = Math.round((r.ktc_total / maxKtc) * 80);
      const dynColor = r.dynasty_score >= 60 ? 'var(--green)' : r.dynasty_score >= 45 ? 'var(--yellow)' : 'var(--red)';

      return `<tr class="${rowClass}">
        <td style="font-size:15px">${rank}</td>
        <td class="${nameClass}" style="font-weight:500">${r.team_name}</td>
        <td style="color:var(--text-muted)">${record}</td>
        <td style="color:var(--text-muted)">${r.fpts.toFixed(1)}</td>
        <td style="color:var(--text-muted)">${r.fpts_against.toFixed(1)}</td>
        <td>
          <div class="ktc-bar-cell">
            <div class="ktc-bar-fill" style="width:${barW}px"></div>
            <span class="ktc-bar-label">${r.ktc_total.toLocaleString()}</span>
          </div>
        </td>
        <td style="color:var(--green)">${r.age_score}</td>
        <td style="color:${dynColor};font-weight:700;font-size:15px">${r.dynasty_score}</td>
        <td><span class="${chip}">${r.label}</span></td>
      </tr>`;
    });

    document.getElementById('standings-tbody').innerHTML = rows.join('');
  },

  _renderChart() {
    const rankings = [...this._state.standings].reverse(); // bottom to top for horizontal bar
    const canvas   = document.getElementById('standings-chart');

    if (this._chart) { this._chart.destroy(); }

    const LABEL_COLOR = { Contender: '#66bb6a', Balanced: '#ffa726', Rebuilding: '#ef5350' };
    const colors = rankings.map(r => LABEL_COLOR[r.label] || '#888');
    const borders = rankings.map(r => App.isMyTeam(r.team_name) ? '#ffd700' : 'transparent');
    const widths  = rankings.map(r => App.isMyTeam(r.team_name) ? 2.5 : 0);

    this._chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: rankings.map(r => r.team_name),
        datasets: [{
          data: rankings.map(r => r.dynasty_score),
          backgroundColor: colors.map(c => c + 'cc'),
          borderColor: borders,
          borderWidth: widths,
          label: 'Dynasty Score',
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: ctx => {
                const r = rankings[ctx.dataIndex];
                return [`KTC: ${r.ktc_total.toLocaleString()}`, `Age: ${r.age_score}`, r.label];
              },
            },
          },
        },
        scales: {
          x: {
            min: 0, max: 100,
            ticks: { color: '#7777aa', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ticks: { color: '#c0c0e0', font: { size: 11 } },
            grid: { display: false },
          },
        },
      },
    });
  },
};
