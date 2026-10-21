"""
Real reference photos for the seed sketches (testing plan, October 2026).

Downloads openly licensed photos from Wikimedia Commons, one place and
time of day per seed sketch, so the seed data looks like real sketching
trips and the AI calls have real scenes to read. seed_test_data.py uses
them when they are there and falls back to its drawn scenes when not.

Run from backend/ with the venv on, before seed_test_data.py:

  python tools/fetch_reference_photos.py              fetch every sketch's photo
  python tools/fetch_reference_photos.py --only gion  fetch the keys that contain "gion"
  python tools/fetch_reference_photos.py --use david_gion=2   use candidate 2 instead

What it writes, all in backend/debug_out/ (git-ignored):

  ref_<key>.jpg             the photo the seed uses (longest side 1600 px)
  ref_<key>_<n>.jpg         every candidate that passed the licence check
  reference_photos.json     title, author, licence, source page, date taken
  reference_photos.html     a contact sheet to check the picks by eye

Only CC0, public domain, CC BY and CC BY-SA photos are kept (no NC or ND).
CC BY and CC BY-SA need credit, so the seed puts each photo's credit in
its sketch's field notes, and the credits file lists them all.
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[1]
OUT = BACKEND / "debug_out"
API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "SketchConnectTestSeed/1.0 (Harvard precapstone test data; python-httpx)"}
WIDTH = 1600            # matches MAX_IMAGE_DIMENSION in config.py
CANDIDATES = 3          # kept per sketch
OK_LICENSE = re.compile(r"^(cc0|public domain|pd\b|cc by(-sa)? [\d.]+)", re.I)
NOT_A_PHOTO = re.compile(r"painting|drawing|\bmap\b|\.svg$|\.png$|art project|\bMET\b|\bmodel\b|illustration|logo", re.I)

# One entry per seed sketch (seed_test_data.py keys). `files` are Commons
# titles picked to match the place and the time of day in the sketch's
# notes, best first. `search` is the fallback when none of them pass.
MANIFEST = {
    "marcus_chinatown": {"when": "late afternoon", "files": [
        "Singapore (SG), China Town, Pagoda Street -- 2019 -- 4504.jpg",
        "Singapore (SG), China Town, Pagoda Street -- 2019 -- 4505.jpg",
        "Pagoda Street Chinatown Singapore.jpg"], "search": "Pagoda Street Chinatown Singapore shophouses"},
    "marcus_marina": {"when": "day, windy", "files": [
        "Marina Bay Sands and Helix Bridge.jpg",
        "ArtScience Museum, overlooking Marina Bay Hotels, Singapore Flyer and the Helix Bridge.jpg"],
        "search": "Marina Bay Singapore skyline water day"},
    "marcus_hawker": {"when": "lunchtime", "files": [
        "Lau Pa Sat 03.jpg", "Lau Pa Sat - Seng Kee Local Delights 20170306.jpg"],
        "search": "Lau Pa Sat hawker centre"},
    "david_kenreimon": {"when": "morning", "files": [
        "Kyoto-gosho Kenreimon (closed).JPG", "Kyoto-gosho Kenreimon (open).JPG",
        "Kenreimon - Jomeimon Gate, Kyoto Imperial Palace (165453641).jpg"], "search": "Kenreimon Kyoto Imperial Palace"},
    "david_gion": {"when": "evening", "files": [
        "Gion in evening.jpg", "Gion at night (31051047850).jpg", "Kyoto Gion At Night (135528933).jpeg"],
        "search": "Gion Kyoto evening lanterns street"},
    "david_path": {"when": "autumn", "files": [
        "Philosophers Walk, Kyoto (49073314072).jpg", "Tetsugaku-no-michi - Philosopher's Walk - Kyoto.jpg",
        "Path of philosophy.jpg"], "search": "Philosopher's Path Kyoto autumn leaves"},
    "priya_palace_wall": {"when": "day", "files": [
        "Imperial Palace in Kyoto - wall of emperor library.JPG", "Kyoto, Imperial Palace (5759540142).jpg"],
        "search": "Kyoto Imperial Palace wall"},
    "priya_watarun": {"when": "dusk", "files": [
        "Wat Arun from Chao Phraya River at sunset.jpg", "Wat Arun and Sunset.jpg",
        "Wat arun at night in Bangkok, Thailand.jpg"], "search": "Wat Arun sunset river"},
    "priya_chatuchak": {"when": "weekend, midday", "files": [
        "Chatuchak Weekend Market Soi.jpg", "Chatuchak Weekend Market 2.jpg", "Chatuchak Weekend Market P1100759.JPG"],
        "search": "Chatuchak weekend market people"},
    "dana_pastries": {"when": "indoors, from a photo", "files": [
        "Freshly baked croissants.jpg", "Croissants au beurre (18953292873).jpg"], "search": "pastries on a plate"},
    "dana_teapot": {"when": "indoors, from a photo", "files": [],
                    "search": "teapot on table photograph"},
    "lena_tram": {"when": "day", "files": [
        "Tram 28 in Rua da Conceicao (Lissabon 2016) (26029563901).jpg",
        "Lissabon-Strassenbahn-22-Linie 28-Rua da Conceicao-2011-gje.jpg"], "search": "Lisbon tram 28 Baixa"},
    "lena_alfama": {"when": "day", "files": [
        "Miradouro Portas do Sol I.jpg", "Lisboa, Miradouro das Portas do Sol, vista.jpg", "Alfama-CCBY.jpg"],
        "search": "Alfama rooftops Lisbon"},
    "lena_belem": {"when": "day", "files": [
        "Torre de Belém - Lisboa Portugal.jpg", "Belem Tower, Lisbon (8038548360).jpg"], "search": "Torre de Belem"},
    "lena_kyoto": {"when": "day", "files": [
        "Kyoto Imperial Palace, South view 20130811.jpg",
        "Kyoto Imperial Palace (京都御所, Kyōto Gosho) dak.jpg"], "search": "Kyoto Imperial Palace south wall"},
    "lena_porto": {"when": "day", "files": [
        "Porto Ribeira.jpg", "Cais da Ribeira in Porto (1).jpg", "POR Porto Cais Ribeira 05.jpg"],
        "search": "Ribeira Porto riverfront"},
    "lena_sintra": {"when": "day", "files": [
        "Pena Palace atop a hill in the Sintra Mountains.jpg", "Pena Palace in the Clouds.jpg"],
        "search": "Pena Palace Sintra hill"},
    "lena_draft": {"when": "lunchtime", "files": [
        "Mercado da Ribeira, Time Out Market, Lisbon - 49677105008.jpg", "TimeOut Market in Lisbon.jpg"],
        "search": "Time Out Market Lisbon crowd"},
}


def _plain(value: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value or ""))).strip()


def _info(client, titles: list[str]) -> list[dict]:
    """Licence, author, date and a 1600 px link for each Commons file, in the order asked."""
    if not titles:
        return []
    r = client.get(API, params={
        "action": "query", "format": "json", "formatversion": 2, "prop": "imageinfo",
        "titles": "|".join(t if t.startswith("File:") else f"File:{t}" for t in titles),
        "iiprop": "url|size|mime|extmetadata", "iiurlwidth": WIDTH,
        "iiextmetadatafilter": "LicenseShortName|Artist|Credit|DateTimeOriginal|GPSLatitude|GPSLongitude|UsageTerms",
    })
    r.raise_for_status()
    pages = {p["title"]: p for p in r.json()["query"]["pages"]}
    out = []
    for t in titles:
        p = pages.get(t if t.startswith("File:") else f"File:{t}")
        if not p or "imageinfo" not in p:
            print(f"    missing on Commons: {t}")
            continue
        ii = p["imageinfo"][0]
        meta = {k: v.get("value") for k, v in (ii.get("extmetadata") or {}).items()}
        out.append({
            "title": p["title"],
            "page": ii.get("descriptionurl"),
            "url": ii.get("thumburl") or ii.get("url"),
            "mime": ii.get("mime"),
            "width": ii.get("width"), "height": ii.get("height"),
            "license": _plain(meta.get("LicenseShortName")),
            "author": _plain(meta.get("Artist")) or _plain(meta.get("Credit")) or "Unknown",
            "taken": _plain(meta.get("DateTimeOriginal")) or None,
            "gps": [meta.get("GPSLatitude"), meta.get("GPSLongitude")] if meta.get("GPSLatitude") else None,
        })
    return out


def _search(client, query: str) -> list[str]:
    r = client.get(API, params={"action": "query", "format": "json", "formatversion": 2, "list": "search",
                                "srsearch": f"{query} filetype:bitmap", "srnamespace": 6, "srlimit": 15})
    r.raise_for_status()
    return [s["title"] for s in r.json()["query"]["search"]]


def _usable(c: dict) -> str | None:
    """Why a candidate can't be used, or None when it can."""
    if c["mime"] not in ("image/jpeg", "image/png", "image/webp"):
        return f"not a photo ({c['mime']})"
    if not OK_LICENSE.match(c["license"]) or re.search(r"\bnc\b|\bnd\b", c["license"], re.I):
        return f"licence {c['license'] or 'unknown'}"
    if NOT_A_PHOTO.search(c["title"]):
        return "looks like artwork, a map or a model"
    if min(c["width"] or 0, c["height"] or 0) < 700:
        return "too small"
    return None


def fetch(client, key: str, spec: dict) -> list[dict]:
    print(f"{key}  ({spec['when']})")
    found = []
    for c in _info(client, spec["files"]) + _info(client, _search(client, spec["search"])):
        if len(found) >= CANDIDATES or any(f["title"] == c["title"] for f in found):
            continue
        why = _usable(c)
        if why:
            print(f"    skip {c['title'][5:]}: {why}")
            continue
        n = len(found) + 1
        path = OUT / f"ref_{key}_{n}.jpg"
        img = client.get(c["url"], follow_redirects=True)
        img.raise_for_status()
        path.write_bytes(img.content)
        c["file"] = path.name
        found.append(c)
        print(f"    {n}. {c['title'][5:]}  [{c['license']}, {c['author'][:40]}, taken {c['taken'] or '?'}]")
    if not found:
        print("    nothing usable: the seed keeps its drawn scene for this sketch")
    return found


def choose(credits: dict, key: str, n: int):
    cands = credits.get(key, {}).get("candidates", [])
    if not 1 <= n <= len(cands):
        sys.exit(f"{key} has {len(cands)} candidates; pick 1 to {len(cands)}.")
    credits[key]["chosen"] = n
    (OUT / f"ref_{key}.jpg").write_bytes((OUT / cands[n - 1]["file"]).read_bytes())
    print(f"{key}: now using candidate {n}, {cands[n - 1]['title'][5:]}")


def contact_sheet(credits: dict):
    rows = []
    for key, entry in credits.items():
        cells = []
        for i, c in enumerate(entry["candidates"], 1):
            mark = " (used)" if i == entry["chosen"] else ""
            cells.append(f'<figure><img src="{c["file"]}"><figcaption><b>{i}{mark}</b> '
                         f'<a href="{html.escape(c["page"])}">{html.escape(c["title"][5:])}</a><br>'
                         f'{html.escape(c["author"])}, {html.escape(c["license"])}<br>taken {html.escape(c["taken"] or "?")}'
                         f'</figcaption></figure>')
        rows.append(f"<h2>{key} <small>{html.escape(entry['when'])}</small></h2><div>{''.join(cells) or 'none'}</div>")
    (OUT / "reference_photos.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Reference photos</title><style>body{font:14px system-ui;margin:24px}"
        "div{display:flex;gap:12px;flex-wrap:wrap}figure{width:300px;margin:0}img{width:300px;height:200px;object-fit:cover}"
        "small{color:#777;font-weight:normal}</style><h1>Seed reference photos</h1>" + "".join(rows))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="fetch only the keys that contain this text")
    ap.add_argument("--use", help="key=n: use candidate n for that sketch")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    credits_path = OUT / "reference_photos.json"
    credits = json.loads(credits_path.read_text()) if credits_path.exists() else {}

    if args.use:
        key, _, n = args.use.partition("=")
        choose(credits, key.strip(), int(n))
    else:
        with httpx.Client(headers=HEADERS, timeout=30) as client:
            for key, spec in MANIFEST.items():
                if args.only and args.only not in key:
                    continue
                cands = fetch(client, key, spec)
                credits[key] = {"when": spec["when"], "chosen": 1 if cands else None, "candidates": cands}
                if cands:
                    (OUT / f"ref_{key}.jpg").write_bytes((OUT / cands[0]["file"]).read_bytes())
    credits_path.write_text(json.dumps(credits, indent=2, ensure_ascii=False))
    contact_sheet(credits)
    print(f"\nCheck the picks: open {OUT / 'reference_photos.html'}")


if __name__ == "__main__":
    main()
