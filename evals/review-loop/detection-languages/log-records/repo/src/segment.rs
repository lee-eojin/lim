use crate::record::{decode, RecordError};

/// Replays the records of a segment in order, stopping at the first bad one.
pub fn replay<'a>(records: impl IntoIterator<Item = &'a [u8]>, mut apply: impl FnMut(&[u8])) -> Result<usize, RecordError> {
    let mut applied = 0;
    for record in records {
        apply(decode(record)?);
        applied += 1;
    }
    Ok(applied)
}
