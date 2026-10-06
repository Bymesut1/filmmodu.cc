// ============================================================
//  Filmmodu — Nuvio Provider (teşhis modlu)
//  Site adresi değişirse sadece PRIMARY_DOMAIN satırını güncelle.
//  DEBUG = true iken sorun olursa listede "Filmmodu ⚠ ..." satırı çıkar.
// ============================================================

var PRIMARY_DOMAIN = 'https://filmmodu.cc';
var TMDB_KEY = '000316508321ce461cf81e7c6815eec7';
var DEBUG = true;
var STEP = '';
var ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36';

var PAGE_HEADERS = {
  'User-Agent': ANDROID_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9',
  'Referer': PRIMARY_DOMAIN + '/'
};

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); },
                 function (e) { clearTimeout(t); reject(e); });
  });
}

function slugify(s) {
  var map = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
  return String(s || '').replace(/İ/g, 'i').toLowerCase()
    .replace(/[çğıöşüâîû]/g, function (c) { return map[c]; })
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function norm(s) {
  return slugify(s).replace(/-/g, '');
}

// Durum kodu + metin döndürür (hata olsa da)
async function req(url, opts) {
  try {
    var res = await withTimeout(fetch(url, opts), 6000);
    var text = '';
    try { text = await withTimeout(res.text(), 6000); } catch (e) {}
    return { status: res.status, text: text || '', url: res.url || '' };
  } catch (e) {
    return { status: 0, text: '', err: String(e && e.message ? e.message : e) };
  }
}

function debugStream(msg) {
  console.log('[Filmmodu] ' + msg);
  if (!DEBUG) return [];
  return [{
    name: 'Filmmodu ⚠ ' + msg.slice(0, 80),
    title: '⚠ ' + msg,
    url: 'https://example.com/debug.m3u8',
    quality: 'Auto',
    type: 'hls',
    headers: {}
  }];
}

// Sayfanın <title> etiketi: "Can Dostum - Intouchables 2011 Film izle"
function pageTitle(html) {
  return ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
}

// Doğru film mi? Başlıkta ad (Türkçe veya orijinal) ve yıl (±1) aranır
function isRightMovie(html, title, origTitle, year) {
  var t = pageTitle(html);
  var nt = norm(t);
  var y = parseInt(year, 10), yearOk = false;
  for (var d = -1; d <= 1; d++) {
    if (!isNaN(y) && t.indexOf(String(y + d)) > -1) yearOk = true;
  }
  var nameOk = (title && nt.indexOf(norm(title)) > -1) || (origTitle && nt.indexOf(norm(origTitle)) > -1);
  return yearOk && nameOk;
}

// Sayfadaki vidmixi m3u adreslerini bulur: https://HOST/m3u/UZUN_KOD
function extractM3u(html) {
  var text = String(html || '').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  var out = [], seen = {};
  var re = /https?:\/\/[a-z0-9.\-]+\/m3u\/[A-Za-z0-9+\/=_\-]+/gi, m;
  while ((m = re.exec(text)) !== null) {
    if (seen[m[0]]) continue;
    seen[m[0]] = true;
    out.push(m[0]);
  }
  return out;
}

// Aynı adresi farklı oynatıcı ayarlarıyla sunar; hangisi çalışırsa o kullanılır
function makeVariants(url, tag) {
  var host = (url.match(/^https?:\/\/[^\/]+/) || [''])[0];
  var full = { 'User-Agent': ANDROID_UA, 'Referer': PRIMARY_DOMAIN + '/', 'Origin': PRIMARY_DOMAIN };
  var slim = { 'User-Agent': ANDROID_UA, 'Referer': host + '/' };
  // Uzantısız adrese ".m3u8" izi ekler (bazı oynatıcılar türü adrese bakarak anlar)
  var tagged = url + (url.indexOf('?') > -1 ? '&' : '?') + 'ext=.m3u8';
  function mk(suffix, type, headers, u) {
    return {
      name: 'Filmmodu' + tag + suffix,
      title: '⌜ FILMMODU ⌟ | HLS' + suffix,
      url: u || url,
      quality: 'Auto',
      type: type,
      headers: headers
    };
  }
  return [
    mk('', 'hls', full),
    mk(' (.m3u8 ek)', 'hls', slim, tagged),
    mk(' (başlıksız)', 'hls', {}),
    mk(' (m3u8)', 'm3u8', slim)
  ];
}

// Listeyi başlıklı ve başlıksız çekip durum/içerik özeti çıkarır
async function probe(url) {
  var a = await req(url, { headers: { 'User-Agent': ANDROID_UA, 'Referer': PRIMARY_DOMAIN + '/' } });
  var b = await req(url, { headers: { 'User-Agent': ANDROID_UA } });
  function d(x) { return x.status + (x.text.indexOf('#EXTM3U') === 0 ? ' ok' : ' ?'); }
  var t = a.text.indexOf('#EXTM3U') === 0 ? a.text : (b.text || '');
  var v = (t.match(/#EXT-X-STREAM-INF/g) || []).length;
  var seg = (t.match(/#EXTINF/g) || []).length;
  return 'm3u h:' + d(a) + ' n:' + d(b) + ' v' + v + ' s' + seg;
}

// Link bulunamazsa: sayfadaki ipuçlarını kısa satırlar halinde listeye yazar
function discoverStreams(html, slug) {
  var t = String(html || '').replace(/\\\//g, '/');
  var lines = ['sayfa ' + slug + ': m3u yok, vidmixi:' + (/vidmixi/i.test(t) ? 'var' : 'yok')];
  function chunks(label, text, n) {
    text = text.replace(/\s+/g, ' ');
    for (var k = 0; k < n && k * 72 < text.length; k++) {
      lines.push(label + k + ': ' + text.slice(k * 72, (k + 1) * 72));
    }
  }
  var xi = t.indexOf('XMLHttpRequest');
  if (xi > -1) chunks('xhr', t.slice(Math.max(0, xi - 60), xi + 420), 6);
  else lines.push('xhr yok');
  (t.match(/\.open\s*\([^)]{0,90}\)/g) || []).slice(0, 3).forEach(function (o) { lines.push('open: ' + o.replace(/\s+/g, ' ')); });
  var eps = [], er = /['"`](\/[a-z0-9_\-\/\.?=&]{3,70})['"`]/gi, em;
  while ((em = er.exec(t)) !== null && eps.length < 12) {
    if (/\.(css|js|png|jpg|jpeg|webp|svg|ico|gif|woff2?)(\?|$)/i.test(em[1]) || /^\/(assets|uploads|film|yil|filmizle)\b/.test(em[1])) continue;
    if (eps.indexOf(em[1]) === -1) eps.push(em[1]);
  }
  for (var k = 0; k < eps.length; k += 3) lines.push('yol: ' + eps.slice(k, k + 3).join('  '));
  var gi = t.indexOf('gruphtmls[0]');
  if (gi > -1) {
    var ge = t.indexOf("</li>'", gi);
    chunks('g', t.slice(ge > -1 ? ge + 6 : gi, (ge > -1 ? ge + 6 : gi) + 400), 5);
  }
  var vi = t.indexOf('vr_set');
  if (vi > -1) chunks('vr', t.slice(Math.max(0, vi - 80), vi + 140), 3);
  return lines.slice(0, 26).map(function (l) { return debugStream(l)[0]; });
}

async function run(tmdbId, mediaType) {
  try {
    STEP = 'tmdb';
    if (mediaType !== 'movie') return []; // site sadece film içeriyor

    var t = await req('https://api.themoviedb.org/3/movie/' + tmdbId +
                      '?language=tr-TR&api_key=' + TMDB_KEY);
    var info = {};
    try { info = JSON.parse(t.text); } catch (e) {}
    var title = info.title, origTitle = info.original_title;
    var year = (info.release_date || '').slice(0, 4);
    if (!title && !origTitle) return debugStream('TMDB boş, HTTP ' + t.status + (t.err ? ' ' + t.err : ''));

    // Film adresi: /film/ad/ — bazı filmlerde sonunda -izle var
    STEP = 'sayfa';
    var tr = slugify(title), en = slugify(origTitle);
    var slugs = [];
    function add(s) { if (s && slugs.indexOf(s) === -1) slugs.push(s); }
    add(tr); add(tr + '-izle'); add(en); add(en + '-izle');
    if (tr && en && tr !== en) { add(tr + '-' + en + '-izle'); add(tr + '-' + en); }
    if (en && year) { add(en + '-izle-' + year); add(en + '-' + year); }
    if (tr && year) { add(tr + '-' + year); add(tr + '-izle-' + year); }
    slugs = slugs.slice(0, 9);

    var pages = await Promise.all(slugs.map(function (s) {
      return req(PRIMARY_DOMAIN + '/film/' + s + '/', { headers: PAGE_HEADERS });
    }));

    var html = '', pageSlug = '', seenTitle = '';
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].status !== 200 || !pages[i].text) continue;
      if (!seenTitle) seenTitle = pageTitle(pages[i].text);
      if (isRightMovie(pages[i].text, title, origTitle, year)) {
        html = pages[i].text; pageSlug = slugs[i]; break;
      }
    }
    if (!html) {
      var codes = pages.slice(0, 3).map(function (p) { return p.status; }).join('/');
      return debugStream('film sayfası yok (' + slugs[0] + ' ' + codes + ')' +
                         (seenTitle ? ', başlık tutmadı: ' + seenTitle : ''));
    }

    // m3u bağlantıları
    STEP = 'm3u';
    var links = extractM3u(html);
    if (!links.length) return discoverStreams(html, pageSlug);

    var streams = [];
    links.forEach(function (u, k) {
      streams = streams.concat(makeVariants(u, links.length > 1 ? ' ' + (k + 1) : ''));
    });

    if (DEBUG) {
      STEP = 'probe';
      var info2 = await Promise.race([
        probe(links[0]),
        new Promise(function (res) { setTimeout(function () { res('probe süresi doldu'); }, 4000); })
      ]);
      streams.push({
        name: 'Filmmodu ⚠ ' + info2,
        title: '⚠ ' + info2,
        url: links[0],
        quality: 'Auto',
        type: 'hls',
        headers: { 'User-Agent': ANDROID_UA, 'Referer': PRIMARY_DOMAIN + '/' }
      });
    }
    return streams;
  } catch (err) {
    return debugStream('hata: ' + err);
  }
}

// Toplam süre sınırı: takılırsa hangi adımda kaldığını yazar
async function getStreams(tmdbId, mediaType, season, episode) {
  var timer;
  var timeout = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve(debugStream('zaman aşımı, adım: ' + STEP)); }, 12000);
  });
  var out = await Promise.race([run(tmdbId, mediaType), timeout]);
  clearTimeout(timer);
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
