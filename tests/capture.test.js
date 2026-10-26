const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/capture.js');

test('去掉汉字之间的多余空格，保留英文单词间的空格', () => {
  assert.strictEqual(C.squeezeCjkSpaces('二 次 函 数 的 图 象'), '二次函数的图象');
  assert.strictEqual(C.squeezeCjkSpaces('第 3 章 Hello world'), '第3章Hello world');
  assert.strictEqual(C.squeezeCjkSpaces('I like apples'), 'I like apples');
});

test('清理识别结果：去噪声行、合并空格、统一换行', () => {
  const raw = '  第 一 章  \r\n|\r\n— ~\r\n二 次 函 数\n\n\nvertex form  y = a(x-h)^2 + k\n';
  assert.strictEqual(C.cleanOcrText(raw), '第一章\n二次函数\nvertex form y = a(x-h)^2 + k');
  assert.strictEqual(C.cleanOcrText(''), '');
  assert.strictEqual(C.cleanOcrText(null), '');
  assert.strictEqual(C.cleanOcrText('| | ~ —'), '');
});

test('语音接在已有内容后面', () => {
  assert.strictEqual(C.appendSpeech('', '今天做了数学', 'zh-CN'), '今天做了数学');
  assert.strictEqual(C.appendSpeech('今天做了数学', '二次函数不太熟', 'zh-CN'), '今天做了数学，二次函数不太熟');
  assert.strictEqual(C.appendSpeech('今天做了数学。', '二次函数不太熟', 'zh-CN'), '今天做了数学。二次函数不太熟');
  assert.strictEqual(C.appendSpeech('第一行\n', '第二行', 'zh-CN'), '第一行\n第二行');
  assert.strictEqual(C.appendSpeech('Read unit 3', 'learned new words', 'en-US'), 'Read unit 3 learned new words');
  assert.strictEqual(C.appendSpeech('abc', '   ', 'zh-CN'), 'abc');
  assert.strictEqual(C.appendSpeech('今 天 学 习', '语 文', 'zh-HK'), '今 天 学 习，语文');
});

test('拍照识别的文字另起一行', () => {
  assert.strictEqual(C.appendBlock('', '课本第12页'), '课本第12页');
  assert.strictEqual(C.appendBlock('已有内容  \n', '课本第12页'), '已有内容\n课本第12页');
  assert.strictEqual(C.appendBlock('abc', ''), 'abc');
});

test('超长内容截断', () => {
  assert.deepStrictEqual(C.fitText('abc', 5), { text: 'abc', truncated: false });
  assert.deepStrictEqual(C.fitText('abcdef', 5), { text: 'abcde', truncated: true });
});

test('灰度对比度拉伸：偏灰的照片被拉开，纯色图保持不变', () => {
  // 灰底（150）上的深灰文字（110）：对比度很低
  const n = 1000;
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = i < 100 ? 110 : 150;
    px.set([v, v, v, 255], i * 4);
  }
  // 40 级的跨度刚好触发拉伸
  C.enhanceGray(px);
  assert.ok(px[0] < 10, `文字应接近黑色，实际 ${px[0]}`);
  assert.ok(px[(n - 1) * 4] > 245, `背景应接近白色，实际 ${px[(n - 1) * 4]}`);
  assert.strictEqual(px[3], 255);

  const flat = new Uint8ClampedArray(400).fill(128);
  for (let i = 3; i < 400; i += 4) flat[i] = 255;
  C.enhanceGray(flat);
  assert.strictEqual(flat[0], 128);
});

test('科目对应语音语言', () => {
  assert.strictEqual(C.voiceLangFor('english'), 'en-US');
  assert.strictEqual(C.voiceLangFor('math'), 'zh-CN');
});

test('错误提示是中文且给出办法', () => {
  assert.match(C.describeVoiceError('not-allowed'), /麦克风/);
  assert.match(C.describeVoiceError('network'), /话筒键/);
  assert.match(C.describeVoiceError('unsupported'), /不支持/);
  assert.match(C.describeOcrError({ code: 'engine' }), /联网/);
  assert.match(C.describeOcrError({ code: 'not-image' }), /图片/);
});
