/* Main application controller */
'use strict';

const MY_TEAM = 'Thomas the Tank Engine';

const App = {
  state: { rosters: [], picks: {}, picksMeta: [], standings: [], ageData: [], loading: false },

  async init() {
    this.bindTabs();
    this.bindHeader();

    this.setLoadingText('Fetching rosters & KTC values…', 20);
    try {
      const [rosters, picks, standings, ageData] = await Promise.all([
        this.api('/api/rosters'),
        this.api('/api/picks'),
        this.api('/api/standings'),
        this.api('/api/age'),
      ]);

      this.state.rosters    = rosters;
      this.state.picks      = picks.picks;
      this.state.picksMeta  = picks.rosterMeta;
      this.state.standings  = standings;
      this.state.ageData    = ageData;

      this.setLoadingText('Rendering…', 90);

      RosterView.init(this.state);
      AgeView.init(this.state);
      PicksView.init(this.state);
      TradeView.init(this.state);
      StandingsView.init(this.state);

      this.hideLoading();
      this.setStatus('Ready', new Date().toLocaleTimeString());

    } catch (err) {
      this.setLoadingText(`Error: ${err.message}`, 0);
      this.setStatus(`Error: ${err.message}`);
    }
  },

  async api(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      });
    });
  },

  bindHeader() {
    document.getElementById('refresh-btn').addEventListener('click', async () => {
      const btn = document.getElementById('refresh-btn');
      btn.textContent = '⏳ Refreshing…';
      btn.disabled = true;
      this.setStatus('Refreshing data…');
      try {
        await this.api('/api/refresh', { method: 'POST' });
        const [rosters, picks, standings, ageData] = await Promise.all([
          this.api('/api/rosters'),
          this.api('/api/picks'),
          this.api('/api/standings'),
          this.api('/api/age'),
        ]);
        this.state.rosters    = rosters;
        this.state.picks      = picks.picks;
        this.state.picksMeta  = picks.rosterMeta;
        this.state.standings  = standings;
        this.state.ageData    = ageData;

        RosterView.reload(this.state);
        AgeView.reload(this.state);
        PicksView.reload(this.state);
        StandingsView.reload(this.state);
        TradeView.reload(this.state);

        this.setStatus('Data refreshed', new Date().toLocaleTimeString());
        App.toast('Data refreshed successfully');
      } catch (err) {
        this.setStatus(`Refresh failed: ${err.message}`);
        App.toast(`Refresh failed: ${err.message}`, 'error');
      } finally {
        btn.textContent = '↻ Refresh';
        btn.disabled = false;
      }
    });

    document.getElementById('ktc-csv-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      try {
        const result = await fetch('/api/ktc/csv', { method: 'POST', body: form });
        const data = await result.json();
        if (data.error) throw new Error(data.error);
        App.toast(`KTC values imported (${data.count} players)`);
        document.getElementById('refresh-btn').click();
      } catch (err) {
        App.toast(`CSV import failed: ${err.message}`, 'error');
      }
      e.target.value = '';
    });
  },

  setLoadingText(msg, pct) {
    document.getElementById('loading-text').textContent = msg;
    document.getElementById('loading-fill').style.width = pct + '%';
  },

  hideLoading() {
    const el = document.getElementById('loading-overlay');
    el.classList.add('hidden');
    setTimeout(() => el.remove(), 500);
  },

  setStatus(msg, time) {
    document.getElementById('status-text').textContent = msg;
    if (time) document.getElementById('last-updated').textContent = `Updated: ${time}`;
  },

  toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.borderColor = type === 'error' ? 'rgba(239,83,80,0.4)' : 'rgba(79,195,247,0.3)';
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3000);
  },

  isMyTeam(name) {
    return name && name.toLowerCase().includes('thomas');
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
