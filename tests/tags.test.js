'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/foldEngine.js');

test('normalizeTags：去空白、大小写不敏感去重并保留首个写法', () => {
  assert.deepEqual(E.normalizeTags(undefined), []);
  assert.deepEqual(E.normalizeTags(null), []);
  assert.deepEqual(E.normalizeTags([]), []);
  assert.deepEqual(
    E.normalizeTags([' 骑马钉 ', '骑马钉', 'Cover', 'cover', '样书_v-1']),
    ['骑马钉', 'Cover', '样书_v-1']
  );
});

test('normalizeTags：接受 CJK 与 24 字符边界，拒绝空白/逗号/控制字符/非字符串', () => {
  assert.deepEqual(E.normalizeTags(['中'.repeat(24)]), ['中'.repeat(24)]);
  for (const bad of [['bad tag'], ['a,b'], ['a，b'], ['a;b'], ['a\tb'], ['a\nb'], [''], ['  '], [42], [null], [{}]]) {
    assert.throws(() => E.normalizeTags(bad), (e) => e.code === 'bad_tags',
      `tags=${JSON.stringify(bad)} 应抛 bad_tags`);
  }
  assert.throws(() => E.normalizeTags(['中'.repeat(25)]), /24/);
});

test('normalizeTags：最多 8 个（去重后计数）', () => {
  assert.equal(E.normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).length, 8);
  // 去重后不超限则允许
  assert.equal(E.normalizeTags(['a', 'A', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).length, 8);
  assert.throws(() => E.normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']),
    (e) => e.code === 'bad_tags');
  assert.throws(() => E.normalizeTags('a,b'), (e) => e.code === 'bad_tags');
});

test('normalizeNote：缺省为空串，非字符串/超长拒绝；长度按 Unicode 码点', () => {
  assert.equal(E.normalizeNote(undefined), '');
  assert.equal(E.normalizeNote(null), '');
  assert.equal(E.normalizeNote('备注'), '备注');
  assert.equal(E.normalizeNote('字'.repeat(200)).length, 200);
  assert.throws(() => E.normalizeNote('字'.repeat(201)), (e) => e.code === 'bad_note');
  for (const bad of [42, true, ['x'], { x: 1 }]) {
    assert.throws(() => E.normalizeNote(bad), (e) => e.code === 'bad_note');
  }
  // emoji 按码点计数（星占符 1 码点）
  assert.equal(E.normalizeNote('★'.repeat(200)).length, 200);
  assert.throws(() => E.normalizeNote('★'.repeat(201)), (e) => e.code === 'bad_note');
});

test('normalizePlan（导入宽松规整）：非法标签丢弃、去重截断，备注超长截断', () => {
  const p = E.normalizePlan({
    rows: 1, cols: 2, labels: {}, steps: [],
    tags: ['ok', 'bad tag', '', 7, '骑马钉', 'OK', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
    note: '字'.repeat(250)
  });
  assert.deepEqual(p.tags, ['ok', '骑马钉', 'a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(Array.from(p.note).length, 200);

  // 缺省/类型错误字段给空值，不影响方案载入
  const p2 = E.normalizePlan({ rows: 1, cols: 2, labels: {}, steps: [], tags: 'x', note: 9 });
  assert.deepEqual(p2.tags, []);
  assert.equal(p2.note, '');
});
