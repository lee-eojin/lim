package main

import (
	"flag"
	"log"
	"os"

	"example.com/ledger/export"
)

func main() {
	out := flag.String("out", "ledger.csv", "file to write")
	flag.Parse()

	entries, err := loadEntries()
	if err != nil {
		log.Fatal(err)
	}
	file, err := os.Create(*out)
	if err != nil {
		log.Fatal(err)
	}
	if err := export.Write(file, entries); err != nil {
		file.Close()
		os.Remove(*out)
		log.Fatalf("export failed, removed %s: %v", *out, err)
	}
	if err := file.Close(); err != nil {
		log.Fatal(err)
	}
	log.Printf("wrote %d entries to %s", len(entries), *out)
}

func loadEntries() ([]export.Entry, error) {
	return []export.Entry{{ID: "inv-1001", AmountCents: 125000}, {ID: "inv-1002", AmountCents: -4300}}, nil
}
