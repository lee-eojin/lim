package main

import (
	"log"
	"net/http"
	"time"

	"example.com/gateway/server"
	"example.com/gateway/stats"
)

func main() {
	counter := stats.New(time.Now())
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir("public")))
	mux.Handle("/_summary", server.SummaryHandler(counter))
	log.Fatal(http.ListenAndServe(":8080", server.Counted(counter, mux)))
}
