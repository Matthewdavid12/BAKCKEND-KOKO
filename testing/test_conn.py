import json
import psycopg2

with open("config.json", "r", encoding="utf-8") as f:
    cfg = json.load(f)

conn = psycopg2.connect(
    host=cfg["PG_HOST"],
    port=cfg.get("PG_PORT", 5432),
    dbname=cfg["PG_DBNAME"],
    user=cfg["PG_USER"],
    password=cfg["PG_PASSWORD"],
    sslmode="require"
)

print("CONNECTED OK")
conn.close()