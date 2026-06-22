import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot, doc, setDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInAnonymously } from 'firebase/auth';
import { Activity, Zap, Target, Crosshair, Lock, User, LogOut, CreditCard, BarChart2, Cpu, Shield, ArrowRight, CheckCircle, XCircle, Loader } from 'lucide-react';

// ─── Custom Responsive Hook ───────────────────────────────────────────────────
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false); // Safe default for SSR/Build
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    handleResize(); // Set correct value after mount on the client
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
};

// ─── Firebase Setup ───────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCnDzXhHDmfx5SAYcS0hNIuZhA2Lt1C3QA",
  authDomain: "auth.alphastructure.io",
  projectId: "alphastructure",
  storageBucket: "alphastructure.firebasestorage.app",
  messagingSenderId: "962716149021",
  appId: "1:962716149021:web:d7dd8f55a09b11ce54adf4",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'default-app-id'; // Hardcoded for production Vercel builds

// ─── Seeded RNG + 200 Candle Generator ────────────────────────────────────────
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
const _cc = {};
function getSimCandles(sym, base, dir = 'DOWN', n = 200) {
  if (_cc[sym]) return _cc[sym];
  const rng = seededRng(sym.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
  const now = Math.floor(Date.now() / 1000), M = 900;
  const trend = dir === 'DOWN' ? -0.00015 : 0.00018;
  let p = dir === 'DOWN' ? base * 1.04 : base * 0.96;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const noise = (rng() - 0.48) * 0.0016;
    const o = p, c = p * (1 + trend + noise);
    const wick = Math.abs(o - c) * (0.3 + rng() * 1.2);
    out.push({ 
      t: now - i * M, o, 
      h: Math.max(o, c) + wick * rng(), 
      l: Math.min(o, c) - wick * rng(), 
      c, 
      v: Math.floor(rng() * 8000 + 1200) 
    });
    p = c;
  }
  _cc[sym] = out;
  return out;
}

// ─── Symbol config + simulated data ──────────────────────────────────────────
const SCFG = {
  GBPUSD: { price: 1.32060,  dir: 'DOWN', atr: 0.00052 },
  BTCUSD: { price: 62761.91, dir: 'DOWN', atr: 450    },
  US30:   { price: 51744,    dir: 'UP',   atr: 87      },
  XAUUSD: { price: 2515.30,  dir: 'UP',   atr: 8.33   },
  EURUSD: { price: 1.14594,  dir: 'DOWN', atr: 0.0007 },
  USDJPY: { price: 144.85,   dir: 'UP',   atr: 0.25   },
  GBPJPY: { price: 185.50,   dir: 'DOWN', atr: 0.32   },
  USOIL:  { price: 68.40,    dir: 'DOWN', atr: 0.45   },
};
function buildSim(sym) {
  const { price, dir, atr } = SCFG[sym];
  const candles = getSimCandles(sym, price, dir, 200);
  const range = price * 0.015, pH = price * (dir === 'DOWN' ? 1.008 : 1.004), pL = price * (dir === 'DOWN' ? 0.992 : 0.996);
  const now = Math.floor(Date.now() / 1000), M = 900;
  return {
    price, atr, dominant_dir: dir,
    htf_bias: dir === 'UP' ? 'BULLISH' : 'BEARISH',
    m15_structure: dir === 'DOWN' ? 'DOWNTREND' : 'UPTREND',
    fib_50: dir === 'UP' ? pH - range * 0.5  : pL + range * 0.5,
    fib_618: dir === 'UP' ? pH - range * 0.618 : pL + range * 0.618,
    fib_786: dir === 'UP' ? pH - range * 0.786 : pL + range * 0.786,
    p_range: { high: pH, low: pL },
    bear_tl: dir === 'DOWN' ? { valid: true, pts: [{ ts: now - 55 * M, price: pH * 0.997 }, { ts: now - 20 * M, price: pH * 0.991 }], projected_price: pH * 0.988 } : { valid: false, pts: [] },
    bull_tl: dir === 'UP'   ? { valid: true, pts: [{ ts: now - 50 * M, price: pL * 1.002 }, { ts: now - 22 * M, price: pL * 1.006 }], projected_price: pL * 1.009 } : { valid: false, pts: [] },
    swing_highs: [{ t: now - 52 * M, p: price * 1.005 }, { t: now - 24 * M, p: price * 1.002 }],
    swing_lows:  [{ t: now - 42 * M, p: price * 0.996 }, { t: now - 14 * M, p: price * 0.998 }],
    signal: { decision: 'HOLD', score: 55, regime: 'DOWN_IMPULSE', location: 'DISCOUNT FLOOR', thesis: 'Score 55/100 < 70 gate. HTF: BEARISH | M15: DOWNTREND | VSA: NEUTRAL | TL: None [Bear Reject] [Bull Reject]' },
    positions: [{ ticket: 101, type: "SHORT", volume: 0.5, open_price: price*1.002, sl: price*1.005, tp: price*0.990, pnl: -1.92 }], 
    orders: [], 
    candles,
  };
}
const SIM = Object.fromEntries(Object.keys(SCFG).map(s => [s, buildSim(s)]));

// ─── Subscriptions & Plans ───────────────────────────────────────────────────
const DEFAULT_PLANS = [
  { id: 'free', name: '7-Day Free Trial', price: 0, interval: '7 Days', features: ['Access to daily bias', 'End of day reports', 'Community access'], color: '#334155' },
  { id: 'monthly', name: 'Alpha Pro (Monthly)', price: 20, interval: 'Month', features: ['Live Engine Telemetry', 'M15/H1 Execution Signals', 'Advanced Trade Management', 'Discord VIP'], color: '#38bdf8' },
  { id: 'quarterly', name: 'Alpha Pro (Quarterly)', price: 51, interval: '3 Months', discount: '15% OFF', features: ['All Monthly Features', 'Unrestricted Desktop .exe', 'Auto-Trade Execution', '1-on-1 Support'], color: '#10b981' }
];

// ─── Interactive Pure HTML5 Canvas Chart ──────────────────────────────────────
const StructuralChart = ({ data, symbol, isMobile }) => {
  const wrapRef   = useRef(null);
  const canvasRef = useRef(null);
  
  const panRef = useRef(0);
  const zoomRef = useRef(50);
  const mouseRef = useRef(null);
  const yStretchRef = useRef(1.0);
  const yOffsetRef = useRef(0.0);
  const pricePerPixelRef = useRef(0.0);
  const isDraggingX = useRef(false);
  const isDraggingY = useRef(false);
  const dragStartX = useRef(0);
  const dragStartY = useRef(0);
  const dragStartStretch = useRef(1.0);
  const dragStartOffset = useRef(0.0);
  const initialPinchDist = useRef(null);
  const initialZoom = useRef(null);

  const draw = useCallback(() => {
    if (!wrapRef.current || !data || !canvasRef.current) return;
    const totalCandles = (data.candles?.length > 0) ? data.candles : getSimCandles(symbol, data.price || 1, data.dominant_dir || 'DOWN', 200);
    if (!totalCandles.length) return;

    const TW  = wrapRef.current.clientWidth;
    const TH  = wrapRef.current.clientHeight;
    const VH  = 60;   
    const XH  = 24;   
    const GAP = 8;
    const MH  = TH - VH - XH - GAP;  
    
    const ml = 10, mr = isMobile ? 55 : 80, mt = 20;
    const W   = TW - ml - mr;
    const dpr = window.devicePixelRatio || 1;

    const cv = canvasRef.current;
    cv.width  = TW * dpr; cv.height = TH * dpr;
    cv.style.width = `${TW}px`; cv.style.height = `${TH}px`;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, TW, TH);

    let visibleCount = Math.min(zoomRef.current, totalCandles.length);
    const maxPan = Math.max(0, totalCandles.length - visibleCount);
    let currentPan = Math.min(Math.max(0, panRef.current), maxPan);
    panRef.current = currentPan;

    const startIndex = totalCandles.length - visibleCount - currentPan;
    const endIndex = totalCandles.length - currentPan;
    const candles = totalCandles.slice(Math.max(0, startIndex), endIndex);

    const cpx = candles.flatMap(c => [c.h, c.l]);
    const lpx = [data.fib_50, data.fib_618, data.fib_786, data.p_range?.high, data.p_range?.low, data.price].filter(v => v && v > 0);
    
    const rawMin = Math.min(...cpx, ...lpx);
    const rawMax = Math.max(...cpx, ...lpx);
    const rawRange = (rawMax - rawMin) || 1;
    
    const autoMin = rawMin - rawRange * 0.05;
    const autoMax = rawMax + rawRange * 0.05;
    
    const midY = (autoMax + autoMin) / 2;
    const stretchedRange = (autoMax - autoMin) * yStretchRef.current;
    
    const yMin = midY - stretchedRange / 2 + yOffsetRef.current;
    const yMax = midY + stretchedRange / 2 + yOffsetRef.current;

    pricePerPixelRef.current = stretchedRange / MH;

    const n = candles.length;
    const xBand = W / n, xPad = xBand * 0.2, bw = Math.max(1, xBand - xPad * 2);
    const xOf  = i  => ml + i * xBand + xPad;
    const xMid = i  => ml + i * xBand + xBand / 2;
    const yOf  = p  => mt + (1 - (p - yMin) / (yMax - yMin)) * MH;

    const getXFromTime = (ts) => {
      let bestI = 0, minD = Infinity;
      for (let i = 0; i < totalCandles.length; i++) {
        const d = Math.abs((totalCandles[i].t || totalCandles[i].ts) - ts);
        if (d < minD) { minD = d; bestI = i; }
      }
      const local_i = bestI - startIndex;
      return ml + local_i * xBand + xBand / 2;
    };

    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const y = yOf(yMin + (yMax - yMin) * i / 6);
      ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + W, y); ctx.stroke();
    }

    ctx.fillStyle = '#64748b'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const labelStep = Math.max(1, Math.floor(n / (isMobile ? 4 : 8))); 
    candles.forEach((c, i) => {
      if (i % labelStep === 0 || i === candles.length -1) { 
        const date = new Date(c.t * 1000);
        const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        ctx.fillText(timeStr, xMid(i), TH - (XH / 2));
        
        ctx.beginPath(); ctx.moveTo(xMid(i), mt); ctx.lineTo(xMid(i), TH - XH); 
        ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.stroke();
      }
    });

    const hLine = (price, color, dash = [], lw = 1, label = null) => {
      if (!price || price < yMin || price > yMax) return;
      const y = yOf(price);
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw;
      if (dash.length) ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + W, y); ctx.stroke();
      ctx.setLineDash([]);
      if (label && !isMobile) { ctx.fillStyle = color; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText(label, ml + W + 6, y); }
      ctx.restore();
    };

    const drawBand = (a, b, fill) => {
      const top = yOf(Math.max(a, b)), bot = yOf(Math.min(a, b));
      if (bot < mt || top > mt + MH) return;
      ctx.fillStyle = fill; ctx.fillRect(ml, Math.max(top, mt), W, Math.min(bot, mt + MH) - Math.max(top, mt));
    };

    if (data.fib_50 && data.fib_618) {
      drawBand(data.fib_50, data.fib_618, 'rgba(234,179,8,0.05)');
      hLine(data.fib_618, '#d97706', [], 1.5, '61.8% Golden');
      hLine(data.fib_50,  '#ca8a04', [4, 4], 1,   '50.0% Eq');
    }
    if (data.fib_618 && data.fib_786) {
      drawBand(data.fib_618, data.fib_786, 'rgba(234,88,12,0.05)');
      hLine(data.fib_786, '#ea580c', [4, 4], 1, '78.6% OTE');
    }
    hLine(data.p_range?.high, 'rgba(100,116,139,0.3)', [2, 2], 1, '0.0% Anchor');
    hLine(data.p_range?.low,  'rgba(100,116,139,0.3)', [2, 2], 1, '100.0% Anchor');

    const drawTL = (tl, color) => {
      if (!tl?.valid || !tl.pts?.length) return;
      const pt1 = tl.pts[0];
      const ts1 = pt1.ts ?? pt1.t;
      const p1 = pt1.price ?? pt1.p;
      const x1 = getXFromTime(ts1);
      const y1 = yOf(p1);
      const x2 = getXFromTime(totalCandles[totalCandles.length - 1].t);
      const y2 = yOf(tl.projected_price || p1);

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    };
    drawTL(data.bear_tl, '#f43f5e'); 
    drawTL(data.bull_tl, '#10b981'); 

    candles.forEach((c, i) => {
      const bull = c.c >= c.o, col = bull ? '#10b981' : '#f43f5e';
      const x = xOf(i), mx = xMid(i);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, yOf(c.h)); ctx.lineTo(mx, yOf(c.l)); ctx.stroke();
      const bTop = yOf(Math.max(c.o, c.c)), bBot = yOf(Math.min(c.o, c.c));
      ctx.fillStyle = col; ctx.fillRect(x, bTop, bw, Math.max(1.5, bBot - bTop));
    });

    const mark = (pts, isHigh) => {
      (pts || []).forEach(s => {
        const ts = s.t ?? s.ts;
        const px = s.p ?? s.price;
        if (!ts || !px) return;
        const x = getXFromTime(ts);
        const y = yOf(px);
        if (x >= ml - 20 && x <= ml + W + 20 && y >= mt - 20 && y <= mt + MH + 20) {
          ctx.fillStyle = isHigh ? '#f472b6' : '#22d3ee';
          ctx.font = '14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(isHigh ? '▼' : '▲', x, y + (isHigh ? -14 : 14));
        }
      });
    };
    mark(data.swing_highs, true);
    mark(data.swing_lows, false);

    if (currentPan === 0 && data.price && data.price >= yMin && data.price <= yMax) {
      const py = yOf(data.price);
      ctx.save();
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(ml, py); ctx.lineTo(ml + W, py); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      
      const pStr = data.price > 999 ? data.price.toFixed(2) : data.price.toFixed(5);
      ctx.fillStyle = '#0369a1'; ctx.beginPath(); ctx.roundRect(ml + W + 4, py - 10, mr - 8, 20, 4); ctx.fill();
      ctx.fillStyle = '#bae6fd'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left'; ctx.fillText(pStr, ml + W + 8, py);
      ctx.restore();
    }

    ctx.fillStyle = '#64748b'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    for (let i = 0; i <= 6; i++) {
      const v = yMin + (yMax - yMin) * i / 6;
      ctx.fillText(v > 999 ? v.toFixed(2) : v.toFixed(5), ml + W + 6, yOf(v));
    }

    const vOff = mt + MH + GAP;
    const vMax  = Math.max(...candles.map(c => c.v), 1);
    candles.forEach((c, i) => {
      const bull = c.c >= c.o;
      const barH = Math.max(1, (c.v / vMax) * (VH - 4));
      ctx.fillStyle = bull ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)';
      ctx.fillRect(xOf(i), vOff + VH - barH, bw, barH);
    });

    if (mouseRef.current) {
      const {x, y} = mouseRef.current;
      if (x >= ml && x <= ml + W && y >= mt && y <= TH - XH) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, TH - XH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + W, y); ctx.stroke();
        ctx.setLineDash([]);

        const cIndex = Math.floor((x - ml) / xBand);
        if (candles[cIndex]) {
          const hoverC = candles[cIndex];
          const hoverPrice = yMin + ((mt + MH - y) / MH) * (yMax - yMin);
          
          ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.roundRect(ml + W + 4, y - 10, mr - 8, 20, 4); ctx.fill();
          ctx.fillStyle = '#f8fafc'; ctx.fillText(hoverPrice > 999 ? hoverPrice.toFixed(2) : hoverPrice.toFixed(5), ml + W + 8, y);
          
          const d = new Date(hoverC.t * 1000);
          const tStr = `${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.roundRect(x - 35, TH - XH + 2, 70, 20, 4); ctx.fill();
          ctx.fillStyle = '#f8fafc'; ctx.textAlign = 'center'; ctx.fillText(tStr, x, TH - (XH / 2) + 2);
          
          if (!isMobile) {
            const infoStr = `O:${hoverC.o.toFixed(5)} H:${hoverC.h.toFixed(5)} L:${hoverC.l.toFixed(5)} C:${hoverC.c.toFixed(5)}`;
            ctx.fillStyle = 'rgba(15,23,42,0.8)'; ctx.beginPath(); ctx.roundRect(ml + 10, mt + 10, 260, 24, 6); ctx.fill();
            ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'left'; ctx.fillText(infoStr, ml + 20, mt + 22);
          }
        }
      }
    }
  }, [data, symbol, isMobile]);

  useEffect(() => {
    draw();
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(draw);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;

    let lastTap = 0;

    // --- MOUSE EVENTS ---
    const onMouseDown = (e) => { 
      const rect = cv.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const TW = cv.clientWidth;
      const mr = isMobile ? 55 : 80;
      if (mouseX > TW - mr) {
        isDraggingY.current = true; dragStartY.current = e.clientY; dragStartStretch.current = yStretchRef.current;
      } else {
        isDraggingX.current = true; dragStartX.current = e.clientX; dragStartY.current = e.clientY; dragStartOffset.current = yOffsetRef.current;
      }
    };
    const onMouseUp = () => { isDraggingX.current = false; isDraggingY.current = false; if (cv) cv.style.cursor = 'crosshair'; };
    const onMouseLeave = () => { isDraggingX.current = false; isDraggingY.current = false; mouseRef.current = null; cv.style.cursor = 'default'; requestAnimationFrame(draw); };
    
    const onMouseMove = (e) => {
      const rect = cv.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const TW = cv.clientWidth;
      const mr = isMobile ? 55 : 80;
      mouseRef.current = { x: mouseX, y: mouseY };

      if (isDraggingY.current) {
        cv.style.cursor = 'ns-resize';
        const dy = e.clientY - dragStartY.current;
        const factor = 1 + (dy / 200); 
        yStretchRef.current = Math.max(0.05, Math.min(20, dragStartStretch.current * factor));
      } else if (isDraggingX.current) {
        cv.style.cursor = 'grabbing';
        const dx = e.clientX - dragStartX.current;
        const dy = e.clientY - dragStartY.current;
        const W = TW - 10 - mr;
        const xBand = W / Math.min(zoomRef.current, 200); 
        const shift = Math.round(dx / Math.max(1, xBand)); 
        if (Math.abs(shift) >= 1) { panRef.current += shift; dragStartX.current = e.clientX; }
        yOffsetRef.current = dragStartOffset.current + (dy * pricePerPixelRef.current);
      } else {
        cv.style.cursor = mouseX > TW - mr ? 'ns-resize' : 'crosshair';
      }
      requestAnimationFrame(draw);
    };

    const onWheel = (e) => {
      e.preventDefault();
      const speed = 0.1;
      const zoomDelta = e.deltaY * speed;
      zoomRef.current = Math.max(15, Math.min(200, zoomRef.current + zoomDelta));
      requestAnimationFrame(draw);
    };

    const onDoubleClick = (e) => {
      const rect = cv.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const TW = cv.clientWidth;
      const mr = isMobile ? 55 : 80;
      if (mouseX > TW - mr) { yStretchRef.current = 1.0; yOffsetRef.current = 0.0; requestAnimationFrame(draw); } 
      else { yStretchRef.current = 1.0; yOffsetRef.current = 0.0; panRef.current = 0; requestAnimationFrame(draw); }
    };

    // --- TOUCH EVENTS ---
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialPinchDist.current = Math.hypot(dx, dy);
        initialZoom.current = zoomRef.current;
        return;
      }

      if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 300) {
          yStretchRef.current = 1.0; yOffsetRef.current = 0.0; panRef.current = 0; requestAnimationFrame(draw);
          if (e.cancelable) e.preventDefault();
          return;
        }
        lastTap = now;

        const touch = e.touches[0];
        const rect = cv.getBoundingClientRect();
        const mouseX = touch.clientX - rect.left;
        const TW = cv.clientWidth;
        const mr = isMobile ? 55 : 80;

        if (mouseX > TW - mr) {
          isDraggingY.current = true; dragStartY.current = touch.clientY; dragStartStretch.current = yStretchRef.current;
        } else {
          isDraggingX.current = true; dragStartX.current = touch.clientX; dragStartY.current = touch.clientY; dragStartOffset.current = yOffsetRef.current;
        }
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && initialPinchDist.current) {
        if (e.cancelable) e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const scale = initialPinchDist.current / dist;
        zoomRef.current = Math.max(15, Math.min(200, initialZoom.current * scale));
        requestAnimationFrame(draw);
        return;
      }

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const TW = cv.clientWidth;
        const mr = isMobile ? 55 : 80;

        if (isDraggingY.current) {
          if (e.cancelable) e.preventDefault();
          const dy = touch.clientY - dragStartY.current;
          const factor = 1 + (dy / 200); 
          yStretchRef.current = Math.max(0.05, Math.min(20, dragStartStretch.current * factor));
          requestAnimationFrame(draw);
        } else if (isDraggingX.current) {
          if (e.cancelable) e.preventDefault();
          const dx = touch.clientX - dragStartX.current;
          const dy = touch.clientY - dragStartY.current;
          const W = TW - 10 - mr;
          const xBand = W / Math.min(zoomRef.current, 200); 
          const shift = Math.round(dx / Math.max(1, xBand)); 
          if (Math.abs(shift) >= 1) { panRef.current += shift; dragStartX.current = touch.clientX; }
          yOffsetRef.current = dragStartOffset.current + (dy * pricePerPixelRef.current);
          requestAnimationFrame(draw);
        }
      }
    };

    const onTouchEnd = () => {
      isDraggingX.current = false;
      isDraggingY.current = false;
      initialPinchDist.current = null;
    };

    cv.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp); 
    cv.addEventListener('mouseleave', onMouseLeave);
    cv.addEventListener('mousemove', onMouseMove);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('dblclick', onDoubleClick);

    cv.addEventListener('touchstart', onTouchStart, { passive: false });
    cv.addEventListener('touchmove', onTouchMove, { passive: false });
    cv.addEventListener('touchend', onTouchEnd);
    cv.addEventListener('touchcancel', onTouchEnd);

    return () => {
      cv.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      cv.removeEventListener('mouseleave', onMouseLeave);
      cv.removeEventListener('mousemove', onMouseMove);
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('dblclick', onDoubleClick);
      
      cv.removeEventListener('touchstart', onTouchStart);
      cv.removeEventListener('touchmove', onTouchMove);
      cv.removeEventListener('touchend', onTouchEnd);
      cv.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [draw, isMobile]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', touchAction: 'none' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};

// ─── Dashboard Core (Protected & Tiered) ──────────────────────────────────────
function DashboardCore({ user }) {
  const isMobile = useIsMobile();
  const [marketData,  setMarketData]  = useState(SIM);
  const [connected,   setConnected]   = useState(false);
  const [sym,         setSym]         = useState('GBPUSD');
  
  // Account & Role Management State
  const [profile, setProfile] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [dashView, setDashView] = useState('terminal'); // 'terminal', 'billing', 'admin'
  
  // Dynamic Plans & Admin State
  const [plans, setPlans] = useState(DEFAULT_PLANS);
  const [adminTab, setAdminTab] = useState('users'); // 'users', 'plans'
  const [editablePlans, setEditablePlans] = useState([]);
  const [saveStatus, setSaveStatus] = useState('');

  // Stripe Simulation State
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Sync Profile & Market Data
  useEffect(() => {
    if (!db || !user) return;

    // ── SET FALLBACK PROFILE IMMEDIATELY ──────────────────────────────────────
    const fallbackProfile = {
      uid: user.uid,
      role: 'customer',
      email: user.email || `user_${user.uid.substring(0, 5)}@example.com`,
      subscription: { plan: 'free', status: 'active', since: new Date().toISOString() },
      createdAt: new Date().toISOString()
    };
    
    // App renders even if Firestore never responds
    setProfile(prev => prev || fallbackProfile);
    
    // 1. Fetch User Profile
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'main');
    const unsubProfile = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data());
      } else {
        setDoc(profileRef, fallbackProfile).catch(err => console.warn("Profile creation blocked by rules:", err.code));
        setProfile(fallbackProfile);
      }
    }, (error) => {
      console.warn("Profile read blocked by Firestore rules:", error.code);
      setProfile(fallbackProfile);
    });

    // 2. Fetch Subscription Plans Config
    const configRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'subscription_plans');
    const unsubConfig = onSnapshot(configRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().plans) {
        setPlans(docSnap.data().plans);
        setEditablePlans(docSnap.data().plans);
      } else {
        setPlans(DEFAULT_PLANS);
        setEditablePlans(DEFAULT_PLANS);
      }
    }, (error) => {
      console.warn("Config read blocked:", error.code);
    });

    // 3. Fetch Market Data (From Python Engine)
    const unsubMarket = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'market_data'), snap => {
      const nd = {};
      let hasData = false;
      snap.forEach(document => {
        const d = document.data();
        if (d.price !== undefined) {
             hasData = true;
             nd[document.id] = { ...(SIM[document.id] || {}), ...d, candles: d.candles?.length > 0 ? d.candles : (SIM[document.id]?.candles || []) };
        }
      });
      
      if (hasData && Object.keys(nd).length > 0) { 
          setMarketData(nd); 
          setConnected(true); 
          setSym(currentSym => nd[currentSym] ? currentSym : Object.keys(nd)[0]);
      } else {
          setMarketData(SIM);
          setConnected(false);
      }
    }, err => {
        console.warn("Market data read blocked:", err.code);
        setMarketData(SIM);
        setConnected(false);
    });
    
    return () => { unsubProfile(); unsubMarket(); unsubConfig(); };
  }, [user]);

  // Separate effect to handle admin user list securely
  useEffect(() => {
    if (profile && profile.role === 'admin') {
         setAllUsers([{ id: user.uid, ...profile }]);
    }
  }, [profile, user.uid]);

  // Admin Management Logic
  const handleAdminUpdate = async (uid, field, value) => {
    if (!db || profile?.role !== 'admin') return;
    const userRef = doc(db, 'artifacts', appId, 'users', uid, 'profile', 'main');
    try {
      if (field === 'role') {
        await updateDoc(userRef, { role: value });
      } else if (field === 'plan') {
        await updateDoc(userRef, {
          'subscription.plan': value,
          'subscription.since': new Date().toISOString()
        });
      }
    } catch (err) {
      console.error("Failed to update user", err);
    }
  };

  const handlePlanChange = (index, field, value) => {
    const newPlans = [...editablePlans];
    newPlans[index][field] = value;
    setEditablePlans(newPlans);
  };

  const handleSavePlans = async () => {
    if (!db || profile?.role !== 'admin') return;
    setSaveStatus('Saving...');
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'subscription_plans'), { plans: editablePlans });
      setSaveStatus('Saved successfully!');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      setSaveStatus('Error saving plans');
      console.error(err);
    }
  };

  // Stripe Simulation Logic
  const handleSimulatePayment = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setPaymentSuccess(true);
      
      if (user && profile && db) {
        const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'main');
        setDoc(profileRef, {
          ...profile,
          subscription: {
            plan: checkoutPlan.id,
            status: 'active',
            since: new Date().toISOString()
          }
        }, { merge: true }).catch(e => console.error("Error upgrading plan", e));
      }

      setTimeout(() => {
        setPaymentSuccess(false);
        setCheckoutPlan(null);
        setDashView('terminal');
      }, 2000);
    }, 2500);
  };

  const toggleDevAdminRole = () => {
    if (user && profile && db) {
      const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'main');
      setDoc(profileRef, {
        ...profile,
        role: profile.role === 'admin' ? 'customer' : 'admin'
      }, { merge: true }).catch(e => console.error("Error toggling dev admin", e));
    }
  };

  // Safe data extraction to prevent loading screen freeze
  const safeMarketData = marketData || SIM;
  const currentSym = safeMarketData[sym] ? sym : Object.keys(safeMarketData)[0];
  const data = safeMarketData[currentSym];

  if (!profile || !data) return (
    <div style={{ height: '100vh', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <Activity style={{ width: 32, height: 32, color: '#38bdf8', animation: 'spin 2s linear infinite' }} />
      <span style={{ color: '#64748b', fontSize: 13, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600 }}>Syncing Database...</span>
    </div>
  );

  const syms = Object.keys(safeMarketData);
  const isAdmin = profile.role === 'admin';
  const hasProAccess = profile.subscription?.plan !== 'free';

  const isHold  = data.signal.decision === 'HOLD';
  const isBuy   = data.signal.decision.includes('BUY');
  const sigClr  = isHold ? '#94a3b8' : isBuy ? '#10b981' : '#f43f5e';
  const priceStr = data.price > 999 ? Number(data.price).toFixed(2) : Number(data.price || 0).toFixed(5);
  const biasCl = data.htf_bias === 'BULLISH' ? '#10b981' : data.htf_bias === 'BEARISH' ? '#f43f5e' : '#94a3b8';

  const paywallOverlay = (
    <div style={{ position: 'absolute', inset: 0, backdropFilter: 'blur(10px)', background: 'rgba(2,6,23,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 20, textAlign: 'center', padding: 24 }}>
      <Lock style={{ width: 40, height: 40, color: '#38bdf8', marginBottom: 16 }} />
      <h3 style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: '0 0 12px 0' }}>Pro Feature Locked</h3>
      <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 24px 0', lineHeight: 1.5 }}>
        Subscribe to AlphaStructure Pro to unlock live algorithmic signals, confluence scores, and live order flow arrays.
      </p>
      <button onClick={() => setDashView('billing')} style={{ background: '#635bff', color: '#fff', padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        <CreditCard style={{ width: 16, height: 16 }} /> Upgrade to Pro
      </button>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', overflowX: 'hidden' }}>
      
      {/* ─── NAV BAR ─── */}
      <nav style={{ 
        minHeight: 60, display: 'flex', flexDirection: isMobile ? 'column' : 'row', 
        alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', 
        padding: isMobile ? '12px 16px' : '0 24px', background: 'rgba(15,23,42,0.8)', 
        backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.05)', 
        position: 'sticky', top: 0, zIndex: 50, gap: isMobile ? 12 : 0 
      }}>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #38bdf8, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(56,189,248,0.2)' }}>
            <Activity style={{ width: 18, height: 18, color: '#020617' }} />
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-0.03em' }}>
            AlphaStructure<span style={{ color: '#38bdf8' }}>.io</span>
          </span>
        </div>

        {dashView === 'terminal' && (
          <div style={{ 
            display: 'flex', gap: 4, background: 'rgba(0,0,0,0.2)', padding: 4, borderRadius: 12, 
            border: '1px solid rgba(255,255,255,0.05)', overflowX: 'auto', whiteSpace: 'nowrap', 
            maxWidth: '100%', WebkitOverflowScrolling: 'none', msOverflowStyle: 'none' 
          }}>
            {syms.map(s => (
              <button key={s} onClick={() => setSym(s)} style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', 
                border: 'none', transition: 'all 0.2s', flexShrink: 0,
                background: sym === s ? 'rgba(56,189,248,0.15)' : 'transparent',
                color: sym === s ? '#38bdf8' : '#64748b',
              }}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'space-between' : 'flex-end', gap: 12 }}>
          
          <button onClick={toggleDevAdminRole} style={{ fontSize: 11, padding: '4px 8px', background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 4, cursor: 'pointer' }}>
            [Dev: Toggle Admin]
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setDashView('terminal')} style={{ background: dashView === 'terminal' ? 'rgba(255,255,255,0.1)' : 'transparent', color: dashView === 'terminal' ? '#fff' : '#94a3b8', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Terminal</button>
            <button onClick={() => setDashView('billing')} style={{ background: dashView === 'billing' ? 'rgba(255,255,255,0.1)' : 'transparent', color: dashView === 'billing' ? '#fff' : '#94a3b8', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Billing</button>
            {isAdmin && <button onClick={() => setDashView('admin')} style={{ background: dashView === 'admin' ? 'rgba(99,102,241,0.2)' : 'transparent', color: dashView === 'admin' ? '#818cf8' : '#6366f1', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Admin</button>}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => signOut(auth)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(244,63,94,0.1)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
              <LogOut style={{ width: 14, height: 14 }} /> {!isMobile && 'Logout'}
            </button>
          </div>
        </div>
      </nav>

      {/* ─── TERMINAL VIEW ─── */}
      {dashView === 'terminal' && (
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: isMobile ? '16px' : '24px', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 380px', gap: '24px', alignItems: 'start' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', minWidth: 0 }}>
            {/* Chart Card */}
            <div style={{ background: '#0f172a', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', overflow: 'hidden', display: 'flex', flexDirection: 'column', width: '100%' }}>
              <div style={{ padding: isMobile ? '16px' : '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 12 : 0 }}>
                <div>
                  <h1 style={{ fontSize: isMobile ? 24 : 28, fontWeight: 900, color: '#fff', margin: '0 0 8px 0', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
                    {sym} <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 6 }}>M15 MAP</span>
                  </h1>
                  <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
                    <div style={{ display: 'flex', gap: 6 }}><span style={{ color: '#64748b', fontWeight: 600 }}>HTF BIAS</span> <span style={{ color: biasCl, fontWeight: 800 }}>{data.htf_bias}</span></div>
                    <div style={{ display: 'flex', gap: 6 }}><span style={{ color: '#64748b', fontWeight: 600 }}>STRUCTURE</span> <span style={{ color: '#cbd5e1', fontWeight: 800 }}>{data.m15_structure}</span></div>
                  </div>
                </div>
                <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>LIVE PRICE</div>
                  <div style={{ fontSize: isMobile ? 24 : 28, fontFamily: 'monospace', fontWeight: 800, color: '#38bdf8' }}>{priceStr}</div>
                </div>
              </div>

              <div style={{ height: isMobile ? 350 : 500, width: '100%', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 10, fontSize: 10, color: '#64748b', background: 'rgba(15,23,42,0.8)', padding: '4px 8px', borderRadius: 6 }}>
                  💡 Pinch/Scroll to zoom | Drag X to pan | Drag Y to stretch
                </div>
                <StructuralChart data={data} symbol={sym} isMobile={isMobile} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                {[{l: 'True ATR', v: Number(data.atr).toFixed(5), c: '#f59e0b'}, {l: 'Bull TL', v: data.bull_tl?.valid ? 'Active' : 'Invalid', c: data.bull_tl?.valid ? '#10b981' : '#475569'}, {l: 'Bear TL', v: data.bear_tl?.valid ? 'Active' : 'Invalid', c: data.bear_tl?.valid ? '#f43f5e' : '#475569'}].map((s, i) => (
                  <div key={i} style={{ padding: '16px 24px', borderRight: (!isMobile && i < 2) ? '1px solid rgba(255,255,255,0.03)' : 'none', borderBottom: (isMobile && i < 2) ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>{s.l}</div>
                    <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 700, color: s.c }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Algorithmic Signal Card (PAYWALLED) */}
            <div style={{ position: 'relative', background: '#0f172a', borderRadius: 20, border: `1px solid ${hasProAccess ? (isHold ? 'rgba(255,255,255,0.05)' : isBuy ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)') : 'rgba(255,255,255,0.05)'}`, boxShadow: isHold || !hasProAccess ? '0 10px 40px rgba(0,0,0,0.2)' : (isBuy ? '0 10px 40px rgba(16,185,129,0.1)' : '0 10px 40px rgba(244,63,94,0.1)'), overflow: 'hidden' }}>
              {!hasProAccess && paywallOverlay}
              
              {(!isHold && hasProAccess) && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg, transparent, ${sigClr}, transparent)` }} />}
              
              <div style={{ padding: isMobile ? 24 : 32 }}>
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 16 : 0, marginBottom: 24 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>Algorithmic Decision</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {!isHold && <Zap style={{ width: isMobile ? 24 : 28, height: isMobile ? 24 : 28, color: sigClr }} />}
                      <span style={{ fontSize: isMobile ? 32 : 42, fontWeight: 900, color: sigClr, letterSpacing: '-0.02em', lineHeight: 1 }}>{data.signal.decision}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                    <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>Confluence Score</div>
                    <div style={{ fontSize: isMobile ? 32 : 42, fontWeight: 900, color: data.signal.score >= 70 ? '#10b981' : '#f59e0b', lineHeight: 1 }}>
                      {data.signal.score}<span style={{ fontSize: 20, color: '#475569' }}> /100</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  {[{ l: 'Detected Regime', v: data.signal.regime }, { l: 'Execution Zone', v: data.signal.location }].map(({ l, v }) => (
                    <div key={l} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: '16px', border: '1px solid rgba(255,255,255,0.03)' }}>
                      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>{l}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: 'rgba(56,189,248,0.05)', borderRadius: 12, padding: '20px', border: '1px solid rgba(56,189,248,0.1)' }}>
                  <div style={{ fontSize: 11, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Target style={{ width: 14, height: 14 }} /> AI Analyst Thesis
                  </div>
                  <p style={{ fontFamily: 'monospace', fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>{data.signal.thesis}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column Order Flow */}
          <div style={{ position: isMobile ? 'relative' : 'sticky', top: isMobile ? 0 : 84, background: '#0f172a', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', height: isMobile ? 'auto' : 'calc(100vh - 110px)', overflow: 'hidden', width: '100%' }}>
            {!hasProAccess && paywallOverlay}
            
            <div style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Crosshair style={{ width: 18, height: 18, color: '#38bdf8' }} /> Live Order Flow
              </h2>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              <div style={{ marginBottom: 32 }}>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 12 }}>Active Positions</div>
                {!data.positions?.length ? (
                  <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center', color: '#64748b', fontSize: 13, fontStyle: 'italic' }}>
                    No active trades for {sym}.
                  </div>
                ) : data.positions.map((pos, i) => {
                  const lng = pos.type === 'LONG';
                  return (
                    <div key={i} style={{ borderRadius: 16, border: `1px solid ${lng ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}`, background: lng ? 'rgba(16,185,129,0.05)' : 'rgba(244,63,94,0.05)', padding: 16, marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontWeight: 800, fontSize: 15, color: lng ? '#10b981' : '#f43f5e' }}>{pos.type} <span style={{ fontWeight: 500, fontSize: 12, opacity: 0.6 }}>({pos.volume}L)</span></span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 16, color: pos.pnl >= 0 ? '#10b981' : '#f43f5e' }}>{pos.pnl >= 0 ? '+' : ''}{Number(pos.pnl || 0).toFixed(2)}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8 }}>
                        <div><span style={{ display: 'block', fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>Entry</span><span style={{ color: '#cbd5e1' }}>{pos.open_price}</span></div>
                        <div><span style={{ display: 'block', fontSize: 10, color: '#38bdf8', textTransform: 'uppercase', marginBottom: 2 }}>Target</span><span style={{ color: '#cbd5e1' }}>{pos.tp}</span></div>
                        <div style={{ gridColumn: '1/-1', paddingTop: 8, marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.05)' }}><span style={{ color: pos.sl ? '#10b981' : '#f43f5e', fontSize: 12 }}>{pos.sl ? '🛡 SL Locked: ' : '⚠ Open SL  '}{pos.sl || '—'}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 12 }}>Pending Limits</div>
                {!data.orders?.length ? (
                  <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center', color: '#64748b', fontSize: 13, fontStyle: 'italic' }}>
                    No resting limits.
                  </div>
                ) : data.orders.map((ord, i) => {
                  const bl = ord.type?.includes('BUY');
                  return (
                    <div key={i} style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)', padding: 16, marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontWeight: 800, fontSize: 14, color: bl ? '#10b981' : '#f43f5e' }}>⏳ {ord.type}</span>
                        <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: '4px 8px', borderRadius: 6 }}>{ord.volume}L</span>
                      </div>
                      <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#94a3b8' }}>
                        {[['Limit', '#cbd5e1', ord.open_price], ['SL', '#f43f5e', ord.sl], ['TP', '#10b981', ord.tp]].map(([k, c, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: '#64748b' }}>{k}</span><span style={{ color: c }}>{v}</span></div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── BILLING VIEW ─── */}
      {dashView === 'billing' && (
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '24px 16px' : '48px 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h1 style={{ fontSize: isMobile ? 28 : 36, fontWeight: 900, marginBottom: 16 }}>Choose Your Trading Edge</h1>
            <p style={{ color: '#94a3b8', fontSize: 16, maxWidth: 600, margin: '0 auto' }}>Upgrade your license to unlock the full potential of the AlphaStructure engine directly on your dashboard.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 24 }}>
            {plans.map(plan => {
              const isActive = profile?.subscription?.plan === plan.id;
              return (
                <div key={plan.id} style={{ position: 'relative', background: '#0f172a', borderRadius: 24, padding: 32, border: `2px solid ${isActive ? plan.color : '#1e293b'}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {isActive && (
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: plan.color, color: '#020617', fontSize: 12, fontWeight: 800, padding: '6px', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      Current Active Plan
                    </div>
                  )}
                  {plan.discount && !isActive && (
                    <div style={{ position: 'absolute', top: -1, right: -1, background: '#f59e0b', color: '#020617', fontSize: 12, fontWeight: 800, padding: '6px 16px', borderBottomLeftRadius: 16, textTransform: 'uppercase' }}>
                      {plan.discount}
                    </div>
                  )}
                  <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 8, marginTop: isActive ? 16 : 0 }}>{plan.name}</h3>
                  <div style={{ marginBottom: 24, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 36, fontWeight: 900, color: '#fff' }}>${plan.price}</span>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>/ {plan.interval}</span>
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {plan.features.map((f, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: '#cbd5e1', lineHeight: 1.4 }}>
                        <CheckCircle style={{ width: 18, height: 18, color: plan.price === 0 ? '#475569' : '#10b981', flexShrink: 0, marginTop: 2 }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button 
                    disabled={isActive}
                    onClick={() => setCheckoutPlan(plan)}
                    style={{ 
                      width: '100%', padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 700, border: 'none', 
                      background: isActive ? '#1e293b' : plan.color, color: isActive ? '#64748b' : '#020617',
                      cursor: isActive ? 'not-allowed' : 'pointer', transition: 'all 0.2s'
                    }}
                  >
                    {isActive ? 'Active' : (plan.price === 0 ? 'Start Trial' : 'Subscribe Now')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── ADMIN PANEL ─── */}
      {dashView === 'admin' && isAdmin && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '24px 16px' : '48px 24px' }}>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 32, gap: 16 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Shield style={{ width: 28, height: 28, color: '#6366f1' }} /> Admin Dashboard
            </h1>
            <div style={{ display: 'flex', gap: 8, background: '#0f172a', padding: 4, borderRadius: 12, border: '1px solid #1e293b' }}>
              <button onClick={() => setAdminTab('users')} style={{ background: adminTab === 'users' ? '#1e293b' : 'transparent', color: adminTab === 'users' ? '#fff' : '#64748b', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>Users</button>
              <button onClick={() => setAdminTab('plans')} style={{ background: adminTab === 'plans' ? '#1e293b' : 'transparent', color: adminTab === 'plans' ? '#fff' : '#64748b', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>Subscription Tiers</button>
            </div>
          </div>

          {adminTab === 'users' && (
            <div style={{ background: '#0f172a', borderRadius: 16, border: '1px solid #1e293b', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ background: '#020617', borderBottom: '1px solid #1e293b' }}>
                    <tr>
                      <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>User / ID</th>
                      <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Role</th>
                      <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Plan</th>
                      <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUsers.map(u => (
                      <tr key={u.id} style={{ borderBottom: '1px solid #1e293b', background: u.role === 'admin' ? 'rgba(99,102,241,0.02)' : 'transparent' }}>
                        <td style={{ padding: '16px 24px' }}>
                          <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{u.email}</div>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b', marginTop: 4 }}>{u.uid}</div>
                        </td>
                        <td style={{ padding: '16px 24px' }}>
                          <select 
                            value={u.role || 'customer'} 
                            onChange={(e) => handleAdminUpdate(u.id, 'role', e.target.value)}
                            disabled={u.id === user.uid}
                            style={{ 
                              background: u.role === 'admin' ? 'rgba(99,102,241,0.1)' : '#1e293b', 
                              color: u.role === 'admin' ? '#818cf8' : '#94a3b8', 
                              border: `1px solid ${u.role === 'admin' ? 'rgba(99,102,241,0.2)' : '#334155'}`, 
                              borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', outline: 'none', cursor: u.id === user.uid ? 'not-allowed' : 'pointer',
                              appearance: 'none', WebkitAppearance: 'none'
                            }}
                          >
                            <option value="customer" style={{ background: '#0f172a', color: '#fff' }}>Customer</option>
                            <option value="admin" style={{ background: '#0f172a', color: '#fff' }}>Admin</option>
                          </select>
                        </td>
                        <td style={{ padding: '16px 24px' }}>
                          <select 
                            value={u.subscription?.plan || 'free'} 
                            onChange={(e) => handleAdminUpdate(u.id, 'plan', e.target.value)}
                            style={{ 
                              background: '#1e293b', color: '#38bdf8', border: '1px solid #334155', 
                              borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', outline: 'none', cursor: 'pointer',
                              appearance: 'none', WebkitAppearance: 'none'
                            }}
                          >
                            {plans.map(p => (
                              <option key={p.id} value={p.id} style={{ background: '#0f172a', color: '#fff' }}>{p.name} (${p.price})</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '16px 24px', fontSize: 13, color: '#94a3b8' }}>
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {adminTab === 'plans' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
                {saveStatus && <span style={{ fontSize: 13, color: '#10b981', fontWeight: 600 }}>{saveStatus}</span>}
                <button onClick={handleSavePlans} style={{ background: '#38bdf8', color: '#020617', padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 800, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield style={{ width: 16, height: 16 }} /> Save Active Plans
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 24 }}>
                {editablePlans.map((plan, i) => (
                  <div key={i} style={{ background: '#0f172a', padding: 24, borderRadius: 16, border: `1px solid ${plan.color}40` }}>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Plan Name</label>
                      <input value={plan.name} onChange={e => handlePlanChange(i, 'name', e.target.value)} style={{ width: '100%', background: '#020617', border: '1px solid #1e293b', padding: '10px', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Price ($)</label>
                        <input type="number" value={plan.price} onChange={e => handlePlanChange(i, 'price', Number(e.target.value))} style={{ width: '100%', background: '#020617', border: '1px solid #1e293b', padding: '10px', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Interval</label>
                        <input value={plan.interval} onChange={e => handlePlanChange(i, 'interval', e.target.value)} placeholder="e.g. Month" style={{ width: '100%', background: '#020617', border: '1px solid #1e293b', padding: '10px', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Discount Badge (Optional)</label>
                      <input value={plan.discount || ''} onChange={e => handlePlanChange(i, 'discount', e.target.value)} placeholder="e.g. 15% OFF" style={{ width: '100%', background: '#020617', border: '1px solid #1e293b', padding: '10px', borderRadius: 8, color: '#f59e0b', fontSize: 14, fontWeight: 600, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Features (One per line)</label>
                      <textarea value={plan.features.join('\n')} onChange={e => handlePlanChange(i, 'features', e.target.value.split('\n'))} style={{ width: '100%', height: 120, background: '#020617', border: '1px solid #1e293b', padding: '10px', borderRadius: 8, color: '#cbd5e1', fontSize: 13, lineHeight: 1.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── STRIPE CHECKOUT MODAL ─── */}
      {checkoutPlan && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 420, background: '#0f172a', borderRadius: 24, border: '1px solid #1e293b', overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
            
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #1e293b', background: '#020617', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#f8fafc', fontWeight: 700 }}>
                <CreditCard style={{ width: 18, height: 18, color: '#38bdf8' }} /> Secure Checkout
              </div>
              <button onClick={() => !isProcessing && setCheckoutPlan(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: isProcessing ? 'not-allowed' : 'pointer' }}>
                <XCircle style={{ width: 20, height: 20 }} />
              </button>
            </div>

            <div style={{ padding: '24px' }}>
              {paymentSuccess ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ width: 64, height: 64, background: 'rgba(16,185,129,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
                    <CheckCircle style={{ width: 32, height: 32, color: '#10b981' }} />
                  </div>
                  <h3 style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Payment Successful!</h3>
                  <p style={{ color: '#94a3b8', fontSize: 14 }}>Your account is now upgraded to <strong style={{ color: '#fff' }}>{checkoutPlan.name}</strong>.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div style={{ background: '#020617', borderRadius: 12, padding: 16, border: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Subscribing to</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{checkoutPlan.name}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Total Due</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>${checkoutPlan.price}</div>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Card Information</label>
                    <input disabled value="•••• •••• •••• 4242" style={{ width: '100%', background: '#020617', border: '1px solid #1e293b', padding: '14px 16px', borderRadius: 10, color: '#cbd5e1', fontSize: 15, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <input disabled value="12 / 28" style={{ width: '100%', background: '#020617', border: '1px solid #1e293b', padding: '14px 16px', borderRadius: 10, color: '#cbd5e1', fontSize: 15, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }} />
                      <input disabled value="•••" style={{ width: '100%', background: '#020617', border: '1px solid #1e293b', padding: '14px 16px', borderRadius: 10, color: '#cbd5e1', fontSize: 15, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>

                  <button 
                    onClick={handleSimulatePayment} 
                    disabled={isProcessing}
                    style={{ width: '100%', background: '#38bdf8', color: '#020617', padding: '16px', borderRadius: 12, fontSize: 16, fontWeight: 800, border: 'none', cursor: isProcessing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: isProcessing ? 0.7 : 1 }}
                  >
                    {isProcessing ? <Loader style={{ width: 20, height: 20, animation: 'spin 1s linear infinite' }} /> : `Pay $${checkoutPlan.price}.00`}
                  </button>

                  <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Shield style={{ width: 12, height: 12 }} /> Payments processed securely via Simulated Stripe
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Landing Page (Marketing) ─────────────────────────────────────────────────
function LandingPage({ onNavigate }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <nav style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: 'center', padding: '20px 40px', borderBottom: '1px solid rgba(255,255,255,0.05)', gap: isMobile ? 16 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #38bdf8, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Activity style={{ width: 18, height: 18, color: '#020617' }} />
          </div>
          <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>AlphaStructure<span style={{ color: '#38bdf8' }}>.io</span></span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <button onClick={() => onNavigate('auth', true)} style={{ background: 'transparent', color: '#f8fafc', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Login</button>
          <button onClick={() => onNavigate('auth', false)} style={{ background: '#38bdf8', color: '#020617', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Start Free Trial</button>
        </div>
      </nav>

      <main style={{ padding: isMobile ? '40px 20px' : '80px 20px', textAlign: 'center', maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'inline-block', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', padding: '6px 16px', borderRadius: 999, fontSize: 13, fontWeight: 700, marginBottom: 24, border: '1px solid rgba(56,189,248,0.2)' }}>
          🚀 Version 4.9 Cloud Engine is Live
        </div>
        <h1 style={{ fontSize: isMobile ? 40 : 64, fontWeight: 900, lineHeight: 1.1, marginBottom: 24, letterSpacing: '-0.04em' }}>
          Institutional-Grade <br/>
          <span style={{ color: '#38bdf8' }}>Market Structure</span> Analysis.
        </h1>
        <p style={{ fontSize: isMobile ? 16 : 20, color: '#94a3b8', maxWidth: 600, margin: '0 auto 40px auto', lineHeight: 1.6 }}>
          Stop trading blind. Our Python-backed algorithmic engine maps real-time structural geometry, Volume Spread Analysis (VSA), and automated signals directly to your dashboard.
        </p>
        
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, justifyContent: 'center', marginBottom: 80 }}>
          <button onClick={() => onNavigate('auth', false)} style={{ background: '#f8fafc', color: '#020617', border: 'none', padding: '16px 32px', borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            Start 7-Day Free Trial <ArrowRight style={{ width: 18, height: 18 }} />
          </button>
          <button onClick={() => onNavigate('auth', true)} style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
            Client Login
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 24, textAlign: 'left' }}>
          <div style={{ background: '#0f172a', padding: 32, borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)' }}>
            <BarChart2 style={{ width: 32, height: 32, color: '#38bdf8', marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Dynamic Geometry</h3>
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6 }}>Real-time SciPy peak detection automatically draws and tracks structural trendlines and Fibonacci anchors.</p>
          </div>
          <div style={{ background: '#0f172a', padding: 32, borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)' }}>
            <Cpu style={{ width: 32, height: 32, color: '#10b981', marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Algorithmic Scoring</h3>
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6 }}>Every market move is scored out of 100 based on structural confluence, price action, and Wyckoff regimes.</p>
          </div>
          <div style={{ background: '#0f172a', padding: 32, borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)' }}>
            <Shield style={{ width: 32, height: 32, color: '#f59e0b', marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Live Order Flow</h3>
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6 }}>Watch the engine place, manage, and trail limit orders and market executions in real-time.</p>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Main Router App ──────────────────────────────────────────────────────────
export default function App() {
  const isMobile = useIsMobile();
  const [view, setView] = useState('landing'); 
  const [isLoginMode, setIsLoginMode] = useState(true);
  
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    // 1. Initialize Firebase Auth Flow safely inside useEffect
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth init error:", err);
      }
    };
    // initAuth(); // Only uncomment if you want forced anonymous login

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u && view !== 'dashboard') setView('dashboard');
    });
    return () => unsub();
  }, []); // Run ONCE on mount

  const handleGoogleAuth = async () => {
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setView('dashboard');
    } catch (err) {
      setAuthError(err.message.replace('Firebase: ', ''));
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (!isLoginMode) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setView('dashboard');
    } catch (err) {
      setAuthError(err.message.replace('Firebase: ', ''));
    }
  };

  const navigateToAuth = (modeIsLogin) => {
    setIsLoginMode(modeIsLogin);
    setView('auth');
  };

  if (loading) return <div style={{ height: '100vh', background: '#020617' }} />;

  if (user && view === 'dashboard') {
    return <DashboardCore user={user} />;
  }

  if (view === 'landing') {
    return <LandingPage onNavigate={navigateToAuth} />;
  }

  // Auth View
  return (
    <div style={{ minHeight: '100vh', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif', padding: 16 }}>
      <button onClick={() => setView('landing')} style={{ position: 'absolute', top: isMobile ? 16 : 30, left: isMobile ? 16 : 30, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
        ← Back to Home
      </button>

      <div style={{ width: '100%', maxWidth: 420, background: '#0f172a', padding: isMobile ? '30px 20px' : '40px', borderRadius: 24, border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #38bdf8, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Activity style={{ width: 24, height: 24, color: '#020617' }} />
          </div>
          <span style={{ fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>AlphaStructure</span>
        </div>

        <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 8 }}>
          {isLoginMode ? 'Client Login' : 'Start Free Trial'}
        </h2>
        <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginBottom: 24 }}>
          {isLoginMode ? 'Enter your credentials to access the terminal.' : 'Create an account to access the live charting matrix.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <button onClick={handleGoogleAuth} type="button" style={{ width: '100%', background: '#fff', color: '#0f172a', padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'background 0.2s' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            <span style={{ color: '#64748b', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>OR</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          </div>

          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', color: '#64748b', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email Address</label>
              <input type="email" value={email} required onChange={e => setEmail(e.target.value)} style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} placeholder="trader@example.com" />
            </div>
            <div>
              <label style={{ display: 'block', color: '#64748b', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Password</label>
              <input type="password" value={password} required onChange={e => setPassword(e.target.value)} style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} placeholder="••••••••" />
            </div>

            {authError && <div style={{ color: '#f43f5e', fontSize: 13, background: 'rgba(244,63,94,0.1)', padding: '10px', borderRadius: 8, border: '1px solid rgba(244,63,94,0.2)', textAlign: 'center' }}>{authError}</div>}

            <button type="submit" style={{ width: '100%', background: '#38bdf8', color: '#020617', padding: '14px', borderRadius: 10, fontSize: 15, fontWeight: 800, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }}>
              <Lock style={{ width: 18, height: 18 }} /> {isLoginMode ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>