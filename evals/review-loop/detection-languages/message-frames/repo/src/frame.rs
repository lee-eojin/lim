use crate::limits::MAX_MESSAGE_BYTES;

const HEADER_BYTES: usize = 4;

#[derive(Debug, PartialEq)]
pub enum FrameError {
    TooLarge(usize),
    Incomplete,
}

pub fn encode(message: &[u8], out: &mut Vec<u8>) -> Result<(), FrameError> {
    if message.len() > MAX_MESSAGE_BYTES {
        return Err(FrameError::TooLarge(message.len()));
    }
    out.extend_from_slice(&(message.len() as u32).to_be_bytes());
    out.extend_from_slice(message);
    Ok(())
}

/// Splits the first frame off `buffer`, returning its message and the bytes after it.
pub fn decode(buffer: &[u8]) -> Result<(&[u8], &[u8]), FrameError> {
    if buffer.len() < HEADER_BYTES {
        return Err(FrameError::Incomplete);
    }
    let (header, rest) = buffer.split_at(HEADER_BYTES);
    let length = u32::from_be_bytes(header.try_into().unwrap()) as usize;
    if rest.len() < length {
        return Err(FrameError::Incomplete);
    }
    Ok(rest.split_at(length))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let mut out = Vec::new();
        encode(b"hello", &mut out).unwrap();
        encode(b"world", &mut out).unwrap();
        let (first, rest) = decode(&out).unwrap();
        let (second, rest) = decode(rest).unwrap();
        assert_eq!((first, second, rest), (&b"hello"[..], &b"world"[..], &b""[..]));
    }

    #[test]
    fn rejects_oversized_messages() {
        let message = vec![0u8; MAX_MESSAGE_BYTES + 1];
        assert_eq!(encode(&message, &mut Vec::new()), Err(FrameError::TooLarge(MAX_MESSAGE_BYTES + 1)));
    }

    #[test]
    fn waits_for_a_whole_frame() {
        let mut out = Vec::new();
        encode(b"hello", &mut out).unwrap();
        assert_eq!(decode(&out[..out.len() - 1]), Err(FrameError::Incomplete));
    }
}
