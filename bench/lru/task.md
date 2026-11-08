Write `solution.mjs` exporting a class `LRUCache`:

- `new LRUCache(capacity)`: `capacity` is an integer ≥ 0. Throw a `RangeError`
  for a negative or non-integer capacity.
- `get(key)`: the value, or `undefined`. A hit makes the key most recently used.
- `set(key, value)`: add or replace, making the key most recently used. When
  this puts the cache over capacity, evict the least recently used key. With
  capacity 0 nothing is ever stored. Returns the cache, so calls chain.
- `has(key)`: whether the key is cached. It does **not** count as a use.
- `delete(key)`: remove it; returns whether it was there.
- `size`: a getter for the number of keys.
- `keys()`: the keys, least recently used first, as an array.

Keys may be any value (compare them like a `Map` does). Every operation
should be O(1) on average.
