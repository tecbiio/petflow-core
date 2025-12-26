# Operations (bases, migrations, comptes)

## Variables et chemins (SQLite)
- `MASTER_DATABASE_URL` : base master (Tenant, User, SecureConfig) - ex. `file:/abs/path/petflow-core/prisma/master.db`
- `DATABASE_URL` : base applicative d un tenant - ex. `file:/abs/path/petflow-core/prisma/dev.db`
- Utilise des chemins absolus (`file:/abs/path/...`) pour eviter les surprises selon le repertoire courant.

## Generer les clients Prisma
```bash
cd petflow-core
npx prisma generate                               # client app
npx prisma generate --schema=prisma/master.prisma # client master
```

## Appliquer les schemas
- Master (pas de migrations versionnees) :
  ```bash
  MASTER_DATABASE_URL=... npx prisma db push --schema=prisma/master.prisma
  ```
- Base applicative (migrations versionnees) :
  ```bash
  DATABASE_URL=... npx prisma migrate deploy --schema=prisma/schema.prisma
  # ou pour init rapide : npx prisma db push --schema=prisma/schema.prisma
  ```

## Bootstrap d un tenant / admin
Cree ou met a jour le tenant dans la master, applique les migrations sur la base applicative et upsert un admin + un emplacement par defaut.
Astuce (mot de passe safe vs `!`):
```bash
ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '\n')
# Variante si openssl absent:
# ADMIN_PASSWORD=$(python3 - <<'PY'
# import secrets
# print(secrets.token_urlsafe(24))
# PY
# )
```
```bash
cd petflow-core
MASTER_DATABASE_URL=file:/abs/path/petflow-core/prisma/master.db \
DATABASE_URL=file:/abs/path/petflow-core/prisma/dev.db \
npm run tenants:bootstrap -- \
  --code=dev --name="DEV" \
  --dbUrl=file:/abs/path/petflow-core/prisma/dev.db \
  --email=admin@dev.com --password="$ADMIN_PASSWORD" \
  --locationCode=MAIN --locationName="Entrepot principal"
```
- Reexecuter la meme commande mettra simplement a jour le tenant et l utilisateur (upsert).
- Utilise `--dbUrl` pour cibler une autre base si plusieurs tenants coexistent.
- `AUTH_BOOTSTRAP_*` ne cree pas les tables de la base tenant : lancer `tenants:bootstrap` pour appliquer les migrations.

## Creer ou mettre a jour un compte (tenant existant)
```bash
cd petflow-core
MASTER_DATABASE_URL=file:/abs/path/petflow-core/prisma/master.db \
npm run users:upsert -- --tenant=dev --email=team@dev.com --password="$ADMIN_PASSWORD" --role=ADMIN
```

## Seed ou donnees de test
```bash
cd petflow-core
DATABASE_URL=... npx ts-node prisma/seed.ts
```

## Verifications rapides SQLite
```bash
sqlite3 prisma/master.db "select id, code, databaseUrl from Tenant;"
sqlite3 prisma/master.db "select id, email, role, tenantId from User;"
sqlite3 prisma/dev.db "select id, name, sku from Product limit 5;"
```

## Logs (Docker)
```bash
docker compose logs -f petflow-core
docker compose logs -f petflow-app
docker compose logs -f pdf2json
```
Option: `LOG_REQUESTS=true` dans `petflow-core/.env` pour journaliser chaque requete HTTP.

## Reinitialiser les donnees locales
- Arreter les services, supprimer les fichiers `.db` concernes, puis reexecuter les etapes "Appliquer les schemas" et "Bootstrap".
- En Docker (repo root) :
  ```bash
  docker compose down
  rm -f data/*.db
  docker compose up -d --build
  ```
- Si le client Prisma master est corrompu, supprimer `petflow-core/node_modules/@prisma/master-client` puis regenerer (`npx prisma generate --schema=prisma/master.prisma`).
