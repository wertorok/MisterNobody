import time


class EvalRunner:
    def __init__(self, agent, baseline_agent, ground_truth=None,
                 graph_size=None, query_types=None):
        self.agent = agent
        self.baseline = baseline_agent
        self.ground_truth = ground_truth or {}
        self.graph_size = graph_size
        self.query_types = query_types or {}

    @staticmethod
    def _hit(returned, truth):
        for r in returned:
            tail = r.rsplit(".", 1)[-1]
            if r in truth or tail in truth:
                return True
        return False

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

            agent_nodes = r1["nodes_used"]
            truth = set(self.ground_truth.get(q, []))
            hit = self._hit(agent_nodes, truth) if truth else None

            results.append({
                "query": q,
                "type": self.query_types.get(q),
                "agent_nodes": len(agent_nodes),
                "baseline_nodes": len(r2["nodes_used"]),
                "agent_time": t1,
                "baseline_time": t2,
                "agent_node_list": agent_nodes,
                "hit": hit,
            })
        return results

    def metrics(self, results):
        if not results:
            return {
                "avg_node_reduction": 0.0,
                "retrieval_avoidance": 0.0,
                "hit_rate": None,
                "diversity": 0.0,
            }
        avg_reduction = sum(
            r["baseline_nodes"] - r["agent_nodes"] for r in results
        ) / len(results)
        total_baseline = sum(r["baseline_nodes"] for r in results)
        total_agent = sum(r["agent_nodes"] for r in results)
        avoidance = (
            (total_baseline - total_agent) / total_baseline
            if total_baseline else 0.0
        )

        scored = [r for r in results if r["hit"] is not None]
        hit_rate = (
            sum(1 for r in scored if r["hit"]) / len(scored)
            if scored else None
        )

        by_type = {}
        for r in scored:
            t = r.get("type")
            if t is None:
                continue
            by_type.setdefault(t, []).append(r["hit"])
        by_type_rate = {
            t: sum(v) / len(v) for t, v in by_type.items() if v
        }

        union = set()
        for r in results:
            union.update(r["agent_node_list"])
        diversity = (
            len(union) / self.graph_size
            if self.graph_size else float(len(union))
        )

        return {
            "avg_node_reduction": avg_reduction,
            "retrieval_avoidance": avoidance,
            "hit_rate": hit_rate,
            "by_type": by_type_rate,
            "diversity": diversity,
        }
