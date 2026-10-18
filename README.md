# Game Tracker

Un tracker de jeux vidéo auto-hébergé : ta bibliothèque, la progression de tes **succès / trophées**, tes **notes**, et un lien direct vers le **guide des trophées sur [PSTHC](https://www.psthc.fr)**.

Il tourne dans un seul petit conteneur Docker (Node.js, **aucune dépendance à l'exécution**) et garde **toutes** les données sur le serveur, dans un dossier que tu montes depuis ton NAS. Même principe de déploiement que le Planner.

- Image : `ghcr.io/ferrandj/game-tracker` — une release GitHub et une image sont publiées automatiquement pour chaque changement de la branche par défaut qui passe tous les tests (voir [Releases & CI](#releases--ci)).
- Architectures : `linux/amd64` et `linux/arm64`.

## Ce que fait l'application

- **Recherche** d'un jeu dans plusieurs bases à la fois (Steam, IGDB, RAWG), résultats fusionnés : un même jeu trouvé dans deux bases n'apparaît qu'une fois.
- **Fiche jeu** : jaquette en **étui 3D**, titre, description, année, genres, studio, plateforme, statut (À faire / En cours / Terminé / Complété à 100 % / Abandonné), heures jouées.
- **Succès (Steam, PC) et trophées (PlayStation)** : la liste est récupérée selon la plateforme choisie ; tu coches ceux que tu as. Rareté, trophées cachés (description masquée jusqu'à ce que tu la révèles), recherche, filtres, tri par rareté, « tout cocher ». Pour les autres plateformes (Xbox, Switch…), tu **colles une liste** (un succès par ligne) ou tu les ajoutes à la main.
- **Guide PSTHC** : pour les jeux PlayStation, le lien direct vers la page du guide est cherché automatiquement ; tu peux le corriger à la main.
- **Notes** : une note de 0,5 à 5 étoiles (demi-étoiles, stockée sur 10) et un champ de notes libres, enregistrés automatiquement.
- Moderne : thème sombre / clair / automatique, utilisable au clavier, adapté au mobile, ajoutable à l'écran d'accueil (manifeste PWA).

> Le projet est pensé pour s'étendre à d'autres médias (films, séries, livres…). Chaque entrée porte un `kind` (`game` aujourd'hui) et l'API est organisée par entrée, pour ajouter un type sans toucher aux jeux.

## Démarrage rapide (NAS / n'importe quel hôte Docker)

1. Crée le dossier de données, par ex. `/volume1/docker/game-tracker/data`.
2. Utilise [`docker-compose.yml`](docker-compose.yml) de ce dépôt (aucun secret dedans) : sur un NAS Synology, *Container Manager → Projet → Créer* puis colle-le ; ou en SSH `docker compose up -d`. Adapte le port (`10458`) et le chemin des données si tu veux.
3. Ouvre `http://<adresse-du-nas>:10458`.

**Ça marche sans aucune clé** : la recherche Steam et les succès Steam n'en demandent pas. Les clés ci-dessous ajoutent des bases et les trophées PlayStation.

Mise à jour :

```sh
docker compose pull && docker compose up -d
```

> **Premier `pull` depuis GHCR :** les paquets publiés par Actions sont privés au début. Rends le paquet public une fois (GitHub → ton profil → *Packages* → `game-tracker` → *Package settings* → *Change visibility*) ou fais `docker login ghcr.io` sur le NAS avec un jeton ayant `read:packages`.

Les permissions n'ont rien à configurer : le conteneur tourne avec l'utilisateur propriétaire du dossier de données (et confie à un utilisateur non privilégié un dossier créé par Docker en root). Il abandonne root avant d'écouter sur le réseau.

## Sources de données

| Source | Sert à | Clé / réglage | Sans clé ? |
| --- | --- | --- | --- |
| **Steam** | recherche, description, jaquette portrait, **succès** | `STEAM_API_KEY` (facultatif) | ✅ oui |
| **IGDB** | recherche, **meilleures jaquettes**, descriptions | `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET` | non |
| **RAWG** | recherche, descriptions, images | `RAWG_KEY` | non |
| **PlayStation (PSN)** | **trophées** + ceux que tu as déjà obtenus | `PSN_NPSSO` | non |
| **PSTHC** | lien du guide de trophées | — | ✅ oui |

- **IGDB** (gratuit) : crée une application sur <https://dev.twitch.tv/console> (catégorie *Application Integration*), puis copie le *Client ID* et génère un *Client Secret*.
- **RAWG** (gratuit) : demande une clé sur <https://rawg.io/apidocs>.
- **Steam** : sans clé, les succès sont lus sur la page publique `steamcommunity.com/stats/<appid>/achievements`. Avec une clé (<https://steamcommunity.com/dev/apikey>), l'API officielle est utilisée (indicateur « caché », noms officiels).
- **PlayStation** : Sony ne publie pas d'API de trophées pour les jeux des autres. L'application lit **ta liste de trophées via ton compte PSN** : connecte-toi sur <https://my.playstation.com>, puis ouvre <https://ca.account.sony.com/api/v1/ssocookie> ; copie la valeur `npsso` (64 caractères) dans `PSN_NPSSO`. Elle expire au bout d'environ 2 mois (un message clair l'indique alors). Limite : seuls les jeux **déjà présents dans ta liste de trophées** (lancés au moins une fois sur la console) sont trouvés ; ce que tu as déjà débloqué est coché automatiquement. Pour un jeu pas encore lancé, colle la liste à la main.
- Ces clés sont des **variables d'environnement** (voir les lignes commentées de `docker-compose.yml`) ; elles ne sont jamais envoyées au navigateur.

### La jaquette « 3D »

Aucune de ces bases ne fournit de vraies jaquettes 3D. L'application **dessine l'étui en 3D (CSS) à partir de la jaquette 2D** : face avant, tranche colorée selon la plateforme avec le titre, tranche des pages. Si la jaquette n'existe pas, l'image du jeu est utilisée ; à défaut, une vignette colorée avec le titre.

Les images sont téléchargées **par le serveur** et gardées dans `data/covers` (le navigateur ne contacte jamais un site tiers ; la bibliothèque garde ses images même si un site change ses adresses).

### Le guide PSTHC

À l'ajout d'un jeu PlayStation (ou avec le bouton « Trouver le guide PSTHC » sur n'importe quel jeu), le serveur cherche le guide sur psthc.fr (recherche du site, puis page de résultats) et garde le lien le plus proche du titre. S'il n'y a pas de correspondance claire, le bouton ouvre la **recherche de PSTHC pour ce titre**. « Modifier le lien » permet de coller la bonne adresse ; un lien saisi à la main n'est jamais remplacé automatiquement.

## Tes données ne sont jamais réinitialisées ni effacées par accident

| Risque | Protection |
| --- | --- |
| Clic simultané depuis deux appareils | Les modifications sont **fines** (« cocher ce succès », « changer cette note »), jamais un envoi du document entier : deux appareils ne s'écrasent pas. |
| Plusieurs cases cochées très vite | Les changements d'un même jeu partent dans l'ordre ; l'écran affiche le résultat immédiatement et revient en arrière avec un message si le serveur refuse. |
| Coupure de courant pendant l'écriture | Écritures atomiques (fichier temporaire → `fsync` → renommage). |
| Fichier d'état corrompu | Il est mis de côté (jamais supprimé) et la dernière sauvegarde valide est chargée. Si rien n'est récupérable, le serveur **refuse de démarrer** plutôt que de créer une bibliothèque vide. |
| Suppression par erreur | Confirmation, puis sauvegarde automatique prise **avant** la suppression (`data/backups/…-delete.json`). |
| Sauvegardes | Instantané automatique (au plus toutes les 15 s pendant les modifications, toujours avant un gros rétrécissement, une suppression, un import ou une restauration). Rétention : tout pendant 2 jours, une par heure pendant 2 semaines, une par jour pendant 6 mois, une par mois ensuite. |
| Mise à jour du conteneur | L'image ne contient aucune donnée utilisateur, et ne modifie jamais celles du dossier monté (voir ci-dessous). |
| Requêtes venant d'un autre site | Les écritures exigent un en-tête personnalisé et une origine identique ; CSP stricte ; le proxy d'images n'accepte que HTTPS et une courte liste d'hébergeurs d'images. |

### Les mises à jour ne modifient jamais tes données

C'est la priorité n°1 du projet. **Mettre à jour (ou redémarrer, ou recréer) le conteneur ne change jamais `state.json`**, pas un octet. Concrètement :

- Au démarrage, l'application **lit** tes données ; elle ne les réécrit pas. Seule une action de ta part (cocher, noter, ajouter…) modifie le fichier, et seulement la partie concernée.
- Au **premier démarrage après une mise à jour**, une copie exacte de tes données est ajoutée dans `data/backups/` (`…-update.json`). Elle n'est jamais effacée automatiquement.
- Le **seul** cas où une mise à jour réécrit tes données est une **migration de schéma prévue et annoncée** dans la release. Dans ce cas : copie brute de l'ancien fichier (`…-pre-migration.json`) **avant** toute écriture, migration faite en mémoire sur une copie, résultat validé, puis une seule écriture atomique. Au moindre problème, le fichier reste exactement comme il était et le serveur refuse de démarrer avec un message clair.
- **Pas de retour en arrière silencieux** : si tes données ont été écrites par une version plus récente que l'image lancée, l'ancienne image **refuse de les ouvrir** sans rien lire, déplacer ni modifier.
- Un champ inconnu (écrit par une version plus récente) est conservé tel quel quand tu modifies un jeu.
- Ajouter une fonctionnalité ne migre rien : un champ absent est simplement lu avec sa valeur par défaut.
- Le seul changement que le démarrage peut faire sur le dossier est de **réparer le propriétaire des fichiers** (utile sur NAS) ; le contenu n'est pas touché.

Ce n'est pas qu'une promesse, c'est testé à chaque release (CI) : des fichiers de données **figés** de chaque version (`test/fixtures/data-v*/`, protégés par une somme de contrôle) doivent s'ouvrir avec le code actuel sans perdre une donnée ; le serveur en marche ne réécrit rien en lecture ; une migration en échec ne laisse aucune trace ; et le test du conteneur lance la **nouvelle image sur les données écrites par la release précédente** et vérifie que `state.json` est identique octet pour octet.

> **Pour les développeurs** : toute modification de ce qui est stocké suit la règle écrite en tête de [`server/migrations.js`](server/migrations.js) (incrémenter `CURRENT_SCHEMA`, écrire la migration, ajouter une fixture gelée). Les tests échouent tant que les trois ne sont pas faits.

**Restaurer une sauvegarde** : conteneur arrêté, copie le fichier voulu de `data/backups/` par-dessus `data/state.json`, puis redémarre.

**Exporter / importer** : *Réglages → Exporter (JSON)* télécharge toute la bibliothèque ; *Importer* fusionne un tel fichier **sans rien écraser ni supprimer**.

### Contenu de `/data`

```
data/
  state.json     la bibliothèque (jeux, succès cochés, notes…)
  backups/       instantanés  state-<date>-r<rev>[-update|-pre-migration|-delete|-import|-shrink|-restore].json
  .version       dernière version de l'application lancée (pour la copie « update »)
  covers/        jaquettes et images mises en cache
```

## Réglages avancés (variables d'environnement)

| Variable | Rôle |
| --- | --- |
| `AUTH_USER` / `AUTH_PASSWORD` | mot de passe (Basic) pour toute l'application (sinon, protège-la avec ton reverse proxy / VPN) |
| `PORT` (8080), `DATA_DIR` (/data) | port et dossier de données dans le conteneur |
| `SNAPSHOT_INTERVAL_SEC` | fréquence minimale des instantanés (défaut 15 s) |
| `IMAGE_ALLOW_PREFIXES` | préfixes d'URL d'images supplémentaires acceptés par le proxy (miroir auto-hébergé) |
| `STEAM_STORE_BASE`, `STEAM_API_BASE`, `STEAM_COMMUNITY_BASE`, `STEAM_CDN_BASE`, `RAWG_BASE`, `IGDB_BASE`, `PSTHC_BASE`… | adresses de base des services (miroir, tests) |

## Si quelque chose ne marche pas

- **La recherche ne renvoie rien / « Steam indisponible »** : le message d'erreur de la source s'affiche dans la fenêtre d'ajout et le détail est dans les logs du conteneur (`[search] steam failed: …`). Vérifie que le conteneur peut sortir sur Internet (DNS, pare-feu du NAS).
- **« Les trophées PlayStation se lisent depuis ton compte PSN »** : `PSN_NPSSO` n'est pas renseigné, ou a expiré (« npsso refused »). Récupère-le de nouveau (voir plus haut).
- **« n'est pas dans la liste de trophées de ton compte PSN »** : lance le jeu une fois sur la console, ou colle la liste.
- **Pas de guide PSTHC trouvé** : le bouton ouvre la recherche du site ; utilise « Modifier le lien » pour mettre l'adresse exacte.
- **Succès Steam vides** : certains jeux n'en ont pas, ou la page publique du jeu est restreinte ; ajoute `STEAM_API_KEY`.

## Développement

```sh
# serveur (Node 20+, aucune dépendance)
npm start                       # http://localhost:8080 (données dans ./data)
npm test                        # tests du serveur (node --test)

# application web
cd web
npm ci
npm run dev                     # Vite sur :5173, /api proxifié vers :8080
npm run typecheck && npm run test:coverage && npm run build
npm run e2e                     # navigateur réel + vrai serveur + faux Steam/PSTHC (voir e2e/fakeUpstream.mjs)
```

Les tests des sources de données (Steam, IGDB, RAWG, PSN, PSTHC) utilisent des réponses simulées aux formats documentés par chaque service ; les tests de bout en bout parlent à un faux Steam/PSTHC local, jamais à Internet.

## Releases & CI

Le workflow [`docker.yml`](.github/workflows/docker.yml) : tests du serveur → types, tests unitaires (seuil de couverture) et build du web → tests de bout en bout dans un vrai navigateur (dont accessibilité et mobile) → test de fumée du conteneur (les données survivent à un redémarrage et à une recréation, fichier corrompu récupéré, permissions NAS) → image multi-architecture.

Chaque push sur la branche par défaut qui passe tout devient une release `v1.0.0`, `v1.0.1`… avec les tags d'image `latest`, `1`, `1.0`, `1.0.0`. Patch par défaut ; mets `[minor]` ou `[major]` dans la première ligne du message de commit (ou lance le workflow à la main) pour monter la version.
