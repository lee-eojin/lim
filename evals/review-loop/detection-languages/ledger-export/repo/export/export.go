package export

import (
	"bufio"
	"fmt"
	"io"
)

type Entry struct {
	ID          string
	AmountCents int64
}

func writeEntries(w io.Writer, entries []Entry) error {
	buffered := bufio.NewWriter(w)
	if _, err := fmt.Fprintln(buffered, "id,amount_cents"); err != nil {
		return err
	}
	for _, entry := range entries {
		if _, err := fmt.Fprintf(buffered, "%s,%d\n", entry.ID, entry.AmountCents); err != nil {
			return err
		}
	}
	return buffered.Flush()
}

// Write writes entries as CSV and reports any error from w.
func Write(w io.Writer, entries []Entry) error {
	return writeEntries(w, entries)
}
