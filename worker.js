// Server di ricerca immagini per "Crea Volantino Offerte"  (versione 4)
// Da incollare in un Cloudflare Worker (piano gratuito).
// Uso:  /?q=prosciutto crudo            -> elenco immagini
//       /?q=prosciutto crudo&debug=1    -> diagnosi: cosa risponde ogni motore
//       /?img=https://...               -> scarica un'immagine per la pagina
// Motori provati in ordine: Google, Bing, DuckDuckGo, Yahoo (si ferma al primo che dà risultati)

const UA_DESK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UA_MOB = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const BASE_HEADERS = {
  'User-Agent': UA_DESK,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.6'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function decodeHtml(s) { return s.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function unescapeJs(s) { try { return JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch (e) { return s.replace(/\\\//g, '/'); } }
function isImgUrl(u) { return /^https?:\/\//.test(u) && u.length < 2000; }
function uniq(items) { const seen = new Set(); return items.filter(it => it.full && isImgUrl(it.full) && !seen.has(it.full) && seen.add(it.full)); }
async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { ...BASE_HEADERS, ...headers }, redirect: 'follow' });
  const text = await r.text();
  return { status: r.status, text };
}

// ---------------- Google ----------------
async function google(q, page) {
  const urls = [
    'https://www.google.com/search?udm=2&hl=it&gl=it&safe=active&start=' + ((page - 1) * 20) + '&q=' + encodeURIComponent(q),
    'https://www.google.com/search?tbm=isch&hl=it&gl=it&safe=active&ijn=' + (page - 1) + '&q=' + encodeURIComponent(q)
  ];
  let last = '';
  for (const url of urls) {
    const r = await get(url, { 'Cookie': 'CONSENT=YES+cb; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiAo_CmBg' });
    if (r.status !== 200) { last = 'HTTP ' + r.status; continue; }
    if (/unusual traffic|sorry\/index|captcha/i.test(r.text)) { last = 'bloccato (captcha)'; continue; }
    const items = []; const re = /\["(https?:\/\/[^"]+?)",(\d+),(\d+)\]/g; let m, thumb = null;
    while ((m = re.exec(r.text)) && items.length < 100) {
      const u = unescapeJs(m[1]);
      if (/gstatic\.com\/images/.test(u)) { thumb = u; continue; }
      if (/google\.|gstatic\./.test(u)) continue;
      items.push({ full: u, thumb: thumb || u }); thumb = null;
    }
    if (items.length) return { items: uniq(items) };
    last = 'nessun risultato leggibile';
  }
  throw new Error(last || 'errore');
}

// ---------------- Bing ----------------
function parseBing(html) {
  const items = [];
  const raw = html;
  const dec = decodeHtml(html);
  const re1 = /"murl":"(.*?)".*?"turl":"(.*?)"/g; let m;
  while ((m = re1.exec(dec)) && items.length < 100) items.push({ full: unescapeJs(m[1]), thumb: unescapeJs(m[2]) });
  if (!items.length) {
    const re2 = /murl&quot;:&quot;(.*?)&quot;.*?turl&quot;:&quot;(.*?)&quot;/g;
    while ((m = re2.exec(raw)) && items.length < 100) items.push({ full: decodeHtml(m[1]), thumb: decodeHtml(m[2]) });
  }
  if (!items.length) {
    const re3 = /mediaurl=([^&"']+)/g;
    while ((m = re3.exec(raw)) && items.length < 100) {
      let u; try { u = decodeURIComponent(decodeHtml(m[1])); } catch (e) { continue; }
      items.push({ full: u, thumb: u });
    }
  }
  return items;
}
function bingSample(html, url) {
  const keys = ['iusc', 'murl', 'mediaurl', 'turl', 'mimg', 'OIP', 'th.bing.com', 'tse', 'data-src', 'imgpt', 'm="', 'captcha', 'challenge', 'consent', 'cookie', 'redirect', 'location'];
  const counts = {}; keys.forEach(k => counts[k] = (html.split(k).length - 1));
  const t = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const i = html.search(/OIP|th\.bing\.com|imgpt|mimg/);
  return { url: url.replace(/\?.*/, ''), lunghezza: html.length, titolo: t, conteggi: counts, testo_visibile: text.slice(0, 300),
    inizio: html.slice(0, 300), vicino_immagini: i > 0 ? html.slice(Math.max(0, i - 200), i + 300) : '' };
}
async function bing(q, page) {
  const first = (page - 1) * 35 + 1;
  const attempts = [
    ['https://www.bing.com/images/async?q=' + encodeURIComponent(q) + '&first=' + first + '&count=35&mmasync=1&setlang=it-IT&cc=IT', {}],
    ['https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&first=' + first + '&form=HDRSC2&setlang=it-IT&cc=IT', {}],
    ['https://www.bing.com/images/async?q=' + encodeURIComponent(q) + '&first=' + first + '&count=35&mmasync=1', { 'User-Agent': UA_MOB }],
    ['https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&first=' + first + '&FORM=HDRSC3', { 'User-Agent': UA_MOB }]
  ];
  let last = '', samples = [];
  for (const [url, h] of attempts) {
    const r = await get(url, h);
    if (r.status !== 200) { last = 'HTTP ' + r.status; samples.push({ url: url.replace(/\?.*/, ''), status: r.status }); continue; }
    const items = parseBing(r.text);
    if (items.length) return { items: uniq(items) };
    last = 'nessun risultato leggibile (' + r.text.length + ' caratteri)';
    samples.push(r.text.length > 1000 ? bingSample(r.text, url) : { url: url.replace(/\?.*/, ''), lunghezza: r.text.length, inizio: r.text.slice(0, 200) });
  }
  const sample = samples;
  const e = new Error(last); e.sample = sample; throw e;
}

// ---------------- DuckDuckGo ----------------
async function duck(q, page) {
  const r1 = await get('https://duckduckgo.com/?q=' + encodeURIComponent(q) + '&iax=images&ia=images');
  const m = r1.text.match(/vqd=["']?([\d-]+)["']?/) || r1.text.match(/vqd["']?\s*[:=]\s*["']([^"']+)["']/);
  if (!m) throw new Error('token mancante (HTTP ' + r1.status + ')');
  const url = 'https://duckduckgo.com/i.js?l=it-it&o=json&q=' + encodeURIComponent(q) + '&vqd=' + encodeURIComponent(m[1]) + '&f=,,,,,&p=1&s=' + ((page - 1) * 100);
  const r2 = await fetch(url, { headers: { ...BASE_HEADERS, 'Accept': 'application/json', 'Referer': 'https://duckduckgo.com/', 'X-Requested-With': 'XMLHttpRequest' } });
  if (!r2.ok) throw new Error('HTTP ' + r2.status);
  const j = await r2.json();
  const items = (j.results || []).map(x => ({ full: x.image, thumb: x.thumbnail || x.image }));
  if (!items.length) throw new Error('nessun risultato');
  return { items: uniq(items) };
}

// ---------------- Yahoo ----------------
async function yahoo(q, page) {
  const url = 'https://images.search.yahoo.com/search/images?p=' + encodeURIComponent(q) + '&b=' + ((page - 1) * 60 + 1);
  const r = await get(url, { 'User-Agent': UA_DESK });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const dec = decodeHtml(r.text);
  const items = []; let m;
  const re = /"iurl":"(.*?)".*?"ith":"(.*?)"/g;
  while ((m = re.exec(dec)) && items.length < 100) items.push({ full: unescapeJs(m[1]), thumb: unescapeJs(m[2]) });
  if (!items.length) { const re2 = /"iurl":"(.*?)"/g; while ((m = re2.exec(dec)) && items.length < 100) { const u = unescapeJs(m[1]); items.push({ full: u, thumb: u }); } }
  if (!items.length) throw new Error('nessun risultato leggibile');
  return { items: uniq(items) };
}

// ---------------- Qwant ----------------
async function qwant(q, page) {
  const url = 'https://api.qwant.com/v3/search/images?count=50&locale=it_IT&safesearch=1&offset=' + ((page - 1) * 50) + '&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { ...BASE_HEADERS, 'Accept': 'application/json', 'Origin': 'https://www.qwant.com', 'Referer': 'https://www.qwant.com/' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const list = (((j.data || {}).result || {}).items || []);
  const items = list.map(x => ({ full: x.media, thumb: x.thumbnail ? (x.thumbnail.startsWith('//') ? 'https:' + x.thumbnail : x.thumbnail) : x.media }));
  if (!items.length) throw new Error('nessun risultato');
  return { items: uniq(items) };
}

const ENGINES = [['Google', google], ['Bing', bing], ['Qwant', qwant], ['DuckDuckGo', duck], ['Yahoo', yahoo]];

// ---------------- Proxy immagini ----------------
async function proxyImage(target) {
  let origin = '';
  try { origin = new URL(target).origin + '/'; } catch (e) { return json({ error: 'url non valido' }, 400); }
  const r = await fetch(target, { headers: { 'User-Agent': UA_DESK, 'Referer': origin, 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8' } });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) return json({ error: 'immagine non disponibile', status: r.status }, 502);
  return new Response(r.body, { status: 200, headers: { ...CORS, 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(request.url);
    const img = u.searchParams.get('img');
    if (img) return proxyImage(img);

    const q = (u.searchParams.get('q') || '').trim();
    if (!q) return json({ ok: true, version: 4, info: 'Server di ricerca del volantino attivo. Usa ?q=prodotto' });
    const page = Math.max(1, parseInt(u.searchParams.get('page') || '1', 10) || 1);
    const debug = u.searchParams.get('debug');

    const errors = [];
    if (debug) {
      const report = {};
      await Promise.all(ENGINES.map(async ([name, fn]) => {
        const t0 = Date.now();
        try { const r = await fn(q, page); report[name] = { ok: true, risultati: r.items.length, ms: Date.now() - t0, esempio: r.items[0] }; }
        catch (e) { report[name] = { ok: false, errore: String(e.message || e), ms: Date.now() - t0, dettagli: e.sample || undefined }; }
      }));
      return json({ version: 4, q, report });
    }
    for (const [name, fn] of ENGINES) {
      try {
        const r = await fn(q, page);
        if (r.items.length) return json({ version: 4, source: name, items: r.items.slice(0, 100), errors });
      } catch (e) { errors.push(name + ': ' + String(e.message || e)); }
    }
    return json({ version: 4, source: '', items: [], errors });
  }
};
