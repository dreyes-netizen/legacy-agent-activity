"""Apply db/migrations/*.sql to the Neon database in DATABASE_URL."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sync import ctm, db  # noqa: E402

MIGRATIONS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "db", "migrations"
)


def main():
    ctm.load_dotenv(".env.local")
    ctm.load_dotenv(".env")
    conn = db.connect()
    try:
        applied = db.apply_migrations(conn, MIGRATIONS_DIR)
        for name in applied:
            print(f"applied {name}")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' ORDER BY table_name"
            )
            tables = [row["table_name"] for row in cur.fetchall()]
        print("tables: " + ", ".join(tables))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
