// ============================================================
//  Filmmodu — Nuvio Provider
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
    name: 'Filmmodu ⚠ ' + msg.slice(0, 210),
    title: '⚠ ' + msg,
    url: 'https://example.com/debug.m3u8',
    quality: 'Auto',
    type: 'hls',
    headers: {}
  }];
}

// ---------- Base64 (atob her ortamda olmayabilir) ----------
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeB64(s) {
  s = String(s || '').replace(/[^A-Za-z0-9+\/]/g, '');
  var out = '', bits = 0, acc = 0;
  for (var i = 0; i < s.length; i++) {
    acc = (acc << 6) | B64.indexOf(s.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

function reverseStr(s) {
  var o = '';
  for (var i = s.length - 1; i >= 0; i--) o += s.charAt(i);
  return o;
}

// ---------- Film sayfası ----------
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

// Film sayfasını bulur: önce adres tahmini, olmazsa sitenin kendi araması (POST /arama/)
async function findFilmPage(title, origTitle, year) {
  var tr = slugify(title), en = slugify(origTitle);
  var tried = [], seenTitle = '', codes = [];

  async function tryPaths(slugs) {
    slugs = slugs.filter(function (x, i) { return x && slugs.indexOf(x) === i && tried.indexOf(x) === -1; });
    slugs.forEach(function (x) { tried.push(x); });
    var pages = await Promise.all(slugs.map(function (x) {
      return req(PRIMARY_DOMAIN + '/film/' + x + '/', { headers: PAGE_HEADERS });
    }));
    for (var i = 0; i < pages.length; i++) {
      codes.push(pages[i].status);
      if (pages[i].status !== 200 || !pages[i].text) continue;
      if (!seenTitle) seenTitle = pageTitle(pages[i].text);
      if (isRightMovie(pages[i].text, title, origTitle, year)) return { html: pages[i].text, slug: slugs[i] };
    }
    return null;
  }

  // 1) Adres tahmini: bazı filmlerde sonunda -izle var
  var guesses = [tr, tr + '-izle', en, en + '-izle'];
  if (tr && en && tr !== en) { guesses.push(tr + '-' + en + '-izle'); guesses.push(tr + '-' + en); }
  if (en && year) { guesses.push(en + '-izle-' + year); guesses.push(en + '-' + year); }
  if (tr && year) { guesses.push(tr + '-' + year); guesses.push(tr + '-izle-' + year); }
  var hit = await tryPaths(guesses.slice(0, 9));
  if (hit) return hit;

  // 2) Sitenin araması: POST /arama/  action=ajax_search&arama_kelime=...
  STEP = 'arama';
  var qs = [];
  [title, origTitle].forEach(function (q) { if (q && qs.indexOf(q) === -1) qs.push(q); });
  var sres = await Promise.all(qs.map(function (q) {
    return req(PRIMARY_DOMAIN + '/arama/', {
      method: 'POST',
      headers: {
        'User-Agent': ANDROID_UA,
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': PRIMARY_DOMAIN,
        'Referer': PRIMARY_DOMAIN + '/'
      },
      body: 'action=ajax_search&arama_kelime=' + encodeURIComponent(q)
    });
  }));
  var slugs = [];
  sres.forEach(function (r) {
    var txt = r.text.replace(/\\\//g, '/');
    var re = /\/film\/([a-z0-9\-]+)\/?/g, m;
    while ((m = re.exec(txt)) !== null) { if (slugs.indexOf(m[1]) === -1) slugs.push(m[1]); }
  });
  hit = await tryPaths(slugs.slice(0, 8));
  if (hit) return hit;

  return { html: '', note: 'film sayfası yok (' + tr + ' ' + codes.slice(0, 3).join('/') + '), arama: ' +
    sres.map(function (r) { return r.status + '/' + slugs.length; }).join(' ') +
    (seenTitle ? ', başlık tutmadı: ' + seenTitle : '') };
}

// ---------- Oynatıcı bulma ----------
// Sayfada iki yerde olabilir:
//  1) düz yazı:  <iframe src="https://vidmixi.com/embed/32HANELİKİMLİK">
//  2) pdata['prt_atom0'] = '...base64...'  (sayfa betiği çözüp iframe'e çeviriyor)
function extractEmbeds(html) {
  var text = String(html || '').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  var out = [], seen = {};
  function add(host, id) {
    if (seen[id]) return;
    seen[id] = true;
    out.push({ host: host, id: id });
  }
  var re = /https?:\/\/([a-z0-9.\-]+)\/(?:embed|video)\/([a-f0-9]{32})/gi, m;
  while ((m = re.exec(text)) !== null) add(m[1], m[2]);

  var pre = reverseStr('BSZtFmcmlGP'); // sayfadaki betikteki ön ek: PGlmcmFtZSB ("<iframe ")
  var pr = /pdata\[\s*['"]([^'"]+)['"]\s*\]\s*=\s*['"]([^'"]+)['"]/g, pm;
  while ((pm = pr.exec(text)) !== null) {
    var data = pm[2];
    if (data.substring(0, 30) !== 'PGltZyB3aWR0aD0iMTAwJSIgaGVpZ2') data = pre + data;
    var dec = decodeB64(data);
    var em = dec.match(/https?:\/\/([a-z0-9.\-]+)\/(?:embed|video)\/([a-f0-9]{32})/i);
    if (em) add(em[1], em[2]);
  }
  return out;
}

// Oynatıcının getVideo servisinden taze (süreli) HLS adresini alır
async function resolvePlayer(player, pageUrl) {
  var base = 'https://' + player.host;
  var r = await req(base + '/player/index.php?data=' + player.id + '&do=getVideo', {
    method: 'POST',
    headers: {
      'User-Agent': ANDROID_UA,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': base,
      'Referer': base + '/embed/' + player.id
    },
    body: 'hash=' + player.id + '&r=' + encodeURIComponent(pageUrl)
  });

  var url = '';
  try {
    var j = JSON.parse(r.text);
    url = j.securedLink || j.videoSource || '';
  } catch (e) {}
  if (!url) {
    var clean = r.text.replace(/\\\//g, '/');
    var m = clean.match(/https?:\/\/[^"'\s\\]+?(?:master\.(?:txt|m3u8)|\/m3u\/)[^"'\s\\]*/);
    if (m) url = m[0];
  }
  if (!url) {
    return { error: 'getVideo HTTP ' + r.status + (r.err ? ' ' + r.err : '') + ' ' +
                    r.text.replace(/\s+/g, ' ').slice(0, 90) };
  }
  url = url.replace(/\\\//g, '/');
  if (url.indexOf('http') !== 0) url = base + (url.charAt(0) === '/' ? '' : '/') + url;

  return {
    url: url,
    headers: { 'User-Agent': ANDROID_UA, 'Referer': base + '/', 'Origin': base }
  };
}

// Aynı adresi farklı oynatıcı ayarlarıyla sunar; hangisi çalışırsa o kullanılır
function makeVariants(r, tag) {
  var h = r.headers || {};
  var slim = { 'User-Agent': h['User-Agent'], 'Referer': h['Referer'] };
  var tagged = r.url + (r.url.indexOf('?') > -1 ? '&' : '?') + 'ext=.m3u8';
  function mk(suffix, type, headers, u) {
    return {
      name: 'Filmmodu' + tag + suffix,
      title: '⌜ FILMMODU ⌟ | HLS' + suffix,
      url: u || r.url,
      quality: 'Auto',
      type: type,
      headers: headers
    };
  }
  return [
    mk('', 'hls', h),
    mk(' (.m3u8 ek)', 'hls', slim, tagged),
    mk(' (başlıksız)', 'hls', {}),
    mk(' (m3u8)', 'm3u8', slim)
  ];
}

// Listeyi başlıklı ve başlıksız çekip durum/içerik özeti çıkarır
async function probe(r) {
  var a = await req(r.url, { headers: r.headers });
  var b = await req(r.url, { headers: { 'User-Agent': ANDROID_UA } });
  function d(x) { return x.status + (x.text.indexOf('#EXTM3U') === 0 ? ' ok' : ' ?'); }
  var t = a.text.indexOf('#EXTM3U') === 0 ? a.text : (b.text || '');
  var v = (t.match(/#EXT-X-STREAM-INF/g) || []).length;
  var seg = (t.match(/#EXTINF/g) || []).length;
  var au = /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/.test(t) ? 1 : 0;
  return 'liste h:' + d(a) + ' n:' + d(b) + ' v' + v + ' s' + seg + ' a' + au;
}

// Oynatıcı bulunamazsa: videoyu sayfaya koyan kodun nerede olduğunu kısa satırlarla gösterir
function discoverStreams(html, slug) {
  var t = String(html || '').replace(/\\\//g, '/');
  function count(re) { return (t.match(re) || []).length; }
  var lines = ['sayfa ' + slug + ': oynatıcı yok, ' + t.length + ' bayt, vidmixi:' + count(/vidmixi/gi) +
    ' pdata:' + count(/pdata\[/g) + ' vidon:' + count(/New_videoplayer_vidon/g) +
    ' f_player:' + count(/f_player/g) + ' atob:' + count(/atob\(/g)];
  function ctx(label, re, n, before, after) {
    var m, k = 0;
    while ((m = re.exec(t)) !== null && k < n) {
      k++;
      lines.push(label + k + ': ' + t.slice(Math.max(0, m.index - before), m.index + after).replace(/\s+/g, ' '));
    }
  }
  ctx('pd', /pdata\[/g, 2, 20, 170);
  ctx('fp', /f_player/g, 2, 60, 140);
  ctx('src', /\.src\s*=/g, 2, 70, 130);
  return lines.slice(0, 9).map(function (l) { return debugStream(l)[0]; });
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

    STEP = 'sayfa';
    var found = await findFilmPage(title, origTitle, year);
    if (!found.html) return debugStream(found.note);
    var html = found.html, pageSlug = found.slug;
    var pageUrl = PRIMARY_DOMAIN + '/film/' + pageSlug + '/';

    STEP = 'oynatici';
    var players = extractEmbeds(html);
    if (!players.length) return discoverStreams(html, pageSlug);

    STEP = 'getVideo';
    var resolved = await Promise.all(players.map(function (p) { return resolvePlayer(p, pageUrl); }));
    var streams = [], errors = [], first = null;
    for (var k = 0; k < players.length; k++) {
      var r = resolved[k];
      if (!r || r.error) { errors.push(r ? r.error : 'boş'); continue; }
      if (!first) first = r;
      streams = streams.concat(makeVariants(r, players.length > 1 ? ' ' + (k + 1) : ''));
    }
    if (!streams.length) return debugStream(errors.join(' | '));

    if (DEBUG && first) {
      STEP = 'probe';
      var info2 = await Promise.race([
        probe(first),
        new Promise(function (res) { setTimeout(function () { res('probe süresi doldu'); }, 4000); })
      ]);
      streams.push({
        name: 'Filmmodu ⚠ ' + info2,
        title: '⚠ ' + info2,
        url: first.url,
        quality: 'Auto',
        type: 'hls',
        headers: first.headers
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
