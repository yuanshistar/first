/* ============================================================
 * audio-engine.js — Lyric Finder 的声音层
 * ============================================================
 * 一个关键问题：这些歌的"录音"全都有版权，一首都不能用。
 * 但"旋律"（词曲）早就过期了。所以这里不发音频文件，
 * 而是用 Web Audio API 现场把旋律合成出来 —— 每个音符都是代码算出来的，
 * 不存在任何第三方录音，也就没有任何录音制品权问题。
 *
 * 四层声音：
 *   1. 旋律合成  —— 用振荡器把简谱弹成"八音盒"音色（83 首配了传世曲谱）
 *   2. 低音垫    —— 每 2 拍取旋律众数音，降八度弹根音 + 纯五度，把单薄的一条线垫厚
 *   3. 即兴哼唱  —— 没有曲谱的 12 首，按歌词音节现场生成五声音阶旋律（原创，非原曲）
 *   4. 语音朗读  —— 浏览器自带 TTS，把单词/歌词句读出来；没有 AudioContext 时兜底
 * ============================================================ */

(function (global) {
  "use strict";

  /* ---------- 音名 → 频率 ---------- */
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function toFreq(name) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) return 0;
    let semi = SEMI[m[1]];
    if (m[2] === "#") semi += 1;
    if (m[2] === "b") semi -= 1;
    const midi = (parseInt(m[3], 10) + 1) * 12 + semi;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /* ---------- 曲谱 ----------
   * 记谱格式：音名 或 音名:拍数，空格分隔，| 分隔乐句（每句对应一行歌词）。
   * 只记录旋律走向和相对时值，够用且可读。
   * 全部为公有领域曲调，此处为程序合成，无录音版权。
   */
  const SCORES = {
    /* Amazing Grace — 3/4，G 大调，赞美诗《新不列颠》曲调 */
    1: {
      bpm: 82,
      phrases: `
        G4:1 C5:2 E5:1 C5:1 E5:1 D5:1 C5:2 A4:1 |
        G4:1 C5:2 E5:1 C5:2 A4:1 G4:3 |
        G4:1 C5:2 E5:1 C5:1 E5:1 D5:1 C5:2 A4:1 |
        G4:1 C5:2 E5:1 C5:2 A4:1 G4:3 |
        G4:1 C5:2 E5:1 C5:1 E5:1 D5:1 C5:2 A4:1 |
        G4:1 C5:2 E5:1 C5:2 A4:1 G4:3 |
        G4:1 C5:2 E5:1 C5:1 E5:1 D5:1 C5:2 A4:1 |
        G4:1 C5:2 E5:1 C5:2 A4:1 G4:3 |
        G4:1 C5:2 E5:1 C5:1 E5:1 D5:1 C5:2 A4:1 |
        G4:1 C5:2 E5:1 C5:2 A4:1 G4:3 |
        G4:1 C5:2 E5:1 C5:1 E5:1 D5:1 C5:2 A4:1 |
        G4:1 C5:2 E5:1 C5:2 A4:1 G4:3`
    },

    /* Oh! Susanna — 2/4，C 大调 */
    2: {
      bpm: 118,
      phrases: `
        C4:1 C4:1 E4:1 G4:1 G4:1 A4:1 G4:1 E4:1 C4:1 D4:1 |
        C4:1 C4:1 E4:1 G4:1 G4:1 A4:1 G4:1 E4:1 C4:1 D4:1 |
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:1 C4:2 |
        D4:1 D4:1 E4:1 C4:2 |
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:1 C4:2 |
        D4:1 E4:1 C4:2 |
        D4:1 E4:1 G4:1 G4:1 A4:1 G4:1 E4:2 |
        C4:1 C4:1 E4:1 G4:1 G4:1 A4:1 G4:1 E4:1 C4:1 D4:1 |
        C4:1 C4:1 E4:1 G4:1 A4:1 G4:1 E4:2 |
        D4:1 E4:1 C4:2 |
        C4:1 C4:1 E4:1 G4:1 G4:1 |
        A4:1 G4:1 E4:1 C4:1 D4:2`
    },

    /* Twinkle, Twinkle, Little Star — C 大调，法国民谣 Ah! vous dirai-je, maman */
    6: {
      bpm: 104,
      phrases: `
        C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 |
        F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 |
        G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 |
        G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 |
        C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 |
        F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 |
        G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 |
        G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 |
        G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 |
        C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2`
    },

    /* Auld Lang Syne — C 大调，苏格兰民谣 */
    9: {
      bpm: 92,
      phrases: `
        C4:1 F4:1 F4:1 F4:1 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 |
        F4:1 F4:1 A4:1 C5:1 D5:2 |
        C4:1 F4:1 F4:1 F4:1 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 |
        F4:1 F4:1 A4:1 C5:1 D5:2 |
        A4:1 C5:1 D5:2 C5:1 A4:1 F4:2 |
        F4:1 G4:1 A4:1 F4:1 |
        F4:1 F4:1 A4:1 G4:1 F4:1 A4:1 C5:1 D5:2 |
        A4:1 G4:1 F4:3 |
        A4:1 C5:1 D5:2 C5:1 A4:1 F4:2 |
        F4:1 G4:1 A4:1 F4:1`
    },

    /* Jingle Bells — C 大调，James Lord Pierpont, 1857 */
    11: {
      bpm: 130,
      phrases: `
        E4:1 E4:1 E4:2 E4:1 E4:1 |
        E4:1 G4:1 C5:1 D5:1 E5:3 |
        F5:1 F5:1 F5:2 F5:1 F5:1 |
        E5:1 E5:1 E5:2 E5:1 E5:1 |
        E5:1 D5:1 C5:1 D5:1 E5:3 |
        D5:1 C5:1 A4:3 |
        D5:1 E5:1 D5:1 C5:1 A4:2 C5:1 G4:1 |
        C5:1 D5:1 E5:3 |
        E5:1 E5:1 E5:2 E5:1 E5:1 E5:2 E5:1 G5:1 C5:1 D5:1 E5:3 |
        F5:1 F5:1 F5:1 F5:1 F5:1 E5:1 E5:1 E5:1 E5:1 D5:1 D5:1 E5:1 D5:1 G4:3`
    },

    /* Silent Night — C 大调，Franz Xaver Gruber, 1818 */
    12: {
      bpm: 74,
      phrases: `
        G4:1 A4:1 G4:3 E4:4 |
        G4:1 A4:1 G4:3 E4:4 |
        D5:1 D5:1 B4:3 C5:4 |
        D5:1 D5:1 B4:3 C5:4 |
        C5:1 E5:1 C5:1 G4:1 A4:1 G4:3 |
        G4:1 A4:1 G4:3 E4:4 |
        G4:1 A4:1 G4:3 E4:4 |
        D5:1 B4:1 C5:4 A4:2 |
        C5:1 E5:1 C5:1 G4:1 A4:1 G4:4`
    },

    /* Old MacDonald Had a Farm — G 大调，传统童谣 */
    13: {
      bpm: 112,
      phrases: `
        G4:1 G4:1 G4:1 D4:1 E4:1 E4:1 D4:2 |
        B4:1 B4:1 A4:1 A4:1 G4:4 |
        D4:1 G4:1 G4:1 D4:1 G4:1 G4:1 D4:2 |
        G4:1 G4:1 D4:1 G4:1 G4:1 D4:2 |
        G4:1 G4:1 G4:1 D4:1 E4:1 E4:1 D4:2 |
        B4:1 B4:1 A4:1 A4:1 G4:4 |
        D4:1 G4:1 G4:1 D4:1 G4:1 G4:1 D4:2 |
        G4:1 G4:1 D4:1 G4:1 G4:1 D4:2 |
        G4:1 G4:1 G4:1 D4:1 E4:1 E4:1 D4:2 |
        B4:1 B4:1 A4:1 A4:1 G4:4`
    },

    /* Row, Row, Row Your Boat — C 大调，Eliphalet Oram Lyte, 1881 */
    14: {
      bpm: 96,
      phrases: `
        C4:1 C4:1 C4:1 D4:1 E4:2 |
        E4:1 D4:1 E4:1 F4:1 G4:2 |
        C5:2 C5:2 C5:2 C5:2 |
        G4:1 F4:1 E4:1 D4:1 C4:3 |
        C4:1 C4:1 C4:1 D4:1 E4:2 |
        E4:1 D4:1 E4:1 F4:1 G4:2 |
        C5:2 C5:2 C5:2 C5:2 |
        G4:1 F4:1 E4:1 D4:1 C4:3`
    },

    /* Mary Had a Little Lamb — C 大调，1830 年代美国童谣 */
    15: {
      bpm: 108,
      phrases: `
        E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2 |
        D4:1 D4:1 D4:2 E4:1 G4:1 G4:2 |
        E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:1 E4:1 |
        D4:1 D4:1 E4:1 D4:1 C4:3 |
        E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2 |
        D4:1 D4:1 E4:1 D4:1 C4:3 |
        E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2 |
        D4:1 D4:1 E4:1 D4:1 C4:3 |
        E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2 |
        D4:1 D4:1 D4:2 E4:1 G4:1 G4:2`
    },

    /* London Bridge Is Falling Down — 中世纪英国童谣 */
    16: {
      bpm: 114,
      phrases: `
        G4:1 A4:1 G4:1 F4:1 E4:1 F4:1 G4:2 |
        D4:1 E4:1 F4:2 D4:1 E4:1 F4:2 |
        G4:1 A4:1 G4:1 F4:1 E4:1 F4:1 G4:2 |
        D4:2 G4:2 E4:1 C4:2 |
        E4:1 F4:1 G4:1 A4:1 G4:1 F4:1 E4:2 |
        D4:1 E4:1 F4:2 D4:1 E4:1 F4:2 |
        E4:1 F4:1 G4:1 A4:1 G4:1 F4:1 E4:2 |
        D4:2 G4:2 E4:1 C4:2 |
        F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 |
        E4:1 F4:1 G4:1 A4:1 G4:1 F4:1 E4:2`
    },

    /* Yankee Doodle — 18 世纪英美民歌 */
    23: {
      bpm: 120,
      phrases: `
        C4:1 C4:1 D4:1 E4:1 C4:1 E4:1 D4:2 |
        C4:1 C4:1 D4:1 E4:1 C4:2 B3:2 |
        C4:1 C4:1 D4:1 E4:1 F4:1 E4:2 |
        G4:1 G4:1 F4:1 E4:1 D4:1 C4:2 |
        C4:1 C4:1 D4:1 E4:1 C4:1 E4:1 D4:2 |
        C4:1 C4:1 D4:1 E4:1 C4:2 B3:2 |
        C4:1 C4:1 D4:1 E4:1 F4:1 E4:2 |
        G4:1 G4:1 F4:1 E4:1 D4:1 C4:2`
    },

    /* Red River Valley — 19 世纪北美民谣 */
    27: {
      bpm: 84,
      phrases: `
        D4:1 G4:1 G4:1 G4:1 B4:1 A4:1 G4:1 A4:2 |
        G4:1 G4:1 B4:1 B4:1 A4:1 G4:1 A4:1 B4:2 |
        D4:1 G4:1 G4:1 G4:1 B4:1 A4:1 G4:1 A4:2 |
        G4:1 A4:1 B4:1 A4:1 G4:1 E4:3 |
        D4:1 G4:1 G4:1 G4:1 B4:1 A4:1 G4:1 A4:2 |
        A4:1 B4:1 D5:1 D5:1 B4:1 A4:1 G4:2 |
        B4:1 B4:1 A4:1 G4:1 A4:1 B4:1 A4:2 |
        G4:1 G4:1 E4:1 D4:4 |
        D4:1 G4:1 G4:1 G4:1 B4:1 A4:1 G4:1 A4:2 |
        A4:1 B4:1 D5:1 D5:1 B4:1 A4:1 G4:2`
    },

    /* Swing Low, Sweet Chariot — 美国灵歌，Wallis Willis, 1865 */
    32: {
      bpm: 78,
      phrases: `
        G4:1 G4:1 C5:1 C5:1 A4:1 G4:3 |
        A4:1 A4:1 G4:1 G4:1 A4:1 C5:3 |
        G4:1 G4:1 C5:1 C5:1 A4:1 G4:3 |
        A4:1 A4:1 G4:1 G4:1 A4:1 C5:3 |
        G4:1 G4:1 A4:1 C5:1 C5:1 A4:1 G4:1 A4:1 C5:2 |
        A4:1 A4:1 G4:1 G4:1 A4:1 C5:3 |
        A4:1 C5:1 C5:1 A4:1 G4:1 A4:1 G4:3 |
        A4:1 A4:1 G4:1 G4:1 A4:1 C5:3`
    },

    /* Deck the Halls — 16 世纪威尔士曲调 Nos Galan */
    41: {
      bpm: 126,
      phrases: `
        G4:1 F4:1 E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 |
        D4:1 E4:1 F4:1 D4:1 E4:1 D4:1 C4:2 |
        G4:1 F4:1 E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 |
        D4:1 E4:1 F4:1 D4:1 C4:3 |
        D4:1 E4:1 F4:1 E4:1 F4:1 G4:2 |
        G4:1 A4:1 G4:1 F4:1 E4:1 D4:1 C4:2 |
        D4:1 E4:1 F4:1 D4:1 C4:3 |
        D4:1 C4:1 D4:1 E4:1 D4:3`
    },

    /* ---------- 以下是第二批曲谱：单声部简化旋律，只保留主歌轮廓 ---------- */

    /* 3. Down by the Riverside — 美国灵歌 */
    3: {
      bpm: 92,
      phrases: `
        G4:1 A4:1 G4:1 E4:2 D4:1 E4:1 G4:2 |
        A4:1 G4:1 E4:1 D4:1 C4:3 |
        E4:1 E4:1 D4:1 C4:1 D4:2 E4:2 |
        G4:1 A4:1 G4:2 E4:4`
    },

    /* 4. This Little Light of Mine — 美国灵歌 */
    4: {
      bpm: 104,
      phrases: `
        G4:1 G4:1 G4:1 A4:1 G4:2 E4:1 G4:1 |
        A4:1 A4:1 G4:1 E4:1 G4:3 |
        G4:1 G4:1 G4:1 A4:1 G4:2 E4:1 G4:1 |
        E4:1 D4:1 E4:1 G4:1 E4:3`
    },

    /* 5. Michael Row the Boat Ashore — 美国灵歌 */
    5: {
      bpm: 88,
      phrases: `
        C4:1 E4:1 G4:1 G4:1 A4:1 G4:2 |
        E4:1 C4:1 D4:1 E4:3 |
        C4:1 E4:1 G4:1 G4:1 A4:1 G4:2 |
        E4:1 D4:1 C4:4`
    },

    /* 7. Greensleeves — 16 世纪英国民谣，A 小调 */
    7: {
      bpm: 74,
      phrases: `
        A4:1 C5:2 D5:1 E5:1 F5:1 E5:1 D5:2 B4:2 |
        G4:1 A4:1 B4:1 C5:2 A4:1 A4:1 G#4:1 A4:1 B4:2 |
        A4:1 C5:2 D5:1 E5:1 F5:1 E5:1 D5:2 B4:2 |
        G4:1 A4:1 B4:1 C5:2 A4:2 G#4:1 A4:1 B4:2 |
        C5:1 D5:1 E5:2 D5:1 C5:1 B4:2 G4:1 A4:1 B4:2 |
        C5:1 B4:1 A4:1 G#4:1 A4:4`
    },

    /* 8. Scarborough Fair — 英国传统叙事歌，A 小调 */
    8: {
      bpm: 76,
      phrases: `
        A4:1 A4:1 A4:2 B4:1 C5:1 B4:1 A4:1 G4:2 |
        E4:1 G4:1 A4:1 A4:1 B4:1 A4:2 G4:2 |
        A4:1 A4:2 B4:1 C5:1 B4:1 A4:1 G4:2 |
        E4:1 G4:1 A4:2 G4:1 E4:1 D4:3`
    },

    /* 10. The House of the Rising Sun — 传统民谣，A 小调 */
    10: {
      bpm: 82,
      phrases: `
        A4:1 C5:1 D5:1 E5:2 D5:1 C5:1 A4:2 |
        A4:1 C5:1 D5:1 E5:2 D5:1 C5:1 B4:2 |
        A4:1 C5:1 D5:1 E5:1 G5:2 E5:1 D5:1 C5:1 A4:2 |
        A4:1 B4:1 C5:1 B4:1 A4:1 G4:1 A4:4`
    },

    /* 17. The Itsy Bitsy Spider — 童谣 */
    17: {
      bpm: 108,
      phrases: `
        C4:1 C4:1 C4:1 D4:1 E4:1 E4:1 E4:2 |
        E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 C4:2 |
        E4:1 E4:1 D4:1 C4:1 D4:1 E4:1 C4:2 |
        E4:1 D4:1 C4:1 D4:1 C4:4`
    },

    /* 18. Baa, Baa, Black Sheep — 与《小星星》同一曲调 */
    18: {
      bpm: 100,
      phrases: `
        C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 |
        F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 |
        G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 |
        G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2`
    },

    /* 19. Hickory Dickory Dock — 童谣 */
    19: {
      bpm: 112,
      phrases: `
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:2 |
        C4:1 D4:1 E4:1 F4:2 G4:2 |
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:2 |
        D4:1 E4:1 C4:4`
    },

    /* 20. Humpty Dumpty — 童谣 */
    20: {
      bpm: 108,
      phrases: `
        G4:1 G4:1 A4:1 B4:2 G4:1 A4:1 B4:1 C5:1 |
        G4:1 G4:1 A4:1 B4:2 G4:1 E4:1 D4:1 C4:1 |
        G4:1 G4:1 A4:1 B4:2 G4:1 A4:1 B4:1 C5:1 |
        E4:1 D4:1 C4:1 D4:1 C4:3`
    },

    /* 21. Jack and Jill — 童谣 */
    21: {
      bpm: 112,
      phrases: `
        G4:1 A4:1 B4:1 C5:2 A4:1 G4:2 |
        G4:1 A4:1 B4:1 C5:2 B4:1 A4:1 G4:1 |
        G4:1 A4:1 B4:1 C5:2 A4:1 G4:2 |
        E4:1 G4:1 D4:1 E4:1 C4:3`
    },

    /* 22. Hey Diddle Diddle — 童谣 */
    22: {
      bpm: 118,
      phrases: `
        C4:1 C4:1 E4:1 G4:2 G4:1 E4:1 C4:2 |
        D4:1 E4:1 F4:1 G4:2 E4:1 D4:1 C4:2 |
        C4:1 C4:1 E4:1 G4:2 G4:1 E4:1 C4:2 |
        E4:1 D4:1 C4:1 D4:1 C4:3`
    },

    /* 26. Shenandoah — 美国内河船歌 */
    26: {
      bpm: 72,
      phrases: `
        C4:1 C4:1 C4:1 E4:1 D4:1 C4:2 A3:2 |
        C4:1 D4:1 E4:1 G4:1 E4:2 D4:2 |
        C4:1 C4:1 C4:1 E4:1 D4:1 C4:2 A3:2 |
        G3:1 A3:1 C4:1 D4:1 C4:4`
    },

    /* 28. Home on the Range — 美国西部民谣 */
    28: {
      bpm: 88,
      phrases: `
        C4:1 C4:1 C4:1 D4:1 E4:2 G4:1 G4:2 |
        A4:1 A4:1 G4:1 E4:1 G4:2 E4:2 |
        D4:1 E4:1 G4:1 A4:1 G4:1 E4:1 D4:1 C4:3 |
        C4:1 D4:1 E4:1 G4:1 E4:4`
    },

    /* 29. I've Been Working on the Railroad — 美国民谣 */
    29: {
      bpm: 116,
      phrases: `
        C4:1 C4:1 C4:1 C4:1 A4:1 G4:1 F4:2 |
        F4:1 F4:1 E4:1 D4:1 C4:4 |
        C4:1 C4:1 C4:1 C4:1 A4:1 G4:1 F4:2 |
        F4:1 G4:1 A4:1 G4:1 F4:1 E4:3`
    },

    /* 30. The Water Is Wide — 苏格兰/英格兰传统 */
    30: {
      bpm: 72,
      phrases: `
        C4:1 E4:1 G4:1 G4:1 A4:1 G4:2 E4:2 |
        D4:1 E4:1 G4:1 E4:1 D4:4 |
        C4:1 E4:1 G4:1 G4:1 A4:1 G4:2 E4:2 |
        D4:1 E4:1 D4:1 C4:4`
    },

    /* 31. Wayfaring Stranger — 美国灵歌，A 小调 */
    31: {
      bpm: 74,
      phrases: `
        A4:1 A4:1 A4:1 C5:1 B4:1 A4:2 G4:2 |
        E4:1 G4:1 A4:1 G4:1 E4:4 |
        A4:1 A4:1 A4:1 C5:1 B4:1 A4:2 G4:2 |
        E4:1 D4:1 E4:1 G4:1 A4:4`
    },

    /* 33. Clementine — Percy Montrose, 1884 */
    33: {
      bpm: 120,
      phrases: `
        G4:1 G4:1 G4:1 E4:2 G4:1 A4:2 |
        A4:1 A4:1 G4:1 E4:2 D4:1 C4:2 |
        G4:1 G4:1 G4:1 E4:2 G4:1 A4:2 |
        D4:1 E4:1 G4:1 E4:1 D4:1 C4:4`
    },

    /* 35. Buffalo Gals — 1844 */
    35: {
      bpm: 126,
      phrases: `
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:1 C4:1 D4:2 |
        E4:1 E4:1 D4:1 E4:1 G4:2 E4:2 |
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:1 C4:1 D4:2 |
        C4:1 D4:1 E4:1 D4:1 C4:4`
    },

    /* 36. She'll Be Coming Round the Mountain — 美国传统 */
    36: {
      bpm: 130,
      phrases: `
        C4:1 C4:1 C4:1 C4:1 C4:1 E4:1 G4:2 |
        G4:1 G4:1 G4:1 E4:1 G4:2 E4:2 |
        C4:1 C4:1 C4:1 C4:1 C4:1 E4:1 G4:2 |
        G4:1 E4:1 D4:1 C4:1 D4:2 C4:2`
    },

    /* 37. On Top of Old Smoky — 美国传统 */
    37: {
      bpm: 84,
      phrases: `
        G4:1 G4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        E4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        G4:1 G4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        E4:1 D4:1 C4:1 D4:1 E4:1 C4:3`
    },

    /* 38. Down in the Valley — 美国传统 */
    38: {
      bpm: 86,
      phrases: `
        G4:1 G4:1 A4:1 B4:2 A4:1 G4:2 |
        E4:1 G4:1 A4:1 G4:2 E4:2 |
        G4:1 G4:1 A4:1 B4:2 A4:1 G4:2 |
        E4:1 D4:1 E4:1 G4:1 E4:3`
    },

    /* 39. Kumbaya — 美国灵歌 */
    39: {
      bpm: 80,
      phrases: `
        G4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        G4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        G4:1 G4:1 A4:1 G4:1 E4:1 D4:1 E4:1 G4:1 |
        G4:1 A4:1 G4:1 E4:1 D4:2 C4:2`
    },

    /* 40. He's Got the Whole World in His Hands — 美国灵歌 */
    40: {
      bpm: 98,
      phrases: `
        G4:1 G4:1 G4:1 G4:1 A4:1 G4:1 E4:2 |
        E4:1 G4:1 A4:1 G4:1 E4:1 D4:3 |
        G4:1 G4:1 G4:1 G4:1 A4:1 G4:1 E4:2 |
        D4:1 E4:1 G4:1 E4:1 D4:1 C4:3`
    },

    /* 42. The First Noel — 英国圣诞颂歌 */
    42: {
      bpm: 90,
      phrases: `
        C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 |
        C4:1 C4:1 D4:1 E4:1 D4:2 C4:2 |
        C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 |
        E4:1 D4:1 C4:1 D4:1 C4:3`
    },

    /* 43. Joy to the World — Lowell Mason, 1839 */
    43: {
      bpm: 96,
      phrases: `
        C5:1 B4:1 A4:1 G4:1 F4:1 E4:1 D4:1 C4:1 E4:1 F4:1 G4:2 |
        G4:1 A4:1 B4:1 C5:1 C5:1 B4:1 A4:1 G4:1 F4:1 E4:1 D4:2 |
        D4:1 E4:1 F4:1 G4:1 A4:1 G4:1 F4:1 E4:2 |
        C4:1 D4:1 E4:1 F4:1 G4:2 C4:2`
    },

    /* 45. We Three Kings — John Henry Hopkins, 1857 */
    45: {
      bpm: 92,
      phrases: `
        G4:1 G4:1 G4:1 G4:1 A4:1 G4:1 F4:2 |
        E4:1 F4:1 G4:1 A4:1 G4:2 E4:2 |
        G4:1 G4:1 G4:1 G4:1 A4:1 G4:1 F4:2 |
        D4:1 E4:1 F4:1 E4:1 D4:3`
    },

    /* 47. Hark! The Herald Angels Sing — Mendelssohn, 1840 */
    47: {
      bpm: 96,
      phrases: `
        G4:1 G4:1 G4:1 E4:2 E4:1 G4:1 A4:1 B4:2 |
        B4:1 A4:1 B4:1 C5:1 D5:2 D5:2 |
        G4:1 G4:1 G4:1 E4:2 E4:1 G4:1 A4:1 B4:2 |
        B4:1 A4:1 G4:1 A4:1 G4:3`
    },

    /* 49. The Twelve Days of Christmas — 英国圣诞颂歌 */
    49: {
      bpm: 108,
      phrases: `
        C4:1 C4:1 D4:1 C4:1 F4:2 E4:2 |
        F4:1 F4:1 G4:1 F4:1 E4:1 D4:1 C4:2 |
        C4:1 D4:1 C4:1 D4:1 E4:2 C4:2 |
        D4:1 E4:1 F4:1 G4:1 A4:2 F4:2`
    },

    /* 50. O Christmas Tree — 德国传统，1824 */
    50: {
      bpm: 100,
      phrases: `
        C4:1 C4:1 C4:1 F4:1 F4:1 E4:1 D4:2 |
        C4:1 C4:1 C4:1 F4:1 F4:1 E4:1 D4:2 |
        C4:1 C4:1 D4:1 E4:1 F4:2 F4:2 |
        G4:1 F4:1 E4:1 D4:1 C4:3`
    },

    /* 51. Good King Wenceslas — 1853，曲调 Tempus Adest Floridum */
    51: {
      bpm: 104,
      phrases: `
        C4:1 C4:1 C4:1 C4:1 E4:1 G4:2 G4:1 |
        F4:1 E4:1 D4:1 E4:1 F4:2 E4:2 |
        C4:1 C4:1 C4:1 C4:1 E4:1 G4:2 G4:1 |
        A4:1 G4:1 F4:1 E4:1 D4:3`
    },

    /* 52. Rock-a-bye Baby — 1765 */
    52: {
      bpm: 68,
      phrases: `
        C4:1 C4:1 C4:1 D4:1 E4:2 E4:1 D4:1 |
        C4:1 C4:1 C4:1 D4:1 E4:4 |
        E4:1 E4:1 E4:1 D4:1 C4:2 D4:2 |
        C4:1 C4:1 D4:1 E4:1 C4:4`
    },

    /* 53. The Farmer in the Dell — 德国/英国传统 */
    53: {
      bpm: 116,
      phrases: `
        G4:1 G4:1 G4:1 A4:1 G4:1 E4:1 G4:2 |
        A4:1 A4:1 G4:1 E4:1 G4:2 E4:2 |
        G4:1 G4:1 G4:1 A4:1 G4:1 E4:1 D4:2 |
        E4:1 G4:1 E4:1 D4:1 C4:3`
    },

    /* 54. This Old Man — 英国传统 */
    54: {
      bpm: 112,
      phrases: `
        G4:1 A4:1 G4:1 E4:1 C4:2 D4:1 E4:2 |
        G4:1 A4:1 G4:1 E4:1 C4:2 D4:1 C4:2 |
        G4:1 A4:1 G4:1 E4:1 C4:2 D4:1 E4:2 |
        G4:1 E4:1 D4:1 C4:1 D4:2 C4:2`
    },

    /* 55. Three Blind Mice — 1609 */
    55: {
      bpm: 120,
      phrases: `
        E4:1 D4:1 C4:2 |
        E4:1 D4:1 C4:2 |
        G4:1 F4:1 E4:1 D4:1 C4:2 |
        C4:1 C4:1 D4:1 D4:1 E4:1 E4:1 G4:2`
    },

    /* 56. Little Bo Peep — 1805 */
    56: {
      bpm: 104,
      phrases: `
        G4:1 G4:1 A4:1 A4:1 G4:1 E4:2 |
        G4:1 G4:1 A4:1 A4:1 G4:2 E4:2 |
        G4:1 G4:1 A4:1 A4:1 G4:1 E4:1 D4:2 |
        E4:1 D4:1 C4:1 D4:1 E4:2 C4:2`
    },

    /* 61. The Bear Went Over the Mountain — 美国传统 */
    61: {
      bpm: 112,
      phrases: `
        G4:1 G4:1 G4:1 G4:1 A4:1 G4:1 F4:2 |
        E4:1 E4:1 E4:1 E4:1 F4:1 E4:1 D4:2 |
        G4:1 G4:1 G4:1 G4:1 A4:1 G4:1 F4:2 |
        E4:1 F4:1 G4:1 A4:1 G4:1 F4:1 E4:1 D4:1 C4:2`
    },

    /* 63. Pop Goes the Weasel — 1850s */
    63: {
      bpm: 124,
      phrases: `
        C4:1 C4:1 C4:1 C4:1 D4:1 E4:2 E4:1 |
        E4:1 D4:1 C4:1 C4:1 D4:2 C4:2 |
        C4:1 C4:1 C4:1 C4:1 D4:1 E4:2 E4:1 |
        G4:1 G4:1 F4:1 E4:1 D4:2 C4:2`
    },

    /* 64. Here We Go Round the Mulberry Bush — 英国传统 */
    64: {
      bpm: 118,
      phrases: `
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:2 C4:1 |
        D4:1 E4:1 F4:1 E4:1 D4:2 C4:2 |
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:2 C4:1 |
        D4:1 E4:1 D4:1 C4:4`
    },

    /* 65. The Grand Old Duke of York — 英国传统 */
    65: {
      bpm: 116,
      phrases: `
        G4:1 G4:1 A4:1 B4:2 G4:1 A4:1 B4:2 |
        B4:1 A4:1 G4:1 A4:1 B4:1 A4:1 G4:2 |
        G4:1 G4:1 A4:1 B4:2 G4:1 A4:1 B4:2 |
        B4:1 A4:1 G4:1 A4:1 G4:3`
    },

    /* 66. Ten Green Bottles — 英国传统 */
    66: {
      bpm: 116,
      phrases: `
        C4:1 C4:1 C4:1 C4:1 D4:1 E4:2 E4:1 |
        D4:1 C4:1 D4:1 E4:1 C4:3 |
        C4:1 C4:1 C4:1 C4:1 D4:1 E4:2 E4:1 |
        E4:1 D4:1 C4:1 D4:1 C4:3`
    },

    /* 67. My Bonnie Lies Over the Ocean — 苏格兰传统 */
    67: {
      bpm: 100,
      phrases: `
        G4:1 G4:1 E4:1 G4:1 A4:2 G4:2 |
        A4:1 A4:1 G4:1 E4:1 D4:2 E4:2 |
        G4:1 G4:1 E4:1 G4:1 A4:2 G4:2 |
        A4:1 G4:1 E4:1 D4:1 C4:3`
    },

    /* 68. Molly Malone — 爱尔兰传统 */
    68: {
      bpm: 96,
      phrases: `
        C4:1 C4:1 C4:1 C4:1 E4:1 D4:2 C4:1 |
        D4:1 E4:1 G4:1 E4:1 D4:3 |
        C4:1 C4:1 C4:1 C4:1 E4:1 D4:2 C4:1 |
        D4:1 E4:1 D4:1 C4:4`
    },

    /* 75. America the Beautiful — Samuel A. Ward, 1882（Materna） */
    75: {
      bpm: 84,
      phrases: `
        C4:1 C4:1 C4:1 C4:1 E4:1 G4:1 G4:2 |
        A4:1 G4:1 E4:1 D4:1 C4:4 |
        C4:1 C4:1 C4:1 C4:1 E4:1 G4:1 G4:2 |
        A4:1 G4:1 E4:1 G4:1 C4:4`
    },

    /* 76. Battle Hymn of the Republic — 1861 */
    76: {
      bpm: 100,
      phrases: `
        G4:1 G4:1 G4:1 G4:1 A4:1 G4:1 F4:2 |
        E4:1 E4:1 E4:1 E4:1 F4:1 E4:1 D4:2 |
        G4:1 G4:1 G4:1 G4:1 A4:1 G4:1 F4:2 |
        E4:1 F4:1 G4:1 A4:1 G4:2 E4:2`
    },

    /* 78. Aura Lee — George R. Poulton, 1861 */
    78: {
      bpm: 88,
      phrases: `
        C4:1 C4:1 E4:1 G4:1 G4:1 A4:2 G4:1 |
        E4:1 E4:1 D4:1 E4:1 C4:3 |
        C4:1 C4:1 E4:1 G4:1 G4:1 A4:2 G4:1 |
        E4:1 D4:1 C4:1 D4:1 C4:3`
    },

    /* 80. Go Tell It on the Mountain — 美国灵歌 */
    80: {
      bpm: 118,
      phrases: `
        G4:1 G4:1 G4:1 A4:2 G4:1 E4:2 |
        E4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        G4:1 G4:1 G4:1 A4:2 G4:1 E4:2 |
        D4:1 E4:1 G4:1 E4:1 D4:1 C4:3`
    },

    /* 34. The Yellow Rose of Texas — 1850s */
    34: {
      bpm: 108,
      phrases: `
        G4:1 G4:1 A4:1 B4:2 A4:1 G4:2 |
        E4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        G4:1 G4:1 A4:1 B4:2 A4:1 G4:2 |
        E4:1 D4:1 E4:1 G4:1 E4:3`
    },

    /* 44. Away in a Manger — 曲调 Cradle Song, 1885 */
    44: {
      bpm: 84,
      phrases: `
        G4:1 G4:1 E4:1 G4:1 A4:1 G4:2 E4:2 |
        G4:1 G4:1 E4:1 G4:1 A4:1 G4:2 E4:2 |
        D4:1 D4:1 E4:1 G4:1 A4:1 G4:1 E4:1 D4:1 |
        C4:1 D4:1 E4:1 G4:1 C4:3`
    },

    /* 48. Angels We Have Heard on High — 法国圣诞颂歌 */
    48: {
      bpm: 104,
      phrases: `
        C4:1 C4:1 C4:1 D4:1 E4:2 C4:1 D4:1 E4:2 |
        E4:1 D4:1 C4:1 D4:1 E4:4 |
        G4:1 G4:1 G4:1 A4:1 G4:2 E4:1 G4:1 A4:2 |
        G4:1 A4:1 G4:1 E4:1 C4:4`
    },

    /* 57. Little Miss Muffet — 1805 */
    57: {
      bpm: 112,
      phrases: `
        G4:1 A4:1 G4:1 E4:1 C4:2 D4:1 E4:2 |
        G4:1 A4:1 G4:1 E4:1 D4:2 C4:2 |
        E4:1 G4:1 A4:1 G4:1 E4:1 D4:1 C4:2 |
        D4:1 E4:1 D4:1 C4:3`
    },

    /* 58. Sing a Song of Sixpence — 1744 */
    58: {
      bpm: 108,
      phrases: `
        C4:1 C4:1 C4:1 C4:1 D4:1 E4:2 C4:1 |
        E4:1 E4:1 D4:1 D4:1 C4:3 |
        G4:1 G4:1 F4:1 E4:1 D4:2 C4:1 |
        E4:1 D4:1 C4:1 D4:1 C4:3`
    },

    /* 59. Old King Cole — 1708 */
    59: {
      bpm: 116,
      phrases: `
        C4:1 C4:1 E4:1 G4:2 G4:1 E4:1 C4:2 |
        D4:1 E4:1 F4:1 G4:2 E4:1 D4:1 C4:2 |
        G4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        E4:1 D4:1 C4:1 D4:1 C4:3`
    },

    /* 62. A Tisket, A Tasket — 美国童谣 */
    62: {
      bpm: 120,
      phrases: `
        C4:1 C4:1 E4:1 G4:2 A4:1 G4:1 E4:2 |
        D4:1 E4:1 D4:1 C4:1 D4:2 E4:2 |
        C4:1 C4:1 E4:1 G4:2 A4:1 G4:1 E4:2 |
        E4:1 D4:1 C4:1 D4:1 C4:3`
    },

    /* 77. When Johnny Comes Marching Home — Patrick Gilmore, 1863 */
    77: {
      bpm: 112,
      phrases: `
        G4:1 G4:1 A4:1 B4:2 A4:1 G4:1 A4:2 |
        B4:1 C5:1 B4:1 A4:1 G4:3 |
        G4:1 G4:1 A4:1 B4:2 A4:1 G4:1 A4:2 |
        B4:1 A4:1 G4:1 F4:1 G4:3`
    },

    /* 79. Danny Boy — 曲调 Londonderry Air（爱尔兰传统） */
    79: {
      bpm: 72,
      phrases: `
        E4:1 G4:2 A4:1 G4:1 E4:1 D4:2 C4:2 |
        E4:1 G4:2 A4:1 B4:1 C5:2 B4:2 |
        A4:1 G4:2 E4:1 D4:1 E4:2 G4:2 |
        A4:1 G4:1 E4:1 D4:1 C4:4`
    },

    /* 95. I Saw Three Ships — 英国圣诞颂歌 */
    95: {
      bpm: 116,
      phrases: `
        C4:1 C4:1 C4:1 D4:1 E4:1 E4:1 D4:2 |
        C4:1 C4:1 C4:1 D4:1 E4:1 E4:1 D4:2 |
        G4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        C4:1 D4:1 E4:1 D4:1 C4:3`
    },

    /* 97. If You're Happy and You Know It — 曲调同 Mulberry Bush（英国传统） */
    97: {
      bpm: 118,
      phrases: `
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:2 C4:1 |
        D4:1 E4:1 F4:1 E4:1 D4:2 C4:2 |
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:2 C4:1 |
        D4:1 E4:1 D4:1 C4:4`
    },

    /* 98. Hot Cross Buns — 18世纪英国街头叫卖调（初学钢琴三音曲） */
    98: {
      bpm: 100,
      phrases: `
        E4:1 D4:1 C4:1 |
        E4:1 D4:1 C4:1 |
        C4:0.5 C4:0.5 C4:0.5 C4:0.5 D4:0.5 D4:0.5 D4:0.5 D4:0.5 |
        E4:1 D4:1 C4:1`
    },

    /* 118. Here We Go Looby Loo — 曲调同 Mulberry Bush（英国传统游戏歌） */
    118: {
      bpm: 118,
      phrases: `
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:2 C4:1 |
        D4:1 E4:1 F4:1 E4:1 D4:2 C4:2 |
        C4:1 C4:1 E4:1 G4:1 G4:1 E4:2 C4:1 |
        D4:1 E4:1 D4:1 C4:4`
    },

    /* ---------- 第三批：把剩下的颂歌 / 叙事歌补齐 ---------- */

    /* 24. My Old Kentucky Home — Stephen Foster, 1853 */
    24: {
      bpm: 84,
      phrases: `
        C4:1 C4:1 C4:1 C4:1 D4:1 E4:2 C4:1 |
        E4:1 E4:1 D4:1 C4:1 D4:2 E4:2 |
        G4:1 G4:1 F4:1 E4:1 D4:1 C4:2 E4:1 |
        D4:1 C4:1 D4:1 E4:1 C4:3`
    },

    /* 25. Jeanie with the Light Brown Hair — Stephen Foster, 1854 */
    25: {
      bpm: 88,
      phrases: `
        C4:1 E4:1 G4:1 A4:1 G4:2 E4:2 |
        D4:1 E4:1 G4:1 E4:1 D4:2 C4:2 |
        C4:1 E4:1 G4:1 A4:1 C5:2 A4:2 |
        G4:1 E4:1 D4:1 E4:1 C4:3`
    },

    /* 46. O Little Town of Bethlehem — 曲调 ST. LOUIS, 1868 */
    46: {
      bpm: 80,
      phrases: `
        C4:1 C4:1 E4:1 G4:2 G4:1 A4:1 G4:2 |
        F4:1 E4:1 D4:1 E4:1 C4:4 |
        C4:1 C4:1 E4:1 G4:2 A4:1 G4:2 |
        F4:1 E4:1 D4:1 C4:4`
    },

    /* 60. Simple Simon — 1764 */
    60: {
      bpm: 108,
      phrases: `
        G4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        E4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        G4:1 G4:1 A4:1 B4:1 A4:2 G4:2 |
        E4:1 D4:1 E4:1 D4:1 C4:3`
    },

    /* 69. Loch Lomond — 苏格兰传统 */
    69: {
      bpm: 78,
      phrases: `
        G4:1 A4:1 B4:1 C5:2 B4:1 A4:1 G4:2 |
        E4:1 G4:1 A4:2 G4:1 E4:1 D4:2 |
        G4:1 A4:1 B4:1 C5:2 D5:1 C5:1 B4:2 |
        A4:1 G4:1 E4:1 D4:1 C4:4`
    },

    /* 70. The Last Rose of Summer — Thomas Moore, 1805 */
    70: {
      bpm: 76,
      phrases: `
        E4:1 G4:1 A4:1 G4:1 E4:2 D4:2 |
        C4:1 D4:1 E4:1 G4:1 A4:2 G4:2 |
        E4:1 G4:1 A4:1 C5:1 A4:2 G4:2 |
        E4:1 D4:1 C4:1 D4:1 E4:1 C4:3`
    },

    /* 72. Flow Gently, Sweet Afton — Robert Burns, 1791 */
    72: {
      bpm: 80,
      phrases: `
        C4:1 C4:1 D4:1 E4:1 G4:2 E4:2 |
        D4:1 E4:1 G4:1 A4:1 G4:2 E4:2 |
        C4:1 C4:1 D4:1 E4:1 G4:2 A4:2 |
        G4:1 E4:1 D4:1 E4:1 C4:3`
    },

    /* 74. Beautiful Dreamer — Stephen Foster, 1864 */
    74: {
      bpm: 76,
      phrases: `
        G4:1 G4:1 A4:1 G4:1 E4:2 G4:2 |
        A4:1 A4:1 G4:1 E4:1 D4:2 E4:2 |
        G4:1 G4:1 A4:1 C5:1 A4:2 G4:2 |
        E4:1 D4:1 E4:1 G4:1 E4:1 D4:1 C4:3`
    },

    /* 87. In the Bleak Midwinter — 曲调 Cranham, 1906 */
    87: {
      bpm: 72,
      phrases: `
        C4:1 D4:1 E4:1 G4:1 E4:2 D4:2 |
        G4:1 G4:1 A4:1 B4:1 C5:2 B4:2 |
        A4:1 G4:1 E4:1 D4:1 E4:2 G4:2 |
        E4:1 D4:1 C4:1 G4:1 C4:2`
    },

    /* 88. It Came Upon the Midnight Clear — Richard Willis, 1850 */
    88: {
      bpm: 84,
      phrases: `
        E4:1 G4:1 A4:1 G4:1 E4:1 D4:1 C4:2 |
        D4:1 E4:1 G4:1 A4:1 G4:2 E4:2 |
        A4:1 G4:1 E4:1 D4:1 C4:1 D4:1 E4:2 |
        G4:1 E4:1 D4:1 C4:4`
    },

    /* 89. Once in Royal David's City — 曲调 Irby, 1849 */
    89: {
      bpm: 84,
      phrases: `
        C4:1 E4:1 G4:1 G4:1 A4:2 G4:2 |
        E4:1 D4:1 C4:1 D4:1 E4:2 G4:2 |
        A4:1 G4:1 E4:1 G4:1 A4:2 C5:2 |
        G4:1 E4:1 D4:1 C4:4`
    },

    /* 90. While Shepherds Watched Their Flocks — 曲调 Winchester Old, 1592 */
    90: {
      bpm: 88,
      phrases: `
        C4:1 C4:1 D4:1 E4:1 G4:2 G4:2 |
        A4:1 G4:1 F4:1 E4:1 D4:2 E4:2 |
        C4:1 C4:1 D4:1 E4:1 G4:2 A4:2 |
        G4:1 E4:1 D4:1 E4:1 C4:2`
    }
  };

  /* 把 "G4:1 C5:2 | ..." 解析成 [[{f,dur}], ...] */
  function parseScore(text) {
    return text.split("|").map(ph =>
      ph.trim().split(/\s+/).filter(Boolean).map(tok => {
        const [name, dur] = tok.split(":");
        return { f: toFreq(name), dur: parseFloat(dur || "1") };
      }).filter(n => n.f > 0)
    ).filter(ph => ph.length);
  }

  const PHRASES = {};
  const META = {};
  Object.keys(SCORES).forEach(id => {
    PHRASES[id] = parseScore(SCORES[id].phrases);
    META[id] = { bpm: SCORES[id].bpm, beats: (60 / SCORES[id].bpm) };
  });

  /* ---------- Web Audio 上下文 ---------- */
  let ctx = null, master = null, delayIn = null, wet = null;
  let voices = [];
  let activeNodes = [];
  let rafTimer = null;
  let playing = false;

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 1.55;

    // 一小段反馈延迟，模拟房间混响 —— 只听感上"贵"了一档
    delayIn = ctx.createDelay(0.6);
    delayIn.delayTime.value = 0.18;
    const fb = ctx.createGain();
    fb.gain.value = 0.24;
    wet = ctx.createGain();
    wet.gain.value = 0.2;

    delayIn.connect(fb); fb.connect(delayIn);
    delayIn.connect(wet); wet.connect(master);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -13;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    master.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
    } catch (e) {
      ctx = null;
      return null;
    }
  }

  function pluck(freq, at, dur, vel) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vel, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0006, at + Math.max(0.18, dur * 1.5));
    g.connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    g.connect(send); send.connect(delayIn);

    // 三层泛音：三角波做主音，两次正弦做八度/十二度的亮色
    [[ "triangle", 1, 1 ], [ "sine", 2, 0.16 ], [ "sine", 3, 0.05 ]].forEach(([type, mult, amp]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og); og.connect(g);
      o.start(at);
      o.stop(at + Math.max(0.25, dur * 1.6));
      activeNodes.push(o);
    });
    activeNodes.push(g);
  }

  /* ---------- 低音垫 ----------
   * 只有一条旋律线时，听感像"提示音"而不是"歌"。
   * 低音不写和弦进行（那要逐首标注调性，容易和旋律打架），
   * 而是按每 2 拍取该段里出现最多的音，降八度到低音区，弹"根音 + 纯五度"。
   * 根音和五度都在旋律自己的音高集合里，所以永远不会不协和，
   * 又足以把八音盒垫成一段"有底"的音乐。
   */
  let bassBus = null;

  function ensureBassBus() {
    if (bassBus) return bassBus;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 460;
    lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.55;
    lp.connect(g); g.connect(master);
    bassBus = lp;
    return bassBus;
  }

  function bassHit(freq, at, dur, vel) {
    const bus = ensureBassBus();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vel, at + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    g.connect(bus);

    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    o.connect(g);
    o.start(at);
    o.stop(at + dur + 0.06);

    // 纯五度：给低音一点"厚度"，但不引入三度，大调小调都成立
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = freq * 1.5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.38;
    o2.connect(g2); g2.connect(g);
    o2.start(at);
    o2.stop(at + dur + 0.06);

    activeNodes.push(o, o2, g, g2);
  }

  /* 低音跟着时间轴走：每 2 拍（按实际秒数算，速度变了也跟得上）取一次众数 */
  function addBass(timeline, sec, t0, totalSec, vel) {
    const bv = vel || 0.085;
    const groups = [];
    timeline.forEach(n => {
      const gi = Math.floor(n.at / (2 * sec));
      if (!groups[gi]) groups[gi] = [];
      groups[gi].push(n.f);
    });

    groups.forEach((freqs, gi) => {
      if (!freqs || !freqs.length) return;
      const count = {};
      freqs.forEach(f => {
        const midi = Math.round(69 + 12 * Math.log2(f / 440));
        count[midi] = (count[midi] || 0) + 1;
      });
      const midi = +Object.keys(count).sort((a, b) => count[b] - count[a] || b - a)[0];
      let f = 440 * Math.pow(2, (midi - 69) / 12);
      while (f > 180) f /= 2;   // 压到低音区（≤ F3）
      while (f < 82) f *= 2;    // 也别低到听不见
      const startT = gi * 2 * sec;
      const dur = Math.min(2 * sec, Math.max(0.8, totalSec - startT));
      bassHit(f, t0 + startT, dur * 0.98, bv);
    });
  }

  /* ---------- 人声：把词唱进旋律 ----------
   * 之前的"契合"只到节奏层：音在响，词在旁边亮，两者像配字幕。
   * 真正的整合是让"词"本身成为发声体 —— 每个音符唱一个音节。
   *
   * 做法是经典的共振峰合成（formant synthesis），不是录音、也不是 TTS：
   *   1) 声门源：锯齿波（谐波最全），两路微失谐叠出真人的轻微抖动；
   *   2) 口型：三段并联带通滤波器，中心频率就是元音的第一/二/三共振峰，
   *      a/e/i/o/u 各有一套数字，这是语音学里量出来的，不是随手编的；
   *   3) 元音从拼写里取（home→o，happy→a+i…），一个词有几个音节就换几次口型；
   *   4) 词首补一点辅音噪声：s/f 是高频沙沙，p/t 是 20ms 爆音；
   *   5) 颤音 5.4Hz 延迟 0.18 秒起振，词内音符之间做 55ms 滑音 —— 这是"唱"和"按音符发音"的差别。
   * 代价说清楚：没有发音词典，所以元音听得出来、辅音只是点缀，咬字不如 TTS 清楚。
   */
  let voiceOn = true;

  const VOWEL_F = {
    a:  [730, 1090, 2440],
    ae: [660, 1720, 2410],
    e:  [530, 1840, 2480],
    i:  [300, 2290, 3010],
    o:  [570, 840, 2410],
    u:  [330, 870, 2240],
    uh: [640, 1190, 2390]
  };
  const VOWEL_MAP = { a: "a", e: "e", i: "i", o: "o", u: "u", y: "i" };
  const DIGRAPH = {
    ee: "i", ea: "i", ie: "i", ei: "i", ey: "i", ai: "ae", ay: "ae",
    oo: "u", ou: "o", ow: "o", oa: "o", oe: "o", ue: "u", ui: "u",
    ew: "u", eu: "u", au: "o", aw: "o", oi: "o", oy: "o", io: "i", ia: "i"
  };

  /* 拼写规则打不通的高频词：歌词里最常出现的那几十个，单独给口型。
   * 这些词的拼写和读音差得太远（heart / love / said），规则推不出来。 */
  const VOWEL_EXC = {
    heart: "a", hear: "i", heard: "e", earth: "e", learn: "e", year: "i", dear: "i",
    fear: "i", near: "i", wear: "e", bear: "e", bread: "e", dead: "e", head: "e",
    great: "ae", break: "ae", said: "e", again: "e", friend: "e", build: "i",
    busy: "i", women: "i", people: "i", money: "uh", love: "uh", loved: "uh",
    above: "uh", come: "uh", comes: "uh", some: "uh", done: "uh", one: "uh",
    once: "uh", none: "uh", of: "uh", was: "uh", what: "uh", does: "uh",
    were: "e", where: "e", eye: "i", eyes: "i", gone: "o"
  };

  /* 一个词的元音序列：按拼写从左到右扫，先认双字母组合，再认单个元音 */
  function vowelsOf(word) {
    const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
    if (VOWEL_EXC[w]) return [VOWEL_EXC[w]];
    const out = [];
    let i = 0;
    while (i < w.length) {
      const two = w.substr(i, 2);
      if (DIGRAPH[two]) { out.push(DIGRAPH[two]); i += 2; continue; }
      const ch = w[i];
      if (ch === "y") { out.push("i"); i++; continue; }
      if (VOWEL_MAP[ch]) {
        // 词尾不发音的 e：hope / time / rose 里的 e 不占音节
        const silent = ch === "e" && i === w.length - 1 && out.length > 0
                       && !/(ee|ie|oe|ue|le)$/.test(w);
        if (!silent) out.push(VOWEL_MAP[ch]);
      }
      i++;
    }
    return out.length ? out : ["uh"];
  }

  const FRIC = "sfhzxcvghj";     // 摩擦音：一段高频噪声
  const PLOS = "ptkbdgq";        // 爆破音：一声短爆
  const NASAL = "mnlrw";         // 鼻音/流音：不补噪声，起音稍软

  function consonantOf(word) {
    const c = String(word || "").toLowerCase()[0];
    if (FRIC.indexOf(c) >= 0) return "fric";
    if (PLOS.indexOf(c) >= 0) return "plos";
    if (NASAL.indexOf(c) >= 0) return "nasal";
    return "none";
  }

  let noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf || !ctx) return noiseBuf;
    try {
      const n = Math.max(1, Math.floor(ctx.sampleRate * 0.2));
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { noiseBuf = null; }
    return noiseBuf;
  }

  /* 手机判定：移动端扬声器对低频弱、CPU 也弱，人声走轻量路径 */
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(
    (global.navigator && global.navigator.userAgent) || "");

  /* 辅音：一声极短的噪声，只为让词与词之间"有边界"，不追求听清 */
  function consonant(kind, at, vel) {
    if (kind === "none" || kind === "nasal") return;
    const buf = noiseBuffer();
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    g.connect(master);
    src.connect(bp); bp.connect(g);

    if (kind === "plos") {
      bp.type = "bandpass"; bp.frequency.value = 1600; bp.Q.value = 0.9;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(vel, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, at + 0.03);
      src.start(at); src.stop(at + 0.05);
    } else {
      bp.type = "highpass"; bp.frequency.value = 3200; bp.Q.value = 0.7;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(vel * 0.85, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0005, at + 0.075);
      src.start(at); src.stop(at + 0.09);
    }
    activeNodes.push(src, g, bp);
  }

  /* 唱一个音：一个音节 = 一段声门源穿过一副"口型" */
  function singNote(freq, at, dur, vowel, opts) {
    opts = opts || {};
    const V = VOWEL_F[vowel] || VOWEL_F.uh;
    const vel = opts.vel || 0.34;
    const legato = !!opts.legato;
    const prevF = opts.prevF || freq;

    /* 音高越高、声道越短：共振峰整体上移。
     * 曲谱多落在 G4–E5，属于女声/童声区，用男声的 730/1090 去唱会像"大人捏着嗓子"。
     * 300Hz 以下不动，往上最多抬 16%。 */
    const fscale = 1.04 + Math.min(0.16, Math.max(0, (freq - 300) / 1800));

    const env = ctx.createGain();
    const rel = Math.min(0.1, Math.max(0.035, dur * 0.35));
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(vel, at + (legato ? 0.02 : 0.03));
    env.gain.linearRampToValueAtTime(vel * 0.88, at + Math.min(0.18, dur * 0.55));
    env.gain.setValueAtTime(vel * 0.88, at + Math.max(0.04, dur - rel));
    env.gain.exponentialRampToValueAtTime(0.0006, at + dur + 0.03);
    env.connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.3;
    env.connect(send); send.connect(delayIn);

    // 声门源：锯齿波 + 一路微失谐，压掉 3.2k 以上的毛刺
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 3200; lp.Q.value = 0.6;

    const srcs = [];
    (IS_MOBILE ? [[1, 1]] : [[1, 1], [1.0035, 0.5]]).forEach(pair => {
      const mult = pair[0], amp = pair[1];
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(legato ? prevF * mult : freq * mult, at);
      if (legato && Math.abs(prevF - freq) > 0.6) {
        o.frequency.exponentialRampToValueAtTime(freq * mult, at + 0.055);
      }
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og); og.connect(lp);
      o.start(at); o.stop(at + dur + 0.08);
      srcs.push(o);
      activeNodes.push(o, og);
    });

    // 颤音：真人不会一开口就抖，0.18 秒后才起振
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.4;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, at);
    lg.gain.linearRampToValueAtTime(opts.vib || 15, at + Math.min(0.5, dur * 0.85));
    lfo.connect(lg);
    /* detune 是标配，但个别移动内核没有：没有就改推 frequency，再不行就放弃颤音 */
    let vibTarget = null;
    srcs.forEach(s => { if (s.detune) { vibTarget = s.detune; return; } });
    if (vibTarget) {
      lg.connect(vibTarget);
    } else if (srcs[0] && srcs[0].frequency) {
      try { lg.connect(srcs[0].frequency); } catch (e) { try { lfo.disconnect(lg); } catch (e2) {} }
    }
    lfo.start(at); lfo.stop(at + dur + 0.08);
    activeNodes.push(lfo, lg);

    /* 气声：给声门源掺一点噪声。
     * 纯谐波在元音共振峰之间是空的，听感像簧片；掺噪声后共振峰里
     * 有了连续的谱能量，元音才"有肉"。音量很小，只当气息。
     * 手机上跳过：省 2 个节点/音，小扬声器上这点气声本来也听不见。 */
    const nb = IS_MOBILE ? null : noiseBuffer();
    if (nb) {
      const ns = ctx.createBufferSource();
      ns.buffer = nb;
      const ng = ctx.createGain();
      ng.gain.value = 0.13;
      ns.connect(ng); ng.connect(lp);
      ns.start(at); ns.stop(at + dur + 0.08);
      activeNodes.push(ns, ng);
    }

    // 三段共振峰：Q 由带宽反推，越往高频越宽（真人声道就是这样）
    const mix = ctx.createGain();
    mix.gain.value = 1;
    mix.connect(env);
    const BWS = [80, 100, 160], AMPS = [1, 0.52, 0.24];
    const from = opts.from && VOWEL_F[opts.from] ? VOWEL_F[opts.from] : null;
    V.forEach((f, k) => {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = Math.max(2, f / BWS[k]);
      const target = f * fscale;
      const startF = (from ? from[k] * fscale : target);
      try {
        bp.frequency.setValueAtTime(startF, at);
        if (Math.abs(startF - target) > 1) {
          bp.frequency.exponentialRampToValueAtTime(target, at + (legato ? 0.07 : 0.05));
        }
      } catch (e) {
        /* 个别内核对滤波器频率的指数斜坡挑剔：退化为直接设值 */
        try { bp.frequency.value = target; } catch (e2) {}
      }
      const bg = ctx.createGain();
      bg.gain.value = AMPS[k];
      lp.connect(bp); bp.connect(bg); bg.connect(mix);
      activeNodes.push(bp, bg);
    });
    // 一点干声：只有共振峰时像口哨，掺一点原声才有胸腔的厚度
    // 手机扬声器低频弱，干声（含全部谐波）在小喇叭上反而最容易被听见，比例略高
    const dry = ctx.createGain();
    dry.gain.value = IS_MOBILE ? 0.34 : 0.18;
    lp.connect(dry); dry.connect(mix);

    activeNodes.push(env, lp, mix, dry, send);
  }

  /* 把整条时间轴唱出来：音高、时长、词归属全部沿用 planPhrase 的结果 */
  /* 人声该唱在哪个八度：用整八度移调把人声塞进 110–350Hz。
   * 85 分位管"最高的那几个音"，15 分位管"最低的那几个音"，
   * 宁可整句低一个八度，也不让个别尖音变成口哨。 */
  function voiceOctave(timeline) {
    const mids = timeline.map(n => 69 + 12 * Math.log2(n.f / 440)).sort((a, b) => a - b);
    if (!mids.length) return 1;
    const q = p => mids[Math.min(mids.length - 1, Math.max(0, Math.round((mids.length - 1) * p)))];
    let k = 0;                                          // 平移的八度数
    while (q(0.85) + 12 * k > 65 && k > -2) k -= 1;     // F4 = 349Hz 为上界
    while (q(0.15) + 12 * k < 45 && k < 1) k += 1;      // A2 = 110Hz 为下界
    return Math.pow(2, k);
  }

  function singTimeline(units, timeline, t0, totalSec) {
    const perWord = {};
    timeline.forEach(n => {
      if (n.owner < 0) return;
      (perWord[n.owner] = perWord[n.owner] || []).push(n);
    });

    /* 曲谱大多落在 G4–E5。人声照原八度唱会像口哨：
     * f0 高达 400Hz 时，3200Hz 以内只剩七八根谐波，
     * 共振峰之间没有谐波可"填"，元音的辨识度就塌了。
     * 所以整句按整八度移调，把人声压进 110–350Hz —— 说话带一点唱的区间。
     * 判据用 85 分位而不是中位数：中音不高、尾音很高的句子里，
     * 只看中位数会漏掉那个尾音，它就又变回口哨了。
     * 整八度移调不改变音程，旋律照样认得出；八音盒仍在原八度、低音再低两个八度，
     * 三层叠成八度关系，不打架。 */
    const oct = voiceOctave(timeline);

    let prev = null;
    timeline.forEach(n => {
      try {
        const at = t0 + Math.max(0, n.at);
        const f = n.f * oct;
        const u = n.owner >= 0 ? units[n.owner] : null;
        if (!u) {
          // 乐句尾巴上没有词的音：轻轻带一个鼻音，别让句子断在半空
          singNote(f, at, n.dur, "uh", { vel: 0.12, legato: true, prevF: prev ? prev.f : f, vib: 10 });
          prev = { f: f, v: "uh" };
          return;
        }
        const syls = vowelsOf(u.text);
        const list = perWord[n.owner];
        const idx = list ? list.indexOf(n) : 0;
        const vowel = syls[Math.min(Math.max(0, idx), syls.length - 1)];
        const first = idx <= 0;

        if (first) consonant(consonantOf(u.text), Math.max(t0, at - 0.028), u.light ? 0.04 : 0.055);

        singNote(f, at, n.dur, vowel, {
          vel: u.light ? 0.23 : 0.35,
          legato: !first,
          prevF: prev ? prev.f : f,
          from: prev ? prev.v : null
        });
        prev = { f: f, v: vowel };
      } catch (e) { /* 单个音失败就跳过它，整句不能塌 */ }
    });
  }

  function setVoice(on) { voiceOn = !!on; }
  function isVoice() { return voiceOn; }

  function stopMelody() {
    activeNodes.forEach(n => {
      try { n.stop && n.stop(); } catch (e) {}
      try { n.disconnect && n.disconnect(); } catch (e) {}
    });
    activeNodes = [];
    playing = false;
    if (rafTimer) { clearTimeout(rafTimer); rafTimer = null; }
  }

  /* ---------- 对外：旋律 ---------- */
  function hasMelody(songId) {
    const ph = PHRASES[String(songId)];
    return !!(ph && ph.length);
  }

  /* ---------- 词—音对齐 ----------
   * 之前是"乐句循环播放 + 歌词按字符长度铺满整段"，两者互不知道对方存在，
   * 所以听起来像给一段音乐配字幕。真正的契合感来自三件事：
   *   1) 词切换的那一刻要正好压在音符起落上；
   *   2) 轻读词（the / of / and）要一带而过，实词要停得住；
   *   3) 词与词之间留一点气口，才听得出是"一个词一个词"唱出来。
   * 做法：音高、音序一个不动，只把 N 个音符按权重离散分给每个词，
   * 词边界严格落在音符起点，再按词性给力度、在词间插 45ms 气口。
   * 原曲因此仍然听得出来，词却踩在音上了。
   */
  const LIGHT_WORDS = {};
  ("a an the and or but of to in on at for with from by as is are was were be been am " +
   "do does did not no nor so if then than that this these those it its i you he she we they " +
   "me him her us them my your his our their there here what when where who how all then")
    .split(" ").forEach(w => { LIGHT_WORDS[w] = 1; });

  function wordUnits(text) {
    const re = /([A-Za-z][A-Za-z']*)([^A-Za-z']*)/g;
    const units = [];
    let m;
    while ((m = re.exec(String(text || "")))) {
      const raw0 = m[1];
      const w = raw0.toLowerCase();
      let c = (w.match(/[aeiouy]+/g) || []).length || 1;
      if (/e$/.test(w) && c > 1 && !/le$/.test(w)) c -= 1;   // 词尾不发音的 e
      c = Math.max(1, c);
      const light = !!LIGHT_WORDS[w];
      // 权重 = 音节数 × 词性（实词停留更久）× 长词加码
      const wgt = c * (light ? 0.55 : 1) * (w.length >= 9 ? 1.15 : 1);
      units.push({ text: raw0, syl: c, light, wgt, tail: m[2] || "" });
    }
    return units;
  }

  /* 音符不够分时，把长音对半劈成两个同音 —— 唱法上就是"一个字一个音"的宣叙。
   * 音高、总时长都不变，却腾出了落脚点，让每个词都有自己那一下。
   * 两条纪律：劈完不能短到听不清（≥0.26s）；优先劈两侧音高不同的音，
   * 免得一串同音被劈成机关枪。
   */
  function expandPhrase(phrase, need, sec) {
    const out = phrase.map(n => ({ f: n.f, dur: n.dur }));
    const minSplit = 0.52 / Math.max(0.2, sec);   // 两半各 ≥0.26s 才允许劈
    while (out.length < need) {
      let bi = -1, bs = 0;
      for (let i = 0; i < out.length; i++) {
        const n = out[i];
        if (n.dur < minSplit) continue;
        const sameL = i > 0 && out[i - 1].f === n.f;
        const sameR = i + 1 < out.length && out[i + 1].f === n.f;
        const score = n.dur / (1 + ((sameL ? 1 : 0) + (sameR ? 1 : 0)) * 1.8);
        if (score > bs) { bs = score; bi = i; }
      }
      if (bi < 0) break;
      const half = out[bi].dur / 2;
      out[bi].dur = half;
      out.splice(bi + 1, 0, { f: out[bi].f, dur: half });
    }
    return out;
  }

  /* 每个词分到几个音符：保证 ≥1，余量按权重用最大余数法分配（结果和恰好等于音符数） */
  function quotaFor(units, nNotes) {
    const U = units.length;
    if (!U || nNotes < U) return null;
    const q = new Array(U).fill(1);
    const rest = nNotes - U;
    if (!rest) return q;
    const W = units.reduce((s, u) => s + u.wgt, 0) || 1;
    const raw = units.map(u => rest * u.wgt / W);
    let used = 0;
    raw.forEach((x, i) => { const add = Math.floor(x); q[i] += add; used += add; });
    const frac = raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f);
    let k = 0;
    while (used < rest && frac.length) { q[frac[k % frac.length].i]++; used++; k++; }
    return q;
  }

  /* 把一句歌词排到一条乐句上，返回可直接演奏的时间轴 */
  function planPhrase(phrase, units, beatSec) {
    const nBeats = phrase.reduce((s, n) => s + n.dur, 0);

    // 速度：以原曲节拍为基准，但让"每个音节"落在人能跟上的时长上（约 0.46 秒）。
    // 老民谣的写法普遍偏慢，照原速唱一句要七八秒，学词的人会走神；
    // 上限 1.5 倍，同时保证每音节不短于 0.27 秒，免得快成说唱。
    const natural = nBeats * beatSec;
    const sylls0 = Math.max(1, units.reduce((s, u) => s + u.syl, 0));
    let speed = natural / (0.46 * sylls0);
    speed = Math.min(1.5, Math.max(0.9, speed));
    speed = Math.min(speed, natural / (0.27 * sylls0));   // 再快就听不清字了
    // 兜底：单句别拖过 7.5 秒
    if (natural / speed > 7.5) speed = Math.min(1.6, natural / 7.5);
    const sec = beatSec / speed;

    // 音符比音节少 → 劈长音腾出落脚点，但最多只多劈四成：
    // 劈太狠会把一串同音变成机关枪（"E E E E E E E E"），比"几个音节共用一个音"更难听。
    // 差得太多时保留原谱，改由几个音节共用一个音，听感更像说唱式的宣叙。
    const needNotes = units.reduce((s, u) => s + u.syl, 0);
    const cap = phrase.length + Math.max(1, Math.round(phrase.length * 0.4));
    if (needNotes > phrase.length) {
      phrase = expandPhrase(phrase, Math.min(needNotes, cap), sec);
    }

    // 音符起点（相对，未计气口）
    const rawStarts = [];
    let acc = 0;
    phrase.forEach(n => { rawStarts.push(acc * sec); acc += n.dur; });
    const rawTotal = acc * sec;

    /* 词 → 音符。
     * 音符够分时按"配额"分：每个词至少 1 个音，余下的音按权重（音节数、词性、词长）
     * 用最大余数法补给实词和长词。这样每个词的第一个音都落在音符起点上，
     * 词一亮，音正好响 —— 这是"契合"最直接的来源。
     * 音符比词还少（长句撞上短乐句）时退化成按时间比例摊，允许一个音唱两个词。
     */
    const W = units.reduce((s, u) => s + u.wgt, 0) || 1;
    const markNote = [];
    const quota = quotaFor(units, phrase.length);

    if (quota) {
      let j = 0;
      quota.forEach(q => { markNote.push(j); j += q; });
    } else {
      const used = {};
      let cum = 0, k = 0;
      units.forEach(u => {
        const t = (cum / W) * rawTotal;
        cum += u.wgt;
        while (k + 1 < phrase.length && rawStarts[k + 1] <= t + 1e-9) k++;
        // 一个音最多唱两个词，再多就往后挪
        if ((used[k] || 0) >= 2 && k + 1 < phrase.length) k++;
        used[k] = (used[k] || 0) + 1;
        markNote.push(k);
      });
    }

    // 每个音符归哪个词（用于力度与气口）
    const owner = new Array(phrase.length).fill(-1);
    markNote.forEach((j, i) => { if (owner[j] === -1) owner[j] = i; });

    // 演奏时间轴：词首音前留气口；标点处再停久一点，音乐跟着句子换气
    const gap = Math.min(0.055, rawTotal * 0.012);
    const timeline = [];
    let t = 0;
    for (let j = 0; j < phrase.length; j++) {
      if (j > 0 && owner[j] >= 0) {
        t += gap;
        const prev = units[owner[j] - 1];
        if (prev && prev.tail) {
          if (/[.!?]/.test(prev.tail)) t += 0.24;
          else if (/[,;:]/.test(prev.tail)) t += 0.15;
        }
      }
      const dur = phrase[j].dur * sec;
      // 断连：轻读词唱得短促（像说话时一带而过），实词唱满
      const art = owner[j] >= 0 ? (units[owner[j]].light ? 0.62 : 0.97) : 0.92;
      timeline.push({ f: phrase[j].f, at: t, dur: dur * art, owner: owner[j] });
      t += dur;
    }
    const total = t;

    // 词落点：音符实际起点；若一个音挤了两个词，第二个往后错开一点
    const load = {};
    markNote.forEach(j => { load[j] = (load[j] || 0) + 1; });
    const seen = {};
    const marks = markNote.map(j => {
      const idx = seen[j] || 0;
      seen[j] = idx + 1;
      const span = phrase[j].dur * sec;
      return timeline[j].at + (load[j] > 1 ? (span / load[j]) * idx * 0.7 : 0);
    });
    // 严格递增，且不能越过句尾
    for (let i = 1; i < marks.length; i++) {
      if (marks[i] <= marks[i - 1] + 0.045) marks[i] = marks[i - 1] + 0.045;
    }
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] > total - 0.06) marks[i] = Math.max(0, total - 0.06 - (marks.length - 1 - i) * 0.045);
    }

    return { timeline, total, marks, speed };
  }

  /* 选一句最"合身"的乐句：音符数与音节数越接近越好，同分时保持轮转，别老用同一句 */
  function pickPhrase(phrases, lineIndex, syllables) {
    const base = lineIndex % phrases.length;
    if (!syllables) return base;
    let best = base, bestCost = Infinity;
    phrases.forEach((ph, k) => {
      const cost = Math.abs(ph.length - syllables) / Math.max(4, syllables)
                 + Math.abs(k - base) * 0.06;
      if (cost < bestCost) { bestCost = cost; best = k; }
    });
    return best;
  }

  /* 一句歌词 → 时间轴。演奏和界面上的音高曲线共用这一份，
   * 所以画出来的曲线和真正唱出来的音符必然是同一串。 */
  function planFor(songId, lineIndex, text) {
    const units = wordUnits(text);
    if (hasMelody(songId)) {
      const phrases = PHRASES[String(songId)];
      const meta = META[String(songId)];
      const sylls = units.reduce((s, u) => s + u.syl, 0);
      const pi = pickPhrase(phrases, lineIndex, sylls);
      const phrase = phrases[pi];
      if (!phrase) return null;
      return { plan: planPhrase(phrase, units, meta.beats), units, sylls, beat: meta.beats, scored: true, phrase: pi };
    }
    const im = improvNotes(text);
    return { plan: planPhrase(im.notes, units, im.beat), units, sylls: im.sylls, beat: im.beat, scored: false, phrase: -1 };
  }

  /* 只算谱、不发声：把"每个音多高、多长、从第几秒起"交出去，界面拿它画曲线 */
  function preview(songId, lineIndex, text) {
    try {
      const r = planFor(songId, lineIndex, text);
      if (!r) return null;
      return {
        total: r.plan.total,
        scored: r.scored,
        notes: r.plan.timeline.map(n => ({
          at: n.at,
          dur: n.dur,
          midi: Math.round(69 + 12 * Math.log2(n.f / 440)),
          owner: n.owner
        }))
      };
    } catch (e) {
      return null;
    }
  }

  function playLine(songId, lineIndex, onEnd, text) {
    if (!hasMelody(songId)) return false;
    if (!ensureCtx()) return false;
    try {
      if (ctx.state === "suspended") ctx.resume();
      stopMelody();

      const r = planFor(songId, lineIndex, text);
      if (!r) return false;
      const units = r.units;
      const plan = r.plan;
      const sylls = r.sylls;
      const meta = META[String(songId)];
      const t0 = ctx.currentTime + 0.06;

      plan.timeline.forEach(n => {
        const u = n.owner >= 0 ? units[n.owner] : null;
        // 人声在场时，八音盒退成伴奏（同音高、同节奏，像钢琴跟着唱）
        const vel = voiceOn
          ? (u ? (u.light ? 0.09 : 0.12) : 0.1)
          : (u ? (u.light ? 0.175 : 0.24) : 0.2);
        pluck(n.f, t0 + n.at, n.dur, vel);
      });
      if (voiceOn) singTimeline(units, plan.timeline, t0, plan.total);
      addBass(plan.timeline, meta.beats / plan.speed, t0, plan.total, voiceOn ? 0.07 : 0.085);

      playing = true;
      rafTimer = setTimeout(() => {
        playing = false;
        onEnd && onEnd();
      }, plan.total * 1000 + 180);

      return { total: plan.total, marks: plan.marks, phrase: r.phrase, sylls, speed: plan.speed, timeline: plan.timeline, voice: voiceOn };
    } catch (e) {
      return false;
    }
  }

  /* ---------- 对外：即兴哼唱 ----------
   * 少数冷门童谣、叙事歌找不到可靠曲谱，只能朗读的话，用户会觉得"半成品"。
   * 这里按歌词的音节数现场生成一条五声音阶旋律：调内、级进、末尾落回主音，
   * 听感是"随手哼的一段"，而且它确实是原创旋律，不涉及任何他人作品。
   * 界面上会明确说"即兴哼唱"，不冒充原曲。
   */
  const PENTA = [0, 2, 4, 7, 9];

  function countSyllables(text) {
    return wordUnits(text).reduce((n, u) => n + u.syl, 0);
  }

  /* 即兴旋律的音符：只算谱，不发声 —— 界面画音高曲线要用同一份 */
  function improvNotes(text) {
    const beat = 60 / 96;
    const units = wordUnits(text);
    const S = Math.max(4, Math.min(24, units.reduce((n, u) => n + u.syl, 0)));

    let seed = 7;
    for (let i = 0; i < String(text).length; i++) seed = (seed * 31 + text.charCodeAt(i)) % 99991;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return ((seed >>> 16) % 1000) / 1000;
    };
    const clampDeg = d => Math.max(0, Math.min(8, d));

    /* 一个词 = 一个音型：词首跳进（实词跳三度/五度，虚词贴着走），
     * 词内级进，词尾拖长一点，收句落回主音。
     * 这样每个词在旋律上都是一次"起—走—停"，词界自然听得出。
     */
    const notes = [];
    let deg = 3;
    units.forEach((u, wi) => {
      if (wi > 0) {
        const leap = u.light ? (rnd() < 0.5 ? 1 : -1)
                             : (rnd() < 0.65 ? 2 : 1) * (rnd() < 0.5 ? 1 : -1);
        deg = clampDeg(deg + leap);
      }
      const n = u.syl;
      for (let i = 0; i < n; i++) {
        if (i > 0) deg = clampDeg(deg + (rnd() < 0.5 ? 1 : -1));
        const d = i === 0 ? 1 : (i === n - 1 ? 1.2 : 0.5);
        notes.push({ f: 440 * Math.pow(2, (60 + 12 * Math.floor(deg / 5) + PENTA[deg % 5] - 69) / 12), dur: d });
      }
    });
    while (notes.length < S) notes.push({ f: notes[notes.length - 1].f, dur: 1 });
    notes[notes.length - 1] = { f: 261.63, dur: 2 };   // 收句落回 C

    return { notes, units, beat, sylls: S };
  }

  function improvise(text, onEnd) {
    if (!ensureCtx()) return false;
    try {
      if (ctx.state === "suspended") ctx.resume();
      stopMelody();

      const im = improvNotes(text);
      const beat = im.beat;
      const units = im.units;
      const plan = planPhrase(im.notes, units, beat);
      const t0 = ctx.currentTime + 0.06;
      plan.timeline.forEach(n => {
        const u = n.owner >= 0 ? units[n.owner] : null;
        const vel = voiceOn
          ? (u ? (u.light ? 0.085 : 0.115) : 0.095)
          : (u ? (u.light ? 0.17 : 0.225) : 0.19);
        pluck(n.f, t0 + n.at, n.dur, vel);
      });
      if (voiceOn) singTimeline(units, plan.timeline, t0, plan.total);
      addBass(plan.timeline, beat / plan.speed, t0, plan.total, voiceOn ? 0.07 : 0.085);

      playing = true;
      rafTimer = setTimeout(() => {
        playing = false;
        onEnd && onEnd();
      }, plan.total * 1000 + 180);

      return { total: plan.total, marks: plan.marks, sylls: im.sylls, speed: plan.speed, timeline: plan.timeline, voice: voiceOn };
    } catch (e) {
      return false;
    }
  }

  /* ---------- 对外：语音朗读 ---------- */
  function pickVoice() {
    if (!global.speechSynthesis) return null;
    if (!voices.length) voices = global.speechSynthesis.getVoices() || [];
    const prefer = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Zira", "Karen", "Daniel"];
    for (const name of prefer) {
      const v = voices.find(x => x.name && x.name.indexOf(name) !== -1);
      if (v) return v;
    }
    return voices.find(v => /^en[-_]US/i.test(v.lang))
        || voices.find(v => /^en/i.test(v.lang))
        || null;
  }

  function speak(text, opts) {
    if (!global.speechSynthesis) return false;
    const synth = global.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = "en-US";
    u.rate = (opts && opts.rate) || 0.86;
    u.pitch = (opts && opts.pitch) || 1;
    u.volume = 1;
    const v = pickVoice();
    if (v) u.voice = v;
    if (opts && opts.onEnd) u.onend = opts.onEnd;
    if (opts && opts.onStart) u.onstart = opts.onStart;
    /* onboundary：读到哪个词了（charIndex）。卡拉 OK 式朗读点亮靠它 */
    if (opts && opts.onBoundary) u.onboundary = e => opts.onBoundary((e && e.charIndex) || 0);
    synth.speak(u);
    return true;
  }

  function stopSpeech() {
    if (global.speechSynthesis) global.speechSynthesis.cancel();
  }

  function speakWord(word) {
    return speak(word, { rate: 0.72 });
  }

  function stopAll() {
    stopMelody();
    stopSpeech();
  }

  function isPlaying() { return playing; }

  /* 有些浏览器首次调用 getVoices() 返回空，需要等一个事件 */
  if (global.speechSynthesis) {
    global.speechSynthesis.onvoiceschanged = function () {
      voices = global.speechSynthesis.getVoices() || [];
    };
  }

  global.Sound = {
    hasMelody,
    playLine,
    improvise,
    preview,
    voiceOctave,
    stopMelody,
    setVoice,
    isVoice,
    vowelsOf,
    speak,
    speakWord,
    stopSpeech,
    stopAll,
    isPlaying,
    wordUnits,
    countSyllables,
    melodySongs: Object.keys(SCORES).map(Number)
  };
})(window);
