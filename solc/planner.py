class QueryPlanner:
    def __init__(self, ranker):
        self.ranker = ranker

    def plan(self, query):
        if "auth" in query:
            focus = "auth"
        elif "payment" in query:
            focus = "payment"
        else:
            focus = None

        ranked = self.ranker.top_k()
        if focus:
            ranked = [x for x in ranked if focus in x[0]]
        return ranked[:10]
