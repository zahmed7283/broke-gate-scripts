/* Label Engine driver (broke) — v0.1
 * Inject on any https://label-engine.com page (same origin), then call window.LE.*
 * Design rules:
 *  - Reads use fetch + DOMParser (no navigation, no side effects).
 *  - Writes load the real page in a hidden same-origin iframe, set fields, click the page's own
 *    Save button (so LE's own JS/validation runs), wait for success_message, then READ BACK and diff.
 *  - Every write returns {ok, diff}. ok=false if any expected value didn't stick.
 *  - Destructive/irreversible actions (submit for distribution, update request, delete) require opts.confirm === true.
 */
(() => {
  const BASE = location.origin;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  const get = async url => parse(await fetch(url, { credentials: 'include' }).then(r => r.text()));
  const txt = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const sel = (form, n) => form.querySelector(`[name="${n}"]`);
  const val = (form, n) => { const e = sel(form, n); if (!e) return undefined; return e.tagName === 'SELECT' ? (e.selectedOptions[0]?.text ?? '') : e.value; };

  // ---------- iframe page driver ----------
  async function openFrame(url) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-5000px;top:0;width:1400px;height:900px;';
    document.body.appendChild(f);
    await new Promise((res, rej) => { f.onload = res; f.onerror = rej; f.src = url; });
    await sleep(800);
    return f;
  }
  async function waitNav(f, timeout = 20000) {
    const start = f.contentWindow.location.href; const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      await sleep(300);
      try { const h = f.contentWindow.location.href; if (h !== start && f.contentDocument.readyState === 'complete') return h; } catch (e) {}
    }
    throw new Error('timeout waiting for save');
  }
  function setField(doc, name, value) {
    const e = doc.querySelector(`[name="${name}"]`);
    if (!e) throw new Error('field not found: ' + name);
    if (e.tagName === 'SELECT') {
      const opt = [...e.options].find(o => o.value == value || o.text.trim() === String(value).trim());
      if (!opt) throw new Error(`option "${value}" not in ${name}`);
      e.value = opt.value;
    } else if (e.type === 'checkbox' || e.type === 'radio') { e.checked = !!value; }
    else { e.value = value; }
    const $ = doc.defaultView.jQuery;
    ['input', 'keyup', 'change'].forEach(ev => e.dispatchEvent(new Event(ev, { bubbles: true })));
    if ($) $(e).trigger('change');
  }
  function clickSave(doc) {
    const b = [...doc.querySelectorAll('a,button,input[type=submit]')].find(x => /^save changes$/i.test((x.value || x.innerText || '').trim()));
    if (!b) throw new Error('Save Changes button not found');
    b.click();
  }

  // ---------- READS ----------
  async function search(query) {
    const fd = new FormData(); fd.append('query', query); fd.append('mode', 'distribution');
    const d = parse(await fetch('/search.php', { method: 'POST', body: fd }).then(r => r.text()));
    const seen = new Map();
    d.querySelectorAll('tr').forEach(tr => { const a = tr.querySelector('a[href*="release_id="]'); if (!a) return;
      const id = a.getAttribute('href').match(/release_id=(\d+)/)[1]; if (!seen.has(id)) seen.set(id, txt(tr).replace(/View$/, '').trim()); });
    return [...seen].map(([id, row]) => ({ id: +id, row }));
  }

  async function readTrack(rid, tid) {
    const d = await get(`/distribute_track.php?release_id=${rid}&track_id=${tid}`);
    const f = d.getElementById('edit_track_allocation_form');
    const people = role => [...f.querySelectorAll(`[name^="${role}_name_"]`)].map(e => {
      const i = e.name.split('_').pop(); const p = `${role}_`;
      const members = []; const n = +(val(f, `${p}members_count_${i}`) || 0);
      for (let m = 1; m <= n; m++) members.push({
        name: val(f, `${p}members_${i}_real_name_${m}`),
        performer: val(f, `${p}members_${i}_performer_roles_ids_${m}`), production: val(f, `${p}members_${i}_production_roles_ids_${m}`),
        composition: val(f, `${p}members_${i}_composition_roles_ids_${m}`) });
      return { name: e.value, alias: val(f, `${p}alias_name_${i}`), id: val(f, `${p}id_${i}`), account: val(f, `${p}account_${i}`), pct: val(f, `${p}percentage_${i}`), members };
    });
    return {
      rid, tid, title: val(f, 'title'), mix: val(f, 'mix'), isrc: val(f, 'isrc'), p_line: val(f, 'p_line'), c_line: val(f, 'c_line'),
      publisher: val(f, 'publisher'), copyright_holder: val(f, 'copyright_holder'), explicit: val(f, 'explicit'), language: val(f, 'language'),
      genre: val(f, 'commercial_genre_id'), dj_genre: val(f, 'genre_id'), custom_genre: val(f, 'custom_genre'),
      preview: (txt(d.body).match(/Track title preview:\s*(.*?)(Primary Artists|$)/) || [])[1]?.trim(),
      primary: people('artist'), featured: people('featured'), contributors: people('contributor'), payees: people('payee'), others: people('other'), remixers: people('remixer'), // v0.3: 'other' rows hold JV partners (Run Things)
    };
  }

  async function readRelease(rid) {
    const d = await get(`/review_release.php?release_id=${rid}`);
    const t = txt(d.body); const g = re => (t.match(re) || [])[1]?.trim();
    const e = await get(`/distribute_release.php?release_id=${rid}`);
    const tids = [...new Set([...e.documentElement.innerHTML.matchAll(/track_id=(\d+)/g)].map(m => +m[1]))];
    const tracks = []; for (const tid of tids) tracks.push(await readTrack(rid, tid));
    const profiles = [...d.querySelectorAll('tr')].filter(tr => /Edit Profiles/.test(tr.textContent))
      .map(tr => { const c = [...tr.querySelectorAll('td')].map(txt); return { artist: c[0], alias: c[1], spotify: c[2], apple: c[3], soundcloud: c[4] }; });
    return {
      rid, label: g(/Label:\s*(.*?)Catalogue/), cat: g(/Catalogue Number:\s*(\S+?)Release Type/), type: g(/Release Type:\s*(\w+)/),
      artist: g(/Release Artist:\s*(.*?)Release Title/), title: g(/Release Title:\s*(.*?)UPC/), upc: g(/UPC:\s*(.*?)P Line/),
      p_line: g(/P Line:\s*(.*?)C Line/), c_line: g(/C Line:\s*(.*?)\d+\.\s/), status: g(/(This release[^.]*\.|Delivered \| [^A-Z]*|Reviewing \| [^A-Z]*)/),
      artwork: (d.documentElement.innerHTML.match(/artwork\/large\/([a-f0-9]{32})/) || [])[1], stores: g(/(distributed to \d+ stores|distributed to all stores)/),
      credits: g(/Credits:\s*(.*?)(STORES|Stores)/), profiles, tracks,
    };
  }

  // ---------- WRITES (iframe, save, read-back) ----------
  async function setReleaseFields(rid, fields, opts = {}) {
    const f = await openFrame(`/distribute_release.php?release_id=${rid}${opts.allowEdit ? '&allow_edit=1' : ''}`);
    try {
      for (const [k, v] of Object.entries(fields)) setField(f.contentDocument, k, v);
      clickSave(f.contentDocument); await waitNav(f);
    } finally { f.remove(); }
    const d = await get(`/distribute_release.php?release_id=${rid}`);
    const diff = Object.entries(fields).filter(([k, v]) => String(val(d, k)).trim() !== String(v).trim()).map(([k, v]) => ({ field: k, want: v, got: val(d, k) }));
    return { ok: !diff.length, diff };
  }

  async function setTrackFields(rid, tid, fields, opts = {}) {
    const f = await openFrame(`/distribute_track.php?release_id=${rid}&track_id=${tid}${opts.allowEdit ? '&allow_edit=1' : ''}`);
    try {
      const doc = f.contentDocument;
      for (const [k, v] of Object.entries(fields)) setField(doc, k, v);
      clickSave(doc); await waitNav(f);
    } finally { f.remove(); }
    const tr = await readTrack(rid, tid);
    const map = { explicit: 'explicit', language: 'language', commercial_genre_id: 'genre', genre_id: 'dj_genre' };
    const diff = Object.entries(fields).filter(([k, v]) => { const got = tr[map[k] || k]; return got !== undefined && String(got).trim() !== String(v).trim(); })
      .map(([k, v]) => ({ field: k, want: v, got: tr[map[k] || k] }));
    return { ok: !diff.length, diff };
  }

  /* addClient: adds an EXISTING client to a track with a role.
   * spec = { clientId, role:'primary'|'featured'|'contributor'|'payee', alias, members:[{name, performer:[ids], production:[ids], composition:[ids]}],
   *          royalty: null | {account:'<option text or value>', pct:'0.00'} }
   * Role ids seen so far: performer Vocals=8, Rap=20; production Producer=11; composition Songwriter=15.
   * Never ticks "Save group members as default for this client".
   * Then saves the track page and reads back. */
  async function addClient(rid, tid, spec, opts = {}) {
    const page = await openFrame(`/distribute_track.php?release_id=${rid}&track_id=${tid}${opts.allowEdit ? '&allow_edit=1' : ''}`);
    try {
      const pd = page.contentDocument;
      const dlg = await openFrame(`/edit_track_client.php?client_action=add&label_id=${opts.labelId || ''}&release_id=${rid}&track_id=${tid}`);
      // NOTE v0.1: dialog normally opens inside the track page (fancybox) and posts back into it.
      // Until mapped live, addClient drives the in-page dialog instead:
      dlg.remove();
      const add = [...pd.querySelectorAll('a')].find(a => /^Add Client$/.test(a.innerText.trim())); add.click(); await sleep(1500);
      const fr = [...pd.querySelectorAll('iframe')].find(x => /edit_track_client/.test(x.src));
      const W = fr.contentWindow, D = W.document, $ = W.jQuery;
      const client = D.getElementById('track_client_id');
      if (![...client.options].some(o => o.value == spec.clientId)) client.add(new Option(spec.name || spec.clientId, spec.clientId));
      $(client).val(String(spec.clientId)).trigger('change'); await sleep(1500);
      $(D.getElementById('track_client_role_select')).val(spec.role).trigger('change'); await sleep(800);
      if (spec.alias) { $(D.getElementById('track_client_alias')).val(spec.alias).trigger('change'); await sleep(800); }
      const addMember = () => [...D.querySelectorAll('a')].find(a => /Add Group Member/.test(a.innerText))?.click();
      for (let i = 0; i < spec.members.length; i++) {
        const m = spec.members[i], n = i + 1;
        if (!D.querySelector(`[name="real_name_${n}"]`)) { addMember(); await sleep(400); }
        const nm = D.querySelector(`[name="real_name_${n}"]`); nm.value = m.name; $(nm).trigger('change');
        for (const kind of ['performer', 'production', 'composition'])
          $(D.querySelector(`[name="${kind}_roles_ids_${n}[]"]`)).val((m[kind] || []).map(String)).trigger('change');
      }
      const save = D.querySelector('input[name="save-members"]'); if (save) save.checked = false;
      if (spec.royalty) { D.querySelector('input[name=track_client_allocation][value="1"]').click(); /* account/pct: TODO map */ }
      else D.querySelector('input[name=track_client_allocation][value="0"]')?.click();
      [...D.querySelectorAll('a,button,input')].find(b => /Save Client Changes/.test(b.value || b.innerText)).click();
      await sleep(2500);
      clickSave(pd); await waitNav(page);
    } finally { page.remove(); }
    return readTrack(rid, tid);
  }

  async function removeClient(rid, tid, role, name, opts = {}) {
    const page = await openFrame(`/distribute_track.php?release_id=${rid}&track_id=${tid}${opts.allowEdit ? '&allow_edit=1' : ''}`);
    try {
      const pd = page.contentDocument;
      const row = [...pd.querySelectorAll('tr')].find(r => r.querySelector('a.remove-client') && r.querySelector(`[name^="${role}_name_"]`)?.value === name);
      if (!row) throw new Error(`no ${role} row for ${name}`);
      row.querySelector('a.remove-client').click(); await sleep(600);
      clickSave(pd); await waitNav(page);
    } finally { page.remove(); }
    return readTrack(rid, tid);
  }

  async function submitUpdateRequest(rid, fieldNames, opts = {}) {
    if (opts.confirm !== true) throw new Error('submitUpdateRequest needs {confirm:true}');
    const f = await openFrame(`/support_release.php?release_id=${rid}`);
    try {
      const d = f.contentDocument;
      if (!d.getElementById('support_edit').checked) d.getElementById('support_edit').click();
      if (d.getElementById('support_delete').checked) throw new Error('delete radio selected — abort');
      d.getElementById('update_notes').value = 'Updated fields: ' + fieldNames.join(', ');
      d.getElementById('reviewed').checked = true;
      [...d.querySelectorAll('input[type=submit]')].find(b => b.value === 'Request Update').click();
      await waitNav(f);
    } finally { f.remove(); }
    const t = txt((await get(`/support_release.php?release_id=${rid}`)).body);
    return { ok: /update request is being processed/i.test(t) };
  }

  async function duplicate(rid, opts = {}) {
    if (opts.confirm !== true) throw new Error('duplicate needs {confirm:true}');
    const r = await fetch(`/distribute_release.php?release_id=${rid}&complete=duplicate`, { redirect: 'follow' });
    let id = (r.url.match(/release_id=(\d+)/) || [])[1];
    if (!id || +id === +rid) {
      // v0.2: LE may answer without redirecting — read the new release's id from the page it returned.
      const d = parse(await r.text());
      const cand = [d.querySelector('[name="release_id"]')?.value, ...[...d.documentElement.innerHTML.matchAll(/release_id=(\d+)/g)].map(m => m[1])]
        .filter(x => x && +x !== +rid);
      id = cand[0];
    }
    // v0.3: no URL in the result — Chrome blanks tool output that contains query strings (RJ Pasin 10/19).
    return { newReleaseId: id && +id !== +rid ? +id : null };
  }

  // ---------- VERIFY ----------
  // expected = { title, artist, p_line, c_line, upc, tracks:[{title, isrc, explicit, featured:[names], credits:'...'}] }
  async function verify(rid, expected) {
    const r = await readRelease(rid); const diff = [];
    const cmp = (path, want, got) => { if (want !== undefined && String(want).trim() !== String(got ?? '').trim()) diff.push({ path, want, got }); };
    ['title', 'artist', 'p_line', 'c_line', 'upc', 'label'].forEach(k => cmp(k, expected[k], r[k]));
    (expected.tracks || []).forEach((et, i) => { const t = r.tracks[i] || {};
      ['title', 'isrc', 'explicit', 'p_line', 'c_line', 'genre', 'language'].forEach(k => cmp(`tracks[${i}].${k}`, et[k], t[k]));
      if (et.featured) cmp(`tracks[${i}].featured`, et.featured.join(','), (t.featured || []).map(x => x.name).join(','));
      if (et.primary) cmp(`tracks[${i}].primary`, et.primary.join(','), (t.primary || []).map(x => x.name).join(','));
    });
    if (expected.credits) cmp('credits', expected.credits, r.credits);
    return { ok: !diff.length, diff, release: r };
  }

  window.LE = { version: '0.1', search, readRelease, readTrack, setReleaseFields, setTrackFields, addClient, removeClient, submitUpdateRequest, duplicate, verify };
  return 'LE driver ' + window.LE.version + ' loaded';
})();
