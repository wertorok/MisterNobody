class LazyAgent:
    def __init__(self, planner, tools, max_nodes=5):
        self.planner = planner
        self.tools = tools
        self.memory = set()
        self.max_nodes = max_nodes

    def reset(self):
        self.memory.clear()

    def run(self, query):
        plan = self.planner.plan(query)
        context = []
        for node, score in plan:
            if node in self.memory:
                continue
            code = self.tools.read_node(node)
            context.append((node, code))
            self.memory.add(node)
            if self.should_stop(context):
                break
        return self.synthesize_answer(context)

    def should_stop(self, context):
        return len(context) >= self.max_nodes

    def synthesize_answer(self, context):
        return {
            "nodes_used": [c[0] for c in context],
            "context_size": len(context),
        }
