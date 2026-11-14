# Refonte des écrans de workflows (livraison 2) : conception

- Date : 2026-11-14
- Branche : `feat/workflows` (fork `Cle0phas/plane`), avant l'ouverture de la PR 2
- Statut : en relecture
- Complète : `docs/superpowers/specs/2026-11-12-workflows-design.md`, dont elle remplace les sections 7.1, 7.2, 7.3 et 7.5. Le modèle, le contrôle des transitions, le rattachement et les règles d'accès A1 à A5 restent ceux de cette spec.

## 1. Contexte et objectif

L'éditeur livré par les tâches 13 à 17 fonctionne mais ne convient pas : il faut saisir le nom de chaque état alors que les projets en ont déjà, les formulaires sont empilés sous le diagramme, et l'ensemble est loin de l'éditeur de Jira. Cette refonte reprend les trois écrans de workflows (éditeur, liste, onglet du projet) sur le modèle de Jira, sans toucher au modèle de données ni au contrôle des transitions, à une exception près (côtés des flèches, 4.4).

Références visuelles, dans `NEW-JIRA/.claude/worktrees/lot1-increment-3-692d6b/docs` :

- maquettes `architecture/mockups/ECR-063-*.html` (éditeur), `ECR-064` (ajouter un état), `ECR-065` (créer une transition), `ECR-066` (transition), `ECR-067-regle-limiter` (règle), `ECR-038-*` (workflows d'un projet) ;
- description écrite : `architecture/ui.md`, sections ECR-063 à ECR-067 et ECR-038 ;
- captures de Jira : `research/ui/captures/F/F-28` à `F-35`.

## 2. Décisions de cadrage

| #   | Décision                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Le modèle reste celui de W16 et W17 : statuts définis au niveau du workspace, workflows partagés entre projets.                                                                                                                                             |
| R2  | La cible visuelle est le jeu de maquettes Tchô, réalisé avec les composants et les thèmes de Plane ; ce n'est pas une copie au pixel de Jira. Le fond du diagramme suit le thème.                                                                           |
| R3  | La refonte couvre en une fois l'éditeur, la liste des workflows et l'onglet Workflows du projet.                                                                                                                                                            |
| R4  | L'éditeur est plein écran, avec une vue Diagramme et une vue Texte. Les formulaires sous le diagramme disparaissent.                                                                                                                                        |
| R5  | « Ajouter une règle » ne propose que la règle existante, « limiter qui peut faire la transition » (W6).                                                                                                                                                     |
| R6  | La refonte se fait sur `feat/workflows` ; la PR 2 n'est ouverte qu'ensuite, et les revues et `/security` de l'étape 20 portent sur l'ensemble.                                                                                                              |
| R7  | « Ajouter un état » propose une seule liste « Rechercher ou créer » : les statuts du workspace absents du workflow, puis les états des projets du workspace qui ne sont pas encore des statuts, chaque nom une fois.                                        |
| R8  | Cette liste est à sélection multiple : plusieurs états cochés sont ajoutés en une fois.                                                                                                                                                                     |
| R9  | Un workflow peut être créé à partir d'un projet. Il reprend les états du projet, enchaînés dans l'ordre (5.2) ; seuls l'état de départ et les états annulés sont joignables depuis n'importe quel état.                                                     |
| R10 | L'état de départ d'un workflow créé depuis un projet est l'état par défaut du projet. L'état de triage n'est jamais repris.                                                                                                                                 |
| R11 | Un workflow peut être dupliqué ; la copie n'est reliée à aucun projet.                                                                                                                                                                                      |
| R12 | Un état ajouté se place à droite du dernier, la vue se recale ; pas de mise en page automatique.                                                                                                                                                            |
| R13 | L'onglet du projet reprend la présentation d'ECR-038. Chaque projet garde sa propre affectation (W3) ; les « systèmes de workflow » nommés et réutilisables de Jira (ECR-062) ne sont pas créés.                                                            |
| R14 | La liste des workflows est un tableau (6.1).                                                                                                                                                                                                                |
| R15 | Les admins du workspace voient, dans la liste de R7 et dans le champ « Partir du projet », les états de tous les projets du workspace, y compris ceux dont ils ne sont pas membres. Décision provisoire, à revoir.                                          |
| R16 | Sur le diagramme et dans la vue Texte, un état est coloré par catégorie : gris (Backlog, Non commencé), bleu (En cours), vert (Terminé), rouge (Annulé). La couleur propre du statut reste celle de la colonne du Kanban et se règle dans le panneau droit. |
| R17 | Un état sélectionné montre quatre points de connexion (haut, droite, bas, gauche). Une flèche part de n'importe quel point et arrive sur n'importe quel point ; les côtés choisis sont enregistrés.                                                         |
| R18 | Le nœud « DÉMARRER » est toujours affiché et relié à l'état de départ.                                                                                                                                                                                      |
| R19 | Les tests du web reçoivent un environnement capable de dessiner un composant (4.6), pour couvrir l'affichage de l'éditeur.                                                                                                                                  |

Approches écartées : réécrire aussi la logique du brouillon (`graph-model.ts`), qui n'est pas en cause et dont on perdrait les tests ; livrer d'abord la sélection des états dans la présentation actuelle puis la refonte visuelle, ce qui ferait écrire des formulaires jetés aussitôt.

## 3. Éditeur de workflow

Adresse inchangée (`/:workspaceSlug/settings/workflows/:workflowId`), affichée sans le menu latéral des paramètres.

### 3.1 En-tête

- À gauche : nom du workflow ; pastille « Utilisé dans N projets », qui liste ces projets au clic quand le serveur les fournit (admins du workspace, comme aujourd'hui).
- Au centre : « Ajouter un état », « Ajouter une transition », « Ajouter une règle », icône au-dessus du libellé, prise dans les icônes de `@makeplane/propel` (l'application web n'utilise pas Lucide).
- À droite : « Enregistrer », inactif tant que le brouillon est identique au workflow enregistré ou qu'il contient une erreur de validation ; « Fermer », qui devient « Annuler les changements » dès qu'il y a une modification. « Fermer » ramène à la liste.
- L'enregistrement reste explicite. La protection existante contre la perte de modifications non enregistrées est conservée.

### 3.2 Diagramme

- Fond uni, sans grille. Déplacement et zoom du canevas ; mini-carte avec curseur de zoom en bas à droite ; case « Afficher les étiquettes de transition », décochée par défaut.
- Nœud « DÉMARRER » : rond sombre, non supprimable, relié par une flèche à l'état de départ. Dans un workflow vide il est seul ; le premier état ajouté devient l'état de départ. On change l'état de départ en déposant l'extrémité de cette flèche sur un autre état, ou par l'action « Définir comme état de départ » du panneau (équivalent clavier).
- État : rectangle au nom en majuscules, coloré selon R16. Le texte est du HTML d'au moins 11 px.
- Flèche : tracé à angle droit, d'un côté d'un état à un côté d'un autre (R17). Une transition à plusieurs états source donne une flèche par source.
- Transition globale : pastille sombre « N'importe lequel », précédée d'une icône, au-dessus de l'état cible ; aucune flèche.
- État sélectionné : bordure d'accent et quatre points de connexion. Tirer d'un point vers un point d'un autre état crée une transition sans nom avec ces deux côtés.
- Une flèche créée sans geste (fenêtre 3.4, création depuis un projet, duplication d'un workflow ancien) n'a pas de côté enregistré : l'affichage prend le couple de côtés le plus proche d'après la position des deux états.
- Placement (R12) : un état ajouté prend la position du dernier état, décalée d'un pas fixe vers la droite, sur la même ligne ; plusieurs états ajoutés ensemble se suivent dans l'ordre de la liste. La vue se recale ensuite sur l'ensemble du diagramme.

### 3.3 Fenêtre « Ajouter un état » (ECR-064)

- Champ « Nom d'état », invite « Rechercher ou créer », à cases à cocher.
- Contenu de la liste (R7), dans cet ordre : statuts du workspace absents du workflow, puis états proposés par le serveur (4.1). Chaque ligne affiche le nom et la catégorie. La saisie filtre sans tenir compte de la casse.
- Quand la saisie ne correspond exactement à aucun nom, une entrée « Créer « <saisie> » » l'ajoute à la sélection comme nouveau statut ; un champ « Catégorie » apparaît alors (Automatique par défaut, puis les cinq catégories de Plane).
- Case « Autoriser les transitions depuis n'importe quel état » : crée une transition globale vers chaque état ajouté.
- « Ajouter » est inactif tant que rien n'est coché. À la validation, les états sont posés dans le brouillon (3.2), le dernier est sélectionné, le focus va sur son nœud.
- Cocher un état proposé ne crée rien côté serveur : le statut est créé à l'enregistrement du workflow, par le chemin existant, avec le nom, la couleur et la catégorie proposés.
- Erreurs sous le champ : nom vide, nom de plus de 255 caractères, nom déjà présent dans le workflow.

### 3.4 Fenêtre « Ajouter une transition » (ECR-065)

« À partir des états » (un ou plusieurs états du workflow, ou « N'importe quel état »), « À l'état », « Nom » facultatif. Les règles de validation sont celles du brouillon actuel (source différente de la cible, pas de doublon).

### 3.5 Fenêtre « Ajouter une règle » (ECR-067)

Choix de la transition (présélectionnée si une transition est sélectionnée), puis la règle « limiter qui » : rôles, personnes nommées, responsable du ticket, créateur du ticket. Une transition porte au plus une règle, comme aujourd'hui.

### 3.6 Panneau droit

Largeur fixe, repliable.

- Sans sélection : pictogramme, titre « Créer des workflows sur mesure » et texte d'aide de la maquette.
- État sélectionné : nom, catégorie, couleur de colonne (modifiables), transitions « Entrant » et « Sortant » avec compteur et bouton d'ajout, « Définir comme état de départ », « Supprimer ». Si le statut est utilisé par d'autres workflows, un avertissement indique leur nombre et rappelle que le renommage, la couleur et la catégorie s'appliquent partout (W17).
- Transition sélectionnée : nom, états de départ, état d'arrivée, règle (ajouter, modifier, retirer), « Supprimer ».
- « Supprimer » retire l'élément du brouillon. Le refus du serveur pour un état qui contient des tickets (W11) reste signalé à l'enregistrement (3.8).

### 3.7 Vue Texte

Tableau à deux colonnes : « État » (pastille de catégorie et nom) et « Transitions » (une ligne par transition entrante : nom, origine « Début », « Tous les états » ou état source, flèche, état cible). Les rangées sont repliables. Sélectionner une rangée ou une transition ouvre le panneau droit. Les ajouts passent par les mêmes boutons d'en-tête. La vue Texte est l'équivalent complet du diagramme au clavier et pour les lecteurs d'écran.

### 3.8 Lecture seule, refus, petits écrans

- Lecture seule (membres non admins du workspace, A1) : pas d'outils d'ajout ni de bouton d'enregistrement, seul « Fermer » ; bandeau `role="status"` « Vous n'êtes pas autorisé à modifier ce workflow. » ; panneau sans action. Le serveur reste seul juge (A2).
- Erreurs de validation du brouillon et refus du serveur : bandeau `role="alert"` sous l'en-tête. Chaque ligne sélectionne l'élément fautif quand il est encore dans le diagramme. Le refus de retrait d'un état donne le nombre de tickets par projet, comme aujourd'hui.
- Sous 1 024 px : le panneau droit s'ouvre en surcouche à la sélection. Sous 768 px : vue Texte par défaut, diagramme en lecture seule, outils d'ajout masqués, cibles de 44 px.

### 3.9 Accessibilité

Remplace la section 7.5 de la spec des workflows. Toutes les actions sont réalisables sans souris : Tab parcourt les nœuds puis les transitions, Entrée sélectionne et ouvre le panneau, Suppr retire, les flèches déplacent un nœud sélectionné, `+` et `-` zooment. Chaque nœud et chaque transition a un nom accessible (« État En cours, catégorie En cours, 2 transitions entrantes, 1 sortante »). Les fenêtres gèrent le focus (entrée, piège, retour au déclencheur). La couleur n'est jamais le seul signal : la catégorie est aussi écrite. Contraste et focus conformes à WCAG 2.1 AA dans les deux thèmes.

### 3.10 Non repris des maquettes

Menus « Plus d'options d'enregistrement » et « Plus d'actions », lien d'aide, « Propriétés » d'un état, bouton « Remplacer », identifiants numériques de la vue Texte, lien « Envoyer un commentaire ».

## 4. Serveur

Tout est résolu dans le workspace de l'URL (A5). Aucune modification du contrôle des transitions (sections 4.1 à 4.5 de la spec des workflows).

### 4.1 États proposés

`GET /api/workspaces/<slug>/workflow-statuses/candidates/`, admins du workspace.

- Source : les états non supprimés des projets non supprimés du workspace, hors catégorie triage et hors nom réservé « Triage ». Une couleur d'état qui n'est pas de la forme `#RRGGBB` est remplacée par une couleur neutre.
- Un nom déjà porté par un statut du workspace est exclu (comparaison sans tenir compte de la casse).
- Un même nom présent dans plusieurs projets donne une seule entrée ; ses valeurs sont celles de l'état créé le plus tôt.
- Réponse : liste de `{ name, color, group }`, triée par catégorie puis par nom, limitée à 500 entrées. Aucun identifiant ni nom de projet.

### 4.2 Création depuis un projet

`POST /api/workspaces/<slug>/workflows/` accepte un champ facultatif `source_project_id` (chaîne UUID stricte). Le projet doit appartenir au workspace et ne pas être supprimé, sinon 404 comme pour un objet absent. Le workflow est créé avec son graphe en une transaction : tout ou rien. Le graphe est construit selon 5.2. Les bornes existantes s'appliquent : au-delà de 200 états repris, ou de 1 000 statuts dans le workspace, la création est refusée (400) et rien n'est créé.

### 4.3 Duplication

`POST /api/workspaces/<slug>/workflows/<id>/duplicate/`, admins du workspace, corps `{ name }`. Copie les états (mêmes statuts, mêmes positions, même état de départ), les transitions, leurs sources avec leurs côtés et leurs règles. La copie n'est reliée à aucun projet. Un nom déjà pris donne le même refus 400 que la création. Le client propose « Copie de <nom> », puis « Copie de <nom> (2) » et ainsi de suite d'après la liste qu'il connaît, tronqué à 255 caractères.

### 4.4 Côtés des flèches

`WorkflowTransitionSource` reçoit deux champs facultatifs, `source_side` et `target_side`, limités à `top`, `right`, `bottom`, `left` ; vides, l'affichage choisit (3.2). Une migration `0130`, avec la mise à jour de `migrations_lockfile.txt`.

Contrat : la réponse et la charge utile du graphe gardent `source_ids` et `source_keys`, et reçoivent pour chaque transition un champ facultatif `sides`, dictionnaire `{ <identifiant ou clé de la source>: { source, target } }`. Une clé qui n'est pas une source de la transition, ou une valeur hors des quatre côtés, est refusée (400).

### 4.5 Journal d'audit

- Création depuis un projet : l'entrée `workflow.created` existante, dont l'instantané porte l'identifiant du projet de départ.
- Duplication : entrée `workflow.duplicated`, avec l'identifiant du workflow d'origine.

### 4.6 Dépendances

Aucune dépendance d'exécution nouvelle : le diagramme utilise `@xyflow/react`, déjà épinglé (mini-carte, tracé à angle droit, connexion libre entre points). Les tests d'affichage du web utilisent `jsdom`, `@testing-library/react` et `@testing-library/user-event`, déjà épinglés dans le catalogue pnpm et utilisés par `packages/blocks` ; ils sont ajoutés aux dépendances de développement de `apps/web`.

## 5. Règles

### 5.1 Couleurs par catégorie (R16)

| Catégorie Plane    | Couleur |
| ------------------ | ------- |
| backlog, unstarted | gris    |
| started            | bleu    |
| completed          | vert    |
| cancelled          | rouge   |

Les teintes exactes viennent des jetons de thème de Plane, une paire fond et texte par catégorie et par thème, au contraste AA.

### 5.2 Graphe d'un workflow créé depuis un projet (R9, R10)

1. États repris : tous les états non supprimés du projet, hors triage. Deux états dont les noms ne diffèrent que par la casse n'en donnent qu'un.
2. Statut de chaque état : le statut du workspace de même nom s'il existe (sans tenir compte de la casse) ; sinon un statut créé avec le nom, la couleur et la catégorie de l'état.
3. Ordre : par catégorie (backlog, unstarted, started, completed, cancelled), puis selon le rang de l'état dans le projet.
4. État de départ : l'état par défaut du projet s'il fait partie des états repris et n'est pas annulé ; sinon le premier de l'ordre.
5. Chaîne : une transition sans nom de chaque état non annulé vers l'état non annulé suivant dans l'ordre.
6. Transitions globales : une vers l'état de départ, une vers chaque état annulé.
7. Positions : une seule ligne, dans l'ordre, au pas de 3.2.

Exemple, projet TEST2 : chaîne Backlog, Todo, In Progress, readey for dev, readey for code review, Done ; transitions globales vers Backlog et vers Cancelled.

Conséquence assumée : un tel workflow n'autorise pas le retour d'un cran en arrière, seulement le retour à l'état de départ. L'admin ajoute les flèches voulues. Rien ne change pour les tickets tant que le workflow n'est pas relié au projet (rattachement de 5.1 de la spec des workflows, inchangé).

## 6. Liste et onglet du projet

### 6.1 Paramètres du workspace > Workflows

Tableau : Nom (ouvre l'éditeur), Description, États (nombre), Utilisé dans (nombre de projets, noms au survol), Modifié le, Actions (Modifier, Dupliquer, Supprimer). « Supprimer » est inactif avec son motif tant qu'un projet utilise le workflow. Les actions d'écriture ne sont affichées qu'aux admins du workspace.

Fenêtre « Créer un workflow » : nom, description, champ facultatif « Partir du projet » (projets du workspace). La création ouvre l'éditeur sur le workflow créé. État vide : texte d'explication et bouton de création.

### 6.2 Paramètres du projet > Workflows (ECR-038)

- Projet sans système : texte expliquant le fonctionnement libre, bouton « Relier à un workflow ».
- Projet relié : tableau Workflow (nom et lien vers l'éditeur), Types de ticket (types qui suivent ce workflow ; « Tous les autres types » pour le workflow par défaut), Actions (« Modifier le workflow », admins du workspace). En haut à droite : « Changer les workflows » et « Détacher ».
- « Relier » et « Changer » ouvrent l'assistant existant en trois étapes (choix, correspondance, confirmation), remis en forme selon `ECR-038-changer-systeme`, `-workflows-migration` et `-changer-systeme-confirmation`. Son comportement et ses appels au serveur ne changent pas.

## 7. Sécurité (STRIDE)

| Menace                  | Cas                                                                                                          | Mesure                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usurpation              | Appel sans session valide                                                                                    | Authentification Plane existante                                                                                                                                                      |
| Altération              | Côté de flèche arbitraire, projet de départ d'un autre workspace, graphe dupliqué pointant hors du workspace | Liste fermée de quatre côtés ; projet et workflow résolus dans le workspace de l'URL ; la copie ne référence que les statuts du workflow d'origine                                    |
| Répudiation             | Nier une création depuis un projet ou une duplication                                                        | Journal d'audit (4.5)                                                                                                                                                                 |
| Divulgation             | Lire les noms d'états de projets privés                                                                      | Route 4.1 et champ `source_project_id` réservés aux admins du workspace (R15) ; la route ne renvoie ni identifiant ni nom de projet ; 404 identique pour un projet absent ou étranger |
| Déni de service         | Workspace à très nombreux états, duplication répétée                                                         | Réponse de 4.1 limitée à 500 entrées ; bornes existantes de 200 états et 1 000 transitions par workflow, 1 000 statuts par workspace                                                  |
| Élévation de privilèges | Un membre crée, duplique ou lit les états proposés                                                           | Rôle admin du workspace vérifié côté serveur sur les trois routes ; l'interface en lecture seule n'est qu'un confort                                                                  |

Aucune donnée personnelle nouvelle, aucun appel sortant, aucun secret. Les noms d'états sont des données de configuration ; leur lecture par les admins du workspace est la décision R15, à revoir.

## 8. Tests

Écrits avant le code.

- Serveur, droits : routes 4.1, 4.2 (avec `source_project_id`) et 4.3 jouées par admin du workspace, admin du projet, membre, invité, non-membre, utilisateur d'un autre workspace.
- Serveur, contenu :
  - 4.1 : dédoublonnage, exclusion du triage, des statuts existants, des projets et états supprimés ; ordre ; limite.
  - 4.2 et 5.2 : ordre, état de départ (défaut, défaut absent, défaut annulé), chaîne, transitions globales, réutilisation d'un statut de même nom, triage exclu, projet d'un autre workspace, dépassement de 200 états, transaction annulée en cas d'échec.
  - 4.3 : copie fidèle (états, positions, transitions, côtés, règles), indépendance vis-à-vis de l'original, aucun projet relié, nom en double.
  - 4.4 : valeurs acceptées, valeurs refusées, clé étrangère à la transition, aller-retour par l'enregistrement du graphe, migration.
  - 4.5 : l'entrée d'audit de chaque opération, avec son origine.
- Web, logique (vitest) : placement à droite, choix automatique des côtés, ajout de plusieurs états au brouillon, changement de l'état de départ, correspondance catégorie et couleur, lignes de la vue Texte, nom proposé pour une copie.
- Web, affichage (vitest avec `jsdom`) : l'éditeur s'ouvre avec des états sans erreur ; la fenêtre « Ajouter un état » ajoute les états cochés ; la vue Texte liste états et transitions ; l'éditeur en lecture seule n'affiche aucun outil d'ajout.
- Avant fusion : `pnpm check`, suite pytest complète, parcours manuel des sections 3 et 6 avec les quatre rôles, revue de code, `/security`.

## 9. Critères d'acceptation

1. Dans un workspace dont les projets ont des états, « Ajouter un état » les propose sans saisie, et en ajoute plusieurs en une fois.
2. Un workflow créé depuis un projet s'ouvre avec le graphe de 5.2.
3. Un workflow dupliqué est identique à l'original, modifiable sans effet sur lui, relié à aucun projet.
4. Une flèche tracée d'un point à un autre garde ses deux côtés après enregistrement et rechargement.
5. Le nœud « DÉMARRER » est toujours visible et désigne l'état de départ.
6. Toutes les actions de l'éditeur sont réalisables au clavier, dans le diagramme ou dans la vue Texte.
7. Un membre non admin voit l'éditeur en lecture seule, et le serveur refuse ses écritures sur les trois nouvelles routes.
8. Les trois écrans sont lisibles dans les thèmes clair et sombre.

## 10. Hors périmètre

- Nouvelles règles de transition, migration guidée au retrait d'un état, versionnage (section 10 de la spec des workflows).
- Mise en page automatique du diagramme.
- Systèmes de workflow réutilisables.
- Thème clair par défaut de Plane : changement distinct, hors de cette livraison.
