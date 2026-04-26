from .agent import LazyAgent
from .eval import EvalRunner
from .planner import QueryPlanner
from .ranker import CodeRanker
from .tools import CodeTools


class BaselineAgent:
    def __init__(self, ranker, tools):
        self.ranker = ranker
        self.tools = tools

    def run(self, query):
        nodes = [n for n, _ in self.ranker.top_k(k=100)]
        for n in nodes:
            self.tools.read_node(n)
        return {"nodes_used": nodes, "context_size": len(nodes)}


def main():
    ranker = CodeRanker(repo_path=".")
    ranker.build_call_graph()
    ranker.compute_churn()
    ranker.compute_rank()

    print(f"graph: {ranker.graph.number_of_nodes()} nodes, "
          f"{ranker.graph.number_of_edges()} edges")
    print("top 10 by score:")
    for name, score in ranker.top_k(k=10):
        print(f"  {score:.4f}  {name}")

    tools = CodeTools(repo=".")
    planner = QueryPlanner(ranker)
    agent = LazyAgent(planner, tools)
    baseline = BaselineAgent(ranker, tools)

    queries = [
        "compute the rank",
        "run the agent",
        "extract calls from python",
    ]
    ground_truth = {
        "compute the rank": {"compute_rank", "top_k"},
        "run the agent": {"run", "run_test"},
        "extract calls from python": {
            "extract_python_calls", "extract_repo_calls", "_callee_name",
        },
    }

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
    main()
