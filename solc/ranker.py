import subprocess
from collections import defaultdict

import networkx as nx

from .extractors import extract_repo_calls


class CodeRanker:
    def __init__(self, repo_path):
        self.repo_path = repo_path
        self.graph = nx.DiGraph()
        self.churn = defaultdict(int)
        self.scores = {}

    def build_call_graph(self):
        edges = extract_repo_calls(self.repo_path)
        for a, b in edges:
            self.graph.add_edge(a, b)

    def compute_churn(self):
        cmd = ["git", "log", "--numstat", "--pretty=format:"]
        out = subprocess.check_output(cmd, cwd=self.repo_path).decode()
        for line in out.split("\n"):
            parts = line.split("\t")
            if len(parts) != 3:
                continue
            added, deleted, file = parts
            try:
                self.churn[file] += int(added) + int(deleted)
            except ValueError:
                continue

    def compute_rank(self):
        pagerank = nx.pagerank(self.graph) if self.graph.number_of_nodes() else {}
        for node in self.graph.nodes:
            self.scores[node] = (
                pagerank.get(node, 0) * 0.6
                + self.churn.get(node, 0) * 0.4
            )
        return self.scores

    def top_k(self, query=None, k=10):
        return sorted(
            self.scores.items(),
            key=lambda x: x[1],
            reverse=True,
        )[:k]
