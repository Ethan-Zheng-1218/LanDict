#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_uses_engine_position_and_can_remain_still() {
        assert_eq!(progress_percent(0, 30000, false), 0);
        assert_eq!(progress_percent(15000, 30000, false), 50);
        assert_eq!(progress_percent(15000, 30000, false), 50);
    }

    #[test]
    fn only_success_can_show_one_hundred_percent() {
        assert_eq!(progress_percent(30000, 30000, false), 99);
        assert_eq!(progress_percent(0, 30000, true), 100);
        assert_eq!(progress_percent(0, 0, false), 0);
    }

    #[test]
    fn earth_rotation_uses_the_run_cycle_speed() {
        let displacement=-earth_angle(1000,EARTH_RADIUS).to_radians()*EARTH_RADIUS;
        assert!((displacement-20.0).abs()<0.01);
    }

    #[test]
    fn complete_pose_frames_loop() {
        assert_eq!(frame_index(0),0);
        assert_eq!(frame_index(41),0);
        assert_eq!(frame_index(42),1);
        assert_eq!(frame_index(999),23);
        assert_eq!(frame_index(1000),0);
        assert_eq!(frame_index(1042),1);
    }
}
/// The NSIS engine advances by executed instructions, not the animation clock.
pub fn progress_percent(position: i32, maximum: i32, successful: bool) -> u32 {
    if successful { return 100; }
    if maximum <= 0 { return 0; }
    ((position.max(0) as u64 * 100 / maximum as u64).min(99)) as u32
}

pub const FRAME_COUNT:usize=24;
pub const CYCLE_MS:u64=1000;
pub const SURFACE_SPEED:f32=20.0;
pub const EARTH_RADIUS:f32=195.0;
pub fn frame_index(elapsed_ms:u64)->usize {
    ((elapsed_ms%CYCLE_MS)*FRAME_COUNT as u64/CYCLE_MS) as usize
}

pub fn earth_angle(elapsed_ms:u64,radius:f32)->f32 {
    // Bound the accumulated angle to avoid losing precision on a long preview.
    -(SURFACE_SPEED as f64*elapsed_ms as f64/1000.0/radius as f64).to_degrees().rem_euclid(360.0) as f32
}

