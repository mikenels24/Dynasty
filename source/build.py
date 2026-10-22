"""Build Dynasty.
dist/site/      -> the real installable app (index.html + manifest + service worker + icons) for static hosting
dist/preview/   -> single-file page for the Claude artifact preview
"""
import json, os, shutil
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
SITE = os.path.join(ROOT, 'dist', 'site')
PREV = os.path.join(ROOT, 'dist', 'preview')
VERSION = '0.2.1'

for d in (SITE, PREV):
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)

engine = open(os.path.join(SRC, 'engine.js')).read()
body = open(os.path.join(SRC, 'app.html')).read().replace('/*__ENGINE__*/', engine)

open(os.path.join(PREV, 'dynasty.html'), 'w').write(body)

site_html = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
             '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
             '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
             'body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>'
             '</head><body>' + body + '</body></html>')
open(os.path.join(SITE, 'index.html'), 'w').write(site_html)

manifest = {
    'name': 'Dynasty', 'short_name': 'Dynasty', 'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#0A0F1C', 'theme_color': '#0A0F1C', 'orientation': 'portrait',
    'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
              {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any maskable'}]
}
json.dump(manifest, open(os.path.join(SITE, 'manifest.webmanifest'), 'w'), indent=1)

sw = """const CACHE = 'dynasty-%s';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // App files: network first so updates arrive, cache when offline.
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
  } else if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) {
    // Fonts: cache first.
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
""" % VERSION
open(os.path.join(SITE, 'sw.js'), 'w').write(sw)

def icon(size, path):
    img = Image.new('RGB', (size, size), (10, 15, 28))
    d = ImageDraw.Draw(img)
    pad = int(size * 0.16)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=int(size * 0.14), fill=(242, 179, 61))
    font = None
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(f):
            font = ImageFont.truetype(f, int(size * 0.46)); break
    if font is None:
        font = ImageFont.load_default()
    t = 'D'
    bb = d.textbbox((0, 0), t, font=font)
    d.text(((size - (bb[2] - bb[0])) / 2 - bb[0], (size - (bb[3] - bb[1])) / 2 - bb[1]), t, font=font, fill=(26, 18, 4))
    img.save(path)

for s in (180, 192, 512):
    icon(s, os.path.join(SITE, 'icon-%d.png' % s))
print('built', VERSION, os.listdir(SITE))
