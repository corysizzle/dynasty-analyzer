'use strict';
const AgeView = {
  _state: null,
  _mode: 'bar',
  _charts: {},
  _highlight: '',

  POSITIONS: ['QB', 'RB', 'WR', 'TE'],
  THRESHOLDS: { QB: 35, RB: 28, WR: 30, TE: 32 },
  IDEAL: { QB: 27, RB: 24, WR: 25, TE: 26 },
  POS_COLORS: { QB: '#ef5350', RB: '#66bb6a', WR: '#42a5f5', TE: '#ffa726' },

  init(state) {
    this._state = state;
    this._populateTeams();

    document.getElementById('age-team-select').addEventListener('change', e => {
      this._highlight = e.target.value;
      this._render();
    });

    document.querySelectorAll('.toggle-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._mode = btn.dataset.mode;
        this._render();
      });
    });

    this._render();
  },

  reload(state) { this._state = state; this._populateTeams(); this._render(); },

  _populateTeams() {
    const sel = document.getElementById('age-team-select');
    const names = this._state.ageData.map(d => d.team_name).sort();
    sel.innerHTML = ['(All teams)', ...names]
      .map(n => `<option value="${n}" ${n === 'Thomas the Tank Engine' ? 'selected' : ''}>${n}</option>`).join('');
    this._highlight = 'Thomas the Tank Engine';
  },

  _ageColor(age, pos) {
    if (!age) return 'rgba(80,80,80,0.6)';
    const ideal   = this.IDEAL[pos]      || 25;
    const danger  = this.THRESHOLDS[pos] || 30;
    const t = Math.max(0, Math.min(1, (age - ideal) / (danger - ideal)));
    const r = Math.round(Math.min(255, t * 2 * 255));
    const g = Math.round(Math.min(255, (1 - t) * 2 * 255));
    return `rgba(${r},${g},30,0.85)`;
  },

  _render() {
    const barContainer  = document.getElementById('age-bar-container');
    const heatContainer = document.getElementById('age-heatmap-container');

    if (this._mode === 'bar') {
      barContainer.style.display  = 'grid';
      heatContainer.style.display = 'none';
      this._renderBarCharts();
    } else {
      barContainer.style.display  = 'none';
      heatContainer.style.display = '';
      this._renderHeatmap();
    }
  },

  _renderBarCharts() {
    const data = this._state.ageData;
    const hl   = this._highlight;

    for (const pos of this.POSITIONS) {
      const canvasId = `chart-${pos.toLowerCase()}`;
      const canvas   = document.getElementById(canvasId);
      if (!canvas) continue;

      if (this._charts[pos]) { this._charts[pos].destroy(); }

      const teams = data.map(d => d.team_name);
      const ages  = data.map(d => d.profile[pos] || 0);
      const valid = ages.filter(a => a > 0);
      const leagueAvg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
      const danger = this.THRESHOLDS[pos];
      const maxY = Math.max(danger + 4, ...ages) + 1;

      const barColors = data.map((d, i) => {
        const age   = d.profile[pos] || 0;
        const color = this._ageColor(age, pos);
        if (hl !== '(All teams)' && d.team_name !== hl) return color.replace('0.85)', '0.25)');
        return color;
      });

      const borderColors = data.map(d =>
        d.team_name === hl && hl !== '(All teams)' ? '#ffd700' : 'transparent'
      );
      const borderWidths = data.map(d =>
        d.team_name === hl && hl !== '(All teams)' ? 2 : 0
      );

      const shortNames = teams.map(t => t.split(' ')[0].slice(0, 7));

      this._charts[pos] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: shortNames,
          datasets: [
            {
              type: 'bar',
              data: ages,
              backgroundColor: barColors,
              borderColor: borderColors,
              borderWidth: borderWidths,
              label: 'Weighted Avg Age',
            },
            {
              type: 'line',
              data: Array(teams.length).fill(leagueAvg),
              borderColor: '#64b5f6',
              borderWidth: 1.5,
              borderDash: [5, 4],
              pointRadius: 0,
              label: `Avg ${leagueAvg.toFixed(1)}`,
            },
            {
              type: 'line',
              data: Array(teams.length).fill(danger),
              borderColor: '#ef535088',
              borderWidth: 1,
              borderDash: [3, 3],
              pointRadius: 0,
              label: `⚠ ${danger}`,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: {
              labels: { color: '#8888aa', font: { size: 10 }, boxWidth: 12 },
            },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${typeof ctx.raw === 'number' ? ctx.raw.toFixed(1) : ctx.raw}`,
              },
            },
          },
          scales: {
            x: {
              ticks: { color: '#7777aa', font: { size: 9 }, maxRotation: 45 },
              grid: { color: 'rgba(255,255,255,0.04)' },
            },
            y: {
              min: 20, max: maxY,
              ticks: { color: '#7777aa', font: { size: 9 } },
              grid: { color: 'rgba(255,255,255,0.04)' },
            },
          },
        },
      });
    }
  },

  _renderHeatmap() {
    const data = this._state.ageData;
    const hl   = this._highlight;
    const table = document.getElementById('age-heatmap-table');

    const header = `<thead><tr>
      <th style="text-align:right">Team</th>
      ${this.POSITIONS.map(p => `<th style="color:${this.POS_COLORS[p]}">${p}</th>`).join('')}
    </tr></thead>`;

    // Normalise per column for color intensity
    const matrices = {};
    for (const pos of this.POSITIONS) {
      const vals = data.map(d => d.profile[pos] || 0);
      const mn = Math.min(...vals.filter(v => v)), mx = Math.max(...vals.filter(v => v));
      matrices[pos] = data.map(d => {
        const v = d.profile[pos] || 0;
        return v ? (mx > mn ? (v - mn) / (mx - mn) : 0.5) : null;
      });
    }

    const rows = data.map((d, i) => {
      const isHl = hl !== '(All teams)' && d.team_name === hl;
      const cells = this.POSITIONS.map((pos, j) => {
        const norm = matrices[pos][i];
        const raw  = d.profile[pos];
        if (norm === null) return `<td style="background:rgba(30,30,50,0.4);color:#555">—</td>`;
        const t = norm;
        const r = Math.round(Math.min(255, t * 2 * 255));
        const g = Math.round(Math.min(255, (1 - t) * 2 * 255));
        const bg = `rgba(${r},${g},30,0.5)`;
        const txt = raw ? raw.toFixed(1) : '—';
        return `<td style="background:${bg};color:${t > 0.6 ? '#fff' : '#000'}" ${isHl ? 'class="heatmap-hl"' : ''}>${txt}</td>`;
      }).join('');
      const nameStyle = isHl ? 'color:var(--gold);font-weight:700' : '';
      return `<tr><td class="team-cell" style="${nameStyle}">${d.team_name}</td>${cells}</tr>`;
    });

    table.innerHTML = header + `<tbody>${rows.join('')}</tbody>`;
  },
};
