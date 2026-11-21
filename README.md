This repository use **GitHub Action** as "cron job" to fetch data from remote **PostgreSQL database**, and export static files publicly. Used by associated project **[StellaS CountLogger](https://github.com/bright9th/stellas-countlogger.git)**

### Setup & Run

- Install dependencies: `pnpm install` | `npm install`
- Configure `.env`
  - `DATABASE_URL` – Your PostgreSQL database connection string
- Execute export pipeline: `pnpm export` | `npm run export`
- Exported files will appear in `export/`

For IPv6 connectivity, database connection string default method `Direct connection` should work normally. In the case of GitHub Action, which has IPv4 connectivity, use connection string method `Session pooler`.
