import time


class EvalRunner:
    def __init__(self, agent, baseline_agent):
        self.agent = agent
        self.baseline = baseline_agent

    def run_test(self, queries, cold_start=True):
        results = []
        for q in queries:
            if cold_start:
                if hasattr(self.agent, "reset"):
                    self.agent.reset()
                if hasattr(self.baseline, "reset"):
                    self.baseline.reset()

            start = time.time()
            r1 = self.agent.run(q)
            t1 = time.time() - start

            start = time.time()
            r2 = self.baseline.run(q)
            t2 = time.time() - start

            results.append({
                "query": q,
                "agent_nodes": len(r1["nodes_used"]),
                "baseline_nodes": len(r2["nodes_used"]),
                "agent_time": t1,
                "baseline_time": t2,
            })
        return results

    def metrics(self, results):
        if not results:
            return {"avg_node_reduction": 0.0, "retrieval_avoidance": 0.0}
        avg_reduction = sum(
            r["baseline_nodes"] - r["agent_nodes"] for r in results
        ) / len(results)
        total_baseline = sum(r["baseline_nodes"] for r in results)
        total_agent = sum(r["agent_nodes"] for r in results)
        avoidance = (
            (total_baseline - total_agent) / total_baseline
            if total_baseline else 0.0
        )
        return {
            "avg_node_reduction": avg_reduction,
            "retrieval_avoidance": avoidance,
        }
