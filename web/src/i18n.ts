// Interface text in English and Chinese. English is the default; Chinese is
// used when the browser asks for it or the reader switches. What a page says
// is written by the model in the language of the question, not taken from here.
export type Lang = "en" | "zh";

const KEY = "folio.lang";

function detect(): Lang {
  const asked = new URLSearchParams(location.search).get("lang");
  if (asked === "en" || asked === "zh") return asked;
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === "en" || kept === "zh") return kept;
  } catch {
    // Storage can be unavailable in private modes; the browser language still applies.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export const LANG: Lang = detect();
document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";

/** Switches the interface to the other language. Pages already made keep their own. */
export function switchLang() {
  try {
    localStorage.setItem(KEY, LANG === "zh" ? "en" : "zh");
  } catch {
    // Without storage the choice cannot be kept, so there is nothing to do.
  }
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  history.replaceState(history.state, "", url);
  location.reload();
}

const en = {
  suggestions: ["How do jellyfish swim without a brain?", "Latte or cappuccino: what’s the difference?", "The layers of the atmosphere", "How did the Roman Empire fall?", "How does compound interest work?", "Quiz me on the solar system"],
  tagline: "Ask anything. Get a page.",
  resume: "Continue",
  resumeUntitled: "Your last page",
  toCover: "Back to the cover",
  prev: "Previous page",
  next: "Next page",
  timing: "Timing",
  timingTitle: "Time per stage. Click to show or hide.",
  mock: "Sample data",
  history: "History",
  memory: "Memory",
  otherLang: "中文",
  setupTitle: "One more step",
  setupNote: "Fix this, restart the server, then reload this page.",
  removePic: "Remove this picture",
  addPic: "Attach a picture",
  addPicTitle: "Attach a picture and ask about it",
  phMaking: "Composing your page…",
  phPictures: "Making the pictures…",
  phWithPic: "Ask about this picture, or just send it",
  phFollow: "Ask a follow-up, like “give me an example”",
  phFirst: "Ask anything, or attach a picture",
  inputLabel: "Your question",
  send: "Send",
  defaultAsk: "What is this? Tell me about it.",
  badPic: "Couldn’t read that picture. Try another one.",
  remembered: (items: string[]) => "Remembered: " + items.join(", "),
  dropped: "The connection dropped. Please try again.",
  failed: "Something went wrong. Please try again.",
  notSaved: "Couldn’t save this page to your history.",
  cantOpen: "Couldn’t open that conversation.",
  tFirst: "First block",
  tLayout: "Layout",
  tPictures: "Pictures",
  seconds: (s: string) => s + " s",
  pick: "Top pick",
  fineprint: "Written by an AI model and may contain mistakes. Check anything important.",
  picEditing: "Updating the picture",
  picMaking: "Making the picture",
  picEditFailed: "Couldn’t update it, so here’s the original",
  picFailed: "No picture this time",
  more: (name: string) => `Tell me more about ${name}`,
  moreLabel: "More",
  doLabel: "That’s right",
  dontLabel: "Not quite",
  flip: "Flip to see the answer",
  flipBack: "Flip back",
  right: "Correct.",
  wrong: "Not quite.",
  done: "done",
  close: "Close",
  memoryEmpty: "Nothing yet. Things you mention about yourself and how you like things explained are kept here, like “I’m in ninth grade” or “use more analogies”, and later pages follow them.",
  forget: "Forget",
  forgetThis: (text: string) => `Forget: ${text}`,
  memoryNote: "Kept only on the computer running this app, and sent to the model with each question.",
  forgetAll: "Forget everything",
  forgetAllArmed: "Tap again to forget everything",
  undo: "Undo",
  loading: "Loading…",
  historyEmpty: "Nothing yet. Every page you make is kept here, so you can come back and keep asking.",
  untitled: "Untitled",
  pages: (n: number) => (n === 1 ? "1 page" : `${n} pages`),
  openNow: "open now",
  del: "Delete",
  delArmed: "Really delete?",
  historyNote: "These pages and their pictures are kept on the computer running this app. Anyone who can open this address can see them.",
  locale: "en-US",
};

const zh: typeof en = {
  suggestions: ["水母没有大脑，怎么游泳", "拿铁和卡布奇诺有什么不同", "大气层分哪几层", "罗马帝国是怎么衰落的", "复利是怎么回事", "考考我太阳系"],
  tagline: "问什么，都给你排一页。",
  resume: "接着看",
  resumeUntitled: "上次那一页",
  toCover: "回到封面",
  prev: "上一页",
  next: "下一页",
  timing: "耗时",
  timingTitle: "各阶段耗时，点击收起或展开",
  mock: "假数据",
  history: "历史",
  memory: "记忆",
  otherLang: "English",
  setupTitle: "还差一步才能用",
  setupNote: "改好后重启服务，再刷新这个页面。",
  removePic: "去掉这张图片",
  addPic: "附一张图片",
  addPicTitle: "附一张图片，问问这是什么",
  phMaking: "正在排这一页…",
  phPictures: "正在出图…",
  phWithPic: "想问这张图什么？不写就直接讲",
  phFollow: "接着问，比如“举个例子”",
  phFirst: "问点什么，或者附一张图",
  inputLabel: "输入你的问题",
  send: "发送",
  defaultAsk: "这是什么？讲讲它。",
  badPic: "这张图读不出来，换一张试试",
  remembered: (items) => "记住了：" + items.join("、"),
  dropped: "连接断了，请再试一次。",
  failed: "出错了，请再试一次。",
  notSaved: "这一页没能存进历史",
  cantOpen: "打不开这段记录",
  tFirst: "首块",
  tLayout: "版面",
  tPictures: "图片",
  seconds: (s) => s + " 秒",
  pick: "推荐",
  fineprint: "由模型生成，可能有误，重要信息请核实。",
  picEditing: "正在改图",
  picMaking: "正在出图",
  picEditFailed: "没改成，保留原图",
  picFailed: "图没出来",
  more: (name) => `展开讲讲「${name}」`,
  moreLabel: "展开",
  doLabel: "是这样",
  dontLabel: "不是这样",
  flip: "翻面看答案",
  flipBack: "翻回正面",
  right: "答对了。",
  wrong: "不对。",
  done: "已完成",
  close: "关闭",
  memoryEmpty: "还没有。你提到的背景和偏好会记在这里，比如“我是初中生”“多用比喻讲”，之后的讲解会照着来。",
  forget: "忘掉",
  forgetThis: (text) => `忘掉：${text}`,
  memoryNote: "这些只存在运行这个应用的电脑上，每次提问时会一起发给模型。",
  forgetAll: "全部忘掉",
  forgetAllArmed: "再点一次，全部忘掉",
  undo: "撤销",
  loading: "正在读取…",
  historyEmpty: "还没有。问过的每一页都会留在这里，下次进来可以接着看、接着问。",
  untitled: "未命名的一页",
  pages: (n) => `${n} 页`,
  openNow: "正在看",
  del: "删除",
  delArmed: "确定删除",
  historyNote: "这些页面和里面的图片存在运行这个应用的电脑上，能打开这个地址的人都看得到。",
  locale: "zh-CN",
};

export const T = LANG === "zh" ? zh : en;
