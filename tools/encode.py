"""Helper for tools/build.mjs: re-encode pictures as WebP and return them as data URIs.

Reads a JSON list of [path, quality] on stdin, writes {path: dataURI} on stdout. Results are cached
in .cache/build keyed by file size and modification time, so a rebuild only re-encodes what changed.
WebP predicts each block of pixels from its neighbours and stores only the (lossily rounded)
difference, which is why it is several times smaller than PNG for these paintings.
"""
import base64, hashlib, io, json, os, sys
from PIL import Image

CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache', 'build')
os.makedirs(CACHE, exist_ok=True)
out = {}
for path, q in json.load(sys.stdin):
    st = os.stat(path)
    key = hashlib.sha1(f'{path}|{st.st_size}|{st.st_mtime_ns}|{q}'.encode()).hexdigest()
    cached = os.path.join(CACHE, key)
    if os.path.exists(cached):
        out[path] = open(cached).read(); continue
    buf = io.BytesIO(); Image.open(path).save(buf, 'WEBP', quality=q, method=4)
    uri = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
    open(cached, 'w').write(uri); out[path] = uri
json.dump(out, sys.stdout)
