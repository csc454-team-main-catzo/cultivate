import type { IncomingMessage, ServerResponse } from 'node:http'
import { connectDB } from '../src/db.js'
import app from '../src/app.js'

// Disable Vercel's built-in body parser so Hono can read the raw stream.
// Without this, multipart/form-data (image uploads) arrives already consumed
// and c.req.formData() gets an empty body.
export const config = {
  api: { bodyParser: false },
}

let dbReady = false

async function ensureDB() {
  if (!dbReady) {
    await connectDB()
    dbReady = true
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ensureDB()

  // Buffer the full request body so we can hand it to the Fetch API.
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const body = Buffer.concat(chunks)

  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https'
  const host = req.headers.host ?? 'localhost'
  // On Vercel, rewrites pass the destination path in req.url, not the original.
  // We forward the original path via ?__path=/$1 in vercel.json.
  const reqUrl = req.url ?? '/'
  const parsed = new URL(reqUrl, `http://${host}`)
  const path = parsed.searchParams.get('__path') ?? parsed.pathname
  parsed.searchParams.delete('__path')
  const query = parsed.searchParams.toString()
  const url = `${proto}://${host}${path}${query ? `?${query}` : ''}`

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }

  const fetchRequest = new Request(url, {
    method: req.method ?? 'GET',
    headers,
    body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : body,
  })

  const response = await app.fetch(fetchRequest)

  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  const responseBody = Buffer.from(await response.arrayBuffer())
  res.end(responseBody)
}
