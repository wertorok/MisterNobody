import json
import os
import re

_PROMPT = """Map the user's natural-language query to code symbols a programmer might search for.

Return ONLY a JSON object with these keys:
- "verbs": short list of action words (lowercase)
- "concepts": short list of related technical ideas (lowercase)
- "entities": short list of likely function or class names (preserve casing)

Keep each list under 6 items. No prose, no markdown, just the JSON.

Query: {query}"""

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


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
        tokens = self._parse(text)

        usage = getattr(resp, "usage", None)
        if usage is not None:
            self.cost["input_tokens"] += getattr(usage, "input_tokens", 0)
            self.cost["output_tokens"] += getattr(usage, "output_tokens", 0)
        self.cost["calls"] += 1

        self.cache[query] = tokens
        return tokens

    @staticmethod
    def _parse(text):
        match = _JSON_RE.search(text)
        if not match:
            return []
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
        out = []
        for key in ("verbs", "concepts", "entities"):
            for v in data.get(key, []) or []:
                if isinstance(v, str) and v:
                    out.append(v.lower())
        return out
