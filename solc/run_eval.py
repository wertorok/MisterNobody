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
    ap.add_argument("--llm", action="store_true",
                    help="enable LLM query expansion via Anthropic SDK "
                         "(needs ANTHROPIC_API_KEY)")
    ap.add_argument("--llm-cli", action="store_true",
                    help="enable LLM query expansion via local claude CLI "
                         "(uses host session auth)")
    ap.add_argument("--llm-model", default=None,
                    help="model name; default: MiniMax-M2.7 for --llm, "
                         "haiku for --llm-cli")
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

    if args.llm and args.llm_cli:
        ap.error("--llm and --llm-cli are mutually exclusive")

    expander = None
    if args.llm_cli:
        from .query_expander import ClaudeCLIExpander
        expander = ClaudeCLIExpander(model=args.llm_model or "haiku")
    elif args.llm:
        from .query_expander import LLMQueryExpander
        expander = LLMQueryExpander(model=args.llm_model or "MiniMax-M2.7")

    tools = CodeTools(repo=args.repo)
    planner = QueryPlanner(ranker, expander=expander)
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

    if expander is not None:
        c = expander.cost
        usd = c.get("total_cost_usd")
        usd_str = f" usd={usd:.4f}" if usd else ""
        print(f"llm cost: calls={c['calls']} "
              f"input_tokens={c['input_tokens']} "
              f"output_tokens={c['output_tokens']}{usd_str}")


if __name__ == "__main__":
    sys.exit(main() or 0)
