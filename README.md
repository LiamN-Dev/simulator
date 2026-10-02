# ClassDeck

Class resource hub. Node + Express, Neon Postgres, deployed on Render from GitHub.

## 1. Neon database
1. Create a project at https://neon.tech.
2. Click **Connect**, copy the connection string (it ends in `?sslmode=require`).

## 2. Run locally (optional)
```
cp .env.example .env     # paste your Neon string, set ADMIN_PIN and JWT_SECRET
npm install
npm run migrate          # creates tables + seeds 4 subjects
npm start                # http://localhost:3000
```

## 3. Push to GitHub
```
git init
git add .
git commit -m "ClassDeck"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/classdeck.git
git push -u origin main
```

## 4. Deploy on Render
1. Render dashboard > **New > Blueprint** > pick your GitHub repo (it reads `render.yaml`).
2. When prompted, set `DATABASE_URL` (Neon string) and `ADMIN_PIN`. `JWT_SECRET` is generated for you.
3. Deploy. Every `git push` to `main` redeploys automatically, and the build step runs the migration.

Edit subjects (names/colors) in `db/schema.sql` or directly in the Neon SQL editor.
