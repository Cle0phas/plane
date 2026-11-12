# Workflows (livraison 2) : conception

- Date : 2026-11-12
- Branche : `feat/workflows` (fork `Cle0phas/plane`), construite sur `feat/work-item-types` (livraison 1, PR #1 non fusionnée)
- Statut : en relecture
- Dépend de : `docs/superpowers/specs/2026-11-12-work-item-types-design.md`

## 1. Contexte et objectif

La livraison 1 a introduit les types de ticket. Cette livraison permet de définir des **workflows** : les états qu'un ticket peut prendre et les **passages autorisés** entre ces états, différents selon le type de ticket, partagés entre projets et imposés par le serveur. Un projet sans workflow garde le fonctionnement libre actuel de Plane.

Vocabulaire :

- **État** : une étape d'un ticket (À faire, En cours, En recette, Livré...).
- **Transition** : une flèche autorisée d'un ou plusieurs états source vers un état cible. Sans flèche, le passage est refusé.
- **Transition globale** : une flèche « depuis n'importe quel état » vers un état cible, dessinée explicitement par l'admin.
- **Système de workflow d'un projet** : le workflow par défaut du projet, plus un workflow par type de ticket.

## 2. Décisions de cadrage

| #   | Décision                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | Le groupe de tickets qui suit un workflow est le type de ticket (livraison 1, D1).                                                                                                                                                                                                                 |
| W2  | Les workflows sont définis au niveau du workspace et peuvent être reliés à plusieurs projets ; une modification s'applique à tous les projets reliés.                                                                                                                                              |
| W3  | Chaque projet a un système de workflow : un workflow par défaut et, éventuellement, un workflow par type.                                                                                                                                                                                          |
| W4  | Les états d'un projet relié sont exactement l'union des états de ses workflows ; ils sont créés et synchronisés automatiquement et deviennent non modifiables depuis Paramètres du projet > States.                                                                                                |
| W5  | Les états sont illimités et nommés librement. Chaque état porte en interne un groupe Plane (backlog, unstarted, started, completed, cancelled ; jamais triage), déduit automatiquement et modifiable : état initial vers unstarted, état sans flèche sortante vers completed, autres vers started. |
| W6  | Règles de transition de la v1 : la flèche elle-même, plus une seule règle, « limiter qui » : liste de rôles (extensible), personnes nommées, responsable du ticket, créateur du ticket. Sans règle, la transition est ouverte à quiconque peut modifier le ticket.                                 |
| W7  | Un seul état initial par workflow ; tout ticket créé y entre.                                                                                                                                                                                                                                      |
| W8  | Le workflow est optionnel : sans système, le projet reste libre. Avec un système, le serveur refuse toute transition non autorisée, quel que soit le chemin.                                                                                                                                       |
| W9  | Au changement de type d'un ticket, si l'état actuel existe dans le workflow du nouveau type il est gardé, sinon un état d'arrivée doit être choisi ; sans ce choix, le changement est refusé.                                                                                                      |
| W10 | Relier un projet passe par une étape de correspondance : chaque état contenant des tickets et absent du workflow de leur type reçoit un état d'arrivée ; rien ne bouge avant confirmation.                                                                                                         |
| W11 | Retirer un état d'un workflow est refusé tant qu'un ticket s'y trouve dans un projet relié ; une migration guidée viendra plus tard et le modèle doit la permettre sans refonte.                                                                                                                   |
| W12 | Créer ou modifier un workflow : admins du workspace. Choisir le système d'un projet : admin du projet ou admin du workspace.                                                                                                                                                                       |
| W13 | Éditeur en diagramme (React Flow, `@xyflow/react`, version épinglée via le catalogue pnpm), avec formulaires équivalents au clavier et panneau latéral.                                                                                                                                            |
| W14 | Toute modification de configuration est tracée dans le journal d'audit de la livraison 1.                                                                                                                                                                                                          |
| W15 | Les nouveaux textes passent par `packages/i18n`, en anglais et en français (« ticket »), puis les 20 autres langues avec le skill `translate`. Les clés `workflows.*` déjà présentes dans Plane sont réutilisées.                                                                                  |
| W16 | Approche A retenue : des états de workflow propres au workspace, synchronisés vers des états de projet ordinaires liés. Écartées : workflows pointant sur les états d'un projet (pas de partage, contraire à W2) ; workflow stocké en JSON (pas d'intégrité, synchronisation fragile).             |

## 3. Données

### 3.1 Nouvelles tables (rattachées au workspace, suppression logique comme le reste de Plane)

| Table                       | Champs principaux                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Workflow`                  | workspace, nom (unique dans le workspace, sans tenir compte de la casse), description                                                                                                                                       |
| `WorkflowState`             | workflow, nom (unique dans le workflow, sans tenir compte de la casse), couleur, groupe Plane, `group_is_auto` (vrai tant que le groupe est déduit automatiquement), position x et y dans le diagramme, ordre, `is_initial` |
| `WorkflowTransition`        | workflow, état cible, nom facultatif, `from_any` (transition globale)                                                                                                                                                       |
| `WorkflowTransitionSource`  | transition, état source (vide si `from_any`)                                                                                                                                                                                |
| `WorkflowTransitionRule`    | transition, type de règle (`restrict_actors` en v1), paramètres JSON validés à la frontière : rôles, identifiants d'utilisateurs, `assignee`, `creator`                                                                     |
| `ProjectWorkflowScheme`     | projet (un seul système par projet), workflow par défaut                                                                                                                                                                    |
| `ProjectWorkflowSchemeItem` | système, type de ticket, workflow                                                                                                                                                                                           |

Ajout sur l'existant : `State.workflow_state`, clé étrangère facultative vers `WorkflowState`. Un état lié est **géré**.

### 3.2 Invariants

1. Un workflow a exactement un état initial dès qu'il a au moins un état (contrainte d'unicité partielle en base).
2. Une transition et ses sources ne référencent que des états de son propre workflow.
3. Dans un projet, un `WorkflowState` correspond à au plus un `State` non supprimé.
4. Un système de projet ne référence que des workflows et des types de ticket du workspace du projet ; le type doit être activé dans le projet.
5. Dans un projet doté d'un système, tout ticket non supprimé est dans un état géré appartenant au workflow de son type.
6. Le groupe `triage` n'est jamais utilisé par un état de workflow ; les tickets de l'intake restent en triage jusqu'à leur acceptation.

### 3.3 Résolution du workflow d'un ticket

`workflow_for(issue)` : le système du projet ; si une ligne existe pour le type du ticket, son workflow, sinon le workflow par défaut. Sans système : aucun workflow, projet libre.

## 4. Contrôle des transitions

### 4.1 Point de décision unique

Service `check_transition(issue, from_state, to_state, actor)` (dans `apps/api/plane/utils/workflows.py`) :

1. sans workflow (3.3), tout est permis ;
2. `to_state` doit être un état géré du workflow du ticket ;
3. il faut une transition du workflow dont la cible est l'état de workflow de `to_state` et dont une source est celui de `from_state`, ou qui est globale ;
4. si la transition porte une règle `restrict_actors`, l'acteur doit satisfaire au moins un critère : rôle de projet dans la liste, utilisateur nommé, responsable du ticket, créateur du ticket. Les admins du workspace ne sont pas exemptés implicitement : pour les autoriser, la règle les liste.
5. un passage d'un état vers lui-même n'est pas un changement d'état et n'est pas contrôlé.

### 4.2 Points d'appel

- Validation des requêtes qui portent déjà le contrôle du type (livraison 1) : `IssueCreateSerializer` (application : création, modification, sous-tickets, intake, conversion de brouillon) et `IssueSerializer` de l'API v1 (création, modification, upsert, intake). L'acteur est l'utilisateur de la requête ; pour une clé d'API, l'utilisateur de la clé.
- Brouillons : aucun contrôle tant qu'ils restent des brouillons ; leur conversion est une création.

### 4.3 Cas particuliers

| Réf. | Cas                                            | Comportement                                                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | Création                                       | L'état est l'état initial du workflow ; un autre état demandé est refusé (400). Sans état demandé, l'état initial est posé.                                                                                                                                                                              |
| T2   | Changement de type                             | W9 ; le contrôle se fait dans le workflow du nouveau type. L'état d'arrivée choisi doit être un état géré de ce workflow ; aucune transition n'est exigée pour ce saut, qui est un changement de workflow.                                                                                               |
| T3   | Acceptation d'un ticket de l'intake            | Passage de triage à l'état initial du workflow du ticket, au lieu de l'état par défaut du projet.                                                                                                                                                                                                        |
| T4   | Automatisation « fermer les tickets inactifs » | Pour un ticket sous workflow : seulement vers un état du groupe `cancelled` de son workflow, atteignable par une transition globale ; sinon le ticket n'est pas déplacé. Pour tous les tickets, l'état cible est cherché dans le projet du ticket (corrige le choix actuel d'un état d'un autre projet). |
| T5   | Archivage, désarchivage                        | Inchangé : pas de changement d'état.                                                                                                                                                                                                                                                                     |
| T6   | Projet relié en cours de vie                   | Création d'état (synchronisation) et correspondance (W10) sont des opérations système, sans contrôle de transition, tracées dans l'historique de chaque ticket déplacé.                                                                                                                                  |

### 4.4 Filet de sécurité dans le modèle

`Issue.save`, quand `state_id` change et que le projet a un système : l'état doit être un état géré du workflow du ticket, sinon erreur. Pas de contrôle de l'acteur (inconnu du modèle). Ne s'applique pas aux opérations système de T6, qui passent par le service de synchronisation.

### 4.5 Refus

Réponse 400 avec un code et un message uniques (« transition non autorisée »), identiques quelle que soit la raison (pas de flèche, droit insuffisant, état hors workflow). L'interface affiche le texte traduit `workflows.workflow_disabled.title`.

## 5. Relier un projet et synchroniser

### 5.1 Assistant de rattachement (onglet Paramètres du projet > Workflows)

1. Choix du workflow par défaut et des workflows par type (types activés dans le projet).
2. Correspondance (W10), calculée par le serveur : pour chaque couple (état actuel, workflow cible) contenant des tickets, un état d'arrivée du workflow cible à choisir. Un état actuel de même nom (sans tenir compte de la casse) qu'un état du workflow est réutilisé et ne demande pas de choix.
3. Application, en une transaction par lots :
   - création ou réutilisation et liaison des états de projet pour chaque état des workflows du système ;
   - déplacement des tickets selon la correspondance, avec une entrée d'historique par ticket ;
   - suppression logique des anciens états devenus vides et hors workflow ;
   - état par défaut du projet : l'état initial du workflow par défaut ;
   - entrée dans le journal d'audit.
     L'opération est rejouable sans effet en double.

### 5.2 Modifier un workflow partagé

| Modification                                           | Effet                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Ajouter un état                                        | Créé dans tous les projets reliés                                                                                                    |
| Renommer, changer couleur ou groupe                    | Répercuté sur les états de projet liés                                                                                               |
| Ajouter, modifier, retirer une transition ou une règle | Effet immédiat sur les changements d'état suivants                                                                                   |
| Retirer un état                                        | Refusé (400) tant qu'un ticket non supprimé s'y trouve dans un projet relié ; le message donne le nombre de tickets par projet (W11) |
| Changer l'état initial                                 | Effet sur les créations suivantes                                                                                                    |
| Supprimer un workflow                                  | Refusé tant qu'un projet l'utilise                                                                                                   |

### 5.3 Détacher un projet

Suppression du système : les états restent mais perdent leur lien (`workflow_state` vide), redeviennent modifiables, et le projet revient au fonctionnement libre.

### 5.4 Paramètres du projet > States

Pour un projet doté d'un système : lecture seule, bandeau « géré par le workflow ». Le serveur refuse aussi la création, la modification, la suppression et le changement d'état par défaut d'un état géré.

## 6. Règles d'accès

| Réf. | Règle                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| A1   | Lire les workflows du workspace : tout membre du workspace (le diagramme sert à comprendre les passages).              |
| A2   | Créer, modifier, supprimer un workflow, ses états, transitions et règles : admin du workspace.                         |
| A3   | Lire le système d'un projet : tout membre du workspace.                                                                |
| A4   | Définir, modifier ou retirer le système d'un projet, lancer le rattachement : admin du projet ou admin du workspace.   |
| A5   | Tout objet est résolu dans le workspace de l'URL ; un objet absent ou d'un autre workspace reçoit la même réponse 404. |

## 7. Interface

### 7.1 Paramètres du workspace > Workflows (admins)

Liste : nom, nombre d'états, projets qui l'utilisent ; bouton « Créer un workflow ».

### 7.2 Éditeur de workflow (plein écran)

- Diagramme : une boîte par état, colorée selon le groupe, marque « DÉBUT » sur l'état initial, flèches entre boîtes, badge pour les transitions globales.
- Formulaires équivalents au clavier : « Ajouter un état » (nom, couleur, catégorie facultative), « Ajouter une transition » (états source ou « n'importe quel état », état cible, nom).
- Panneau latéral au clic : modifier ou supprimer un état ou une flèche, définir l'état initial, régler « limiter qui ».
- Enregistrement explicite (« Enregistrer », « Annuler les changements ») ; un refus s'affiche dans un bandeau avec les projets concernés.
- Lecture seule pour les non-admins.

### 7.3 Paramètres du projet > Workflows

Système du projet et assistant de rattachement (5.1).

### 7.4 Côté tickets

- Sélecteur d'état (fiche, liste, tableur, sous-tickets) : uniquement les états atteignables par l'utilisateur, plus l'état actuel.
- Kanban et liste : branchement de la prise prévue par Plane (`apps/web/components/workflow/use-workflow-drag-n-drop.ts`) ; colonnes interdites grisées avec le motif ; refus du serveur : la carte revient à sa place avec le message.
- Création : état fixé à l'état initial, affiché en lecture seule.

### 7.5 Accessibilité

Toutes les actions de l'éditeur sont réalisables sans souris ; les éléments grisés exposent leur motif aux technologies d'assistance ; contraste et focus conformes à WCAG 2.1 AA.

## 8. Sécurité (STRIDE)

| Menace                  | Cas                                                                                                        | Mesure                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Usurpation              | Appel sans session ou clé valide                                                                           | Authentification Plane existante                                                                                                         |
| Altération              | Contourner un workflow (autre chemin d'écriture, autre état, transition vers un état d'un autre workspace) | Contrôle unique sur chaque chemin (4.2), filet dans le modèle (4.4), références limitées au workspace (invariants 2 et 4)                |
| Répudiation             | Nier une modification de configuration ou un déplacement en masse                                          | Journal d'audit (W14), historique par ticket (T6)                                                                                        |
| Divulgation             | Déduire la configuration ou des tickets d'autres projets via les refus ou la correspondance                | Message de refus unique (4.5) ; correspondance limitée au projet concerné ; comptes du refus de retrait réservés aux admins du workspace |
| Déni de service         | Rattachement d'un gros projet, workflow très grand                                                         | Opérations par lots ; bornes : 200 états et 1 000 transitions par workflow, noms 255 caractères                                          |
| Élévation de privilèges | Un membre modifie un workflow ou contourne « limiter qui »                                                 | A2, A4 côté serveur ; « limiter qui » évalué côté serveur avec l'acteur de la requête                                                    |

Entrées validées à la frontière : identifiants en chaînes UUID strictes, paramètres de règle limités aux clés attendues, rôles parmi les valeurs connues, utilisateurs membres du workspace.

## 9. Tests

Écrits avant le code.

- Droits : chaque route jouée par admin du workspace, admin du projet, membre, invité, non-membre.
- Contrôle des transitions sur chaque chemin de 4.2 et chaque cas de 4.3 (création, changement de type, intake, automatisation).
- « Limiter qui » : chaque critère, seul et combiné.
- Synchronisation et rattachement : réutilisation par nom, correspondance, rejeu, état par défaut.
- Modification de workflow partagé : propagation, refus de retrait d'un état utilisé, refus de suppression d'un workflow utilisé.
- Filet du modèle.
- Frontend (vitest) : logique du sélecteur filtré et du glisser-déposer.
- Avant fusion : `pnpm check`, suite pytest complète, revue de code, `/security`.

## 10. Évolutions identifiées, non planifiées

- Autres règles de transition : champ obligatoire, sous-tâches fermées, écran de transition, actions automatiques, résolution, approbations.
- Migration guidée lors du retrait d'un état (W11).
- Versionnage et brouillons de workflow.
- Rôles supplémentaires dans « limiter qui ».
- « Afficher le workflow » depuis la fiche d'un ticket.
