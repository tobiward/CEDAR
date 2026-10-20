#!/usr/bin/env python3
"""Download CEDAR's third-party libraries into lib/ so the app never loads code from a CDN.

Run once from the CEDAR folder, then commit lib/:
    python tools/fetch_libs.py

Each package comes from the official npm registry and is checked against the checksum the
registry publishes for it before anything is unpacked. Uses only the Python standard library.
"""
import base64
import hashlib
import io
import json
import pathlib
import sys
import tarfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIB = ROOT / "lib"
REGISTRY = "https://registry.npmjs.org"

# package, version ("latest" resolves to the newest release), [(file inside the package, destination in lib/)]
PACKAGES = [
    ("pdfjs-dist", "4.10.38", [
        ("build/pdf.min.mjs", "pdfjs/pdf.min.mjs"),
        ("build/pdf.worker.min.mjs", "pdfjs/pdf.worker.min.mjs"),
        ("LICENSE", "pdfjs/LICENSE"),
    ]),
    ("tesseract.js", "5.1.1", [
        ("dist/tesseract.min.js", "tesseract/tesseract.min.js"),
        ("dist/worker.min.js", "tesseract/worker.min.js"),
        ("LICENSE.md", "tesseract/LICENSE.md"),
    ]),
    # The LSTM builds are the ones CEDAR uses; Tesseract picks the fastest one the device supports.
    ("tesseract.js-core", "5.1.1", [
        ("*-lstm.wasm.js", "tesseract/core/"),
        ("LICENSE", "tesseract/core/LICENSE"),
    ]),
    ("@tesseract.js-data/eng", "1.0.0", [
        ("4.0.0_best_int/eng.traineddata.gz", "tesseract/lang/eng.traineddata.gz"),
    ]),
    ("@fontsource/zilla-slab", "latest", [
        ("files/zilla-slab-latin-500-normal.woff2", "fonts/"),
        ("files/zilla-slab-latin-600-normal.woff2", "fonts/"),
        ("files/zilla-slab-latin-700-normal.woff2", "fonts/"),
        ("LICENSE", "fonts/LICENSE-zilla-slab"),
    ]),
    ("@fontsource/figtree", "latest", [
        ("files/figtree-latin-400-normal.woff2", "fonts/"),
        ("files/figtree-latin-500-normal.woff2", "fonts/"),
        ("files/figtree-latin-600-normal.woff2", "fonts/"),
        ("files/figtree-latin-700-normal.woff2", "fonts/"),
        ("LICENSE", "fonts/LICENSE-figtree"),
    ]),
]

FONTS_CSS = """/* Self-hosted fonts (from @fontsource; SIL Open Font License). */
{faces}
"""


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "cedar-fetch-libs"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def fetch_package(name, version):
    meta = json.loads(get(f"{REGISTRY}/{name.replace('/', '%2F')}/{version}"))
    tarball = get(meta["dist"]["tarball"])
    integrity = meta["dist"].get("integrity", "")
    if integrity.startswith("sha512-"):
        want = base64.b64decode(integrity[7:])
        if hashlib.sha512(tarball).digest() != want:
            sys.exit(f"Checksum mismatch for {name}@{meta['version']}. Nothing was written.")
    elif meta["dist"].get("shasum"):
        if hashlib.sha1(tarball).hexdigest() != meta["dist"]["shasum"]:
            sys.exit(f"Checksum mismatch for {name}@{meta['version']}. Nothing was written.")
    else:
        sys.exit(f"The registry gave no checksum for {name}; refusing to use it.")
    return meta["version"], tarfile.open(fileobj=io.BytesIO(tarball), mode="r:gz")


def main():
    manifest = {}
    staged = {}
    for name, version, files in PACKAGES:
        print(f"Downloading {name}@{version} …")
        real_version, tar = fetch_package(name, version)
        members = {m.name.split("/", 1)[1]: m for m in tar.getmembers() if m.isfile() and "/" in m.name}
        for src, dest in files:
            if src.startswith("*"):
                matches = [p for p in members if p.endswith(src[1:]) and "/" not in p]
            else:
                matches = [src] if src in members else []
            if not matches:
                sys.exit(f"{src} wasn't found in {name}@{real_version}. Nothing was written.")
            for path in matches:
                target = dest + pathlib.PurePosixPath(path).name if dest.endswith("/") else dest
                staged[target] = tar.extractfile(members[path]).read()
                manifest[target] = {"package": f"{name}@{real_version}"}

    faces = []
    for target in sorted(t for t in staged if t.endswith(".woff2")):
        fname = pathlib.PurePosixPath(target).name
        family = "Zilla Slab" if fname.startswith("zilla-slab") else "Figtree"
        weight = fname.split("-")[-2]
        faces.append(f"@font-face {{ font-family: \"{family}\"; font-style: normal; font-weight: {weight}; font-display: swap; src: url(\"{fname}\") format(\"woff2\"); }}")
    staged["fonts/fonts.css"] = FONTS_CSS.format(faces="\n".join(faces)).encode()

    for target, data in staged.items():
        out = LIB / target
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        if target in manifest:
            manifest[target]["sha384"] = base64.b64encode(hashlib.sha384(data).digest()).decode()
    (LIB / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Done. {len(staged)} files written to {LIB}. Commit the lib folder with the rest of CEDAR.")


if __name__ == "__main__":
    main()
