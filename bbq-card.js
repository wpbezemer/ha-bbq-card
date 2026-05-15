// ─────────────────────────────────────────────────────────────
//  BBQ Card  v13
//  - Setpoint mode: single draggable target marker
//  - Min/Max mode: original two-marker behaviour (default)
//  - Buttons setting: both / onoff / snooze / none
//  Resource: /local/bbq-card.js?v=13
// ─────────────────────────────────────────────────────────────

const SIZES = {
  large: { cs:320, cr:118, fontSize:62, unitSize:16, titleSize:13, rangeSize:13, btnSize:52, iconSize:30, dotSize:7 },
  small: { cs:210, cr:76,  fontSize:40, unitSize:11, titleSize:11, rangeSize:10, btnSize:38, iconSize:20, dotSize:5 },
};

function geo(cr) {
  return { tickR:cr-4, markerR:cr-9, handleR:cr-4, labelR:cr+16, innerR:cr-28 };
}

const ARC_START  = 135;
const ARC_END    = 405;
const DEAD_START = 45;
const DEAD_END   = 135;

function d2r(d) { return d * Math.PI / 180; }
function pt(deg, r, cx, cy) {
  return { x: cx + Math.cos(d2r(deg)) * r, y: cy + Math.sin(d2r(deg)) * r };
}
function toF(c) { return Math.round(c * 9/5 + 32); }
function toC(f) { return Math.round((f - 32) * 5/9); }


class BBQCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config    = {};
    this._hass      = null;
    this._drag      = null;
    this._canvas    = null;
    this._ctx       = null;
    this._boundMove = this._onMove.bind(this);
    this._boundUp   = this._onUp.bind(this);
  }

  static getConfigElement() { return document.createElement('bbq-card-editor'); }

  static getStubConfig() {
    return {
      name:'BBQ Monitor', size:'large', show_preset:false,
      mode:'minmax', buttons:'both',
      temp_entity:'sensor.bbq_temperatuur',
      min_entity:'input_number.bbq_min_temp',
      max_entity:'input_number.bbq_max_temp',
      target_entity:'input_number.bbq_target_temp',
      onoff_entity:'input_boolean.bbq_monitoring',
      snooze_entity:'input_boolean.bbq_snooze',
      abs_min:0, abs_max:350, step:5, unit:'C', presets:[],
    };
  }

  setConfig(config) {
    if (!config.temp_entity) throw new Error('temp_entity is required');
    this._config = {
      abs_min:0, abs_max:350, name:'BBQ Monitor',
      size:'large', show_preset:false, step:5, unit:'C', presets:[],
      mode:'minmax', buttons:'both',
      ...config,
    };
    this._render();
  }

  set hass(hass) { this._hass = hass; this._updateValues(); }
  connectedCallback()    { this._attachGlobal(); }
  disconnectedCallback() { this._detachGlobal(); }
  getCardSize()          { return this._config.size === 'small' ? 3 : 4; }

  _attachGlobal() {
    document.addEventListener('mousemove', this._boundMove);
    document.addEventListener('mouseup',   this._boundUp);
    document.addEventListener('touchmove', this._boundMove, { passive:false });
    document.addEventListener('touchend',  this._boundUp);
  }
  _detachGlobal() {
    document.removeEventListener('mousemove', this._boundMove);
    document.removeEventListener('mouseup',   this._boundUp);
    document.removeEventListener('touchmove', this._boundMove);
    document.removeEventListener('touchend',  this._boundUp);
  }

  _sz()    { return SIZES[this._config.size] || SIZES.large; }
  _geo()   { return geo(this._sz().cr); }
  _cx()    { return this._sz().cs / 2; }
  _cy()    { return this._sz().cs / 2; }
  _isFah() { return (this._config.unit||'C').toUpperCase() === 'F'; }
  _isSetpoint() { return (this._config.mode||'minmax') === 'setpoint'; }
  _showOnoff()  { const b = this._config.buttons||'both'; return b==='both' || b==='onoff'; }
  _showSnooze() { const b = this._config.buttons||'both'; return b==='both' || b==='snooze'; }
  _step()  { return parseFloat(this._config.step) || 5; }
  _disp(c) {
    if (this._isFah()) return toF(c);
    // 1 decimal, but strip trailing .0 only if it's a whole number from rounding
    const val = Math.round(c * 10) / 10;
    return val % 1 === 0 ? val.toFixed(1) : val.toString();
  }
  _store(v){ return this._isFah() ? toC(v) : Math.round(v); }

  _num(entity, fallback) {
    if (!this._hass || !entity) return fallback;
    const s = this._hass.states[entity];
    if (!s) return fallback;
    const v = parseFloat(s.state);
    // Return fallback for unavailable/unknown/disconnected text states
    return isNaN(v) ? fallback : v;
  }
  _bool(entity, fallback=false) {
    if (!this._hass || !entity) return fallback;
    const s = this._hass.states[entity];
    return s ? s.state === 'on' : fallback;
  }
  _call(domain, service, entity, data={}) {
    if (!this._hass) return;
    this._hass.callService(domain, service, { entity_id:entity, ...data });
  }

  _valToDeg(v) {
    const { abs_min:mn, abs_max:mx } = this._config;
    return ARC_START + ((v - mn) / (mx - mn)) * 270;
  }
  _degToVal(d) {
    const { abs_min:mn, abs_max:mx } = this._config;
    const step = this._step();
    return Math.round(((d - ARC_START) / 270 * (mx - mn) + mn) / step) * step;
  }

  _ptrDeg(px, py) {
    const card = this.shadowRoot && this.shadowRoot.getElementById('card');
    if (!card) return { deg:0, inDead:true };
    const rect = card.getBoundingClientRect();
    const cx   = rect.left + rect.width/2;
    const cy   = rect.top  + rect.height/2;
    let deg    = Math.atan2(py-cy, px-cx) * 180/Math.PI;
    if (deg < 0) deg += 360;
    return { deg, inDead: deg >= DEAD_START && deg < DEAD_END };
  }
  _toArc(deg) { return deg < ARC_START ? deg + 360 : deg; }

  _hitMarker(px, py) {
    const card = this.shadowRoot && this.shadowRoot.getElementById('card');
    if (!card) return null;
    const sz    = this._sz();
    const g     = this._geo();
    const rect  = card.getBoundingClientRect();
    const scale = rect.width / sz.cs;
    const cx    = rect.left + rect.width/2;
    const cy    = rect.top  + rect.height/2;
    const CX    = this._cx(), CY = this._cy();
    const hits  = [];
    for (const which of ['min','max']) {
      const val = which === 'max'
        ? this._num(this._config.max_entity, this._config.abs_max)
        : this._num(this._config.min_entity, this._config.abs_min);
      const p  = pt(this._valToDeg(val), g.handleR, CX, CY);
      const sx = cx + (p.x - CX) * scale;
      const sy = cy + (p.y - CY) * scale;
      const d  = Math.hypot(px-sx, py-sy);
      if (d < 28) hits.push({ which, d });
    }
    if (!hits.length) return null;
    hits.sort((a,b) => a.d - b.d);
    return hits[0].which;
  }

  _applyPreset(preset) {
    if (!preset) return;
    this._call('input_number', 'set_value', this._config.min_entity, { value:preset.min });
    this._call('input_number', 'set_value', this._config.max_entity, { value:preset.max });
    const mn = this.shadowRoot.getElementById('vmn');
    const mx = this.shadowRoot.getElementById('vmx');
    if (mn) mn.textContent = this._disp(preset.min);
    if (mx) mx.textContent = this._disp(preset.max);
    const current = this._num(this._config.temp_entity, null);
    this._draw(current, preset.min, preset.max, this._bool(this._config.onoff_entity));
  }

  _buildPresetOptions() {
    const presets = this._config.presets || [];
    if (!presets.length) return '<option value="">— geen presets —</option>';
    const groups = {};
    presets.forEach(p => {
      const cat = p.category || 'Overig';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    return '<option value="">— kies preset —</option>' +
      Object.entries(groups).map(([cat, items]) =>
        `<optgroup label="${cat}">${items.map(p => {
          const mn = this._isFah() ? toF(p.min) : p.min;
          const mx = this._isFah() ? toF(p.max) : p.max;
          return `<option value="${cat}__${p.name}">${p.name} (${mn}–${mx}°${this._isFah()?'F':'C'})</option>`;
        }).join('')}</optgroup>`
      ).join('');
  }

  _render() {
    this._detachGlobal();
    const sz  = this._sz();
    const cs  = sz.cs;
    const cr  = sz.cr;
    const cfg = this._config;
    const unitLabel = this._isFah() ? '°F' : '°C';

    // The canvas is cs×cs but the visible circle only reaches cr from center.
    // We add labelPad at the top so marker labels at labelR = cr+16 are visible.
    // Bottom stays flush to keep stacked cards tight.
    const labelPad     = geo(sz.cr).labelR - sz.cr + Math.round(sz.cr * 0.28);  // scales with size
    const circleTop    = Math.floor((cs / 2) - sz.cr);
    const circleBot    = Math.ceil((cs / 2) + sz.cr);
    const clipTop      = Math.max(0, circleTop - labelPad);  // expanded upward
    const clipHeight   = circleBot - clipTop;                // taller at top only

    const presetFontSz = Math.max(10, Math.round(sz.titleSize * 0.95));
    const presetWidth  = Math.round(cs * 0.72);

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        * { box-sizing:border-box; margin:0; padding:0; }

        /* Outer stacks circle + preset with zero gap */
        .outer {
          display:flex;
          flex-direction:column;
          align-items:center;
          padding:0;
          gap:0;
        }

        /*
         * card-clip: the visible window onto the canvas.
         * Width = full canvas, height = circle diameter only.
         * overflow:hidden clips the canvas top/bottom corners.
         * This removes all dead space between stacked gauges.
         */
        .card-clip {
          width:${cs}px;
          height:${clipHeight}px;
          overflow:hidden;
          position:relative;
          display:flex;
          align-items:center;
          justify-content:center;
          background:transparent;
        }

        /* card is full canvas size, shifted so circle + label area aligns in clip */
        .card {
          position:absolute;
          top:${-clipTop}px;
          left:0;
          width:${cs}px;
          height:${cs}px;
          display:flex;
          align-items:center;
          justify-content:center;
        }

        canvas {
          position:absolute; top:0; left:0;
          width:${cs}px; height:${cs}px;
        }

        /* Center content inside circle */
        .center {
          position:relative; z-index:2;
          display:flex; flex-direction:column; align-items:center; gap:2px;
          pointer-events:none;
          max-width:${Math.round(cs*0.58)}px;
        }

        .title {
          font-family:sans-serif; font-size:${sz.titleSize}px;
          color:rgba(255,255,255,0.4); letter-spacing:.5px;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;
        }
        .temp-row { display:flex; align-items:flex-start; line-height:1; }
        .temp-big {
          font-family:sans-serif; font-size:${sz.fontSize}px;
          font-weight:300; color:#fff; letter-spacing:-3px; transition:color .4s;
        }
        .temp-unit {
          font-family:sans-serif; font-size:${sz.unitSize}px;
          color:rgba(255,255,255,0.5);
          margin-top:${Math.round(sz.fontSize*.15)}px; margin-left:2px;
        }
        .range-row { display:flex; align-items:center; gap:8px; margin:2px 0 6px; }
        .rblock { display:flex; align-items:center; gap:4px; }
        .rdot { width:${sz.dotSize}px; height:${sz.dotSize}px; border-radius:50%; flex-shrink:0; }
        .rdot.mn { background:#5ab4e8; }
        .rdot.mx { background:#E8873A; }
        .rval { font-family:sans-serif; font-size:${sz.rangeSize}px; font-weight:500; }
        .rval.mn { color:#5ab4e8; }
        .rval.mx { color:#E8873A; }
        .rsep { font-family:sans-serif; font-size:${Math.round(sz.rangeSize*.85)}px; color:rgba(255,255,255,0.2); }
        .runit { font-family:sans-serif; font-size:${Math.round(sz.rangeSize*.8)}px; color:rgba(255,255,255,0.3); }
        .btn-row { display:flex; gap:${sz.btnSize<45?16:24}px; margin-top:2px; pointer-events:all; }
        .ibtn {
          width:${sz.btnSize}px; height:${sz.btnSize}px;
          border-radius:50%; border:none; cursor:pointer;
          display:flex; align-items:center; justify-content:center;
          background:rgba(255,255,255,0.07); transition:background .2s;
        }
        .ibtn.on-flame  { background:rgba(232,135,58,0.3); }
        .ibtn.on-snooze { background:rgba(255,200,50,0.2); }
        .ibtn svg { width:${sz.iconSize}px; height:${sz.iconSize}px; }

        /* Preset below circle — simple centered row */
        .preset-wrap {
          display:flex;
          justify-content:center;
          width:${cs}px;
          padding:4px 0 2px;
        }
        .preset-wrap select {
          width:${presetWidth}px;
          padding:5px 10px;
          border-radius:8px;
          border:1px solid rgba(255,255,255,0.15);
          background:rgba(20,20,36,0.92);
          color:#fff;
          font-size:${presetFontSz}px;
          font-family:sans-serif;
          cursor:pointer;
        }
        .preset-wrap select option   { background:#1a1a2e; color:#fff; }
        .preset-wrap select optgroup { background:#12121f; color:rgba(255,255,255,0.5); }
      </style>

      <div class="outer">
        <div class="card-clip" id="card-clip">
          <div class="card" id="card">
            <canvas id="gauge"></canvas>
            <div class="center">
              <div class="title" id="ttl">${cfg.name||'BBQ Monitor'}</div>
              <div class="temp-row">
                <span class="temp-big" id="tv">--</span>
                <span class="temp-unit">${unitLabel}</span>
              </div>
              <div class="range-row">
                <div class="rblock"><div class="rdot mn" id="rdot-mn"></div><span class="rval mn" id="vmn">--</span><span class="runit">${unitLabel}</span></div>
                <span class="rsep" id="rsep">—</span>
                <div class="rblock" id="rblock-max"><div class="rdot mx"></div><span class="rval mx" id="vmx">--</span><span class="runit">${unitLabel}</span></div>
              </div>
              ${(cfg.buttons||'both') !== 'none' ? `
              <div class="btn-row">
                ${(cfg.buttons||'both') === 'both' || (cfg.buttons||'both') === 'onoff' ? `
                <button class="ibtn" id="fb" title="On/Off">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 2C12 2 7 7 7 13C7 15.76 9.24 18 12 18C14.76 18 17 15.76 17 13C17 10 15 8 15 8C15 8 14 11 12 11C10 11 10 9 10 9C10 9 12 7 12 2Z" fill="#E8873A"/>
                    <path d="M12 18C12 18 10 20 10 21.5C10 22.33 10.67 23 11.5 23H12.5C13.33 23 14 22.33 14 21.5C14 20 12 18 12 18Z" fill="#E8873A" opacity="0.5"/>
                  </svg>
                </button>` : ''}
                ${(cfg.buttons||'both') === 'both' || (cfg.buttons||'both') === 'snooze' ? `
                <button class="ibtn" id="sb" title="Snooze">
                  <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.8" stroke-linecap="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    <path d="M5 3L3 5M19 3L21 5" stroke-width="2"/>
                  </svg>
                </button>` : ''}
              </div>` : ''}
            </div>
          </div>
        </div>

        ${cfg.show_preset ? `
        <div class="preset-wrap">
          <select id="preset-sel">${this._buildPresetOptions()}</select>
        </div>` : ''}
      </div>`;

    this._canvas = this.shadowRoot.getElementById('gauge');
    this._ctx    = this._canvas.getContext('2d');

    // Preset
    const sel = this.shadowRoot.getElementById('preset-sel');
    if (sel) {
      sel.addEventListener('change', (e) => {
        const val = e.target.value;
        if (!val) return;
        const [cat, name] = val.split('__');
        const preset = (this._config.presets||[]).find(p =>
          (p.category||'Overig') === cat && p.name === name);
        if (preset) this._applyPreset(preset);
      });
    }

    // Drag — attached to card-clip so hit-test uses correct coordinates
    const clip = this.shadowRoot.getElementById('card-clip');
    clip.addEventListener('mousedown',  this._onDown.bind(this));
    clip.addEventListener('touchstart', this._onDown.bind(this), { passive:false });

    // Buttons
    const fbEl = this.shadowRoot.getElementById('fb');
    const sbEl = this.shadowRoot.getElementById('sb');
    if (fbEl) fbEl.addEventListener('click', () => {
      this._call('input_boolean', this._bool(cfg.onoff_entity)?'turn_off':'turn_on', cfg.onoff_entity);
    });
    if (sbEl) sbEl.addEventListener('click', () => {
      this._call('input_boolean', this._bool(cfg.snooze_entity)?'turn_off':'turn_on', cfg.snooze_entity);
    });

    this._attachGlobal();
  }

  _onDown(e) {
    const px  = e.touches ? e.touches[0].clientX : e.clientX;
    const py  = e.touches ? e.touches[0].clientY : e.clientY;
    const hit = this._hitMarker(px, py);
    if (hit) { e.preventDefault(); this._drag = hit; }
  }

  _onMove(e) {
    if (!this._drag) return;
    e.preventDefault();
    const px = e.touches ? e.touches[0].clientX : e.clientX;
    const py = e.touches ? e.touches[0].clientY : e.clientY;
    const { deg, inDead } = this._ptrDeg(px, py);
    if (inDead) return;

    const { abs_min:mn, abs_max:mx } = this._config;
    const arcDeg = Math.max(ARC_START, Math.min(ARC_END, this._toArc(deg)));
    const nv     = Math.max(mn, Math.min(mx, this._degToVal(arcDeg)));

    if (this._drag === 'target') {
      this._call('input_number', 'set_value', this._config.target_entity, { value:nv });
      const el = this.shadowRoot.getElementById('vmn');
      if (el) el.textContent = this._disp(nv);
      this._draw(this._num(this._config.temp_entity, null), nv, null, this._bool(this._config.onoff_entity));
    } else {
      const curMin = this._num(this._config.min_entity, mn);
      const curMax = this._num(this._config.max_entity, mx);
      const step   = this._step();
      if (this._drag === 'max') {
        const v = Math.max(curMin + step, nv);
        this._call('input_number', 'set_value', this._config.max_entity, { value:v });
        const el = this.shadowRoot.getElementById('vmx');
        if (el) el.textContent = this._disp(v);
        this._draw(this._num(this._config.temp_entity, null), curMin, v, this._bool(this._config.onoff_entity));
      } else {
        const v = Math.max(mn, Math.min(curMax - step, nv));
        this._call('input_number', 'set_value', this._config.min_entity, { value:v });
        const el = this.shadowRoot.getElementById('vmn');
        if (el) el.textContent = this._disp(v);
        this._draw(this._num(this._config.temp_entity, null), v, curMax, this._bool(this._config.onoff_entity));
      }
    }
  }

  _onUp() { this._drag = null; }

  _hitMarker(px, py) {
    const clip = this.shadowRoot && this.shadowRoot.getElementById('card-clip');
    if (!clip) return null;
    const sz       = this._sz();
    const g        = this._geo();
    const rect     = clip.getBoundingClientRect();
    const labelPad = geo(sz.cr).labelR - sz.cr + Math.round(sz.cr * 0.28);
    const circleTop= Math.floor(sz.cs/2 - sz.cr);
    const clipTop  = Math.max(0, circleTop - labelPad);
    const scale    = rect.width / sz.cs;
    const cx       = rect.left + sz.cs/2;
    const cy       = rect.top  - clipTop + sz.cs/2;
    const CX       = this._cx(), CY = this._cy();

    if (this._isSetpoint()) {
      const val = this._num(this._config.target_entity, this._config.abs_min);
      const p   = pt(this._valToDeg(val), g.handleR, CX, CY);
      const sx  = cx + (p.x - CX) * scale;
      const sy  = cy + (p.y - CY) * scale;
      return Math.hypot(px-sx, py-sy) < 28 ? 'target' : null;
    }

    const hits = [];
    for (const which of ['min','max']) {
      const val = which === 'max'
        ? this._num(this._config.max_entity, this._config.abs_max)
        : this._num(this._config.min_entity, this._config.abs_min);
      const p  = pt(this._valToDeg(val), g.handleR, CX, CY);
      const sx = cx + (p.x - CX) * scale;
      const sy = cy + (p.y - CY) * scale;
      const d  = Math.hypot(px-sx, py-sy);
      if (d < 28) hits.push({ which, d });
    }
    if (!hits.length) return null;
    hits.sort((a,b) => a.d - b.d);
    return hits[0].which;
  }

  // _ptrDeg also uses card-clip rect
  _ptrDeg(px, py) {
    const clip = this.shadowRoot && this.shadowRoot.getElementById('card-clip');
    if (!clip) return { deg:0, inDead:true };
    const sz         = this._sz();
    const rect       = clip.getBoundingClientRect();
    const labelPad   = geo(sz.cr).labelR - sz.cr + Math.round(sz.cr * 0.28);
    const circleTop  = Math.floor(sz.cs/2 - sz.cr);
    const clipTop    = Math.max(0, circleTop - labelPad);
    const cx         = rect.left + sz.cs/2;
    const cy         = rect.top  - clipTop + sz.cs/2;
    let deg          = Math.atan2(py-cy, px-cx) * 180/Math.PI;
    if (deg < 0) deg += 360;
    return { deg, inDead: deg >= DEAD_START && deg < DEAD_END };
  }

  _updateValues() {
    if (!this._hass) return;
    const cfg     = this._config;
    const current = this._num(cfg.temp_entity, null);
    const isOn    = this._bool(cfg.onoff_entity);
    const snzd    = this._bool(cfg.snooze_entity);
    const el      = (id) => this.shadowRoot.getElementById(id);

    if (el('ttl')) el('ttl').textContent = cfg.name || 'BBQ Monitor';
    if (el('tv')) {
      if (current !== null) {
        el('tv').textContent    = this._disp(current);
        el('tv').style.opacity  = '1';
        const unit = this.shadowRoot.querySelector('.temp-unit');
        if (unit) unit.style.display = '';
      } else {
        el('tv').textContent    = 'Offline';
        el('tv').style.opacity  = '0.4';
        const unit = this.shadowRoot.querySelector('.temp-unit');
        if (unit) unit.style.display = 'none';
      }
    }
    if (el('fb')) el('fb').className = 'ibtn' + (isOn ? ' on-flame'  : '');
    if (el('sb')) el('sb').className = 'ibtn' + (snzd ? ' on-snooze' : '');

    if (this._isSetpoint()) {
      const target = this._num(cfg.target_entity, cfg.abs_min);
      if (el('vmn')) el('vmn').textContent = this._disp(target);
      if (el('rsep'))       el('rsep').style.display       = 'none';
      if (el('rblock-max')) el('rblock-max').style.display = 'none';
      // dot en label oranje kleur
      const dot  = this.shadowRoot.querySelector('#rdot-mn');
      if (dot)  { dot.classList.remove('mn'); dot.classList.add('mx'); }
      const rval = this.shadowRoot.querySelector('.rval.mn');
      if (rval) { rval.classList.remove('mn'); rval.classList.add('mx'); }

      let col = '#fff';
      if (current === null) col = 'rgba(255,255,255,0.3)';
      else if (isOn) col = current >= target ? '#E8873A' : '#5ab4e8';
      if (el('tv')) el('tv').style.color = col;
      this._draw(current, target, null, isOn);
    } else {
      const min = this._num(cfg.min_entity, cfg.abs_min);
      const max = this._num(cfg.max_entity, cfg.abs_max);
      if (el('vmn')) el('vmn').textContent = this._disp(min);
      if (el('vmx')) el('vmx').textContent = this._disp(max);
      if (el('rsep'))       el('rsep').style.display       = '';
      if (el('rblock-max')) el('rblock-max').style.display = '';

      let col = '#fff';
      if (current === null)     col = 'rgba(255,255,255,0.3)';
      else if (isOn) {
        if (current < min)      col = '#5ab4e8';
        else if (current > max) col = '#e84632';
        else                    col = '#E8873A';
      }
      if (el('tv')) el('tv').style.color = col;
      this._draw(current, min, max, isOn);
    }
  }

  _draw(current, min, max, isOn) {
    if (!this._canvas || !this._ctx) return;
    const ctx = this._ctx;
    const sz  = this._sz();
    const cs  = sz.cs, cr = sz.cr;
    const CX  = this._cx(), CY = this._cy();
    const g   = this._geo();
    const { abs_min:amn, abs_max:amx } = this._config;
    const setpointMode = max === null;

    this._canvas.width = this._canvas.height = cs;
    ctx.clearRect(0,0,cs,cs);

    ctx.beginPath(); ctx.arc(CX,CY,cr,0,Math.PI*2);
    ctx.fillStyle='#12121f'; ctx.fill();
    ctx.beginPath(); ctx.arc(CX,CY,cr-1,0,Math.PI*2);
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=2; ctx.stroke();

    for (let i=0; i<=60; i++) {
      const f=i/60, deg=ARC_START+f*270, rad=d2r(deg), maj=i%5===0;
      const tl=maj?Math.round(cr*0.08):Math.round(cr*0.04);
      const x1=CX+Math.cos(rad)*g.tickR,        y1=CY+Math.sin(rad)*g.tickR;
      const x2=CX+Math.cos(rad)*(g.tickR-tl),   y2=CY+Math.sin(rad)*(g.tickR-tl);
      const vh=amn+f*(amx-amn);
      let col='rgba(255,255,255,0.1)';
      if (current!==null && vh<=current) {
        if (!isOn)                    col='rgba(255,255,255,0.15)';
        else if (setpointMode)        col = current >= min ? 'rgba(232,135,58,0.85)' : 'rgba(90,180,232,0.75)';
        else if (current<min)         col='rgba(90,180,232,0.75)';
        else if (current>max)         col='rgba(232,70,50,0.85)';
        else                          col='rgba(232,135,58,0.85)';
      }
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
      ctx.strokeStyle=col; ctx.lineWidth=maj?2:1; ctx.lineCap='round'; ctx.stroke();
    }

    if (setpointMode) {
      this._drawMarker(ctx, min, '#E8873A', CX, CY, g, sz);
    } else {
      this._drawMarker(ctx, min, '#5ab4e8', CX, CY, g, sz);
      this._drawMarker(ctx, max, '#E8873A', CX, CY, g, sz);
    }

    ctx.beginPath(); ctx.arc(CX,CY,g.innerR,0,Math.PI*2);
    ctx.fillStyle='#12121f'; ctx.fill();
  }

  _drawMarker(ctx, val, color, CX, CY, g, sz) {
    const deg = this._valToDeg(val);
    const rad = d2r(deg);
    const lSz = Math.max(9, Math.round(sz.cs*0.034));

    ctx.beginPath();
    ctx.arc(CX,CY,g.markerR,rad-0.08,rad+0.08);
    ctx.strokeStyle=color; ctx.lineWidth=sz.cs<250?4:6; ctx.lineCap='round'; ctx.stroke();

    const h=pt(deg,g.handleR,CX,CY);
    ctx.beginPath(); ctx.arc(h.x,h.y,sz.cs<250?4:5,0,Math.PI*2);
    ctx.fillStyle=color; ctx.fill();

    const l=pt(deg,g.labelR,CX,CY);
    const label=this._disp(val)+'°';
    ctx.font=`bold ${lSz}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.lineWidth=3; ctx.lineJoin='round';
    ctx.strokeText(label,l.x,l.y);
    ctx.fillStyle=color; ctx.fillText(label,l.x,l.y);
  }
}

customElements.define('bbq-card', BBQCard);


// ─────────────────────────────────────────────────────────────
//  Editor
// ─────────────────────────────────────────────────────────────
class BBQCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode:'open' });
    this._config   = {};
    this._hass     = null;
    this._rendered = false;
  }

  setConfig(config) {
    this._config   = { presets:[], step:5, unit:'C', mode:'minmax', buttons:'both', ...config };
    this._rendered = false;
    this._tryRender();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._tryRender();
  }

  _tryRender() {
    if (this._rendered || !this._hass) return;
    this._rendered = true;
    this._render();
  }

  _fire() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail:{ config:this._config }, bubbles:true, composed:true,
    }));
  }

  _datalist(id, filter) {
    const opts = Object.keys(this._hass.states)
      .filter(e=>filter(e)).sort()
      .map(e=>`<option value="${e}">`).join('');
    return `<datalist id="${id}">${opts}</datalist>`;
  }

  _field(key, listId, value, placeholder='') {
    return `<input type="text" data-key="${key}" list="${listId}"
      value="${value||''}" placeholder="${placeholder}"
      autocomplete="off" spellcheck="false">`;
  }

  _render() {
    const c       = this._config;
    const presets = c.presets || [];

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; padding:16px; font-family:sans-serif; }
        * { box-sizing:border-box; }
        .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }
        .full { grid-column:1/-1; }
        .sec {
          grid-column:1/-1; font-size:11px; font-weight:600; letter-spacing:.5px;
          text-transform:uppercase; color:var(--secondary-text-color,#888);
          border-top:1px solid var(--divider-color,#e0e0e0); padding-top:8px; margin-top:4px;
        }
        label { display:block; font-size:12px; color:var(--secondary-text-color,#888); margin-bottom:4px; }
        input[type="text"], input[type="number"] {
          width:100%; padding:8px 10px;
          border:1px solid var(--divider-color,#e0e0e0); border-radius:6px;
          font-size:13px; background:var(--card-background-color,#fff);
          color:var(--primary-text-color,#212121);
        }
        input:focus { outline:none; border-color:var(--primary-color,#03a9f4); }
        select.native {
          width:100%; padding:8px 10px;
          border:1px solid var(--divider-color,#e0e0e0); border-radius:6px;
          font-size:13px; background:var(--card-background-color,#fff);
          color:var(--primary-text-color,#212121);
        }
        .toggle-row { display:flex; align-items:center; justify-content:space-between; }
        .toggle-row label { margin:0; font-size:13px; color:var(--primary-text-color,#212121); }
        input[type="checkbox"] { width:18px; height:18px; cursor:pointer; }
        .hint { font-size:11px; color:var(--secondary-text-color,#888); margin-top:3px; }
        .preset-table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
        .preset-table th {
          text-align:left; padding:4px 6px; font-size:11px; font-weight:600;
          color:var(--secondary-text-color,#888);
          border-bottom:1px solid var(--divider-color,#e0e0e0);
        }
        .preset-table td { padding:4px 6px; vertical-align:middle; }
        .preset-table tr:nth-child(even) { background:var(--secondary-background-color,#f5f5f5); }
        .preset-table input {
          padding:4px 6px; font-size:12px;
          border:1px solid var(--divider-color,#e0e0e0); border-radius:4px;
          background:var(--card-background-color,#fff); color:var(--primary-text-color,#212121);
        }
        .preset-table input[type="number"] { width:56px; }
        .preset-table input[type="text"]   { width:100%; }
        .del-btn {
          background:none; border:none; cursor:pointer;
          color:var(--error-color,#e24b4a); font-size:16px; padding:0 4px; line-height:1;
        }
        .add-btn {
          margin-top:8px; width:100%; padding:8px;
          border:1px dashed var(--divider-color,#e0e0e0); border-radius:6px;
          background:none; cursor:pointer; font-size:13px;
          color:var(--primary-color,#03a9f4);
        }
        .add-btn:hover { background:var(--secondary-background-color,#f5f5f5); }
      </style>

      ${this._datalist('dl-sensor',  e=>e.startsWith('sensor.'))}
      ${this._datalist('dl-number',  e=>e.startsWith('input_number.'))}
      ${this._datalist('dl-boolean', e=>e.startsWith('input_boolean.'))}

      <div class="row">
        <div class="full">
          <label>Naam</label>
          <input type="text" data-key="name" value="${c.name||'BBQ Monitor'}" autocomplete="off">
        </div>

        <div>
          <label>Grootte</label>
          <select class="native" data-key="size">
            <option value="large" ${(c.size||'large')==='large'?'selected':''}>Large</option>
            <option value="small" ${c.size==='small'?'selected':''}>Small</option>
          </select>
        </div>

        <div>
          <label>Eenheid</label>
          <select class="native" data-key="unit">
            <option value="C" ${(c.unit||'C')==='C'?'selected':''}>Celsius (°C)</option>
            <option value="F" ${c.unit==='F'?'selected':''}>Fahrenheit (°F)</option>
          </select>
        </div>

        <div>
          <label>Stap grootte</label>
          <input type="number" data-key="step" value="${c.step??5}" min="0.5" step="0.5">
          <div class="hint">Graden per stap (bijv. 1 of 5)</div>
        </div>

        <div style="display:flex;align-items:flex-end;padding-bottom:2px;">
          <div class="toggle-row" style="width:100%;">
            <label>Preset dropdown tonen</label>
            <input type="checkbox" data-key="show_preset" ${c.show_preset?'checked':''}>
          </div>
        </div>

        <div class="sec">Temperatuur sensor</div>
        <div class="full">
          <label>Huidige temperatuur entity</label>
          ${this._field('temp_entity','dl-sensor',c.temp_entity,'sensor.bbq_temp')}
        </div>
        <div>
          <label>Absolute minimum (°C)</label>
          <input type="number" data-key="abs_min" value="${c.abs_min??0}">
          <div class="hint">Altijd in °C</div>
        </div>
        <div>
          <label>Absolute maximum (°C)</label>
          <input type="number" data-key="abs_max" value="${c.abs_max??350}">
          <div class="hint">Altijd in °C</div>
        </div>

        <div class="sec">Marker instelling</div>
        <div class="full">
          <label>Modus</label>
          <select class="native" data-key="mode">
            <option value="minmax"   ${(c.mode||'minmax')==='minmax'  ?'selected':''}>Min / Max (2 markers)</option>
            <option value="setpoint" ${c.mode==='setpoint'            ?'selected':''}>Setpoint (1 marker)</option>
          </select>
        </div>
        ${(c.mode||'minmax') === 'setpoint' ? `
        <div class="full">
          <label>Setpoint entity</label>
          ${this._field('target_entity','dl-number',c.target_entity,'input_number.bbq_target')}
        </div>
        ` : `
        <div>
          <label>Min temp entity</label>
          ${this._field('min_entity','dl-number',c.min_entity,'input_number.bbq_min')}
        </div>
        <div>
          <label>Max temp entity</label>
          ${this._field('max_entity','dl-number',c.max_entity,'input_number.bbq_max')}
        </div>
        `}

        <div class="sec">Knoppen</div>
        <div class="full">
          <label>Welke knoppen tonen</label>
          <select class="native" data-key="buttons">
            <option value="both"   ${(c.buttons||'both')==='both'   ?'selected':''}>Beide (aan/uit + snooze)</option>
            <option value="onoff"  ${c.buttons==='onoff'            ?'selected':''}>Alleen aan/uit</option>
            <option value="snooze" ${c.buttons==='snooze'           ?'selected':''}>Alleen snooze</option>
            <option value="none"   ${c.buttons==='none'             ?'selected':''}>Geen knoppen</option>
          </select>
        </div>
        ${(c.buttons||'both') !== 'none' ? `
        ${((c.buttons||'both') === 'both' || c.buttons === 'onoff') ? `
        <div>
          <label>On/Off entity</label>
          ${this._field('onoff_entity','dl-boolean',c.onoff_entity,'input_boolean.bbq_monitoring')}
        </div>` : ''}
        ${((c.buttons||'both') === 'both' || c.buttons === 'snooze') ? `
        <div>
          <label>Snooze entity</label>
          ${this._field('snooze_entity','dl-boolean',c.snooze_entity,'input_boolean.bbq_snooze')}
        </div>` : ''}
        ` : ''}

        <div class="sec">Presets <span style="font-weight:400;text-transform:none;font-size:10px;">(waarden in °C)</span></div>
        <div class="full">
          <table class="preset-table">
            <thead><tr><th>Categorie</th><th>Naam</th><th>Min°C</th><th>Max°C</th><th></th></tr></thead>
            <tbody id="preset-tbody">
              ${presets.map((p,i)=>this._presetRow(p,i)).join('')}
            </tbody>
          </table>
          <button class="add-btn" id="add-preset">+ Preset toevoegen</button>
        </div>
      </div>`;

    this.shadowRoot.querySelectorAll('input[data-key][type="text"], input[data-key][type="number"]').forEach(el=>{
      el.addEventListener('change', (e)=>{
        const key=e.target.dataset.key, raw=e.target.value;
        const numKeys=['abs_min','abs_max','step'];
        const val=numKeys.includes(key)?parseFloat(raw):raw;
        this._config={...this._config,[key]:val}; this._fire();
      });
    });

    this.shadowRoot.querySelectorAll('input[type="checkbox"][data-key]').forEach(el=>{
      el.addEventListener('change', (e)=>{
        this._config={...this._config,[e.target.dataset.key]:e.target.checked}; this._fire();
      });
    });

    this.shadowRoot.querySelectorAll('select.native[data-key]').forEach(el=>{
      el.addEventListener('change', (e)=>{
        this._config={...this._config,[e.target.dataset.key]:e.target.value}; this._fire();
      });
    });

    this.shadowRoot.getElementById('add-preset').addEventListener('click', ()=>{
      const presets=[...(this._config.presets||[]),{category:'',name:'',min:0,max:100}];
      this._config={...this._config,presets}; this._fire(); this._refreshPresetTable();
    });

    this.shadowRoot.getElementById('preset-tbody').addEventListener('change', (e)=>{
      const row=e.target.closest('tr[data-idx]'); if(!row)return;
      const idx=parseInt(row.dataset.idx), field=e.target.dataset.field, raw=e.target.value;
      const val=(field==='min'||field==='max')?parseFloat(raw):raw;
      const presets=[...(this._config.presets||[])];
      presets[idx]={...presets[idx],[field]:val};
      this._config={...this._config,presets}; this._fire();
    });

    this.shadowRoot.getElementById('preset-tbody').addEventListener('click', (e)=>{
      if(!e.target.classList.contains('del-btn'))return;
      const row=e.target.closest('tr[data-idx]'); if(!row)return;
      const idx=parseInt(row.dataset.idx);
      const presets=(this._config.presets||[]).filter((_,i)=>i!==idx);
      this._config={...this._config,presets}; this._fire(); this._refreshPresetTable();
    });
  }

  _presetRow(p,i) {
    return `<tr data-idx="${i}">
      <td><input type="text"   data-field="category" value="${p.category||''}" placeholder="Rund"></td>
      <td><input type="text"   data-field="name"     value="${p.name    ||''}" placeholder="Medium rare"></td>
      <td><input type="number" data-field="min"      value="${p.min     ??0}"></td>
      <td><input type="number" data-field="max"      value="${p.max     ??100}"></td>
      <td><button class="del-btn" title="Verwijder">✕</button></td>
    </tr>`;
  }

  _refreshPresetTable() {
    const tbody=this.shadowRoot.getElementById('preset-tbody');
    if(tbody) tbody.innerHTML=(this._config.presets||[]).map((p,i)=>this._presetRow(p,i)).join('');
  }
}

customElements.define('bbq-card-editor', BBQCardEditor);


// ── Register ──────────────────────────────────────────────────
window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === 'bbq-card')) {
  window.customCards.push({
    type:        'bbq-card',
    name:        'BBQ Monitor Card',
    description: 'Ronde gauge voor BBQ temperatuur met sleepbare min/max of setpoint marker, keuze voor knoppen, presets, Fahrenheit/Celsius en grote/kleine weergave.',
    preview:     true,
  });
}
