from __future__ import annotations

import os
from pathlib import Path

from citydatebot.postgres_store import apply_migration


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "db" / "migrations"


def main() -> int:
    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://citydatebot:citydatebot@localhost:5432/citydatebot",
    )
    for path in sorted(MIGRATIONS.glob("*.sql")):
        print(f"Applying {path.name}...")
        apply_migration(database_url, path.read_text(encoding="utf-8"))
    print("Migrations applied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

