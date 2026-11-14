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

const subject: Fixture = {
  match: /水母|subject/,
  images: { hero: pic.jelly },
  ops: [
    { t: "scene", id: "s", layout: "subject", tone: "editorial", bg: "#0E2A5C", accent: "#BFE3FF", kicker: "海洋生物", title: "没有大脑也会游", lede: "一圈神经网指挥伞体收缩，一缩一放就往前走。" },
    { t: "image", id: "hero", kind: "subject", prompt: "x", pending: true },
    { t: "parts", id: "parts", items: [
      { id: "p1", name: "伞体", note: "收缩一次，喷出一股水", hex: "#9FC4E8" },
      { id: "p2", name: "神经网", note: "没有中枢，全身一起反应", hex: "#E8D9A0" },
      { id: "p3", name: "触手", note: "带刺细胞，负责捕食" , hex: "#D7A0C8" },
    ] },
    { t: "quote", id: "q", body: "它不是在想怎么游，是身体的节律在替它游。" },
    actions("神经网是什么", "和章鱼比", "考考我"),
  ],
};

const deeper: Fixture = {
  match: /展开|讲讲/,
  images: { hero: pic.jelly },
  ops: [
    { t: "scene", id: "s", layout: "process", tone: "editorial", bg: "#0E2A5C", accent: "#BFE3FF", kicker: "水母 · 神经网", title: "一张会放电的网", lede: "信号从任意一点出发，都会传遍整个伞缘。" },
    { t: "image", id: "hero", kind: "subject", keep: true },
    { t: "steps", id: "steps", items: [
      { title: "感受器发现变化", body: "伞缘的感觉棒感知光线和重力。" },
      { title: "信号沿网扩散", body: "没有中枢，神经元彼此直接相连。" },
      { title: "肌肉同时收缩", body: "整圈伞体一起收紧，把水挤出去。" },
    ] },
    { t: "facts", id: "facts", items: [{ label: "出现时间", value: "约 5 亿年前" }, { label: "含水量", value: "约 95%" }] },
    actions("回到水母", "和人脑比", "考考我"),
  ],
};

const compare: Fixture = {
  match: /不同|还是|哪个|compare/,
  images: { o1: pic.moka, o2: pic.saturn },
  ops: [
    { t: "scene", id: "s", layout: "compare", tone: "modern", bg: "#1B1512", accent: "#F2C078", kicker: "咖啡", title: "差在奶泡", lede: "浓缩一样多，区别是牛奶和奶泡的比例。" },
    { t: "option", id: "o1", title: "拿铁", tag: "奶多泡薄", kind: "subject", prompt: "x", pending: true, points: ["牛奶约占三分之二", "奶泡只有薄薄一层", "口感顺，咖啡味淡"] },
    { t: "option", id: "o2", title: "卡布奇诺", tag: "奶少泡厚", kind: "subject", prompt: "x", pending: true, points: ["浓缩、牛奶、奶泡各三分之一", "奶泡厚，入口先是泡", "咖啡味更明显"] },
    { t: "bars", id: "bars", unit: "ml", items: [{ label: "拿铁的牛奶", value: 200 }, { label: "卡布奇诺的牛奶", value: 60 }] },
    actions("澳白呢", "在家怎么做", "考考我"),
  ],
};

// Two options the model gave no pictures: they are set in type alone.
const words: Fixture = {
  match: /区别|词|words/,
  ops: [
    { t: "scene", id: "s", layout: "compare", tone: "soft", bg: "#D9C8E8", accent: "#5B3A8A", kicker: "词义辨析", title: "专家靠职业，行家靠本事", lede: "professional 说的是以此为业；expert 说的是懂得多、有专长。" },
    { t: "option", id: "o1", title: "professional", tag: "职业身份与水准", bg: "#F2E6C9", points: ["强调以此为职业、按行规办事", "可作名词：一位专业人士", "也可作形容词：专业的、得体的"] },
    { t: "option", id: "o2", title: "expert", tag: "某领域的专长", bg: "#BFD8E8", points: ["强调知识技能远超常人", "可作名词：an expert on…", "作形容词：expert advice"] },
    { t: "cards", id: "cards", items: [{ front: "She is a professional.", back: "她是专业人士：靠这个吃饭，做事合乎行规。" }, { front: "He is an expert on birds.", back: "他是鸟类专家：懂得多。" }, { front: "He's an expert, not a professional.", back: "他很懂行，但不以此为业。这句话里两个词的分工最清楚。" }, { front: "expert advice", back: "内行的建议" }] },
    { t: "quote", id: "q", body: "professional 回答“这是不是他的行当”，expert 回答“他懂不懂”。" },
    actions("考考我", "再加一个词", "看回对比"),
  ],
};

const layers: Fixture = {
  match: /大气|分层|哪几层|layers/,
  ops: [
    { t: "scene", id: "s", layout: "layers", tone: "modern", bg: "#0B1026", accent: "#9FC4FF", kicker: "地球科学", title: "五层大气", lede: "越往上越稀薄，温度却忽冷忽热。" },
    { t: "bands", id: "bands", dir: "rows", items: [
      { name: "散逸层", value: "700 km 以上", note: "逐渐过渡到太空", hex: "#0B1026", weight: 30 },
      { name: "热层", value: "85–700 km", note: "极光和空间站在这里", hex: "#27306B", weight: 40 },
      { name: "中间层", value: "50–85 km", note: "流星在这里烧掉", hex: "#4A5FB0", weight: 14 },
      { name: "平流层", value: "12–50 km", note: "臭氧层，客机巡航高度", hex: "#7FA6E0", weight: 16 },
      { name: "对流层", value: "0–12 km", note: "天气都发生在这里", hex: "#CFE4F7", weight: 12 },
    ] },
    { t: "facts", id: "facts", items: [{ label: "对流层占大气质量", value: "约 75%" }, { label: "太空的起点", value: "100 km" }] },
    { t: "quote", id: "q", body: "我们活在最薄也最重的那一层里。" },
    actions("为什么会分层", "臭氧层在哪", "考考我"),
  ],
};

const timeline: Fixture = {
  match: /罗马|历史|衰落|timeline/,
  images: { hero: pic.rome },
  ops: [
    { t: "scene", id: "s", layout: "timeline", tone: "editorial", bg: "#5A2A1E", accent: "#F0C98A", kicker: "古罗马", title: "不是一夜崩塌", lede: "从极盛到西罗马灭亡，中间隔了三百多年。" },
    { t: "image", id: "hero", kind: "scene", prompt: "x", pending: true },
    { t: "timeline", id: "tl", items: [
      { when: "117 年", title: "疆域最大", body: "图拉真时期，版图约 500 万平方公里。" },
      { when: "235 年", title: "三世纪危机", body: "五十年里换了二十多位皇帝。" },
      { when: "395 年", title: "东西分治", body: "帝国永久分成两半。" },
      { when: "476 年", title: "西罗马灭亡", body: "最后一位皇帝被废黜。" },
    ] },
    actions("为什么会分裂", "东罗马后来呢", "考考我"),
  ],
};

const process: Fixture = {
  match: /复利|怎么回事|原理|怎么工作|process/,
  ops: [
    { t: "scene", id: "s", layout: "process", tone: "modern", bg: "#E3A92B", accent: "#1F2A44", kicker: "理财常识", title: "利息也生利息", lede: "时间越长，后面的增长越陡。" },
    { t: "steps", id: "steps", items: [
      { title: "本金产生利息", body: "1 万元，年利率 5%，一年后多 500。" },
      { title: "利息并入本金", body: "第二年按 10,500 计息。" },
      { title: "重复很多年", body: "增长从直线变成曲线。" },
    ] },
    { t: "bars", id: "bars", unit: "元", items: [{ label: "10 年", value: 16289 }, { label: "20 年", value: 26533 }, { label: "30 年", value: 43219 }] },
    { t: "rules", id: "rules", doLabel: "事实", dontLabel: "误解", do: ["前十年看起来很慢"], dont: ["利率高一点点无所谓"] },
    actions("72 法则", "和单利比", "考考我"),
  ],
};

const study: Fixture = {
  match: /考考|记住|出题|study/,
  ops: [
    { t: "scene", id: "s", layout: "study", tone: "modern", bg: "#2B1B4A", accent: "#F2D36B", kicker: "太阳系 · 自测", title: "三道题", lede: "先翻卡片过一遍，再答题。" },
    { t: "cards", id: "cards", items: [
      { front: "最大的行星", back: "木星，直径约为地球的 11 倍" },
      { front: "最热的行星", back: "金星，表面约 465°C" },
      { front: "有明显光环的行星", back: "土星最显眼，其余三颗气态行星也有" },
      { front: "离太阳最近的行星", back: "水星" },
    ] },
    { t: "quiz", id: "q1", question: "哪颗行星的一天比一年还长？", options: ["水星", "金星", "火星"], answer: 1, why: "金星自转一圈约 243 个地球日，公转一圈约 225 个地球日。" },
    { t: "quiz", id: "q2", question: "太阳系里最高的山在哪颗星球上？", options: ["火星", "地球", "木卫一"], answer: 0, why: "火星的奥林帕斯山高约 22 公里。" },
    actions("再来三道", "讲讲金星", "换成恒星"),
  ],
};

const gallery: Fixture = {
  match: /风格|哪些|种类|gallery/,
  images: { m1: pic.saturn, m2: pic.fossils, m3: pic.rome },
  ops: [
    { t: "scene", id: "s", layout: "gallery", tone: "soft", bg: "#E9DDCB", accent: "#A8553F", kicker: "化石", title: "石头里的生命", lede: "遗体、痕迹和树脂，都能把生命留下来。" },
    { t: "image", id: "m1", kind: "subject", prompt: "x", pending: true },
    { t: "image", id: "m2", kind: "set", prompt: "x", pending: true },
    { t: "image", id: "m3", kind: "scene", prompt: "x", pending: true },
    { t: "rules", id: "rules", doLabel: "容易留下", dontLabel: "很难留下", do: ["壳、骨头、牙齿", "被快速掩埋的"], dont: ["柔软的身体", "暴露在空气里的"] },
    { t: "quote", id: "q", body: "能变成化石的，不到万分之一。" },
    actions("琥珀怎么形成", "怎么测年代", "考考我"),
  ],
};

const plan: Fixture = {
  match: /学.*哪些|路线|清单|plan/,
  images: { hero: pic.fossils },
  ops: [
    { t: "scene", id: "s", layout: "plan", tone: "modern", bg: "#8FA68A", accent: "#1F3A2A", kicker: "入门路线", title: "四周学会看化石", lede: "先认类型，再学年代，最后去一次博物馆。" },
    { t: "image", id: "hero", kind: "set", prompt: "x", pending: true },
    { t: "facts", id: "facts", items: [{ label: "每周投入", value: "3 小时" }, { label: "总时长", value: "4 周" }] },
    { t: "checklist", id: "list", groups: [
      { title: "第一周", items: ["化石是怎么形成的", "实体化石和遗迹化石"] },
      { title: "第二周", items: ["三叶虫", "菊石", "鲨鱼牙"] },
      { title: "第三周", items: ["地质年代表", "怎么测定年代"] },
      { title: "第四周", items: ["逛一次自然博物馆", "自己做一张笔记"] },
    ] },
    actions("推荐几本书", "压缩到两周", "考考我"),
  ],
};

const note: Fixture = {
  match: /几点|你好|note/,
  ops: [
    { t: "scene", id: "s", layout: "note", tone: "editorial", bg: "#3A2F5B", accent: "#E6C7FF", kicker: "你好", title: "问点什么吧", lede: "一个东西、一段历史、一个原理，都可以。" },
    { t: "text", id: "tx", body: "也可以附一张图，让我讲讲它是什么。" },
    actions("水母怎么游泳", "考考我太阳系"),
  ],
};

// Long text, many items, a missing colour and a failed picture in one page.
const crowded: Fixture = {
  match: /拥挤|crowded/,
  images: { hero: null },
  ops: [
    { t: "scene", id: "s", layout: "subject", tone: "modern", bg: "not-a-colour", accent: "#F5F0A0", kicker: "一个特别特别长的话题标签用来测试", title: "这是一个超出八个字限制的非常长的标题看看会怎样", lede: "这句结论也写得很长很长，用来确认在窄屏幕和宽屏幕上都不会把版面撑破，也不会和旁边的图片重叠在一起。" },
    { t: "image", id: "hero", kind: "subject", prompt: "x", pending: true },
    { t: "parts", id: "parts", items: Array.from({ length: 9 }, (_, i) => ({ id: "p" + i, name: i === 2 ? "一个名字非常非常长的组成部分用来测试换行" : "部分 " + (i + 1), note: i % 2 ? "" : "备注也可以很长很长很长很长很长很长很长很长很长", hex: i === 4 ? "not-a-colour" : "#7A6A58" })) },
    { t: "facts", id: "facts", items: [{ label: "温度", value: "-12–35°C" }, { label: "范围", value: "欧洲 / 亚洲 / 北美 / 非洲" }, { label: "数量", value: "12,000" }, { label: "种类", value: "9" }] },
    { t: "quiz", id: "qz", question: "一道选项很长的题目用来测试", options: ["第一个选项写得特别特别长看看会不会撑破", "第二个", "第三个", "第四个"], answer: 9, why: "" },
    { t: "unknown-block", id: "zz", body: "前端不认识的块应当被忽略" },
    { t: "text", id: "tx", body: "" },
    actions("一个很长很长的下一步按钮", "第二个", "第三个", "第四个"),
  ],
};

const failing: Fixture = { match: /出错|error/, ops: [] };

const fixtures = [words, deeper, study, compare, layers, timeline, process, gallery, plan, note, crowded, failing, subject];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("aborted", "AbortError"))), { once: true });
  });

export async function mockTurn(input: string, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
  const fx = fixtures.find((f) => f.match.test(input)) ?? subject;
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
