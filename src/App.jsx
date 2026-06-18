import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot } from 'firebase/firestore';
import { Activity, Server, Crosshair, Zap } from 'lucide-react';

// ============================================================================
// FIREBASE CONFIG
// ============================================================================
const firebaseConfig = {
  apiKey: "AIzaSyCnDzXhHDmfx5SAYcS0hNIuZhA2Lt1C3QA",
  authDomain: "alphastructure.firebaseapp.com",
  projectId: "alphastructure",
  storageBucket: "alphastructure.firebasestorage.app",
  messagingSenderId: "962716149021",
  appId: "1:962716149021:web:d7dd8f55a09b11ce54adf4",
};
let db = null;
try { const app = initializeApp(firebaseConfig); db = getFirestore(app); } catch (e) {}

// ============================================================================
// SEEDED CANDLE GENERATOR  (consistent preview per symbol)
// ============================================================================
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

const _candleCache = {};
function getSimCandles(symbol, basePrice, dir = 'DOWN', count = 65) {
  if (_candleCache[symbol]) return _candleCache[symbol];
  const rng  = seededRng(symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
  const now  = Math.floor(Date.now() / 1000);
  const M15  = 900;
  const trend = dir === 'DOWN' ? -0.00038 : 0.00042;
  let price  = dir === 'DOWN' ? basePrice * 1.028 : basePrice * 0.972;
  const out  = [];
  for (let i = count - 1; i >= 0; i--) {
    const noise = (rng() - 0.48) * 0.0014;
    const open  = price;
    const close = price * (1 + trend + noise);
    const wick  = Math.abs(open - close) * (0.3 + rng() * 0.7);
    out.push({
      t: now - i * M15,
      o: open,  h: Math.max(open, close) + wick * rng(),
      l: Math.min(open, close) - wick * rng(),  c: close,
      v: Math.floor(rng() * 8000 + 1200),
    });
    price = close;
  }
  _candleCache[symbol] = out;
  return out;
}

// ============================================================================
// SIMULATED DATA  (fallback until Python bot syncs candles)
// ============================================================================
const SYMBOL_CFG = {
  BTCUSD: { price: 105420,   dir: 'DOWN', atr: 450    },
  US30:   { price: 51744,    dir: 'UP',   atr: 87      },
  XAUUSD: { price: 4215,     dir: 'DOWN', atr: 8.33   },
  EURUSD: { price: 1.14594,  dir: 'DOWN', atr: 0.0007 },
  GBPUSD: { price: 1.28450,  dir: 'DOWN', atr: 0.0009 },
  USDJPY: { price: 144.85,   dir: 'UP',   atr: 0.25   },
  GBPJPY: { price: 185.50,   dir: 'DOWN', atr: 0.32   },
  USOIL:  { price: 68.40,    dir: 'DOWN', atr: 0.45   },
};

function buildSim(sym) {
  const { price, dir, atr } = SYMBOL_CFG[sym];
  const candles = getSimCandles(sym, price, dir, 65);
  const range   = price * 0.055;
  const pH = price * (dir === 'DOWN' ? 1.04 : 1.02);
  const pL = price * (dir === 'DOWN' ? 0.98 : 0.97);
  const f50  = dir === 'UP' ? pH - range * 0.500 : pL + range * 0.500;
  const f618 = dir === 'UP' ? pH - range * 0.618 : pL + range * 0.618;
  const f786 = dir === 'UP' ? pH - range * 0.786 : pL + range * 0.786;
  const now  = Math.floor(Date.now() / 1000);
  const M    = 900;
  return {
    price, atr, dominant_dir: dir,
    htf_bias:      dir === 'UP' ? 'BULLISH' : 'BEARISH',
    m15_structure: dir === 'DOWN' ? 'DOWNTREND' : 'UPTREND',
    fib_50: f50, fib_618: f618, fib_786: f786,
    p_range: { high: pH, low: pL },
    bear_tl: dir === 'DOWN' ? {
      valid: true,
      pts: [{ ts: now - 55*M, price: pH * 0.997 }, { ts: now - 20*M, price: pH * 0.977 }],
      projected_price: pH * 0.963,
    } : { valid: false, pts: [] },
    bull_tl: dir === 'UP' ? {
      valid: true,
      pts: [{ ts: now - 50*M, price: pL * 1.004 }, { ts: now - 22*M, price: pL * 1.014 }],
      projected_price: pL * 1.022,
    } : { valid: false, pts: [] },
    swing_highs: [
      { t: now - 52*M, p: price * 1.020 },
      { t: now - 24*M, p: price * 1.013 },
    ],
    swing_lows: [
      { t: now - 42*M, p: price * 0.984 },
      { t: now - 14*M, p: price * 0.988 },
    ],
    signal: {
      decision: 'HOLD', score: 0, regime: 'PREVIEW', location: 'MIDDLE',
      thesis: 'Simulated preview mode — add candle sync to Python bot for live chart data.',
    },
    positions: [], orders: [], candles,
  };
}

const SIM = Object.fromEntries(Object.keys(SYMBOL_CFG).map(s => [s, buildSim(s)]));

// ============================================================================
// D3 STRUCTURAL CHART
// ============================================================================
const StructuralChart = ({ data, symbol }) => {
  const wrapRef = useRef(null);
  const svgRef  = useRef(null);

  const draw = useCallback(() => {
    if (!wrapRef.current || !data) return;
    const candles = (data.candles && data.candles.length > 0)
      ? data.candles
      : getSimCandles(symbol, data.price || 1, data.dominant_dir || 'DOWN', 65);

    const TW    = wrapRef.current.clientWidth || 720;
    const MH    = 370;   // main panel height
    const VH    = 68;    // volume panel height
    const TOTAL = MH + VH + 22;
    const ml = 6, mr = 80, mt = 28, mb = 2;
    const W  = TW - ml - mr;

    const sv = d3.select(svgRef.current);
    sv.selectAll('*').remove();
    sv.attr('width', TW).attr('height', TOTAL)
      .style('background', '#060b14').style('display', 'block');

    const g = sv.append('g').attr('transform', `translate(${ml},${mt})`);

    // ── Price domain ─────────────────────────────────────────────────────────
    const cpx = candles.flatMap(c => [c.h, c.l]);
    const lpx = [
      data.fib_50, data.fib_618, data.fib_786,
      data.p_range?.high, data.p_range?.low, data.price,
      ...(data.positions || []).flatMap(p => [p.open_price, p.sl, p.tp]),
      ...(data.orders    || []).flatMap(o => [o.open_price, o.sl, o.tp]),
    ].filter(v => v && v > 0);
    const yMin = d3.min([...cpx, ...lpx]) * 0.9996;
    const yMax = d3.max([...cpx, ...lpx]) * 1.0004;

    const xSc = d3.scaleBand().domain(d3.range(candles.length)).range([0, W]).padding(0.18);
    const ySc = d3.scaleLinear().domain([yMin, yMax]).range([MH, 0]);

    // ── Grid ─────────────────────────────────────────────────────────────────
    ySc.ticks(8).forEach(v => {
      g.append('line').attr('x1', 0).attr('x2', W)
       .attr('y1', ySc(v)).attr('y2', ySc(v))
       .attr('stroke', 'rgba(51,65,85,0.22)').attr('stroke-width', 1);
    });

    // ── Horizontal line helper ────────────────────────────────────────────────
    const hLine = (price, color, dash = '', lw = 1, label = null) => {
      if (!price || price < yMin * 0.998 || price > yMax * 1.002) return;
      g.append('line').attr('x1', 0).attr('x2', W)
        .attr('y1', ySc(price)).attr('y2', ySc(price))
        .attr('stroke', color).attr('stroke-width', lw).attr('stroke-dasharray', dash);
      if (label) {
        g.append('text').attr('x', W + 4).attr('y', ySc(price) + 4)
          .attr('fill', color).attr('font-size', 10).attr('font-family', 'monospace')
          .text(label);
      }
    };

    // ── Range anchors ─────────────────────────────────────────────────────────
    const pH = data.p_range?.high || yMax;
    const pL = data.p_range?.low  || yMin;
    hLine(pH, 'rgba(148,163,184,0.35)', '5 4', 1, '0.0% Anchor');
    hLine(pL, 'rgba(148,163,184,0.35)', '5 4', 1, '100.0% Anchor');

    // ── Golden zone ───────────────────────────────────────────────────────────
    if (data.fib_50 && data.fib_618) {
      const bTop = Math.min(ySc(Math.max(data.fib_50, data.fib_618)), MH);
      const bBot = Math.max(ySc(Math.min(data.fib_50, data.fib_618)), 0);
      g.append('rect').attr('x', 0).attr('width', W)
        .attr('y', bTop).attr('height', Math.max(0, bBot - bTop))
        .attr('fill', 'rgba(234,179,8,0.09)');
      hLine(data.fib_618, '#f59e0b', '', 1.5, '61.8% Golden');
      hLine(data.fib_50,  '#facc15', '5 4', 1, '50.0% Equilibrium');
    }

    // ── OTE zone ──────────────────────────────────────────────────────────────
    if (data.fib_618 && data.fib_786) {
      const bTop = Math.min(ySc(Math.max(data.fib_618, data.fib_786)), MH);
      const bBot = Math.max(ySc(Math.min(data.fib_618, data.fib_786)), 0);
      g.append('rect').attr('x', 0).attr('width', W)
        .attr('y', bTop).attr('height', Math.max(0, bBot - bTop))
        .attr('fill', 'rgba(249,115,22,0.07)');
      hLine(data.fib_786, '#f97316', '5 4', 1, '78.6% Deep OTE');
    }

    // ── Trendlines ────────────────────────────────────────────────────────────
    const drawTL = (tl, color) => {
      if (!tl?.valid || !tl.pts?.length) return;
      const findI = ts => {
        let b = 0, md = Infinity;
        candles.forEach((c, i) => { const d = Math.abs(c.t - ts); if (d < md) { md = d; b = i; } });
        return b;
      };
      const pt1  = tl.pts[0];
      const ts1  = pt1.ts ?? pt1.t;
      const p1   = pt1.price ?? pt1.p;
      const i1   = findI(ts1);
      const x1   = xSc(i1) + xSc.bandwidth() / 2;
      const y1   = ySc(p1);
      const x2   = xSc(candles.length - 1) + xSc.bandwidth() / 2;
      const y2   = tl.projected_price ? ySc(tl.projected_price) : y1;
      if ([x1, y1, x2, y2].some(isNaN)) return;
      if (y1 < -60 || y1 > MH + 60 || y2 < -60 || y2 > MH + 60) return;
      g.append('line')
        .attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2)
        .attr('stroke', color).attr('stroke-width', 1.8)
        .attr('stroke-dasharray', '9 5').attr('opacity', 0.9);
    };
    drawTL(data.bear_tl, '#2dd4bf');
    drawTL(data.bull_tl, '#34d399');

    // ── Position / order lines ────────────────────────────────────────────────
    (data.positions || []).forEach(pos => {
      const col = pos.type === 'LONG' ? '#10b981' : '#f43f5e';
      hLine(pos.open_price, col, '', 1.5);
      if (pos.sl) hLine(pos.sl, '#f43f5e', '3 3');
      if (pos.tp) hLine(pos.tp, '#10b981', '3 3');
    });
    (data.orders || []).forEach(ord => {
      const col = ord.type?.includes('BUY') ? '#34d399' : '#fb7185';
      hLine(ord.open_price, col, '6 4', 1.5);
      if (ord.sl) hLine(ord.sl, '#f43f5e', '3 3');
      if (ord.tp) hLine(ord.tp, '#10b981', '3 3');
    });

    // ── Candles ───────────────────────────────────────────────────────────────
    candles.forEach((c, i) => {
      const bull = c.c >= c.o;
      const col  = bull ? '#26a69a' : '#ef5350';
      const x    = xSc(i);
      const mx   = x + xSc.bandwidth() / 2;
      g.append('line').attr('x1', mx).attr('x2', mx)
        .attr('y1', ySc(c.h)).attr('y2', ySc(c.l))
        .attr('stroke', col).attr('stroke-width', 1);
      const bTop = ySc(Math.max(c.o, c.c));
      const bBot = ySc(Math.min(c.o, c.c));
      g.append('rect').attr('x', x).attr('y', bTop)
        .attr('width', xSc.bandwidth())
        .attr('height', Math.max(1, bBot - bTop))
        .attr('fill', col).attr('opacity', 0.87);
    });

    // ── Swing markers ─────────────────────────────────────────────────────────
    const swingMark = (pts, isHigh) => {
      (pts || []).forEach(s => {
        const ts = s.t ?? s.ts;
        const px = s.p ?? s.price;
        if (!ts || !px || px < yMin || px > yMax) return;
        let b = 0, md = Infinity;
        candles.forEach((c, i) => { const d = Math.abs(c.t - ts); if (d < md) { md = d; b = i; } });
        g.append('text')
          .attr('x', xSc(b) + xSc.bandwidth() / 2)
          .attr('y', ySc(px) + (isHigh ? -11 : 14))
          .attr('text-anchor', 'middle')
          .attr('fill', isHigh ? '#f472b6' : '#22d3ee')
          .attr('font-size', 14)
          .text(isHigh ? '▼' : '▲');
      });
    };
    swingMark(data.swing_highs, true);
    swingMark(data.swing_lows, false);

    // ── Live price tag ────────────────────────────────────────────────────────
    if (data.price && data.price >= yMin && data.price <= yMax) {
      const py = ySc(data.price);
      g.append('line').attr('x1', 0).attr('x2', W).attr('y1', py).attr('y2', py)
        .attr('stroke', '#38bdf8').attr('stroke-width', 1)
        .attr('stroke-dasharray', '3 4').attr('opacity', 0.75);
      g.append('rect').attr('x', W + 2).attr('y', py - 9).attr('width', mr - 6).attr('height', 18)
        .attr('fill', '#0e7490').attr('rx', 3);
      g.append('text').attr('x', W + 5).attr('y', py + 4.5)
        .attr('fill', '#e0f7ff').attr('font-size', 9.5)
        .attr('font-family', 'monospace').attr('font-weight', 'bold')
        .text(data.price > 999 ? data.price.toFixed(2) : data.price.toFixed(5));
    }

    // ── Y axis ────────────────────────────────────────────────────────────────
    const yAx = d3.axisRight(ySc).ticks(8)
      .tickFormat(v => v > 999 ? v.toFixed(2) : v.toFixed(5));
    g.append('g').attr('transform', `translate(${W},0)`).call(yAx)
      .call(ax => ax.select('.domain').remove())
      .call(ax => ax.selectAll('.tick line').remove())
      .call(ax => ax.selectAll('text')
        .attr('fill', '#475569').attr('font-size', 9.5)
        .attr('font-family', 'monospace').attr('x', 5));

    // ── Chart header ──────────────────────────────────────────────────────────
    g.append('text').attr('x', 2).attr('y', -8)
      .attr('fill', '#475569').attr('font-size', 11).attr('font-family', 'monospace')
      .text(`Live Structural Map: ${symbol} (M15)  |  Validated Sequence: ${data.dominant_dir || 'N/A'}`);

    // ── Volume panel ──────────────────────────────────────────────────────────
    const vg  = sv.append('g').attr('transform', `translate(${ml},${MH + mt + 12})`);
    const vMax = d3.max(candles, c => c.v) || 1;
    const vSc  = d3.scaleLinear().domain([0, vMax]).range([VH, 0]);
    candles.forEach((c, i) => {
      const bull = c.c >= c.o;
      vg.append('rect').attr('x', xSc(i)).attr('y', vSc(c.v))
        .attr('width', xSc.bandwidth())
        .attr('height', Math.max(0, VH - vSc(c.v)))
        .attr('fill', bull ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)');
    });
    vg.append('text').attr('x', 3).attr('y', 13)
      .attr('fill', '#334155').attr('font-size', 9).attr('font-family', 'monospace')
      .text('Tick Vol');
    const vAx = d3.axisRight(vSc).ticks(3)
      .tickFormat(v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v);
    vg.append('g').attr('transform', `translate(${W},0)`).call(vAx)
      .call(ax => ax.select('.domain').remove())
      .call(ax => ax.selectAll('.tick line').remove())
      .call(ax => ax.selectAll('text')
        .attr('fill', '#334155').attr('font-size', 9).attr('x', 4));

  }, [data, symbol]);

  useEffect(() => {
    draw();
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  const bullOk  = !!data?.bull_tl?.valid;
  const bearOk  = !!data?.bear_tl?.valid;
  const priceStr = data?.price > 999
    ? Number(data.price).toFixed(2)
    : Number(data?.price || 0).toFixed(5);

  return (
    <div className="w-full rounded-xl overflow-hidden border border-slate-800">
      <div ref={wrapRef} className="w-full">
        <svg ref={svgRef} style={{ width: '100%', display: 'block' }} />
      </div>
      {/* Stats bar — mirrors the Streamlit bottom strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-800 border-t border-slate-800 bg-slate-950/80">
        {[
          { label: 'Live Current Price',    val: priceStr,                               col: 'text-white'                               },
          { label: 'True ATR (Volatility)', val: Number(data?.atr || 0).toFixed(5),      col: 'text-amber-400'                           },
          { label: 'Bull Trendline Status', val: bullOk ? 'Active' : 'Invalid',          col: bullOk ? 'text-emerald-400' : 'text-slate-500' },
          { label: 'Bear Trendline Status', val: bearOk ? 'Active' : 'Invalid',          col: bearOk ? 'text-red-400'     : 'text-slate-500' },
        ].map((s, i) => (
          <div key={i} className="px-4 py-3">
            <div className="text-[9px] text-slate-600 uppercase font-bold tracking-widest mb-1">{s.label}</div>
            <div className={`font-mono font-bold text-sm ${s.col}`}>{s.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN DASHBOARD
// ============================================================================
export default function AlphaStructureDashboard() {
  const [marketData,     setMarketData]    = useState(SIM);
  const [isConnected,    setIsConnected]   = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('US30');

  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(collection(db, 'market_data'), snap => {
      const nd = {};
      snap.forEach(doc => {
        const d = doc.data();
        nd[doc.id] = {
          ...(SIM[doc.id] || {}),          // fill in missing fields from sim
          ...d,
          // keep sim candles until bot sends real ones
          candles: (d.candles?.length > 0) ? d.candles : (SIM[doc.id]?.candles || []),
        };
      });
      if (Object.keys(nd).length > 0) {
        setMarketData(nd);
        setIsConnected(true);
        if (!nd[selectedSymbol]) setSelectedSymbol(Object.keys(nd)[0]);
      }
    }, err => console.error(err));
    return () => unsub();
  }, []);

  const data = marketData[selectedSymbol];
  const syms = Object.keys(marketData);

  if (!data) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center">
      <Activity className="w-8 h-8 animate-pulse mb-4 text-emerald-500" />
      <span className="text-slate-400 tracking-widest uppercase text-sm font-bold">Awaiting Telemetry...</span>
    </div>
  );

  const isHold = data.signal.decision === 'HOLD';
  const isBuy  = data.signal.decision.includes('BUY');
  const sCl    = isHold ? 'text-slate-300'   : (isBuy ? 'text-emerald-400'      : 'text-rose-500');
  const sBd    = isHold ? 'border-slate-800' : (isBuy ? 'border-emerald-500/50' : 'border-rose-500/50');
  const sBg    = isHold ? 'bg-slate-900'     : (isBuy ? 'bg-emerald-500/10'     : 'bg-rose-500/10');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-20">

      {/* ── Navigation ── */}
      <nav className="border-b border-slate-800/80 bg-slate-950/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-2.5 shrink-0">
            <div className="w-7 h-7 rounded bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
              <Activity className="w-4 h-4 text-slate-950" />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">
              AlphaStructure<span className="text-emerald-400">.io</span>
            </span>
          </div>

          {/* Symbol tabs */}
          <div className="flex space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-800 overflow-x-auto">
            {syms.map(sym => (
              <button key={sym} onClick={() => setSelectedSymbol(sym)}
                className={`px-3 py-1 rounded font-bold text-[11px] whitespace-nowrap transition-all
                  ${selectedSymbol === sym ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
                {sym}
              </button>
            ))}
          </div>

          <div className={`flex items-center px-3 py-1 rounded-full border text-[11px] font-medium shrink-0
            ${isConnected
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-amber-500/10  border-amber-500/30  text-amber-400'}`}>
            <Server className="w-3 h-3 mr-1.5" />
            {isConnected ? 'Cloud DB Connected' : 'Simulated Preview'}
          </div>
        </div>
      </nav>

      <main className="max-w-[1800px] mx-auto px-4 pt-5 space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end pb-3 border-b border-slate-800/80">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight mb-1.5">{selectedSymbol}</h1>
            <div className="flex flex-wrap gap-5 text-xs">
              {[
                { k: 'HTF Bias',      v: data.htf_bias,      c: data.htf_bias === 'BULLISH' ? 'text-emerald-400' : data.htf_bias === 'BEARISH' ? 'text-rose-400' : 'text-slate-400' },
                { k: 'M15 Structure', v: data.m15_structure, c: 'text-slate-300' },
                { k: 'Dominant Dir',  v: data.dominant_dir,  c: data.dominant_dir === 'UP' ? 'text-emerald-400' : 'text-rose-400' },
              ].map(({ k, v, c }) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="text-slate-600 uppercase font-bold tracking-wider">{k}:</span>
                  <span className={`font-black ${c}`}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="text-right mt-3 sm:mt-0">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Live Price</div>
            <div className="text-3xl font-mono font-black text-white">
              {data.price > 999 ? data.price.toFixed(2) : data.price.toFixed(5)}
            </div>
          </div>
        </div>

        {/* ── Full-width D3 structural chart ── */}
        <StructuralChart data={data} symbol={selectedSymbol} />

        {/* ── Signal card  +  Order flow ── */}
        <div className="grid lg:grid-cols-3 gap-5">

          {/* Signal card */}
          <div className={`lg:col-span-2 rounded-2xl border ${sBd} ${sBg} overflow-hidden shadow-xl relative`}>
            {!isHold && (
              <div className={`absolute inset-y-0 left-0 w-1 ${isBuy ? 'bg-emerald-400' : 'bg-rose-500'} animate-pulse`} />
            )}
            <div className="p-6">
              <div className="flex justify-between items-start mb-5">
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Algorithmic Decision</div>
                  <div className={`text-5xl font-black ${sCl} flex items-center`}>
                    {!isHold && <Zap className="w-7 h-7 mr-3" />}
                    {data.signal.decision}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Confluence Score</div>
                  <div className={`text-4xl font-black ${data.signal.score >= 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {data.signal.score}<span className="text-xl text-slate-600"> /100</span>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3 mb-4">
                {[
                  { l: 'Detected Regime', v: data.signal.regime   },
                  { l: 'Execution Zone',  v: data.signal.location },
                ].map(({ l, v }) => (
                  <div key={l} className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/80">
                    <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-1">{l}</div>
                    <div className="font-mono text-sm text-slate-200">{v}</div>
                  </div>
                ))}
              </div>

              <div className="bg-slate-950/80 rounded-xl p-5 border border-slate-800">
                <div className="flex items-center mb-2">
                  <Activity className="w-4 h-4 text-cyan-400 mr-2" />
                  <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-widest">AI Analyst Thesis</span>
                </div>
                <p className="text-slate-300 text-sm leading-relaxed font-mono">{data.signal.thesis}</p>
              </div>
            </div>
          </div>

          {/* Order flow */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow-xl">
            <h3 className="text-[10px] font-bold text-white mb-5 flex items-center uppercase tracking-widest">
              <Crosshair className="w-4 h-4 mr-2 text-slate-500" />
              Live Order Flow
            </h3>

            {/* Active positions */}
            <div className="mb-7">
              <h4 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-3 border-b border-slate-800 pb-2">
                Active Positions
              </h4>
              {!data.positions?.length ? (
                <p className="text-sm text-slate-600 font-mono italic">No active positions on {selectedSymbol}.</p>
              ) : data.positions.map((pos, i) => {
                const lng = pos.type === 'LONG';
                return (
                  <div key={i} className={`p-4 rounded-xl border border-slate-800 border-l-4 mb-3
                    ${lng ? 'border-l-emerald-500 bg-emerald-500/5' : 'border-l-rose-500 bg-rose-500/5'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={`font-black text-sm ${lng ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pos.type} <span className="opacity-60 text-xs">({pos.volume}L)</span>
                      </span>
                      <span className={`font-bold font-mono text-sm ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pos.pnl >= 0 ? '+' : ''}{Number(pos.pnl || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-400 bg-slate-950/50 p-2.5 rounded-lg">
                      <div>
                        <span className="block text-[9px] text-slate-500 uppercase mb-0.5">Entry</span>
                        {pos.open_price}
                      </div>
                      <div>
                        <span className="block text-[9px] text-cyan-600 uppercase mb-0.5">Target</span>
                        {pos.tp}
                      </div>
                      <div className="col-span-2 pt-2 border-t border-slate-800/50">
                        <span className={pos.sl ? 'text-emerald-400' : 'text-rose-500'}>
                          {pos.sl ? '🛡 PROTECTED SL: ' : '⚠ OPEN SL  '}{pos.sl || 'None'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pending limits */}
            <div>
              <h4 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-3 border-b border-slate-800 pb-2">
                Pending Limits
              </h4>
              {!data.orders?.length ? (
                <p className="text-sm text-slate-600 font-mono italic">No resting limits.</p>
              ) : data.orders.map((ord, i) => {
                const bl = ord.type?.includes('BUY');
                return (
                  <div key={i} className={`p-3.5 rounded-xl border border-slate-800 border-l-4 mb-3
                    ${bl ? 'border-l-emerald-500/50' : 'border-l-rose-500/50'} bg-slate-950/40`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold text-sm text-slate-200">⏳ {ord.type}</span>
                      <span className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded">{ord.volume}L</span>
                    </div>
                    <div className="text-xs font-mono text-slate-400 space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Limit:</span>
                        <span className="text-white">{ord.open_price}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-rose-400">SL:</span>
                        <span>{ord.sl}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-400">TP:</span>
                        <span>{ord.tp}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}