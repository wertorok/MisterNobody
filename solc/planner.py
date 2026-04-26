import re

_TOKEN_RE = re.compile(r"[a-zA-Z_]+")


def tokenize(query):
    return [t.lower() for t in _TOKEN_RE.findall(query)]


def name_score(node, tokens):
    node_l = node.lower()
    return sum(1 for t in tokens if t and t in node_l)


def expand(graph, seeds, per_seed=3):
    nodes = set(seeds)
    for s in seeds:
        if s not in graph:
            continue
        neighbors = list(graph.successors(s)) + list(graph.predecessors(s))
        nodes.update(neighbors[:per_seed])
    return nodes


class QueryPlanner:
    def __init__(self, ranker, rank_weight=0.7, name_weight=0.3,
                 num_seeds=5, expand_per_seed=3, top_k=10):
        self.ranker = ranker
        self.rank_weight = rank_weight
        self.name_weight = name_weight
        self.num_seeds = num_seeds
        self.expand_per_seed = expand_per_seed
        self.top_k = top_k

    def plan(self, query):
        scores = self.ranker.scores
        if not scores:
            return []

        tokens = tokenize(query)
        max_r = max(scores.values()) or 1.0
        denom_n = max(1, len(tokens))

        scored = []
        for node, r in scores.items():
            norm_r = r / max_r
            norm_n = name_score(node, tokens) / denom_n
            final = self.rank_weight * norm_r + self.name_weight * norm_n
            scored.append((node, final))

        scored.sort(key=lambda x: x[1], reverse=True)
        seeds = [n for n, _ in scored[:self.num_seeds]]

        expanded = expand(self.ranker.graph, seeds, self.expand_per_seed)

        final_by_node = dict(scored)
        return sorted(
            [(n, final_by_node.get(n, 0.0)) for n in expanded],
            key=lambda x: x[1],
            reverse=True,
        )[:self.top_k]
