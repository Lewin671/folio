package agent

import "net/http"

// langOf is the language of the reader's interface, sent by the page with
// every request. English unless the page says Chinese.
func langOf(r *http.Request) string {
	if r.Header.Get("X-Folio-Lang") == "zh" {
		return "zh"
	}
	return "en"
}

func say(lang, en, zh string) string {
	if lang == "zh" {
		return zh
	}
	return en
}

// languageNote tells the text model which language to write the page in. The
// question decides; the interface language only settles unclear cases, such
// as a picture sent without words.
func languageNote(lang string) string {
	return "\n\n## 语言\n\n" +
		"页面上所有给人看的文字（kicker、标题、正文、标签、按钮、remember 的条目）都用用户这次提问所用的语言书写。提问看不出语言时（例如只有一张图片），用" + say(lang, "英文", "中文") + "。prompt 和 bgName 始终用英文。\n\n" +
		"用英文写时：像英文杂志的编辑那样写，自然、地道、简洁，不要有翻译腔，不要直译中文的说法。" +
		"title 用 2 到 5 个词，只有首词和专有名词大写（sentence case），不加句号；kicker 用 1 到 3 个词；lede 一句话，不超过 20 个词。" +
		"上文所有以“字”计的长度限制，按一个汉字约等于半个英文单词换算，宁短勿长。" +
		"数字、日期和单位按英文习惯写（1492、3 km、25%、5th century）。" +
		"actions 用简短的口语短语，像读者自己会说的话（Give me an example、How does it sting?、Quiz me）。" +
		"拼写用美式英语。"
}
