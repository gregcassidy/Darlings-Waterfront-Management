// admin.js — Admin portal logic

const Admin = (() => {
  let concerts = [];
  let allGuests = [];
  let currentConcert = null;
  let currentDetail = null; // { concert, slotGrids, requests }
  let pendingSlot = null;   // { slotType, slotNumber } for assign modal
  let editingGuestId = null;
  let assigningGuest = null;       // guest being assigned via guestAssignModal
  let guestAssignDetail = null;    // concert detail currently loaded in modal
  let currentEmployeeMap = {};     // userId → employee profile, populated when concert detail loads

  // ── Init ──────────────────────────────────────────────────

  async function init() {
    const ok = await Auth.requireAuth();
    if (!ok) return;
    const user = Auth.getCurrentUser();
    if (user) document.getElementById('userDisplay').textContent = user.name || user.email;
    loadConcerts();
  }

  function showTab(name, btn) {
    ['concerts', 'guests', 'settings'].forEach(t => {
      document.getElementById(`tab-${t}`).classList.add('hidden');
      document.getElementById(`tab-${t}-btn`).classList.remove('active');
    });
    document.getElementById(`tab-${name}`).classList.remove('hidden');
    btn.classList.add('active');

    if (name === 'guests') loadGuests();
    if (name === 'settings') loadSettings();
  }

  // ── Concert List ──────────────────────────────────────────

  async function loadConcerts() {
    try {
      const data = await Auth.apiRequest('/concerts?season=2026');
      concerts = data || [];

      // Load tallies for each concert from preferences
      let prefs = [];
      try { prefs = await Auth.apiRequest('/preferences?season=2026') || []; } catch (e) {}

      const tallyMap = buildTallyMap(prefs);
      renderConcertTable(tallyMap);
    } catch (err) {
      document.getElementById('concertListLoading').innerHTML =
        `<div class="alert alert-error">Failed to load concerts: ${err.message}</div>`;
    }
  }

  function buildTallyMap(prefs) {
    const map = {};
    for (const pref of prefs) {
      for (const choice of (pref.preferences || [])) {
        if (!map[choice.concertId]) map[choice.concertId] = {1:0,2:0,3:0,4:0,5:0};
        map[choice.concertId][choice.rank] = (map[choice.concertId][choice.rank] || 0) + 1;
      }
    }
    return map;
  }

  function renderConcertTable(tallyMap) {
    document.getElementById('concertListLoading').classList.add('hidden');
    document.getElementById('concertListWrap').classList.remove('hidden');

    const tbody = document.getElementById('concertTableBody');
    tbody.innerHTML = '';

    if (!concerts.length) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--gray-400);">
        No concerts loaded. Click "Seed 2026 Data" to get started.</td></tr>`;
      return;
    }

    for (const c of concerts) {
      const t = tallyMap[c.concertId] || {};
      const tr = document.createElement('tr');
      tr.className = 'tr-clickable';
      tr.onclick = () => openConcertDetail(c.concertId);
      tr.innerHTML = `
        <td>${c.showNumber}</td>
        <td>${c.name}</td>
        <td>${formatDate(c.date)}</td>
        <td>${c.day}</td>
        <td>${c.hotelRooms ? `<span class="badge badge-amber">${c.hotelRooms} rooms</span>` : '<span class="text-muted text-xs">—</span>'}</td>
        <td class="tally-cell"><span class="tally-num">${t[1]||0}</span></td>
        <td class="tally-cell"><span class="tally-num">${t[2]||0}</span></td>
        <td class="tally-cell"><span class="tally-num">${t[3]||0}</span></td>
        <td class="tally-cell"><span class="tally-num">${t[4]||0}</span></td>
        <td class="tally-cell"><span class="tally-num">${t[5]||0}</span></td>
        <td><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();Admin.openConcertDetail('${c.concertId}')">Manage →</button></td>
      `;
      tbody.appendChild(tr);
    }
  }

  function showList() {
    document.getElementById('view-list').classList.remove('hidden');
    document.getElementById('view-detail').classList.add('hidden');
    currentConcert = null;
    loadConcerts();
  }

  async function openConcertDetail(concertId) {
    currentConcert = concertId;
    document.getElementById('view-list').classList.add('hidden');
    document.getElementById('view-detail').classList.remove('hidden');

    document.getElementById('detailHeader').innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
    document.getElementById('slotGrids').innerHTML = '';
    document.getElementById('requestsList').innerHTML = '';

    try {
      const data = await Auth.apiRequest(`/assignments/concert/${concertId}`);
      currentDetail = data;
      await renderConcertDetail(data);
    } catch (err) {
      document.getElementById('detailHeader').innerHTML =
        `<div class="alert alert-error">Failed to load concert detail: ${err.message}</div>`;
    }
  }

  async function renderConcertDetail(data) {
    const c = data.concert;

    // Header card
    document.getElementById('detailHeader').innerHTML = `
      <div style="display:flex;gap:1.5rem;align-items:flex-start;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <h2 style="margin-bottom:.25rem;">${c.name}</h2>
          <p style="font-size:.9rem;">${c.day}, ${formatDate(c.date)} &bull; ${c.venue || 'Maine Savings Amphitheater'}</p>
          ${c.doorsTime ? `<p class="text-sm text-muted mt-1">Doors: ${c.doorsTime} &bull; Music: ${c.musicTime}</p>` : ''}
        </div>
        ${c.hotelRooms ? `
          <div style="background:var(--amber-pale);border:1px solid var(--amber);border-radius:var(--radius);padding:.75rem 1rem;">
            <div class="font-bold text-sm" style="color:var(--amber);">🏨 Hotel: ${c.hotelRooms} rooms</div>
            ${c.hotelNotes ? `<div class="text-xs text-muted mt-1">${c.hotelNotes}</div>` : ''}
          </div>` : ''}
      </div>`;

    // Slot config view
    renderSlotConfigView(c);

    // Requests
    const requests = data.requests || [];
    document.getElementById('requestCount').textContent = requests.length;
    // Enrich requests with employee profile data
    let employeeMap = {};
    try {
      const employees = await Auth.apiRequest('/employees') || [];
      for (const e of employees) employeeMap[e.userId] = e;
    } catch (e) {}

    const reqContainer = document.getElementById('requestsList');
    if (!requests.length) {
      reqContainer.innerHTML = '<p class="text-sm text-muted" style="padding:.5rem 0;">No employee requests yet.</p>';
    } else {
      // Build map: userId → assigned slot for employees already given a ticket
      const assignedMap = {};
      for (const [slotType, slots] of Object.entries(data.slotGrids || {})) {
        for (const slot of slots) {
          if (slot.userId) assignedMap[slot.userId] = { slotType, slotNumber: slot.slotNumber };
        }
      }
      const hasOpenClub  = (data.slotGrids?.club  || []).some(s => !s.assignmentId);
      const hasOpenSuite = (data.slotGrids?.suite || []).some(s => !s.assignmentId);

      // Group requests by rank
      const byRank = {};
      for (const r of requests) {
        (byRank[r.rank] = byRank[r.rank] || []).push(r);
      }
      const rankLabels = ['','1st Choice','2nd Choice','3rd Choice','4th Choice','5th Choice'];

      reqContainer.innerHTML = Object.keys(byRank).sort((a,b) => a-b).map(rank => {
        const group = byRank[rank];
        return `
          <div class="request-group">
            <div class="request-group-header">
              <span>${rankLabels[rank] || `Choice #${rank}`}</span>
              <span class="badge badge-gray">${group.length}</span>
            </div>
            ${group.map(r => {
              const isExternal = r.submissionType === 'external';
              const profile = employeeMap[r.userId] || {};
              const details = isExternal
                ? [r.location, r.phone].filter(Boolean).join(' · ')
                : [profile.jobTitle, profile.officeLocation].filter(Boolean).join(' · ');
              const email = isExternal ? (r.email || '') : (profile.personalEmail || r.email || '');
              const assigned = assignedMap[r.userId];
              const rowClass = assigned
                ? (assigned.slotType === 'club' ? ' request-assigned-club' : ' request-assigned-suite')
                : '';
              const externalBadge = isExternal
                ? ` <span class="badge badge-gray" style="font-size:.7rem;">External</span>` : '';
              const actionHtml = assigned
                ? `<span class="badge ${assigned.slotType === 'club' ? 'badge-green' : 'badge-blue'}" style="flex-shrink:0;">
                     ${assigned.slotType === 'club' ? 'Club' : 'Suite'} #${assigned.slotNumber}
                   </span>`
                : `<div class="flex gap-1" style="flex-shrink:0;">
                     ${hasOpenClub  ? `<button class="btn btn-sm btn-success" onclick="Admin.quickAssign('${r.userId}','${escapeAttr(r.name)}','${escapeAttr(email)}','club')">+ Club</button>`  : ''}
                     ${hasOpenSuite ? `<button class="btn btn-sm btn-primary" onclick="Admin.quickAssign('${r.userId}','${escapeAttr(r.name)}','${escapeAttr(email)}','suite')">+ Suite</button>` : ''}
                   </div>`;
              return `
                <div class="request-row${rowClass}">
                  <div style="flex:1;overflow:hidden;">
                    <div class="font-medium text-sm">${r.name || ''}${externalBadge}</div>
                    ${details ? `<div class="text-xs text-muted">${details}</div>` : ''}
                  </div>
                  ${actionHtml}
                </div>`;
            }).join('')}
          </div>`;
      }).join('');
    }

    // Slot grids
    currentEmployeeMap = employeeMap;
    renderAllSlotGrids(data.slotGrids, c, employeeMap);
  }

  // ── Email export ──────────────────────────────────────────

  const SECTION_LABELS = {
    suite: 'Suite Tickets', club: 'Club Tickets',
    bsbParking: 'BSB Parking', suiteParking: 'Suite Parking', hotel: 'Hotel Rooms',
  };

  function resolveEmail(slot) {
    if (slot.userId && currentEmployeeMap[slot.userId]?.personalEmail) {
      return currentEmployeeMap[slot.userId].personalEmail;
    }
    return slot.email || '';
  }

  function csvEscape(v) {
    const s = (v ?? '').toString();
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function concertSlug(c) {
    const base = (c.artist || c.name || 'concert').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${c.date || ''}_${base}`.replace(/^_/, '');
  }

  function exportSectionEmails(sectionKey) {
    if (!currentDetail) return;
    const slots = (currentDetail.slotGrids?.[sectionKey] || []).filter(s => s.assignmentId);
    if (!slots.length) { alert(`No assignments in ${SECTION_LABELS[sectionKey] || sectionKey}.`); return; }
    const rows = [['Slot', 'Name', 'Email', 'Phone']];
    for (const s of slots) rows.push([s.slotNumber, s.name || '', resolveEmail(s), s.phone || '']);
    downloadCsv(`${concertSlug(currentDetail.concert)}_${sectionKey}_emails.csv`, rows);
  }

  function exportAllEmails() {
    if (!currentDetail) return;
    const rows = [['Section', 'Slot', 'Name', 'Email', 'Phone']];
    let count = 0;
    for (const key of ['suite', 'club', 'bsbParking', 'suiteParking', 'hotel']) {
      const slots = (currentDetail.slotGrids?.[key] || []).filter(s => s.assignmentId);
      for (const s of slots) {
        rows.push([SECTION_LABELS[key], s.slotNumber, s.name || '', resolveEmail(s), s.phone || '']);
        count++;
      }
    }
    if (!count) { alert('No assignments to export for this concert.'); return; }
    downloadCsv(`${concertSlug(currentDetail.concert)}_all_emails.csv`, rows);
  }

  function renderSlotConfigView(c) {
    const rows = [
      ['Suite Tickets', c.suiteTicketCount || 20],
      ['Club Tickets',  c.clubTicketCount  || 86],
      ['BSB Parking',   c.bsbParkingCount  || 20],
      ['Suite Parking', c.suiteParkingCount || 8],
    ];
    const hotelDetails = c.hotelRoomDetails || [];
    const hotelCount = hotelDetails.length || c.hotelRooms || 0;

    document.getElementById('slotConfigView').innerHTML = `
      <div class="grid-2" style="gap:.5rem;">
        ${rows.map(([label, count]) =>
          `<div style="display:flex;justify-content:space-between;align-items:center;padding:.375rem .5rem;background:var(--gray-50);border-radius:var(--radius);">
            <span class="text-sm font-medium">${label}</span>
            <span class="badge badge-blue">${count}</span>
           </div>`).join('')}
      </div>
      ${hotelCount > 0 ? `
        <div style="margin-top:.5rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:.375rem .5rem;background:var(--gray-50);border-radius:var(--radius);margin-bottom:.25rem;">
            <span class="text-sm font-medium">Hotel Rooms</span>
            <span class="badge badge-blue">${hotelCount}</span>
          </div>
          ${hotelDetails.length ? hotelDetails.map(r =>
            `<div style="padding:.2rem .5rem .2rem 1rem;font-size:.8rem;color:var(--gray-600);">
               #${r.roomNumber} — ${[r.type, r.location].filter(Boolean).join(' · ') || '(no details)'}
             </div>`).join('') : ''}
        </div>` : ''}`;

    // Populate edit form
    document.getElementById('cfg-suite').value        = c.suiteTicketCount  || 20;
    document.getElementById('cfg-club').value         = c.clubTicketCount   || 86;
    document.getElementById('cfg-bsb').value          = c.bsbParkingCount   || 20;
    document.getElementById('cfg-suiteParking').value = c.suiteParkingCount || 8;

    // Populate hotel room list editor
    const container = document.getElementById('hotelRoomInputs');
    container.innerHTML = '';
    if (hotelDetails.length > 0) {
      hotelDetails.forEach(r => addHotelRoomInput(r.type || '', r.location || ''));
    } else if (c.hotelRooms > 0) {
      for (let i = 0; i < c.hotelRooms; i++) addHotelRoomInput('', '');
    }
  }

  function renderAllSlotGrids(slotGrids, concert, employeeMap = {}) {
    const container = document.getElementById('slotGrids');
    const sections = [
      ...(concert.hotelRooms > 0 ? [{ key: 'hotel', label: 'Hotel Rooms', icon: '🏨' }] : []),
      { key: 'suite',        label: 'Suite Tickets', icon: '🎫' },
      { key: 'club',         label: 'Club Tickets',  icon: '🎟️' },
      { key: 'bsbParking',   label: 'BSB Parking',   icon: '🅿️' },
      { key: 'suiteParking', label: 'Suite Parking', icon: '🚗' },
    ];

    const header = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:.5rem;">
        <button class="btn btn-sm btn-blue" onclick="Admin.exportAllEmails()">⬇ Export All Emails (CSV)</button>
      </div>`;

    container.innerHTML = header + sections.map(({ key, label, icon }) => {
      const slots = slotGrids[key] || [];
      const filled = slots.filter(s => s.assignmentId).length;
      const hotelNotes = key === 'hotel' && concert.hotelNotes && !(concert.hotelRoomDetails || []).length
        ? `<div class="text-xs text-muted" style="padding:.25rem .75rem .5rem;font-style:italic;">${concert.hotelNotes}</div>`
        : '';
      return `
        <div class="card slot-section">
          <div class="card-header">
            <h3>${icon} ${label}</h3>
            <div style="display:flex;align-items:center;gap:.5rem;">
              <span class="badge ${filled === slots.length ? 'badge-green' : 'badge-gray'}">${filled}/${slots.length}</span>
              ${filled > 0 ? `<button class="btn btn-sm btn-secondary" style="padding:.2rem .5rem;font-size:.7rem;" onclick="Admin.exportSectionEmails('${key}')" title="Export emails for this section">⬇ CSV</button>` : ''}
            </div>
          </div>
          ${hotelNotes}
          <div style="display:flex;flex-direction:column;gap:.375rem;">
            ${slots.map(slot => {
              const isAssigned = !!slot.assignmentId;
              const profile = slot.userId ? (employeeMap[slot.userId] || {}) : {};
              const personDetails = [profile.jobTitle, profile.officeLocation].filter(Boolean).join(' · ');
              const roomDetail = key === 'hotel'
                ? (concert.hotelRoomDetails || [])[slot.slotNumber - 1] : null;
              const roomInfo = roomDetail
                ? [roomDetail.type, roomDetail.location].filter(Boolean).join(' · ') : '';
              return `
                <div class="slot-item ${isAssigned ? 'assigned' : 'empty'}">
                  <div style="flex:1;overflow:hidden;">
                    <div style="display:flex;align-items:center;gap:.5rem;">
                      <span class="slot-num">#${slot.slotNumber}</span>
                      ${roomInfo ? `<span class="text-xs font-medium" style="color:var(--amber);">${roomInfo}</span>` : ''}
                    </div>
                    ${isAssigned
                      ? `<div class="slot-name" style="margin-top:.1rem;">${slot.name}</div>
                         ${personDetails ? `<div class="text-xs text-muted">${personDetails}</div>` : ''}`
                      : `<div class="slot-empty-label">Open</div>`
                    }
                  </div>
                  ${isAssigned
                    ? `<button class="btn btn-sm btn-danger" style="padding:.2rem .5rem;font-size:.7rem;flex-shrink:0;"
                         onclick="Admin.removeAssignment('${slot.assignmentId}','${key}',${slot.slotNumber})">✕</button>`
                    : `<button class="btn btn-sm btn-blue" style="padding:.2rem .5rem;font-size:.7rem;flex-shrink:0;"
                         onclick="Admin.openAssignModal('${key}',${slot.slotNumber})">+</button>`
                  }
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');
  }

  // ── Slot configuration ────────────────────────────────────

  function toggleSlotEdit() {
    const editEl = document.getElementById('slotConfigEdit');
    const viewEl = document.getElementById('slotConfigView');
    const btn = document.getElementById('editSlotsBtn');
    const hidden = editEl.classList.contains('hidden');
    editEl.classList.toggle('hidden', !hidden);
    viewEl.classList.toggle('hidden', hidden);
    btn.textContent = hidden ? 'Cancel' : 'Edit Counts';
  }

  async function saveSlotConfig() {
    const suite  = parseInt(document.getElementById('cfg-suite').value);
    const club   = parseInt(document.getElementById('cfg-club').value);
    const bsb    = parseInt(document.getElementById('cfg-bsb').value);
    const suiteP = parseInt(document.getElementById('cfg-suiteParking').value);

    const hotelRoomDetails = Array.from(
      document.querySelectorAll('#hotelRoomInputs .hotel-room-row')
    ).map((row, i) => {
      const inputs = row.querySelectorAll('input');
      return { roomNumber: i + 1, type: inputs[0].value.trim(), location: inputs[1].value.trim() };
    });

    try {
      await Auth.apiRequest(`/concerts/${currentConcert}`, {
        method: 'PUT',
        body: JSON.stringify({
          suiteTicketCount: suite, clubTicketCount: club,
          bsbParkingCount: bsb, suiteParkingCount: suiteP,
          hotelRooms: hotelRoomDetails.length,
          hotelRoomDetails,
        }),
      });
      toggleSlotEdit();
      openConcertDetail(currentConcert);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
  }

  // ── Assign Modal ──────────────────────────────────────────

  async function openAssignModal(slotType, slotNumber) {
    pendingSlot = { slotType, slotNumber };
    document.getElementById('assignModalTitle').textContent =
      `Assign ${slotTypeLabel(slotType)} #${slotNumber}`;
    document.getElementById('assignType').value = 'employee';
    document.getElementById('assignError').classList.add('hidden');
    document.getElementById('manualName').value = '';
    document.getElementById('manualEmail').value = '';
    document.getElementById('manualPhone').value = '';

    // Populate employee dropdown from requests (with profile enrichment)
    const requests = currentDetail?.requests || [];
    let employeeMap = {};
    try {
      const employees = await Auth.apiRequest('/employees') || [];
      for (const e of employees) employeeMap[e.userId] = e;
    } catch (e) {}

    const empSelect = document.getElementById('assignEmployeeSelect');
    empSelect.innerHTML = requests.length
      ? requests.map(r => {
          const p = employeeMap[r.userId] || {};
          const label = `#${r.rank} — ${r.name}${p.jobTitle ? ' · ' + p.jobTitle : ''}${p.officeLocation ? ' · ' + p.officeLocation : ''}`;
          return `<option value="${r.userId}" data-name="${r.name}" data-email="${p.personalEmail || r.email}">${label}</option>`;
        }).join('')
      : '<option value="">No employee requests for this concert</option>';

    // Populate guest dropdown
    if (!allGuests.length) {
      try { allGuests = await Auth.apiRequest('/guests') || []; } catch (e) {}
    }
    const guestSelect = document.getElementById('assignGuestSelect');
    guestSelect.innerHTML = allGuests.length
      ? allGuests.map(g => `<option value="${g.guestId}" data-name="${g.fullName}" data-email="${g.email||''}">${g.lastName} — ${g.fullName}</option>`).join('')
      : '<option value="">No guests on file</option>';

    onAssignTypeChange();
    document.getElementById('assignModal').classList.remove('hidden');
  }

  function onAssignTypeChange() {
    const type = document.getElementById('assignType').value;
    document.getElementById('assignEmployee').classList.toggle('hidden', type !== 'employee');
    document.getElementById('assignGuest').classList.toggle('hidden', type !== 'guest');
    document.getElementById('assignManual').classList.toggle('hidden', type !== 'manual');
  }

  function closeAssignModal() {
    document.getElementById('assignModal').classList.add('hidden');
    pendingSlot = null;
  }

  async function saveAssignment() {
    if (!pendingSlot) return;
    const errEl = document.getElementById('assignError');
    errEl.classList.add('hidden');

    const type = document.getElementById('assignType').value;
    let payload = {
      concertId: currentConcert,
      slotType: pendingSlot.slotType,
      slotNumber: pendingSlot.slotNumber,
      assigneeType: type,
    };

    if (type === 'employee') {
      const sel = document.getElementById('assignEmployeeSelect');
      const opt = sel.options[sel.selectedIndex];
      if (!sel.value) { showAssignError('Please select an employee'); return; }
      payload.userId = sel.value;
      payload.name = opt.getAttribute('data-name');
      payload.email = opt.getAttribute('data-email');
    } else if (type === 'guest') {
      const sel = document.getElementById('assignGuestSelect');
      const opt = sel.options[sel.selectedIndex];
      if (!sel.value) { showAssignError('Please select a guest'); return; }
      payload.guestId = sel.value;
      payload.name = opt.getAttribute('data-name');
      payload.email = opt.getAttribute('data-email');
    } else {
      const name = document.getElementById('manualName').value.trim();
      if (!name) { showAssignError('Name is required'); return; }
      payload.name = name;
      payload.email = document.getElementById('manualEmail').value.trim();
      payload.phone = document.getElementById('manualPhone').value.trim();
    }

    try {
      await Auth.apiRequest('/assignments', { method: 'POST', body: JSON.stringify(payload) });
      closeAssignModal();
      openConcertDetail(currentConcert);
    } catch (err) {
      showAssignError(err.message);
    }
  }

  function showAssignError(msg) {
    const el = document.getElementById('assignError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  async function removeAssignment(assignmentId, slotType, slotNumber) {
    if (!confirm(`Remove assignment for ${slotTypeLabel(slotType)} #${slotNumber}?`)) return;
    try {
      await Auth.apiRequest(`/assignments/${assignmentId}`, { method: 'DELETE' });
      openConcertDetail(currentConcert);
    } catch (err) {
      alert('Failed to remove: ' + err.message);
    }
  }

  // ── Add Concert ───────────────────────────────────────────

  async function seedConcerts() {
    if (!confirm('This will load all 25 concerts for the 2026 season (skipping any that already exist). Continue?')) return;
    try {
      const result = await Auth.apiRequest('/concerts/seed', { method: 'POST', body: JSON.stringify({}) });
      alert(`✓ ${result.message}`);
      loadConcerts();
    } catch (err) {
      alert('Seed failed: ' + err.message);
    }
  }

  function showAddConcert() {
    const name = prompt('Concert name:');
    if (!name) return;
    const date = prompt('Date (YYYY-MM-DD):');
    if (!date) return;
    Auth.apiRequest('/concerts', {
      method: 'POST',
      body: JSON.stringify({ name, date, season: '2026' }),
    }).then(() => loadConcerts()).catch(err => alert('Failed: ' + err.message));
  }

  function editConcertDetails() {
    const c = currentDetail?.concert;
    if (!c) return;
    const name = prompt('Concert name:', c.name);
    if (name === null) return;
    const date = prompt('Date (YYYY-MM-DD):', c.date);
    if (date === null) return;
    const doorsTime = prompt('Doors time:', c.doorsTime);
    const musicTime = prompt('Music time:', c.musicTime);
    const hotelRooms = parseInt(prompt('Hotel rooms:', c.hotelRooms || 0) || '0');
    const hotelNotes = prompt('Hotel notes:', c.hotelNotes || '');

    Auth.apiRequest(`/concerts/${currentConcert}`, {
      method: 'PUT',
      body: JSON.stringify({ name, date, doorsTime, musicTime, hotelRooms, hotelNotes }),
    }).then(() => openConcertDetail(currentConcert)).catch(err => alert('Failed: ' + err.message));
  }

  // ── Jay's Guests ──────────────────────────────────────────

  function formatPhone(raw) {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 7)  return `(207) ${digits.slice(0,3)}-${digits.slice(3)}`;
    if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
    return raw;
  }

  async function loadGuests() {
    document.getElementById('guestsLoading').classList.remove('hidden');
    try {
      allGuests = await Auth.apiRequest('/guests') || [];
      renderGuestsTable();
    } catch (err) {
      document.getElementById('guestsTableBody').innerHTML =
        `<tr><td colspan="6" class="text-muted">Failed to load guests: ${err.message}</td></tr>`;
    } finally {
      document.getElementById('guestsLoading').classList.add('hidden');
    }
  }

  function renderGuestsTable() {
    const tbody = document.getElementById('guestsTableBody');
    if (!allGuests.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-400);">No guests yet. Click "+ Add Guest" to start.</td></tr>`;
      return;
    }
    tbody.innerHTML = allGuests.map(g => `
      <tr class="guest-row">
        <td class="font-medium">${g.lastName}</td>
        <td>${g.fullName}</td>
        <td>${g.email ? `<a href="mailto:${g.email}" style="color:var(--blue);">${g.email}</a>` : '<span class="text-muted">—</span>'}</td>
        <td style="white-space:nowrap;">${formatPhone(g.phone) || '<span class="text-muted">—</span>'}</td>
        <td class="text-sm text-muted">${g.notes || ''}</td>
        <td>
          <div class="flex gap-1" style="flex-wrap:nowrap;">
            <button class="btn btn-primary btn-sm" onclick="Admin.showGuestAssignModal('${g.guestId}')">Assign</button>
            <button class="btn btn-outline btn-sm" onclick="Admin.showGuestModal('${g.guestId}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="Admin.deleteGuest('${g.guestId}','${escapeAttr(g.fullName)}')">Delete</button>
          </div>
        </td>
      </tr>`).join('');
  }

  function showGuestModal(guestId) {
    editingGuestId = guestId || null;
    const guest = guestId ? allGuests.find(g => g.guestId === guestId) : null;
    document.getElementById('guestModalTitle').textContent = guest ? 'Edit Guest' : 'Add Guest';
    document.getElementById('guestLastName').value = guest?.lastName || '';
    document.getElementById('guestFullName').value = guest?.fullName || '';
    document.getElementById('guestEmail').value = guest?.email || '';
    document.getElementById('guestPhone').value = guest?.phone || '';
    document.getElementById('guestNotes').value = guest?.notes || '';
    document.getElementById('guestError').classList.add('hidden');
    document.getElementById('guestModal').classList.remove('hidden');
  }

  function closeGuestModal() {
    document.getElementById('guestModal').classList.add('hidden');
    editingGuestId = null;
  }

  async function saveGuest() {
    const payload = {
      lastName: document.getElementById('guestLastName').value.trim(),
      fullName: document.getElementById('guestFullName').value.trim(),
      email: document.getElementById('guestEmail').value.trim(),
      phone: document.getElementById('guestPhone').value.trim(),
      notes: document.getElementById('guestNotes').value.trim(),
    };
    if (!payload.lastName || !payload.fullName) {
      const el = document.getElementById('guestError');
      el.textContent = 'Last name and full name are required';
      el.classList.remove('hidden');
      return;
    }
    try {
      if (editingGuestId) {
        await Auth.apiRequest(`/guests/${editingGuestId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await Auth.apiRequest('/guests', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeGuestModal();
      loadGuests();
    } catch (err) {
      const el = document.getElementById('guestError');
      el.textContent = err.message;
      el.classList.remove('hidden');
    }
  }

  async function deleteGuest(guestId, name) {
    if (!confirm(`Delete guest "${name}"? This cannot be undone.`)) return;
    try {
      await Auth.apiRequest(`/guests/${guestId}`, { method: 'DELETE' });
      loadGuests();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }

  // ── Guest → Assign to Concert Modal ──────────────────────

  async function showGuestAssignModal(guestId) {
    const guest = allGuests.find(g => g.guestId === guestId);
    if (!guest) return;
    assigningGuest = guest;
    guestAssignDetail = null;

    document.getElementById('guestAssignModalTitle').textContent = `Assign ${guest.fullName} to Concert`;
    document.getElementById('guestAssignError').classList.add('hidden');

    // Ensure concerts are loaded (in case admin jumps straight to Guests tab — unlikely)
    if (!concerts.length) {
      try {
        concerts = await Auth.apiRequest('/concerts?season=2026') || [];
      } catch (e) {}
    }

    const concertSel = document.getElementById('guestAssignConcert');
    concertSel.innerHTML = '<option value="">— Select a concert —</option>' +
      concerts.map(c => `<option value="${c.concertId}">${formatDate(c.date)} — ${c.name}</option>`).join('');
    concertSel.value = '';

    document.getElementById('guestAssignSlotType').value = 'suite';
    document.getElementById('guestAssignSlotType').disabled = true;
    const slotNumSel = document.getElementById('guestAssignSlotNumber');
    slotNumSel.innerHTML = '<option value="">— Pick a concert first —</option>';
    slotNumSel.disabled = true;

    document.getElementById('guestAssignModal').classList.remove('hidden');
  }

  function closeGuestAssignModal() {
    document.getElementById('guestAssignModal').classList.add('hidden');
    assigningGuest = null;
    guestAssignDetail = null;
  }

  async function onGuestAssignConcertChange() {
    const concertId = document.getElementById('guestAssignConcert').value;
    const slotTypeSel = document.getElementById('guestAssignSlotType');
    const slotNumSel = document.getElementById('guestAssignSlotNumber');

    if (!concertId) {
      slotTypeSel.disabled = true;
      slotNumSel.disabled = true;
      slotNumSel.innerHTML = '<option value="">— Pick a concert first —</option>';
      guestAssignDetail = null;
      return;
    }

    slotNumSel.innerHTML = '<option value="">Loading…</option>';
    try {
      guestAssignDetail = await Auth.apiRequest(`/assignments/concert/${concertId}`);
      slotTypeSel.disabled = false;
      onGuestAssignSlotTypeChange();
    } catch (err) {
      slotNumSel.innerHTML = `<option value="">Failed to load: ${err.message}</option>`;
    }
  }

  function onGuestAssignSlotTypeChange() {
    if (!guestAssignDetail) return;
    const slotType = document.getElementById('guestAssignSlotType').value;
    const slots = guestAssignDetail.slotGrids?.[slotType] || [];
    const open = slots.filter(s => !s.assignmentId);
    const slotNumSel = document.getElementById('guestAssignSlotNumber');
    slotNumSel.disabled = open.length === 0;
    if (!slots.length) {
      slotNumSel.innerHTML = '<option value="">This concert has no slots of this type</option>';
    } else if (!open.length) {
      slotNumSel.innerHTML = '<option value="">No open slots — all filled</option>';
    } else {
      slotNumSel.innerHTML = open.map(s => `<option value="${s.slotNumber}">#${s.slotNumber}</option>`).join('');
    }
  }

  async function saveGuestAssignment() {
    if (!assigningGuest) return;
    const errEl = document.getElementById('guestAssignError');
    errEl.classList.add('hidden');

    const concertId = document.getElementById('guestAssignConcert').value;
    const slotType = document.getElementById('guestAssignSlotType').value;
    const slotNumber = parseInt(document.getElementById('guestAssignSlotNumber').value);

    if (!concertId) { return showGuestAssignError('Please select a concert.'); }
    if (!slotNumber) { return showGuestAssignError('Please select an open slot.'); }

    try {
      await Auth.apiRequest('/assignments', {
        method: 'POST',
        body: JSON.stringify({
          concertId,
          slotType,
          slotNumber,
          assigneeType: 'guest',
          guestId: assigningGuest.guestId,
          name: assigningGuest.fullName,
          email: assigningGuest.email || '',
          phone: assigningGuest.phone || '',
        }),
      });
      const concertName = concerts.find(c => c.concertId === concertId)?.name || concertId;
      closeGuestAssignModal();
      alert(`✓ Assigned ${assigningGuest.fullName} to ${slotTypeLabel(slotType)} #${slotNumber} for ${concertName}.`);
    } catch (err) {
      showGuestAssignError(err.message);
    }
  }

  function showGuestAssignError(msg) {
    const el = document.getElementById('guestAssignError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // ── Settings ──────────────────────────────────────────────

  async function loadSettings() {
    document.getElementById('settingsLoading').classList.remove('hidden');
    document.getElementById('settingsForm').classList.add('hidden');
    try {
      const settings = await Auth.apiRequest('/settings');
      const open = settings.submissionsOpen === 'true';
      document.getElementById('subsStatus').textContent = open ? 'OPEN' : 'CLOSED';
      document.getElementById('subsStatus').className = `badge ${open ? 'badge-green' : 'badge-red'}`;
      document.getElementById('seasonInput').value = settings.currentSeason || '2026';
      document.getElementById('fromEmailInput').value = settings.notificationFromEmail || '';
      document.getElementById('settingsForm').classList.remove('hidden');
    } catch (err) {
      document.getElementById('settingsLoading').innerHTML =
        `<div class="alert alert-error">Failed to load settings: ${err.message}</div>`;
    } finally {
      document.getElementById('settingsLoading').classList.add('hidden');
    }
  }

  async function setSubmissions(open) {
    try {
      await Auth.apiRequest('/settings/submissionsOpen', {
        method: 'PUT',
        body: JSON.stringify({ value: open ? 'true' : 'false' }),
      });
      showSettingsMsg(`Submissions ${open ? 'opened' : 'closed'} ✓`);
      loadSettings();
    } catch (err) { showSettingsMsg('Failed: ' + err.message, true); }
  }

  async function saveSeason() {
    const val = document.getElementById('seasonInput').value.trim();
    if (!val) return;
    try {
      await Auth.apiRequest('/settings/currentSeason', { method: 'PUT', body: JSON.stringify({ value: val }) });
      showSettingsMsg('Season saved ✓');
    } catch (err) { showSettingsMsg('Failed: ' + err.message, true); }
  }

  async function saveFromEmail() {
    const val = document.getElementById('fromEmailInput').value.trim();
    try {
      await Auth.apiRequest('/settings/notificationFromEmail', { method: 'PUT', body: JSON.stringify({ value: val }) });
      showSettingsMsg('Email saved ✓');
    } catch (err) { showSettingsMsg('Failed: ' + err.message, true); }
  }

  function showSettingsMsg(msg, isError = false) {
    const el = document.getElementById('settingsSaveMsg');
    el.style.color = isError ? 'var(--red)' : 'var(--green)';
    el.textContent = msg;
    setTimeout(() => { el.textContent = ''; }, 3000);
  }

  // ── Helpers ───────────────────────────────────────────────

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function slotTypeLabel(t) {
    const labels = { suite: 'Suite Ticket', club: 'Club Ticket', bsbParking: 'BSB Parking', suiteParking: 'Suite Parking', hotel: 'Hotel Room' };
    return labels[t] || t;
  }

  function addHotelRoomInput(type = '', location = '') {
    const container = document.getElementById('hotelRoomInputs');
    const idx = container.children.length + 1;
    const row = document.createElement('div');
    row.className = 'hotel-room-row';
    row.innerHTML = `
      <span class="room-idx">#${idx}</span>
      <input type="text" class="form-control" placeholder="Type (Queen, King…)" value="${escapeAttr(type)}" style="flex:1;" />
      <input type="text" class="form-control" placeholder="Location (Casino, Residence…)" value="${escapeAttr(location)}" style="flex:1;" />
      <button type="button" class="btn btn-sm btn-danger" style="padding:.2rem .5rem;" onclick="this.closest('.hotel-room-row').remove();Admin.reindexHotelRooms()">✕</button>`;
    container.appendChild(row);
  }

  function reindexHotelRooms() {
    document.querySelectorAll('#hotelRoomInputs .hotel-room-row').forEach((row, i) => {
      row.querySelector('.room-idx').textContent = `#${i + 1}`;
    });
  }

  function escapeAttr(str) {
    return (str || '').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
  }

  async function quickAssign(userId, name, email, slotType) {
    const slots = currentDetail?.slotGrids?.[slotType] || [];
    const openSlot = slots.find(s => !s.assignmentId);
    if (!openSlot) {
      alert(`No open ${slotType === 'club' ? 'Club Ticket' : 'Suite Ticket'} slots available.`);
      return;
    }
    try {
      await Auth.apiRequest('/assignments', {
        method: 'POST',
        body: JSON.stringify({
          concertId: currentConcert,
          slotType,
          slotNumber: openSlot.slotNumber,
          assigneeType: 'employee',
          userId,
          name,
          email,
        }),
      });
      await openConcertDetail(currentConcert);
    } catch (err) {
      alert('Failed to assign: ' + err.message);
    }
  }

  return {
    init, showTab,
    showList, openConcertDetail,
    toggleSlotEdit, saveSlotConfig,
    openAssignModal, closeAssignModal, onAssignTypeChange, saveAssignment, removeAssignment, quickAssign,
    exportSectionEmails, exportAllEmails,
    addHotelRoomInput, reindexHotelRooms,
    seedConcerts, showAddConcert, editConcertDetails,
    loadGuests, showGuestModal, closeGuestModal, saveGuest, deleteGuest,
    showGuestAssignModal, closeGuestAssignModal, onGuestAssignConcertChange, onGuestAssignSlotTypeChange, saveGuestAssignment,
    loadSettings, setSubmissions, saveSeason, saveFromEmail,
  };
})();
