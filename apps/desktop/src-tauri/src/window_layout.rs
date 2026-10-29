//! Initial window bounds use one physical-pixel coordinate space, including the OS frame.
//! Tray/single-instance restoration deliberately does not reset the user's resized window.

#[derive(Debug, PartialEq)]
pub(crate) struct InitialGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub min_width: u32,
    pub min_height: u32,
}

fn initial_geometry(
    work: (i32, i32, u32, u32),
    scale: f64,
    frame: (u32, u32),
) -> Option<InitialGeometry> {
    let (x, y, width, height) = work;
    if width <= frame.0 || height <= frame.1 {
        return None;
    }
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let outer_width = ((f64::from(width) * 0.8).floor() as u32)
        .max(frame.0 + 1)
        .min(width);
    let outer_height = ((f64::from(height) * 0.8).floor() as u32)
        .max(frame.1 + 1)
        .min(height);
    let inner_width = outer_width - frame.0;
    let inner_height = outer_height - frame.1;
    let centered = |origin: i32, available: u32, used: u32| {
        (i64::from(origin) + i64::from((available - used) / 2))
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
    };
    Some(InitialGeometry {
        x: centered(x, width, outer_width),
        y: centered(y, height, outer_height),
        width: inner_width,
        height: inner_height,
        min_width: ((640.0 * scale).round() as u32).min(inner_width),
        min_height: ((480.0 * scale).round() as u32).min(inner_height),
    })
}

pub(crate) fn configure_initial_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use tauri::{PhysicalPosition, PhysicalSize};

    // The config minimum is logical; clear it before reading/changing physical bounds on high DPI.
    window.set_min_size(None::<PhysicalSize<u32>>)?;
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let outer = window.outer_size()?;
        let inner = window.inner_size()?;
        let frame = (
            outer.width.saturating_sub(inner.width),
            outer.height.saturating_sub(inner.height),
        );
        let area = monitor.work_area();
        if let Some(g) = initial_geometry(
            (
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
            ),
            monitor.scale_factor(),
            frame,
        ) {
            window.set_min_size(Some(PhysicalSize::new(g.min_width, g.min_height)))?;
            window.set_size(PhysicalSize::new(g.width, g.height))?;
            window.set_position(PhysicalPosition::new(g.x, g.y))?;
            return Ok(());
        }
    }
    // A missing monitor reading must not leave a large logical-size window off screen.
    window.set_size(PhysicalSize::new(640, 480))?;
    window.center()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_is_included_in_eighty_percent_of_the_work_area() {
        let g = initial_geometry((0, 0, 1366, 728), 1.0, (16, 39)).unwrap();
        assert_eq!((g.width + 16, g.height + 39), (1092, 582));
        assert_eq!((g.x, g.y), (137, 73));
    }

    #[test]
    fn high_dpi_minimum_cannot_force_the_window_past_its_target() {
        for scale in [1.0, 1.25, 1.5, 2.0, 3.0] {
            let g = initial_geometry((0, 0, 1366, 728), scale, (16, 48)).unwrap();
            assert_eq!((g.width + 16, g.height + 48), (1092, 582));
            assert!(g.min_width <= g.width && g.min_height <= g.height);
        }
    }

    #[test]
    fn taskbar_offsets_and_negative_monitor_origins_are_preserved() {
        let g = initial_geometry((-1920, 40, 1920, 1000), 1.5, (24, 58)).unwrap();
        assert_eq!((g.x, g.y), (-1728, 140));
        assert_eq!((g.width + 24, g.height + 58), (1536, 800));
        assert_eq!((g.min_width, g.min_height), (960, 720));
    }

    #[test]
    fn small_screens_still_fit_and_invalid_work_areas_do_not_resize() {
        let g = initial_geometry((0, 0, 640, 400), 2.0, (16, 40)).unwrap();
        assert_eq!((g.width + 16, g.height + 40), (512, 320));
        assert_eq!((g.min_width, g.min_height), (g.width, g.height));
        assert!(initial_geometry((0, 0, 0, 400), 1.0, (16, 40)).is_none());
        assert!(initial_geometry((0, 0, 16, 40), 1.0, (16, 40)).is_none());
    }

    #[test]
    fn all_sampled_frames_are_centered_inside_the_work_area() {
        for (width, height) in [(800, 560), (1366, 728), (1920, 1040), (3840, 2080)] {
            for scale in [1.0, 1.25, 1.5, 2.0] {
                let frame = ((16.0_f64 * scale) as u32, (39.0_f64 * scale) as u32);
                let g = initial_geometry((-200, 40, width, height), scale, frame).unwrap();
                assert!(g.x >= -200 && g.y >= 40);
                assert!(i64::from(g.x) + i64::from(g.width + frame.0) <= -200 + i64::from(width));
                assert!(i64::from(g.y) + i64::from(g.height + frame.1) <= 40 + i64::from(height));
                assert!(g.min_width <= g.width && g.min_height <= g.height);
            }
        }
    }
}
