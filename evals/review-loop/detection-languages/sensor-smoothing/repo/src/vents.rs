use crate::readings::mean;

pub const OPEN_ABOVE_CELSIUS: f64 = 28.0;

/// Opens the vents when the temperature over the readings so far is too high.
pub fn should_open(temperatures: &[f64]) -> bool {
    mean(temperatures).is_some_and(|value| value > OPEN_ABOVE_CELSIUS)
}
