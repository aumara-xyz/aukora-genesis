/**
 * Documents launcher, listing and reader dictionaries.
 *
 * The chrome is localized; document titles, paths and bodies are the operator's own
 * content and stay exactly as stored. `zh` is the key-set source of truth for this
 * package, matching the Messages lane's convention.
 *
 * The failure strings are the honest half of this dictionary: the reason itself arrives
 * from the host untranslated (it is a diagnostic, not chrome), and these keys say what a
 * failed read means for the list — that an empty-looking screen is not an empty root.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu.title': '文档',
  'menu.description': '只读 — 打开整页渲染',
  'title': '文档',
  'runtime.status': '只读 — 私有目录，不写入、不删除、不复制',
  'runtime.root': '根目录',
  'actions.refresh': '重新读取',
  'search.placeholder': '搜索标题或路径',
  'search.label': '搜索文档',
  'state.loading': '正在读取目录…',
  'list.none': '没有匹配的文档。',
  'list.empty': '这个根目录下没有 .md 文档。',
  'count.documents': '篇文档',
  'back': '返回',
  'reader.loading': '正在读取文档…',
  'meta.category': '分类',
  'meta.filenameTitle': '标题取自文件名',
  'category.root': '根目录',
  'nav.categories': '分类',
  'nav.all': '全部',
  'error.title': '读取失败',
  'error.hint': '列表为空并不代表没有文档——这次读取没有成功。',
}

/** English dictionary. */
export const en: Record<keyof typeof zh, string> = {
  'menu.title': 'Documents',
  'menu.description': 'Read-only — open full-page rendered',
  'title': 'Documents',
  'runtime.status': 'Read-only — private directory; no writes, no deletes, no copies',
  'runtime.root': 'Root',
  'actions.refresh': 'Read again',
  'search.placeholder': 'Search title or path',
  'search.label': 'Search documents',
  'state.loading': 'Reading the directory…',
  'list.none': 'No matching documents.',
  'list.empty': 'No .md documents under this root.',
  'count.documents': 'documents',
  'back': 'Back',
  'reader.loading': 'Reading the document…',
  'meta.category': 'Category',
  'meta.filenameTitle': 'title from filename',
  'category.root': 'root',
  'nav.categories': 'Categories',
  'nav.all': 'All',
  'error.title': 'The read failed',
  'error.hint': 'An empty list here does not mean an empty root — this read did not succeed.',
}

/** Every dictionary key this package renders. */
export type DocumentsKey = keyof typeof zh
