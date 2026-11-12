# Types de ticket (livraison 1) : conception

- Date : 2026-11-12
- Branche : `feat/work-item-types` (fork `Cle0phas/plane`, base `upstream/preview`)
- Statut : en relecture

## 1. Contexte et objectif

Le fork de Plane remplace Tchô, le clone de Jira spécifié de zéro dans le projet NEW-JIRA. L'objectif à terme est d'avoir des workflows à la Jira, différents selon le groupe de tickets. Le cadrage a retenu que ce groupe est le **type de ticket**.

Plane Community Edition contient déjà le modèle de données des types (`IssueType`, `ProjectIssueType`, `Issue.type`), sans API ni interface. Cette livraison active les types de bout en bout. Elle est le préalable de la livraison 2 (workflows), conçue séparément.

## 2. Décisions de cadrage

| #   | Décision                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Le groupe de tickets qui portera un workflow est le type de ticket.                                                                                                                                                                                         |
| D2  | Les types sont gérés au niveau du workspace par ses admins (CRUD complet), dans un onglet dédié des paramètres du workspace.                                                                                                                                |
| D3  | Chaque projet choisit les types qu'il utilise et son type par défaut.                                                                                                                                                                                       |
| D4  | Un seul type est créé automatiquement : « Tâche », type par défaut. Les admins créent les autres.                                                                                                                                                           |
| D5  | Les types sont toujours actifs : tout ticket a un type. L'interrupteur `Project.is_issue_type_enabled` n'est pas utilisé.                                                                                                                                   |
| D6  | Le filtre et le regroupement par type font partie de cette livraison.                                                                                                                                                                                       |
| D7  | Les nouveaux textes passent par le système de traduction de Plane. Ils sont écrits en anglais et en français ; la CI de Plane exigeant les mêmes clés dans les 22 locales, les 20 autres sont traduites avec le skill `translate`, sans recopier l'anglais. |
| D8  | On réutilise le modèle existant de Plane (approche A), sans nouvelle table pour les types.                                                                                                                                                                  |
| D9  | En français, l'interface dit « ticket » et non « élément de travail », dans les nouveaux textes comme dans les textes existants de Plane (fichiers `packages/i18n/src/locales/fr/*.json`).                                                                  |

Approches écartées : créer nos propres tables (doublon de l'existant, divergence avec le dépôt d'origine) ; des types propres à chaque projet (contraire à D2, empêcherait de partager un workflow entre projets).

## 3. Données

### 3.1 Modèle existant réutilisé

- `IssueType` (`apps/api/plane/db/models/issue_type.py`) : rattaché au workspace. Champs utilisés : `name` (unique dans le workspace parmi les types non supprimés, sans tenir compte de la casse ; la contrainte d'origine a été retirée par la migration `0074`, elle est recréée), `description`, `logo_props` (icône et couleur), `is_active`, `is_default` (type par défaut du workspace).
- `ProjectIssueType` : un type activé dans un projet. `is_default` désigne le type par défaut du projet.
- `Issue.type` : clé étrangère vers `IssueType` (`SET_NULL`).

Champs non utilisés dans cette livraison : `IssueType.is_epic`, `IssueType.level`, `ProjectIssueType.level`, `external_source`, `external_id`.

### 3.2 Invariants

1. Un workspace a exactement un type `is_default=True`, actif (garanti aussi par une contrainte d'unicité partielle en base).
2. Un projet a exactement une ligne `ProjectIssueType` avec `is_default=True`, dont le type est actif (même garantie en base).
3. Le type d'un ticket appartient au workspace du ticket et est activé dans son projet au moment où il est affecté.
4. Tout ticket créé ou modifié après cette livraison a un type non nul.

### 3.3 Nouvelle table : journal d'audit

Plane n'a pas de journal des actions d'administration. On ajoute une table `audit_logs`, en ajout seul, partagée avec la livraison 2 :

- `workspace`, `actor` (utilisateur), `action` (par exemple `issue_type.created`), `target_type`, `target_id`, `before` et `after` (JSON), `created_at`.
- Aucune mise à jour ni suppression par l'application. Aucune donnée personnelle au-delà de l'identifiant de l'auteur.

### 3.4 Migration de données

Une migration de données, idempotente :

1. Dans chaque workspace sans type par défaut, création de « Tâche » (`is_default=True`, `is_active=True`).
2. Dans chaque projet sans type par défaut, activation de « Tâche » comme défaut.
3. Chaque ticket sans type reçoit le type par défaut de son projet. Traitement par lots pour ne pas verrouiller la table `issues`.

À la création d'un workspace ou d'un projet, le même état initial est créé par le code applicatif.

## 4. Règles côté serveur

Toutes les règles sont contrôlées par le serveur, sur chaque opération. L'interface ne fait que refléter ces droits.

| Réf. | Règle                                                                                                                                                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | Créer, modifier, désactiver, réactiver, supprimer un type du workspace : admin du workspace seulement.                                                                                                                                                                                                    |
| R2   | Lister les types du workspace et ceux d'un projet : tout membre du workspace (admin, membre, invité).                                                                                                                                                                                                     |
| R3   | Activer ou retirer un type dans un projet, choisir le défaut du projet : admin du projet ou admin du workspace.                                                                                                                                                                                           |
| R4   | Le nom d'un type est obligatoire, nettoyé des espaces en tête et en fin, 255 caractères au plus, unique dans le workspace (sans tenir compte de la casse).                                                                                                                                                |
| R5   | Changer le type par défaut du workspace retire le statut au précédent, dans une seule transaction. Le défaut ne peut être ni désactivé ni supprimé.                                                                                                                                                       |
| R6   | Supprimer un type est refusé tant que des tickets, non supprimés, l'utilisent. La suppression est une suppression logique (`deleted_at`), comme le reste de Plane.                                                                                                                                        |
| R7   | Désactiver un type le retire des choix de création et de changement de type. Les tickets existants le gardent. Un type désactivé ne peut pas être activé dans un projet.                                                                                                                                  |
| R8   | Dans un projet, on ne peut retirer ni le type par défaut, ni un type utilisé par des tickets du projet.                                                                                                                                                                                                   |
| R9   | À la création et à la modification d'un ticket (API de l'application, API publique v1, brouillons, création en masse) : le type indiqué doit appartenir au même workspace et être activé dans le projet, sinon la requête est refusée (400). Sans type indiqué à la création : type par défaut du projet. |
| R10  | Un ticket qui change de projet reçoit le type par défaut du projet cible si son type n'y est pas activé.                                                                                                                                                                                                  |
| R11  | Un changement de type d'un ticket crée une entrée dans son historique d'activité.                                                                                                                                                                                                                         |
| R12  | Toute opération de R1 et R3 crée une entrée dans le journal d'audit.                                                                                                                                                                                                                                      |
| R13  | Désactiver un type qui est le défaut d'au moins un projet est refusé (400), avec le motif affiché, pour préserver l'invariant 2.                                                                                                                                                                          |
| R14  | Description : 1000 caractères au plus. Icône (`logo_props`) : uniquement la forme écrite par le frontend (icône nommée avec couleurs `#rrggbb`, ou emoji par code) ; toute URL d'image est refusée. `is_default` ne se pose qu'en PATCH avec `true`, jamais à la création.                                |

R9 corrige une faille existante : aujourd'hui, `IssueCreateSerializer` (`apps/api/plane/app/serializers/issue.py`), `DraftIssueCreateSerializer` (`apps/api/plane/app/serializers/draft.py`), le serializer public de l'app `space` et le serializer de l'API v1 (`apps/api/plane/api/serializers/issue.py`) acceptent n'importe quel `IssueType`, y compris d'un autre workspace. L'API v1 cherche aussi le défaut avec `IssueType.is_default` au lieu de `ProjectIssueType.is_default`.

Constats du code qui précisent R9 et R10 :

- Plane Community Edition n'a pas de création en masse ni de déplacement d'un ticket vers un autre projet. R10 est donc garantie dans le modèle (`Issue.save`), qui donne aussi le type par défaut du projet à tout ticket créé sans type (formulaires d'intake compris).
- La migration de données ignore les projets supprimés logiquement : leurs tickets, invisibles partout, gardent un type vide.

## 5. API

Conventions de Plane (`apps/api/plane/app/urls`), vues dérivées de `BaseViewSet` ou `BaseAPIView`, droits par `allow_permission`.

| Méthode | Route                                                                            | Rôle                                                    |
| ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| GET     | `workspaces/<slug>/issue-types/`                                                 | R2                                                      |
| POST    | `workspaces/<slug>/issue-types/`                                                 | R1                                                      |
| GET     | `workspaces/<slug>/issue-types/<uuid:pk>/`                                       | R2                                                      |
| PATCH   | `workspaces/<slug>/issue-types/<uuid:pk>/`                                       | R1 (nom, description, icône, `is_active`, `is_default`) |
| DELETE  | `workspaces/<slug>/issue-types/<uuid:pk>/`                                       | R1, R6                                                  |
| GET     | `workspaces/<slug>/projects/<uuid:project_id>/issue-types/`                      | R2                                                      |
| POST    | `workspaces/<slug>/projects/<uuid:project_id>/issue-types/`                      | R3 (`issue_type_id`)                                    |
| PATCH   | `workspaces/<slug>/projects/<uuid:project_id>/issue-types/<uuid:issue_type_id>/` | R3 (`is_default`)                                       |
| DELETE  | `workspaces/<slug>/projects/<uuid:project_id>/issue-types/<uuid:issue_type_id>/` | R3, R8                                                  |

La liste du workspace renvoie pour chaque type le nombre de tickets qui l'utilisent, pour l'affichage et pour griser la suppression. Les réponses des tickets (liste, détail) renvoient `type_id`. Les erreurs suivent le format de Plane et ne révèlent rien sur les objets d'un autre workspace (même réponse pour « inexistant » et « hors workspace »).

## 6. Interface

### 6.1 Paramètres du workspace : onglet « Types de ticket »

- Entrée dans la barre des paramètres du workspace, visible des seuls admins (`access: [ADMIN]`, comme Webhooks). Route protégée par `allowPermissions`, page « Accès non autorisé » sinon.
- Liste : icône, nom, description, nombre de tickets, badge « Par défaut », état actif ou inactif.
- Bouton « Créer un type » : fenêtre avec nom, description, icône et couleur.
- Menu « ... » par ligne : Modifier, Définir par défaut, Désactiver ou Réactiver, Supprimer. Les actions interdites (R5, R6) sont désactivées avec leur motif.
- États : chargement, liste vide impossible (le défaut existe toujours), erreur.

### 6.2 Paramètres du projet : onglet « Types de ticket »

- Visible des admins du projet et du workspace.
- Liste des types actifs du workspace, avec une case « Utilisé dans ce projet » et un choix « Par défaut ». Les cases interdites par R8 sont désactivées avec leur motif.

### 6.3 Création d'un ticket

- Sélecteur « Type » en tête du formulaire, présélectionné sur le défaut du projet, limité aux types activés dans le projet.
- Au changement de projet dans le formulaire, le type revient au défaut du nouveau projet (crochet `getIssueTypeIdOnProjectChange` existant).

### 6.4 Fiche du ticket

- Icône du type devant l'identifiant (composant existant `issue-type-switcher.tsx`). Un clic ouvre un menu de changement de type pour qui peut modifier le ticket.
- L'historique affiche « a changé le type de <ancien> à <nouveau> ».

### 6.5 Listes, Kanban, tableur

- Icône du type sur chaque carte et chaque ligne.
- Filtre « Type » et regroupement « Type », sur le modèle de la priorité (`apps/api/plane/utils/issue_filters.py`, `apps/api/plane/utils/grouper.py`, constantes de filtres et d'affichage côté front).

### 6.6 Accessibilité et langues

- Chaque icône de type a un libellé texte (le nom du type). Les menus et fenêtres sont utilisables au clavier. Les actions désactivées exposent leur motif aux technologies d'assistance.
- Textes via `packages/i18n` (clés `work_item_types.*` existantes complétées), selon D7 et D9.
- Le type créé automatiquement s'appelle « Tâche » dans tous les workspaces, y compris pour les utilisateurs en anglais (c'est une donnée, pas un texte traduit).

## 7. Sécurité (STRIDE)

| Menace                  | Cas                                                                   | Mesure                                                                                        |
| ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Usurpation              | Appel de l'API sans session valide                                    | Authentification Plane existante (session, clé API v1)                                        |
| Altération              | Ticket rattaché au type d'un autre workspace, ou à un type non activé | R9, testé sur les deux API                                                                    |
| Répudiation             | Un admin nie avoir supprimé ou modifié un type                        | Journal d'audit R12, en ajout seul                                                            |
| Divulgation             | Lister ou deviner les types d'un autre workspace                      | Requêtes filtrées par workspace, réponse identique pour inexistant et hors workspace          |
| Déni de service         | Migration qui verrouille `issues`, liste de types très longue         | Migration par lots ; pagination non nécessaire (volume faible), limite de longueur des champs |
| Élévation de privilèges | Un membre ou un invité gère les types                                 | R1, R3 contrôlés côté serveur sur chaque route, testés par profil                             |

Entrées validées à la frontière : nom et description nettoyés et bornés, `logo_props` limité aux clés attendues, identifiants vérifiés comme UUID. Rendu côté front sans HTML brut.

## 8. Tests

Écrits avant le code (TDD).

- **Backend** (pytest, fixtures de `apps/api/plane/tests/conftest.py`, profils admin 20, membre 15, invité 5) :
  - droits : chaque route de la section 5 jouée par les trois profils ;
  - règles R4 à R10 ;
  - régression de la faille R9 sur l'API de l'application et l'API v1 ;
  - migration de données (invariants 1, 2, 4 vérifiés après exécution) ;
  - historique R11 et journal d'audit R12 ;
  - filtre et regroupement par type.
- **Frontend** (vitest) : logique des stores et sélecteurs (types actifs, défaut du projet, filtre).
- **Vérification manuelle** dans le navigateur, en admin puis en membre, du parcours complet.
- **Avant fusion** : `pnpm check`, suite pytest complète dans Docker, revue de code, passage `/security`.

## 9. Évolutions identifiées, non planifiées

- Hiérarchie de types (Epic au-dessus, sous-tâche en dessous), avec `is_epic` et `level`.
- Champs propres à chaque type.
- Workflows par type : livraison 2, conçue séparément.

## 10. Limites connues

- **Suppression et affectation simultanées** : un ticket qui reçoit un type pendant que ce type est supprimé garde un type vide jusqu'à son prochain enregistrement, où il reçoit le type par défaut de son projet.
- **Nombre de tickets par type visible de tous** : l'API de lecture des types (R2) renvoie, pour chaque type, le nombre de tickets qui l'utilisent, à tout membre du workspace, y compris les tickets des projets privés dont il n'est pas membre. À revoir en livraison 2.
- **Journal d'audit en ajout seul côté application uniquement** : rien n'empêche, au niveau de la base, de modifier ou supprimer des lignes de `audit_logs` par `bulk_update` ou par SQL brut.
- **Brouillons et R8** : retirer un type d'un projet ne tient pas compte des brouillons (privés à leur auteur, invisibles de l'admin qui retire le type). Un brouillon dont le type n'est plus utilisable le garde ; à l'édition ou au déplacement vers le projet, le formulaire le remplace par le type par défaut du projet, et le serveur refuse la conversion avec l'ancien type (400).
- **Vérification avant déploiement** : la migration `0128_work_item_type_constraints` crée une contrainte d'unicité du nom sans tenir compte de la casse. Elle échoue si un workspace a déjà deux types dont les noms ne diffèrent que par la casse. Avant de déployer, lancer la requête suivante et renommer les doublons qu'elle renvoie :

  ```sql
  SELECT workspace_id, lower(name), count(*)
  FROM issue_types
  WHERE deleted_at IS NULL
  GROUP BY 1, 2
  HAVING count(*) > 1;
  ```
