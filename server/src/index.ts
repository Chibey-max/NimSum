// Entry point. Serves the API and, when built, the client alongside it.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './api'
import { connectFromEnv } from './db'
import { Store } from './store'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 8787)
const clientDir = join(here, '../../client/dist')

const { sql, kind } = await connectFromEnv()
const store = new Store(sql)
await store.migrate()

if (kind === 'memory') {
  console.warn(
    'DATABASE_URL is not set: running on an in-process database. ' +
      'Solves and streaks will be lost when this process exits.',
  )
}

const app = createApp(store, {
  clientDir: existsSync(clientDir) ? clientDir : undefined,
})

const server = app.listen(port, () => {
  console.log(`NimSum server listening on :${port} (${kind})`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close().finally(() => process.exit(0))
    })
  })
}
