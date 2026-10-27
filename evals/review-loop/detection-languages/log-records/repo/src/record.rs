#[derive(Debug, PartialEq)]
pub enum RecordError {
    Empty,
}

pub fn encode(body: &[u8]) -> Vec<u8> {
    body.to_vec()
}

pub fn decode(record: &[u8]) -> Result<&[u8], RecordError> {
    if record.is_empty() {
        return Err(RecordError::Empty);
    }
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        assert_eq!(decode(&encode(b"put a=1")), Ok(&b"put a=1"[..]));
    }

    #[test]
    fn empty_record_is_an_error() {
        assert_eq!(decode(&[]), Err(RecordError::Empty));
    }
}
