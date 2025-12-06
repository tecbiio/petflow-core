## Commandes d’administration (multi-base)

> Hypothèses : `DATABASE_URL` pointe vers la base master (fichier `prisma/master.db` en absolu), et le dossier `prisma/` est présent. Tous les chemins de DB sont en `file:/chemin/absolu/...` pour éviter les surprises de répertoires courants.

### 1) Créer/mettre à jour un utilisateur sur un tenant existant (base déjà créée)
```bash
cd petflow-core
DATABASE_URL="file:/Users/antonylorenzelli/Desktop/Programmation/petflow/petflow-core/prisma/master.db" \
npm run tenants:bootstrap -- \
  --code='husse' \
  --name='HUSSE' \
  --dbUrl='file:/Users/antonylorenzelli/Desktop/Programmation/petflow/petflow-core/prisma/husse.db' \
  --email='nouvel.utilisateur@husse.com' \
  --password='MotDePasseSolide!' \
  --locationCode='MAIN' \
  --locationName='Emplacement principal'
```
- Effets : si le tenant `husse` existe déjà dans la master, l’utilisateur est upsert (créé ou mis à jour) sur ce tenant dans la master. Aucune donnée métier n’est modifiée côté base tenant (migrations passent mais sont déjà appliquées). L’emplacement `MAIN` est upsert dans la base tenant.

### 2) Créer un utilisateur sur une base **nouvelle** (tenant + base non existants)
```bash
cd petflow-core
DATABASE_URL="file:/Users/antonylorenzelli/Desktop/Programmation/petflow/petflow-core/prisma/master.db" \
npm run tenants:bootstrap -- \
  --code='acme' \
  --name='ACME' \
  --dbUrl='file:/Users/antonylorenzelli/Desktop/Programmation/petflow/petflow-core/prisma/acme.db' \
  --email='admin@acme.com' \
  --password='MotDePasseSolide!' \
  --locationCode='MAIN' \
  --locationName='Entrepôt principal'
```
- Effets : crée le tenant dans la master, applique les migrations sur la nouvelle base `acme.db`, crée l’utilisateur admin dans la master et un emplacement `MAIN` dans la base tenant.

### Vérifications rapides
```bash
# Utilisateurs en base master
sqlite3 prisma/master.db "select id,email,role,tenantId from User;"

# Tenants en base master
sqlite3 prisma/master.db "select id,code,databaseUrl from Tenant;"
```
