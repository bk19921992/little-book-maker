// Printed-book orders on local Supabase: the real create-print-order handler,
// a print PDF stored by the real export-pdf, and a fake Peecho endpoint.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { admin, loadHandler, newUser } from './env.ts'
import { saveBook } from '../../../src/lib/savedBooks.ts'

const PEECHO = 'https://peecho.test/orders/'
Object.entries({ PRINT_ENABLED: 'true', PRINT_PRICE_PENCE: '1999', PEECHO_API_KEY: 'pk', PEECHO_API_URL: PEECHO,
  PEECHO_OFFERING_ID_A5: 'offer-a5' }).forEach(([k, v]) => Deno.env.set(k, v))

// Fake printer: records orders; can be told to fail.
const printerCalls: { body: Record<string, any> }[] = []
let printerFails = false
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === PEECHO) {
    printerCalls.push({ body: JSON.parse(String(init?.body)) })
    return printerFails ? new Response('upstream down', { status: 503 }) : Response.json({ id: `peecho-${printerCalls.length}` })
  }
  return realFetch(input, init)
}) as typeof fetch

const exportPdf = await loadHandler('export-pdf')
const printOrder = await loadHandler('create-print-order')
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
const address = { name: 'Sam Parent', email: 'sam@example.test', line1: '1 High Street', city: 'Leeds', postcode: 'LS1 1AA', country: 'GB' }

async function exportedBook(tag: string) {
  const u = await newUser(tag)
  const storyId = `print-${tag}`
  const cfg = { storyId, children: ['Mia'], storyType: 'Bedtime', pageSize: 'A5 portrait', pageLayout: 'split', personal: {},
    pages: Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: `Page ${i + 1}.`, imageUrl: JPEG })), coverImageUrl: JPEG }
  await saveBook(u.client, u.id, cfg as never)
  await admin.from('entitlements').insert({ user_id: u.id, story_id: storyId, item: 'export', payment_intent_id: `free-${u.id}` })
  const r = await exportPdf(new Request('http://fn', { method: 'POST', headers: { Authorization: `Bearer ${u.token}` },
    body: JSON.stringify({ config: cfg, pages: cfg.pages, storyId, includeBleed: true, coverImage: JPEG }) }))
  assertEquals((await r.json()).saved, true)
  return { ...u, storyId }
}
const order = async (token: string, body: Record<string, unknown>) => {
  const r = await printOrder(new Request('http://fn', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}
const payForPrint = (userId: string, storyId: string, pi: string) =>
  admin.from('entitlements').insert({ user_id: userId, story_id: storyId, item: 'print', payment_intent_id: pi })

Deno.test('no payment, no order; bad address and unexported book are refused', async () => {
  const u = await exportedBook('unpaid')
  assertEquals((await order(u.token, { storyId: u.storyId, address })).status, 402)
  const bad = await order(u.token, { storyId: u.storyId, address: { ...address, country: 'United Kingdom', postcode: '' } })
  assertEquals(bad.status, 400)
  assertMatch(bad.body.error, /postcode, country/)
  const stranger = await newUser('stranger')
  assertEquals((await order(stranger.token, { storyId: u.storyId, address })).status, 409) // not their book
  assertEquals(printerCalls.length, 0)
})

Deno.test('a paid order sends the stored PDF, padded to 24 pages, with the real address - once', async () => {
  const u = await exportedBook('paid')
  await payForPrint(u.id, u.storyId, `pi_print_${u.id.slice(0, 8)}`)
  const before = printerCalls.length
  const res = await order(u.token, { storyId: u.storyId, address })
  assertEquals([res.status, res.body.ok, res.body.pageCount], [200, true, 24])
  const sent = printerCalls.at(-1)!.body
  const file = sent.item_details[0].file_details
  assertEquals([sent.item_details[0].offering_id, file.number_of_pages, file.content_width, file.content_height], ['offer-a5', 24, 14.8, 21])
  assertEquals(sent.address_details.shipping_address.address_line_1, '1 High Street')
  const pdf = await PDFDocument.load(new Uint8Array(await (await realFetch(file.content_url)).arrayBuffer()))
  assertEquals(pdf.getPageCount(), 24) // cover + 10 pages + 13 blank
  const again = await order(u.token, { storyId: u.storyId, address })
  assertEquals([again.body.ok, again.body.alreadyPlaced], [true, true])
  assertEquals(printerCalls.length, before + 1, 'no second order for one payment')
  const row = (await admin.from('print_orders').select('status, provider_order_id, page_count').eq('user_id', u.id).single()).data
  assertEquals([row!.status, row!.page_count], ['submitted', 24])
})

Deno.test('a printer error keeps the payment for a retry', async () => {
  const u = await exportedBook('retry')
  await payForPrint(u.id, u.storyId, `pi_print_${u.id.slice(0, 8)}`)
  printerFails = true
  const failed = await order(u.token, { storyId: u.storyId, address })
  assertEquals(failed.status, 502)
  assertEquals((await admin.from('print_orders').select('status').eq('user_id', u.id).single()).data!.status, 'failed')
  printerFails = false
  const retried = await order(u.token, { storyId: u.storyId, address })
  assertEquals([retried.status, retried.body.ok], [200, true])
  assert(!retried.body.alreadyPlaced)
})
