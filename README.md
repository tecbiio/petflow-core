# Petflow Core (API)

API NestJS + Prisma/SQLite avec séparation des bases (master vs données métiers) et bootstrap multi-tenant.

## Architecture rapide
- `MASTER_DATABASE_URL` : base master (Tenant, User, SecureConfig) générant le client `@prisma/master-client`.
- `DATABASE_URL` : base applicative pour un tenant (produits, familles/sous-familles, conditionnements, mouvements, inventaires, réglages).
- Script `npm run tenants:bootstrap` : applique les schémas, upsert le tenant + l’admin dans la master et crée l’emplacement par défaut dans la base applicative.

## Prérequis
- Node 20+, npm, SQLite (fichiers `.db`).
- Variables essentielles (exemple) :
  ```
  MASTER_DATABASE_URL=file:/abs/path/petflow-core/prisma/master.db
  DATABASE_URL=file:/abs/path/petflow-core/prisma/dev.db
  PDF_SERVICE_URL=http://localhost:8000/parse
  AUTH_TOKEN_SECRET=change-me
  FRONTEND_ORIGIN=http://localhost:5173
  ```
- Dépendances : `npm install`

## Démarrage
- Dev : `npm run start:dev`
- Prod local : `npm run build && MASTER_DATABASE_URL=... DATABASE_URL=... npm run start:prod`
- Lint/tests : `npm run lint`, `npm run test`, `npm run test:e2e`

## Prisma & bases
- Générer les clients :
  ```
  npx prisma generate                               # client app (schema.prisma)
  npx prisma generate --schema=prisma/master.prisma # client master
  ```
- Schéma master (pas de migrations versionnées) :
  ```
  MASTER_DATABASE_URL=file:/abs/path/petflow-core/prisma/master.db \
  npx prisma db push --schema=prisma/master.prisma
  ```
- Migrations app/tenant :
  ```
  DATABASE_URL=file:/abs/path/petflow-core/prisma/dev.db \
  npx prisma migrate deploy --schema=prisma/schema.prisma
  # ou db push pour un test rapide : npx prisma db push --schema=prisma/schema.prisma
  ```
- Seed app : `DATABASE_URL=... npx ts-node prisma/seed.ts`

## Bootstrap d’un tenant + admin
```
DATABASE_URL=file:/abs/path/petflow-core/prisma/dev.db \
MASTER_DATABASE_URL=file:/abs/path/petflow-core/prisma/master.db \
npm run tenants:bootstrap -- \
  --code=dev --name="DEV" \
  --dbUrl=file:/abs/path/petflow-core/prisma/dev.db \
  --email=admin@dev.com --password=Mot2Passe! \
  --locationCode=MAIN --locationName="Entrepôt principal"
```
Effets : schéma master appliqué, migrations app sur `dbUrl`, tenant + admin créés/mis à jour dans la master, emplacement par défaut upsert dans la base applicative.

## Services externes
- Parser PDF (`pdf2json`) consommé via `PDF_SERVICE_URL` (défaut `http://localhost:8000/parse`).
- Le front (`petflow-app`) pointe par défaut sur `http://localhost:3000`.

## Axonaut
Une clé API Axonaut est stockée côté core via `SecureConfig` (env. `AUTH_TOKEN_SECRET` / `SECRET_KEY_32B` requis).

Endpoints principaux :
- `POST /axonaut/config` : enregistre la clé (`userApiKey`).
- `POST /axonaut/import-products` : importe/maj le catalogue produits Axonaut vers Petflow.
- `POST /axonaut/sync-stock` : synchronise le stock Axonaut depuis le stock calculé Petflow (ids produits).
- `POST /axonaut/invoices/sync` : synchronise (incrémentalement) les factures Axonaut et les stocke en “à importer”.
- `GET /axonaut/invoices/pending` : liste des factures synchronisées non importées (utilisé par le front).
- `POST /axonaut/invoices/mark-imported` : retire des factures de la liste “à importer” après import.
- `GET /axonaut/invoices` : liste brute des factures Axonaut (debug).
- `GET /axonaut/invoices/:invoiceId/lines` : lignes de facture Axonaut (références + quantités).
