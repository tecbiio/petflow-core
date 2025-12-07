# Opérations (bases, migrations, comptes)

## Variables et chemins (SQLite)
- `MASTER_DATABASE_URL` : base master (Tenant, User, SecureConfig) – ex. `file:/abs/path/petflow-core/prisma/master.db`
- `DATABASE_URL` : base applicative d’un tenant – ex. `file:/abs/path/petflow-core/prisma/acme.db`
- Utilise des chemins absolus (`file:/abs/path/...`) pour éviter les surprises selon le répertoire courant.

## Générer les clients Prisma
```bash
cd petflow-core
npx prisma generate                               # client app
npx prisma generate --schema=prisma/master.prisma # client master
```

## Appliquer les schémas
- Master (pas de migrations versionnées) :
  ```bash
  MASTER_DATABASE_URL=... npx prisma db push --schema=prisma/master.prisma
  ```
- Base applicative (migrations versionnées) :
  ```bash
  DATABASE_URL=... npx prisma migrate deploy --schema=prisma/schema.prisma
  # ou pour init rapide : npx prisma db push --schema=prisma/schema.prisma
  ```

## Bootstrap d’un tenant / admin
Crée ou met à jour le tenant dans la master, applique les migrations sur la base applicative et upsert un admin + un emplacement par défaut.
```bash
cd petflow-core
MASTER_DATABASE_URL=file:/abs/path/petflow-core/prisma/master.db \
DATABASE_URL=file:/abs/path/petflow-core/prisma/acme.db \
npm run tenants:bootstrap -- \
  --code=acme --name="ACME" \
  --dbUrl=file:/abs/path/petflow-core/prisma/acme.db \
  --email=admin@acme.com --password=Mot2Passe! \
  --locationCode=MAIN --locationName="Entrepôt principal"
```
- Relancer la même commande mettra simplement à jour le tenant et l’utilisateur (upsert).
- Utilise `--dbUrl` pour cibler une autre base si plusieurs tenants coexistent.

## Seed ou données de test
```bash
cd petflow-core
DATABASE_URL=... npx ts-node prisma/seed.ts
```

## Vérifications rapides SQLite
```bash
sqlite3 prisma/master.db "select id, code, databaseUrl from Tenant;"
sqlite3 prisma/master.db "select id, email, role, tenantId from User;"
sqlite3 prisma/acme.db "select id, name, sku from Product limit 5;"
```

## Réinitialiser les données locales
- Arrêter les services, supprimer les fichiers `.db` concernés dans `petflow-core/prisma`, puis ré-exécuter les étapes “Appliquer les schémas” et “Bootstrap”.
- Si le client Prisma master est corrompu, supprime `petflow-core/node_modules/@prisma/master-client` puis régénère (`npx prisma generate --schema=prisma/master.prisma`).
