// broke PRE-SUBMIT CHECKS — paste into the Chrome tab of the platform (javascript_tool).
// Every function returns a plain-text report. Anything under "MUST FIX" blocks submission.
// Owner: Claude. Keep in sync with claude/release-protocol.md (section 0b).

// ---------------------------------------------------------------- SoundOn
// v1.0.62 (SAHXL REMARKABLE 10/29): an edit of a DELIVERED SoundOn release has no saved draft until the final Submit, so
// the API still returns the LIVE (old) values. SoundOn's own "Confirm the changes to <title>" dialog (opened by the page's
// Submit) lists Before / After of every changed field: read it from the open dialog in this tab (no network).
function soundonEditDiff() {
  const dlg = [...document.querySelectorAll('[role=dialog], [role=alertdialog], .semi-modal, .semi-modal-content, .modal')].find(d => /Confirm the changes to/i.test(d.innerText || ''));
  if (!dlg) return null;
  const cellsOf = r => [...r.children].map(c => (c.innerText || '').trim());
  let rows = [...dlg.querySelectorAll('tr, [role=row]')].map(cellsOf);
  if (!rows.length) rows = [...dlg.querySelectorAll('[class*=row]')].map(cellsOf);
  const out = [];
  for (const c of rows) {
    if (c.length < 3 || !c[0]) continue;
    if (/^before$/i.test(c[1]) || /^after$/i.test(c[2])) continue; // header row
    const list = x => String(x || '').split(/\n|,\s*/).map(s => s.trim()).filter(s => s && s !== '-' && s !== '—');
    out.push({ field: c[0].replace(/\s+/g, ' '), before: list(c[1]), after: list(c[2]) });
  }
  return out;
}
window.soundonEditDiff = soundonEditDiff;
// field label in the dialog -> SoundOn role number (credits) or a release field
const SO_EDIT_ROLE = [[/^vocal/i, 5], [/^programm/i, 44], [/^producer/i, 2], [/^beat ?maker/i, 6], [/^featur/i, 1]];
const SO_EDIT_COMP = /songwriter|lyricist|composer|writer/i;
const soEditOpenFor = id => { try { return /source=sound-on/i.test(location.search) && new URLSearchParams(location.search).get('id') === String(id); } catch { return false; } };
// Run in a soundon.global tab. draftOrAlbumId = the release being submitted (draft id or album id),
// precedentAlbumId = the artist's last SoundOn release — used ONLY for the store list and format settings.
// opts: { title, date:'YYYY-MM-DD' (both REQUIRED, from the card), local:true, clipStartMs:0, lyricsRequired:true, explicit:1|2|3 }
// Precedent is used ONLY for the store list and format settings. A field missing from the API is not a MUST FIX
// unless the card or the live form requires it (Mistakes Log #24).
async function soundonPrecheck(draftOrAlbumId, precedentAlbumId, opts = {}) {
  const o = Object.assign({ local: true, clipStartMs: 0, lyricsRequired: true }, opts);
  const getAny = async (id) => {
    let r = await fetch('/api/draft-release?draftReleaseId=' + id); let j = await r.json().catch(() => null);
    if (j && (j.album || j.tracks)) return j;
    r = await fetch('/api/release?albumID=' + id); return await r.json();
  };
  const flat = (x, p = '', a = {}) => { if (x && typeof x === 'object') { for (const k in x) { if (/url|uri|cover|avatar|waveform|md5|vid$|token/i.test(k)) continue; flat(x[k], p ? p + '.' + k : k, a); } } else a[p] = x; return a; };
  const D = await getAny(draftOrAlbumId), P = await getAny(precedentAlbumId);
  const dA = D.album || D.data?.album || D, dT = (D.tracks || dA.tracks || [])[0] || {};
  const must = [], info = [];
  // v1.0.62: edit of a delivered release: the edited values come from SoundOn's open "Confirm the changes" dialog.
  if (soEditOpenFor(draftOrAlbumId)) {
    const diff = soundonEditDiff();
    if (!diff) must.push("open SoundOn's confirm dialog first (the page's Submit) - on an edit of a delivered release the gate reads the edited values from it");
    else {
      const allowed = Array.isArray(o.allowedChanges) ? o.allowedChanges.map(x => String(x).toLowerCase()) : null;
      if (!diff.length) must.push('the confirm dialog lists no changes - nothing to submit');
      for (const r of diff) {
        info.push('EDIT ' + r.field + ': ' + r.before.join(' / ') + ' -> ' + r.after.join(' / '));
        if (allowed && !allowed.some(a => r.field.toLowerCase().startsWith(a))) must.push('unplanned change in the confirm dialog: ' + r.field + ' (allowedChanges: ' + allowed.join(', ') + ')');
        const a0 = r.after.join(' ').trim();
        if (/^(release |track )?title$/i.test(r.field)) { dT.title = a0; dA.title = a0; }
        if (/^explicit/i.test(r.field)) dT.explicitness = /non|not/i.test(a0) ? 3 : /clean/i.test(a0) ? 2 : /explicit/i.test(a0) ? 1 : dT.explicitness;
        if (/release (date|time)/i.test(r.field)) { const ms = Date.parse(a0); if (isNaN(ms)) must.push('could not read the new release date "' + a0 + '" from the confirm dialog - check it by eye'); else dA.releaseDate = new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString(); }
        if (/platform|store/i.test(r.field)) must.push('store / platform change in the confirm dialog: the gate cannot verify it from the dialog - check it by eye and confirm with Zain');
      }
    }
  }
  const stores = (dA.stores || []).map(String), pStores = ((P.album || P).stores || []).map(String);
  if (stores.includes('1028')) must.push('YouTube Music (store 1028) is selected — untick it (YouTube goes via the LE dupe)');
  const extra = stores.filter(s => !pStores.includes(s)), missing = pStores.filter(s => !stores.includes(s));
  if (extra.length) must.push('Stores not on precedent: ' + extra.join(','));
  if (missing.length) must.push('Precedent stores missing: ' + missing.join(','));
  if (o.local && dA.releaseTimeType !== 2) must.push('Timing is GLOBAL (releaseTimeType=' + dA.releaseTimeType + ') — default is LOCAL (2)');
  if (dT.optInYouTubeContentID) must.push('YouTube Content ID is ON — must be off');
  if (!dT.optInCML) must.push('Commercial Music Licensing is OFF — turn on');
  if (!dT.capcutIntention) must.push('CapCut is OFF — turn on');
  if (o.lyricsRequired && !(dT.lyrics || '').trim()) must.push('Lyrics empty — search email/texts/Drive; only skip if none exist (say so)');
  const clips = dT.clipAudios || [];
  if (!clips.length) must.push('No TikTok clip');
  else if (clips[0].startTime !== o.clipStartMs) must.push('TikTok clip starts at ' + clips[0].startTime + 'ms, expected ' + o.clipStartMs + 'ms (0:00 unless specified for THIS song)');
  // v1.0.54: a draft reads Non-Explicit as 0 (released albums use 3); treat 0 and 3 as the same. explicit:0 is checked too.
  const _ex = v => (v === 0 || v === '0') ? 3 : Number(v);
  if (o.explicit != null && _ex(dT.explicitness) !== _ex(o.explicit)) must.push('Explicit flag = ' + dT.explicitness + ', expected ' + o.explicit + ' (1 Explicit, 2 Clean, 3 or 0 Non-explicit)');
  // existLocalSociety / mccFullSongIntention: older releases (e.g. Chill) have them, but SoundOn's current form
  // no longer asks these questions on our label account (checked 10/19) — expected diff, not a MUST FIX.
  // If the questions ever appear on the form: PRO = No unless known, full-song licensing ON.
  // Publisher / label / clip are on today's form and required by the card, so missing = MUST FIX.
  if (!(dA.publishers || []).length) must.push('Publisher empty');
  if (!dA.recordLabel) must.push('Record label empty');
  if ((dT.fullAudio || {}).duration == null) must.push('No audio');
  // format diff vs precedent (stores/settings only — explain each line)
  // Credits are NOT compared to the precedent (Mistakes Log #25) — run cardCreditCheck against the release card.
  // Card values (required): opts.title, opts.date ('YYYY-MM-DD')
  if (!o.title) must.push('opts.title not given — pass the title from the release card');
  else if ((dT.title || dA.title || '').trim() !== o.title.trim()) must.push(`Title = "${dT.title || dA.title}", card says "${o.title}"`);
  const soDateISO = v => { if (!v) return ''; if (typeof v === 'string') return v; if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString(); if (typeof v === 'object') { if (v.formatted) return String(v.formatted); const t = v.timestamp ?? v.time ?? v.seconds ?? v.value; if (t !== undefined && t !== null && !isNaN(+t)) return +t > 1e12 ? new Date(+t).toISOString() : new Date((+t + (v.localTimezoneOffset || 0) * -1) * 1000).toISOString(); } return ''; };
  const rd = soDateISO(dA.releaseDate) || soDateISO(dA.releaseTime);
  if (!o.date) must.push('opts.date not given — pass the release date from the release card');
  else if (!rd) must.push('Release date could not be read from SoundOn - check it on the page and report');
  else if (!rd.startsWith(o.date)) must.push(`Release date = "${rd}", card says ${o.date}`);
  if (dT.publishingPercentage !== undefined && dT.publishingPercentage !== 10000) must.push('Writing share is not 100% (needed for CML/CapCut)');
  if (clips[0] && clips[0].endTime - clips[0].startTime > 60000) must.push('TikTok clip longer than 60s');
  const strip = R => JSON.parse(JSON.stringify(R, (k, v) => /^(contributors|uniContributorObjects|songwritersName|songwriters|artists|artistObjects)$/.test(k) ? undefined : v));
  const F = flat(strip(D)), G = flat(strip(P));
  const ign = /(^|\.)(id|ID|Id|albumID|trackID|userID|userId|draftReleaseId|createTime|updateTime|timestamp|duration|size|title|draftTitle|name|lyrics|isrc|upc|status|releaseStatus|startTime|endTime|sequence|draftProgress|formatted)$/i;
  const norm = k => k.replace(/^(data\.)?/, '').replace(/^tracks\.0\.album\./, 'album.');
  const Fn = {}, Gn = {}; for (const k in F) Fn[norm(k)] = F[k]; for (const k in G) Gn[norm(k)] = G[k];
  for (const k of new Set([...Object.keys(Fn), ...Object.keys(Gn)])) {
    if (ign.test(k) || /externalInfo|stores\./.test(k)) continue;
    if (String(Fn[k]) !== String(Gn[k])) info.push(k + ': this=' + String(Fn[k]).slice(0, 50) + ' | precedent=' + String(Gn[k]).slice(0, 50));
  }
  return ['SOUNDON PRECHECK ' + draftOrAlbumId + ' vs ' + precedentAlbumId,
    must.length ? 'MUST FIX:\n- ' + must.join('\n- ') : 'MUST FIX: none',
    'DIFFS vs precedent (confirm each is intended):\n- ' + (info.join('\n- ') || 'none')].join('\n\n')
    .replace(/https?:\S+/g, '[link]').replace(/[=&?]/g, '_'); // the browser tool blocks output that looks like query strings
}
window.soundonPrecheck = soundonPrecheck;

// ---------------------------------------------------------------- Label Engine
// Run in a label-engine.com tab (logged in). Compares the review pages of the new release and the
// precedent line by line (stores, credits, splits, P/C, dates show up on review_release.php).
async function lePrecheck(releaseId, precedentId) {
  const txt = async id => { const t = await (await fetch('/review_release.php?release_id=' + id)).text(); const d = new DOMParser().parseFromString(t, 'text/html'); return d.body.innerText.split('\n').map(s => s.trim()).filter(Boolean); };
  const A = await txt(releaseId), B = await txt(precedentId);
  if (A.some(l => /Get Started|Sign In/.test(l)) && !A.some(l => /Logout|Log out/i.test(l))) return 'LE: LOGGED OUT — ask Zain to log in';
  const onlyA = A.filter(l => !B.includes(l)), onlyB = B.filter(l => !A.includes(l));
  const flags = [];
  if (A.some(l => /Beatport|Traxsource/i.test(l)) && !B.some(l => /Beatport|Traxsource/i.test(l))) flags.push('Beatport/Traxsource selected but not on precedent');
  return ['LE PRECHECK ' + releaseId + ' vs ' + precedentId, 'FLAGS: ' + (flags.join('; ') || 'none'),
    'ONLY ON THIS RELEASE:\n- ' + onlyA.slice(0, 120).join('\n- '),
    'ONLY ON PRECEDENT:\n- ' + onlyB.slice(0, 120).join('\n- ')].join('\n\n').replace(/[=&?]/g, '_');
}

// ---------------------------------------------------------------- CREDITS vs THE RELEASE CARD (blocking, every platform)
// The card is the ONLY expected source (built from monday / agreements / texts / email). Platforms are never
// compared to each other or to a precedent (Mistakes Log #25: LE matched SoundOn, both could be wrong).
// cardCredits = { performer:[artist names], production:[artist names], composition:[LEGAL names] }
// Readers:  SoundOn tab → await soundonCredits(albumId, trackIndex)   LE tab → await leCredits(releaseId, trackId)
// Check:    cardCreditCheck('LE ZA0612', cardCredits, platformJson)   → "CARD CREDIT CHECK ..." + MUST FIX
const _norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
async function soundonCredits(albumId, trackIndex = 0) {
  let j = await (await fetch('/api/release?albumID=' + albumId)).json().catch(() => ({}));
  if (!(j.album || j.tracks)) j = await (await fetch('/api/draft-release?draftReleaseId=' + albumId)).json().catch(() => ({}));
  const t = (j.tracks || (j.album || j).tracks || [])[trackIndex] || {};
  const PERF = [5, 44]; // v1.0.59: Vocalist, Programmer (performing roles)
  const known = [...PERF, 1, 2, 3, 6, 7, 8, 9, 10, 11]; // 1 featured, 3/7 engineering/mix roles seen on our releases
  // v1.0.54: a DRAFT lists credits as uniContributorObjects [{name, role}]; a released album as contributors [{artistNames, role}].
  let cs = [...(t.contributors || []), ...(t.uniContributorObjects || [])].map(c => ({ role: Number(c.role), names: c.artistNames || (c.name != null ? [c.name] : []) }));
  const uniq = a => [...new Set(a.map(s => String(s).trim()).filter(Boolean))].sort();
  // v1.0.62: delivered-release edit with SoundOn's confirm dialog open: the dialog's After list REPLACES that role's live names.
  const diff = soEditOpenFor(albumId) ? soundonEditDiff() : null, used = [];
  let compAfter = null, compBefore = [];
  for (const r of diff || []) {
    const hit = SO_EDIT_ROLE.find(([re]) => re.test(r.field));
    if (hit) { cs = cs.filter(c => c.role !== hit[1]); if (r.after.length) cs.push({ role: hit[1], names: r.after }); used.push(r.field); }
    else if (SO_EDIT_COMP.test(r.field)) { compAfter = [...(compAfter || []), ...r.after]; compBefore = [...compBefore, ...r.before]; used.push(r.field); }
  }
  const by = r => cs.filter(c => r.includes(c.role)).flatMap(c => c.names);
  const unknown = cs.filter(c => !known.includes(c.role)).map(c => c.names.join('/') + ':role' + c.role);
  let composition = uniq([...by([10, 11]), ...(t.songwritersName || []), ...(t.lyricistsName || [])]);
  if (compAfter) composition = uniq([...composition.filter(n => !compBefore.map(_norm).includes(_norm(n))), ...compAfter]);
  return JSON.stringify({ source: 'SoundOn ' + albumId + ' track ' + trackIndex + (used.length ? ' live + edit dialog (' + used.join(', ') + ')' : ''),
    performer: uniq(by(PERF)), production: uniq(by([2, 6, 8, 9])), composition, unknownRoles: unknown });
}
window.soundonCredits = soundonCredits;
async function leCredits(releaseId, trackId) {
  const d = new DOMParser().parseFromString(await (await fetch(`/distribute_track.php?release_id=${releaseId}&track_id=${trackId}`)).text(), 'text/html');
  const L = { source: 'LE ' + releaseId + '/' + trackId, performer: [], production: [], composition: [] };
  d.querySelectorAll('[name*="_members_"][name*="_real_name_"]').forEach(n => {
    const base = n.name.replace(/real_name_(\d+)$/, ''), i = n.name.match(/(\d+)$/)[1];
    for (const k of ['performer', 'production', 'composition']) {
      const s = d.querySelector(`[name^="${base}${k}_roles_ids_${i}"]`);
      const v = !s ? '' : (s.tagName === 'SELECT' ? [...s.selectedOptions].map(o => o.value).join(',') : s.value);
      if (v && v.trim() && !L[k].includes(n.value.trim())) L[k].push(n.value.trim());
    }
  });
  return JSON.stringify(L);
}
window.leCredits = leCredits;
function cardCreditCheck(label, cardCredits, platformJson) {
  const C = typeof cardCredits === 'string' ? JSON.parse(cardCredits) : cardCredits;
  const P = typeof platformJson === 'string' ? JSON.parse(platformJson) : platformJson;
  const must = [];
  for (const k of ['performer', 'production', 'composition']) {
    const c = (C[k] || []).map(_norm), p = (P[k] || []).map(_norm);
    if (k !== 'production' && !c.length) must.push(`card has no ${k} credits — fill the card first`);
    if (k !== 'production' && !p.length) must.push(`platform has no ${k} credits (wrong id or empty page?)`);
    (C[k] || []).filter(n => !p.includes(_norm(n))).forEach(n => must.push(`${k}: "${n}" is on the CARD but MISSING on the platform`));
    (P[k] || []).filter(n => !c.includes(_norm(n))).forEach(n => must.push(`${k}: "${n}" is on the platform but NOT on the card`));
  }
  (P.unknownRoles || []).forEach(r => must.push('unmapped SoundOn role ' + r + ' — check it against the card'));
  return `CARD CREDIT CHECK ${label} (${P.source || ''})\n` + (must.length ? 'MUST FIX:\n- ' + must.join('\n- ') : 'MUST FIX: none') +
    `\ncard: ${JSON.stringify({ performer: C.performer, production: C.production, composition: C.composition })}`;
}
window.cardCreditCheck = cardCreditCheck;

// ---------------------------------------------------------------- LE GATE vs the release card (not vs precedent)
// expected = { upc, isrc, title, artist, explicit:'Yes'|'No'|'This is a cleaned version of an explicit track', p, c,
//              date:'30 Oct 2026', stores:['YouTube Content Monetization', ...] (exact set), splits:{artist:'50.00', label:'50.00'} }
async function leGate(releaseId, trackId, expected, cache) {
  const C = cache || {};
  const P = (u) => (C[u] ??= fetch(u).then(r => r.text()).then(x => new DOMParser().parseFromString(x, 'text/html')));
  const R = await P('/distribute_release.php?release_id=' + releaseId), T = await P(`/distribute_track.php?release_id=${releaseId}&track_id=${trackId}`), V = await P('/review_release.php?release_id=' + releaseId);
  const v = (d, n) => { const e = d.querySelector(`[name="${n}"]`); return e ? (e.tagName === 'SELECT' ? (e.selectedOptions[0]?.text || '') : e.value).trim() : undefined; };
  const s = V.body.innerText.replace(/\s+/g, ' ');
  const got = {
    upc: v(R, 'upc'), isrc: v(T, 'isrc'), title: v(T, 'title'), artistRaw: (s.match(/Release Artist:\s*(.*?)\s*Release Title:/) || [])[1],
    explicit: v(T, 'explicit'), p: v(T, 'p_line'), c: v(T, 'c_line'), relP: v(R, 'p_line'), relC: v(R, 'c_line'),
    artistPct: v(T, 'artist_percentage_0'), labelPct: v(T, 'label_percentage'),
  };
  // LE's own lowercase/capitalisation warning ("Is this field supposed to be all lowercase? … Like This.") is not part of the name.
  const lcWarn = /\s*Is this field supposed to be[\s\S]*$/i;
  got.artist = got.artistRaw === undefined ? undefined : got.artistRaw.replace(lcWarn, '').trim();
  const artistNote = got.artistRaw && lcWarn.test(got.artistRaw) ? `Release artist "${got.artist}": LE shows its capitalisation warning (info only — the card's spelling is what counts)` : '';
  // stores: distribution_history.php works before AND after submit. Row = ['', name, category, domain, status].
  const H = await P(`/distribution_history.php?release_id=${releaseId}&allow_edit=`);
  const allRows = [...H.querySelectorAll('tr')].map(r => [...r.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g, ' ').trim()))
    .filter(c => c.length === 5 && c[1] && /\./.test(c[3]));
  // Never submitted = every row is "Not distributed" (selected) or "Not Requested" (unselected).
  const notSel = (st) => /^Not Requested$|not permitted|not available|unavailable/i.test(st); got.readyDraft = /ready to be submitted for distribution/i.test(H.body.textContent || ''); got.preSubmit = allRows.length > 0 && (got.readyDraft || allRows.every(c => /^Not distributed$/i.test(c[4]) || notSel(c[4])));
  got.storeRows = got.preSubmit ? allRows.filter(c => /^Not distributed$/i.test(c[4])) : allRows.filter(c => !/Not Requested|Not distributed/i.test(c[4]) && !notSel(c[4]));
  // v1.0.5 (lucille 10/19): before submit, history lists stores this label isn't even offered (Beatport, Traxsource, Sirius XM,
  // SoundCloud Copyright Protection) as "Not distributed". The truth is the CHECKED boxes on release_stores.php.
  if (got.preSubmit) {
    const SP = await P('/release_stores.php?release_id=' + releaseId);
    const checked = [...SP.querySelectorAll('input[type=checkbox][name^="store_id_"]')].filter(b => b.checked)
      .map(b => [...(b.closest('tr')?.querySelectorAll('td') ?? [])].map(td => td.innerText.replace(/\s+/g, ' ').trim())).filter(c => c[1]);
    if (checked.length) {
      const key = (c) => (c[1] + '|' + c[3]).toLowerCase();
      const on = new Set(checked.map(key));
      got.unofferedIgnored = got.storeRows.filter(c => !on.has(key(c))).map(c => c[1]);
      got.storeRows = got.storeRows.filter(c => on.has(key(c)));
      got.storeSource = 'release_stores.php (checked)';
    }
  }
  got.stores = got.storeRows.map(c => c[1]);
  const must = [];
  for (const k of ['title', 'artist', 'explicit', 'date', 'stores', 'upc', 'isrc', 'payees']) if (expected[k] === undefined) must.push(`expected.${k} not given — fill it from the release card${k === 'payees' ? ' (every row with a % on this track: [{name, pct}], incl. JV partner rows like Run Things)' : ''}`);
  const eq = (k, a, b) => { if (b !== undefined && String(a ?? '').trim() !== String(b).trim()) must.push(`${k}: LE="${a}" expected="${b}"`); };
  // upc/isrc: a code from the card, or 'AUTO' when the card says auto-generate (full LE releases).
  if (expected.upc === 'AUTO') { if (!/AUTO/i.test(got.upc || '')) must.push(`UPC should be auto-generate, LE has "${got.upc}"`); } else eq('UPC', got.upc, expected.upc);
  if (expected.isrc === 'AUTO') { if (v(T, 'isrc_auto') === undefined && got.isrc) must.push(`ISRC should be auto-generate, LE has "${got.isrc}"`); } else eq('ISRC', got.isrc, expected.isrc); eq('Track title', got.title, expected.title); eq('Release artist', got.artist, expected.artist);
  eq('Explicit', got.explicit, expected.explicit);
  // P/C lines (Zain 10/19): BLANK is intentional — LE applies the label's default P/C — so blank is never a MUST FIX.
  // Only a FILLED line that differs from the card's explicit value is. Card p/c omitted or 'DEFAULT' = default expected.
  const pcInfo = [];
  const pc = (k, a, b) => {
    const val = String(a ?? '').trim(), want = b === undefined || /^default$/i.test(String(b).trim()) ? undefined : String(b).trim();
    if (!val) pcInfo.push(`${k}: blank → label default applies`);
    else if (want === undefined) pcInfo.push(`${k}: LE="${val}" (card: label default)`);
    else if (val !== want) must.push(`${k}: LE="${val}" expected="${want}" (or leave it blank for the label default)`);
  };
  pc('Track P', got.p, expected.p); pc('Track C', got.c, expected.c ?? expected.p); pc('Release P', got.relP, expected.p); pc('Release C', got.relC, expected.c ?? expected.p);
  if (!got.storeRows.length) must.push('Could not read any selected stores (distribution_history) — check manually');
  if (expected.stores) {
    expected.stores.filter(n => !got.stores.includes(n)).forEach(n => must.push(`Store missing: ${n}`));
    got.stores.filter(n => !expected.stores.includes(n)).forEach(n => must.push(`Store not expected: ${n}`));
  }
  if (expected.date && !got.preSubmit) got.storeRows.filter(c => /\d{4}/.test(c[4]) && !c[4].includes(expected.date)).forEach(c => must.push(`Wrong date: ${c[1]} ${c[4]}`));
  if (expected.date && got.preSubmit) {
    const M = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const dm = String(expected.date).match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/);
    // v1.0.19: also accept "2026-07-10"
    const dIso = String(expected.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const iso = dm ? `${dm[3]}-${M[dm[2]]}-${dm[1].padStart(2, '0')}` : dIso ? dIso[0] : '';
    const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const human = dIso ? `${+dIso[3]} ${MN[+dIso[2] - 1]} ${dIso[1]}` : String(expected.date);
    // v0.8.8: release_stores.php sometimes comes back without the store list (LE hiccup / page busy) — retry fresh,
    // then fall back to the per-store dates printed on the review page. A real mismatch still fails.
    const readDates = (S) => [...S.documentElement.innerHTML.matchAll(/DateInput\('(date(?:_\d+)?)',\s*\w+,\s*'[^']*',\s*'([^']*)'\)/g)].map(m => [m[1], m[2]]);
    const SPg = await P('/release_stores.php?release_id=' + releaseId);
    let dates = readDates(SPg);
    // v1.0.19 (Dessy ZA0624 10/20): a back-catalogue / takeover release has no per-store date inputs — LE states one
    // release date for all stores ("This is a back catalogue release with the release date set as 10 Jul 2026").
    const bc = SPg.body.innerText.replace(/\s+/g, ' ').match(/back catalogue release with the release date set as (\d{1,2} [A-Z][a-z]{2} \d{4})/i);
    if (!dates.length && bc) {
      const d = bc[1].match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/);
      dates = [['back-catalogue', `${d[3]}-${M[d[2]]}-${d[1].padStart(2, '0')}`]];
      pcInfo.push(`back catalogue release: one LE release date for all stores (${bc[1]})`);
    }
    for (let i = 0; i < 2 && !dates.length; i++) {
      const fresh = new DOMParser().parseFromString(await (await fetch('/release_stores.php?release_id=' + releaseId + '&r=' + i)).text(), 'text/html');
      dates = readDates(fresh);
    }
    got.dateSource = 'release_stores.php';
    if (!dates.length) {
      const rv = s.replace(/must be \d{1,2} [A-Z][a-z]{2} \d{4} or later/gi, '').replace(/original(ly)? release(d)?( date)?:?\s*\d{1,2} [A-Z][a-z]{2} \d{4}/gi, '');
      dates = [...rv.matchAll(/\b(\d{1,2} [A-Z][a-z]{2} \d{4})\b/g)].map((m, i) => ['review#' + i, m[1] === expected.date ? iso : m[1]]);
      got.dateSource = 'review page';
    }
    if (!iso) must.push(`expected.date "${expected.date}" must look like "23 Oct 2026"`);
    else if (!dates.length) must.push('Could not read any store dates (release_stores.php and the review page) — check manually');
    else { const tSet = expected.timed ? (expected.timed.stores || []).map(String) : []; const sid = id => String(id).replace(/^date_/, ''); const skip = id => !!expected.timed && (id === 'date' || (/^date_/.test(id) && !!SPg.querySelector('[name=store_id_' + sid(id) + ']') && !SPg.querySelector('[name=store_id_' + sid(id) + ']').hasAttribute('checked'))); const want = id => tSet.includes(sid(id)) ? String(expected.timed.date) : iso; dates.filter(([id, d]) => !skip(id) && d !== want(id)).forEach(([id, d]) => must.push(`Wrong store date ${id}: ${d || '(blank)'} expected ${want(id)}`)); if (expected.timed) { tSet.forEach(n => { const el = SPg.querySelector('[name=time_' + n + ']'); const tv = el ? el.value : undefined; if (tv === undefined) must.push(`timed store ${n}: time could not be read - check manually`); else if (tv !== String(expected.timed.time)) must.push(`Wrong store time time_${n}: ${tv || '(blank)'} expected ${expected.timed.time}`); }); pcInfo.push(`timed release (v1.0.78): stores ${tSet.join(', ')} expected ${expected.timed.date} ${expected.timed.time}; all other ticked stores ${iso}; unticked stores and the master date field not checked`); } }
    got.dateCount = dates.length;
  }
  const locked = got.labelPct === undefined; // split fields disappear once submitted
  if (expected.splits && !locked) { eq('Artist %', got.artistPct, expected.splits.artist); eq('Label %', got.labelPct, expected.splits.label); }
  // v1.0.15 (MONEYJUNKIEE ZA0623 10/19: submitted without the Run Things 41% row): every royalty row on the track —
  // artist / featured / contributor / remixer / payee / OTHER — must match the card's payees exactly (name + %).
  const TF = T.getElementById('edit_track_allocation_form') || T;
  got.payees = [];
  for (const role of ['artist', 'featured', 'contributor', 'remixer', 'payee', 'other']) {
    for (const e of TF.querySelectorAll(`[name^="${role}_name_"]`)) {
      const i = e.name.split('_').pop();
      const pctEl = TF.querySelector(`[name="${role}_percentage_${i}"]`);
      const pct = pctEl ? Number(pctEl.value || 0) : NaN;
      // v1.0.21 (DH051 10/20): Hallwood-style fee rows are GROSS (taken off the top) and don't count toward the 100.
      // LE marks each row Net/Gross with a select or field in the same row; read whichever exists.
      // LE stores Gross/Net as <role>_priority_<i>: 1 = Gross (off the top), 0 = Net (verified on DH051 10/20).
      const prio = TF.querySelector(`[name="${role}_priority_${i}"]`);
      const byName = [...TF.querySelectorAll(`[name^="${role}_"][name$="_${i}"]`)].find(x => /gross|net|basis|calc|deduct/i.test(x.name));
      const rowEl = (pctEl || e).closest('tr') || (pctEl || e).closest('.client, .client-row, li');
      const selText = [...(rowEl ? rowEl.querySelectorAll('select') : [])].map(s => s.selectedOptions?.[0]?.text || '').find(t => /^\s*(gross|net)\b/i.test(t)) || '';
      const basisRaw = byName ? (byName.tagName === 'SELECT' ? (byName.selectedOptions[0]?.text || '') : (byName.type === 'checkbox' ? (byName.checked ? 'gross' : 'net') : byName.value)) : selText;
      const gross = (prio ? String(prio.value).trim() === '1' : false) || /gross/i.test(String(basisRaw)) || (!basisRaw && rowEl && /\bGross\b/.test(rowEl.textContent || '') && !/\bNet\b/.test(rowEl.textContent || ''));
      got.payees.push({ role, name: (e.value || '').trim(), pct, gross });
    }
  }
  if (Array.isArray(expected.payees)) {
    const fmt = (x) => Number(x).toFixed(2);
    const live = got.payees.filter(r => Number.isFinite(r.pct));
    if (!live.length && !locked) must.push('Could not read any royalty rows on the track page — check splits manually');
    for (const w of expected.payees) {
      const hit = live.find(r => r.name.toLowerCase() === String(w.name).trim().toLowerCase() && fmt(r.pct) === fmt(w.pct));
      if (!hit) must.push(`Payee missing/wrong: ${w.name} ${fmt(w.pct)}% (LE has: ${live.filter(r => r.name.toLowerCase() === String(w.name).trim().toLowerCase()).map(r => `${r.role} ${fmt(r.pct)}%`).join(', ') || 'no row'})`);
    }
    for (const r of live) if (r.pct > 0 && !expected.payees.some(w => String(w.name).trim().toLowerCase() === r.name.toLowerCase())) must.push(`Payee not on the card: ${r.role} ${r.name} ${fmt(r.pct)}%`);
    const tot = live.filter(r => !r.gross).reduce((a, r) => a + (r.pct || 0), 0);
    const grossRows = live.filter(r => r.gross);
    if (grossRows.length) pcInfo.push(`gross rows not counted toward 100: ${grossRows.map(r => `${r.name} ${fmt(r.pct)}%`).join(', ')}`);
    if (got.labelPct !== undefined && got.labelPct !== '' && Math.abs(tot + Number(got.labelPct) - 100) > 0.011) must.push(`Splits don't add to 100: rows ${fmt(tot)} + label ${got.labelPct}`);
  }
  if (artistNote) pcInfo.push(artistNote);
  if (got.unofferedIgnored?.length) pcInfo.push(`ignored (not checked/offered on the stores page): ${got.unofferedIgnored.join(', ')}`);
  if (got.preSubmit) pcInfo.push(`not submitted yet: ${got.stores.length} stores selected, ${got.dateCount ?? 0} store dates read from ${got.dateSource}`);
  pcInfo.push(`payees: ${(got.payees || []).filter(r => Number.isFinite(r.pct)).map(r => `${r.role} ${r.name} ${r.pct.toFixed(2)}%${r.gross ? ' (gross)' : ''}`).join('; ')}`);
  const info = (locked ? '\n(info) splits not readable: release already locked/submitted' : '') + pcInfo.map(x => '\n(info) ' + x).join('');
  if (/AUTO/i.test(got.upc || '') && expected.upc && expected.upc !== 'AUTO') must.push('UPC still on auto-generate');
  return `LE GATE ${releaseId}/${trackId}\n` + (must.length ? 'MUST FIX:\n- ' + must.join('\n- ') : 'MUST FIX: none') + info + `\nstores: ${got.stores.join(', ')}`;
}
window.leGate = leGate;

// ---------------------------------------------------------------- THE GATE (required before ANY submit / distribute / update request)
// The gate RUNS the checks itself — it never accepts check text from outside (no forging).
//   LE:      await brokeGate('ZA0612CLEAN', 'le', { rid, tracks: [{ tid, expected, card }] })
//   SoundOn: await brokeGate('7698213569342670854', 'soundon', { id, precedent, opts: { title, date, explicit }, card, trackIndex: 0 })
// expected/card come from the release card. KEY = full catalogue number / platform id (6+ chars).
// Load precheck.js in one call, then run the gate ALONE in a separate call (the hook only records a pass
// from a call that runs brokeGate and defines nothing). Submit in another call whose summary names the KEY.
// One pass = one submit, 15 minutes; any field edit after the gate cancels the pass (hook) — re-run it.
// A pass is not approval: Zain's "yes" to the summary + gate output is still required.
async function brokeGate(key, platform, spec) {
  if (!key || String(key).length < 5) return `GATE FAIL ${key}: key must be the full catalogue number / id (5+ chars)`;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return `GATE FAIL ${key}: pass a spec object (see precheck.js)`;
  const checks = [];
  if (platform === 'le') {
    if (!spec.rid || !Array.isArray(spec.tracks) || !spec.tracks.length) return `GATE FAIL ${key}: spec needs rid and tracks:[{tid, expected, card}]`;
    const cache = {};
    const per = await Promise.all(spec.tracks.map(async t => [
      t.card ? null : `CARD CREDIT CHECK track ${t.tid}\nMUST FIX:\n- no card credits given`,
      await leGate(spec.rid, t.tid, t.expected || {}, cache),
      t.card ? cardCreditCheck(`LE ${key} track ${t.tid}`, t.card, await leCredits(spec.rid, t.tid)) : null,
    ]));
    per.flat().filter(Boolean).forEach(c => checks.push(c));
  } else if (platform === 'soundon') {
    if (!spec.id || !spec.precedent || !spec.card) return `GATE FAIL ${key}: spec needs id, precedent, opts, card`;
    const big = v => typeof v === "number" && !Number.isSafeInteger(v); // v1.0.59: a 19-digit numeric id loses precision
    if (big(spec.id) || big(spec.precedent)) return `GATE FAIL ${key}: pass SoundOn ids as strings ('${key}'), a 19-digit number loses precision`;
    checks.push(await soundonPrecheck(spec.id, spec.precedent, spec.opts || {}));
    checks.push(cardCreditCheck(`SO ${key}`, spec.card, await soundonCredits(spec.id, spec.trackIndex || 0)));
  } else return `GATE FAIL ${key}: platform must be 'le' or 'soundon'`;
  const fails = checks.filter(c => !/MUST FIX: none/.test(c));
  const ids = platform === 'le' ? `rid ${spec.rid}` : `id ${spec.id}`;
  if (fails.length) return gateOut(`GATE FAIL ${key} (${ids})`, fails.join('\n\n'));
  return gateOut(`GATE PASS ${key} [${platform}: ${ids}; ${checks.length} checks incl. CARD CREDIT CHECK]`, checks.map(c => c.split('\n')[0]).join('\n'));
}
// v1.0.58 (10/28, 3 wasted gate runs): the Chrome javascript tool replaces any result that looks like query-string / cookie
// data with "[BLOCKED: Cookie/query string data]". Everything after the first line is sanitized like soundonPrecheck
// (links -> [link], = & ? -> _, ; -> ,). The first line ("GATE PASS <KEY> [...]" / "GATE FAIL <KEY> (...)") is what the
// hook reads and is left as is.
function gateOut(head, body) {
  const unQ = t => String(t).replace(/https?:\/\/\S+/g, u => u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '')).replace(/[?&]/g, ' ').replace(/=/g, ': ');
  const san = t => String(t).replace(/https?:\S+/g, '[link]').replace(/[=&?]/g, '_').replace(/;/g, ',');
  return String(head).replace(/[=&?]/g, '_') + '\n\n' + san(unQ(body));
}
window.brokeGate = brokeGate;

// ---------------------------------------------------------------- Feature.fm (bash, not browser)
// curl -sL https://broke.ffm.to/<slug> | grep -oE '<title>[^<]*|og:image" content="[^"]*'
// expect: title "Artist - Title", og:image = uploaded cover (not the vinyl placeholder), HTTP 200.

// ---------------------------------------------------------------- monday (via all_api_read)
// query { items(ids:[NEW, PRECEDENT]) { name group{title} column_values { id text } } }
// Diff in bash with jq: every column non-empty on PRECEDENT must be non-empty on NEW (or have a stated reason).
// Label Share = bare number. Cover Art (upload_file1__1) must have a file. Status = Distributed only for our releases.
