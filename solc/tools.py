class CodeTools:
    def __init__(self, repo):
        self.repo = repo

    def read_node(self, node):
        return f"code_of_{node}"

    def expand_neighbors(self, node):
        return []
