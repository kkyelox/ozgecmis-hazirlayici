// Özgeçmiş Hazırlayıcı — arama sunucusu (Cloudflare Worker)
// Google sonuçlarını (Serper.dev) kullanarak bir ismi sosyal medya profillerinde ve web'de arar.
// Yalnızca arama motorlarının herkese açık gösterdiği bilgileri döndürür: profil adresi, başlık,
// biyografi/özet ve profil fotoğrafı. Gönderi içeriği indirmez, giriş gerektiren sayfaları açmaz.
//
// Ayarlar (Worker > Settings > Variables and Secrets):
//   SERPER_KEY        (Secret)  serper.dev API anahtarı — sosyal medya ve web araması
//   SITE_PASSWORD     (Secret)  siteyi kullanmak için şifre — başkaları kotanı harcayamasın
//   ANTHROPIC_API_KEY (Secret, isteğe bağlı) yapay zekâ ile yeniden yazma ve teyit için
//   ALLOWED_ORIGIN    (isteğe bağlı) siteyi başka bir adreste barındırıyorsan o adres

const PLATFORMS = [
  ['instagram.com', 'Instagram'], ['linkedin.com', 'LinkedIn'], ['x.com', 'X (Twitter)'], ['twitter.com', 'X (Twitter)'],
  ['tiktok.com', 'TikTok'], ['facebook.com', 'Facebook'], ['youtube.com', 'YouTube'], ['threads.net', 'Threads'],
  ['github.com', 'GitHub'], ['medium.com', 'Medium'], ['behance.net', 'Behance'], ['vimeo.com', 'Vimeo'], ['bsky.app', 'Bluesky'],
];
const NOT_PROFILE = /^(p|reel|reels|tv|explore|stories|status|hashtag|search|watch|shorts|video|posts|pulse|company|groups|events|photo|photos|share|tags|i|intent)$/i;

const fold = s => (s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
  .replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/[âàáä]/g, 'a').replace(/[îíï]/g, 'i').replace(/[ûúù]/g, 'u').normalize('NFKD').replace(/[̀-ͯ]/g, '');
const words = s => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
const exact = (text, name) => { const w = new Set(words(text)); return words(name).every(t => w.has(t)); };

function profileOf(link) {
  let u; try { u = new URL(link); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|tr|mobile)\./, '');
  const p = PLATFORMS.find(([h]) => host === h || host.endsWith('.' + h));
  if (!p) return null;
  const seg = u.pathname.split('/').filter(Boolean);
  let handle = '';
  if (p[0] === 'linkedin.com') handle = seg[0] === 'in' ? seg[1] : '';
  else if (p[0] === 'youtube.com') handle = seg[0]?.startsWith('@') ? seg[0] : (seg[0] === 'c' || seg[0] === 'channel' ? seg[1] : '');
  else if (p[0] === 'tiktok.com') handle = seg[0]?.startsWith('@') ? seg[0] : '';
  else if (p[0] === 'bsky.app') handle = seg[0] === 'profile' ? seg[1] : '';
  else if (p[0] === 'facebook.com' && seg[0] === 'people') handle = seg[1];
  else handle = seg[0] && !NOT_PROFILE.test(seg[0]) ? seg[0] : '';
  const isProfile = !!handle && seg.length <= (p[0] === 'linkedin.com' || p[0] === 'bsky.app' ? 2 : 1);
  return { platform: p[1], host: p[0], handle: (handle || '').replace(/^@/, ''), isProfile };
}

async function serper(env, endpoint, q) {
  const r = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST', headers: { 'X-API-KEY': env.SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: 'tr', hl: 'tr', num: endpoint === 'images' ? 30 : 20 }),
  });
  if (!r.ok) throw new Error('serper ' + r.status);
  return r.json();
}

// Profil sayfasının paylaşım görselini (og:image) okumayı dener; olmazsa boş döner.
async function ogImage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'tr,en' }, cf: { cacheTtl: 86400 }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return '';
    const html = (await r.text()).slice(0, 200000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? m[1].replace(/&amp;/g, '&') : '';
  } catch { return ''; }
}

function cors(env, origin) {
  const allow = env.ALLOWED_ORIGIN ? (origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN) : '*';
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin' };
}

const has = v => !!v && v !== '-' && !/^(yok|none|bos|boş)$/i.test(v);
const json = (o, H, status = 200) => new Response(JSON.stringify(o), { status, headers: H });

async function claudeProxy(req, env, H) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.prompt !== 'string') return json({ error: 'istek hatalı' }, H, 400);
  const body = { model: 'claude-sonnet-5-5', max_tokens: 3000, messages: [{ role: 'user', content: b.prompt.slice(0, 30000) }] };
  const tool = { type: 'web_search_20250305', name: 'web_search', max_uses: b.wopt ? 6 : 12 };
  if (b.wopt && Array.isArray(b.wopt.allowed_domains)) tool.allowed_domains = b.wopt.allowed_domains.slice(0, 3).map(String);
  if (b.web) body.tools = [tool];
  const call = x => fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(x) });
  let r = await call(body);
  if (!r.ok && b.web) { delete body.tools; r = await call(body); }
  if (!r.ok) return json({ error: 'API ' + r.status }, H, 502);
  const d = await r.json();
  return json({ text: (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') }, H);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/search') return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    const origin = req.headers.get('Origin') || '';
    const H = cors(env, origin);
    H['Access-Control-Allow-Headers'] = 'content-type, x-site-pass';
    H['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    if (req.method === 'OPTIONS') return new Response(null, { headers: H });
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN && origin !== url.origin) return json({ error: 'origin' }, H, 403);
    const needPass = has(env.SITE_PASSWORD);
    if (url.pathname === '/api/health') return json({ ok: true, search: has(env.SERPER_KEY), ai: has(env.ANTHROPIC_API_KEY), pass: needPass }, H);
    if (needPass && req.headers.get('x-site-pass') !== env.SITE_PASSWORD) return json({ error: 'şifre' }, H, 401);
    if (url.pathname === '/api/check') return json({ ok: true }, H);
    if (url.pathname === '/api/claude' && req.method === 'POST') return has(env.ANTHROPIC_API_KEY) ? claudeProxy(req, env, H) : json({ error: 'ANTHROPIC_API_KEY yok' }, H, 501);
    if (url.pathname !== '/api/search' && url.pathname !== '/search') return json({ error: 'not found' }, H, 404);
    if (!has(env.SERPER_KEY)) return json({ error: 'SERPER_KEY tanımlı değil' }, H, 501);
    return search(url, env, H);
  },
};

async function search(url, env, H) {
    const name = (url.searchParams.get('name') || '').trim().slice(0, 80);
    const hint = (url.searchParams.get('hint') || '').trim().slice(0, 80);
    if (words(name).length < 2) return new Response('{"error":"ad ve soyad gerekli"}', { status: 400, headers: H });

    const sites = ['instagram.com', 'linkedin.com/in', 'x.com', 'twitter.com', 'tiktok.com', 'facebook.com', 'youtube.com', 'threads.net'].map(s => 'site:' + s).join(' OR ');
    const qs = [
      ['search', `"${name}" ${hint} (${sites})`],
      ['search', `"${name}" ${hint}`],
      ['images', `"${name}" ${hint}`],
    ];
    if (hint) qs.push(['search', `"${name}" (${sites})`]);
    const res = await Promise.allSettled(qs.map(([e, q]) => serper(env, e, q)));
    const organic = res.flatMap((r, i) => r.status === 'fulfilled' && qs[i][0] === 'search' ? (r.value.organic || []) : []);
    const images = res.flatMap((r, i) => r.status === 'fulfilled' && qs[i][0] === 'images' ? (r.value.images || []) : []);
    const hintWords = words(hint);

    const profiles = new Map(), pages = [], seen = new Set();
    for (const o of organic) {
      if (!o.link || seen.has(o.link)) continue; seen.add(o.link);
      const text = `${o.title || ''} ${o.snippet || ''}`;
      const ex = exact(o.title || '', name) || exact(text, name);
      const hits = hintWords.filter(h => words(text).includes(h) || fold(text).includes(h));
      const p = profileOf(o.link);
      if (p && p.handle) {
        const key = p.host + ':' + p.handle.toLowerCase();
        const cur = profiles.get(key) || { platform: p.platform, handle: p.handle, url: p.isProfile ? o.link : '', title: '', bio: '', exact: false, hint: [], posts: [] };
        if (p.isProfile) { cur.url = o.link; cur.title = o.title || cur.title; cur.bio = o.snippet || cur.bio; }
        else cur.posts.push({ url: o.link, text: (o.snippet || o.title || '').slice(0, 200) });
        cur.exact = cur.exact || ex; cur.hint = [...new Set([...cur.hint, ...hits])];
        if (!cur.url) cur.url = `https://${p.host}/${p.host === 'linkedin.com' ? 'in/' : ''}${p.host === 'tiktok.com' ? '@' : ''}${p.handle}`;
        profiles.set(key, cur);
      } else if (!p) {
        pages.push({ url: o.link, title: o.title || '', snippet: o.snippet || '', exact: ex, hint: hits });
      }
    }

    // Profil fotoğrafı: önce görsel aramasında aynı profile ait sonuç, sonra og:image
    const list = [...profiles.values()].filter(p => p.exact);
    for (const p of list) {
      const img = images.find(i => i.link && (i.link.toLowerCase().includes(('/' + p.handle).toLowerCase())));
      p.photo = img ? (img.thumbnailUrl || img.imageUrl || '') : '';
    }
    await Promise.all(list.filter(p => !p.photo).slice(0, 8).map(async p => { p.photo = await ogImage(p.url); }));
    list.sort((a, b) => (b.hint.length - a.hint.length) || (b.bio ? 1 : 0) - (a.bio ? 1 : 0));

    const photos = images.filter(i => exact(i.title || '', name)).slice(0, 12).map(i => ({ url: i.imageUrl, thumb: i.thumbnailUrl, page: i.link, title: i.title }));
    const web = pages.filter(p => p.exact).slice(0, 15);
    return new Response(JSON.stringify({ name, hint, profiles: list.slice(0, 15), web, photos }), { headers: { ...H, 'Cache-Control': 'private, max-age=3600' } });
}
