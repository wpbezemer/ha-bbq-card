# BBQ Card

A custom Lovelace card for Home Assistant to monitor BBQ and probe temperatures with a beautiful round gauge.

![BBQ Card Preview](https://raw.githubusercontent.com/YOUR_USERNAME/bbq-card/main/preview.png)

## Features

- 🌡️ Round gauge with draggable min/max temperature markers
- 📏 Two sizes: `large` (ambient/BBQ) and `small` (probes)
- 🔥 On/Off monitoring button
- 🔔 Snooze button with configurable duration
- 🎯 Preset system — define target temperatures per meat/fish type
- 🌍 Celsius and Fahrenheit support
- ⚙️ Configurable step size for marker dragging
- 🎨 Visual editor in Home Assistant UI (no YAML required)
- 📴 Offline/disconnected sensor detection

---

## Installation

### Via HACS (recommended)

1. Open HACS in Home Assistant
2. Go to **Frontend**
3. Click **+ Explore & Download Repositories**
4. Search for **BBQ Card**
5. Click **Download**
6. Restart Home Assistant
7. Clear browser cache (Ctrl+Shift+R)

### Manual

1. Download `bbq-card.js` from the [latest release](https://github.com/YOUR_USERNAME/bbq-card/releases/latest)
2. Copy it to `/config/www/bbq-card.js`
3. Go to **Settings → Dashboards → ⋮ → Resources**
4. Add `/local/bbq-card.js` as a **JavaScript module**
5. Restart Home Assistant and clear browser cache

---

## Required Helpers

Create these helpers in **Settings → Helpers** for each gauge:

**For the ambient/BBQ gauge:**
```yaml
input_number:
  bbq_min_temp:
    name: BBQ Minimum Temperature
    min: 0
    max: 350
    step: 5
    initial: 100
    unit_of_measurement: "°C"

  bbq_max_temp:
    name: BBQ Maximum Temperature
    min: 0
    max: 350
    step: 5
    initial: 250
    unit_of_measurement: "°C"

input_boolean:
  bbq_monitoring:
    name: BBQ Monitoring

  bbq_snooze:
    name: BBQ Snooze
```

**For each probe** (repeat with unique names, e.g. `probe1_`, `probe2_`):
```yaml
input_number:
  probe1_min_temp:
    min: 0
    max: 100
    step: 1
    initial: 55

  probe1_max_temp:
    min: 0
    max: 100
    step: 1
    initial: 65

input_boolean:
  probe1_monitoring:
    name: Probe 1 Monitoring

  probe1_snooze:
    name: Probe 1 Snooze
```

---

## Configuration

### Basic (large, ambient gauge)

```yaml
type: custom:bbq-card
name: BBQ Ambient
temp_entity: sensor.bbq_temperature
min_entity: input_number.bbq_min_temp
max_entity: input_number.bbq_max_temp
onoff_entity: input_boolean.bbq_monitoring
snooze_entity: input_boolean.bbq_snooze
abs_min: 0
abs_max: 350
```

### Small probe gauge with presets

```yaml
type: custom:bbq-card
name: Probe 1 — Ribeye
size: small
show_preset: true
temp_entity: sensor.probe1_temperature
min_entity: input_number.probe1_min_temp
max_entity: input_number.probe1_max_temp
onoff_entity: input_boolean.probe1_monitoring
snooze_entity: input_boolean.probe1_snooze
abs_min: 0
abs_max: 100
step: 1
unit: C
presets:
  - category: Beef
    name: Rare
    min: 49
    max: 54
  - category: Beef
    name: Medium rare
    min: 55
    max: 59
  - category: Beef
    name: Medium
    min: 60
    max: 65
  - category: Beef
    name: Well done
    min: 70
    max: 75
  - category: Pork
    name: Pulled pork
    min: 88
    max: 95
  - category: Chicken
    name: Whole chicken
    min: 74
    max: 80
  - category: Fish
    name: Salmon
    min: 50
    max: 55
```

### All configuration options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | `BBQ Monitor` | Card title |
| `size` | `large` \| `small` | `large` | Gauge size |
| `temp_entity` | string | **required** | Temperature sensor entity |
| `min_entity` | string | — | input_number entity for minimum temperature |
| `max_entity` | string | — | input_number entity for maximum temperature |
| `onoff_entity` | string | — | input_boolean entity for on/off monitoring |
| `snooze_entity` | string | — | input_boolean entity for snooze |
| `abs_min` | number | `0` | Absolute minimum (°C, gauge range start) |
| `abs_max` | number | `350` | Absolute maximum (°C, gauge range end) |
| `step` | number | `5` | Degrees per drag step |
| `unit` | `C` \| `F` | `C` | Display unit (stored values always in °C) |
| `show_preset` | boolean | `false` | Show preset dropdown below gauge |
| `presets` | list | `[]` | List of temperature presets (always in °C) |

### Preset options

| Option | Type | Description |
|--------|------|-------------|
| `category` | string | Group name (e.g. `Beef`, `Fish`) |
| `name` | string | Preset name (e.g. `Medium rare`) |
| `min` | number | Minimum temperature in °C |
| `max` | number | Maximum temperature in °C |

---

## Notification Automation (Telegram example)

```yaml
automation:
  - alias: "BBQ - Temperature alert"
    trigger:
      - platform: state
        entity_id: sensor.bbq_temperature
    condition:
      - condition: state
        entity_id: input_boolean.bbq_monitoring
        state: "on"
      - condition: state
        entity_id: input_boolean.bbq_snooze
        state: "off"
    action:
      - choose:
          - conditions:
              - condition: template
                value_template: >
                  {{ states('sensor.bbq_temperature') | float
                     < states('input_number.bbq_min_temp') | float }}
            sequence:
              - service: telegram_bot.send_message
                data:
                  target: !secret telegram_chat_id
                  message: >
                    🥶 BBQ too cold!
                    Current: {{ states('sensor.bbq_temperature') }}°C
                    Minimum: {{ states('input_number.bbq_min_temp') }}°C
          - conditions:
              - condition: template
                value_template: >
                  {{ states('sensor.bbq_temperature') | float
                     > states('input_number.bbq_max_temp') | float }}
            sequence:
              - service: telegram_bot.send_message
                data:
                  target: !secret telegram_chat_id
                  message: >
                    🔥 BBQ too hot!
                    Current: {{ states('sensor.bbq_temperature') }}°C
                    Maximum: {{ states('input_number.bbq_max_temp') }}°C

  - alias: "BBQ - Auto disable snooze"
    trigger:
      - platform: state
        entity_id: input_boolean.bbq_snooze
        to: "on"
    action:
      - delay:
          minutes: 30
      - service: input_boolean.turn_off
        target:
          entity_id: input_boolean.bbq_snooze
```

---

## Dashboard layout example (1 large + 4 small)

```yaml
type: vertical-stack
cards:
  - type: custom:bbq-card
    name: BBQ Ambient
    size: large
    temp_entity: sensor.bbq_ambient_temp
    min_entity: input_number.bbq_min_temp
    max_entity: input_number.bbq_max_temp
    onoff_entity: input_boolean.bbq_monitoring
    snooze_entity: input_boolean.bbq_snooze
    abs_min: 0
    abs_max: 350

  - type: horizontal-stack
    cards:
      - type: custom:bbq-card
        name: Probe 1
        size: small
        show_preset: true
        temp_entity: sensor.probe1_temp
        min_entity: input_number.probe1_min
        max_entity: input_number.probe1_max
        onoff_entity: input_boolean.probe1_monitoring
        snooze_entity: input_boolean.probe1_snooze
        abs_min: 0
        abs_max: 100
        step: 1

      - type: custom:bbq-card
        name: Probe 2
        size: small
        show_preset: true
        temp_entity: sensor.probe2_temp
        min_entity: input_number.probe2_min
        max_entity: input_number.probe2_max
        onoff_entity: input_boolean.probe2_monitoring
        snooze_entity: input_boolean.probe2_snooze
        abs_min: 0
        abs_max: 100
        step: 1
```

---

## Contributing

Pull requests are welcome! Please open an issue first to discuss what you would like to change.

## License

MIT License — see [LICENSE](LICENSE) for details.
