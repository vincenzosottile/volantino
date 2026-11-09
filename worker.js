// Server di ricerca immagini per "Crea Volantino Offerte"
// Da incollare in un Cloudflare Worker (piano gratuito).
// Uso:  /?q=prosciutto crudo      -> elenco immagini (Google, con Bing come riserva)
//       /?img=https://...         -> scarica un'immagine e la rende utilizzabile dalla pagina

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
  });
}

function unescapeJs(s) {
  try { return JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch (e) { return s; }
}

function decodeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ---------- Google Immagini ----------
async function google(q, page) {
  const url = 'https://www.google.com/search?tbm=isch&hl=it&gl=it&safe=active&ijn=' + (page - 1) + '&start=' + ((page - 1) * 100) + '&q=' + encodeURIComponent(q);
  const r = await fetch(url, {
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'it-IT,it;q=0.9',
      'Cookie': 'CONSENT=YES+cb; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiAo_CmBg'
    }
  });
  if (!r.ok) throw new Error('google ' + r.status);
  const html = await r.text();
  const items = [];
  const seen = new Set();
  // Coppie [miniatura gstatic, w, h] seguite da [originale, w, h]
  const re = /\["(https?:\/\/[^"]+?)",(\d+),(\d+)\]/g;
  let m, lastThumb = null;
  while ((m = re.exec(html)) && items.length < 100) {
    const u = unescapeJs(m[1]);
    if (/gstatic\.com\/images/.test(u)) { lastThumb = u; continue; }
    if (/google\.|gstatic\./.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    items.push({ full: u, thumb: lastThumb || u });
    lastThumb = null;
  }
  // Riserva: solo miniature (pagina semplificata)
  if (!items.length) {
    const re2 = /<img[^>]+src="(https:\/\/encrypted-tbn\d\.gstatic\.com\/images\?[^"]+)"/g;
    while ((m = re2.exec(html)) && items.length < 30) {
      const u = decodeHtml(m[1]);
      items.push({ full: u, thumb: u });
    }
  }
  return items;
}

// ---------- Bing Immagini (riserva) ----------
async function bing(q, page) {
  const url = 'https://www.bing.com/images/async?q=' + encodeURIComponent(q) + '&first=' + ((page - 1) * 35) + '&count=35&mmasync=1&setlang=it&cc=IT';
  const r = await fetch(url, { headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'it-IT,it;q=0.9' } });
  if (!r.ok) throw new Error('bing ' + r.status);
  const html = decodeHtml(await r.text());
  const items = [];
  const re = /"murl":"(.*?)".*?"turl":"(.*?)"/g;
  let m;
  while ((m = re.exec(html)) && items.length < 35) {
    items.push({ full: m[1].replace(/\\\//g, '/'), thumb: m[2].replace(/\\\//g, '/') });
  }
  return items;
}

// ---------- Proxy immagini ----------
async function proxyImage(target) {
  let origin = '';
  try { origin = new URL(target).origin + '/'; } catch (e) { return json({ error: 'url non valido' }, 400); }
  const r = await fetch(target, { headers: { 'User-Agent': DESKTOP_UA, 'Referer': origin, 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8' } });
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
    if (!q) return json({ ok: true, info: 'Server di ricerca del volantino attivo. Usa ?q=prodotto' });
    const page = Math.max(1, parseInt(u.searchParams.get('page') || '1', 10) || 1);

    let items = [], source = [], errors = [];
    try { items = await google(q, page); if (items.length) source.push('Google'); } catch (e) { errors.push(String(e.message || e)); }
    if (items.length < 1) {
      try { const b = await bing(q, page); if (b.length) { items = items.concat(b); source.push('Bing'); } } catch (e) { errors.push(String(e.message || e)); }
    }
    return json({ source: source.join(' + '), items: items.slice(0, 100), errors });
  }
};
