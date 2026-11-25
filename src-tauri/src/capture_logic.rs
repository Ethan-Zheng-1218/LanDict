#[derive(Clone, Copy)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}
impl ScreenRect {
    pub fn contains(&self, point: (i32, i32)) -> bool {
        point.0 >= self.x
            && point.0 < self.x + self.width
            && point.1 >= self.y
            && point.1 < self.y + self.height
    }
}

#[derive(Debug, PartialEq)]
pub enum PointerAction {
    Keep,
    Lookup,
    Dismiss,
}

#[derive(Default)]
pub struct PopupInteraction {
    pub bounds: Option<ScreenRect>,
    dismissed_at: Option<(i32, i32)>,
}
impl PopupInteraction {
    pub fn open(&mut self, bounds: ScreenRect) {
        self.bounds = Some(bounds);
        self.dismissed_at = None;
    }
    pub fn dismiss(&mut self, point: (i32, i32)) {
        self.bounds = None;
        self.dismissed_at = Some(point);
    }
    pub fn action(&mut self, point: (i32, i32), clicked: bool) -> PointerAction {
        if self.bounds.is_some_and(|bounds| bounds.contains(point)) {
            return PointerAction::Keep;
        }
        if clicked && self.bounds.is_some() {
            self.dismiss(point);
            return PointerAction::Dismiss;
        }
        if let Some(old) = self.dismissed_at {
            if (old.0 - point.0).abs() <= 4 && (old.1 - point.1).abs() <= 4 {
                return PointerAction::Keep;
            }
            self.dismissed_at = None;
        }
        PointerAction::Lookup
    }
}

#[derive(Default)]
pub struct HoverTracker {
    anchor: Option<(i32, i32)>,
    since: u64,
    fired: bool,
    input: Option<(u32, isize)>,
}

impl HoverTracker {
    pub fn on_input(&mut self, marker: (u32, isize)) -> bool {
        let changed = self.input.is_some_and(|old| old != marker);
        self.input = Some(marker);
        if changed {
            self.anchor = None;
        }
        changed
    }

    pub fn moved(&self, point: (i32, i32)) -> bool {
        self.anchor
            .is_none_or(|old| (old.0 - point.0).abs() > 4 || (old.1 - point.1).abs() > 4)
    }

    pub fn tick(&mut self, point: (i32, i32), now: u64, delay: u64) -> bool {
        if self.moved(point) {
            self.anchor = Some(point);
            self.since = now;
            self.fired = false;
        }
        if !self.fired && now.saturating_sub(self.since) >= delay {
            self.fired = true;
            return true;
        }
        false
    }

    pub fn dismiss(&mut self) {
        self.fired = true;
    }
}

pub fn normalize_word(text: &str) -> Option<String> {
    let normalized = text.replace(['‘', '’'], "'").replace(['‐', '‑'], "-");
    let word = normalized
        .trim()
        .trim_matches(|c: char| ".,!?;:\"'()[]{}".contains(c));
    if word.is_empty() || word.len() > 80 {
        return None;
    }
    let parts: Vec<&str> = word.split(['-', '\'']).collect();
    parts
        .iter()
        .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphabetic()))
        .then(|| word.to_owned())
}

pub fn context_for_word(text: &str, word: &str, offset: usize) -> String {
    let mut start_byte = 0;
    let sentence = text
        .split_inclusive(['.', '!', '?', '。', '！', '？'])
        .find_map(|part| {
            let start = start_byte;
            start_byte += part.len();
            (offset >= start && offset < start_byte).then_some((part, start))
        });
    let Some((sentence, start_byte)) = sentence else {
        return String::new();
    };
    if !sentence
        .split_whitespace()
        .filter_map(normalize_word)
        .any(|token| token.eq_ignore_ascii_case(word))
    {
        return String::new();
    }
    let index = sentence
        .get(..offset - start_byte)
        .map(|prefix| prefix.trim_start().chars().count())
        .unwrap_or(0);
    let sentence = sentence.trim();
    if sentence.split_whitespace().count() < 2 {
        return String::new();
    }
    // Keep the occurrence inside a bounded window, including non-ASCII surrounding text.
    let chars: Vec<char> = sentence.chars().collect();
    let start = index
        .saturating_sub(300)
        .min(chars.len().saturating_sub(800));
    chars.into_iter().skip(start).take(800).collect()
}

pub fn popup_position(
    point: (i32, i32),
    bounds: (i32, i32, i32, i32),
    size: (i32, i32),
    gap: i32,
) -> (i32, i32) {
    let (left, top, right, bottom) = bounds;
    let x = if point.0 + gap + size.0 > right {
        point.0 - gap - size.0
    } else {
        point.0 + gap
    };
    let y = if point.1 + gap + size.1 > bottom {
        point.1 - gap - size.1
    } else {
        point.1 + gap
    };
    (
        x.clamp(left, (right - size.0).max(left)),
        y.clamp(top, (bottom - size.1).max(top)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn popup_allows_moving_into_it_and_only_dismisses_on_an_outside_click() {
        let mut popup = PopupInteraction::default();
        popup.open(ScreenRect {
            x: 100,
            y: 100,
            width: 280,
            height: 240,
        });
        assert_eq!(popup.action((95, 95), false), PointerAction::Lookup);
        assert_eq!(popup.action((120, 130), false), PointerAction::Keep);
        assert_eq!(popup.action((120, 130), true), PointerAction::Keep);
        assert_eq!(popup.action((500, 300), false), PointerAction::Lookup);
        assert_eq!(popup.action((500, 300), true), PointerAction::Dismiss);
        assert_eq!(popup.action((500, 300), false), PointerAction::Keep);
        assert_eq!(popup.action((510, 300), false), PointerAction::Lookup);
    }

    #[test]
    fn closing_a_popup_suppresses_reopening_until_the_pointer_moves() {
        let mut popup = PopupInteraction::default();
        popup.dismiss((100, 200));
        assert_eq!(popup.action((102, 200), false), PointerAction::Keep);
        assert_eq!(popup.action((105, 200), false), PointerAction::Lookup);
    }

    #[test]
    fn hover_waits_and_movement_restarts_the_timer() {
        let mut hover = HoverTracker::default();
        assert!(!hover.tick((100, 50), 0, 500));
        assert!(!hover.tick((101, 50), 499, 500));
        assert!(hover.tick((100, 50), 500, 500));
        assert!(!hover.tick((100, 50), 1500, 500));
        assert!(!hover.tick((110, 50), 1600, 500));
        assert!(!hover.tick((110, 50), 2099, 500));
        assert!(hover.tick((110, 50), 2100, 500));
    }

    #[test]
    fn only_a_single_english_word_is_accepted() {
        assert_eq!(normalize_word("  ‘don't,’ "), Some("don't".into()));
        assert_eq!(normalize_word("well-known."), Some("well-known".into()));
        assert_eq!(normalize_word("two words"), None);
        assert_eq!(normalize_word("123"), None);
        assert_eq!(normalize_word(""), None);
    }

    #[test]
    fn popup_stays_inside_negative_coordinate_monitor() {
        assert_eq!(
            popup_position((-10, 1030), (-1920, 0, 0, 1040), (320, 230), 12),
            (-342, 788)
        );
        assert_eq!(
            popup_position((-1800, 20), (-1920, 0, 0, 1040), (320, 230), 12),
            (-1788, 32)
        );
    }

    #[test]
    fn context_is_bounded_at_character_boundaries_and_must_contain_the_word() {
        assert_eq!(
            context_for_word("Bank of the river. A cat sleeps.", "bank", 0),
            "Bank of the river."
        );
        assert_eq!(context_for_word("Unrelated sentence.", "bank", 0), "");
        assert_eq!(context_for_word("bank", "bank", 0), "");
        assert!(
            context_for_word(&format!("bank {}", "中".repeat(1000)), "bank", 0)
                .chars()
                .count()
                <= 800
        );
    }

    #[test]
    fn repeated_words_use_the_sentence_of_the_pointed_occurrence() {
        let text = "The bank lends money. He sat on the bank.";
        assert_eq!(context_for_word(text, "bank", 35), "He sat on the bank.");
    }

    #[test]
    fn input_or_foreground_change_rearms_lookup_without_pointer_movement() {
        let mut tracker = HoverTracker::default();
        assert!(!tracker.on_input((10, 1)));
        assert!(!tracker.tick((100, 50), 0, 500));
        assert!(tracker.tick((100, 50), 500, 500));
        assert!(tracker.on_input((20, 1)));
        assert!(!tracker.tick((100, 50), 600, 500));
        assert!(tracker.tick((100, 50), 1100, 500));
        assert!(tracker.on_input((20, 2)));
        assert!(!tracker.tick((100, 50), 1200, 500));
        assert!(tracker.tick((100, 50), 1700, 500));
    }
}
