// app.js — Employee portal logic

const App = (() => {
  let concerts = [];
  let selections = [null, null, null, null, null]; // index 0 = rank 1
  let existingPrefs = [];
  let submissionsOpen = false;
  let employeeProfile = null;

  async function init() {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    const user = Auth.getCurrentUser();
    if (user) {
      document.getElementById('userDisplay').textContent = user.name || user.email;
    }

    // Load settings + concerts + existing preferences + profile in parallel
    // Also kick off Graph profile sync in background (fire-and-forget)
    Auth.fetchGraphProfile().then(gp => { if (gp) Auth.syncProfileToBackend(gp); });

    try {
      const [settings, concertsData, myPrefs, profile] = await Promise.all([
        Auth.apiRequest('/settings'),
        Auth.apiRequest('/concerts?season=2026'),
        Auth.apiRequest('/preferences/me'),
        Auth.apiRequest('/employees/me').catch(() => null),
      ]);

      submissionsOpen = settings?.submissionsOpen === 'true';
      concerts = concertsData || [];
      employeeProfile = profile;

      // Pre-fill personal email if on file
      const emailInput = document.getElementById('personalEmail');
      if (profile?.personalEmail) {
        emailInput.value = profile.personalEmail;
        document.getElementById('emailBanner').classList.add('hidden');
      } else {
        document.getElementById('emailBanner').classList.remove('hidden');
      }

      // Show admin link if user has admin role (check via API response behaviour)
      // Admin link is shown based on whether GET /preferences returns all employees
      // Instead, we check if user can access /preferences (returns all) vs /preferences/me
      // Simple approach: call /preferences?season=2026 and check if we get array of all prefs
      try {
        const allPrefs = await Auth.apiRequest('/preferences?season=2026');
        if (Array.isArray(allPrefs)) {
          document.getElementById('adminLink').classList.remove('hidden');
        }
      } catch (e) { /* not admin */ }

      if (!submissionsOpen) {
        document.getElementById('closedBanner').classList.remove('hidden');
      }

      // Restore existing selections
      if (myPrefs?.preferences?.length > 0) {
        existingPrefs = myPrefs.preferences;
        for (const pref of existingPrefs) {
          if (pref.rank >= 1 && pref.rank <= 5) {
            selections[pref.rank - 1] = pref.concertId;
          }
        }
      }

      renderPrefSlots();
      renderConcertList();
    } catch (err) {
      console.error('Failed to load app data:', err);
    }
  }

  function onPersonalEmailChange() {
    renderPrefSlots(); // re-evaluate submit button state
  }

  function renderPrefSlots() {
    const container = document.getElementById('prefSlots');
    const filled = selections.filter(Boolean).length;
    document.getElementById('selectionCount').textContent = `${filled} / 5`;
    document.getElementById('selectionCount').className = filled === 5
      ? 'badge badge-green' : 'badge badge-gray';

    const emailVal = (document.getElementById('personalEmail')?.value || '').trim();
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal);

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = filled === 0 || !submissionsOpen || !hasEmail;

    container.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const concertId = selections[i];
      const concert = concertId ? concerts.find(c => c.concertId === concertId) : null;
      const slot = document.createElement('div');
      slot.className = `pref-slot${concert ? ' filled' : ''}`;
      slot.innerHTML = `
        <div class="pref-rank">${i + 1}</div>
        ${concert ? `
          <div style="flex:1;overflow:hidden;">
            <div class="pref-concert-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${concert.name}</div>
            <div class="pref-concert-date">${formatDate(concert.date)} &bull; ${concert.doorsTime}</div>
          </div>
          <button class="btn btn-sm btn-outline" onclick="App.removePick(${i})" ${!submissionsOpen ? 'disabled' : ''}>✕</button>
        ` : `
          <span class="pref-slot-empty">Click a concert to add</span>
        `}
      `;
      container.appendChild(slot);
    }
  }

  function renderConcertList() {
    const container = document.getElementById('concertList');
    const loading = document.getElementById('concertListLoading');
    loading.classList.add('hidden');
    container.innerHTML = '';

    if (!concerts.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎵</div><h3>No concerts loaded</h3><p>Check back soon.</p></div>';
      return;
    }

    for (const concert of concerts) {
      const rank = selections.indexOf(concert.concertId);
      const isSelected = rank !== -1;
      const dateParts = parseDateParts(concert.date);

      const card = document.createElement('div');
      card.className = `concert-card${isSelected ? ' selected' : ''}`;
      card.setAttribute('data-id', concert.concertId);
      card.onclick = () => toggleConcert(concert.concertId);

      card.innerHTML = `
        <div class="concert-date-badge">
          <span class="month">${dateParts.month}</span>
          <span class="day-num">${dateParts.day}</span>
        </div>
        <div class="concert-info">
          <div class="concert-name">${concert.name}</div>
          <div class="concert-sub">${concert.day} &bull; Doors ${concert.doorsTime}</div>
        </div>
        ${isSelected
          ? `<div class="concert-rank-badge">#${rank + 1}</div>`
          : `<div style="color:var(--gray-300);font-size:1.25rem;padding:.25rem;">+</div>`
        }
      `;
      container.appendChild(card);
    }
  }

  function toggleConcert(concertId) {
    if (!submissionsOpen) return;

    const existingRank = selections.indexOf(concertId);
    if (existingRank !== -1) {
      // Already selected — remove it
      selections[existingRank] = null;
    } else {
      // Add to first empty slot
      const emptySlot = selections.indexOf(null);
      if (emptySlot === -1) return; // All 5 slots full — ignore
      selections[emptySlot] = concertId;
    }

    renderPrefSlots();
    renderConcertList();
  }

  function removePick(index) {
    selections[index] = null;
    // Compact: shift remaining selections up to fill the gap
    const compact = selections.filter(Boolean);
    for (let i = 0; i < 5; i++) {
      selections[i] = compact[i] || null;
    }
    renderPrefSlots();
    renderConcertList();
  }

  async function submitPreferences() {
    const filled = selections.filter(Boolean);
    if (!filled.length) return;

    const btn = document.getElementById('submitBtn');
    const msg = document.getElementById('submitMsg');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    msg.textContent = '';

    const personalEmail = document.getElementById('personalEmail').value.trim().toLowerCase();
    if (!personalEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
      msg.style.color = 'var(--red)';
      msg.textContent = '✗ Please enter a valid personal email address.';
      btn.disabled = false;
      btn.textContent = 'Submit Preferences';
      return;
    }

    // Collect latest Graph profile to send with submission
    const graphProfile = await Auth.fetchGraphProfile().catch(() => null);

    const payload = {
      preferences: filled.map((concertId, idx) => ({ rank: idx + 1, concertId })),
      personalEmail,
      profile: graphProfile || {},
    };

    try {
      await Auth.apiRequest('/preferences', { method: 'POST', body: JSON.stringify(payload) });
      msg.style.color = 'var(--green)';
      msg.textContent = '✓ Preferences saved successfully!';
      btn.textContent = 'Submit Preferences';
      btn.disabled = false;
    } catch (err) {
      msg.style.color = 'var(--red)';
      msg.textContent = '✗ ' + err.message;
      btn.textContent = 'Submit Preferences';
      btn.disabled = false;
    }
  }

  async function saveBannerEmail() {
    const input = document.getElementById('bannerPersonalEmail');
    const msg = document.getElementById('bannerEmailMsg');
    const email = (input.value || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Please enter a valid email.';
      return;
    }
    try {
      await Auth.apiRequest('/employees/me', {
        method: 'PUT',
        body: JSON.stringify({ personalEmail: email }),
      });
      document.getElementById('personalEmail').value = email;
      document.getElementById('emailBanner').classList.add('hidden');
      renderPrefSlots();
    } catch (e) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Failed to save: ' + e.message;
    }
  }

  async function loadMyTickets() {
    const container = document.getElementById('ticketsList');
    const loading = document.getElementById('ticketsLoading');
    container.innerHTML = '';
    loading.classList.remove('hidden');

    try {
      const assignments = await Auth.apiRequest('/assignments/me');
      loading.classList.add('hidden');

      if (!assignments || !assignments.length) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🎟️</div>
            <h3>No tickets assigned yet</h3>
            <p>Submit your preferences and the admin will assign tickets when the season is ready.</p>
          </div>`;
        return;
      }

      // Sort by concert date
      assignments.sort((a, b) => {
        const da = a.concert?.date || '';
        const db = b.concert?.date || '';
        return da.localeCompare(db);
      });

      container.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Concert</th>
                <th>Date</th>
                <th>Ticket Type</th>
                <th>Slot</th>
                <th>Attended</th>
              </tr>
            </thead>
            <tbody>
              ${assignments.map(a => `
                <tr>
                  <td class="font-medium">${a.concert?.name || a.concertId}</td>
                  <td>${a.concert ? formatDate(a.concert.date) : '—'}</td>
                  <td>${slotTypeLabel(a.slotType)}</td>
                  <td>#${a.slotNumber}</td>
                  <td>${a.attended
                    ? '<span class="badge badge-green">Yes</span>'
                    : '<span class="badge badge-gray">—</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      loading.classList.add('hidden');
      container.innerHTML = `<div class="alert alert-error">Failed to load tickets: ${err.message}</div>`;
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  function parseDateParts(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return {
      month: d.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
      day: d.getDate(),
    };
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function slotTypeLabel(t) {
    const labels = { suite: 'Suite Ticket', club: 'Club Ticket', bsbParking: 'BSB Parking', suiteParking: 'Suite Parking' };
    return labels[t] || t;
  }

  return { init, submitPreferences, removePick, loadMyTickets, onPersonalEmailChange, saveBannerEmail };
})();
