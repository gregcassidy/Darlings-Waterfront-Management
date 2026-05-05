// app.js — Employee portal logic

const App = (() => {
  let concerts = [];
  let selections = [null, null, null, null, null]; // index 0 = rank 1
  let originalSelections = [null, null, null, null, null]; // snapshot at load — used to detect swaps
  let existingPrefs = [];
  let systemStatus = 'closed';   // open | limited | closed
  let effectiveMode = 'closed';  // user-specific: open | limited | closed
  let employeeProfile = null;

  const NEW_EMPLOYEE_GRACE_DAYS = 21;

  function computeEffectiveMode(status, profile) {
    if (profile?.canEditFreely) return 'open';
    if (!profile?.createdAt) return 'open'; // first-time user
    const ageMs = Date.now() - new Date(profile.createdAt).getTime();
    if (ageMs < NEW_EMPLOYEE_GRACE_DAYS * 24 * 60 * 60 * 1000) return 'open';
    return status;
  }

  async function init() {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    const user = Auth.getCurrentUser();
    if (user) {
      document.getElementById('userDisplay').textContent = user.name || user.email;
    }

    // Admins default to the admin dashboard unless they explicitly requested the employee view.
    const wantsEmployeeView = new URLSearchParams(window.location.search).get('view') === 'employee';
    if (!wantsEmployeeView) {
      try {
        const quickProfile = await Auth.apiRequest('/employees/me').catch(() => null);
        if (quickProfile?.role === 'admin') {
          window.location.replace('/admin.html');
          return;
        }
        employeeProfile = quickProfile;
      } catch (e) {}
    }

    // Load settings + concerts + existing preferences + profile in parallel
    // Also kick off Graph profile sync in background (fire-and-forget)
    Auth.fetchGraphProfile().then(gp => { if (gp) Auth.syncProfileToBackend(gp); });

    try {
      const [settings, concertsData, myPrefs, profile] = await Promise.all([
        Auth.apiRequest('/settings'),
        Auth.apiRequest('/concerts?season=2026'),
        Auth.apiRequest('/preferences/me'),
        employeeProfile ? Promise.resolve(employeeProfile) : Auth.apiRequest('/employees/me').catch(() => null),
      ]);

      systemStatus = settings?.submissionsStatus
        || (settings?.submissionsOpen === 'true' ? 'open' : 'closed');
      concerts = concertsData || [];
      employeeProfile = profile;
      effectiveMode = computeEffectiveMode(systemStatus, profile);

      // Pre-fill personal email if on file
      const emailInput = document.getElementById('personalEmail');
      if (profile?.personalEmail) {
        emailInput.value = profile.personalEmail;
        document.getElementById('emailBanner').classList.add('hidden');
      } else {
        document.getElementById('emailBanner').classList.remove('hidden');
      }

      // Show admin link based on role returned by /employees/me (sourced from authorizer context)
      if (profile?.role === 'admin') {
        document.getElementById('adminLink').classList.remove('hidden');
      }

      renderModeBanner();

      // Restore existing selections
      if (myPrefs?.preferences?.length > 0) {
        existingPrefs = myPrefs.preferences;
        for (const pref of existingPrefs) {
          if (pref.rank >= 1 && pref.rank <= 5) {
            selections[pref.rank - 1] = pref.concertId;
          }
        }
      }
      originalSelections = [...selections];

      renderPrefSlots();
      renderConcertList();
    } catch (err) {
      console.error('Failed to load app data:', err);
    }
  }

  function onPersonalEmailChange() {
    renderPrefSlots(); // re-evaluate submit button state
  }

  function renderModeBanner() {
    const banner = document.getElementById('closedBanner');
    if (effectiveMode === 'open' && systemStatus !== 'open') {
      // System is locked but this user is exempt (override or new-employee grace)
      const reason = employeeProfile?.canEditFreely
        ? 'an admin has granted you full edit access'
        : 'you joined recently and still have new-employee edit access';
      banner.classList.remove('alert-warning');
      banner.classList.add('alert-info');
      banner.innerHTML = `<strong>Submissions are ${systemStatus} for everyone else.</strong> You can edit freely because ${reason}.`;
      banner.classList.remove('hidden');
    } else if (effectiveMode === 'limited') {
      banner.classList.remove('alert-warning');
      banner.classList.add('alert-info');
      banner.innerHTML = `<strong>Limited swap mode.</strong> You can change one selection — remove an item and pick a replacement, then submit.`;
      banner.classList.remove('hidden');
    } else if (effectiveMode === 'closed') {
      banner.classList.add('alert-warning');
      banner.classList.remove('alert-info');
      banner.innerHTML = `<strong>Submissions are closed.</strong> The preference submission window is not currently open. You can view your previous selections below.`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  function diffSelections() {
    // Returns { added, removed, reordered } based on current vs original
    const oldSet = new Set(originalSelections.filter(Boolean));
    const newSet = new Set(selections.filter(Boolean));
    let added = 0, removed = 0;
    for (const id of newSet) if (!oldSet.has(id)) added++;
    for (const id of oldSet) if (!newSet.has(id)) removed++;
    let reordered = false;
    if (added === 0 && removed === 0) {
      for (let i = 0; i < 5; i++) {
        if (originalSelections[i] !== selections[i]) { reordered = true; break; }
      }
    }
    return { added, removed, reordered };
  }

  function hasInternalGap() {
    // True if there's a null between non-null entries (e.g., [A,null,C,...])
    let seenEmpty = false;
    for (let i = 0; i < 5; i++) {
      if (selections[i] === null) seenEmpty = true;
      else if (seenEmpty) return true;
    }
    return false;
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
    let submitDisabled = filled === 0 || !hasEmail || effectiveMode === 'closed';
    if (effectiveMode === 'limited') {
      const { added, removed, reordered } = diffSelections();
      if (added > 1 || removed > 1 || reordered || hasInternalGap()) submitDisabled = true;
    }
    submitBtn.disabled = submitDisabled;

    const editable = effectiveMode === 'open' || effectiveMode === 'limited';
    const lastFilled = filled - 1;
    container.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const concertId = selections[i];
      const concert = concertId ? concerts.find(c => c.concertId === concertId) : null;
      const isCancelled = concert?.status === 'cancelled';
      const slot = document.createElement('div');
      slot.className = `pref-slot${concert ? ' filled' : ''}`;
      // Reordering only allowed in open mode (limited mode is "swap one", no reorders)
      const canMoveUp   = concert && effectiveMode === 'open' && !isCancelled && i > 0;
      const canMoveDown = concert && effectiveMode === 'open' && !isCancelled && i < lastFilled;
      const canRemove   = concert && editable;
      const nameHtml = concert
        ? (isCancelled
            ? `<span style="text-decoration:line-through;color:var(--gray-500);">${concert.name}</span> <span class="badge badge-red" style="font-size:.65rem;">CANCELLED</span>`
            : concert.name)
        : '';
      const subHtml = concert
        ? (isCancelled
            ? `<span style="color:var(--red);font-weight:500;">Pick a replacement below</span>`
            : `${formatDate(concert.date)} &bull; ${concert.doorsTime}`)
        : '';
      const emptyMsg = editable ? 'Click a concert to add' : 'Empty';
      slot.innerHTML = `
        <div class="pref-rank">${i + 1}</div>
        ${concert ? `
          <div style="flex:1;overflow:hidden;">
            <div class="pref-concert-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nameHtml}</div>
            <div class="pref-concert-date">${subHtml}</div>
          </div>
          <div class="flex gap-1" style="flex-shrink:0;">
            <button class="btn btn-sm btn-outline" title="Move up"   onclick="App.movePick(${i},-1)" ${canMoveUp   ? '' : 'disabled'}>▲</button>
            <button class="btn btn-sm btn-outline" title="Move down" onclick="App.movePick(${i}, 1)" ${canMoveDown ? '' : 'disabled'}>▼</button>
            <button class="btn btn-sm btn-outline" title="Remove"    onclick="App.removePick(${i})" ${canRemove   ? '' : 'disabled'}>✕</button>
          </div>
        ` : `
          <span class="pref-slot-empty">${emptyMsg}</span>
        `}
      `;
      container.appendChild(slot);
    }
  }

  function movePick(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= 5) return;
    if (!selections[index]) return;
    // Swap — swapping with an empty slot is allowed only when moving down into an empty
    // (shouldn't happen given button disable logic, but guard anyway)
    const tmp = selections[index];
    selections[index] = selections[target];
    selections[target] = tmp;
    renderPrefSlots();
    renderConcertList();
  }

  function renderConcertList() {
    const container = document.getElementById('concertList');
    const loading = document.getElementById('concertListLoading');
    loading.classList.add('hidden');
    container.innerHTML = '';

    const visibleConcerts = concerts.filter(c => c.status !== 'cancelled');
    if (!visibleConcerts.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎵</div><h3>No concerts loaded</h3><p>Check back soon.</p></div>';
      return;
    }

    const hasGap = selections.includes(null);
    const canPickMore = effectiveMode === 'open'
      || (effectiveMode === 'limited' && hasGap);

    for (const concert of visibleConcerts) {
      const rank = selections.indexOf(concert.concertId);
      const isSelected = rank !== -1;
      const dateParts = parseDateParts(concert.date);
      const cardDisabled = !isSelected && !canPickMore;

      const card = document.createElement('div');
      card.className = `concert-card${isSelected ? ' selected' : ''}${cardDisabled ? ' disabled' : ''}`;
      if (cardDisabled) card.style.opacity = '0.45';
      card.setAttribute('data-id', concert.concertId);
      card.onclick = cardDisabled ? null : () => toggleConcert(concert.concertId);

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
    if (effectiveMode === 'closed') return;

    const existingRank = selections.indexOf(concertId);
    if (existingRank !== -1) {
      // Already selected — remove it
      selections[existingRank] = null;
      if (effectiveMode === 'open') {
        // Compact in open mode so empty slot moves to the end
        const compact = selections.filter(Boolean);
        for (let i = 0; i < 5; i++) selections[i] = compact[i] || null;
      }
      // In limited mode we leave the gap so the user can fill it with a replacement
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
    if (effectiveMode === 'open') {
      // Compact: shift remaining selections up to fill the gap
      const compact = selections.filter(Boolean);
      for (let i = 0; i < 5; i++) selections[i] = compact[i] || null;
    }
    // In limited mode the gap stays — user must replace the removed item to submit
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

  return { init, submitPreferences, removePick, movePick, loadMyTickets, onPersonalEmailChange, saveBannerEmail };
})();
