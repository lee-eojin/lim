/// Largest message a client may send. Uploads are split into chunks of this size.
pub const MAX_MESSAGE_BYTES: usize = 256 * 1024;
