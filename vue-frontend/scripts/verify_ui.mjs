/**
 * 适配验收脚本（SPEC §9 AC-13 ~ AC-16 / §12 第 3 步）—— 全量版
 *
 * 覆盖全部 13 条路由 × 3 视口 = 39 组合，不用肉眼判断，全部走几何断言：
 *   A1 页面级无横向溢出：documentElement.scrollWidth <= clientWidth + 1
 *   A2 SVG 无压扁：渲染宽高比 == viewBox 宽高比（容差 2%）——这是本轮立项要根治的缺陷
 *   A3 无元素越出视口右边界（排除处在 overflow-x:auto 容器内的合法横滚子项）
 *   A4 外壳高度正确：body 无页面级纵向滚动（滚动必须发生在内容区）
 * 同时收集 console 错误与失败请求，用于确认 /ops/api 代理是否生效。
 *
 * 用法：node scripts/verify_ui.mjs   （需先启动 vite preview，后端 9527 在跑）
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOT_DIR = join(__dirname, '..', 'docs', 'rewrite-vue', 'shots')
const BASE = process.env.PREVIEW_URL || 'http://localhost:4174/ops'

/** 候选浏览器：优先 playwright 自带 chromium，其次本机 Edge */
const CANDIDATES = [
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1217', 'chrome-win', 'chrome.exe'),
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1217', 'chrome-win64', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const VIEWPORTS = [
  { name: '1280x720 (1920@150%)', width: 1280, height: 720 },
  { name: '1536x864 (1920@125%)', width: 1536, height: 864 },
  { name: '1920x1080 (100%)', width: 1920, height: 1080 },
]

const LENIENT = '.el-card, .panel, main, .el-table, .el-tabs'
const PAGES = [
  { name: 'dashboard', path: '/dashboard', selector: LENIENT },
  { name: 'cad', path: '/cad', selector: LENIENT },
  { name: 'users', path: '/users', selector: LENIENT },
  { name: 'settings', path: '/settings', selector: LENIENT },
  { name: 'asset-devices', path: '/asset/devices', selector: '.el-table' },
  { name: 'asset-search', path: '/asset/search', selector: '.el-card, .panel' },
  { name: 'asset-ledger', path: '/asset/ledger', selector: '.el-table, .el-card, .panel' },
  { name: 'asset-ledger-table', path: '/asset/ledger/4', selector: '.el-table, .el-card, .panel' },
  { name: 'asset-settings', path: '/asset/settings', selector: LENIENT },
  { name: 'asset-qr-labels', path: '/asset/qr-labels', selector: LENIENT },
  { name: 'asset-inventory', path: '/asset/inventory', selector: LENIENT },
  { name: 'asset-viz', path: '/asset-viz', selector: LENIENT },
  { name: 'qr-scan', path: `/qr/${encodeURIComponent('1#BZ-DDC-PF-01')}`, selector: LENIENT },
]

function pickBrowser() {
  for (const c of CANDIDATES) if (existsSync(c)) return c
  throw new Error('未找到可用浏览器，候选：' + CANDIDATES.join(' | '))
}

/** 在页面内执行几何检查（返回纯数据） */
const GEOMETRY_PROBE = () => {
  const doc = document.documentElement
  const vw = doc.clientWidth
  const vh = doc.clientHeight

  /**
   * 元素是否「被容器约束住」——两种情况都不算越界：
   *  1) 祖先为 overflow-x:hidden → 内容被裁剪，不产生可见溢出（EP 表头包裹层即此类）
   *  2) 祖先为 overflow-x:auto/scroll 且确实可滚 → 合法的局部横滚（SPEC §4.3 允许）
   * 只有祖先全为 visible 却仍越出视口，才是真的破版。
   */
  const isContained = (el) => {
    let p = el.parentElement
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'hidden') return true
      if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true
      p = p.parentElement
    }
    return false
  }

  // A1 页面级横向溢出
  const pageOverflow = doc.scrollWidth > vw + 1

  // A2 SVG 压扁检测
  const svgs = []
  document.querySelectorAll('svg').forEach((el, i) => {
    const vb = el.getAttribute('viewBox')
    const r = el.getBoundingClientRect()
    let viewRatio = null
    if (vb) {
      const p = vb.trim().split(/[\s,]+/).map(Number)
      if (p.length === 4 && p[2] > 0 && p[3] > 0) viewRatio = p[2] / p[3]
    }
    const renderRatio = r.height > 0 ? r.width / r.height : null
    let drift = null
    if (viewRatio && renderRatio) drift = Math.abs(renderRatio / viewRatio - 1)
    const par = el.getAttribute('preserveAspectRatio')
    svgs.push({
      i,
      w: Math.round(r.width),
      h: Math.round(r.height),
      viewRatio: viewRatio ? +viewRatio.toFixed(4) : null,
      renderRatio: renderRatio ? +renderRatio.toFixed(4) : null,
      drift: drift === null ? null : +drift.toFixed(4),
      preserveAspectRatio: par,
      hasWH: el.hasAttribute('width') && el.hasAttribute('height'),
      cls: (el.getAttribute('class') || '').slice(0, 40),
    })
  })

  // 只对"有实质尺寸"的 SVG 判压扁（图标 1em 级会有亚像素误差）
  const squash = svgs.filter(
    (s) => s.drift !== null && s.drift > 0.02 && s.w > 60 && s.h > 60
  )
  const forceStretch = svgs.filter((s) => s.preserveAspectRatio === 'none')

  // A3 越出视口右边界
  const offenders = []
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    if (r.right > vw + 2 && !isContained(el)) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 60),
        right: Math.round(r.right),
        vw,
      })
    }
  })

  // A4 页面级纵向滚动（应为 0，滚动应在内容区）
  const bodyVScroll = document.body.scrollHeight - vh

  // 内容区滚动容器
  const content = document.querySelector('.shell-content')
  const contentMetrics = content
    ? {
        clientWidth: content.clientWidth,
        scrollWidth: content.scrollWidth,
        clientHeight: content.clientHeight,
        scrollHeight: content.scrollHeight,
        scrollsX: content.scrollWidth > content.clientWidth + 1,
        scrollsY: content.scrollHeight > content.clientHeight + 1,
      }
    : null

  // 侧栏宽度（校验 §6.2 矩阵）
  const sider = document.querySelector('.sider')
  const siderWidth = sider ? Math.round(sider.getBoundingClientRect().width) : null

  return {
    viewport: { vw, vh },
    pageOverflow,
    svgCount: svgs.length,
    squash,
    forceStretch,
    bigSvgs: svgs.filter((s) => s.w > 60 || s.h > 60).slice(0, 12),
    overflowOffenders: offenders.slice(0, 12),
    overflowCount: offenders.length,
    bodyVScroll,
    contentMetrics,
    siderWidth,
  }
}

async function main() {
  if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true })
  const exe = pickBrowser()
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
  const report = { browser: exe, base: BASE, ranAt: new Date().toISOString(), results: [] }

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    })
    const page = await ctx.newPage()
    const consoleErrors = []
    const failedRequests = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200))
    })
    page.on('requestfailed', (r) => failedRequests.push(r.url().slice(0, 120)))
    page.on('response', (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(0, 110)}`)
    })

    for (const pg of PAGES) {
      consoleErrors.length = 0
      failedRequests.length = 0
      const url = BASE + pg.path
      const entry = { viewport: vp.name, page: pg.path, url }
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      } catch {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        } catch (e) {
          entry.navigationError = String(e).slice(0, 200)
        }
      }
      await page.waitForTimeout(1500)
      try {
        await page.waitForSelector(pg.selector, { timeout: 8000 })
        entry.selectorFound = true
      } catch {
        entry.selectorFound = false
      }
      try {
        entry.geometry = await page.evaluate(GEOMETRY_PROBE)
      } catch (e) {
        entry.probeError = String(e).slice(0, 200)
      }
      entry.consoleErrors = [...new Set(consoleErrors)].slice(0, 8)
      entry.failedRequests = [...new Set(failedRequests)].slice(0, 8)
      entry.title = await page.title()
      const shot = join(SHOT_DIR, `${pg.name}-${vp.width}x${vp.height}.png`)
      await page.screenshot({ path: shot, fullPage: false })
      entry.screenshot = shot
      report.results.push(entry)
    }
    await ctx.close()
  }

  await browser.close()

  // ── 判定 ───────────────────────────────────────────────────────────
  const verdicts = report.results.map((r) => {
    const g = r.geometry
    return {
      viewport: r.viewport,
      page: r.page,
      A1_noPageOverflow: g ? !g.pageOverflow : null,
      A2_noSquash: g ? g.squash.length === 0 && g.forceStretch.length === 0 : null,
      A3_noOverflowOut: g ? g.overflowCount === 0 : null,
      A4_noBodyScroll: g ? Math.abs(g.bodyVScroll) <= 1 : null,
      siderWidth: g ? g.siderWidth : null,
      svgCount: g ? g.svgCount : null,
    }
  })
  report.verdicts = verdicts
  report.allPass = verdicts.every(
    (v) => v.A1_noPageOverflow && v.A2_noSquash && v.A3_noOverflowOut && v.A4_noBodyScroll
  )

  writeFileSync(join(SHOT_DIR, '..', 'verify_report.json'), JSON.stringify(report, null, 2), 'utf8')

  const lines = []
  for (const v of verdicts) {
    lines.push(
      `${v.viewport} ${v.page} | A1无页面溢出=${v.A1_noPageOverflow} A2无压扁=${v.A2_noSquash} ` +
        `A3无越界=${v.A3_noOverflowOut} A4无body滚动=${v.A4_noBodyScroll} | 侧栏=${v.siderWidth}px svg=${v.svgCount}`
    )
  }
  lines.push(`ALL_PASS=${report.allPass}`)
  writeFileSync(join(SHOT_DIR, '..', 'verify_summary.txt'), lines.join('\n') + '\n', 'utf8')
  console.log(lines.join('\n'))
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
