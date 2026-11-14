// Offline fixtures (open the page with ?mock) for working on layout and motion
// without calling any model. They cover each layout plus crowded and failing cases.
import type { Op, StreamEvent } from "./types";
import { pic, type Pic } from "./covers";

type Fixture = { match: RegExp; ops: Op[]; images?: Record<string, Pic | null> };

const actions = (...labels: string[]): Op => ({
  t: "actions",
  id: "actions",
  items: labels.map((label) => ({ label, say: label })),
});

const look: Fixture = {
  match: /面试|一套|look/,
  images: { hero: pic.cobalt },
  ops: [
    { t: "scene", id: "s", layout: "look", tone: "editorial", bg: "#1C36A0", accent: "#F2D9A0", kicker: "面试 · 休闲", title: "松一点的正式", lede: "西装保留轮廓，其余全部换成软的。" },
    { t: "image", id: "hero", kind: "figure", prompt: "x", pending: true },
    { t: "pieces", id: "pieces", items: [
      { id: "p1", name: "藏青无垫肩西装", note: "袖口推到小臂", hex: "#1F2A44" },
      { id: "p2", name: "白色圆领 T 恤", note: "厚一点的棉，不透", hex: "#F7F6F2" },
      { id: "p3", name: "米色直筒裤", note: "裤脚盖住鞋面一半", hex: "#D8CBB4" },
      { id: "p4", name: "白色皮面板鞋", note: "擦干净比款式重要", hex: "#EFEFEA" },
    ] },
    { t: "quote", id: "q", body: "面试官记住的是整洁，不是正式程度。" },
    actions("更正式一点", "换掉西装", "男生版本"),
  ],
};

const swap: Fixture = {
  match: /换掉|换成|换一件/,
  images: { hero: pic.magenta },
  ops: [
    { t: "scene", id: "s", layout: "look", tone: "editorial", bg: "#BE488A", accent: "#F6E7C8", kicker: "面试 · 休闲", title: "换成驼色", lede: "驼色比藏青更暖，适合创意类岗位。" },
    { t: "image", id: "hero", kind: "figure", edit: true, prompt: "x", pending: true },
    { t: "pieces", id: "pieces", items: [
      { id: "p1", name: "驼色羊毛西装", note: "同样不垫肩", hex: "#B98A5E" },
      { id: "p2", name: "白色圆领 T 恤", note: "厚一点的棉，不透", hex: "#F7F6F2" },
      { id: "p3", name: "米色直筒裤", note: "裤脚盖住鞋面一半", hex: "#D8CBB4" },
      { id: "p4", name: "白色皮面板鞋", note: "擦干净比款式重要", hex: "#EFEFEA" },
    ] },
    { t: "facts", id: "facts", items: [{ label: "正式度", value: "中" }, { label: "适合行业", value: "设计 / 媒体" }] },
    actions("换回藏青", "加一条围巾", "男生版本"),
  ],
};

const compare: Fixture = {
  match: /还是|哪个|compare/,
  images: { o1: pic.cobalt, o2: pic.olive },
  ops: [
    { t: "scene", id: "s", layout: "compare", tone: "modern", bg: "#11131A", accent: "#8FA8FF", kicker: "第一套西装", title: "先买藏青", lede: "藏青的适用场合比黑色多一倍。" },
    { t: "option", id: "o1", title: "藏青西装", tag: "更实用", pick: true, kind: "figure", prompt: "x", pending: true, points: ["面试、开会、婚礼都能穿", "配牛仔裤也不突兀", "白天晚上都成立"] },
    { t: "option", id: "o2", title: "驼色西装", tag: "更有性格", kind: "figure", prompt: "x", pending: true, points: ["偏休闲，正式场合不够", "显气色，但挑下装颜色"] },
    { t: "facts", id: "facts", items: [{ label: "藏青覆盖场合", value: "约 80%" }, { label: "驼色覆盖场合", value: "约 40%" }] },
    { t: "quote", id: "q", body: "第一套的目标是什么都能配，不是最好看。" },
    actions("看藏青怎么搭", "预算有限", "女生怎么选"),
  ],
};

const palette: Fixture = {
  match: /配色|颜色|大地色|palette/,
  ops: [
    { t: "scene", id: "s", layout: "palette", tone: "soft", bg: "#2B1D14", accent: "#E0A26B", kicker: "秋日配色", title: "大地色怎么配", lede: "米白打底、驼色主调、深棕收口，再加一点焦糖。" },
    { t: "swatches", id: "sw", items: [
      { hex: "#EFE6D6", name: "米白", role: "打底 60%" },
      { hex: "#C89B6C", name: "驼色", role: "主调 30%" },
      { hex: "#6B4A2F", name: "深棕", role: "收口 10%" },
      { hex: "#B5542A", name: "焦糖", role: "点缀" },
    ] },
    { t: "rules", id: "rules", do: ["用米白做内搭，把脸和外套隔开", "下装选深棕，压稳整体", "鞋包选同色系"], dont: ["全身超过三个深浅层次", "把焦糖用在大面积外套上", "配冷调的灰"] },
    { t: "quote", id: "q", body: "大地色不是棕色堆棕色，是有明有暗的层次。" },
    actions("看一套穿搭", "加一个跳色", "黄皮能穿吗"),
  ],
};

const guide: Fixture = {
  match: /怎么选|怎么穿|方法|guide/,
  images: { hero: pic.olive },
  ops: [
    { t: "scene", id: "s", layout: "guide", tone: "editorial", bg: "#6E6A47", accent: "#F0E2B6", kicker: "风衣 · 版型", title: "风衣怎么选", lede: "先看肩线，再看长度，最后才是颜色。" },
    { t: "image", id: "hero", kind: "figure", prompt: "x", pending: true },
    { t: "steps", id: "steps", items: [
      { title: "肩线落在肩骨外一指", body: "太合肩显旧，落太多显垮。" },
      { title: "长度到膝盖下方", body: "一米六以下选膝上，腿会显长。" },
      { title: "面料要有一点挺度", body: "软塌的风衣撑不起腰带。" },
    ] },
    { t: "rules", id: "rules", do: ["系带子时在背后打结"], dont: ["把所有扣子都扣上"] },
    actions("小个子版本", "选什么颜色", "搭什么鞋"),
  ],
};

const pack: Fixture = {
  match: /带什么|行李|清单|pack/,
  images: { hero: pic.flat },
  ops: [
    { t: "scene", id: "s", layout: "pack", tone: "modern", bg: "#9CBDD6", accent: "#12324A", kicker: "冰岛 · 七天", title: "三层穿法", lede: "排汗、保暖、防风各一层，其余都是多余的。" },
    { t: "image", id: "hero", kind: "flatlay", prompt: "x", pending: true },
    { t: "facts", id: "facts", items: [{ label: "气温", value: "-2–5°C" }, { label: "风", value: "常年大" }, { label: "行李", value: "一只登机箱" }] },
    { t: "checklist", id: "list", groups: [
      { title: "贴身层", items: ["美利奴长袖 ×2", "美利奴打底裤 ×1", "羊毛袜 ×4"] },
      { title: "保暖层", items: ["抓绒衣 ×1", "薄羽绒 ×1"] },
      { title: "外层", items: ["防水硬壳 ×1", "防水裤 ×1"] },
      { title: "配件", items: ["毛线帽", "防水手套", "泳衣（温泉）", "防滑鞋底套"] },
    ] },
    actions("夏天去呢", "要拍照好看", "压缩到背包"),
  ],
};

const mood: Fixture = {
  match: /风格|感觉|灵感|mood/,
  images: { m1: pic.olive, m2: pic.flat, m3: pic.magenta },
  ops: [
    { t: "scene", id: "s", layout: "mood", tone: "soft", bg: "#E9DDCB", accent: "#A8553F", kicker: "风格", title: "松弛感", lede: "不是随便穿，是每一件都大半号。" },
    { t: "image", id: "m1", kind: "figure", prompt: "x", pending: true },
    { t: "image", id: "m2", kind: "flatlay", prompt: "x", pending: true },
    { t: "image", id: "m3", kind: "figure", prompt: "x", pending: true },
    { t: "rules", id: "rules", do: ["天然面料，允许有褶", "低饱和，同色系叠穿"], dont: ["明显的 logo", "紧身加高跟"] },
    { t: "quote", id: "q", body: "看起来没用力，是最费力的。" },
    actions("给我一套", "适合通勤吗", "要哪些基础款"),
  ],
};

const note: Fixture = {
  match: /几点|天气|note/,
  ops: [
    { t: "scene", id: "s", layout: "note", tone: "editorial", bg: "#3A2F5B", accent: "#E6C7FF", kicker: "不在行", title: "这个我答不好", lede: "我只懂穿搭。" },
    { t: "text", id: "tx", body: "不过可以告诉我你要去哪、做什么，我来帮你决定穿什么。" },
    actions("周五面试穿什么", "秋天怎么配色"),
  ],
};

// Long text, many items, a missing colour and a failed picture in one page.
const crowded: Fixture = {
  match: /拥挤|crowded/,
  images: { hero: null },
  ops: [
    { t: "scene", id: "s", layout: "look", tone: "modern", bg: "not-a-colour", accent: "#F5F0A0", kicker: "一个特别特别长的话题标签用来测试", title: "这是一个超出十二个字限制的非常长的标题看看会怎样", lede: "这句结论也写得很长很长，用来确认在窄屏幕和宽屏幕上都不会把版面撑破，也不会和旁边的图片重叠在一起。" },
    { t: "image", id: "hero", kind: "figure", prompt: "x", pending: true },
    { t: "pieces", id: "pieces", items: Array.from({ length: 9 }, (_, i) => ({ id: "p" + i, name: i === 2 ? "一件名字非常非常长的双面羊绒落肩茧型大衣外套" : "单品 " + (i + 1), note: i % 2 ? "" : "备注也可以很长很长很长很长很长很长很长很长很长", hex: i === 4 ? "not-a-colour" : "#7A6A58" })) },
    { t: "facts", id: "facts", items: [{ label: "气温", value: "-12–35°C" }, { label: "场合", value: "通勤 / 约会 / 出差 / 婚礼" }, { label: "预算", value: "¥12,000" }, { label: "件数", value: "9" }] },
    { t: "unknown-block", id: "zz", body: "前端不认识的块应当被忽略" },
    { t: "text", id: "tx", body: "" },
    actions("一个很长很长的下一步按钮", "第二个", "第三个", "第四个"),
  ],
};

// The model sometimes offers alternatives inside a single-outfit page.
const lookWithOptions: Fixture = {
  match: /备选|options/,
  images: { hero: pic.cobalt, o1: pic.magenta, o2: pic.olive },
  ops: [
    look.ops[0],
    look.ops[1],
    { t: "option", id: "o1", title: "驼色西装", tag: "更暖", pick: true, kind: "figure", prompt: "x", pending: true, points: ["适合创意岗位"] },
    { t: "option", id: "o2", title: "灰色开衫", tag: "更软", kind: "figure", prompt: "x", pending: true, points: ["最休闲的一档"] },
    look.ops[2],
    actions("选驼色", "选开衫"),
  ],
};

const failing: Fixture = { match: /出错|error/, ops: [] };

const fixtures = [lookWithOptions, swap, compare, palette, guide, pack, mood, note, crowded, failing, look];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("aborted", "AbortError"))), { once: true });
  });

export async function mockTurn(input: string, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
  const fx = fixtures.find((f) => f.match.test(input)) ?? look;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  await sleep(700, signal);
  if (fx === failing) {
    onEvent({ event: "error", data: { message: "模型暂时没有回应，请再试一次。" } });
    onEvent({ event: "end", data: { ms: ms() } });
    return;
  }
  onEvent({ event: "first", data: { ms: ms() } });
  for (const op of fx.ops) {
    onEvent({ event: "op", data: op });
    await sleep(380, signal);
  }
  onEvent({ event: "scene_done", data: { ms: ms() } });
  let delay = 1600;
  for (const [id, url] of Object.entries(fx.images ?? {})) {
    await sleep(delay, signal);
    delay = 700;
    onEvent(url ? { event: "image", data: { id, ...url, ms: ms() } } : { event: "image_error", data: { id } });
  }
  onEvent({ event: "end", data: { ms: ms() } });
}
