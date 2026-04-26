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
    def __init__(self, ranker, num_seeds=5, expand_per_seed=3, top_k=10):
        self.ranker = ranker
        self.num_seeds = num_seeds
        self.expand_per_seed = expand_per_seed
        self.top_k = top_k

    def plan(self, query):
        scores = self.ranker.scores
        if not scores:
            return []

        tokens = tokenize(query)
        matched = []
        for node, r in scores.items():
            parts = split_identifier(node)
            ns = name_score(node, tokens)
            if ns > 0:
                # tie-break: prefer matches in shorter / more focused names
                precision = ns / max(1, len(parts))
                matched.append((node, ns, precision, r))

        if matched:
            matched.sort(key=lambda x: (x[1], x[2], x[3]), reverse=True)
            seeds = [n for n, *_ in matched[:self.num_seeds]]
        else:
            seeds = [
                n for n, _ in
                sorted(scores.items(), key=lambda x: x[1], reverse=True)
                [:self.num_seeds]
            ]

        expanded = expand(self.ranker.graph, seeds, self.expand_per_seed)
        match_meta = {n: (ns, p) for n, ns, p, _ in matched}

        return sorted(
            [(n, scores.get(n, 0.0)) for n in expanded],
            key=lambda x: (match_meta.get(x[0], (0, 0.0)), x[1]),
            reverse=True,
        )[:self.top_k]
