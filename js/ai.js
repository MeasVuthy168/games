// src/routes/ai.js
import { Router } from 'express';
import { engine } from '../enginePool.js';

const router = Router();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v|0));
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const err = new Error('engine timeout');
      err.code = 'ENGINE_TIMEOUT';
      reject(err);
    }, ms);
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}

// tiny helper to run a shallow instant move (used by warmup & last resort)
async function instantMove(fen) {
  return await engine.bestMove({ fen, depth: 6 });
}

/** POST /api/ai/move
 * body: { fen, variant='makruk', movetime?, depth?, nodes?, threads?, hash? }
 */
router.post('/move', async (req, res) => {
  try {
    const {
      fen,
      variant = 'makruk',
      movetime,
      depth,
      nodes,
      threads,
      hash
    } = req.body || {};

    if (!fen) return res.status(400).json({ error: 'Missing fen' });
    if (variant !== 'makruk') {
      return res.status(400).json({ error: 'Only makruk supported' });
    }

    // Safe UCI options for Render free (low RAM/CPU)
    const toSet = {};
    if (Number.isFinite(+threads)) toSet.Threads = clamp(+threads, 1, 2);
    else toSet.Threads = 1;
    if (Number.isFinite(+hash)) toSet.Hash = clamp(+hash, 16, 64);
    else toSet.Hash = 32;
    try { engine.applyOptions(toSet); } catch {}

    // Prefer movetime (stronger); clamp and give generous API timeout
    const thinkMs   = clamp((+movetime || 1200), 400, 2500);
    const timeoutMs = thinkMs + 6000; // buffer for I/O / jitter

    // 1) Attempt movetime search
    try {
      const best = await withTimeout(
        engine.bestMove({
          fen,
          movetime: thinkMs,
          depth: +depth || undefined,
          nodes: +nodes || undefined
        }),
        timeoutMs
      );
      if (!best || !best.uci) throw new Error('no move');
      return res.json({
        uci: best.uci,
        raw: best.raw,
        meta: { mode: 'movetime', movetime: thinkMs, timeoutMs, options: toSet }
      });
    } catch (e) {
      if (!(e?.code === 'ENGINE_TIMEOUT' || /timeout/i.test(e?.message||''))) {
        // non-timeout error -> try fallback anyway
        // (continue to depth fallback below)
      } else {
        // signal timeout to logs but proceed to fallback
        console.warn('[AI] movetime timeout -> depth fallback');
      }
    }

    // 2) Depth fallback (fast & reliable)
    const depthFallback = 10; // tune 8–12 for speed vs strength
    const depthTimeout  = 5000;
    const bestDepth = await withTimeout(
      engine.bestMove({ fen, depth: depthFallback }),
      depthTimeout
    );

    if (!bestDepth || !bestDepth.uci) {
      // 3) Last resort: instant shallow move (never blocks)
      const quick = await instantMove(fen).catch(()=>null);
      if (!quick?.uci) return res.status(502).json({ error: 'no move from engine' });
      return res.json({
        uci: quick.uci, raw: quick.raw,
        meta: { mode: 'instant', depth: 6, options: toSet }
      });
    }

    return res.json({
      uci: bestDepth.uci,
      raw: bestDepth.raw,
      meta: { mode: 'depth', depth: depthFallback, options: toSet }
    });

  } catch (e) {
    if (e?.code === 'ENGINE_TIMEOUT') {
      return res.status(503).json({ error: 'engine timeout' });
    }
    return res.status(500).json({ error: e?.message || 'AI error' });
  }
});

/** GET /api/ai/warmup — pre-load engine & NN tables */
router.get('/warmup', async (_req, res) => {
  try {
    const startFen = '8/8/8/8/8/8/8/8 w - - 0 1';
    await engine.applyOptions?.({ Threads: 1, Hash: 32 });
    await engine.bestMove({ fen: startFen, depth: 6 }); // quick probe
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default router;
