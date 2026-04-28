"""Fix markdown link syntax in storage_state.json domains and write clean file."""
import re, json, sys
from pathlib import Path

raw = sys.stdin.read()
# Replace [text](url) → text
cleaned = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', raw)
data = json.loads(cleaned)
out = Path(__file__).resolve().parent.parent / "storage_state.json"
out.write_text(json.dumps(data, indent=2))
print(f"Saved {out}")
