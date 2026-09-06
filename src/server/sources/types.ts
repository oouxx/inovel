// ---------- Legado 书源类型(解析所需字段) ----------

export interface SourceRuleBookInfo {
  name?: string;
  author?: string;
  kind?: string;
  wordCount?: string;
  lastChapter?: string;
  intro?: string;
  coverUrl?: string;
  tocUrl?: string;
  init?: string;
  canReName?: string;
}

export interface SourceRuleToc {
  chapterList?: string;
  chapterName?: string;
  chapterUrl?: string;
  isVip?: string;
  updateTime?: string;
  nextTocUrl?: string;
  isVolume?: string;
}

export interface SourceRuleContent {
  content?: string;
  nextContentUrl?: string;
  replaceRegex?: string;
  imageStyle?: string;
  sourceRegex?: string;
}

export interface SourceRuleSearch {
  checkKeyWord?: string;
  bookList?: string;
  name?: string;
  author?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  coverUrl?: string;
  bookUrl?: string;
  wordCount?: string;
}

export interface SourceRuleExplore {
  bookList?: string;
  name?: string;
  author?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  coverUrl?: string;
  bookUrl?: string;
  wordCount?: string;
}

/** Legado 书源原始 JSON(只声明我们关心的字段,其余原样保留) */
export interface RawBookSource {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceGroup?: string | null;
  enabled?: boolean;
  enabledExplore?: boolean;
  exploreUrl?: string;
  searchUrl?: string;
  ruleSearch?: SourceRuleSearch;
  ruleBookInfo?: SourceRuleBookInfo;
  ruleToc?: SourceRuleToc;
  ruleContent?: SourceRuleContent;
  ruleExplore?: SourceRuleExplore;
  header?: string | Record<string, string>;
  loginUrl?: string;
  loginUi?: string;
  bookSourceComment?: string;
  bookUrlPattern?: string;
  concurrentRate?: string;
  variableComment?: string;
  enabledCookieJar?: boolean;
  weight?: number;
  customOrder?: number;
  lastUpdateTime?: number;
  respondTime?: number;
  [k: string]: unknown;
}

/** 引擎内部使用的书源包装 */
export interface SourceContext {
  raw: RawBookSource;
  key: string;
  /** 源变量(source.getVariable) */
  variable: string;
}