"""Copy the images in backend/uploads to the Supabase Storage bucket.

Run once, before the backend starts using the bucket (core/storage.py).
Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and STORAGE_BUCKET from
backend/.env. Files already in the bucket are skipped, so it is safe to
run again. The display and teaser copies are skipped too: the backend
makes them again on first view.

  python tools/upload_to_supabase.py            copy everything
  python tools/upload_to_supabase.py --dry-run  list what would be copied
"""
import argparse
import mimetypes
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import storage  # noqa: E402
from app.core.paths import UPLOAD_DIR  # noqa: E402

COPIES = (".display.jpg", ".teaser.jpg")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not storage.REMOTE:
        sys.exit("STORAGE_BUCKET is not set in backend/.env.")

    files = sorted(p for p in UPLOAD_DIR.iterdir()
                   if p.is_file() and not p.name.startswith(".") and not p.name.endswith(COPIES)
                   and not p.name.endswith(".part"))
    stored = set(storage.list_names(""))
    todo = [p for p in files if p.name not in stored]
    size = sum(p.stat().st_size for p in todo) / 1e6
    print(f"{len(files)} images in uploads/, {len(files) - len(todo)} already in the bucket, "
          f"{len(todo)} to copy ({size:.1f} MB).")
    if args.dry_run or not todo:
        return

    def put(p: Path) -> str | None:
        try:
            storage.save_bytes(p.name, p.read_bytes(), mimetypes.guess_type(p.name)[0] or "image/jpeg")
            return None
        except Exception as exc:  # report and keep going
            return f"{p.name}: {exc}"

    with ThreadPoolExecutor(max_workers=8) as pool:
        errors = [e for e in pool.map(put, todo) if e]
    print(f"Copied {len(todo) - len(errors)}.")
    for e in errors:
        print("  failed:", e)


if __name__ == "__main__":
    main()
