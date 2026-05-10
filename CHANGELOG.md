# Changelog

All notable changes to BBQ Card will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-05-10

### Added
- Round gauge with draggable min/max temperature markers
- `size: large` and `size: small` with full scaling
- On/Off and Snooze buttons
- Preset system with category grouping (configurable via YAML)
- Celsius and Fahrenheit display support (stored values always in °C)
- Configurable step size for marker dragging
- Visual editor with entity dropdowns (type or pick)
- Offline/disconnected sensor detection with "Offline" indicator
- 1 decimal precision for temperature display
- Marker label visibility fix (top labels no longer clipped)
- Markers work correctly after dashboard edit → Done
- Min marker never jumps when dragged below abs_min
- Closest marker selected when both are near each other
