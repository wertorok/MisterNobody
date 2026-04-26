import json
import os
import re
import subprocess

_PROMPT = """Output a single JSON object that maps this query to code symbols.

Query: "{query}"

Schema:
{{"verbs": [...], "concepts": [...], "entities": [...]}}
- verbs: action words a programmer might use (lowercase, <=5)
- concepts: related technical ideas (lowercase, <=5)
- entities: likely function or class names (preserve casing, <=5)

Example for query "print colored output":
{{"verbs":["print","echo","write","style"],"concepts":["color","ansi","terminal"],"entities":["echo","secho","style"]}}

Output the JSON object now. No prose, no questions, no markdown fences."""

_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json_payload(text):
    m = _FENCE_RE.search(text)
    payload = m.group(1) if m else None
    if payload is None:
        m = _JSON_RE.search(text)
        payload = m.group(0) if m else None
    if payload is None:
        return {}
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return {}


def _flatten(data):
    out = []
    for key in ("verbs", "concepts", "entities"):
        for v in data.get(key, []) or []:
            if isinstance(v, str) and v:
                out.append(v.lower())
    return out


class StubExpander:
    """Deterministic expander for tests: returns extra tokens from a dict."""

    def __init__(self, mapping=None):
        self.mapping = mapping or {}
        self.cost = {"input_tokens": 0, "output_tokens": 0, "calls": 0}
        self.cache = {}

    def expand(self, query):
        return list(self.mapping.get(query, []))


class LLMQueryExpander:
    """Calls an Anthropic-compatible API to expand a query into extra tokens.

    Reads ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY from the environment, or
    accepts them as constructor args. For MiniMax: set base_url to
    https://api.minimax.io/anthropic and use one of the MiniMax-M2.* models.
    """

    def __init__(self, model="MiniMax-M2.7", base_url=None, api_key=None,
                 max_tokens=300, temperature=0.3):
        from anthropic import Anthropic

        self.client = Anthropic(
            base_url=base_url or os.environ.get("ANTHROPIC_BASE_URL"),
            api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"),
        )
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.cache = {}
        self.cost = {"input_tokens": 0, "output_tokens": 0, "calls": 0}

    def expand(self, query):
        if query in self.cache:
            return self.cache[query]

        resp = self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
            system="You return only JSON. No prose, no markdown fences.",
            messages=[{
                "role": "user",
                "content": [{"type": "text", "text": _PROMPT.format(query=query)}],
            }],
        )

        text = "".join(
            getattr(b, "text", "") for b in resp.content
            if getattr(b, "type", None) == "text"
        )
        tokens = _flatten(_parse_json_payload(text))

        usage = getattr(resp, "usage", None)
        if usage is not None:
            self.cost["input_tokens"] += getattr(usage, "input_tokens", 0)
            self.cost["output_tokens"] += getattr(usage, "output_tokens", 0)
        self.cost["calls"] += 1

        self.cache[query] = tokens
        return tokens


class ClaudeCLIExpander:
    """Shells out to the local `claude` binary using the host's session/auth.

    Useful when the sandbox proxy blocks external LLM endpoints but the
    Claude Code CLI itself can still reach Anthropic via the user's
    subscription. Tracks total_cost_usd reported by the CLI wrapper.
    """

    def __init__(self, model="haiku", max_budget_usd=2.0,
                 claude_bin="claude", timeout=90, cwd="/tmp"):
        self.model = model
        self.max_budget = max_budget_usd
        self.bin = claude_bin
        self.timeout = timeout
        # Run from a non-git directory to avoid triggering host stop hooks
        # that block on uncommitted changes in the parent session's repo.
        self.cwd = cwd
        self.cache = {}
        self.cost = {"calls": 0, "total_cost_usd": 0.0,
                     "input_tokens": 0, "output_tokens": 0}

    def expand(self, query):
        if query in self.cache:
            return self.cache[query]

        prompt = _PROMPT.format(query=query)
        argv = [
            self.bin, "-p",
            "--output-format", "json",
            "--model", self.model,
            "--max-budget-usd", str(self.max_budget),
            "--exclude-dynamic-system-prompt-sections",
            prompt,
        ]
        try:
            proc = subprocess.run(
                argv, capture_output=True, text=True,
                timeout=self.timeout, check=False, cwd=self.cwd,
                stdin=subprocess.DEVNULL,
            )
        except subprocess.TimeoutExpired:
            self.cache[query] = []
            return []

        if proc.returncode != 0 or not proc.stdout:
            self.cache[query] = []
            return []

        try:
            wrapper = json.loads(proc.stdout)
        except json.JSONDecodeError:
            self.cache[query] = []
            return []

        tokens = _flatten(_parse_json_payload(wrapper.get("result", "") or ""))

        self.cost["calls"] += 1
        self.cost["total_cost_usd"] += float(wrapper.get("total_cost_usd") or 0)
        usage = wrapper.get("usage") or {}
        self.cost["input_tokens"] += int(usage.get("input_tokens") or 0)
        self.cost["output_tokens"] += int(usage.get("output_tokens") or 0)

        self.cache[query] = tokens
        return tokens
