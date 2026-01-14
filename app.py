from flask import Flask, render_template, request, jsonify, Response
from openai import OpenAI

import os
import time
import json
import re
from datetime import date, datetime
from typing import List, Dict
from decimal import Decimal
from uuid import UUID
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen
import psycopg2
from psycopg2.extras import RealDictCursor
from werkzeug.utils import secure_filename
from PyPDF2 import PdfReader
from flask_cors import CORS


# -----------------------------
# Config
# -----------------------------
with open("config.json", "r", encoding="utf-8") as f:
    cfg = json.load(f)

    import re

MONTHS = {
    "january":"01","february":"02","march":"03","april":"04","may":"05","june":"06",
    "july":"07","august":"08","september":"09","october":"10","november":"11","december":"12"
}

def month_start_from_text(text: str):
    t = (text or "").lower()

    # “december 2024”
    for name, mm in MONTHS.items():
        m = re.search(rf"\b{name}\s+(20\d{{2}})\b", t)
        if m:
            yyyy = m.group(1)
            return f"{yyyy}-{mm}-01"

    # “2024-12” or “2024/12”
    m = re.search(r"\b(20\d{2})[-/](\d{1,2})\b", t)
    if m:
        yyyy = m.group(1)
        mm = f"{int(m.group(2)):02d}"
        return f"{yyyy}-{mm}-01"

    return None


def _insert_filter_before_tail(sql: str, clause: str) -> str:
    """
    Insert clause before ORDER BY / GROUP BY / LIMIT / OFFSET (if present),
    otherwise append at end.
    """
    m = re.search(r"(?is)\b(group\s+by|order\s+by|limit|offset)\b", sql)
    if m:
        idx = m.start()
        return sql[:idx].rstrip() + " " + clause + " " + sql[idx:].lstrip()
    return sql.rstrip() + " " + clause


def rewrite_sql(user_text: str, sql: str) -> str:
    """
    Python-side rewrite so the model can be sloppy and your DB still returns correct rows.

    Fixes:
    - branch = 'X' becomes case/space-insensitive: UPPER(TRIM(branch)) = UPPER(TRIM('X'))
    - branch ILIKE 'x' becomes TRIM(branch) ILIKE 'x'
    - month = 'YYYY-MM-DD' becomes month-start using date_trunc
    - if user asked a month and query is FROM branchclients but SQL forgot month filter -> we add month = DATE 'YYYY-MM-01'
    """
    q = (sql or "").strip()
    if not q.lower().startswith("select"):
        return q

    # Match branch column with optional alias + optional quotes
    # examples: branch = 'Aurora', branchclients.branch='AURORA', "branch" = 'Diversey'
    q = re.sub(
        r"""(?is)\b((?:\w+\.)?"?branch"?)\s*=\s*'([^']*)'""",
        r"UPPER(TRIM(\1)) = UPPER(TRIM('\2'))",
        q
    )

    # Make ILIKE forgiving too (trim)
    q = re.sub(
        r"""(?is)\b((?:\w+\.)?"?branch"?)\s+ilike\s+'([^']*)'""",
        r"TRIM(\1) ILIKE '\2'",
        q
    )

    # If SQL compares month to a specific date string, normalize it to month-start:
    # month = '2024-12-31' -> month = date_trunc('month', DATE '2024-12-31')::date
    q = re.sub(
        r"""(?is)\b((?:\w+\.)?"?month"?)\s*=\s*(?:date\s*)?'(\d{4}-\d{2}-\d{2})'""",
        r"\1 = date_trunc('month', DATE '\2')::date",
        q
    )

    # If user asked for a month and query targets branchclients but forgot month filter, add it.
    requested_month = month_start_from_text(user_text)

    targets_branchclients = bool(re.search(r"(?is)\bfrom\s+branchclients\b", q))
    mentions_month = bool(re.search(r"(?is)\bmonth\b", q))
    has_where = bool(re.search(r"(?is)\bwhere\b", q))

    if requested_month and targets_branchclients and not mentions_month:
        if has_where:
            q = _insert_filter_before_tail(q, f"AND month = DATE '{requested_month}'")
        else:
            q = _insert_filter_before_tail(q, f"WHERE month = DATE '{requested_month}'")

    return q

SHOW_SQL_PROOF = False
STREAM_INITIAL_DELAY_SECONDS = 0.4
STREAM_CHUNK_SIZE = 40
STREAM_CHUNK_DELAY_SECONDS = 0.06
MAX_DOC_CHARS = 12000
MAX_SHEET_CHARS = 12000
ALLOWED_DOC_EXTENSIONS = {".txt", ".md", ".csv", ".pdf"}
MEMORY_STORE_PATH = "koko_memories.json"


DB_CONFIG = {
    "host": cfg["PG_HOST"],
    "port": int(cfg.get("PG_PORT", 5432)),
    "dbname": cfg["PG_DBNAME"],
    "user": cfg["PG_USER"],
    "password": cfg["PG_PASSWORD"],
    "sslmode": "require",
}



# -----------------------------
# JSON-safe serialization (THE FIX)
# -----------------------------
def json_safe(x):
    """Convert DB-returned objects into JSON-serializable types."""
    if x is None:
        return None

    # dates / timestamps
    if isinstance(x, (date, datetime)):
        return x.isoformat()

    # decimals (money, numeric)
    if isinstance(x, Decimal):
        return float(x)

    # uuids
    if isinstance(x, UUID):
        return str(x)

    # bytes / memoryview
    if isinstance(x, (bytes, bytearray, memoryview)):
        return x.decode("utf-8", errors="replace")


    # dict
    if isinstance(x, dict):
        return {k: json_safe(v) for k, v in x.items()}

    # list/tuple
    if isinstance(x, (list, tuple)):
        return [json_safe(v) for v in x]

    return x

def _is_allowed_doc(filename: str) -> bool:
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_DOC_EXTENSIONS


def _extract_text_from_upload(file_storage) -> str:
    filename = file_storage.filename or ""
    _, ext = os.path.splitext(filename.lower())

    if ext in {".txt", ".md", ".csv"}:
        return file_storage.read().decode("utf-8", errors="replace")
    
    if ext == ".pdf":
        reader = PdfReader(file_storage.stream)
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        return "\n".join(pages)

    raise ValueError("Unsupported file type.")

def _load_memories() -> List[Dict[str, str]]:
    if not os.path.exists(MEMORY_STORE_PATH):
        return []
    try:
        with open(MEMORY_STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return [m for m in data if isinstance(m, dict) and "text" in m]
    except (json.JSONDecodeError, OSError):
        return []
    return []


def _save_memory(text: str) -> Dict[str, str]:
    memories = _load_memories()
    entry = {
        "text": text.strip(),
        "created_at": datetime.utcnow().isoformat() + "Z"
    }
    memories.append(entry)
    with open(MEMORY_STORE_PATH, "w", encoding="utf-8") as f:
        json.dump(memories, f, ensure_ascii=False, indent=2)
    return entry


def _format_memory_context(memories: List[Dict[str, str]]) -> str:
    if not memories:
        return ""
    lines = [f"- {m.get('text', '').strip()}" for m in memories if m.get("text")]
    if not lines:
        return ""
    return "Koko memory notes (user-provided, long-term):\n" + "\n".join(lines)


def _extract_memory_command(message: str) -> str:
    if not message:
        return ""
    match = re.match(r"^\s*remember\s*[:\-]?\s*(.+)$", message, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return ""



def _normalize_sheet_export_url(sheet_url: str) -> str:
    parsed = urlparse(sheet_url)
    if "docs.google.com" not in parsed.netloc:
        raise ValueError("Only Google Sheets URLs are supported.")

    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", parsed.path)
    if not match:
        raise ValueError("Invalid Google Sheets URL.")

    sheet_id = match.group(1)
    query = parse_qs(parsed.query)
    gid = query.get("gid", [None])[0]

    export_url = f"https://docs.google.com/spreadsheets/d/136xEmaUtoN72r5pxo4gAE3neB-1l4kMs9EK9H1eQO90/edit?gid=0#gid=0"
    if gid:
        export_url += f"&gid={gid}"
    return export_url


def fetch_sheet_csv(sheet_url: str) -> str:
    export_url = _normalize_sheet_export_url(sheet_url)
    with urlopen(export_url, timeout=15) as response:
        data = response.read()
    return data.decode("utf-8", errors="replace")




# -----------------------------
# DB helper
# -----------------------------
def run_sql(query, params=None):
    conn = psycopg2.connect(**DB_CONFIG)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, tuple(params) if params else None)
            if cur.description:
                rows = cur.fetchall()
                # Convert psycopg2 RealDictRows -> dict, then json-safe
                return json_safe([dict(r) for r in rows])
            return []
    finally:
        conn.close()


# -----------------------------
# Schema helper
# -----------------------------
_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

def is_safe_identifier(s: str) -> bool:
    return bool(s) and bool(_IDENTIFIER_RE.match(s))


def get_schema(mode, table=None, column=None, limit=50):
    if mode == "tables":
        return run_sql("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema='public'
            ORDER BY table_name;
        """)

    if mode == "columns":
        if table:
            return run_sql("""
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema='public'
                AND table_name = %s
                ORDER BY ordinal_position;
            """, [table])
        else:
            return run_sql("""
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema='public'
                ORDER BY table_name, ordinal_position;
            """)


    if mode == "distinct" and table and column:
        # Keep your original behavior BUT validate identifiers
        if not is_safe_identifier(table) or not is_safe_identifier(column):
            return [{"error": "Unsafe table/column name."}]

        q = f'SELECT DISTINCT "{column}" AS value FROM "{table}" WHERE "{column}" IS NOT NULL LIMIT {int(limit)};'
        return run_sql(q)

    return [{"error": "Invalid schema request."}]


# -----------------------------
# OpenAI Tools
# -----------------------------
SQL_TOOL = {
    "type": "function",
    "name": "query_sql",
    "description": "Run a READ-ONLY SQL query (SELECT) on the Postgres database and return rows as JSON.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "A SQL SELECT statement. Avoid placeholders like %s or $1."}
        },
        "required": ["query"]
    }
}

SCHEMA_TOOL = {
    "type": "function",
    "name": "get_schema",
    "description": "Get database schema: tables and columns in public schema (and optionally sample distinct values for a column).",
    "parameters": {
        "type": "object",
        "properties": {
            "mode": {"type": "string", "enum": ["tables", "columns", "distinct"]},
            "table": {"type": "string"},
            "column": {"type": "string"},
            "limit": {"type": "integer", "default": 50}
        },
        "required": ["mode"]
    }
}


# -----------------------------
# App
# -----------------------------
app = Flask(__name__)
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "https://bakckend-koko-frontend.onrender.com"
]

CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}}, supports_credentials=True)
client = OpenAI()

SYSTEM_PROMPT = """
Your name is Koko.
You are a Koala that work for Healthcare plus  
You are a koala assistant for Healthcare Plus.
You are helpful, intelligent, and concise.
Keep answers practical, clear, and easy to scan.
If a question needs up-to-date info (news, weather, prices, current events),
use web_search and include sources/citations.

Style:
- Sound natural, friendly, and conversational (like ChatGPT), not robotic.
- Don’t dump huge answers. Start with the most helpful 3–6 lines.
- Use short paragraphs and bullets when useful.
- Add a little creativity and warmth (light personality, varied phrasing, smooth transitions).
- Avoid abrupt, throwaway responses; make replies feel complete and thoughtful.
- Ask ONE quick follow-up question only if needed to answer correctly.
- Avoid long self-intros or capability lists unless the user asks.
- If the user says “go do research” or asks for current info, use web_search and cite sources.
- If the user is frustrated, stay calm and helpful.
- Pause briefly to think before answering; reply at a calm, human pace.

Behavior:
- Prefer actionable steps over long explanations.
- For coding help: show the exact snippet and where to paste it.
- For debugging: explain the likely cause, then give a fix.
- Talk like a friendly, thoughtful teammate.
- You do NOT know company data by memory.
- If the user asks about branches, clients, caregivers, stats, counts, or anything company-related,
  you MUST call query_sql before answering.
- Never claim access unless you actually queried the database.
- Never answer company data questions without SQL results.
- If you don’t know table or column names, query information_schema first.
- If SQL returns zero rows, say so clearly.
- Always rely on SQL results for company data.

DATABASE-ONLY RULES (CRITICAL):
- You ONLY answer using SQL results from this Postgres database.
- NEVER answer company questions from memory or assumptions.

SCHEMA RULES (CRITICAL):
- NEVER assume table names or column names.
- Before writing any SELECT that filters on a column (WHERE ...), you MUST first get the columns for the target table:
  call get_schema(mode="columns") and find the exact column names.
- If you’re unsure which table contains the data (e.g., "active clients", "terminated", "zip codes", "reason"),
  first call get_schema(mode="tables"), then get_schema(mode="columns") for the best candidate table(s).
- Do NOT invent columns like status.

BRANCHES:
- There is NO table called branches.
- Branch names are stored as values in branchclients.branch.
- To list branches, use:
  SELECT DISTINCT branch FROM branchclients ORDER BY branch;

OUTPUT FORMAT:
- When listing branches, write them in one sentence (not bullets).

TOPIC MAPPING (GUIDE, NOT ASSUMPTIONS):
- Branch list comes from branchclients.branch.
- "Active clients" questions should use the ACTIVE CLIENTS table/view (verify exact table name via get_schema).
- "Terminated" questions should use the TERMINATED table/view (verify exact table name via get_schema).
- "Zip codes" questions should use the location zip table/view (verify exact table name via get_schema).
- "Reason for termination" should come from the termination-related table/columns (verify via get_schema).

"""

conversation_history = [{"role": "system", "content": SYSTEM_PROMPT}]
MAX_HISTORY_MESSAGES = 30  # keep it light



@app.route("/test_db")
def test_db():
    rows = run_sql("SELECT NOW() AS server_time;")
    return jsonify(rows)

@app.route("/")
def home():
    return jsonify({
        "status": "Koko backend is alive 🐨",
        "endpoints": ["/test_db", "/chat_stream", "/memories", "/upload_doc", "/load_sheet"]
    }), 200


@app.route("/memories", methods=["GET", "DELETE"])
def memories():
    if request.method == "DELETE":
        try:
            with open(MEMORY_STORE_PATH, "w", encoding="utf-8") as f:
                json.dump([], f)
        except OSError:
            return jsonify({"error": "Failed to clear memories."}), 500
        return jsonify({"message": "Memories cleared."})

    return jsonify({"memories": _load_memories()})

@app.route("/upload_doc", methods=["POST"])
def upload_doc():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "No file uploaded."}), 400

    filename = secure_filename(file.filename)
    if not _is_allowed_doc(filename):
        return jsonify({"error": "Unsupported file type. Use .txt, .md, .csv, or .pdf."}), 400

    try:
        content = _extract_text_from_upload(file)
    except Exception as exc:
        return jsonify({"error": f"Failed to read file: {exc}"}), 400

    content = content.strip()
    if not content:
        return jsonify({"error": "File appears to be empty."}), 400

    truncated = content[:MAX_DOC_CHARS]
    if len(content) > MAX_DOC_CHARS:
        truncated += "\n\n[Document truncated]"

    conversation_history.append({
        "role": "user",
        "content": f"Document uploaded: {filename}\n\n{truncated}"
    })
    if len(conversation_history) > (1 + MAX_HISTORY_MESSAGES):
        conversation_history[:] = [conversation_history[0]] + conversation_history[-MAX_HISTORY_MESSAGES:]

    return jsonify({
        "message": "Document uploaded. Ask me anything about it!",
        "filename": filename,
        "chars": len(truncated)
    })

@app.route("/load_sheet", methods=["POST"])
def load_sheet():
    payload = request.json or {}
    sheet_url = (payload.get("url") or "").strip()
    if not sheet_url:
        return jsonify({"error": "No Google Sheets URL provided."}), 400

    try:
        content = fetch_sheet_csv(sheet_url)
    except Exception as exc:
        return jsonify({"error": f"Failed to read Google Sheet: {exc}"}), 400

    content = content.strip()
    if not content:
        return jsonify({"error": "Google Sheet appears to be empty."}), 400

    truncated = content[:MAX_SHEET_CHARS]
    if len(content) > MAX_SHEET_CHARS:
        truncated += "\n\n[Sheet truncated]"

    conversation_history.append({
        "role": "user",
        "content": f"Google Sheet loaded:\n\n{truncated}"
    })
    if len(conversation_history) > (1 + MAX_HISTORY_MESSAGES):
        conversation_history[:] = [conversation_history[0]] + conversation_history[-MAX_HISTORY_MESSAGES:]

    return jsonify({
        "message": "Google Sheet loaded. Ask me anything about it!",
        "chars": len(truncated)
    })

@app.route("/chat_stream", methods=["OPTIONS"])
def chat_stream_options():
    return "", 200

@app.route("/chat_stream", methods=["POST"])
def chat_stream():
    user_message = request.json.get("message", "")
    tone_mode = request.json.get("tone")

    memory_text = _extract_memory_command(user_message)

    if memory_text:
        entry = _save_memory(memory_text)
        conversation_history.append({
            "role": "system",
            "content": f"Memory saved: {entry['text']}"
        })

    if tone_mode:
        conversation_history.append({
            "role": "system",
            "content": f"Tone preference: {tone_mode}. Keep responses aligned to this tone."
        })

    # Save user message to history
    conversation_history.append({"role": "user", "content": user_message})

    # Cap history (keep system + last N messages)
    if len(conversation_history) > (1 + MAX_HISTORY_MESSAGES):
        conversation_history[:] = [conversation_history[0]] + conversation_history[-MAX_HISTORY_MESSAGES:]

    def generate():
        yield f"data: {json.dumps({'delta': ''})}\n\n"

        try:
            current_input = list(conversation_history)
            memory_context = _format_memory_context(_load_memories())
            if memory_context:
                current_input = [
                    current_input[0],
                    {"role": "system", "content": memory_context},
                ] + current_input[1:]

            final_text = ""
            last_sql = {"query": None, "rows": []}
            max_rounds = 6


            for _ in range(max_rounds):
                resp = client.responses.create(
                    model="gpt-5.1",
                    input=current_input,
                    tools=[{"type": "web_search"}, SQL_TOOL, SCHEMA_TOOL],
                    tool_choice="auto",
                    max_output_tokens=500
                )

                tool_calls = [
                    item for item in (resp.output or [])
                    if getattr(item, "type", None) == "function_call"
                ]

                # If no tool calls, we got the final answer
                if not tool_calls:
                    final_text = resp.output_text or ""
                    break

                tool_outputs = []

                for call in tool_calls:
                    name = call.name
                    args = json.loads(call.arguments or "{}")

                    if name == "get_schema":
                        mode = args.get("mode")
                        table = args.get("table")
                        column = args.get("column")
                        limit = args.get("limit", 50)

                        tool_result = {"rows": get_schema(mode, table=table, column=column, limit=limit)}
                        tool_result = json_safe(tool_result)

                        tool_outputs.append({
                            "type": "function_call_output",
                            "call_id": call.call_id,
                            "output": json.dumps(tool_result)
                        })

                    elif name == "query_sql":
                        q = (args.get("query") or "").strip()

                        bad = ["%s", "$1", "$2"]
                        if any(b in q for b in bad):
                            tool_result = {"error": "Placeholders are not allowed. Write full SQL without %s/$1 params."}
                        elif not q.lower().startswith("select"):
                            tool_result = {"error": "Only SELECT queries are allowed."}
                        else:
                            q2 = rewrite_sql(user_message, q)      # ✅ auto-fix branch/month
                            tool_result = {"rows": run_sql(q2)}
                            last_sql["query"] = q2
                            last_sql["rows"] = tool_result["rows"]
                        

                        tool_result = json_safe(tool_result)

                        tool_outputs.append({
                            "type": "function_call_output",
                            "call_id": call.call_id,
                            "output": json.dumps(tool_result)
                        })

                # Accumulate tool context across rounds
                current_input = current_input + (resp.output or []) + tool_outputs

            # Force one final answer if we ended on tool calls
            if not (final_text or "").strip():
                current_input = current_input + [{
                        "role": "user",
                        "content": "Answer ONLY using the SQL results above. If a count exists in the rows, use that number exactly."
                    }]
                
                resp2 = client.responses.create(
                    model="gpt-5.1",
                    input=current_input,
                    tool_choice="none",
                    max_output_tokens=500
                )

                final_text = resp2.output_text or ""

                if not final_text.strip():
                    final_text = "I ran the database query, but didn’t get a readable response back. Try re-asking in a simpler way (ex: 'Active clients in Aurora for Dec 2024')."


            # ✅ Append SQL proof AFTER tools have run
            if SHOW_SQL_PROOF and last_sql["query"] and isinstance(last_sql["rows"], list):
                preview = last_sql["rows"][:5]
                final_text += "\n\n---\nSQL used:\n" + last_sql["query"]
                final_text += "\n\nSQL result preview (first 5 rows):\n" + json.dumps(preview, indent=2)

            
            # Stream final answer
            time.sleep(STREAM_INITIAL_DELAY_SECONDS)
            chunk_size = STREAM_CHUNK_SIZE
            full = ""
            for i in range(0, len(final_text), chunk_size):
                chunk = final_text[i:i + chunk_size]
                full += chunk
                yield f"data: {json.dumps({'delta': chunk})}\n\n"
                time.sleep(STREAM_CHUNK_DELAY_SECONDS)

            if full.strip():
                conversation_history.append({"role": "assistant", "content": full})

            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'delta': f'[Server error] {str(e)}'})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

    # ✅ THIS LINE MUST EXIST and must be at this indentation level
    return Response(generate(), mimetype="text/event-stream")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)



    ##Where do branch names come from in the database?