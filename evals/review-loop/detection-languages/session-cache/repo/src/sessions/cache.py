class Cache:
    def __init__(self):
        self._entries = {}

    def put(self, key, value):
        self._entries[key] = value

    def get(self, key):
        return self._entries[key]

    def __len__(self):
        return len(self._entries)
