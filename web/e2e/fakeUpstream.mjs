// A tiny stand-in for Steam's public endpoints, Steam's community page and psthc.fr, so the end-to-end tests exercise the real
// server code (search -> add -> achievements -> guide) without internet. Formats follow the real services.
import http from 'node:http';
import zlib from 'node:zlib';

const PORT = Number(process.env.FAKE_UPSTREAM_PORT || 4174);
const GAMES = {
  1245620: { name: 'ELDEN RING', year: 2022, genres: ['RPG', 'Action'], dev: 'FromSoftware', text: 'Levez-vous, Sans-éclat, et que la grâce guide vos pas. Parcourez les Terres Intermédiaires et devenez le seigneur d’Elden.' + ' Un vaste monde à explorer.'.repeat(12), hue: 28 },
  1145360: { name: 'Hades', year: 2020, genres: ['Roguelike'], dev: 'Supergiant Games', text: 'Défiez le dieu des morts et échappez-vous des Enfers.', hue: 350 },
  504230: { name: 'Celeste', year: 2018, genres: ['Plateforme'], dev: 'Maddy Makes Games', text: 'Aidez Madeline à survivre à ses démons intérieurs au sommet de la montagne Celeste.', hue: 200 },
  367520: { name: 'Hollow Knight', year: 2017, genres: ['Metroidvania'], dev: 'Team Cherry', text: 'Explorez un vaste royaume d’insectes et de héros en ruines.', hue: 260 },
  413150: { name: 'Stardew Valley', year: 2016, genres: ['Simulation'], dev: 'ConcernedApe', text: 'Vous venez d’hériter de la ferme de votre grand-père.', hue: 110 }
};
const achievementsOf = (id) => Array.from({ length: id === '1245620' ? 24 : 8 }, (_, i) => ({
  name: i === 0 ? 'Elden Ring' : `Succès ${i + 1} de ${GAMES[id].name}`,
  desc: i === 3 ? '' : `Description du succès numéro ${i + 1}.`,
  pct: Math.round((60 / (i + 1) + 0.4) * 10) / 10
}));

function png(hue) {
  const w = 60, h = 80;
  const rgb = (hh, l) => { const a = 0.55 * Math.min(l, 1 - l); const f = (n) => { const k = (n + hh / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb((hue + x * 0.6) % 360, 0.18 + 0.4 * (1 - y / h));
      raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;
  if (p === '/api/storesearch/') {
    const q = (url.searchParams.get('term') || '').toLowerCase();
    return json(res, { total: 1, items: Object.entries(GAMES).filter(([, g]) => g.name.toLowerCase().includes(q)).map(([id, g]) => ({ type: 'app', id: Number(id), name: g.name, tiny_image: 'x' })) });
  }
  if (p === '/api/appdetails') {
    const id = url.searchParams.get('appids');
    const g = GAMES[id];
    return json(res, { [id]: g ? { success: true, data: { name: g.name, short_description: g.text, release_date: { date: `1 janv. ${g.year}` }, genres: g.genres.map((description) => ({ description })), developers: [g.dev], screenshots: [{ path_full: 'x' }] } } : { success: false } });
  }
  if ((m = /^\/stats\/(\d+)\/achievements\/?$/.exec(p)) && GAMES[m[1]]) {
    const rows = achievementsOf(m[1]).map((a) => `<div class="achieveRow "><div class="achieveImgHolder"><img src="${process.env.FAKE_UPSTREAM_BASE || `http://127.0.0.1:${PORT}`}/steam/apps/${m[1]}/ach.png" width="64" height="64" border="0"></div><div class="achieveTxtHolder"><div class="achievePercent">${a.pct}%</div><div class="achieveTxt"><h3>${a.name}</h3><h5>${a.desc}</h5></div></div></div>`).join('\n');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<html><body><div id="personalAchieve">${rows}</div></body></html>`);
  }
  if (p === '/wp-json/wp/v2/search') {
    const q = (url.searchParams.get('search') || '').toLowerCase();
    const hit = Object.values(GAMES).find((g) => g.name.toLowerCase() === q);
    const base = process.env.FAKE_UPSTREAM_BASE || `http://127.0.0.1:${PORT}`;
    return json(res, hit ? [{ id: 1, title: `Guide des trophées de ${hit.name}`, url: `${base}/guide-trophees-${hit.name.toLowerCase().replace(/\W+/g, '-')}/` }] : []);
  }
  if ((m = /^\/steam\/apps\/(\d+)\/(library_600x900_2x|header|ach)\.(jpg|png)$/.exec(p))) {
    if (m[2] === 'header' && m[1] === '504230') { res.writeHead(404); return res.end(); } // one game without a screenshot
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(png(GAMES[m[1]] ? GAMES[m[1]].hue : 200));
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, '127.0.0.1', () => console.log('fake upstream on :' + PORT));
