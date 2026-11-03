/**
 * ジェネレーティブ・ミュージック（Web Audio API）
 * ピン結線・エリア完成に応じてサイン波＋ディレイの心地よい音色を生成します。
 */
(function (global) {
  const CC = (global.ChainConstellation = global.ChainConstellation || {});

  class AmbientSynth {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.delay = null;
      this.delayGain = null;
      this.unlocked = false;
    }

    ensure() {
      if (this.ctx) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);

      this.delay = this.ctx.createDelay(1.5);
      this.delay.delayTime.value = 0.28;
      this.delayGain = this.ctx.createGain();
      this.delayGain.gain.value = 0.35;

      this.master.connect(this.delay);
      this.delay.connect(this.delayGain);
      this.delayGain.connect(this.delay);
      this.delayGain.connect(this.ctx.destination);
    }

    async unlock() {
      this.ensure();
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }
      this.unlocked = true;
    }

    /**
     * 線を引いた瞬間の「ポーン」音
     * @param {number} freqHz
     * @param {number} [duration=0.55]
     */
    playTone(freqHz, duration = 0.55) {
      this.ensure();
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freqHz, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, freqHz * 0.92), t0 + duration);

      filter.type = "lowpass";
      filter.frequency.value = 2400;

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);

      // 柔らかい倍音（三角波を薄く重ねる）
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freqHz * 2, t0);
      gain2.gain.setValueAtTime(0.0001, t0);
      gain2.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.0001, t0 + duration * 0.8);
      osc2.connect(gain2);
      gain2.connect(this.master);

      osc.start(t0);
      osc2.start(t0);
      osc.stop(t0 + duration + 0.05);
      osc2.stop(t0 + duration + 0.05);
    }

    /**
     * エリア完成時の広がる和音（パッド＋軽いアルペジオ）
     * @param {number[]} freqs
     */
    playChord(freqs) {
      this.ensure();
      const t0 = this.ctx.currentTime;
      const chord = freqs.slice(0, 4);

      chord.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = i % 2 === 0 ? "sine" : "triangle";
        osc.frequency.value = freq;
        filter.type = "lowpass";
        filter.frequency.value = 1800;

        const start = t0 + i * 0.08;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.6);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);

        osc.start(start);
        osc.stop(start + 1.8);
      });

      // シャローン感のための上方向スイープ
      const sweep = this.ctx.createOscillator();
      const sweepGain = this.ctx.createGain();
      sweep.type = "sine";
      sweep.frequency.setValueAtTime(chord[0] || 440, t0);
      sweep.frequency.exponentialRampToValueAtTime((chord[0] || 440) * 2.5, t0 + 0.9);
      sweepGain.gain.setValueAtTime(0.0001, t0);
      sweepGain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.05);
      sweepGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
      sweep.connect(sweepGain);
      sweepGain.connect(this.master);
      sweep.start(t0);
      sweep.stop(t0 + 1.1);
    }
  }

  /**
   * 距離(m)とブランドからピッチを決定
   * 近い線 → 高め、遠い線 → 低め。ブランド固有の基準音を混ぜる。
   */
  CC.pitchFromConnection = function pitchFromConnection(brandA, brandB, distanceMeters) {
    const baseA = (brandA && brandA.pitchBase) || 330;
    const baseB = (brandB && brandB.pitchBase) || 330;
    const blend = Math.sqrt(baseA * baseB);
    // 50m〜800m をマッピング（近いほど +半音〜1オクターブ上）
    const clamped = Math.min(800, Math.max(50, distanceMeters));
    const t = (clamped - 50) / 750;
    const ratio = 1.55 - t * 0.7;
    return blend * ratio;
  };

  CC.chordFromPath = function chordFromPath(brands) {
    const roots = brands.map((b) => b.pitchBase || 330);
    const root = roots[0] || 330;
    return [root, root * 1.25, root * 1.5, root * 2];
  };

  CC.synth = new AmbientSynth();
})(window);
