# Workflows : liste et vue Texte proches de Jira

- Date : 2026-11-17
- Branche : `feat/workflows-jira-ui`, partie de `preview`
- Source : brief « Refonte UI des Workflows (rendu proche de Jira) » et ses trois maquettes HTML, fournis par l'utilisateur le 2026-11-17, puis décisions prises avec lui le même jour (section 2)
- Dépend de : `2026-11-12-workflows-design.md`, `2026-11-14-workflow-screens-redesign-2-design.md`

## 1. Objectif

Rapprocher de Jira la page Paramètres du workspace > Workflows et la vue Texte de l'éditeur : une liste qui montre d'un coup d'oeil les états de chaque workflow, et un tableau des transitions où chaque état affiche toutes les transitions qui le touchent. Le comportement métier, les droits et le panneau latéral d'édition ne changent pas.

## 2. Décisions

| Réf. | Décision                                                                                                                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1   | La liste reçoit du serveur, en lecture seule et avec les mêmes droits qu'aujourd'hui, les états de chaque workflow dans l'ordre du flux (nom, catégorie) et son nombre de transitions. Écart assumé au brief (« aucune modification d'API ») : sans cela, l'aperçu demanderait une requête par ligne. |
| J2   | Cinq catégories de couleur, tirées des jetons du thème (contraste tenu en thème clair et sombre), pas des couleurs fixes du brief.                                                                                                                                                                    |
| J3   | Dans la vue Texte, le badge d'un état reste un bouton qui ouvre le panneau de l'état.                                                                                                                                                                                                                 |
| J4   | Le switch Diagramme / Texte reste au-dessus du contenu, au même endroit dans les deux vues ; l'en-tête de la colonne du tableau affiche « État ».                                                                                                                                                     |
| J5   | L'en-tête de l'éditeur garde les trois boutons d'ajout (état, transition, règle) ; pas de menu « Ajouter ». « Fermer » devient « Annuler les modifications » tant qu'il reste des modifications non enregistrées, comme aujourd'hui.                                                                  |
| J6   | Une transition à plusieurs sources donne une sous-ligne par route ; une boucle A vers A donne une seule sous-ligne.                                                                                                                                                                                   |
| J7   | Hors périmètre : indicateur « à nommer », export JSON, identifiants lisibles, modification de la description dans l'éditeur.                                                                                                                                                                          |
| J8   | La colonne Description quitte la liste. La description reste visible : icône « i » à côté du nom dans la liste (infobulle au survol et au focus), et ligne grise sous le titre dans l'éditeur.                                                                                                        |

## 3. Badge d'état partagé (`StateLozenge`)

Un composant de `apps/web/components/workflow/` utilisé par la liste, la vue Texte, et par le panneau latéral et le diagramme pour leurs couleurs.

- Props : `name`, `group` (backlog, unstarted, started, completed, cancelled). La catégorie est aussi écrite dans le `title` du badge.
- Style : texte en majuscules, petite taille en gras, `whitespace-nowrap`, coins légèrement arrondis, `padding` 2px 6px.
- Couleurs (J2), déclarées une seule fois dans `tones.ts` :

| Catégorie    | Rendu                                                |
| ------------ | ---------------------------------------------------- |
| Backlog      | fond de la surface, bord pointillé, texte secondaire |
| Non commencé | fond neutre, texte secondaire                        |
| En cours     | teinte « info »                                      |
| Terminé      | teinte « succès »                                    |
| Annulé       | teinte « danger »                                    |

- Pas de variantes « Création » ni « Tous les états » (révisé le 2026-11-17) : la vue Texte écrit « Début » et « Tous les états » en texte simple, et aucun autre écran n'en a besoin.
- La teinte Backlog distincte s'applique aussi aux noeuds du diagramme : aujourd'hui Backlog et Non commencé partagent une teinte.

## 4. Liste des workflows

### 4.1 Données (J1)

`GET /api/workspaces/<slug>/workflows/` ajoute à chaque workflow :

- `states` : liste de `{ "name", "group" }` dans l'ordre du graphe (`created_at`, `id`), le même que l'éditeur et que les colonnes d'un projet nouvellement relié ;
- `transition_count` : nombre de transitions.

Droits inchangés : admins et membres du workspace (A1). Les noms d'états sont déjà lisibles par ces rôles via le détail d'un workflow. La lecture reste bornée (200 états par workflow). Les états et le nombre de transitions n'ajoutent aucune requête par workflow ; le compte des projets d'une ligne (`_projects`) en coûtait déjà une ou deux, hors périmètre.

### 4.2 Écran

- Barre d'outils : champ « Rechercher un workflow » (sur le nom, sans tenir compte de la casse), filtre « Utilisation : Tous / Utilisés / Non utilisés », compteur « N workflows » du résultat filtré. Filtrage côté navigateur.
- Colonnes : Nom, Aperçu des états, Utilisé dans, Modifié le, Actions (admins seulement, comme aujourd'hui).
- Nom : lien vers l'éditeur, icône « i » si une description existe (J8), puis « X états · Y transitions » et une barre de 4px répartie par catégorie, largeur proportionnelle au nombre d'états. Badge « Vide » si le workflow n'a aucun état.
- Aperçu : les cinq premiers badges dans l'ordre du flux séparés par « → », puis une puce « +N ». Sans état : « Aucun état » et un lien « ajouter un premier état » vers l'éditeur (admins ; texte seul pour un membre).
- Utilisé dans : puce « N projets » ; les noms des projets s'affichent en infobulle pour les admins (P6). « Non utilisé » si aucun projet.
- Modifié le : date courte du format existant (`renderFormattedDate`).
- Actions : lien « Modifier » et bouton « ⋯ » (`aria-label` « Plus d'actions pour {nom} ») ouvrant un menu Dupliquer, Supprimer. Supprimer est désactivé pour un workflow utilisé, avec la raison « Utilisé par N projets » en ligne grise de l'entrée du menu (révisé le 2026-11-17 : une entrée désactivée ne reçoit ni survol ni focus de façon fiable) ; le texte d'aide sous la ligne disparaît. La confirmation de suppression et la duplication restent celles d'aujourd'hui.
- Aucun workflow : le message vide actuel. Aucun résultat après filtre : « Aucun workflow ne correspond ».

## 5. Éditeur

### 5.1 En-tête (J5, J8)

- Ligne 1 : fil d'Ariane « Workflows / {nom} », le premier élément renvoie à la liste.
- Ligne 2 : titre, puis « Utilisé dans N projets » (liste des projets au clic pour les admins, comme aujourd'hui).
- Ligne 3 : description en gris, deux lignes au plus, texte complet au survol ; absente si vide.
- À droite : les trois boutons d'ajout, puis Fermer (ou Annuler les modifications) et Enregistrer, inchangés. Pas de bandeau de compteurs ni de champ de filtre.

### 5.2 Vue Texte

Seule la structure du tableau change ; le panneau latéral reste celui d'aujourd'hui.

- Tableau `table-fixed`, bordures verticales entre colonnes, dans un conteneur à défilement horizontal. Colonnes : chevron (48px), État (environ 32 %), Transitions (le reste).
- Une ligne par état, dans l'ordre du graphe. Le chevron replie ou déplie les transitions de l'état (`aria-expanded`). Toutes les lignes sont dépliées à l'ouverture.
- Cellule État : badge (bouton, J3), et « État initial » en petit texte gris pour l'état initial. Sous le badge, la catégorie en petit texte gris, pour que la couleur ne soit pas le seul signal (WCAG 1.4.1, ajouté le 2026-11-17). Elle reste alignée en haut sur toute la hauteur de la ligne.
- Cellule Transitions : une sous-ligne par transition qui touche l'état, séparées par une bordure, dans cet ordre :
  1. l'arrivée depuis le début, si l'état est initial ;
  2. les transitions globales vers cet état ;
  3. les transitions entrantes, une par source (J6) ;
  4. les transitions sortantes, une par cible.
- Une transition A vers B apparaît dans la ligne de A et dans celle de B. Une globale et l'arrivée depuis le début n'apparaissent que dans la ligne de leur cible. Une boucle A vers A n'apparaît qu'une fois dans la ligne de A.
- Sous-ligne : un `<button>` sur deux lignes de texte.
  - Ligne 1 : icône de 12px pour l'arrivée depuis le début (cercle) ou une globale (étoile), puis le nom en gras. Sans nom : « Sans nom » en italique gris.
  - Ligne 2 : source, flèche, cible. La source est un badge, ou le texte « Début » ou « Tous les états » ; la cible est un badge.
  - Clic : sélection (fond accentué, liseré gauche de 2px, `aria-pressed`) et ouverture du panneau latéral sur cette transition, ou sur le début pour l'arrivée depuis le début. Toutes les sous-lignes d'une même transition sont marquées sélectionnées.
- Sous le tableau : légende des deux icônes et « Clic sur une transition : édition dans le panneau latéral ».
- Workflow sans état : le message vide actuel.

## 6. Textes et accessibilité

- Toutes les chaînes passent par `packages/i18n`, en anglais (référence) et en français (fourni par le brief), les deux seules langues livrées depuis le 2026-11-17 ; le français est la langue par défaut.
- Vrais boutons partout ; `aria-label` sur les boutons icône ; contraste du texte d'au moins 4,5:1 dans les deux thèmes ; tableaux dans un conteneur à défilement horizontal ; boutons de l'en-tête qui passent à la ligne sur petit écran. Cibles tactiles de 44px sous 768px, comme le reste de l'éditeur.

## 7. Sécurité

Seule la réponse de lecture de la liste change (4.1) : mêmes rôles, mêmes données que le détail d'un workflow déjà ouvert à ces rôles, aucune donnée de projet nouvelle (les noms de projets restent réservés aux admins). Aucune écriture, aucun nouveau point d'entrée, rien dans les journaux. Les filtres et la recherche sont faits dans le navigateur sur des données déjà reçues. `/security` sera décidé par l'utilisateur pour la fonctionnalité entière.

## 8. Critères d'acceptation

1. Une transition globale et l'arrivée depuis le début n'apparaissent que dans la ligne de leur cible.
2. Chaque transition A vers B apparaît exactement dans la ligne de A et dans celle de B ; un état affiche toutes ses transitions, quel qu'en soit le nombre.
3. Cliquer une sous-ligne sélectionne la transition et ouvre le panneau latéral existant ; cliquer le badge d'un état ouvre le panneau de l'état.
4. La suppression d'un workflow utilisé reste impossible, avec la raison affichée dans le menu.
5. La liste montre, sans requête par ligne, l'aperçu des états et le nombre de transitions de chaque workflow.
6. La description reste lisible depuis la liste et depuis l'éditeur.
7. Aucun changement de schéma, de droits ni de comportement métier.

## 9. Tests

- Serveur : tests de contrat de la liste (`states` dans l'ordre du graphe, `transition_count`, droits inchangés pour admin, membre, invité, non-membre ; aucune requête de plus par workflow pour les états et les transitions).
- Web : tests unitaires de la construction des lignes de la vue Texte (ordre, doublons, boucles, sources multiples) ; tests de composants de la liste (recherche, filtre, compteur, aperçu limité à cinq, badge Vide, menu et suppression désactivée), de la vue Texte (sélection, repli, badge d'état) et de l'en-tête (fil d'Ariane, description).
- Vérification à l'écran sur le serveur de développement, thème clair et sombre, largeur bureau et mobile.
