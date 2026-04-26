import re

_TOKEN_RE = re.compile(r"[a-zA-Z_]+")
_SPLIT_RE = re.compile(r"[_\W]+")
_CAMEL_RE = re.compile(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)")
_SUFFIXES = ("ing", "ed", "er", "s")
_STOPWORDS = {
    "a", "an", "the", "of", "in", "is", "are", "to", "for", "from",
    "as", "by", "on", "at", "with", "and", "or", "not", "do", "does",
    "did", "be", "been", "have", "has", "had", "it", "this", "that",
    "these", "those", "what", "which", "where", "when", "how", "why",
    "who", "i", "me", "my", "you", "your", "we", "our", "they", "their",
}


def tokenize(query):
    return [
        t.lower() for t in _TOKEN_RE.findall(query)
        if t.lower() not in _STOPWORDS
    ]


def stem(token):
    for suf in _SUFFIXES:
        if token.endswith(suf) and len(token) > len(suf) + 2:
            return token[: -len(suf)]
    return token


def split_identifier(name):
    snake = _SPLIT_RE.split(name)
    camel = _CAMEL_RE.findall(name)
    return {p.lower() for p in (*snake, *camel) if p}


def name_score(node, tokens):
    parts = {stem(p) for p in split_identifier(node)}
    return sum(1 for t in tokens if stem(t) in parts)


def expand(graph, seeds, per_seed=3):
    nodes = set(seeds)
    for s in seeds:
        if s not in graph:
            continue
        neighbors = list(graph.successors(s)) + list(graph.predecessors(s))
        nodes.update(neighbors[:per_seed])
    return nodes


class QueryPlanner:
    def __init__(self, ranker, num_seeds=5, expand_per_seed=3, top_k=10,
                 expander=None, selective_llm=False,
                 confidence_top_score=2, confidence_min_matches=3):
        self.ranker = ranker
        self.num_seeds = num_seeds
        self.expand_per_seed = expand_per_seed
        self.top_k = top_k
        self.expander = expander
        self.selective_llm = selective_llm
        self.confidence_top_score = confidence_top_score
        self.confidence_min_matches = confidence_min_matches

    def _match(self, tokens):
        scores = self.ranker.scores
        matched = []
        for node, r in scores.items():
            parts = split_identifier(node)
            ns = name_score(node, tokens)
            if ns > 0:
                precision = ns / max(1, len(parts))
                matched.append((node, ns, precision, r))
        return matched

    def _is_confident(self, matched):
        if not matched:
            return False
        top_scores = sorted([m[1] for m in matched], reverse=True)[:5]
        return (
            top_scores[0] >= self.confidence_top_score
            and sum(1 for s in top_scores if s > 0) >= self.confidence_min_matches
        )

    def _expand_tokens(self, tokens, query):
        extra = self.expander.expand(query) or []
        extra_tokens = []
        for raw in extra:
            extra_tokens.extend(tokenize(raw))
        out = list(tokens)
        seen = set(tokens)
        for t in extra_tokens:
            if t not in seen:
                out.append(t)
                seen.add(t)
        return out

    def plan(self, query):
        scores = self.ranker.scores
        if not scores:
            return []

        tokens = tokenize(query)
        matched = self._match(tokens)

        if self.expander is not None:
            should_expand = (
                not self.selective_llm or not self._is_confident(matched)
            )
            if should_expand:
                tokens = self._expand_tokens(tokens, query)
                matched = self._match(tokens)

        if matched:
            matched.sort(key=lambda x: (x[2], x[1], x[3]), reverse=True)
            seeds = [n for n, *_ in matched[:self.num_seeds]]
        else:
            seeds = [
                n for n, _ in
                sorted(scores.items(), key=lambda x: x[1], reverse=True)
                [:self.num_seeds]
            ]

        expanded = expand(self.ranker.graph, seeds, self.expand_per_seed)
        match_meta = {n: (p, ns) for n, ns, p, _ in matched}

        return sorted(
            [(n, scores.get(n, 0.0)) for n in expanded],
            key=lambda x: (match_meta.get(x[0], (0.0, 0)), x[1]),
            reverse=True,
        )[:self.top_k]
