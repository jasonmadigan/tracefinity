import { test, expect, Page } from '@playwright/test'
import path from 'path'

const FIXTURE_IMAGE = path.join(__dirname, 'fixtures', 'tool.jpg')

type Mat = [number, number, number, number, number, number]

// matrix(a, b, c, d, e, f) maps (x, y) -> (a*x + c*y + e, b*x + d*y + f)
function parseMatrix(s: string): Mat {
  const m = s.match(/matrix\(([^)]+)\)/)
  if (!m) throw new Error(`not a matrix: ${s}`)
  const v = m[1].split(/[\s,]+/).map(Number)
  return [v[0], v[1], v[2], v[3], v[4], v[5]]
}

function invertMatrix([a, b, c, d, e, f]: Mat): Mat {
  const det = a * d - c * b
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)]
}

function composeMatrix(m2: Mat, m1: Mat): Mat {
  const [a2, b2, c2, d2, e2, f2] = m2
  const [a1, b1, c1, d1, e1, f1] = m1
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ]
}

function applyMatrix([a, b, c, d, e, f]: Mat, p: { x: number; y: number }) {
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f }
}

function firstVertex(d: string): { x: number; y: number } {
  const m = d.match(/M\s*([\d.eE+-]+)[ ,]\s*([\d.eE+-]+)/)
  if (!m) throw new Error(`no moveto in path: ${d.slice(0, 40)}`)
  return { x: Number(m[1]), y: Number(m[2]) }
}

test.describe.serial('happy path', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
  })

  test.afterAll(async () => {
    await page.close()
  })

  let sessionId: string

  test('upload image', async () => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(FIXTURE_IMAGE)

    await page.waitForURL(/\/trace\//, { timeout: 60_000 })
    sessionId = page.url().split('/trace/')[1]
    expect(sessionId).toBeTruthy()
  })

  test('confirm corners', async () => {
    const continueBtn = page.getByRole('button', { name: 'Continue' })
    await expect(continueBtn).toBeVisible({ timeout: 10_000 })
    await continueBtn.click()

    // may auto-trace (single tracer) or land on trace step (multiple tracers)
    await expect(
      page.getByRole('heading', { name: /Trace Tools|Select Tools/ })
    ).toBeVisible({ timeout: 30_000 })
  })

  test('trace tools', async () => {
    // if already on edit step (auto-traced), skip
    const heading = await page.getByRole('heading', { name: 'Select Tools' }).isVisible()
    if (heading) return

    const traceBtn = page.getByRole('button', { name: 'Trace Tools' })
    await expect(traceBtn).toBeVisible()
    await traceBtn.click()

    await expect(page.getByRole('heading', { name: 'Select Tools' })).toBeVisible({ timeout: 30_000 })
  })

  test('verify trace results', async () => {
    const polygonPaths = page.locator('svg path[d]')
    await expect(polygonPaths.first()).toBeVisible({ timeout: 5_000 })

    // select all detected tools by clicking each tool row in the sidebar
    const toolRows = page.locator('.space-y-3 .text-xs.space-y-0\\.5 > div')
    const count = await toolRows.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await toolRows.nth(i).click()
    }

    const saveBtn = page.getByRole('button', { name: /^Save \d+ tools?$/ })
    await expect(saveBtn).toBeVisible()
    await expect(saveBtn).toBeEnabled()
  })

  test('save to library', async () => {
    const saveBtn = page.getByRole('button', { name: /^Save \d+ tools?$/ })
    await saveBtn.click()

    await page.waitForURL('/', { timeout: 10_000 })

    // at least one tool card should exist with "hacksaw" label
    await expect(page.getByText('hacksaw').first()).toBeVisible({ timeout: 5_000 })
  })

  let toolId: string

  test('open tool editor', async () => {
    // click the first hacksaw card
    await page.getByText('hacksaw').first().click()

    await page.waitForURL(/\/tools\//, { timeout: 10_000 })
    toolId = page.url().split('/tools/')[1]
    expect(toolId).toBeTruthy()

    const svgPath = page.locator('svg path[d]')
    await expect(svgPath.first()).toBeVisible({ timeout: 5_000 })

    await expect(page.getByText(/\d+ vertices/)).toBeVisible()
  })

  test('toggle smooth', async () => {
    // the editor always opens in the accurate view, independently of the
    // tool's saved output preference
    const statusText = page.getByText(/\d+ vertices/)
    const accurateText = await statusText.textContent()
    await expect(page.getByRole('button', { name: 'Accurate', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Output: Smooth' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Smooth', exact: true }).click()
    await expect(statusText).not.toHaveText(accurateText!, { timeout: 5_000 })

    await page.getByRole('button', { name: 'Accurate', exact: true }).click()
    await expect(statusText).toHaveText(accurateText!, { timeout: 5_000 })
  })

  test('rotating keeps the source photo aligned through undo/redo', async () => {
    // tools saved from a traced session carry their source photo
    const image = page.locator('svg image')
    await expect(image).toBeVisible({ timeout: 5_000 })
    const before = await image.getAttribute('transform')
    expect(before).toBeTruthy()

    await page.getByRole('button', { name: 'Rotate 90 clockwise' }).click()
    await expect(image).not.toHaveAttribute('transform', before!, { timeout: 5_000 })
    const rotated = await image.getAttribute('transform')

    // undo must restore the photo transform along with the outline
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(image).toHaveAttribute('transform', before!, { timeout: 5_000 })

    // redo must re-apply it
    await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click()
    await expect(image).toHaveAttribute('transform', rotated!, { timeout: 5_000 })

    // back to the original orientation for the rest of the flow
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(image).toHaveAttribute('transform', before!, { timeout: 5_000 })
  })

  test('auto-rotate keeps the source photo aligned', async () => {
    // fresh mount so this test owns its undo history
    await page.goto(`/tools/${toolId}`)
    const image = page.locator('svg image')
    await expect(image).toBeVisible({ timeout: 10_000 })
    // the editor opens in accurate mode, so the path's first vertex is stable

    // scope to the editor canvas: the dev overlay's shadow DOM also holds
    // evenodd paths and playwright locators pierce shadow roots
    const outline = page.locator('svg:has(image) path[fill-rule="evenodd"]')
    const before = (await image.getAttribute('transform'))!
    const dBefore = (await outline.getAttribute('d'))!

    // deterministic angle: the endpoint only computes a number, the frontend
    // applies it, so mocking it still exercises the whole rotation path
    await page.route('**/api/tools/*/auto-rotate', route => route.fulfill({ json: { angle: 30 } }))
    await page.getByRole('button', { name: 'Auto', exact: true }).click()
    await expect(image).not.toHaveAttribute('transform', before, { timeout: 5_000 })
    await page.unroute('**/api/tools/*/auto-rotate')

    // outline and photo must undergo the same rigid transform: the photo's
    // delta applied to the old first vertex must land on the new first vertex
    const rotated = (await image.getAttribute('transform'))!
    const delta = composeMatrix(parseMatrix(rotated), invertMatrix(parseMatrix(before)))
    const expected = applyMatrix(delta, firstVertex(dBefore))
    const vertexAfter = firstVertex((await outline.getAttribute('d'))!)
    expect(vertexAfter.x).toBeCloseTo(expected.x, 3)
    expect(vertexAfter.y).toBeCloseTo(expected.y, 3)

    // undo restores both together, redo re-applies both
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(image).toHaveAttribute('transform', before, { timeout: 5_000 })
    await expect(outline).toHaveAttribute('d', dBefore)
    await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click()
    await expect(image).toHaveAttribute('transform', rotated, { timeout: 5_000 })
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(image).toHaveAttribute('transform', before, { timeout: 5_000 })
  })

  test('flips and drag-rotate carry the photo through undo', async () => {
    await page.goto(`/tools/${toolId}`)
    const image = page.locator('svg image')
    await expect(image).toBeVisible({ timeout: 10_000 })
    const t0 = (await image.getAttribute('transform'))!

    await page.getByRole('button', { name: 'Flip horizontally' }).click()
    await expect(image).not.toHaveAttribute('transform', t0, { timeout: 5_000 })
    const t1 = (await image.getAttribute('transform'))!

    await page.getByRole('button', { name: 'Flip vertically' }).click()
    await expect(image).not.toHaveAttribute('transform', t1, { timeout: 5_000 })
    const t2 = (await image.getAttribute('transform'))!

    // drag-rotate from a corner rotation zone; mousedown is dispatched on the
    // element because the zone rect is transparent to hit-testing
    const zone = page.locator('svg:has(image) rect.cursor-rotate').first()
    const box = (await zone.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await zone.evaluate((el, c) => {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y }))
    }, { x: cx, y: cy })
    await page.mouse.move(cx + 80, cy + 30, { steps: 5 })
    await page.mouse.up()
    await expect(image).not.toHaveAttribute('transform', t2, { timeout: 5_000 })

    // three entries, three undos, each restoring the photo with the outline
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(image).toHaveAttribute('transform', t2, { timeout: 5_000 })
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(image).toHaveAttribute('transform', t1, { timeout: 5_000 })
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(image).toHaveAttribute('transform', t0, { timeout: 5_000 })
  })

  test('edits during auto-rotate keep history intact', async () => {
    await page.goto(`/tools/${toolId}`)
    const image = page.locator('svg image')
    await expect(image).toBeVisible({ timeout: 10_000 })
    const t0 = (await image.getAttribute('transform'))!

    // slow the angle fetch so a manual rotate can land mid-flight
    await page.route('**/api/tools/*/auto-rotate', async route => {
      await new Promise(resolve => setTimeout(resolve, 2_000))
      await route.fulfill({ json: { angle: 30 } })
    })
    await page.getByRole('button', { name: 'Auto', exact: true }).click()
    await page.getByRole('button', { name: 'Rotate 90 clockwise' }).click()
    await expect(image).not.toHaveAttribute('transform', t0, { timeout: 1_000 })
    const t1 = (await image.getAttribute('transform'))!

    // auto-rotate resolves on top of the interleaved edit
    await expect(image).not.toHaveAttribute('transform', t1, { timeout: 5_000 })
    await page.unroute('**/api/tools/*/auto-rotate')

    // both operations must be separate history entries, in order
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(image).toHaveAttribute('transform', t1, { timeout: 5_000 })
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
    await expect(image).toHaveAttribute('transform', t0, { timeout: 5_000 })
  })

  test('navigate home', async () => {
    await page.locator('nav[aria-label="Breadcrumb"] a', { hasText: 'Tools' }).click()

    await page.waitForURL('/', { timeout: 10_000 })
    await expect(page.getByText('hacksaw').first()).toBeVisible()
  })

  let binId: string

  test('create bin from tool', async () => {
    // find the first tool card's package icon (create bin button)
    const toolCards = page.locator('[class*="cursor-pointer"]').filter({ hasText: 'hacksaw' })
    const packageBtn = toolCards.first().locator('button').filter({ has: page.locator('svg.lucide-package') })
    await packageBtn.click()

    // name modal
    const modal = page.locator('.fixed.inset-0')
    await expect(modal).toBeVisible({ timeout: 5_000 })
    const nameInput = modal.locator('input[type="text"]')
    await nameInput.fill('Test bin')
    await modal.getByRole('button', { name: 'Create' }).click()

    await page.waitForURL(/\/bins\//, { timeout: 15_000 })
    binId = page.url().split('/bins/')[1]
    expect(binId).toBeTruthy()
  })

  test('verify tool in bin', async () => {
    const svgPath = page.locator('svg path[d]')
    await expect(svgPath.first()).toBeVisible({ timeout: 10_000 })
  })

  test('select tool in bin editor', async () => {
    const binEditor = page.locator('[data-testid="bin-canvas"]')
    const toolPath = binEditor.locator('path[fill-rule="evenodd"]').first()
    await expect(toolPath).toBeVisible({ timeout: 5_000 })

    // evenodd fill means click coordinates can fall through holes to the
    // background. dispatch a mousedown directly on the DOM element so React
    // receives it regardless of hit-test geometry.
    await toolPath.evaluate(el => {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    })

    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible({ timeout: 5_000 })
  })

  test('add text label', async () => {
    // deselect first
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // click Text tool button in the toolbar
    const textBtn = page.locator('button').filter({ has: page.locator('svg.lucide-type') })
    await textBtn.click()

    // click in the bin editor SVG background to place a label
    const binSvg = page.locator('[data-testid="bin-canvas"]')
    const box = await binSvg.boundingBox()
    expect(box).toBeTruthy()
    await page.mouse.click(box!.x + box!.width / 3, box!.y + box!.height / 3)

    // text input appears inside a foreignObject in the SVG
    const labelInput = page.locator('foreignObject input[type="text"]')
    await expect(labelInput).toBeVisible({ timeout: 5_000 })
    await labelInput.fill('E2E label')
    await page.keyboard.press('Enter')

    // wait for the <text> element to appear
    await expect(page.locator('svg text').filter({ hasText: 'E2E label' })).toBeVisible({ timeout: 5_000 })
  })

  test('wait for STL generation', async () => {
    // wait for export button to appear (STL generation finishes)
    const exportBtn = page.getByRole('button', { name: /^Export/ })
    await expect(exportBtn).toBeVisible({ timeout: 90_000 })
    await expect(exportBtn).toBeEnabled()
  })

  test('check 3D preview', async () => {
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible({ timeout: 10_000 })
  })

  test('download STL', async () => {
    // verify the generated STL file is downloadable
    const response = await page.request.get(`http://localhost:8000/api/files/bins/${binId}/bin.stl`)
    expect(response.ok()).toBeTruthy()
  })
})
