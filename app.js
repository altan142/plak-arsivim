(() => {
'use strict';
const $ = s => document.querySelector(s);
const coll = new Intl.Collator('tr', { sensitivity: 'base' });
const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const APP_VERSION = '8';
const META = ['releaseDate','genres','label','producer','length','tracks','wikiUrl','wikiSummary','mbid'];

let records = [];
let store = null;
let filter = { q: '', artist: '', genre: '', sort: 'added' };
let editingId = null, openId = null;
let formCovers = [], coverIdx = 0, fetchedMeta = null, matches = [];
const busy = new Set();

try { const s = JSON.parse(localStorage.getItem('plak-filter') || 'null'); if (s) filter = { ...filter, ...s, q: '' }; } catch (e) {}
const saveFilter = () => { try { localStorage.setItem('plak-filter', JSON.stringify({ ...filter, q: '' })); } catch (e) {} };

/* ---------------- stores ---------------- */
const LOCAL_KEY = 'plak-records-v1';
function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (e) { return []; } }
function writeLocal(list) { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); }

class LocalStore {
  constructor() { this.cbs = []; this.kind = 'local'; }
  emit() { const l = readLocal(); this.cbs.forEach(cb => cb(l)); }
  subscribe(cb) { this.cbs.push(cb); cb(readLocal());
    window.addEventListener('storage', e => { if (e.key === LOCAL_KEY) this.emit(); }); }
  async add(data) { const l = readLocal(); const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    l.push({ id, ...data }); writeLocal(l); this.emit(); return id; }
  async set(id, data) { const l = readLocal(); const i = l.findIndex(r => r.id === id); if (i < 0) return; l[i] = { id, ...data }; writeLocal(l); this.emit(); }
  async update(id, part) { const l = readLocal(); const i = l.findIndex(r => r.id === id); if (i < 0) return; l[i] = { ...l[i], ...part }; writeLocal(l); this.emit(); }
  async remove(id) { writeLocal(readLocal().filter(r => r.id !== id)); this.emit(); }
}

class FireStore {
  constructor(db, uid) { this.col = db.collection('users').doc(uid).collection('records'); this.kind = 'cloud'; }
  subscribe(cb, err) { this.col.onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err); }
  async add(data) { const ref = this.col.doc(); await ref.set(data); return ref.id; }
  async set(id, data) { await this.col.doc(id).set(data); }
  async update(id, part) { await this.col.doc(id).update(part); }
  async remove(id) { await this.col.doc(id).delete(); }
}

/* ---------------- helpers ---------------- */
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== '') n.append(k.nodeType ? k : document.createTextNode(k)); return n; };
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); };
const year = r => { const m = /^(\d{4})/.exec(r.releaseDate || ''); return m ? +m[1] : null; };
function fmtRelease(d) { if (!d) return ''; const [y, m, dd] = d.split('-'); if (dd) return `${+dd} ${MONTHS[+m - 1]} ${y}`; if (m) return `${MONTHS[+m - 1]} ${y}`; return y; }
function fmtDate(d) { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; }
function placeholder(r) {
  const h = hash((r.artist || '') + (r.title || '')) % 360;
  const d = el('div', { class: 'ph' }, el('small', { text: r.artist || '' }), el('b', { text: r.title || '' }));
  d.style.background = `linear-gradient(150deg, hsl(${h} 42% 34%), hsl(${(h + 40) % 360} 48% 22%))`; return d;
}
function coverNode(r) {
  if (!r.cover) return placeholder(r);
  const img = el('img', { src: r.cover, alt: `${r.title} kapağı`, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.onerror = () => img.replaceWith(placeholder(r)); return img;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2600); }
const titleCase = g => String(g).toLowerCase().replace(/(^|[\s\-\/(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const fixGenres = gs => [...new Set((gs || []).map(titleCase))];
const normKey = r => (r.title + '|' + r.artist).toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

/* ---------------- list ---------------- */
function visible() {
  const q = filter.q.trim().toLocaleLowerCase('tr');
  const list = records.filter(r => {
    if (filter.artist && r.artist !== filter.artist) return false;
    if (filter.genre && !(r.genres || []).includes(filter.genre)) return false;
    if (q) { const hay = [r.title, r.artist, r.label, r.producer, (r.genres || []).join(' '), (r.tracks || []).map(t => t.title).join(' ')].join(' ').toLocaleLowerCase('tr'); if (!hay.includes(q)) return false; }
    return true; });
  const by = {
    added: (a, b) => (b.addedDate || '').localeCompare(a.addedDate || '') || (b.createdAt || 0) - (a.createdAt || 0),
    relAsc: (a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'),
    relDesc: (a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''),
    artist: (a, b) => coll.compare(a.artist, b.artist) || (a.releaseDate || '').localeCompare(b.releaseDate || ''),
    title: (a, b) => coll.compare(a.title, b.title),
  }[filter.sort] || (() => 0);
  return list.sort(by);
}

function render() {
  const artists = [...new Set(records.map(r => r.artist).filter(Boolean))].sort(coll.compare);
  const gc = {}; records.forEach(r => (r.genres || []).forEach(g => gc[g] = (gc[g] || 0) + 1));
  const genres = Object.keys(gc).sort(coll.compare);
  if (filter.artist && !artists.includes(filter.artist)) filter.artist = '';
  if (filter.genre && !genres.includes(filter.genre)) filter.genre = '';

  $('#total').textContent = records.length;
  const yrs = records.map(year).filter(Boolean);
  const thisYear = String(new Date().getFullYear());
  $('#stats').replaceChildren(
    el('span', {}, el('strong', { text: artists.length }), ' sanatçı'),
    el('span', {}, el('strong', { text: genres.length }), ' tür'),
    yrs.length ? el('span', {}, 'en eski ', el('strong', { text: Math.min(...yrs) }), ' · en yeni ', el('strong', { text: Math.max(...yrs) })) : null,
    records.length ? el('span', {}, el('strong', { text: records.filter(r => (r.addedDate || '').startsWith(thisYear)).length }), ' tanesi bu yıl alındı') : null);

  const dec = {}; yrs.forEach(y => { const d = Math.floor(y / 10) * 10; dec[d] = (dec[d] || 0) + 1; });
  const keys = Object.keys(dec).map(Number).sort((a, b) => a - b);
  const box = $('#decades'); box.replaceChildren(); box.hidden = !keys.length;
  if (keys.length) { const max = Math.max(...Object.values(dec));
    for (let d = keys[0]; d <= keys[keys.length - 1]; d += 10) { const n = dec[d] || 0;
      const bar = el('i', { title: `${d}'ler: ${n} plak` }); bar.style.height = (n ? Math.max(8, n / max * 30) : 2) + 'px';
      box.append(el('div', {}, bar, el('small', { text: `'${String(d).slice(2)}` }))); } }

  drawCharts(artists, gc);
  const fa = $('#fArtist'); fa.replaceChildren(el('option', { value: '', text: 'Tümü' }), ...artists.map(a => el('option', { value: a, text: a }))); fa.value = filter.artist;
  const fg = $('#fGenre'); fg.replaceChildren(el('option', { value: '', text: 'Tümü' }), ...genres.map(g => el('option', { value: g, text: `${g} (${gc[g]})` }))); fg.value = filter.genre;
  $('#sort').value = filter.sort;
  $('#artistList').replaceChildren(...artists.map(a => el('option', { value: a })));
  const top = Object.entries(gc).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  $('#chips').replaceChildren(...top.map(g => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter.genre === g), text: g,
    onclick: () => { filter.genre = filter.genre === g ? '' : g; saveFilter(); render(); } })));

  const list = visible();
  $('#resultCount').textContent = (filter.artist || filter.genre || filter.q) ? `${list.length} / ${records.length} plak gösteriliyor` : '';
  $('#grid').replaceChildren(...list.map(card));
  const empty = $('#empty');
  if (!records.length) { empty.hidden = false; empty.replaceChildren(el('h2', { text: 'Raf boş' }), el('p', { text: 'İlk plağınızı "+ Plak ekle" ile ekleyin. Albüm adı ve sanatçıyı yazmanız yeterli; kapak ve bilgiler kendiliğinden bulunur.' })); }
  else if (!list.length) { empty.hidden = false; empty.replaceChildren(el('h2', { text: 'Eşleşen plak yok' }), el('p', { text: 'Aramayı veya filtreleri değiştirin.' })); }
  else empty.hidden = true;
  if (openId && !$('#detailSheet').hidden) { const r = records.find(x => x.id === openId); if (r) fillDetail(r); }
}

/* ---------------- charts ---------------- */
const PALETTE = ['#1E5A86', '#C9921A', '#AE3A2E', '#4E8A5B', '#7A5BA6', '#2A9D9A', '#D2691E', '#8C6A4F'];
const OTHER = '#8F9691';
let chartsOpen = false; try { chartsOpen = localStorage.getItem('plak-charts') === '1'; } catch (e) {}
function setCharts(open) { chartsOpen = open; $('#charts').hidden = !open; $('#chartsBtn').setAttribute('aria-expanded', String(open));
  try { localStorage.setItem('plak-charts', open ? '1' : '0'); } catch (e) {} if (open) render(); }
$('#chartsBtn').addEventListener('click', () => setCharts(!chartsOpen));
function drawCharts(artists, gc) {
  $('#charts').hidden = !chartsOpen; $('#chartsBtn').setAttribute('aria-expanded', String(chartsOpen));
  if (!chartsOpen) return;
  const ac = {}; records.forEach(r => { if (r.artist) ac[r.artist] = (ac[r.artist] || 0) + 1; });
  pie($('#pieArtists'), ac, 'artist', 'plak');
  pie($('#pieGenres'), gc, 'genre', 'plak');
}
function pie(box, counts, key, unit) {
  const all = Object.entries(counts).sort((a, b) => b[1] - a[1] || coll.compare(a[0], b[0]));
  if (!all.length) { box.replaceChildren(el('p', { class: 'chart-empty', text: 'Henüz veri yok.' })); return; }
  const top = all.slice(0, 8); const rest = all.slice(8).reduce((a, e) => a + e[1], 0);
  const items = top.map(([name, n], i) => ({ name, n, color: PALETTE[i] }));
  if (rest) items.push({ name: `Diğer (${all.length - 8})`, n: rest, color: OTHER, other: true });
  const total = items.reduce((a, x) => a + x.n, 0);
  const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', items.map(x => `${x.name}: ${x.n}`).join(', '));
  const pick = x => { if (x.other) return; filter[key] = filter[key] === x.name ? '' : x.name; saveFilter(); render(); };
  let a0 = -Math.PI / 2;
  for (const x of items) {
    let node;
    if (x.n === total) { node = document.createElementNS(NS, 'circle'); node.setAttribute('cx', 50); node.setAttribute('cy', 50); node.setAttribute('r', 48); }
    else {
      const a1 = a0 + x.n / total * Math.PI * 2; const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => `${(50 + 48 * Math.cos(a)).toFixed(3)} ${(50 + 48 * Math.sin(a)).toFixed(3)}`;
      node = document.createElementNS(NS, 'path'); node.setAttribute('d', `M50 50 L${p(a0)} A48 48 0 ${large} 1 ${p(a1)} Z`); a0 = a1;
    }
    node.setAttribute('fill', x.color);
    if (filter[key] && filter[key] !== x.name) node.setAttribute('opacity', '.35');
    const t = document.createElementNS(NS, 'title'); t.textContent = `${x.name}: ${x.n} ${unit} (%${Math.round(x.n / total * 100)})`; node.append(t);
    node.addEventListener('click', () => pick(x)); svg.append(node);
  }
  const legend = el('ul', { class: 'legend' }, items.map(x => el('li', {}, el('button', { type: 'button', 'aria-pressed': String(filter[key] === x.name), disabled: x.other, onclick: () => pick(x) },
    (() => { const i = el('i'); i.style.background = x.color; return i; })(), el('span', { text: x.name, title: x.name }), el('b', { text: `${x.n} · %${Math.round(x.n / total * 100)}` })))));
  box.replaceChildren(svg, legend);
}

function card(r) {
  const disc = el('div', { class: 'disc' }); disc.style.setProperty('--lab', `hsl(${hash(r.title) % 360} 55% 50%)`);
  const y = year(r);
  return el('button', { type: 'button', class: 'card', onclick: () => openDetail(r.id), 'aria-label': `${r.title} — ${r.artist}` },
    el('div', { class: 'sleeve-box' }, disc, el('div', { class: 'sleeve' }, coverNode(r))),
    el('div', { class: 't', text: r.title }), el('div', { class: 'a', text: r.artist }),
    el('div', { class: 'm' }, y ? el('span', { class: 'tag', text: y }) : null, (r.genres || [])[0] ? el('span', { class: 'tag', text: r.genres[0] }) : null,
      busy.has(r.id) ? el('span', { class: 'busy', text: 'bilgiler aranıyor…' }) : null));
}

/* ---------------- detail ---------------- */
function openDetail(id) { const r = records.find(x => x.id === id); if (!r) return; openId = id; fillDetail(r); show('#detailSheet'); }
function fillDetail(r) {
  const facts = [['Çıkış', fmtRelease(r.releaseDate)], ['Tür', (r.genres || []).join(', ')], ['Plak şirketi', r.label], ['Yapımcı', r.producer],
    ['Süre', r.length], ['Aldığım tarih', fmtDate(r.addedDate)]].filter(f => f[1]);
  const dl = el('dl', { class: 'facts' }, facts.map(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]).flat());
  if (r.wikiUrl && /^https:\/\/[a-z]+\.wikipedia\.org\//.test(r.wikiUrl)) {
    let label = r.wikiUrl; try { label = decodeURIComponent(r.wikiUrl.split('/wiki/')[1]).replace(/_/g, ' '); } catch (e) {}
    dl.append(el('dt', { text: 'Wikipedia' }), el('dd', {}, el('a', { href: r.wikiUrl, target: '_blank', rel: 'noopener', text: label })));
  }
  if (r.discogsUrl && /^https:\/\/(www\.)?discogs\.com\//.test(r.discogsUrl)) dl.append(el('dt', { text: 'Discogs' }), el('dd', {}, el('a', { href: r.discogsUrl, target: '_blank', rel: 'noopener', text: 'Baskı sayfası' })));
  const ytm = 'https://music.youtube.com/search?q=' + encodeURIComponent(`${r.artist} ${r.title}`);
  dl.append(el('dt', { text: 'Dinle' }), el('dd', {}, el('a', { href: ytm, target: '_blank', rel: 'noopener', text: 'YouTube Music\'te aç' })));
  const sides = {}; (r.tracks || []).forEach(t => { const m = /^([A-Za-z])/.exec(t.pos || '') || /^(\d+)-/.exec(t.pos || ''); const s = m ? m[1].toUpperCase() : '—'; (sides[s] = sides[s] || []).push(t); });
  const sideName = s => s === '—' ? 'Şarkılar' : /\d/.test(s) ? `${s}. Disk` : `${s} Yüzü`;
  const tracks = Object.keys(sides).length ? el('div', { class: 'tracks' }, Object.entries(sides).map(([s, ts]) =>
    el('div', { class: 'side' }, el('h4', { text: sideName(s) }),
      el('ol', {}, ts.map(t => el('li', {}, el('span', { class: 'p', text: t.pos || '' }), el('span', { text: t.title }), el('span', { class: 'l', text: t.len || '' }))))))) : null;
  const actions = el('div', { class: 'actions' });
  const normal = () => actions.replaceChildren(
    el('button', { type: 'button', class: 'btn primary', text: 'Düzenle', onclick: () => { hide('#detailSheet'); openForm(r); } }),
    el('button', { type: 'button', class: 'btn', text: 'Bilgileri yeniden bul', disabled: busy.has(r.id), onclick: () => enrich(r, true) }),
    el('button', { type: 'button', class: 'btn danger', text: 'Sil', onclick: () => actions.replaceChildren(
      el('span', { class: 'confirm', text: `"${r.title}" silinsin mi?` }),
      el('button', { type: 'button', class: 'btn solid-danger', text: 'Evet, sil', onclick: async () => {
        try { await store.remove(r.id); hide('#detailSheet'); toast(`"${r.title}" silindi`); } catch (e) { toast('Silinemedi, tekrar deneyin'); } } }),
      el('button', { type: 'button', class: 'btn', text: 'Vazgeç', onclick: normal })) }));
  normal();
  $('#detailBody').replaceChildren(el('div', { class: 'detail' },
    el('div', { class: 'cover' }, coverNode(r)),
    el('div', { style: 'min-width:0' }, el('h2', { id: 'dTitle', text: r.title }), el('div', { class: 'by', text: r.artist }), dl,
      r.wikiSummary ? el('p', { class: 'wikisum' }, el('span', { class: 'mono', text: 'WIKIPEDIA · ' }), r.wikiSummary) : null,
      busy.has(r.id) ? el('p', { class: 'progress', text: 'Bilgiler aranıyor…' }) : null,
      tracks, actions)));
}

/* ---------------- sheets ---------------- */
let lastFocus = null;
function show(s) { lastFocus = document.activeElement; const n = $(s); n.hidden = false; document.body.style.overflow = 'hidden'; setTimeout(() => (n.querySelector('input:not([hidden]),button.x') || n).focus(), 0); }
function hide(s) { $(s).hidden = true; if (s === '#detailSheet') openId = null;
  if ($('#detailSheet').hidden && $('#formSheet').hidden) { document.body.style.overflow = ''; lastFocus?.focus?.(); } }
document.querySelectorAll('.sheet').forEach(sh => sh.addEventListener('click', e => { if (e.target === sh || e.target.closest('[data-close]')) hide('#' + sh.id); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#formSheet').hidden) hide('#formSheet'); else if (!$('#detailSheet').hidden) hide('#detailSheet'); else closeMenu(); } });

/* ---------------- form ---------------- */
const F = id => $('#' + id);
function openForm(r) {
  editingId = r ? r.id : null; fetchedMeta = null; matches = [];
  formCovers = r && r.cover ? [r.cover] : []; coverIdx = 0;
  $('#fTitleH').textContent = r ? 'Plağı düzenle' : 'Plak ekle';
  F('iDiscogs').value = r?.discogsUrl || ''; $('#discogsStatus').textContent = '';
  F('iTitle').value = r?.title || ''; F('iArtist').value = r?.artist || ''; F('iAdded').value = r?.addedDate || '';
  fillMetaFields(r || {});
  $('#matchRow').hidden = true; $('#fillStatus').textContent = ''; $('#saveStatus').textContent = ''; $('#saveStatus').className = 'status';
  drawCover(); show('#formSheet');
}
function fillMetaFields(m) {
  const [y, mo, d] = (m.releaseDate || '').split('-'); F('iYear').value = y || ''; F('iMonth').value = mo ? +mo : ''; F('iDay').value = d ? +d : '';
  F('iGenres').value = (m.genres || []).join(', '); F('iWiki').value = m.wikiUrl || ''; F('iLabel').value = m.label || '';
  F('iProducer').value = m.producer || ''; F('iLength').value = m.length || ''; F('iTracks').value = tracksToText(m.tracks);
}
function drawCover() {
  const t = $('#coverThumb'); const u = formCovers[coverIdx];
  t.replaceChildren(u ? el('img', { src: u, alt: '', referrerpolicy: 'no-referrer' }) : '');
  $('#coverIdx').textContent = formCovers.length ? `${coverIdx + 1}/${formCovers.length}` : 'kapak yok';
  $('#coverPrev').disabled = $('#coverNext').disabled = formCovers.length < 2; $('#coverRemove').disabled = !u;
}
$('#coverPrev').onclick = () => { coverIdx = (coverIdx - 1 + formCovers.length) % formCovers.length; drawCover(); };
$('#coverNext').onclick = () => { coverIdx = (coverIdx + 1) % formCovers.length; drawCover(); };
$('#coverRemove').onclick = () => { formCovers.splice(coverIdx, 1); coverIdx = 0; drawCover(); };
F('iCover').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const url = await shrink(f, 600); formCovers.unshift(url); coverIdx = 0; drawCover(); }
  catch (err) { const st = $('#saveStatus'); st.className = 'status err'; st.textContent = 'Fotoğraf okunamadı. JPG veya PNG deneyin.'; }
});
function shrink(file, max) { return new Promise((res, rej) => { const img = new Image(); const u = URL.createObjectURL(file);
  img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', 0.82)); };
  img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); }; img.src = u; }); }
const tracksToText = ts => (ts || []).map(t => [t.pos, t.title, t.len].map(x => x || '').join(' | ')).join('\n');
const textToTracks = s => s.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split('|').map(x => x.trim());
  if (p.length >= 3) return { pos: p[0], title: p.slice(1, -1).join(' | '), len: p[p.length - 1] };
  if (p.length === 2) return { pos: p[0], title: p[1], len: '' }; return { pos: '', title: p[0], len: '' }; });

$('#autofill').onclick = async () => {
  const title = F('iTitle').value.trim(), artist = F('iArtist').value.trim(); const st = $('#fillStatus'); st.className = 'status';
  if (!title || !artist) { st.className = 'status err'; st.textContent = 'Önce albüm adını ve sanatçıyı yazın.'; return; }
  if (!navigator.onLine) { st.className = 'status err'; st.textContent = 'İnternet bağlantısı yok.'; return; }
  const btn = $('#autofill'); btn.disabled = true; st.textContent = 'Aranıyor…';
  try {
    matches = await Lookup.search(title, artist);
    if (!matches.length) { st.className = 'status err'; st.textContent = 'Bu albüm bulunamadı. Yazımı kontrol edin veya bilgileri elle girin.'; return; }
    const sel = $('#iMatch'); sel.replaceChildren(...matches.map((m, i) => el('option', { value: i, text: `${m.title} — ${m.artist}${m.year ? ' (' + m.year + ')' : ''}${m.type && m.type !== 'Album' ? ' · ' + m.type : ''}` })));
    $('#matchRow').hidden = matches.length < 2;
    await applyMatch(0);
  } catch (e) { st.className = 'status err'; st.textContent = 'Bilgiler getirilemedi. Biraz sonra tekrar deneyin.'; console.error(e); }
  finally { btn.disabled = false; }
};
$('#iMatch').addEventListener('change', e => applyMatch(+e.target.value));
async function applyMatch(i) {
  const st = $('#fillStatus'); st.className = 'status'; st.textContent = 'Ayrıntılar getiriliyor… (birkaç saniye sürebilir)';
  $('#autofill').disabled = true; $('#iMatch').disabled = true;
  try {
    const d = await Lookup.details(matches[i], { title: F('iTitle').value, artist: F('iArtist').value });
    fetchedMeta = d;
    if (d.title) F('iTitle').value = d.title; if (d.artist) F('iArtist').value = d.artist;
    fillMetaFields(d);
    const own = formCovers.filter(u => u.startsWith('data:'));
    formCovers = [...own, ...d.covers]; coverIdx = 0; drawCover();
    st.textContent = d.covers.length ? 'Bulundu. Kaydetmeden önce kontrol edin; ◀ ▶ ile başka kapak seçebilirsiniz.' : 'Bilgiler bulundu ama kapak bulunamadı. Fotoğraf yükleyebilirsiniz.';
  } catch (e) { st.className = 'status err'; st.textContent = 'Ayrıntılar getirilemedi.'; console.error(e); }
  finally { $('#autofill').disabled = false; $('#iMatch').disabled = false; }
}

// Discogs linkinden doldur: şarkı listesi, tarih, tür, plak şirketi Discogs'tan; kapak, Wikipedia ve eksik süreler diğer kaynaklardan
async function discogsFill() {
  const st = $('#discogsStatus'); st.className = 'status';
  const url = F('iDiscogs').value.trim();
  if (!Lookup.parseDiscogs(url)) { st.className = 'status err'; st.textContent = 'Bu bir Discogs albüm linki değil. discogs.com/release/… veya /master/… biçiminde olmalı.'; return; }
  const btn = $('#discogsFill'); btn.disabled = true; st.textContent = 'Discogs\'tan getiriliyor…';
  try {
    const d = await Lookup.fromDiscogs(url);
    F('iTitle').value = d.title; F('iArtist').value = d.artist; F('iDiscogs').value = d.discogsUrl;
    fillMetaFields({ ...d, wikiUrl: F('iWiki').value });
    st.textContent = 'Discogs bilgileri geldi. Kapak ve Wikipedia aranıyor…';
    fetchedMeta = { wikiSummary: '', mbid: '' };
    try {
      const ms = await Lookup.search(d.title, d.artist);
      if (ms.length) {
        const m = await Lookup.details(ms[0], d);
        fetchedMeta = m;
        const lens = new Map(m.tracks.map(t => [t.title.toLowerCase(), t.len]));
        const tracks = d.tracks.map(t => ({ ...t, len: t.len || lens.get(t.title.toLowerCase()) || '' }));
        fillMetaFields({ ...d, tracks, length: d.length || m.length, producer: d.producer || m.producer, label: d.label || m.label,
          genres: d.genres.length ? d.genres : m.genres, releaseDate: d.releaseDate || m.releaseDate, wikiUrl: m.wikiUrl });
        const own = formCovers.filter(u => u.startsWith('data:'));
        formCovers = [...own, ...m.covers]; coverIdx = 0; drawCover();
      }
    } catch (e) { console.warn(e); }
    st.textContent = formCovers.length ? 'Hazır. Kaydetmeden önce kontrol edin.' : 'Bilgiler geldi ama kapak bulunamadı. Fotoğraf yükleyebilirsiniz.';
  } catch (e) {
    st.className = 'status err';
    st.textContent = /404/.test(e.message) ? 'Discogs\'ta bu kayıt bulunamadı.' : /429/.test(e.message) ? 'Discogs çok sık istek aldı; bir dakika sonra deneyin.' : 'Discogs\'a ulaşılamadı. Bağlantınızı kontrol edin.';
    console.error(e);
  } finally { btn.disabled = false; }
}
$('#discogsFill').addEventListener('click', discogsFill);
F('iDiscogs').addEventListener('paste', () => setTimeout(() => { if (Lookup.parseDiscogs(F('iDiscogs').value)) discogsFill(); }, 0));

function readForm() {
  const y = F('iYear').value.trim(), m = F('iMonth').value.trim(), d = F('iDay').value.trim();
  let rel = ''; if (/^\d{4}$/.test(y)) { rel = y; if (m && +m >= 1 && +m <= 12) { rel += '-' + String(+m).padStart(2, '0'); if (d && +d >= 1 && +d <= 31) rel += '-' + String(+d).padStart(2, '0'); } }
  return { title: F('iTitle').value.trim(), artist: F('iArtist').value.trim(), addedDate: F('iAdded').value || '', releaseDate: rel,
    genres: fixGenres(F('iGenres').value.split(',').map(s => s.trim()).filter(Boolean)), wikiUrl: F('iWiki').value.trim(), label: F('iLabel').value.trim(),
    producer: F('iProducer').value.trim(), length: F('iLength').value.trim(), tracks: textToTracks(F('iTracks').value),
    cover: formCovers[coverIdx] || '', discogsUrl: Lookup.parseDiscogs(F('iDiscogs').value) ? F('iDiscogs').value.trim() : '' };
}
$('#form').addEventListener('submit', async e => {
  e.preventDefault(); const st = $('#saveStatus'); st.className = 'status';
  const data = readForm(); if (!data.title || !data.artist) { st.className = 'status err'; st.textContent = 'Albüm adı ve sanatçı gerekli.'; return; }
  const btn = $('#saveBtn'); btn.disabled = true; st.textContent = 'Kaydediliyor…';
  try {
    if (fetchedMeta) { data.wikiSummary = fetchedMeta.wikiSummary || ''; data.mbid = fetchedMeta.mbid || ''; }
    let id;
    if (editingId) { const old = records.find(r => r.id === editingId) || {};
      if (!fetchedMeta) { data.wikiSummary = old.wikiSummary || ''; data.mbid = old.mbid || ''; }
      await store.set(editingId, { ...data, createdAt: old.createdAt || Date.now() }); id = editingId; }
    else id = await store.add({ ...data, wikiSummary: data.wikiSummary || '', mbid: data.mbid || '', createdAt: Date.now() });
    hide('#formSheet'); toast(editingId ? 'Değişiklikler kaydedildi' : `"${data.title}" rafa eklendi`);
    if (!editingId && !fetchedMeta) enrich({ id, ...data });
  } catch (err) { st.className = 'status err'; st.textContent = 'Kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.'; console.error(err); }
  finally { btn.disabled = false; }
});

/* ---------------- enrichment ---------------- */
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
async function enrich(r, force = false) {
  if (busy.has(r.id) || !navigator.onLine) { if (!navigator.onLine) toast('İnternet bağlantısı yok'); return false; }
  busy.add(r.id); render();
  try {
    const ms = await Lookup.search(r.title, r.artist);
    if (!ms.length) { if (force) toast(`"${r.title}" için bilgi bulunamadı`); return false; }
    const d = await Lookup.details(ms[0], r);
    const part = {};
    for (const k of META) if (!isEmpty(d[k]) && (force || isEmpty(r[k]))) part[k] = d[k];
    if (d.covers.length && (isEmpty(r.cover) || (force && !String(r.cover).startsWith('data:')))) part.cover = d.covers[0];
    if (Object.keys(part).length) await store.update(r.id, part);
    if (force) toast(`"${r.title}" güncellendi`);
    return true;
  } catch (e) { console.error(e); if (force) toast('Bilgiler getirilemedi'); return false; }
  finally { busy.delete(r.id); render(); }
}
$('#mFillCovers').onclick = async () => {
  closeMenu();
  const todo = records.filter(r => isEmpty(r.cover) || isEmpty(r.releaseDate) || isEmpty(r.genres));
  const p = $('#progress');
  if (!todo.length) { toast('Tüm plakların kapağı ve bilgileri tamam'); return; }
  p.hidden = false; let ok = 0;
  for (let i = 0; i < todo.length; i++) { p.textContent = `Kapak ve bilgiler aranıyor: ${i + 1} / ${todo.length} · ${todo[i].title}`; if (await enrich(todo[i])) ok++; }
  p.hidden = true; toast(`${ok} plak güncellendi${todo.length - ok ? `, ${todo.length - ok} tanesi bulunamadı` : ''}`);
};

/* ---------------- menu, backup ---------------- */
function closeMenu() { $('#menuList').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
$('#menuBtn').onclick = e => { e.stopPropagation(); const l = $('#menuList'); l.hidden = !l.hidden; $('#menuBtn').setAttribute('aria-expanded', String(!l.hidden)); };
document.addEventListener('click', e => { if (!e.target.closest('.menu')) closeMenu(); });
$('#mExport').onclick = () => {
  closeMenu();
  const blob = new Blob([JSON.stringify({ app: 'plak-arsivim', version: 1, exported: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `plak-arsivim-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#importFile').addEventListener('change', async e => {
  closeMenu(); const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); const list = Array.isArray(j) ? j : j.records;
    if (!Array.isArray(list)) throw new Error('format');
    const have = new Set(records.map(normKey)); let n = 0;
    for (const r of list) { if (!r || !r.title || !r.artist || have.has(normKey(r))) continue;
      const { id, ...data } = r; await store.add({ ...data, createdAt: data.createdAt || Date.now() }); have.add(normKey(r)); n++; }
    toast(`${n} plak eklendi${list.length - n ? `, ${list.length - n} tanesi zaten vardı` : ''}`);
  } catch (err) { toast('Bu dosya okunamadı. Plak Arşivim yedeği seçin.'); }
});

/* ---------------- controls ---------------- */
$('#q').addEventListener('input', e => { filter.q = e.target.value; render(); });
$('#fArtist').addEventListener('change', e => { filter.artist = e.target.value; saveFilter(); render(); });
$('#fGenre').addEventListener('change', e => { filter.genre = e.target.value; saveFilter(); render(); });
$('#sort').addEventListener('change', e => { filter.sort = e.target.value; saveFilter(); render(); });
$('#addBtn').addEventListener('click', () => openForm(null));
window.addEventListener('online', () => setConn()); window.addEventListener('offline', () => setConn());
function setConn(text) {
  const base = store?.kind === 'cloud' ? 'Senkron açık · tüm cihazlarınızda aynı arşiv' : 'Yerel mod · kayıtlar sadece bu cihazda';
  $('#conn').textContent = text || (navigator.onLine ? base : 'Çevrimdışı · değişiklikler bağlantı gelince eşitlenir');
}

/* ---------------- boot ---------------- */
function start(s, who) {
  store = s; $('#gate').hidden = true; $('#app').hidden = false;
  $('#who').textContent = (who || 'Yerel mod: kayıtlar bu cihazda') + ' · sürüm ' + APP_VERSION;
  setConn();
  store.subscribe(list => { records = list.map(r => ({ ...r, genres: fixGenres(r.genres) })); render(); }, err => { console.error(err); setConn('Arşive ulaşılamadı. Sayfayı yenileyin.'); });
  const localRecs = readLocal();
  $('#mMigrate').hidden = !(s.kind === 'cloud' && localRecs.length);
}
$('#mMigrate').onclick = async () => {
  closeMenu(); const have = new Set(records.map(normKey)); let n = 0;
  try { for (const r of readLocal()) { if (have.has(normKey(r))) continue; const { id, ...data } = r; await store.add(data); n++; }
    localStorage.removeItem(LOCAL_KEY); $('#mMigrate').hidden = true; toast(`${n} plak hesabınıza taşındı`);
  } catch (e) { toast('Taşınamadı, tekrar deneyin'); }
};

const cfg = window.FIREBASE_CONFIG;
if (cfg && window.firebase) {
  firebase.initializeApp(cfg);
  const auth = firebase.auth(); const db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  let started = false;
  auth.onAuthStateChanged(u => {
    if (u) { if (!started) { started = true; start(new FireStore(db, u.uid), u.email || u.displayName || 'Giriş yapıldı'); $('#mSignOut').hidden = false; } }
    else { if (started) location.reload(); $('#app').hidden = true; $('#gate').hidden = false; }
  });
  $('#signIn').onclick = async () => {
    const st = $('#gateStatus'); st.className = 'status'; st.textContent = '';
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(provider); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) { try { await auth.signInWithRedirect(provider); return; } catch (e2) { e = e2; } }
      if (e.code === 'auth/popup-closed-by-user') return;
      st.className = 'status err';
      st.textContent = e.code === 'auth/unauthorized-domain' ? 'Bu adres Firebase\'de yetkili değil. KURULUM.md 2.4. adıma bakın.' : 'Giriş yapılamadı: ' + (e.message || e.code);
    }
  };
  $('#mSignOut').onclick = () => { closeMenu(); auth.signOut(); };
} else {
  start(new LocalStore());
  if (cfg && !window.firebase) setConn('Firebase yüklenemedi (internet?) · şimdilik yerel mod');
}

/* ---------------- updates ---------------- */
// Yeni sürüm yayınlanınca: arka planda indirilir, form açık değilse sayfa kendini yeniler.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    const apply = () => { reloading = true; location.reload(); };
    if ($('#formSheet').hidden) apply();
    else { toast('Yeni sürüm hazır; formu kapatınca yüklenecek'); const iv = setInterval(() => { if ($('#formSheet').hidden) { clearInterval(iv); apply(); } }, 1000); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
    window.__checkUpdate = check;
  }).catch(() => {});
}
$('#mUpdate').onclick = async () => {
  closeMenu(); toast('Güncelleme denetleniyor…');
  try { await window.__checkUpdate?.(); } catch (e) {}
  setTimeout(() => toast('Uygulama güncel · sürüm ' + APP_VERSION), 2500);
};
})();
