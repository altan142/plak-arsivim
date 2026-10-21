// Albüm bilgisi ve kapak bulma: MusicBrainz + Cover Art Archive + Wikidata/Wikipedia + iTunes
(() => {
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, ms = 12000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return await r.json();
  } finally { clearTimeout(t); }
}

// MusicBrainz: en fazla saniyede 1 istek
let mbLast = 0;
async function mb(path) {
  const wait = mbLast + 1100 - Date.now(); if (wait > 0) await sleep(wait);
  mbLast = Date.now();
  return getJSON('https://musicbrainz.org/ws/2/' + path + (path.includes('?') ? '&' : '?') + 'fmt=json');
}

function jsonp(url, ms = 9000) {
  return new Promise((res, rej) => {
    const cb = 'jp_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const t = setTimeout(() => { done(); rej(new Error('timeout')); }, ms);
    function done() { clearTimeout(t); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); }
    window[cb] = d => { done(); res(d); };
    s.onerror = () => { done(); rej(new Error('jsonp')); };
    s.src = url + '&callback=' + cb;
    document.head.append(s);
  });
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/ı/g, 'i').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const luc = s => String(s).replace(/([+\-!(){}\[\]^"~*?:\\\/]|&&|\|\|)/g, '\\$1');
// Her kelimenin ilk harfi büyük: "progressive rock" → "Progressive Rock", "synth-pop" → "Synth-Pop"
const cap = s => s ? String(s).toLowerCase().replace(/(^|[\s\-\/(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s;
// Süre: 59 dk'ya kadar m:ss, üstünde s:dd:ss (ör. 2:43:05)
const mmss = ms => { if (!ms) return ''; const t = Math.round(ms / 1000); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec; };
// Plak/CD dışındaki ortamlar (DVD, Blu-ray vb.) şarkı listesine ve toplam süreye katılmaz
const isVideo = m => /dvd|blu-?ray|vhs|video|laserdisc|umd/i.test(m.format || '');
const credit = ac => (ac || []).map(a => (a.name || a.artist?.name || '') + (a.joinphrase || '')).join('').trim();
const wikiUrl = title => 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%27/g, "'");

/* ---------- arama: olası albümler ---------- */
async function search(title, artist) {
  let list = [];
  try {
    const q = `releasegroup:"${luc(title)}" AND artist:"${luc(artist)}"`;
    let d = await mb('release-group/?limit=8&query=' + encodeURIComponent(q));
    let rgs = d['release-groups'] || [];
    if (!rgs.length) {
      d = await mb('release-group/?limit=8&query=' + encodeURIComponent(`${luc(title)} AND artist:(${luc(artist)})`));
      rgs = d['release-groups'] || [];
    }
    const typeRank = t => t === 'Album' ? 0 : t === 'EP' ? 1 : 2;
    rgs.sort((a, b) => typeRank(a['primary-type']) - typeRank(b['primary-type']) || (b.score || 0) - (a.score || 0));
    list = rgs.map(r => ({ source: 'mb', id: r.id, title: r.title, artist: credit(r['artist-credit']),
      year: (r['first-release-date'] || '').slice(0, 4), type: r['primary-type'] || '' }));
  } catch (e) { console.warn('MusicBrainz araması başarısız', e); }
  if (!list.length) {
    const it = await itunes(title, artist).catch(() => null);
    if (it) list.push({ source: 'itunes', id: String(it.collectionId), title: it.collectionName, artist: it.artistName,
      year: (it.releaseDate || '').slice(0, 4), type: 'Album', it });
  }
  return list;
}

/* ---------- ayrıntılar ---------- */
async function details(c, typed) {
  const out = { title: c.title, artist: c.artist, releaseDate: '', genres: [], label: '', producer: '', length: '',
    tracks: [], wikiUrl: '', wikiSummary: '', covers: [], mbid: c.source === 'mb' ? c.id : '' };
  const addCover = u => { if (u && !out.covers.includes(u)) out.covers.push(u); };
  let wdGenres = [];

  if (c.source === 'mb') {
    // release group
    let rg = null;
    try { rg = await mb(`release-group/${c.id}?inc=url-rels+genres+tags`); } catch (e) { console.warn(e); }
    if (rg) {
      out.releaseDate = rg['first-release-date'] || '';
      const g = (rg.genres && rg.genres.length ? rg.genres : (rg.tags || []))
        .slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 3).map(x => cap(x.name));
      out.genres = g;
      const dg = (rg.relations || []).map(r => /discogs\.com\/master\/(\d+)/.exec(r.url?.resource || '')?.[1]).find(Boolean);
      if (dg) out.discogsMaster = dg;
      const wd = (rg.relations || []).find(r => r.type === 'wikidata');
      const qid = wd && /Q\d+/.exec(wd.url?.resource || '')?.[0];
      if (qid) {
        try {
          const ent = (await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks|claims&sitefilter=enwiki&format=json&origin=*`)).entities[qid];
          const t = ent?.sitelinks?.enwiki?.title; if (t) out.wikiUrl = wikiUrl(t);
          const ids = p => (ent?.claims?.[p] || []).map(x => x.mainsnak?.datavalue?.value?.id).filter(Boolean);
          const gIds = ids('P136').slice(0, 3), pIds = ids('P162').slice(0, 3);
          if (gIds.length || pIds.length) {
            const labs = (await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${[...gIds, ...pIds].join('|')}&props=labels&languages=en&format=json&origin=*`)).entities;
            const lab = id => labs?.[id]?.labels?.en?.value;
            wdGenres = gIds.map(lab).filter(Boolean).map(cap);
            out.producer = pIds.map(lab).filter(Boolean).join(', ');
          }
        } catch (e) { console.warn('Wikidata', e); }
      }
    }
    if (wdGenres.length) out.genres = wdGenres;

    // kapak: Cover Art Archive
    try {
      const caa = await getJSON(`https://coverartarchive.org/release-group/${c.id}`);
      const img = (caa.images || []).find(i => i.front) || (caa.images || [])[0];
      if (img) addCover((img.thumbnails && (img.thumbnails['500'] || img.thumbnails.large)) || img.image);
    } catch (e) { /* kapak yok */ }

    // şarkı listesi: tercihen plak baskısı
    try {
      const d = await mb(`release?release-group=${c.id}&inc=recordings+labels+media&limit=40`);
      const rels = (d.releases || []).filter(r => (r.media || []).some(m => (m.tracks || []).length));
      const isVinyl = r => (r.media || []).some(m => /vinyl/i.test(m.format || ''));
      const audioOnly = r => !(r.media || []).some(isVideo);
      const official = r => r.status === 'Official';
      rels.sort((a, b) => (isVinyl(b) - isVinyl(a)) || (audioOnly(b) - audioOnly(a)) || (official(b) - official(a)) || (a.date || '9999').localeCompare(b.date || '9999'));
      const r = rels[0];
      if (r) {
        const media = r.media.filter(m => !isVideo(m) && (m.tracks || []).length);
        const multi = media.length > 1; let total = 0;
        media.forEach(m => (m.tracks || []).forEach(t => {
          const len = t.length || t.recording?.length || 0; total += len;
          const num = String(t.number || t.position || '');
          out.tracks.push({ pos: multi && /^\d+$/.test(num) ? `${m.position}-${num}` : num, title: t.title, len: mmss(len) });
        }));
        out.length = mmss(total);
        out.label = r['label-info']?.find(l => l.label?.name)?.label?.name || '';
      }
    } catch (e) { console.warn('Şarkı listesi', e); }
  }

  // Plak baskısının yüz düzeni (A1, A2, B1…) Discogs'tan; süreler eksikse MusicBrainz'deki aynı şarkıdan
  if (out.discogsMaster && !out.tracks.some(t => /^[A-Z]/.test(t.pos))) {
    try {
      const vinyl = await discogsVinyl(out.discogsMaster);
      if (vinyl && vinyl.length) {
        const byTitle = new Map(out.tracks.map(t => [norm(t.title), t.len]));
        const toMs = l => { const p = String(l || '').split(':').map(Number); return p.some(isNaN) || !l ? 0 : p.reduce((a, b) => a * 60 + b, 0) * 1000; };
        const tracks = vinyl.map(t => ({ pos: t.pos, title: t.title, len: t.len || byTitle.get(norm(t.title)) || '' }));
        out.tracks = tracks;
        if (tracks.every(t => t.len)) out.length = mmss(tracks.reduce((a, t) => a + toMs(t.len), 0));
        out.format = 'vinyl';
      }
    } catch (e) { console.warn('Discogs', e); }
  }

  // Wikipedia: link yoksa arama, sonra özet + görsel
  try {
    if (!out.wikiUrl) {
      const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${out.title} ${out.artist} album`)}&srlimit=3&format=json&origin=*`);
      const hit = (s.query?.search || []).find(h => norm(h.title).includes(norm(out.title)));
      if (hit) out.wikiUrl = wikiUrl(hit.title);
    }
    if (out.wikiUrl) {
      const title = decodeURIComponent(out.wikiUrl.split('/wiki/')[1]);
      const sum = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      out.wikiSummary = sum.extract || '';
      addCover(sum.thumbnail?.source || sum.originalimage?.source);
    }
  } catch (e) { console.warn('Wikipedia', e); }

  // iTunes: ek kapak + eksik alanlar
  try {
    const it = c.it || await itunes(out.title || typed?.title, out.artist || typed?.artist);
    if (it) {
      addCover(it.artworkUrl100 && it.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'));
      if (!out.releaseDate && it.releaseDate) out.releaseDate = it.releaseDate.slice(0, 4);
      if (!out.genres.length && it.primaryGenreName) out.genres = [cap(it.primaryGenreName)];
    }
  } catch (e) { /* yok */ }

  return out;
}

// Discogs: master'ın plak baskılarından şarkı listesi olan ilkini al (sadece plak olanlar önce)
async function discogsVinyl(masterId) {
  const v = await getJSON(`https://api.discogs.com/masters/${masterId}/versions?format=Vinyl&per_page=25`);
  // ?format=Vinyl zaten plak içeren baskıları getirir (kutu setler dahil); salt plak olanlar öne
  const vers = (v.versions || []).slice();
  const pure = x => (x.major_formats || []).includes('Vinyl') ? 0 : 1;
  vers.sort((a, b) => (pure(a) - pure(b)) || String(a.released || '9999').localeCompare(String(b.released || '9999')));
  const isSide = pos => /^[A-Z]{1,2}\d*[a-z]?$/.test(pos || '');
  for (const ver of vers.slice(0, 3)) {
    const rel = await getJSON(`https://api.discogs.com/releases/${ver.id}`);
    const list = [];
    for (const t of rel.tracklist || []) {
      if (t.type_ === 'track' && isSide(t.position)) list.push({ pos: t.position, title: t.title, len: t.duration || '' });
      else if (t.type_ === 'index') (t.sub_tracks || []).forEach(st => { if (isSide(st.position)) list.push({ pos: st.position, title: `${t.title}: ${st.title}`, len: st.duration || '' }); });
    }
    if (list.length) return list;
  }
  return null;
}

async function itunes(title, artist) {
  const d = await jsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(artist + ' ' + title)}&entity=album&limit=10`);
  const nt = norm(title), na = norm(artist);
  const res = d.results || [];
  return res.find(r => norm(r.collectionName) === nt && norm(r.artistName).includes(na))
      || res.find(r => norm(r.collectionName).startsWith(nt) && norm(r.artistName).includes(na))
      || res.find(r => norm(r.collectionName).includes(nt)) || null;
}

window.Lookup = { search, details };
})();
