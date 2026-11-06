# Custom Changelog

## 0.2 - 2026-11-06

### Added

- Merge st-chatu8 prompt snapshots with same-name NAI Preset Switcher records in a single manual import.
- Resolve per-preset NovelAI parameters using the switcher's own-parameters, named/default group, and legacy fallback rules.
- Copy supported embedded NAI cover images into ST-iPhonie's own tavern image files; imported covers survive removal of the source plugins.
- Show parameter/cover availability and ambiguous names or unsupported cover formats in the import preview.
- Archive NAI records and parameter groups in `draw.naiSwitcherSnapshot`, without duplicating cover image bytes.

### Fixed

- Import model, steps, CFG, rescale, sampler, schedule, supported negative preset names, Variety+, SMEA and Decrisper into each matching local style.
- Overwrite selected styles' supplied parameters and covers, preserving missing fields, local IDs, groups and selection.
- Prevent duplicate submissions while images upload; reject stale settings writes and clean up newly uploaded files after failures.

### Scope

- Based on custom 0.1; the original 0.1 files and archive are preserved.
- Reads both source plugins once and never writes to either plugin. Matching NAI names ignore surrounding whitespace; ambiguous matches import chatu8 words only.
- Width, height, seed and transparency remain outside the existing per-style parameter contract. Original values remain in the NAI snapshot; API connections, Vibe bindings and random switches are not applied.
- Model-specific features and parameter ranges follow ST-iPhonie's existing normalization and generation safeguards. Arbitrary custom negative-preset text is archived, not converted into a built-in preset.

## 0.1 - 2026-11-05

### Added

- Import a one-time snapshot of all st-chatu8 artist presets from Settings or Drawing > Styles.
- Choose individual same-name styles to overwrite, or overwrite all; unchecked matches are skipped.
- Store the complete source preset snapshot in this plugin's settings. Imported styles can be edited, copied, grouped or deleted independently.
- Add an editable positive postfix and preserve it after scene prompts in drawing, story images, style samples, character tests and sprites.

### Changed

- Preserve full artist preset names and prompt strings instead of truncating them during normalization.
- Strip full-width parenthetical annotations from imported fixed prompts at generation time, keeping the original text in settings.
- Match imported styles to album pictures using their cleaned artist tags, and keep picture-book art overrides independent of the current style's postfix.
- Overwriting changes only prompt fields; local IDs, groups, covers, generation parameters and selection remain intact.

### Scope

- Based on ST-iPhonie 0.9.28. This customization is versioned separately as 0.1.
- No background synchronization or writes to st-chatu8. API settings, backend quality presets, random selection and source preview images are not imported into active drawing settings.
