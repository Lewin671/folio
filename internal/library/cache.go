package library

import "container/list"

// cache is an LRU. Its owner holds Store.mu while accessing it.
type cache[V any] struct {
	items map[string]*list.Element
	order list.List
	bytes int
}

type entry[V any] struct {
	key   string
	value V
	size  int
}

func (c *cache[V]) get(key string) (V, bool) {
	if e := c.items[key]; e != nil {
		c.order.MoveToFront(e)
		return e.Value.(entry[V]).value, true
	}
	var zero V
	return zero, false
}

func (c *cache[V]) remove(key string) {
	if e := c.items[key]; e != nil {
		c.bytes -= e.Value.(entry[V]).size
		c.order.Remove(e)
		delete(c.items, key)
	}
}

func (c *cache[V]) put(key string, value V, size, capacity, budget int) {
	c.remove(key)
	if c.items == nil {
		c.items = make(map[string]*list.Element)
	}
	c.items[key] = c.order.PushFront(entry[V]{key, value, size})
	c.bytes += size
	for c.order.Len() > capacity || (budget > 0 && c.bytes > budget) {
		c.remove(c.order.Back().Value.(entry[V]).key)
	}
}
