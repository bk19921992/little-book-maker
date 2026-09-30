// Saved-books access rules (RLS + Storage policies), as real signed-in users.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { admin, newUser } from './env.ts'

const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
const pdf = new Blob([new TextEncoder().encode('%PDF-1.4\n%%EOF')], { type: 'application/pdf' })

Deno.test('a customer can save, read and update their own book', async () => {
  const a = await newUser('owner')
  const { error } = await a.client.from('books').upsert({ user_id: a.id, story_id: 'b1', title: 'Mia', config: { pages: [] } })
  assertEquals(error, null)
  const { data } = await a.client.from('books').select('story_id, title').eq('story_id', 'b1')
  assertEquals(data, [{ story_id: 'b1', title: 'Mia' }])
  const upd = await a.client.from('books').update({ title: 'Mia 2', config: { pages: [1] } }).eq('story_id', 'b1').select('title')
  assertEquals(upd.data, [{ title: 'Mia 2' }])
})

Deno.test('another customer cannot see or write someone else\'s book', async () => {
  const a = await newUser('owner2'); const b = await newUser('other')
  await a.client.from('books').insert({ user_id: a.id, story_id: 'private', title: 'A', config: {} })
  assertEquals((await b.client.from('books').select('story_id').eq('user_id', a.id)).data, [])
  const forged = await b.client.from('books').insert({ user_id: a.id, story_id: 'planted', config: {} })
  assert(forged.error, 'insert as another user must fail')
  const hijack = await b.client.from('books').update({ title: 'hacked' }).eq('user_id', a.id).select()
  assertEquals(hijack.data, [])
})

Deno.test('customers cannot set the server-owned PDF paths', async () => {
  const a = await newUser('pdfpath')
  await a.client.from('books').insert({ user_id: a.id, story_id: 'b1', config: {} })
  const res = await a.client.from('books').update({ print_pdf_path: 'someone-else/b/pdf/print.pdf' }).eq('story_id', 'b1').select()
  assert(res.error, 'updating print_pdf_path must be refused')
  const ins = await a.client.from('books').insert({ user_id: a.id, story_id: 'b2', config: {}, print_pdf_path: 'x' })
  assert(ins.error, 'inserting print_pdf_path must be refused')
})

Deno.test('storage: own illustrations only; PDFs are server-written; folders are private', async () => {
  const a = await newUser('files'); const b = await newUser('snoop')
  const own = await a.client.storage.from('books').upload(`${a.id}/b1/images/page-1.jpg`, jpeg, { upsert: true })
  assertEquals(own.error, null)
  const replace = await a.client.storage.from('books').upload(`${a.id}/b1/images/page-1.jpg`, jpeg, { upsert: true })
  assertEquals(replace.error, null)
  const fakePdf = await a.client.storage.from('books').upload(`${a.id}/b1/pdf/print.pdf`, pdf)
  assert(fakePdf.error, 'customers must not write PDFs')
  const intoOther = await b.client.storage.from('books').upload(`${a.id}/b1/images/page-2.jpg`, jpeg)
  assert(intoOther.error, 'writing into another user\'s folder must fail')
  const read = await b.client.storage.from('books').download(`${a.id}/b1/images/page-1.jpg`)
  assert(read.error, 'reading another user\'s file must fail')
  const server = await admin.storage.from('books').upload(`${a.id}/b1/pdf/print.pdf`, pdf, { upsert: true })
  assertEquals(server.error, null)
  const mine = await a.client.storage.from('books').download(`${a.id}/b1/pdf/print.pdf`)
  assertEquals(mine.error, null)
  const signed = await a.client.storage.from('books').createSignedUrl(`${a.id}/b1/pdf/print.pdf`, 60)
  assertEquals((await fetch(signed.data!.signedUrl)).status, 200)
})

// ---- The app's saved-books library and export-pdf, end to end ----
import { deleteBook, listBooks, openBook, pdfDownloadLink, saveBook } from '../../../src/lib/savedBooks.ts'
import { loadHandler } from './env.ts'

// A real (tiny) JPEG, as the image job returns them.
const JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
const pic = `data:image/jpeg;base64,${JPEG_B64}`
const book = (storyId: string) => ({
  storyId, children: ['Mia'], storyType: 'Bedtime', setting: 'woods', characters: ['Owl'], palette: [], personal: {},
  readingLevel: 'Early 4–5', lengthPages: 6, narrationStyle: 'Simple prose', contentSafety: true, imageStyle: 'Watercolour',
  formatMode: 'manual', pageSize: 'A5 portrait', pageLayout: 'split', outline: { pages: [] },
  pages: [{ page: 1, text: 'Mia met an owl.', imageUrl: pic, imageReview: 'passed' }, { page: 2, text: 'They flew home.', imageUrl: pic }],
  coverImageUrl: pic,
}) as never

Deno.test('save -> list -> reopen round-trips a book, pictures included; delete removes it all', async () => {
  const a = await newUser('roundtrip')
  await saveBook(a.client, a.id, book('rt-1'))
  const list = await listBooks(a.client)
  assertEquals(list.map((b) => [b.storyId, b.title, b.pageCount, b.pageSize]), [['rt-1', "Mia's Story", 2, 'A5 portrait']])
  const reopened = await openBook(a.client, 'rt-1')
  // An edited title is what My books lists, and it survives reopening.
  await saveBook(a.client, a.id, { ...(book('rt-1') as object), title: 'Mia and the Moon Owl' } as never)
  assertEquals((await listBooks(a.client))[0].title, 'Mia and the Moon Owl')
  assertEquals((await openBook(a.client, 'rt-1')).title, 'Mia and the Moon Owl')
  assertEquals(reopened.pages!.map((p) => [p.text, p.imageUrl === pic, p.imageReview]), [['Mia met an owl.', true, 'passed'], ['They flew home.', true, undefined]])
  assertEquals(reopened.coverImageUrl, pic)
  const row = (await admin.from('books').select('config').eq('story_id', 'rt-1').single()).data!
  assert(!JSON.stringify(row.config).includes('base64'), 'no inline pictures in the row')
  await deleteBook(a.client, a.id, 'rt-1')
  assertEquals(await listBooks(a.client), [])
  assertEquals((await admin.storage.from('books').list(`${a.id}/rt-1/images`)).data, [])
})

Deno.test('export-pdf stores both PDFs on the account and returns working download links', async () => {
  const a = await newUser('export')
  await saveBook(a.client, a.id, book('ex-1'))
  await admin.from('entitlements').insert({ user_id: a.id, story_id: 'ex-1', item: 'export', payment_intent_id: `free-${a.id}` })
  const exportPdf = await loadHandler('export-pdf')
  const cfg = book('ex-1') as { pages: unknown[]; coverImageUrl: string }
  const res = await exportPdf(new Request('http://fn', { method: 'POST', headers: { Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ config: cfg, pages: cfg.pages, storyId: 'ex-1', includeBleed: true, coverImage: cfg.coverImageUrl }) }))
  const body = await res.json()
  assertEquals([res.status, body.success, body.saved], [200, true, true])
  assert(body.printPdfUrl.startsWith('http'), 'signed link, not an inline PDF')
  const pdf = await fetch(body.printPdfUrl)
  assertEquals(pdf.status, 200)
  assertEquals(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5)), '%PDF-')
  const [summary] = await listBooks(a.client)
  assertEquals([summary.webPdfPath, summary.printPdfPath], [`${a.id}/ex-1/pdf/web.pdf`, `${a.id}/ex-1/pdf/print.pdf`])
  assert(summary.exportedAt)
  const link = await pdfDownloadLink(a.client, summary.webPdfPath!, 'Mia.pdf')
  const dl = await fetch(link)
  assertEquals(dl.status, 200)
  assertMatch(dl.headers.get('content-disposition') || '', /attachment.*Mia\.pdf/)
  await dl.body?.cancel()
})
