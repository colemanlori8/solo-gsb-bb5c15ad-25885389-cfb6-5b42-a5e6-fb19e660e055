'use strict';
/**
 * server.js —— 折页阅读顺序校样 Web 服务
 *  - 静态托管 public/（原生 HTML/CSS/Canvas 前端）
 *  - /api/simulate：服务端重放方案（与浏览器共用同一份 foldEngine.js）
 *  - /api/audit：生产质量审计（只读，不改动方案）
 *  - /api/creep-compensation：书帖爬移补偿逐叶偏移（只读计算）
 *  - /api/plans* ：方案 JSON 持久化到 DATA_DIR（容器卷）
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./public/foldEngine.js');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 模拟 ----------
app.post('/api/simulate', (req, res) => {
  try {
    const plan = E.normalizePlan(req.body || {});
    const upto = req.body && Number.isInteger(req.body.upto)
      ? Math.max(0, Math.min(req.body.upto, plan.steps.length))
      : plan.steps.length;
    const { state, error } = E.replay(plan.rows, plan.cols, plan.labels, plan.steps, upto);
    res.json({
      ok: !error,
      upto,
      error: error || null,
      stacks: E.pageSequence(state).stacks,
      folded: E.pageSequence(state).folded,
      occupied: Object.keys(state.stacks).map((k) => {
        const [x, y] = k.split(',').map(Number);
        return {
          x, y, depth: state.stacks[k].length,
          panels: state.stacks[k].map((id) => {
            const p = state.panels[id];
            return {
              id, ox: p.ox, oy: p.oy, cx: p.cx, cy: p.cy,
              frame: p.frame,
              front: p.front, back: p.back
            };
          })
        };
      })
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: { code: 'bad_plan', message: e.message } });
  }
});

// ---------- 自动拼版 ----------
app.post('/api/impose', (req, res) => {
  try {
    const plan = E.normalizePlan(req.body || {});
    const result = E.autoImpose(
      plan.rows, plan.cols, plan.labels, plan.steps,
      req.body && req.body.startPage,
      req.body && req.body.pageCount
    );
    if (!result.ok) {
      return res.json({
        ok: false,
        error: {
          code: result.code,
          message: result.message,
          capacity: result.capacity,
          stepIndex: result.stepIndex,
          conflicts: result.conflicts,
          stackCount: result.stackCount
        }
      });
    }
    res.json({
      ok: true,
      startPage: result.startPage,
      pageCount: result.pageCount,
      capacity: result.capacity,
      blankTrailing: result.blankTrailing,
      labels: result.labels,
      slots: result.slots,
      overwrites: E.impositionOverwrite(plan.labels, result)
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: { code: 'bad_plan', message: e.message } });
  }
});

// ---------- 双面印刷版预览 ----------
app.post('/api/duplex-plate', (req, res) => {
  try {
    const plan = E.normalizePlan(req.body || {});
    const result = E.buildDuplexPlates(
      plan.rows, plan.cols, plan.labels, plan.steps,
      req.body && req.body.flip
    );
    if (!result.ok) {
      return res.json({
        ok: false,
        error: {
          code: result.code,
          message: result.message,
          capacity: result.capacity,
          stepIndex: result.stepIndex,
          conflicts: result.conflicts,
          stackCount: result.stackCount
        }
      });
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: { code: 'bad_plan', message: e.message } });
  }
});

// ---------- 折手自动寻路 ----------
app.post('/api/find-path', (req, res) => {
  try {
    const plan = E.normalizePlan(req.body || {});
    const optsRaw = req.body && req.body.options && typeof req.body.options === 'object'
      ? req.body.options : {};
    const result = E.findFoldPath(
      plan.rows, plan.cols, plan.labels, plan.steps,
      req.body && req.body.target,
      {
        // 服务端硬性兜底：最多 8 步、2 秒
        maxDepth: Math.min(8, Math.max(0, Number(optsRaw.maxDepth) || 8)),
        timeoutMs: Math.min(2000, Math.max(1, Number(optsRaw.timeoutMs) || 2000))
      }
    );
    if (!result.ok) {
      return res.json({
        ok: false,
        error: {
          code: result.code,
          message: result.message,
          rows: result.rows, cols: result.cols,
          stepIndex: result.stepIndex,
          conflicts: result.conflicts
        }
      });
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: { code: 'bad_plan', message: e.message } });
  }
});

// ---------- 面片轨迹 ----------
app.post('/api/trajectory', (req, res) => {
  try {
    const plan = E.normalizePlan(req.body || {});
    const result = E.trackPanel(
      plan.rows, plan.cols, plan.labels, plan.steps,
      req.body && req.body.target
    );
    if (!result.ok) {
      return res.json({ ok: false, error: { code: result.code, message: result.message } });
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: { code: 'bad_plan', message: e.message } });
  }
});

// ---------- 生产质量审计（只读） ----------
app.post('/api/audit', (req, res) => {
  try {
    const plan = E.normalizePlan(req.body || {});
    const result = E.auditPlan(plan.rows, plan.cols, plan.labels, plan.steps);
    if (!result.ok) {
      return res.json({
        ok: false,
        error: {
          code: result.code,
          message: result.message,
          stepIndex: result.stepIndex,
          conflicts: result.conflicts
        }
      });
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: { code: 'bad_plan', message: e.message } });
  }
});

// ---------- 书帖爬移补偿 ----------
app.post('/api/creep-compensation', (req, res) => {
  try {
    const plan = E.normalizePlan(req.body || {});
    const result = E.creepCompensation(
      plan.rows, plan.cols, plan.labels, plan.steps,
      req.body && req.body.paperThickness,
      req.body && req.body.bleed
    );
    if (!result.ok) {
      return res.json({
        ok: false,
        error: {
          code: result.code,
          message: result.message,
          capacity: result.capacity,
          stepIndex: result.stepIndex,
          conflicts: result.conflicts,
          stackCount: result.stackCount
        }
      });
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: { code: 'bad_plan', message: e.message } });
  }
});

// ---------- 方案持久化 ----------
function planFile(id) { return path.join(DATA_DIR, `${id}.json`); }

/** 存档的更新时间：优先取持久化的 savedAt，旧存档缺省时回退到文件 mtime。 */
function planSavedAt(p, st) {
  const t = Date.parse(p && p.savedAt);
  return Number.isFinite(t) ? t : st.mtimeMs;
}

/** 列表筛选标签：支持重复 query（?tag=a&tag=b）与逗号/分号分隔（含全角逗号）。 */
function filterTags(query) {
  const raw = query.tag == null ? [] : (Array.isArray(query.tag) ? query.tag : [query.tag]);
  const out = [];
  for (const part of raw) {
    if (typeof part !== 'string') continue;
    for (const t of part.split(/[,，;；]/)) {
      const v = t.trim();
      if (v) out.push(v);
    }
  }
  return out;
}

app.get('/api/plans', (req, res) => {
  // since 支持毫秒时间戳（整数）或 ISO 日期字符串；无法解析则整请求 400
  let since = null;
  if (req.query.since != null && req.query.since !== '') {
    const raw = String(req.query.since);
    since = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    if (!Number.isFinite(since)) {
      return res.status(400).json({ ok: false, error: { code: 'bad_since', message: 'since 必须为毫秒时间戳或 ISO 时间字符串' } });
    }
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLocaleLowerCase('en-US') : '';
  const wantTags = filterTags(req.query).map((t) => t.toLocaleLowerCase('en-US'));

  let all;
  try {
    all = fs.readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const fp = path.join(DATA_DIR, f);
        try {
          const p = JSON.parse(fs.readFileSync(fp, 'utf8'));
          const st = fs.statSync(fp);
          const savedAtMs = planSavedAt(p, st);
          return {
            id: f.replace(/\.json$/, ''),
            name: p.name || '未命名方案',
            rows: p.rows, cols: p.cols,
            steps: Array.isArray(p.steps) ? p.steps.length : 0,
            tags: E.coerceTags(p.tags),
            note: E.coerceNote(p.note),
            savedAt: new Date(savedAtMs).toISOString(),
            updatedAt: new Date(savedAtMs).toISOString(),
            _savedAtMs: savedAtMs
          };
        } catch { return null; }
      })
      .filter(Boolean);
  } catch (e) {
    return res.status(500).json({ ok: false, error: { code: 'list_failed', message: e.message } });
  }

  // 稳定排序：最近更新时间降序，时间相同按 id 升序兜底
  const items = all
    .filter((it) => {
      if (since != null && it._savedAtMs < since) return false;
      if (q && !it.name.toLocaleLowerCase('en-US').includes(q)) return false;
      if (wantTags.length) {
        const have = new Set(it.tags.map((t) => t.toLocaleLowerCase('en-US')));
        if (!wantTags.every((t) => have.has(t))) return false;
      }
      return true;
    })
    .sort((a, b) => (b._savedAtMs - a._savedAtMs) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ _savedAtMs, ...rest }) => rest);

  res.json({ total: all.length, count: items.length, items });
});

app.post('/api/plans', (req, res) => {
  try {
    // 标签/备注先于一切写操作严格校验：非法输入整请求拒绝，绝不改动旧存档
    const tags = E.normalizeTags(req.body && req.body.tags);
    const note = E.normalizeNote(req.body && req.body.note);
    const plan = E.normalizePlan(req.body || {});
    const body = {
      name: plan.name, rows: plan.rows, cols: plan.cols,
      labels: plan.labels, steps: plan.steps,
      tags, note,
      savedAt: new Date().toISOString()
    };
    // 爬移补偿独立方案字段：存在则随存档保留（GET /api/plans/:id 原样返回）
    if (plan.creepCompensation) body.creepCompensation = plan.creepCompensation;
    let id = (req.body && typeof req.body.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(req.body.id))
      ? req.body.id : crypto.randomBytes(6).toString('hex');
    // 原子写：先写临时文件再 rename，失败也不会留下半截旧存档
    const tmp = planFile(id) + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2));
    fs.renameSync(tmp, planFile(id));
    res.json({ ok: true, id, plan: body });
  } catch (e) {
    const code = e && (e.code === 'bad_tags' || e.code === 'bad_note') ? e.code : 'bad_plan';
    res.status(400).json({ ok: false, error: { code, message: e.message } });
  }
});

app.get('/api/plans/:id', (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ ok: false, error: { message: '非法 id' } });
  const f = planFile(id);
  if (!fs.existsSync(f)) return res.status(404).json({ ok: false, error: { message: '方案不存在' } });
  res.type('application/json').send(fs.readFileSync(f, 'utf8'));
});

app.delete('/api/plans/:id', (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ ok: false, error: { message: '非法 id' } });
  const f = planFile(id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`折页阅读顺序校样应用已启动： http://localhost:${PORT}`);
  });
}

module.exports = app;
