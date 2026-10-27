package stats

import (
	"sort"
	"sync"
	"time"
)

type Stats struct {
	mu       sync.Mutex
	started  time.Time
	total    int
	byStatus map[int]int
}

func New(now time.Time) *Stats {
	return &Stats{started: now, byStatus: make(map[int]int)}
}

func (s *Stats) Record(status int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.total++
	s.byStatus[status]++
}

type StatusCount struct {
	Status int `json:"status"`
	Count  int `json:"count"`
}

type Summary struct {
	UptimeSeconds int64         `json:"uptimeSeconds"`
	Total         int           `json:"total"`
	Statuses      []StatusCount `json:"statuses"`
}

func (s *Stats) Summary(now time.Time) Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	statuses := make([]StatusCount, 0, len(s.byStatus))
	for status, count := range s.byStatus {
		statuses = append(statuses, StatusCount{Status: status, Count: count})
	}
	sort.Slice(statuses, func(i, j int) bool { return statuses[i].Status < statuses[j].Status })
	return Summary{
		UptimeSeconds: int64(now.Sub(s.started).Seconds()),
		Total:         s.total,
		Statuses:      statuses,
	}
}
