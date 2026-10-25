/* ============================================================
   Soundscape — a small generative ensemble built with Web Audio.
   No audio files: every pad, pluck and pulse is synthesised live,
   which also gives the visualiser something honest to listen to.
   ============================================================ */

(function () {
  "use strict";

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  class Soundscape {
    constructor() {
      this.ctx = null;
      this.track = null;
      this.playing = false;
      this.position = 0;
      this.startedAt = 0;
      this.barDur = 3.3;
      this.timer = null;
      this.stopTimer = null;
      this.scheduled = new Set();
      this.sources = new Set();
      this.volume = 0.72;

      this.analyser = null;
      this.freqData = null;
      this.waveData = null;

      this.fade = null;
      this.dry = null;
      this.volumeGain = null;
      this.compressor = null;
      this.reverb = null;
      this.wet = null;
      this.sendFilter = null;
      this.delay = null;
      this.delaySend = null;
      this.delayFilter = null;
      this.delayFeedback = null;
      this.noiseBuffer = null;
      this.noiseBed = null;
    }

    /* --------------------------------------------------------
       Graph
       -------------------------------------------------------- */

    async ensure() {
      if (this.ctx) {
        if (this.ctx.state !== "running") {
          try {
            await this.ctx.resume();
          } catch (error) {
            /* The gesture can be rejected; play() will fail softly. */
          }
        }
        return;
      }

      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        throw new Error("Web Audio is not supported in this browser.");
      }

      const ctx = new Ctor({ latencyHint: "playback" });
      this.ctx = ctx;

      const fade = ctx.createGain();
      fade.gain.value = 0.0001;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 28;
      compressor.ratio.value = 2.6;
      compressor.attack.value = 0.02;
      compressor.release.value = 0.3;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;

      const volumeGain = ctx.createGain();
      volumeGain.gain.value = this.volume;

      fade.connect(compressor);
      compressor.connect(analyser);
      analyser.connect(volumeGain);
      volumeGain.connect(ctx.destination);

      const dry = ctx.createGain();
      dry.gain.value = 1;
      dry.connect(fade);

      const convolver = ctx.createConvolver();
      convolver.buffer = this._makeImpulse(ctx, 3.4, 2.7);
      const sendFilter = ctx.createBiquadFilter();
      sendFilter.type = "highpass";
      sendFilter.frequency.value = 190;
      sendFilter.Q.value = 0.5;
      const wet = ctx.createGain();
      wet.gain.value = 0.3;
      dry.connect(sendFilter);
      sendFilter.connect(convolver);
      convolver.connect(wet);
      wet.connect(fade);

      const delay = ctx.createDelay(2.0);
      delay.delayTime.value = 0.38;
      const delayFilter = ctx.createBiquadFilter();
      delayFilter.type = "lowpass";
      delayFilter.frequency.value = 3600;
      delayFilter.Q.value = 0.4;
      const delayFeedback = ctx.createGain();
      delayFeedback.gain.value = 0.27;
      const delayWet = ctx.createGain();
      delayWet.gain.value = 0.22;
      const delaySend = ctx.createGain();
      delaySend.gain.value = 0.5;

      delaySend.connect(delayFilter);
      delayFilter.connect(delay);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);
      delay.connect(delayWet);
      delayWet.connect(fade);

      this.fade = fade;
      this.dry = dry;
      this.volumeGain = volumeGain;
      this.compressor = compressor;
      this.reverb = convolver;
      this.wet = wet;
      this.sendFilter = sendFilter;
      this.delay = delay;
      this.delaySend = delaySend;
      this.delayFilter = delayFilter;
      this.delayFeedback = delayFeedback;
      this.analyser = analyser;
      this.freqData = new Uint8Array(analyser.frequencyBinCount);
      this.waveData = new Uint8Array(analyser.fftSize);
      this.noiseBuffer = this._makeNoiseBuffer(ctx, 2.2);

      /* A barely-there bed of air makes the quiet parts feel inhabited. */
      const bed = ctx.createBufferSource();
      bed.buffer = this.noiseBuffer;
      bed.loop = true;
      const bedFilter = ctx.createBiquadFilter();
      bedFilter.type = "bandpass";
      bedFilter.frequency.value = 980;
      bedFilter.Q.value = 0.45;
      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.0042;
      bed.connect(bedFilter);
      bedFilter.connect(bedGain);
      bedGain.connect(dry);
      bed.start();
      this.noiseBed = bed;

      if (ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch (error) {
          /* handled by the caller */
        }
      }
    }

    _makeImpulse(ctx, seconds, decay) {
      const rate = ctx.sampleRate;
      const length = Math.max(1, Math.floor(rate * seconds));
      const impulse = ctx.createBuffer(2, length, rate);
      const preDelay = Math.min(length, Math.floor(rate * 0.012));

      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          if (i < preDelay) {
            data[i] = 0;
            continue;
          }
          const t = i / length;
          const envelope = Math.pow(1 - t, decay);
          const bloom = 1 - Math.exp(-(i - preDelay) / (rate * 0.018));
          data[i] = (Math.random() * 2 - 1) * envelope * bloom * 0.72;
        }
      }

      return impulse;
    }

    _makeNoiseBuffer(ctx, seconds) {
      const rate = ctx.sampleRate;
      const length = Math.max(1, Math.floor(rate * seconds));
      const buffer = ctx.createBuffer(1, length, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    }

    /* --------------------------------------------------------
       Transport
       -------------------------------------------------------- */

    get currentTime() {
      if (!this.track) return 0;
      if (!this.playing || !this.ctx) return this.position;
      const elapsed = Math.max(0, this.ctx.currentTime - this.startedAt);
      return Math.min(this.track.duration, this.position + elapsed);
    }

    setVolume(value) {
      this.volume = clamp(Number(value) || 0, 0, 1);
      if (this.ctx && this.volumeGain) {
        this.volumeGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.06);
      }
    }

    setTrack(track) {
      this.stop();
      this.track = track;
      this.position = 0;
      this.barDur = (60 / track.bpm) * 4;
      this.scheduled.clear();
    }

    async play() {
      if (!this.track) return;
      await this.ensure();
      if (this.playing) return;
      if (!this.ctx || this.ctx.state !== "running") {
        throw new Error("Audio context is not running.");
      }

      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      this.stopAll();

      if (!(this.position > 0) || this.position >= this.track.duration - 0.04) {
        this.position = 0;
      }

      const now = this.ctx.currentTime;
      this.barDur = (60 / this.track.bpm) * 4;
      this.startedAt = now + 0.06;
      this.scheduled.clear();

      if (this.delay) {
        this.delay.delayTime.setTargetAtTime(this.barDur * 0.1875, now, 0.02);
      }

      this.fade.gain.cancelScheduledValues(now);
      this.fade.gain.setValueAtTime(0.0001, now);
      this.fade.gain.exponentialRampToValueAtTime(1, now + 0.85);
      this.volumeGain.gain.setTargetAtTime(this.volume, now, 0.04);

      this.playing = true;
      this._padPickup();
      this.schedule();
      this.timer = window.setInterval(() => this.schedule(), 220);
    }

    pause() {
      if (!this.playing) return;
      const now = this.ctx ? this.ctx.currentTime : 0;
      this.position = this.currentTime;
      this.playing = false;

      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.scheduled.clear();

      if (this.ctx && this.fade) {
        this.fade.gain.cancelScheduledValues(now);
        this.fade.gain.setValueAtTime(Math.max(0.0001, this.fade.gain.value), now);
        this.fade.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
        if (this.stopTimer) clearTimeout(this.stopTimer);
        this.stopTimer = window.setTimeout(() => {
          this.stopAll();
          this.stopTimer = null;
        }, 190);
      }
    }

    seek(seconds) {
      if (!this.track) return;
      const target = clamp(Number(seconds) || 0, 0, Math.max(0, this.track.duration - 0.03));
      this.position = target;
      this.scheduled.clear();

      if (this.playing && this.ctx) {
        const now = this.ctx.currentTime;
        this.startedAt = now + 0.05;
        this.stopAll();
        this._padPickup();
        this.schedule();
      }
    }

    finish() {
      if (!this.track) return;
      this.position = this.track.duration;
      this.playing = false;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.scheduled.clear();
      if (this.ctx && this.fade) {
        const now = this.ctx.currentTime;
        this.fade.gain.cancelScheduledValues(now);
        this.fade.gain.setValueAtTime(Math.max(0.0001, this.fade.gain.value), now);
        this.fade.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
        if (this.stopTimer) clearTimeout(this.stopTimer);
        this.stopTimer = window.setTimeout(() => {
          this.stopAll();
          this.stopTimer = null;
        }, 420);
      }
    }

    stop() {
      this.playing = false;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      this.stopAll();
      if (this.ctx && this.fade) {
        const now = this.ctx.currentTime;
        this.fade.gain.cancelScheduledValues(now);
        this.fade.gain.setValueAtTime(Math.max(0.0001, this.fade.gain.value), now);
        this.fade.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      }
    }

    stopAll() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      this.sources.forEach((node) => {
        try {
          node.stop(now + 0.02);
        } catch (error) {
          /* already stopped */
        }
      });
      this.sources.clear();
    }

    /* --------------------------------------------------------
       Scheduling
       -------------------------------------------------------- */

    schedule() {
      if (!this.playing || !this.ctx || !this.track) return;
      const nowSong = this.currentTime;
      const horizon = Math.min(this.track.duration, nowSong + 2.3);
      const firstBar = Math.max(0, Math.floor(nowSong / this.barDur));
      const lastBar = Math.floor(horizon / this.barDur);

      for (let bar = firstBar; bar <= lastBar; bar++) {
        if (this.scheduled.has(bar)) continue;
        this.scheduled.add(bar);
        this._scheduleBar(bar);
      }
    }

    _padPickup() {
      if (!this.ctx || !this.track) return;
      const offset = this.position % this.barDur;
      if (offset < 0.02) return;

      const bar = Math.floor(this.position / this.barDur);
      const chord = this.track.chords[bar % this.track.chords.length];
      const start = this.ctx.currentTime + 0.035;
      const duration = Math.max(0.85, this.barDur - offset + 0.45);

      chord.forEach((midi, i) => {
        this._pad(midi, start, duration, i % 2 === 0 ? -0.32 : 0.32, 0.026);
      });

      if (offset > 0.3) {
        const root = chord[0] - 12;
        this._bass(root, start, Math.min(2.4, duration), 0.055);
      }
    }

    _scheduleBar(bar) {
      const track = this.track;
      const ctx = this.ctx;
      if (!track || !ctx) return;

      const barDur = this.barDur;
      const barStart = bar * barDur;
      if (barStart >= track.duration - 0.1) return;

      const beat = barDur / 4;
      const chord = track.chords[bar % track.chords.length];
      const progress = barStart / track.duration;
      const intro = progress < 0.075;
      const outro = progress > 0.915;

      const at = (beats) => {
        const songTime = barStart + beats * beat;
        if (songTime >= track.duration - 0.06) return null;
        const when = this.startedAt + (songTime - this.position);
        if (when < ctx.currentTime + 0.02) return null;
        return when;
      };

      /* Pad — the room itself. */
      const padStart = at(0);
      if (padStart) {
        chord.forEach((midi, i) => {
          this._pad(
            midi,
            padStart,
            barDur * 1.02,
            i % 2 === 0 ? -0.3 : 0.3,
            intro ? 0.023 : 0.029
          );
        });
      }

      /* Bass — only once the room has settled. */
      if (progress > 0.035) {
        const root = chord[0] - 12;
        const bassStart = at(0);
        if (bassStart) {
          this._bass(root, bassStart, beat * 2.15, outro ? 0.045 : 0.068);
        }
        if (!outro && bar % 2 === 1) {
          const second = at(2.5);
          if (second) this._bass(root, second, beat * 0.8, 0.037);
        }
      }

      /* Arpeggio — a handful of notes, never a machine. */
      if (!intro && progress < 0.94) {
        const offsets = [0, 0.75, 1.5, 2.25, 2.75, 3.5];
        offsets.forEach((offset, i) => {
          if (hash(bar * 13 + i * 7) > (outro ? 0.42 : 0.79)) return;
          const when = at(offset);
          if (!when) return;
          const note = chord[(i + bar) % chord.length] + (i % 3 === 2 ? 24 : 12);
          this._pluck(note, when, 0.66, i % 2 === 0 ? 0.4 : -0.4, 0.031);
        });
        if (progress > 0.5 && bar % 4 === 0) {
          const when = at(3.25);
          if (when) {
            this._pluck(chord[(bar + 2) % chord.length] + 24, when, 1.15, 0.18, 0.021);
          }
        }
      }

      /* A low, soft heartbeat. */
      if (!intro && progress < 0.9) {
        const first = at(0);
        if (first) this._kick(first, bar % 4 === 0 ? 0.085 : 0.062);
        if (progress > 0.16) {
          if (bar % 2 === 0) {
            const second = at(2.5);
            if (second) this._kick(second, 0.047);
          }
          const brush = at(2);
          if (brush && bar % 4 === 1) this._brush(brush, 0.011);
          const hatOne = at(1.5);
          const hatTwo = at(3.5);
          if (hatOne) this._hat(hatOne, 0.0055);
          if (hatTwo) this._hat(hatTwo, 0.0045);
        }
      }

      /* High shimmer, like light catching an edge. */
      if (progress > 0.3 && progress < 0.88 && bar % 2 === 0) {
        const when = at(0.5);
        if (when) {
          this._shimmer(
            chord[chord.length - 1] + 24,
            when,
            Math.min(4.2, barDur * 1.2),
            bar % 4 === 0 ? -0.52 : 0.52,
            0.012
          );
        }
      }
    }

    /* --------------------------------------------------------
       Voices
       -------------------------------------------------------- */

    _track(node) {
      this.sources.add(node);
      node.addEventListener(
        "ended",
        () => {
          this.sources.delete(node);
        },
        { once: true }
      );
    }

    _panner(pan) {
      if (this.ctx.createStereoPanner) {
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1);
        return panner;
      }
      const gain = this.ctx.createGain();
      gain.gain.value = 1;
      return gain;
    }

    _pad(midi, start, duration, pan, peak) {
      const ctx = this.ctx;
      if (!ctx) return;
      const frequency = midiToFreq(midi);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.55;
      filter.frequency.setValueAtTime(430 + hash(midi) * 150, start);
      filter.frequency.linearRampToValueAtTime(940 + hash(midi + 7) * 420, start + duration * 0.5);
      filter.frequency.linearRampToValueAtTime(560, start + duration);

      const gain = ctx.createGain();
      const attack = Math.min(1.5, Math.max(0.36, duration * 0.45));
      const sustainAt = start + Math.max(attack + 0.02, duration * 0.68);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + attack);
      gain.gain.setValueAtTime(peak, sustainAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration + 1.35);

      const panner = this._panner(pan);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(this.dry);

      [-5.5, 5.5].forEach((detune) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        osc.connect(filter);
        this._track(osc);
        osc.start(start);
        osc.stop(start + duration + 1.45);
      });
    }

    _bass(midi, start, duration, peak) {
      const ctx = this.ctx;
      if (!ctx) return;
      const frequency = midiToFreq(midi);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 210;
      filter.Q.value = 0.5;

      const gain = ctx.createGain();
      const end = start + duration;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.07);
      gain.gain.setValueAtTime(peak, start + duration * 0.62);
      gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.2);

      filter.connect(gain);
      gain.connect(this.dry);

      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = frequency;
      sub.connect(filter);
      this._track(sub);
      sub.start(start);
      sub.stop(end + 0.28);

      const warmth = ctx.createOscillator();
      warmth.type = "triangle";
      warmth.frequency.value = frequency * 2;
      const warmthGain = ctx.createGain();
      warmthGain.gain.value = 0.26;
      warmth.connect(warmthGain);
      warmthGain.connect(filter);
      this._track(warmth);
      warmth.start(start);
      warmth.stop(end + 0.28);
    }

    _pluck(midi, start, duration, pan, peak) {
      const ctx = this.ctx;
      if (!ctx) return;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2200 + hash(midi) * 1600, start);
      filter.frequency.exponentialRampToValueAtTime(900, start + duration);
      filter.Q.value = 0.7;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      const panner = this._panner(pan);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(this.dry);
      panner.connect(this.delaySend);

      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiToFreq(midi);
      osc.connect(filter);
      this._track(osc);
      osc.start(start);
      osc.stop(start + duration + 0.08);

      const bell = ctx.createOscillator();
      bell.type = "sine";
      bell.frequency.value = midiToFreq(midi + 12);
      const bellGain = ctx.createGain();
      bellGain.gain.value = 0.16;
      bell.connect(bellGain);
      bellGain.connect(filter);
      this._track(bell);
      bell.start(start);
      bell.stop(start + duration + 0.08);
    }

    _shimmer(midi, start, duration, pan, peak) {
      const ctx = this.ctx;
      if (!ctx) return;

      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 520;
      filter.Q.value = 0.4;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 1.15);
      gain.gain.setValueAtTime(peak, start + duration * 0.62);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration + 1.7);

      const panner = this._panner(pan);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(this.dry);

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = midiToFreq(midi);
      osc.connect(filter);
      this._track(osc);
      osc.start(start);
      osc.stop(start + duration + 1.8);
    }

    _kick(start, peak) {
      const ctx = this.ctx;
      if (!ctx) return;

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(94, start);
      osc.frequency.exponentialRampToValueAtTime(42, start + 0.34);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);

      osc.connect(gain);
      gain.connect(this.dry);
      this._track(osc);
      osc.start(start);
      osc.stop(start + 0.55);
    }

    _hat(start, peak) {
      const ctx = this.ctx;
      if (!ctx || !this.noiseBuffer) return;

      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 7600;
      filter.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.dry);
      this._track(source);
      source.start(start);
      source.stop(start + 0.08);
    }

    _brush(start, peak) {
      const ctx = this.ctx;
      if (!ctx || !this.noiseBuffer) return;

      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1700;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.dry);
      this._track(source);
      source.start(start);
      source.stop(start + 0.27);
    }

    /* --------------------------------------------------------
       Analysis
       -------------------------------------------------------- */

    readSpectrum() {
      if (!this.analyser || !this.freqData) return null;
      this.analyser.getByteFrequencyData(this.freqData);
      return this.freqData;
    }

    readWave() {
      if (!this.analyser || !this.waveData) return null;
      this.analyser.getByteTimeDomainData(this.waveData);
      return this.waveData;
    }
  }

  window.Soundscape = Soundscape;
})();
