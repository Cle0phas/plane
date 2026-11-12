# Rapport de test de sécurité

| Champ     | Valeur                                                       |
| --------- | ------------------------------------------------------------ |
| Projet    | Fork de Plane (Cle0phas/plane), types de ticket, livraison 1 |
| Version   | 0.1                                                          |
| Date      | 2026-11-12                                                   |
| Auteur    | Équipe sécurité (asin-harness /security)                     |
| Phase ADM | Mise en œuvre et opérationnalisation                         |

## 1. Périmètre

- Branche testée : `feat/work-item-types`, commit `1122679eb9`, comparée à sa base `cd44cc1320` sur `upstream/preview` (diff de la branche uniquement, 143 fichiers).
- Composants couverts : les 9 routes des types (workspace et projet), le contrôle du type sur chaque chemin d'écriture des tickets (application, API publique v1, brouillons et leur conversion, intake, app publique `space`), la validation des champs stockés (`StrictUUIDField`, `clean_logo_props`, nom et description), les filtres et le regroupement par type, l'historique des changements de type, le journal d'audit en ajout seul, les migrations 0126 à 0128, et le store frontend des types.
- Composants exclus : l'authentification existante de Plane (session, clés API, CSRF, cookies), non modifiée par la branche ; le reste du dépôt hors diff.
- Entrées de référence : le fork n'a pas de `docs/architecture/dat.md` (pas de matrice d'autorisation section 5 ni de dépendances externes déclarées), pas de `docs/architecture/api.md` ni de `docs/specs/sfd.md`. La spécification utilisée à la place est `docs/superpowers/specs/2026-11-12-work-item-types-design.md` (règles R1 à R14, section 7 STRIDE, section 10 limites connues).
- Exceptions acceptées (spec section 10, non comptées comme constats) : la concurrence entre la suppression d'un type et son affectation ; les compteurs par type des projets privés visibles de tout membre du workspace (R2) ; le caractère « ajout seul » du journal d'audit garanti par l'application mais pas par la base.

## 2. Méthode

- Méthode security-audit de Cloudflare (vendorisée dans le harnais ASIN), profil `quick` limité au diff : une vague de recherche (5 agents), un passage du critique de couverture, un vérificateur indépendant par candidat.
- Classes retenues : `ATTACK-CLASSES.md` (Access control, Business logic, Injection, Feature abuse and data leakage), `DATA-ISOLATION-AND-LIFECYCLE.md`, et les compagnons ASIN `ASIN-IAM-XROAD.md#Missing or inconsistent authorisation` et `ASIN-SOVEREIGNTY.md#Personal data in logs or telemetry`. Non retenus : `WEB-PROTOCOL-AND-AUTH.md` (aucune modification de session, cookie ou en-tête) et `CLIENT-SIDE.md` (aucun nouveau rendu HTML brut).
- Conteneur : `sandbox-run.sh` (réseau coupé, environnement vide, cible en lecture seule, écriture limitée au dossier scratch, limites CPU, mémoire, processus, taille et durée), image locale `feat-work-item-types-api-tests:latest`, empreinte `sha256:ef16751689b897bc889d45f9da54c7b375eb312117e3cc400b9dfb8b293ea929`. Registre Harbor non configuré pour ce fork : image construite localement depuis `apps/api/Dockerfile.dev`, jamais tirée d'un registre public. La preuve locale a été promue par `promote.py`.
- Limite d'exécution : le bac à sable ne fournit pas PostgreSQL, Redis ni RabbitMQ. Les contrôles dépendant de la base sont donc fondés sur la lecture du code ; seul le contrôle du candidat, qui n'en avait pas besoin, a été exécuté.
- Écart à la méthode : les blocs de classes d'attaque et de règles ont été désignés aux agents par fichier et par nom, avec obligation de les lire tels quels, au lieu d'être recopiés dans chaque consigne.
- Dossier d'exécution (non versionné) : `docs/security/runs/2026-11-12-diff-1/`.
- Validateurs : `validate-findings.cjs` : `PASS: 1 findings valid` ; `validate-coverage-ledger.cjs` : `PASS: 12 coverage units valid`.

## 3. Verdict

- Verdict global : **conforme**. Aucun constat confirmé, de quelque sévérité que ce soit.
- Verdict souveraineté : **conforme**. Le journal d'audit et l'historique ne contiennent que des identifiants et des données saisies par les admins (nom, description, icône d'un type) ; aucune donnée personnelle au-delà de l'identifiant de l'auteur, aucun secret, aucun appel sortant.
- Verdict IAM : **conforme**. Chaque route vérifie le rôle côté serveur ; les écritures au niveau du projet passent par le contrôle explicite admin du workspace ou admin du projet ; toutes les requêtes sont limitées au workspace de l'URL ; un objet d'un autre workspace reçoit la même réponse qu'un objet inexistant.
- Constats par sévérité : critical 0, high 0, medium 0, low 0, informational 0. Un candidat rejeté.
- Couverture : **partielle**. Audit `quick` limité au diff : 7 unités couvertes, 1 unité avec candidat (rejeté), 1 unité hors périmètre, et 3 unités proposées par le critique de couverture **reportées** faute de seconde vague dans ce profil :
  1. la persistance des filtres des vues sauvegardées et des vues d'analyse ;
  2. les autres consommateurs du filtre par type (modules, cycles, archives, intake, workspace, brouillons, analyses, vues publiques `space`) ;
  3. les écritures de tickets qui contournent `Issue.save()` (créations en masse, mises à jour par requête, imports, copies).
     Aucun audit précédent n'existait pour ce dépôt.

## 4. Constats

Aucun constat confirmé.

## 5. À valider

- Aucun constat `needs_validation`.
- Candidats rejetés : 1. La cause est réelle et reproduite localement, mais l'échec reste limité à la requête de celui qui l'envoie, sans autre principal ni ressource partagée touchés : ce n'est pas une faille de sécurité. Il s'agit d'un **défaut fonctionnel** de la livraison : enregistrer une vue sauvegardée, ou une vue d'analyse, filtrée par type échoue (erreur 500), parce que le filtre par type stocke des identifiants dans un format que le champ JSON ne sait pas enregistrer. Il est à corriger avant la fusion (voir section 7, hors constats de sécurité).

## 6. Points vérifiés sans anomalie

- Autorisation des 5 routes des types du workspace : lecture pour tout membre actif, écriture pour les admins seulement, décorateur sur chaque méthode.
- Autorisation des 4 routes des types d'un projet : `_require_project_manager` en première instruction de chaque écriture, même réponse 403 que l'objet existe ou non.
- Isolation par workspace : toutes les requêtes filtrées par le workspace de l'URL, réponse 404 identique pour un objet absent ou étranger.
- Affectation massive : seuls nom, description, icône et statut actif sont modifiables ; le type par défaut n'est posé que côté serveur, après contrôle d'identité strict.
- Type d'un ticket sur tous les chemins d'écriture (application, API v1, brouillons et conversion, intake, `space`) : contrôle unique, même workspace, activé dans le projet, actif, non supprimé ; champ du modèle en lecture seule ; ancienne faille d'injection inter-workspace de l'API v1 fermée.
- Valeurs stockées et rendu : liste blanche stricte des icônes, rendu React en texte, aucun chargement de ressource tierce.
- Filtres et regroupement : identifiants invalides rejetés ou ignorés sans erreur 500 en lecture, valeurs de regroupement limitées au workspace, pas d'oracle d'existence.
- Concurrence : verrous pris dans un ordre fixe, contraintes uniques partielles en base comme garde-fou.
- Cycle de vie et audit : écriture de l'audit avant la suppression, dans la même transaction ; migration 0127 ne touchant ni types supprimés ni autres workspaces, idempotente ; migration 0128 qui échoue proprement en cas de doublon.
- Store frontend : données rangées par workspace, réponses tardives isolées, état réinitialisé à la déconnexion.

## 7. Plan de remédiation

Aucune tâche de sécurité : aucun constat critical, high ou medium.

Correctifs et durcissements recommandés, non bloquants au titre de la sécurité :

| Réf.                          | Test de non-régression                                                                                                                                                               | Correctif minimal                                                                                                                            | Bloquant                                        | Responsable     | Échéance                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------- | -------------------------------------- |
| FONC-001 (défaut fonctionnel) | Enregistrer une vue sauvegardée filtrée par type réussit ; la sortie du filtre par type en écriture est sérialisable en JSON ; une valeur non textuelle est refusée proprement (400) | Dans `filter_issue_type`, garder les UUID pour GET, normaliser l'entrée et stocker des chaînes pour POST et PATCH, comme les filtres voisins | Non (sécurité), oui (fonctionnel, avant fusion) | Équipe build    | Avant fusion de `feat/work-item-types` |
| DUR-001                       | Restaurer un ticket supprimé dont le type a été supprimé lui redonne le type par défaut                                                                                              | Compter `Issue.all_objects` dans les gardes de suppression, ou revalider le type à la restauration                                           | Non                                             | Équipe build    | Livraison 2                            |
| DUR-002                       | Le garde-fou du modèle refuse un type inactif                                                                                                                                        | Ajouter `is_active` au filtre de `Issue._ensure_default_type`                                                                                | Non                                             | Équipe build    | Livraison 2                            |
| DUR-003                       | Les routes du projet refusent un projet supprimé ou archivé                                                                                                                          | Charger le projet (workspace de l'URL) avant le PATCH et le DELETE des liaisons                                                              | Non                                             | Équipe build    | Livraison 2                            |
| DUR-004                       | La file de suppression n'est envoyée qu'après le commit                                                                                                                              | Mettre la cascade dans `transaction.on_commit`                                                                                               | Non                                             | Équipe build    | Livraison 2                            |
| COUV-001                      | Seconde passe sur les 3 unités reportées                                                                                                                                             | Audit `standard` limité à ces unités                                                                                                         | Non                                             | Équipe sécurité | Avant la livraison 2                   |
