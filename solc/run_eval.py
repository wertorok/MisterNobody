import argparse
import json
import sys

from .agent import LazyAgent
from .demo import BaselineAgent
from .eval import EvalRunner
from .planner import QueryPlanner
from .ranker import CodeRanker
from .tools import CodeTools


def build(repo_path):
    ranker = CodeRanker(repo_path=repo_path)
    ranker.build_call_graph()
    ranker.compute_churn()
    ranker.compute_rank()
    return ranker


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("--queries", help="path to JSON file with queries + truth")
    ap.add_argument("--top", type=int, default=10, help="print top-K ranked")
    args = ap.parse_args()

    ranker = build(args.repo)
    print(f"repo: {args.repo}")
    print(f"graph: {ranker.graph.number_of_nodes()} nodes, "
          f"{ranker.graph.number_of_edges()} edges")
    print(f"defined symbols: {len(ranker.defined)}")
    print(f"top {args.top} by score:")
    for name, score in ranker.top_k(k=args.top):
        print(f"  {score:.4f}  {name}")

    if not args.queries:
        return

    with open(args.queries) as f:
        spec = json.load(f)
    queries = list(spec.keys())
    ground_truth = {q: set(v) for q, v in spec.items()}

    tools = CodeTools(repo=args.repo)
    planner = QueryPlanner(ranker)
    agent = LazyAgent(planner, tools)
    baseline = BaselineAgent(ranker, tools)

    runner = EvalRunner(
        agent, baseline,
        ground_truth=ground_truth,
        graph_size=ranker.graph.number_of_nodes(),
    )
    results = runner.run_test(queries)
    metrics = runner.metrics(results)

    print("\neval:")
    for r in results:
        print(f"  q={r['query']!r}")
        print(f"    agent_nodes={r['agent_nodes']} hit={r['hit']} "
              f"used={r['agent_node_list']}")
    print("metrics:", metrics)


if __name__ == "__main__":
    sys.exit(main() or 0)
