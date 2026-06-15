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
  let notesSaveTimer = null;
  let lastSavedNotes = '';

  // ── Init ──────────────────────────────────────────────────

  async function init() {
    const ok = await Auth.requireAuth();
    if (!ok) return;
    const user = Auth.getCurrentUser();
    if (user) document.getElementById('userDisplay').textContent = user.name || user.email;
    // Keep the admin's own employee record in sync with Microsoft Graph (companyName, jobTitle, etc.)
    Auth.fetchGraphProfile().then(gp => { if (gp) Auth.syncProfileToBackend(gp); });
    loadConcerts();
  }

  function showTab(name, btn) {
    ['concerts', 'submissions', 'guests', 'settings'].forEach(t => {
      document.getElementById(`tab-${t}`).classList.add('hidden');
      document.getElementById(`tab-${t}-btn`).classList.remove('active');
    });
    document.getElementById(`tab-${name}`).classList.remove('hidden');
    btn.classList.add('active');

    if (name === 'submissions') loadSubmissions();
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
      const isCancelled = c.status === 'cancelled';
      const tr = document.createElement('tr');
      tr.className = 'tr-clickable';
      if (isCancelled) tr.style.opacity = '0.55';
      tr.onclick = () => openConcertDetail(c.concertId);
      const cancelledBadge = isCancelled
        ? ' <span class="badge badge-red" style="font-size:.7rem;">CANCELLED</span>' : '';
      const cancelBtn = isCancelled
        ? `<button class="btn btn-amber btn-sm" style="margin-left:.25rem;"
             onclick="event.stopPropagation();Admin.uncancelConcert('${c.concertId}')">Uncancel</button>`
        : `<button class="btn btn-danger btn-sm" style="margin-left:.25rem;"
             onclick="event.stopPropagation();Admin.cancelConcert('${c.concertId}')">Cancel</button>`;
      tr.innerHTML = `
        <td>${c.showNumber}</td>
        <td>${c.name}${cancelledBadge}</td>
        <td>${formatDate(c.date)}</td>
        <td>${c.day}</td>
        <td>${c.hotelRooms ? `<span class="badge badge-amber">${c.hotelRooms} rooms</span>` : '<span class="text-muted text-xs">—</span>'}</td>
        <td class="tally-cell"><span class="tally-num">${t[1]||0}</span></td>
        <td class="tally-cell"><span class="tally-num">${t[2]||0}</span></td>
        <td class="tally-cell"><span class="tally-num">${t[3]||0}</span></td>
        <td class="tally-cell"><span class="tally-num">${t[4]||0}</span></td>
        <td class="tally-cell"><span class="tally-num">${t[5]||0}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();Admin.openConcertDetail('${c.concertId}')">Manage →</button>
          ${cancelBtn}
        </td>
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

    // Notes — populate textarea, reset save state
    const notesEl = document.getElementById('concertNotes');
    if (notesEl) {
      notesEl.value = c.notes || '';
      lastSavedNotes = notesEl.value;
      setNotesStatus('');
    }

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
                : [profile.jobTitle, profile.location].filter(Boolean).join(' · ');
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

  // Dedupe key: an employee/guest collapses by their id; a manual entry
  // collapses by normalized name+email. Pairs and multi-section assignments
  // for the same person become one row.
  function recipientKey(slot) {
    if (slot.userId) return `u:${slot.userId}`;
    if (slot.guestId) return `g:${slot.guestId}`;
    const n = (slot.name || '').trim().toLowerCase();
    const e = (slot.email || '').trim().toLowerCase();
    return `m:${n}|${e}`;
  }

  function resolveLocation(slot) {
    if (slot.userId && currentEmployeeMap[slot.userId]?.location) return currentEmployeeMap[slot.userId].location;
    if (slot.guestId && Array.isArray(allGuests)) {
      const g = allGuests.find(x => x.guestId === slot.guestId);
      if (g?.location) return g.location;
    }
    return '';
  }

  function exportSectionEmails(sectionKey) {
    if (!currentDetail) return;
    const slots = (currentDetail.slotGrids?.[sectionKey] || []).filter(s => s.assignmentId);
    if (!slots.length) { alert(`No assignments in ${SECTION_LABELS[sectionKey] || sectionKey}.`); return; }
    const byRecipient = new Map();
    for (const s of slots) {
      const key = recipientKey(s);
      const entry = byRecipient.get(key) || {
        name: s.name || '', email: resolveEmail(s), phone: s.phone || '', location: resolveLocation(s), slots: [],
      };
      entry.slots.push(s.slotNumber);
      byRecipient.set(key, entry);
    }
    const rows = [['Name', 'Email', 'Phone', 'Location', 'Slots']];
    for (const e of byRecipient.values()) {
      const slotsStr = e.slots.sort((a, b) => a - b).map(n => `#${n}`).join(', ');
      rows.push([e.name, e.email, e.phone, e.location, slotsStr]);
    }
    downloadCsv(`${concertSlug(currentDetail.concert)}_${sectionKey}_emails.csv`, rows);
  }

  // Export just the employees selected for a section — excludes Jay's Guests
  // and manual/VIP entries. Pairs are de-duplicated to one row per employee.
  function exportSectionEmployeeNames(sectionKey) {
    if (!currentDetail) return;
    const employeeSlots = (currentDetail.slotGrids?.[sectionKey] || [])
      .filter(s => s.assignmentId && s.userId && !s.guestId);
    if (!employeeSlots.length) {
      alert(`No employees assigned in ${SECTION_LABELS[sectionKey] || sectionKey}.`);
      return;
    }
    const seen = new Set();
    const people = [];
    for (const s of employeeSlots) {
      if (seen.has(s.userId)) continue;
      seen.add(s.userId);
      const names = resolveSlotNames(s);
      const location = currentEmployeeMap[s.userId]?.location || '';
      people.push({ ...names, location });
    }
    people.sort((a, b) =>
      (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase())
      || (a.lastName || '').toLowerCase().localeCompare((b.lastName || '').toLowerCase())
    );
    const rows = [['Name', 'Location']];
    for (const p of people) rows.push([`${p.firstName || ''} ${p.lastName || ''}`.trim(), p.location]);
    downloadCsv(`${concertSlug(currentDetail.concert)}_${sectionKey}_employees.csv`, rows);
  }

  function htmlEscape(s) {
    return (s ?? '').toString().replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function splitName(fullName) {
    const trimmed = (fullName || '').trim();
    if (!trimmed) return { firstName: '', lastName: '' };
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return { firstName: '', lastName: parts[0] };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
  }

  function resolveSlotNames(slot) {
    if (slot.userId && currentEmployeeMap[slot.userId]) {
      const e = currentEmployeeMap[slot.userId];
      if (e.firstName || e.lastName) return { firstName: e.firstName || '', lastName: e.lastName || '' };
    }
    if (slot.guestId && Array.isArray(allGuests)) {
      const g = allGuests.find(x => x.guestId === slot.guestId);
      if (g && (g.firstName || g.lastName)) return { firstName: g.firstName || '', lastName: g.lastName || '' };
    }
    return splitName(slot.name);
  }

  function printCheckinSheet(sectionKey) {
    if (!currentDetail) return;
    const concert = currentDetail.concert;
    const slots = (currentDetail.slotGrids?.[sectionKey] || [])
      .filter(s => s.assignmentId)
      .map(s => ({ ...s, ...resolveSlotNames(s), location: resolveLocation(s) }))
      .sort((a, b) => {
        const last = (a.lastName || '').toLowerCase().localeCompare((b.lastName || '').toLowerCase());
        if (last !== 0) return last;
        const first = (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase());
        if (first !== 0) return first;
        return a.slotNumber - b.slotNumber;
      });
    if (!slots.length) {
      alert(`No assignments in ${SECTION_LABELS[sectionKey] || sectionKey} to print.`);
      return;
    }
    const sectionLabel = SECTION_LABELS[sectionKey] || sectionKey;
    const dateStr = formatDate(concert.date);
    const subtitle = [dateStr, concert.doorsTime ? `Doors ${concert.doorsTime}` : '', concert.musicTime ? `Music ${concert.musicTime}` : '']
      .filter(Boolean).join(' · ');
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${htmlEscape(sectionLabel)} — ${htmlEscape(concert.name)}</title>
<style>
  @page { margin: .5in; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 1rem; }
  h1 { margin: 0 0 .25rem; font-size: 1.4rem; }
  h2 { margin: 0 0 .5rem; font-size: 1rem; color: #333; font-weight: 600; }
  .meta { font-size: .85rem; color: #555; margin-bottom: 1.25rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: .45rem .5rem; text-align: left; font-size: .9rem; vertical-align: top; }
  th { background: #f0f0f0; font-weight: 600; }
  .col-check { width: 1.6rem; text-align: center; font-size: 1.4rem; line-height: 1; }
  .col-slot  { width: 3rem; text-align: center; }
  .col-sig   { width: 28%; }
  .footer { margin-top: 1.5rem; font-size: .75rem; color: #666; display: flex; justify-content: space-between; }
  .toolbar { margin-bottom: 1rem; }
  .toolbar button { padding: .5rem 1rem; font-size: .9rem; cursor: pointer; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print this sheet</button></div>
  <h1>${htmlEscape(sectionLabel)} — Check-in Sheet</h1>
  <h2>${htmlEscape(concert.name)}</h2>
  <div class="meta">${htmlEscape(subtitle)}<br>${htmlEscape(concert.venue || 'Maine Savings Amphitheater')}</div>
  <table>
    <thead><tr>
      <th class="col-check">☐</th>
      <th class="col-slot">Slot</th>
      <th>Last Name</th>
      <th>First Name</th>
      <th>Location</th>
      <th>Phone</th>
      <th class="col-sig">Signature</th>
    </tr></thead>
    <tbody>
      ${slots.map(s => `<tr>
        <td class="col-check">☐</td>
        <td class="col-slot">#${s.slotNumber}</td>
        <td>${htmlEscape(s.lastName || '')}</td>
        <td>${htmlEscape(s.firstName || '')}</td>
        <td>${htmlEscape(s.location || '')}</td>
        <td>${htmlEscape(s.phone || '')}</td>
        <td class="col-sig">&nbsp;</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="footer">
    <span>${slots.length} attendee${slots.length === 1 ? '' : 's'}</span>
    <span>Printed ${new Date().toLocaleString('en-US')}</span>
  </div>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.onload = () => { try { w.focus(); w.print(); } catch (e) {} };
  }

  function exportAllEmails() {
    if (!currentDetail) return;
    const byRecipient = new Map();
    for (const key of ['suite', 'club', 'bsbParking', 'suiteParking', 'hotel']) {
      const slots = (currentDetail.slotGrids?.[key] || []).filter(s => s.assignmentId);
      for (const s of slots) {
        const rk = recipientKey(s);
        const entry = byRecipient.get(rk) || {
          name: s.name || '', email: resolveEmail(s), phone: s.phone || '', location: resolveLocation(s), bySection: {},
        };
        (entry.bySection[key] = entry.bySection[key] || []).push(s.slotNumber);
        byRecipient.set(rk, entry);
      }
    }
    if (!byRecipient.size) { alert('No assignments to export for this concert.'); return; }
    const rows = [['Name', 'Email', 'Phone', 'Location', 'Assignments']];
    for (const e of byRecipient.values()) {
      const parts = [];
      for (const key of ['suite', 'club', 'bsbParking', 'suiteParking', 'hotel']) {
        const nums = e.bySection[key];
        if (!nums?.length) continue;
        parts.push(`${SECTION_LABELS[key]} ${nums.sort((a, b) => a - b).map(n => `#${n}`).join(', ')}`);
      }
      rows.push([e.name, e.email, e.phone, e.location, parts.join('; ')]);
    }
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
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
              <span class="badge ${filled === slots.length ? 'badge-green' : 'badge-gray'}">${filled}/${slots.length}</span>
              ${filled > 0 ? `<button class="btn btn-sm btn-secondary" style="padding:.2rem .5rem;font-size:.7rem;" onclick="Admin.exportSectionEmails('${key}')" title="Export emails for this section">⬇ CSV</button>` : ''}
              ${filled > 0 ? `<button class="btn btn-sm btn-secondary" style="padding:.2rem .5rem;font-size:.7rem;" onclick="Admin.exportSectionEmployeeNames('${key}')" title="Export employee names only (excludes guests and manual entries)">⬇ Employees</button>` : ''}
              ${filled > 0 && key === 'club' ? `<button class="btn btn-sm btn-blue" style="padding:.2rem .5rem;font-size:.7rem;" onclick="Admin.printCheckinSheet('club')" title="Open a printable check-in sheet">🖨 Check-in Sheet</button>` : ''}
            </div>
          </div>
          ${hotelNotes}
          <div style="display:flex;flex-direction:column;gap:.375rem;">
            ${slots.map(slot => {
              const isAssigned = !!slot.assignmentId;
              const profile = slot.userId ? (employeeMap[slot.userId] || {}) : {};
              const personDetails = [profile.jobTitle, profile.location].filter(Boolean).join(' · ');
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
                    ? `<div class="flex gap-1" style="flex-shrink:0;">
                         <button class="btn btn-sm ${slot.attended ? 'btn-success' : 'btn-outline'}"
                                 style="padding:.2rem .5rem;font-size:.75rem;min-width:1.8rem;"
                                 title="${slot.attended ? 'Attended — click to mark not attended' : 'Mark attended'}"
                                 onclick="Admin.toggleAttended('${slot.assignmentId}', ${!slot.attended})">
                           ${slot.attended ? '✓' : '○'}
                         </button>
                         ${(!slot.userId && !slot.guestId) ? `
                         <button class="btn btn-sm btn-outline" style="padding:.2rem .5rem;font-size:.75rem;"
                                 title="Edit name / email / phone"
                                 onclick="Admin.editManualAssignment('${slot.assignmentId}')">✎</button>` : ''}
                         <button class="btn btn-sm btn-danger" style="padding:.2rem .5rem;font-size:.7rem;"
                           onclick="Admin.removeAssignment('${slot.assignmentId}','${key}',${slot.slotNumber})">✕</button>
                       </div>`
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

  // Suite/Club tickets are sold in pairs — assigning one ticket fills two slots.
  // Parking + Hotel are single-slot only.
  const PAIRABLE_SLOT_TYPES = new Set(['suite', 'club']);

  // Parking sections pull their candidate list from the corresponding ticket
  // section, since parking is normally given to ticket holders.
  const PARKING_SOURCE_SECTIONS = {
    bsbParking:   { source: 'club',  label: 'Club',  noun: 'Club ticket holder' },
    suiteParking: { source: 'suite', label: 'Suite', noun: 'Suite ticket holder' },
  };

  function findOpenSlotNumbers(sectionKey) {
    const slots = currentDetail?.slotGrids?.[sectionKey] || [];
    return slots.filter(s => !s.assignmentId).map(s => s.slotNumber);
  }

  async function openAssignModal(slotType, slotNumber) {
    pendingSlot = { slotType, slotNumber };
    document.getElementById('assignModalTitle').textContent =
      `Assign ${slotTypeLabel(slotType)} #${slotNumber}`;
    document.getElementById('assignType').value = 'employee';
    document.getElementById('assignError').classList.add('hidden');
    document.getElementById('manualName').value = '';
    document.getElementById('manualEmail').value = '';
    document.getElementById('manualPhone').value = '';
    document.getElementById('assignTicketCount').value = '2';

    // Load employees + guests up front — both parking and standard paths need them
    let employeeMap = {};
    try {
      const employees = await Auth.apiRequest('/employees') || [];
      for (const e of employees) employeeMap[e.userId] = e;
    } catch (e) {}
    if (!allGuests.length) {
      try { allGuests = await Auth.apiRequest('/guests') || []; } catch (e) {}
    }

    const empSelect = document.getElementById('assignEmployeeSelect');
    const empLabel = document.querySelector('#assignEmployee .form-label');
    const empTypeOpt = document.getElementById('assignTypeEmployeeOpt');

    const parkingCfg = PARKING_SOURCE_SECTIONS[slotType];
    if (parkingCfg) {
      // BSB Parking pulls from Club holders; Suite Parking pulls from Suite holders.
      // Each ticket holder is one row (paired slots collapse via recipientKey),
      // sorted by dealership location. Excludes anyone already assigned to this parking section.
      empTypeOpt.textContent = parkingCfg.noun;
      if (empLabel) empLabel.textContent = `Select ${parkingCfg.noun}`;
      const ticketSlots = (currentDetail?.slotGrids?.[parkingCfg.source] || []).filter(s => s.assignmentId);
      const parkingTaken = new Set(
        (currentDetail?.slotGrids?.[slotType] || [])
          .filter(s => s.assignmentId)
          .map(recipientKey)
      );
      const byRecipient = new Map();
      for (const s of ticketSlots) {
        const key = recipientKey(s);
        if (parkingTaken.has(key)) continue;
        const existing = byRecipient.get(key);
        if (existing) { existing.ticketSlots.push(s.slotNumber); continue; }
        let source = 'manual', location = '', label = s.name || '';
        if (s.userId) {
          const p = employeeMap[s.userId] || {};
          source = 'employee';
          location = p.location || '';
          label = `${s.name}${p.jobTitle ? ' · ' + p.jobTitle : ''}${location ? ' · ' + location : ''}`;
        } else if (s.guestId) {
          const g = (allGuests || []).find(x => x.guestId === s.guestId) || {};
          source = 'guest';
          location = g.location || '';
          label = `${s.name}${location ? ' · ' + location : ''} · Guest`;
        } else {
          label = `${s.name} · Manual`;
        }
        byRecipient.set(key, {
          source, location, label,
          userId: s.userId || '', guestId: s.guestId || '',
          name: s.name || '', email: s.email || '', phone: s.phone || '',
          ticketSlots: [s.slotNumber],
        });
      }
      const rows = Array.from(byRecipient.values()).sort((a, b) => {
        const la = (a.location || '￿').toLowerCase();
        const lb = (b.location || '￿').toLowerCase();
        return la.localeCompare(lb) || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      empSelect.innerHTML = rows.length
        ? rows.map((r, i) => {
            const slotStr = r.ticketSlots.sort((a, b) => a - b).map(n => `#${n}`).join(', ');
            return `<option value="${i}"
              data-source="${r.source}" data-user-id="${escapeAttr(r.userId)}"
              data-guest-id="${escapeAttr(r.guestId)}" data-name="${escapeAttr(r.name)}"
              data-email="${escapeAttr(r.email)}" data-phone="${escapeAttr(r.phone)}"
            >${parkingCfg.label} ${slotStr} — ${r.label}</option>`;
          }).join('')
        : `<option value="">No ${parkingCfg.noun}s to choose from</option>`;
    } else {
      // Standard flow — populate from this concert's preference requests
      empTypeOpt.textContent = 'Employee (from requests)';
      if (empLabel) empLabel.textContent = 'Select Employee';
      const requests = currentDetail?.requests || [];
      empSelect.innerHTML = requests.length
        ? requests.map(r => {
            const p = employeeMap[r.userId] || {};
            const label = `#${r.rank} — ${r.name}${p.jobTitle ? ' · ' + p.jobTitle : ''}${p.location ? ' · ' + p.location : ''}`;
            return `<option value="${r.userId}" data-source="employee" data-name="${escapeAttr(r.name)}" data-email="${escapeAttr(p.personalEmail || r.email || '')}">${label}</option>`;
          }).join('')
        : '<option value="">No employee requests for this concert</option>';
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
    // Ticket-count picker only applies to Guest / Manual on pairable (suite/club) slots.
    // Employee path auto-pairs without a picker.
    const pairable = pendingSlot && PAIRABLE_SLOT_TYPES.has(pendingSlot.slotType);
    const showPicker = pairable && (type === 'guest' || type === 'manual');
    document.getElementById('assignTicketCountGroup').classList.toggle('hidden', !showPicker);
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
      if (!sel.value) { showAssignError('Please select an option'); return; }
      const source = opt.getAttribute('data-source') || 'employee';
      payload.name = opt.getAttribute('data-name');
      payload.email = opt.getAttribute('data-email') || '';
      if (source === 'employee') {
        const userId = opt.getAttribute('data-user-id') || sel.value;
        payload.assigneeType = 'employee';
        payload.userId = userId;
      } else if (source === 'guest') {
        payload.assigneeType = 'guest';
        payload.guestId = opt.getAttribute('data-guest-id');
      } else {
        payload.assigneeType = 'manual';
        payload.phone = opt.getAttribute('data-phone') || '';
      }
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

    // Decide how many slots to fill. Employee path on suite/club auto-pairs (always 2);
    // Guest/Manual on suite/club honors the ticket-count picker. Parking/Hotel: always 1.
    let ticketCount = 1;
    if (PAIRABLE_SLOT_TYPES.has(pendingSlot.slotType)) {
      if (payload.assigneeType === 'employee') {
        ticketCount = 2;
      } else if (type === 'guest' || type === 'manual') {
        ticketCount = parseInt(document.getElementById('assignTicketCount').value, 10) || 1;
      }
    }

    const slotNumbers = [pendingSlot.slotNumber];
    if (ticketCount === 2) {
      const other = findOpenSlotNumbers(pendingSlot.slotType)
        .find(n => n !== pendingSlot.slotNumber);
      if (other == null) {
        if (!confirm(`Only one ${slotTypeLabel(pendingSlot.slotType)} slot left — assign solo (just 1 ticket)?`)) return;
      } else {
        slotNumbers.push(other);
      }
    }

    try {
      for (const slotNumber of slotNumbers) {
        await Auth.apiRequest('/assignments', {
          method: 'POST',
          body: JSON.stringify({ ...payload, slotNumber }),
        });
      }
      closeAssignModal();
      openConcertDetail(currentConcert);
    } catch (err) {
      showAssignError(err.message);
      openConcertDetail(currentConcert);
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

  async function editManualAssignment(assignmentId) {
    let slot = null;
    for (const arr of Object.values(currentDetail?.slotGrids || {})) {
      const found = arr.find(s => s.assignmentId === assignmentId);
      if (found) { slot = found; break; }
    }
    if (!slot) { alert('Could not find that assignment.'); return; }
    const name = prompt('Name:', slot.name || '');
    if (name === null) return;
    if (!name.trim()) { alert('Name is required.'); return; }
    const email = prompt('Email:', slot.email || '');
    if (email === null) return;
    const phone = prompt('Phone:', slot.phone || '');
    if (phone === null) return;
    try {
      await Auth.apiRequest(`/assignments/${assignmentId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
      });
      openConcertDetail(currentConcert);
    } catch (err) {
      alert('Failed to update: ' + err.message);
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

  // ── Concert notes (autosave) ──────────────────────────────

  function setNotesStatus(text, kind) {
    const el = document.getElementById('notesStatus');
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === 'error' ? 'var(--red)' : 'var(--gray-500)';
  }

  function scheduleNotesSave() {
    setNotesStatus('Unsaved…');
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(saveNotesNow, 1200);
  }

  async function saveNotesNow() {
    clearTimeout(notesSaveTimer);
    notesSaveTimer = null;
    const el = document.getElementById('concertNotes');
    if (!el || !currentConcert) return;
    const value = el.value;
    if (value === lastSavedNotes) return;
    setNotesStatus('Saving…');
    try {
      await Auth.apiRequest(`/concerts/${currentConcert}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: value }),
      });
      lastSavedNotes = value;
      if (currentDetail?.concert) currentDetail.concert.notes = value;
      setNotesStatus('Saved');
      setTimeout(() => { if (lastSavedNotes === el.value) setNotesStatus(''); }, 2000);
    } catch (err) {
      setNotesStatus('Save failed: ' + err.message, 'error');
    }
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
      renderSubmissionMode(settings.submissionsStatus || 'closed');
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

  function renderSubmissionMode(mode) {
    const badge = document.getElementById('subsStatus');
    const labels = { open: 'OPEN', limited: 'LIMITED', closed: 'CLOSED' };
    const cls    = { open: 'badge-green', limited: 'badge-amber', closed: 'badge-red' };
    badge.textContent = labels[mode] || 'UNKNOWN';
    badge.className = `badge ${cls[mode] || 'badge-gray'}`;

    const buttons = {
      open: document.getElementById('modeOpenBtn'),
      limited: document.getElementById('modeLimitedBtn'),
      closed: document.getElementById('modeClosedBtn'),
    };
    const variant = { open: 'btn-success', limited: 'btn-amber', closed: 'btn-danger' };
    for (const [key, btn] of Object.entries(buttons)) {
      btn.className = `btn btn-sm ${mode === key ? variant[key] : 'btn-outline'}`;
    }
  }

  async function setSubmissionMode(mode) {
    try {
      await Auth.apiRequest('/settings/submissionsStatus', {
        method: 'PUT',
        body: JSON.stringify({ value: mode }),
      });
      showSettingsMsg(`Mode set to ${mode} ✓`);
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

  // ── All Submissions Spreadsheet ───────────────────────────

  const SUB_COLUMNS = [
    { key: 'lastName',       label: 'Last Name',  filter: 'text',    sortable: true },
    { key: 'firstName',      label: 'First Name', filter: 'text',    sortable: true },
    { key: 'location',       label: 'Location',   filter: 'text',    sortable: true },
    { key: 'submissionType', label: 'Type',       filter: 'select',
      options: [['', 'All'], ['employee', 'Employee'], ['external', 'External']], sortable: true },
    { key: 'choice1', label: 'Choice 1', filter: 'choice', choiceIdx: 0, sortable: true },
    { key: 'choice2', label: 'Choice 2', filter: 'choice', choiceIdx: 1, sortable: true },
    { key: 'choice3', label: 'Choice 3', filter: 'choice', choiceIdx: 2, sortable: true },
    { key: 'choice4', label: 'Choice 4', filter: 'choice', choiceIdx: 3, sortable: true },
    { key: 'choice5', label: 'Choice 5', filter: 'choice', choiceIdx: 4, sortable: true },
    { key: 'canEditFreely', label: 'Override', filter: 'select',
      options: [['', 'All'], ['yes', 'On'], ['no', 'Off']], sortable: true },
    { key: 'status', label: 'Status', sortable: false },
  ];

  const COLOR_OPTIONS = [
    ['', 'All'],
    ['attended',   '🟩 Attended'],
    ['assigned',   '🟨 Assigned'],
    ['unassigned', '⬜ No tickets'],
    ['empty',      '▢ Empty rank'],
  ];

  const DEALERSHIPS = [
    'Ford VW Audi', 'Honda Nissan Volvo', 'Kia', 'Value Center', 'CVC',
    'Corporate', 'Agency', 'Greenpoint', 'Automall', 'Chevy',
    '44 Downeast', 'Newport', 'Augusta', 'Brunswick',
  ];

  let subState = {
    data: [],
    dealerships: DEALERSHIPS,
    sortBy: 'lastName',
    sortDir: 'asc',
    search: '',
    statusFilter: 'active',
    filters: {},
  };

  function resetSubFilters() {
    subState.search = '';
    subState.filters = {
      lastName: '', firstName: '', location: '', submissionType: '',
      canEditFreely: '',
      choice1Text: '', choice1Color: '',
      choice2Text: '', choice2Color: '',
      choice3Text: '', choice3Color: '',
      choice4Text: '', choice4Color: '',
      choice5Text: '', choice5Color: '',
    };
  }

  function clearSubmissionsFilters() {
    resetSubFilters();
    const searchEl = document.getElementById('submissionsSearch');
    if (searchEl) searchEl.value = '';
    renderSubmissionsHeader();
    renderSubmissionsBody();
  }

  function onSubmissionsSearch(value) {
    subState.search = value || '';
    renderSubmissionsBody();
  }

  async function loadSubmissions() {
    document.getElementById('submissionsLoading').classList.remove('hidden');
    document.getElementById('submissionsWrap').classList.add('hidden');
    try {
      const includeTerminated = subState.statusFilter !== 'active' ? '&includeTerminated=1' : '';
      const result = await Auth.apiRequest(`/admin/all-submissions?season=2026${includeTerminated}`);
      subState.data = result?.submissions || [];
      if (result?.dealerships?.length) subState.dealerships = result.dealerships;
      resetSubFilters();
      subState.sortBy = 'lastName';
      subState.sortDir = 'asc';
      const searchEl = document.getElementById('submissionsSearch');
      if (searchEl) searchEl.value = '';
      renderSubmissionsHeader();
      renderSubmissionsBody();
      document.getElementById('submissionsWrap').classList.remove('hidden');
      document.getElementById('submissionsToolbar').classList.remove('hidden');
    } catch (err) {
      document.getElementById('submissionsLoading').innerHTML =
        `<div class="alert alert-error">Failed to load: ${err.message}</div>`;
      return;
    } finally {
      document.getElementById('submissionsLoading').classList.add('hidden');
    }
  }

  function renderSubmissionsHeader() {
    const headerRow = document.getElementById('submissionsHeader');
    const filterRow = document.getElementById('submissionsFilters');
    headerRow.className = 'sort-row';
    filterRow.className = 'filter-row';

    headerRow.innerHTML = SUB_COLUMNS.map(col => {
      if (col.sortable === false) return `<th>${col.label}</th>`;
      const active = subState.sortBy === col.key;
      const arrow = active ? (subState.sortDir === 'asc' ? '▲' : '▼') : '⇅';
      return `<th class="sort-header${active ? ' active' : ''}" data-col="${col.key}">
        ${col.label}<span class="sort-arrow">${arrow}</span>
      </th>`;
    }).join('');

    headerRow.querySelectorAll('th.sort-header').forEach(th => {
      th.onclick = () => {
        const k = th.getAttribute('data-col');
        if (subState.sortBy === k) {
          subState.sortDir = subState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          subState.sortBy = k;
          subState.sortDir = 'asc';
        }
        renderSubmissionsHeader();
        renderSubmissionsBody();
      };
    });

    filterRow.innerHTML = SUB_COLUMNS.map(col => {
      if (col.filter === 'text') {
        return `<th><input type="text" data-fk="${col.key}" placeholder="filter…" value="${escapeAttr(subState.filters[col.key] || '')}" /></th>`;
      }
      if (col.filter === 'select') {
        const opts = (col.options || []).map(([v, l]) =>
          `<option value="${v}" ${subState.filters[col.key] === v ? 'selected' : ''}>${l}</option>`).join('');
        return `<th><select data-fk="${col.key}">${opts}</select></th>`;
      }
      if (col.filter === 'choice') {
        const tk = `choice${col.choiceIdx + 1}Text`;
        const ck = `choice${col.choiceIdx + 1}Color`;
        const colorOpts = COLOR_OPTIONS.map(([v, l]) =>
          `<option value="${v}" ${subState.filters[ck] === v ? 'selected' : ''}>${l}</option>`).join('');
        return `<th>
          <input type="text" data-fk="${tk}" placeholder="filter name…" value="${escapeAttr(subState.filters[tk] || '')}" />
          <select data-fk="${ck}" style="margin-top:.2rem;">${colorOpts}</select>
        </th>`;
      }
      return '<th></th>';
    }).join('');

    filterRow.querySelectorAll('input[data-fk], select[data-fk]').forEach(el => {
      el.addEventListener('input', () => {
        subState.filters[el.getAttribute('data-fk')] = el.value;
        renderSubmissionsBody();
      });
      el.addEventListener('change', () => {
        subState.filters[el.getAttribute('data-fk')] = el.value;
        renderSubmissionsBody();
      });
    });
  }

  function passesFilters(row) {
    const f = subState.filters;
    const txtMatch = (val, q) => !q || (val || '').toString().toLowerCase().includes(q.toLowerCase());

    // Termination status (driven by the toolbar selector, not a column filter)
    const sf = subState.statusFilter || 'active';
    if (sf === 'active' && row.isTerminated) return false;
    if (sf === 'terminated' && !row.isTerminated) return false;

    // Global search: match across name, location, displayName, all choice names
    const search = (subState.search || '').trim().toLowerCase();
    if (search) {
      const haystack = [
        row.lastName, row.firstName, row.displayName, row.location,
        ...row.choices.map(c => c?.concertName || ''),
      ].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (!txtMatch(row.lastName, f.lastName))   return false;
    if (!txtMatch(row.firstName, f.firstName)) return false;
    if (!txtMatch(row.location, f.location))   return false;
    if (f.submissionType && row.submissionType !== f.submissionType) return false;
    if (f.canEditFreely === 'yes' && !row.canEditFreely) return false;
    if (f.canEditFreely === 'no'  &&  row.canEditFreely) return false;

    for (let i = 0; i < 5; i++) {
      const c = row.choices[i] || {};
      const txt = f[`choice${i+1}Text`];
      const col = f[`choice${i+1}Color`];
      if (txt && !txtMatch(c.concertName, txt)) return false;
      if (col === 'attended'   && !c.attended) return false;
      if (col === 'assigned'   && !c.assigned) return false;
      if (col === 'unassigned' && (!c.concertId || c.assigned)) return false;
      if (col === 'empty'      && c.concertId) return false;
    }
    return true;
  }

  function compareRows(a, b) {
    const k = subState.sortBy;
    const dir = subState.sortDir === 'asc' ? 1 : -1;
    let av, bv;
    if (k.startsWith('choice')) {
      const idx = parseInt(k.replace('choice', ''), 10) - 1;
      av = (a.choices[idx]?.concertName || '').toLowerCase();
      bv = (b.choices[idx]?.concertName || '').toLowerCase();
    } else if (k === 'canEditFreely') {
      av = a.canEditFreely ? 1 : 0;
      bv = b.canEditFreely ? 1 : 0;
    } else {
      av = (a[k] || '').toString().toLowerCase();
      bv = (b[k] || '').toString().toLowerCase();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    // Stable secondary sort by lastName/firstName
    const sec = (a.lastName + a.firstName).toLowerCase().localeCompare((b.lastName + b.firstName).toLowerCase());
    return sec;
  }

  // Render the slot-assignment badges for one All-Submissions choice cell.
  // Groups by slotType (so paired tickets read 'Club #12, #13') and falls back
  // to the legacy single-slot fields if the backend hasn't been updated.
  function renderChoiceSlotBadges(c) {
    let list = Array.isArray(c.assignments) ? c.assignments : null;
    if (!list || !list.length) {
      if (!c.slotType) return '';
      list = [{ slotType: c.slotType, slotNumber: c.slotNumber, attended: !!c.attended }];
    }
    const grouped = {};
    for (const a of list) {
      const g = grouped[a.slotType] = grouped[a.slotType] || { nums: [], attended: true };
      g.nums.push(a.slotNumber);
      if (!a.attended) g.attended = false;
    }
    return Object.entries(grouped).map(([slotType, g]) => {
      const cls = g.attended ? 'badge-green' : 'badge-amber';
      return `<span class="badge badge-tiny ${cls}" style="margin-left:.25rem;">${slotTypeLabel(slotType)} #${g.nums.join(', #')}</span>`;
    }).join('');
  }

  function renderSubmissionsBody() {
    const tbody = document.getElementById('submissionsBody');
    const rows = subState.data.filter(passesFilters).sort(compareRows);
    document.getElementById('submissionsCount').textContent =
      `${rows.length} of ${subState.data.length}`;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${SUB_COLUMNS.length}" style="text-align:center;padding:1.5rem;color:var(--gray-400);">No rows match these filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const typeLabel = row.submissionType === 'external'
        ? '<span class="badge badge-gray badge-tiny">External</span>'
        : '<span class="badge badge-blue badge-tiny">Employee</span>';
      const overrideCell = row.submissionType === 'external'
        ? '<span class="text-muted text-xs">—</span>'
        : `<span class="override-toggle ${row.canEditFreely ? 'on' : ''}"
                 title="${row.canEditFreely ? 'Override is ON — click to turn off' : 'Click to grant full edit access'}"
                 onclick="Admin.toggleOverride('${row.userId}', ${!row.canEditFreely})"></span>`;

      const choiceCells = row.choices.map(c => {
        if (!c.concertId) {
          return `<td class="choice-cell"><span class="choice-empty">—</span></td>`;
        }
        const cls = ['choice-cell'];
        if (c.attended) cls.push('attended');
        else if (c.assigned) cls.push('assigned');
        if (c.concertStatus === 'cancelled') cls.push('cancelled');
        const slotInfo = c.assigned ? renderChoiceSlotBadges(c) : '';
        return `<td class="${cls.join(' ')}">
          <span class="choice-name">${c.concertName}${slotInfo}</span>
          <span class="choice-date">${formatDate(c.concertDate)}</span>
        </td>`;
      }).join('');

      let locationCell;
      if (row.submissionType === 'external') {
        // External submitters: location is part of the submission, not editable
        locationCell = row.location
          ? `<td>${escapeAttr(row.location)}</td>`
          : `<td><span class="text-muted">—</span></td>`;
      } else {
        const dealerships = subState.dealerships || DEALERSHIPS;
        const optParts = ['<option value="">— Set —</option>'];
        for (const d of dealerships) {
          optParts.push(`<option value="${escapeAttr(d)}" ${row.location === d ? 'selected' : ''}>${d}</option>`);
        }
        // If location is set to something not in our dealership list (e.g., from Entra
        // companyName with different wording), preserve it as a selected custom option
        if (row.location && !dealerships.includes(row.location)) {
          optParts.push(`<option value="${escapeAttr(row.location)}" selected>${escapeAttr(row.location)} (Entra)</option>`);
        }
        locationCell = `<td><select class="form-control" style="font-size:.78rem;padding:.15rem .3rem;"
          onchange="Admin.setEmployeeLocation('${row.userId}', this.value)">${optParts.join('')}</select></td>`;
      }

      let statusCell;
      if (row.submissionType === 'external') {
        statusCell = '<span class="text-muted text-xs">—</span>';
      } else if (row.isTerminated) {
        statusCell = `<span class="badge badge-tiny" style="background:#fee2e2;color:#991b1b;">Terminated</span>
          <button class="btn btn-sm btn-outline" style="margin-left:.3rem;" onclick="Admin.terminateEmployee('${row.userId}', false)">Reinstate</button>`;
      } else {
        statusCell = `<button class="btn btn-sm btn-danger" onclick="Admin.terminateEmployee('${row.userId}', true)">Terminate</button>`;
      }

      return `<tr data-userid="${row.userId}">
        <td>${row.lastName || '<span class="text-muted">—</span>'}</td>
        <td>${row.firstName || '<span class="text-muted">—</span>'}</td>
        ${locationCell}
        <td>${typeLabel}</td>
        ${choiceCells}
        <td style="text-align:center;">${overrideCell}</td>
        <td style="text-align:center;white-space:nowrap;">${statusCell}</td>
      </tr>`;
    }).join('');
  }

  async function setEmployeeLocation(userId, location) {
    const row = subState.data.find(r => r.userId === userId);
    if (!row) return;
    const prev = row.location;
    row.location = location;
    // Don't re-render the whole body — the select already shows the new value, and re-rendering
    // would steal focus / collapse the dropdown
    try {
      await Auth.apiRequest(`/employees/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ location }),
      });
    } catch (err) {
      row.location = prev;
      renderSubmissionsBody();
      alert('Failed to save location: ' + err.message);
    }
  }

  async function toggleOverride(userId, newValue) {
    const row = subState.data.find(r => r.userId === userId);
    if (!row) return;
    const prev = row.canEditFreely;
    row.canEditFreely = newValue;
    renderSubmissionsBody();
    try {
      await Auth.apiRequest(`/employees/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ canEditFreely: newValue }),
      });
    } catch (err) {
      row.canEditFreely = prev;
      renderSubmissionsBody();
      alert('Failed to update override: ' + err.message);
    }
  }

  function setSubmissionsStatusFilter(value) {
    subState.statusFilter = value || 'active';
    // 'active' uses the default (terminated excluded server-side); the others need
    // the full set, so reload from the API rather than just re-filtering client-side.
    loadSubmissions();
  }

  async function terminateEmployee(userId, terminate) {
    const row = subState.data.find(r => r.userId === userId);
    const who = row ? (`${row.firstName} ${row.lastName}`.trim() || row.displayName || 'this employee') : 'this employee';
    if (terminate) {
      if (!confirm(`Terminate ${who}?\n\nThey will be removed from all entry, request, and assignment lists, and any ticket/parking slots they currently hold will be freed for reassignment.\n\nThis does not delete their record — you can reinstate them later, but freed slots are NOT automatically restored.`)) return;
    } else {
      if (!confirm(`Reinstate ${who}? They will reappear in the lists. Previously freed slots are NOT restored.`)) return;
    }
    try {
      const result = await Auth.apiRequest(`/employees/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ isTerminated: terminate }),
      });
      await loadSubmissions();
      if (terminate) {
        const freed = result?.freedSlots || [];
        const summary = freed.length
          ? 'Freed slots:\n' + freed.map(f =>
              `• ${slotTypeLabel(f.slotType)} #${f.slotNumber} — ${f.concertName}${f.concertDate ? ' (' + formatDate(f.concertDate) + ')' : ''}`).join('\n')
          : 'No assigned slots to free.';
        alert(`${who} terminated.\n\n${summary}`);
      }
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  }

  async function syncTerminations() {
    if (!confirm('Sync with Entra (Azure AD)?\n\nEmployees whose Azure accounts are disabled or deleted will be terminated and their slots freed.')) return;
    try {
      const result = await Auth.apiRequest('/admin/sync-terminations', { method: 'POST', body: '{}' });
      const n = result?.terminatedCount || 0;
      let msg = `Entra sync complete. Checked ${result?.checked ?? 0} employee(s), terminated ${n}.`;
      if (n) {
        msg += '\n\n' + (result.terminated || []).map(t =>
          `• ${t.displayName || t.userId} — ${(t.freedSlots || []).length} slot(s) freed`).join('\n');
      }
      if (result?.errors?.length) msg += `\n\n${result.errors.length} lookup error(s) — see CloudWatch.`;
      await loadSubmissions();
      alert(msg);
    } catch (err) {
      alert('Entra sync failed: ' + err.message);
    }
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

  async function cancelConcert(concertId) {
    const name = concerts.find(c => c.concertId === concertId)?.name || concertId;
    const msg = `Cancel "${name}"?\n\n` +
      `• It will be hidden from the employee picker\n` +
      `• Any existing ticket assignments for this concert will be deleted\n` +
      `• Employees who had it in their top-5 will see a "CANCELLED — pick a replacement" notice\n\n` +
      `Continue?`;
    if (!confirm(msg)) return;
    try {
      const result = await Auth.apiRequest(`/concerts/${concertId}/cancel`, {
        method: 'POST', body: JSON.stringify({}),
      });
      alert(`✓ ${result.message}`);
      loadConcerts();
    } catch (err) {
      alert('Cancel failed: ' + err.message);
    }
  }

  async function toggleAttended(assignmentId, newValue) {
    if (!currentDetail) return;
    let target = null;
    for (const [key, slots] of Object.entries(currentDetail.slotGrids || {})) {
      const idx = slots.findIndex(s => s.assignmentId === assignmentId);
      if (idx !== -1) { target = { key, idx }; break; }
    }
    if (!target) return;
    const slot = currentDetail.slotGrids[target.key][target.idx];
    const previous = !!slot.attended;
    slot.attended = !!newValue;
    renderAllSlotGrids(currentDetail.slotGrids, currentDetail.concert, currentEmployeeMap);
    try {
      await Auth.apiRequest(`/assignments/${assignmentId}`, {
        method: 'PUT',
        body: JSON.stringify({ attended: !!newValue }),
      });
    } catch (err) {
      slot.attended = previous;
      renderAllSlotGrids(currentDetail.slotGrids, currentDetail.concert, currentEmployeeMap);
      alert('Failed to update attendance: ' + err.message);
    }
  }

  async function uncancelConcert(concertId) {
    const name = concerts.find(c => c.concertId === concertId)?.name || concertId;
    const msg = `Restore "${name}"?\n\n` +
      `It will reappear in the employee picker. Anyone who had it ranked still has it ranked.\n\n` +
      `Heads up: assignments removed when you cancelled are NOT restored — you'll need to re-assign tickets.\n\n` +
      `Continue?`;
    if (!confirm(msg)) return;
    try {
      const result = await Auth.apiRequest(`/concerts/${concertId}/uncancel`, {
        method: 'POST', body: JSON.stringify({}),
      });
      alert(`✓ ${result.message}`);
      loadConcerts();
    } catch (err) {
      alert('Uncancel failed: ' + err.message);
    }
  }

  async function quickAssign(userId, name, email, slotType) {
    const open = findOpenSlotNumbers(slotType);
    const label = slotTypeLabel(slotType);
    if (open.length === 0) {
      alert(`No open ${label} slots available.`);
      return;
    }
    let slotNumbers;
    if (open.length === 1) {
      if (!confirm(`Only one ${label} slot left — assign solo (just 1 ticket)?`)) return;
      slotNumbers = [open[0]];
    } else {
      slotNumbers = [open[0], open[1]];
    }
    try {
      for (const slotNumber of slotNumbers) {
        await Auth.apiRequest('/assignments', {
          method: 'POST',
          body: JSON.stringify({
            concertId: currentConcert,
            slotType, slotNumber,
            assigneeType: 'employee',
            userId, name, email,
          }),
        });
      }
      await openConcertDetail(currentConcert);
    } catch (err) {
      alert('Failed to assign: ' + err.message);
      await openConcertDetail(currentConcert);
    }
  }

  return {
    init, showTab,
    showList, openConcertDetail,
    toggleSlotEdit, saveSlotConfig,
    openAssignModal, closeAssignModal, onAssignTypeChange, saveAssignment, removeAssignment, editManualAssignment, quickAssign, toggleAttended,
    exportSectionEmails, exportSectionEmployeeNames, exportAllEmails, printCheckinSheet,
    addHotelRoomInput, reindexHotelRooms,
    seedConcerts, showAddConcert, editConcertDetails, cancelConcert, uncancelConcert,
    scheduleNotesSave, saveNotesNow,
    loadGuests, showGuestModal, closeGuestModal, saveGuest, deleteGuest,
    showGuestAssignModal, closeGuestAssignModal, onGuestAssignConcertChange, onGuestAssignSlotTypeChange, saveGuestAssignment,
    loadSettings, setSubmissionMode, saveSeason, saveFromEmail,
    loadSubmissions, toggleOverride, setEmployeeLocation,
    onSubmissionsSearch, clearSubmissionsFilters,
    setSubmissionsStatusFilter, terminateEmployee, syncTerminations,
  };
})();
