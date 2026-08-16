# NimSum

A new hex puzzle every day, inside Nimiq Pay. Link hexes, sum to the target.

Nineteen hexes, each worth something. Link neighbours until they add up to the
day's target. Everyone in the world plays the same board. Fewer hexes scores
higher. Come back tomorrow for a harder one.

Built for the Nimiq Mini Apps Competition, Cycle II.

**Free to play. No stake, no entry fee, no transaction.** Your wallet signs a
short message so a streak can be proven yours. That signature costs nothing and
moves nothing.

## How the board works

The board is a pure function of the date. `generatePuzzle('2026-08-15')` returns
the same nineteen values and the same target on any machine, forever. Nothing is
stored, nothing is fetched, and anyone can regenerate any day's board from this
repo and check it matches what the server served.

Difficulty runs on a weekly curve, the way daily crosswords do:

| Day | Par | Feel |
| --- | --- | --- |
| Sun, Mon | 4 | Gentle |
| Tue, Wed | 5 | Steady |
| Thu, Fri | 6 | Tricky |
| Sat | 7 | Brutal |

Par is not a guess. At generation time the engine walks every possible chain on
the board and records, for every reachable sum, the shortest chain that reaches
it and how many such chains exist. A board is only published if its shortest
chain is exactly the length the day calls for **and** few enough shortest chains
exist that finding one is an achievement. Some days have exactly one.

## What stops cheating

The interesting engineering is here, and each claim below has a test.

**The server owns the board.** The client can send a chain of hex indices. It
cannot send a score, a solve time, or a rank. Every submission is regraded from
scratch: are those hexes really adjacent, was each used once, does the sum
really equal the target, how long is the chain against par. A request carrying
`score: 999999` gets the score its chain actually earns.

**The server owns the clock.** Solve time is measured from the moment the server
first handed you today's board, recorded server-side. A client cannot report a
fake fast solve.

**Identity is a signature, not a claim.** Sign-in issues a single-use, expiring
challenge. The wallet signs it. The server verifies the signature and then
derives the address *from the public key*, so the address is the key's word, not
the client's. Presenting someone else's public key with your own signature fails.
Replaying a used challenge fails.

**One solve per wallet per day**, enforced by primary key. Past boards are
readable but closed, so nobody can backfill a streak.

**Streaks are derived, not stored.** They are recomputed from solve dates on
every read, so they cannot drift out of sync with what actually happened.

## Verify it yourself

```sh
cd server && npm install && npm test
```

Twenty-eight tests, run against an embedded Postgres so they exercise the same
SQL the production database runs. The ones worth reading:

- 60 consecutive days of boards are generated and every one matches its
  day-of-week difficulty contract
- par is cross-checked against a **separately written** brute-force search, so
  two independent implementations have to agree
- a real Nimiq keypair signs a real challenge and the address derived from the
  signature matches the key
- Mallory signing with her own key while presenting Alice's public key is
  rejected
- a submission carrying an inflated score is graded on its chain, not its claim

To confirm a board independently, generate it from the date and compare to what
`/api/puzzle` served.

## Running it

```sh
cd server && npm install
cd ../client && npm install && npm run build
cd ../server && npm start          # serves API and client on :8787
```

With no `DATABASE_URL` set the server runs an in-process Postgres and says so
on startup. That is fine for a look around; solves vanish when the process
exits. For anything real, copy `.env.example` and point `DATABASE_URL` at a
Supabase project.

For development, run `npm run dev` in both; the client proxies `/api` to the
server.

Open a deployed build inside Nimiq Pay through the Mini Apps library in the app.

### Deploying

`render.yaml` describes a free-tier web service. State lives in Supabase rather
than on disk, because free web services have no persistent storage. Set
`DATABASE_URL` in the host dashboard, never in the repo.

The schema is created on boot, so there is no separate migration step.

## Stack

- **Engine and API**: TypeScript, Express, Postgres (Supabase), no ORM
- **Crypto**: `@nimiq/core` for ed25519 verification and address derivation
- **Wallet**: `@nimiq/mini-app-sdk`, `sign()` for identity
- **Client**: React, Vite, hand-written SVG board, no UI framework

## Honest limitations

- **Confirmed on a real device**: Nimiq Pay signs with a framed (prefixed)
  message, not raw bytes. The server accepted either framing and reported
  which one matched; a live sign-in on 2026-08-16 confirmed framed is the one
  real Nimiq Pay uses. The signature verification path is proven, not assumed.
- Sessions live in process memory. A server restart signs everyone out. Solves
  and streaks are in Postgres and survive.
- **A free web service sleeps after about fifteen minutes of inactivity** and
  takes roughly a minute to answer the first request after that. The first
  visitor of the day waits; everyone after them does not.
- Rate limiting is per process and in memory. Behind multiple instances it would
  need moving to shared storage.
- There are no NIM rewards in this version. The wallet is used for identity
  only. Adding payouts would mean a treasury wallet and real custody, which is a
  deliberate later decision rather than something bolted on.
- The board is radius 2, nineteen hexes. Larger boards make the exhaustive
  generation search substantially more expensive.

## License

[MIT](./LICENSE)
