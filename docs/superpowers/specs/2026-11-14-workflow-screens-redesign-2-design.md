# Deuxième refonte des écrans de workflows (livraison 2) : conception

- Date : 2026-11-14
- Branche : `feat/workflows` (fork `Cle0phas/plane`), avant l'ouverture de la PR 2
- Statut : en relecture
- Complète : `docs/superpowers/specs/2026-11-14-workflow-screens-redesign-design.md` (« spec de la refonte 1 »), dont elle remplace les sections 3.4, 3.6 et 6.2 et modifie les sections 3.1, 3.2, 3.7 et 3.8. Le modèle, le contrôle des transitions et les règles d'accès A1 à A5 restent ceux de `docs/superpowers/specs/2026-11-12-workflows-design.md` (« spec des workflows »), sauf le point O7 s'il est accepté.

## 1. Contexte et objectif

La refonte 1 est livrée sur la branche et testée par l'utilisateur en admin : « les workflows marchent bien ». Ses essais ont fait ressortir des manques d'ergonomie (création d'une transition, lien DÉMARRER, panneau droit, onglet du projet) et deux risques de perte de travail (deux admins sur le même workflow, sortie de l'éditeur avec un brouillon). Cette deuxième refonte les traite avant les revues finales, pour que `/qa`, `/ponytail-review` et `/security` portent sur toute la livraison 2 (D10).

Le cadrage a été mené avec l'utilisateur en trois tours ; ses décisions sont D1 à D13. Les décisions E1 à E11 sont celles que j'ai dû prendre en écrivant cette spec : elles sont à valider avec cette spec. Les points O1 à O8 étaient restés sans réponse : chacun porte une recommandation.

## 2. Décisions de cadrage (utilisateur)

| #   | Décision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Fenêtre « Ajouter une transition » : « Depuis » et « Vers » proposent d'abord les états du workflow, puis un groupe « Autres états existants » (statuts du workspace et états des projets, la source de « Ajouter un état »). Choisir un état de ce groupe l'ajoute au diagramme avec la transition. Pas de création d'un état nouveau par saisie dans cette fenêtre.                                                                                                                                            |
| D2  | Les boutons d'ajout « entrante » et « sortante » du panneau d'un état restent. Ouverte depuis un état, la fenêtre fige le champ correspondant sur cet état (« Vers » pour une entrante, « Depuis » pour une sortante). Ouverte par l'en-tête, elle ne fige rien.                                                                                                                                                                                                                                                 |
| D3  | La flèche de DÉMARRER est sélectionnable et supprimable. Sans lien : bandeau rouge « Reliez DÉMARRER à un état », « Enregistrer » inactif. On relie en tirant de DÉMARRER vers un état, par « Définir comme état de départ », ou par la liste du panneau « Départ du workflow ».                                                                                                                                                                                                                                 |
| D4  | Le premier état ajouté à un workflow vide est relié d'office à DÉMARRER.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D5  | Panneau droit redessiné selon la maquette validée (4.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D6  | Onglet Workflows du projet : le premier workflow relié est le workflow par défaut (tous les types, y compris ceux créés plus tard). « Ajouter un workflow » choisit un workflow et les types concernés, parmi les types qui ne suivent pas déjà un workflow particulier. Par ligne : « Modifier les types » et « Retirer » ; sur la ligne par défaut : « Remplacer ». « Ne plus utiliser de workflow » reste. « Changer les workflows » et l'écran à une ligne par type disparaissent. Le serveur ne change pas. |
| D7  | Deux admins sur le même workflow : (a) le serveur refuse l'enregistrement si le workflow a changé depuis l'ouverture (409), l'éditeur affiche « Ce workflow a été modifié entre-temps. Rechargez-le. » avec « Recharger » ; (b) bandeau d'information « Untel modifie aussi ce workflow », rafraîchi environ toutes les 30 secondes, sans rien bloquer. Pas de verrou.                                                                                                                                           |
| D8  | Confirmation avant de quitter l'éditeur avec un brouillon non enregistré (menu, bouton retour, fermeture de l'onglet).                                                                                                                                                                                                                                                                                                                                                                                           |
| D9  | À l'ouverture, la vue ne descend plus sous une taille lisible (texte d'environ 11 px), quitte à faire défiler ; la mini-carte sert de repère. Livré dans un commit à part, à tester par l'utilisateur avant d'être gardé.                                                                                                                                                                                                                                                                                        |
| D10 | Tout se fait sur `feat/workflows`, avant les revues et avant la PR 2.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D11 | Vue Texte : cliquer la ligne d'un état, y compris dans la colonne « Transitions », ouvre le panneau droit de cet état. Pas de bouton en plus dans le tableau.                                                                                                                                                                                                                                                                                                                                                    |
| D12 | État partagé (W17 gardé) : renommer un état utilisé par d'autres workflows demande une confirmation qui nomme les workflows touchés. Couleur et catégorie : avertissement seul. L'avertissement est reformulé et nomme les workflows. Décision provisoire, à reposer à l'utilisateur après ses essais.                                                                                                                                                                                                           |
| D13 | Pas de traduction des noms d'état dans cette livraison ; notée comme évolution.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 3. Décisions prises en écrivant cette spec (à valider)

| #   | Décision                                                                                                                                                                                                                                    | Pourquoi                                                                                                                                                                                                                 | Si c'est faux                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| E1  | Le « workflow a changé » de D7 se mesure par une empreinte du graphe (états, statuts, transitions, règles), pas par la date de modification.                                                                                                | La date ne bouge pas quand un état partagé est renommé depuis un autre workflow : un brouillon ouvert avant annulerait ce renommage sans message. L'empreinte le voit. Renommer le workflow lui-même ne bloque personne. | Revenir à la date : quelques lignes.                                                                          |
| E2  | « Untel modifie » veut dire : Untel a des changements non enregistrés sur ce workflow. Un admin qui a seulement l'éditeur ouvert n'est pas annoncé.                                                                                         | Annoncer tous ceux qui regardent donnerait de fausses alertes.                                                                                                                                                           | Annoncer dès l'ouverture : une condition à retirer.                                                           |
| E3  | La confirmation de renommage de D12 est demandée au clic sur « Enregistrer », une fois, pour tous les états partagés renommés.                                                                                                              | Le nom se modifie lettre par lettre dans le panneau ; le renommage ne prend effet qu'à l'enregistrement, c'est là que la question a un sens. L'avertissement du panneau prévient pendant la saisie.                      | La demander à la sortie du champ : la fenêtre est la même.                                                    |
| E4  | Retirer l'état de départ laisse DÉMARRER sans lien (bandeau rouge) au lieu de relier d'office le premier état restant.                                                                                                                      | Depuis D3 le lien est un choix explicite ; le déplacer en silence changerait l'état de création des tickets sans que l'admin le voie.                                                                                    | Remettre le report automatique : une ligne.                                                                   |
| E5  | Cliquer le rond DÉMARRER ouvre aussi le panneau « Départ du workflow », comme cliquer sa flèche ; la ligne « Reliez DÉMARRER à un état » du bandeau l'ouvre aussi.                                                                          | Sans lien il n'y a plus de flèche à cliquer ; il faut un accès au panneau, y compris au clavier et dans la vue Texte.                                                                                                    | Rien à défaire.                                                                                               |
| E6  | Dans le panneau d'une transition, la règle est une carte de résumé avec « Modifier » et « Retirer » ; « Modifier » ouvre la fenêtre « Ajouter une règle » existante, préremplie. Le formulaire de règle n'est plus affiché dans le panneau. | C'est la maquette validée ; un seul formulaire de règle à maintenir.                                                                                                                                                     | Réafficher le formulaire dans le panneau.                                                                     |
| E7  | Onglet du projet : « Retirer » et « Remplacer » demandent confirmation. La colonne du lien « Modifier le workflow » disparaît : le nom du workflow est déjà le lien vers l'éditeur.                                                         | Ces deux actions changent les règles des tickets tout de suite ; la maquette validée ne montre pas ce lien.                                                                                                              | Remettre le lien : une cellule.                                                                               |
| E8  | Vue Texte : cliquer le nom d'une transition continue de sélectionner cette transition ; cliquer ailleurs sur la ligne sélectionne l'état (D11).                                                                                             | La vue Texte doit rester l'équivalent complet du diagramme au clavier (spec de la refonte 1, 3.7).                                                                                                                       | Tout clic sur la ligne sélectionne l'état : les transitions ne seraient plus atteignables que par le panneau. |
| E9  | « Ajouter un état de départ », dans le panneau d'une transition, ne propose que les états du workflow.                                                                                                                                      | D1 élargit la fenêtre « Ajouter une transition », pas le panneau.                                                                                                                                                        | Proposer aussi les autres états existants.                                                                    |
| E10 | Après un refus 409, « Recharger » remplace le brouillon par le workflow enregistré : les changements locaux sont perdus. Aucune fusion.                                                                                                     | D7 : pas de verrou, pas de fusion ; c'est le comportement des documents Tchô. Le bandeau de présence (D7 b) sert à l'éviter.                                                                                             | Une fusion serait une fonctionnalité à part.                                                                  |
| E11 | D9 : quand le diagramme ne tient pas à la taille lisible, la vue s'ouvre sur DÉMARRER et l'état de départ ; après un ajout, elle se centre sur l'état ajouté. Le zoom manuel reste libre (25 % à 200 %).                                    | « Quitte à faire défiler » : il faut choisir ce qu'on montre d'abord.                                                                                                                                                    | Changer le point de départ de la vue.                                                                         |

## 4. Éditeur de workflow

Chaque sous-section donne le comportement, ses exigences de sécurité et ses critères d'acceptation (CA), tous testables.

### 4.1 Fenêtre « Ajouter une transition » (D1, D2)

Remplace la section 3.4 de la spec de la refonte 1.

- « Depuis » : une case « N'importe quel état », puis deux groupes de cases à cocher.
  - « Dans ce workflow » : les états du brouillon.
  - « Autres états existants » avec la mention « ajoutés au diagramme si cochés » : la liste de « Ajouter un état » (statuts du workspace absents du workflow, puis états proposés des projets, chaque nom une fois).
- « Vers » : une liste déroulante à sélection unique, avec les deux mêmes groupes.
- « Nom (facultatif) ». Boutons « Annuler » et « Ajouter la transition ».
- Aucune saisie ne crée un état nouveau dans cette fenêtre : cela reste le rôle de « Ajouter un état ».
- Validation : un état d'arrivée, et soit « N'importe quel état », soit au moins un état de départ ; l'état d'arrivée ne peut pas être un état de départ (sa case est désactivée) ; une transition déjà présente est refusée avec « Cette transition existe déjà. » (O2, 6.4).
- À la validation, en une seule modification du brouillon : les états choisis hors du workflow sont ajoutés à droite du dernier (règle de placement R12, dans l'ordre : états de départ puis état d'arrivée), la transition est créée, elle est sélectionnée et le panneau s'ouvre sur elle ; la vue se recale. Un état ajouté de cette façon ne devient jamais l'état de départ, sauf si le workflow était vide (D4).
- Champ figé (D2) : ouverte par « Ajouter une transition entrante » du panneau d'un état, « Vers » est un champ grisé qui affiche cet état, avec un cadenas et la mention « Fixé sur l'état sélectionné. » ; ouverte par « Ajouter une transition sortante », c'est « Depuis » qui est figé sur cet état (un seul état de départ, pas de « N'importe quel état »). Le champ figé ne peut pas être modifié. Ouverte par le bouton d'en-tête, rien n'est figé ni prérempli.

Sécurité : la fenêtre ne fait aucun appel au serveur. Les « autres états existants » viennent des deux lectures déjà chargées par l'éditeur ; la route des états proposés reste réservée aux admins du workspace (R15). Un état proposé n'est créé comme statut qu'à l'enregistrement du workflow, par le chemin existant, validé par le serveur.

Critères :

- CA-1. Cocher un état du groupe « Autres états existants » puis valider ajoute cet état au diagramme, à droite, avec la transition ; après enregistrement et rechargement, l'état et la transition sont toujours là.
- CA-2. Ouverte par « Ajouter une transition entrante » de « En revue », la fenêtre n'a aucun moyen de choisir une autre arrivée que « En revue » ; de même pour une sortante et le départ.
- CA-3. Ouverte par l'en-tête, les deux champs sont libres et vides.
- CA-4. Une transition identique à une transition existante ne peut pas être ajoutée ; le message le dit.

### 4.2 Lien DÉMARRER (D3, D4, E4, E5)

Modifie la section 3.2 de la spec de la refonte 1.

- La flèche de DÉMARRER se sélectionne (clic, ou Entrée quand elle a le focus). Sélectionnée, `Suppr` retire le lien. Le rond DÉMARRER se sélectionne de la même façon (E5). La sélection ouvre le panneau « Départ du workflow » (4.3).
- Sans lien : DÉMARRER reste affiché, sans flèche, à gauche du diagramme ; bandeau `role="alert"` « Reliez DÉMARRER à un état. » ; « Enregistrer » est inactif. Cliquer la ligne du bandeau ouvre le panneau « Départ du workflow ».
- Trois façons de relier : tirer une flèche de DÉMARRER vers un état ; « Définir comme état de départ » dans le panneau d'un état ; la liste du panneau « Départ du workflow ». Déposer l'extrémité de la flèche sur un autre état reste possible.
- Le premier état ajouté à un workflow vide est relié d'office (D4). Un état ajouté à un workflow qui a déjà des états n'est jamais relié d'office, même si le lien a été retiré.
- Retirer l'état de départ laisse DÉMARRER sans lien (E4).
- Un workflow sans aucun état s'enregistre sans lien, comme aujourd'hui (le serveur le refuse si un projet l'utilise).
- Vue Texte : la ligne « Début → <état> » devient un bouton qui ouvre le panneau « Départ du workflow ».

Sécurité : l'invariant est déjà tenu par le serveur (un état de départ exactement dès qu'il y a un état : refus `initial_state_required`, et contrainte en base) ; l'interface ne fait que l'annoncer plus tôt. Aucun changement serveur.

Critères :

- CA-5. Sélectionner la flèche de DÉMARRER et appuyer sur `Suppr` (ou « Retirer le lien » dans le panneau) retire le lien, affiche le bandeau rouge et désactive « Enregistrer ».
- CA-6. Chacune des trois façons de relier rétablit le lien, retire le bandeau et réactive « Enregistrer » si le brouillon a changé.
- CA-7. Un envoi direct au serveur d'un graphe sans état de départ est refusé (400), comme aujourd'hui.
- CA-8. Retirer l'état de départ ne déplace pas le lien vers un autre état.

### 4.3 Panneau droit (D5, E6, E9)

Remplace la section 3.6 de la spec de la refonte 1. Largeur, repli, surcouche sous 1 024 px et lecture seule inchangés.

Sans sélection : inchangé (pictogramme, titre, textes d'aide).

État sélectionné, de haut en bas :

1. En-tête : pastille de la couleur de catégorie, nom de l'état en grand, bouton de repli.
2. Champ « Nom ».
3. Sur une ligne : « Catégorie » (liste) et « Couleur de colonne » (pastille et code de la couleur).
4. Si l'état sert dans d'autres workflows, encart d'avertissement (4.5).
5. Section « Transitions entrantes · N » avec, à droite, le lien « Ajouter » (nom accessible « Ajouter une transition entrante ») ; puis une carte par transition : son nom (« Sans nom » sinon) et, dessous, son chemin (« En cours → En revue », « N'importe quel état → En revue »). Cliquer une carte sélectionne la transition.
6. Section « Transitions sortantes · N », identique, avec « Ajouter une transition sortante ».
7. Pied, séparé par un filet : « Définir comme état de départ » (remplacé par la mention « État de départ du workflow » quand il l'est déjà) et « Retirer du workflow » (rouge).

Transition sélectionnée :

1. En-tête : « Transition » en petit, nom en grand (« Sans nom » sinon), bouton de repli.
2. Champ « Nom ».
3. « Chemin » : les états de départ en pastilles, chacune avec une croix de retrait (pas de croix sur la dernière : une transition depuis des états en garde un), une flèche, l'état d'arrivée en pastille colorée. Dessous, le lien « Ajouter un état de départ » ouvre une liste des états du workflow qui ne sont ni un départ ni l'arrivée de cette transition, et qui ne créeraient pas un doublon (E9). Pour une transition globale : « N'importe quel état », flèche, arrivée ; pas de croix ni de lien d'ajout.
4. Section « Règle » : sans règle, lien « Ajouter une règle » ; avec une règle, carte « Limiter qui peut faire la transition », son résumé (« Rôles : Admin, Membre · Responsable du ticket ») et les liens « Modifier » et « Retirer ». « Ajouter » et « Modifier » ouvrent la fenêtre de règle existante sur cette transition (E6).
5. Pied : « Supprimer la transition » (rouge).

Lien DÉMARRER sélectionné : titre « Départ du workflow » ; libellé « Tout nouveau ticket commence dans l'état » et liste déroulante des états du workflow (vide tant qu'il n'y a pas de lien) ; sans lien, message rouge « Reliez DÉMARRER à un état. » ; pied « Retirer le lien », masqué sans lien.

Lecture seule (membres non admins, écrans de moins de 768 px) : mêmes contenus, champs désactivés, sans lien d'ajout, sans croix, sans « Modifier » ni « Retirer », sans pied.

Accessibilité : chaque carte est un bouton natif nommé par le nom et le chemin de la transition ; les sections sont des titres ; cibles de 44 px sous 768 px ; la couleur n'est jamais le seul signal (la catégorie est écrite).

Sécurité : le panneau ne modifie que le brouillon. En lecture seule, aucune action n'est affichée, et le serveur reste seul juge des écritures (A2).

Critères :

- CA-9. Le panneau d'un état liste ses transitions entrantes et sortantes ; cliquer une carte ouvre le panneau de cette transition.
- CA-10. Depuis le panneau d'une transition on peut retirer un état de départ (sauf le dernier), en ajouter un, ajouter, modifier et retirer la règle, supprimer la transition.
- CA-11. En lecture seule, le panneau n'offre aucune action, pour les trois sélections.
- CA-12. Le panneau « Départ du workflow » permet de choisir l'état de départ et de retirer le lien.

### 4.4 Vue Texte (D11, E8)

Modifie la section 3.7 de la spec de la refonte 1. Cliquer n'importe où sur la ligne d'un état, colonne « Transitions » comprise, sélectionne l'état et ouvre son panneau, d'où l'on crée ou modifie ses transitions. Cliquer le nom d'une transition sélectionne cette transition (E8) ; cliquer « Début → <état> » ouvre le panneau « Départ du workflow » (4.2). Aucun bouton n'est ajouté au tableau. Le clic sur la ligne est un confort de souris : au clavier, le bouton du nom de l'état reste le chemin.

Critère :

- CA-13. Un clic dans la cellule « Transitions » d'un état, hors du nom d'une transition, ouvre le panneau de cet état.

### 4.5 État partagé entre workflows (D12, E3)

- L'encart du panneau devient : « Cet état sert aussi dans 2 autres workflows : Bug, Livraison. Le renommer ou changer sa couleur ou sa catégorie les modifie aussi. » Au-delà de cinq noms : « Bug, Livraison, ... et 3 autres ». Il n'est affiché qu'à qui peut modifier.
- Au clic sur « Enregistrer », si le brouillon renomme au moins un état partagé, une fenêtre de confirmation s'ouvre : une ligne par état, « Renommer « À faire » en « Todo » le renomme aussi dans : Bug, Livraison. », boutons « Renommer partout » et « Annuler ». « Annuler » revient à l'éditeur, brouillon intact, rien n'est envoyé.
- Changer la couleur ou la catégorie d'un état partagé ne demande pas de confirmation : l'encart suffit (D12).
- Les noms viennent du serveur (6.3).

Sécurité : la confirmation est un garde-fou d'ergonomie, pas un contrôle ; le droit de modifier un statut reste celui d'un admin du workspace, vérifié par le serveur (A2). Les noms de workflows affichés sont déjà lisibles par les mêmes personnes (A1).

Critères :

- CA-14. L'encart nomme les autres workflows qui utilisent l'état.
- CA-15. Renommer un état partagé puis enregistrer ouvre la confirmation ; « Annuler » n'envoie rien ; « Renommer partout » enregistre et le nom change dans les autres workflows.
- CA-16. Renommer un état qui n'est utilisé que par ce workflow n'ouvre aucune confirmation.

### 4.6 Deux admins sur le même workflow (D7, E1, E2, E10)

Refus d'un enregistrement périmé :

- L'éditeur renvoie au serveur, avec le graphe, l'empreinte reçue à l'ouverture (6.1). Si le workflow a changé entre-temps, le serveur répond 409 et n'écrit rien.
- L'éditeur affiche alors, dans le bandeau `role="alert"` : « Ce workflow a été modifié entre-temps. Rechargez-le. » et le bouton « Recharger ». « Enregistrer » reste inactif tant que le workflow n'est pas rechargé. « Recharger » relit le workflow et les statuts et remplace le brouillon (E10).
- Après un enregistrement réussi, l'éditeur garde la nouvelle empreinte : deux enregistrements à la suite par le même admin passent.

Bandeau de présence :

- Tant qu'un admin a des changements non enregistrés sur un workflow (E2), son éditeur le signale au serveur à l'apparition du premier changement, puis toutes les 30 secondes ; il le retire à l'enregistrement, à l'annulation des changements et à la fermeture de l'éditeur (6.2).
- Tout admin qui a l'éditeur ouvert sur ce workflow interroge le serveur toutes les 30 secondes et affiche, s'il y a lieu, un bandeau `role="status"` : « Awa K. modifie aussi ce workflow. » ou « Awa K. et Koffi B. modifient aussi ce workflow. »
- Le bandeau n'empêche rien. Si l'appel échoue, il n'est pas affiché ; le refus 409 reste la garantie.
- Les lecteurs (membres non admins) ne signalent rien et ne voient pas ce bandeau.

Sécurité : section 7.

Critères :

- CA-17. Deux admins ouvrent le même workflow ; A enregistre ; l'enregistrement de B est refusé (409), rien de B n'est écrit, le bandeau et « Recharger » s'affichent ; après « Recharger », B voit le graphe de A.
- CA-18. Un état partagé renommé depuis un autre workflow rend aussi périmé le brouillon ouvert avant.
- CA-19. Renommer le workflow (nom ou description) ne rend pas un brouillon périmé.
- CA-20. Quand A a des changements non enregistrés, B voit « A modifie aussi ce workflow » en moins de 40 secondes ; le bandeau disparaît au plus 75 secondes après que A a enregistré, annulé ou quitté.
- CA-21. Un membre non admin ou un invité qui appelle la route de présence reçoit 403.

### 4.7 Quitter avec un brouillon non enregistré (D8)

Modifie la section 3.1 de la spec de la refonte 1.

- Tant que le brouillon diffère du workflow enregistré, toute navigation interne (menu, lien, bouton retour du navigateur) ouvre une fenêtre « Quitter sans enregistrer ? », texte « Les changements de ce workflow ne sont pas enregistrés. », boutons « Quitter sans enregistrer » et « Rester ». « Rester » annule la navigation.
- Fermer ou recharger l'onglet déclenche la confirmation native du navigateur (`beforeunload`), dont le texte ne dépend pas de nous.
- « Annuler les changements » ne demande pas de confirmation : c'est son objet. « Recharger » après un 409 non plus.
- Sans changement, ou en lecture seule, aucune confirmation.

Sécurité : rien côté serveur. La garde évite une perte de données involontaire ; elle ne retient aucune donnée après la sortie.

Critères :

- CA-22. Avec un changement non enregistré, cliquer un lien du menu ou le bouton retour ouvre la fenêtre ; « Rester » garde l'éditeur et le brouillon ; « Quitter sans enregistrer » navigue.
- CA-23. Sans changement, la navigation est immédiate.

### 4.8 Taille lisible des états (D9, E11)

- À l'ouverture et après l'ajout d'un état, le recalage automatique ne réduit plus la vue sous le zoom qui garde le nom des états à 11 px environ.
- Si tout le diagramme tient à cette taille ou au-dessus, il est affiché en entier, comme aujourd'hui. Sinon la vue s'ouvre sur DÉMARRER et l'état de départ (après un ajout : sur l'état ajouté), et le reste s'atteint en déplaçant le canevas ; la mini-carte montre l'ensemble.
- Le zoom manuel (molette, curseur, `+` et `-`) reste libre entre 25 % et 200 %.
- Livré dans un commit à part. L'utilisateur le teste avant qu'on le garde ; s'il ne convient pas, ce commit est annulé sans toucher au reste.

Critère :

- CA-24. Sur un workflow de vingt états en ligne, le nom des états est lisible à l'ouverture, sans action de l'utilisateur.

## 5. Onglet Workflows du projet (D6, E7)

Remplace la section 6.2 de la spec de la refonte 1. Le serveur ne change pas : l'onglet envoie toujours le système complet du projet (`default_workflow_id`, lignes type vers workflow, correspondances) aux routes existantes d'aperçu et d'application.

Projet sans workflow : texte expliquant le fonctionnement libre, bouton « Relier à un workflow ». La fenêtre « Relier à un workflow » demande un workflow et précise : « Il s'appliquera à tous les types de ticket, y compris ceux créés plus tard. »

Projet relié :

- En haut à droite : « Ajouter un workflow » et « Ne plus utiliser de workflow » (rouge, inchangé, avec sa confirmation).
- Tableau « Workflow », « Types de ticket », « Actions ». Le nom du workflow est un lien vers l'éditeur.
  - Ligne du workflow par défaut : nom, pastille « par défaut », « Tous les autres types », action « Remplacer ».
  - Une ligne par autre workflow : nom, types qui le suivent, actions « Modifier les types » et « Retirer ».
- « Ajouter un workflow » ouvre une fenêtre : liste « Workflow » (les workflows du workspace absents du tableau) ; cases « Types de ticket concernés » (les types activés dans le projet qui ne suivent pas déjà un workflow particulier) ; note qui nomme les types absents de la liste et le workflow qu'ils suivent, et rappelle qu'un type non coché reste sur le workflow par défaut. « Ajouter » demande un workflow et au moins un type. Le bouton est inactif, avec son motif écrit, quand aucun workflow ou aucun type n'est disponible.
- « Modifier les types » ouvre la même fenêtre, workflow fixé : ses types sont cochés, les types libres sont proposés ; au moins un type doit rester coché (sinon c'est « Retirer »).
- « Retirer » demande confirmation : « Retirer « Workflow anomalies » ? Bug et Incident suivront le workflow par défaut « Workflow standard ». »
- « Remplacer » ouvre une fenêtre : liste des workflows absents du tableau, puis confirmation par le bouton « Remplacer ».
- Étape de correspondance : après chaque action, l'onglet demande l'aperçu au serveur. Si des tickets doivent changer d'état, la fenêtre affiche l'étape de correspondance existante (un état d'arrivée par état concerné) avant d'appliquer ; sinon elle applique directement.
- Avant de calculer le système à envoyer, l'onglet relit le système du projet, pour partir de l'état du serveur et non d'une copie ancienne.
- Les actions ne sont affichées qu'à qui peut gérer le système du projet (admin du projet ou du workspace).
- L'écran à une ligne par type et le bouton « Changer les workflows » disparaissent.

Sécurité : aucune route nouvelle. Le serveur vérifie déjà, sur chaque écriture, le droit de gérer le projet (A4), l'appartenance des workflows et des types au workspace, l'activation des types dans le projet et la complétude de la correspondance ; l'interface ne fait que masquer les actions. Limite connue, héritée : deux personnes qui modifient le système du même projet au même moment, la dernière écrit ; la relecture avant envoi réduit la fenêtre sans la fermer.

Critères :

- CA-25. Relier un premier workflow en fait le workflow par défaut : tous les types le suivent, y compris un type activé après.
- CA-26. « Ajouter un workflow » ne propose ni un workflow déjà dans le tableau ni un type qui suit déjà un workflow particulier ; après ajout, la ligne apparaît avec ses types.
- CA-27. « Retirer » rend ses types au workflow par défaut ; « Remplacer » change le workflow par défaut ; « Modifier les types » change la liste des types d'une ligne.
- CA-28. Quand des tickets doivent changer d'état, l'étape de correspondance s'affiche et rien n'est appliqué avant sa validation.
- CA-29. Un membre qui ne peut pas gérer le projet ne voit aucune action, et le serveur refuse ses écritures (403), comme aujourd'hui.

## 6. Serveur

Tout est résolu dans le workspace de l'URL (A5). Aucune modification du contrôle des transitions des tickets.

### 6.1 Empreinte du graphe et refus 409 (D7 a, E1)

- Le détail d'un workflow (`GET`, et les réponses de création, de duplication et d'enregistrement) reçoit un champ `version` : empreinte SHA-256, en hexadécimal, du graphe (états avec leur statut, nom, couleur, catégorie, position, état de départ ; transitions avec leurs sources, côtés, cible, nom, règles). Le nom et la description du workflow n'en font pas partie.
- `PUT /api/workspaces/<slug>/workflows/<id>/graph/` exige un champ `expected_version` (chaîne de 64 caractères hexadécimaux). Absent ou mal formé : 400.
- Le serveur verrouille le workflow et les statuts cités, recalcule l'empreinte, et la compare. Différente : réponse 409 `{ "graph": ["stale_graph"] }`, rien n'est écrit, aucune entrée d'audit.
- La création depuis un projet et la duplication n'envoient pas d'empreinte : elles écrivent un workflow qu'elles viennent de créer.
- L'empreinte n'est ni un secret ni un droit : elle ne remplace aucun contrôle d'accès.

### 6.2 Présence (D7 b, E2)

`POST /api/workspaces/<slug>/workflows/<id>/presence/`, admins du workspace. Corps `{ "editing": true | false }` (booléen JSON strict, sinon 400).

- `editing: true` enregistre pour 75 secondes que l'utilisateur de la session modifie ce workflow ; `false` l'efface.
- Réponse 200 `{ "editors": [{ "id", "display_name" }] }` : les autres admins actifs du workspace qui ont un signal en cours sur ce workflow, triés par nom, dix au plus.
- Stockage : le cache Redis de l'application (une clé par workflow et par utilisateur, avec expiration). Aucune table, aucune migration, rien dans le journal d'audit : c'est une information éphémère, pas une action de configuration.
- L'identité vient de la session, jamais du corps. Un workflow absent ou d'un autre workspace : 404.

### 6.3 Workflows qui utilisent un statut (D12)

`GET /api/workspaces/<slug>/workflow-statuses/` : chaque statut reçoit `workflows`, liste de `{ id, name }` des workflows qui l'utilisent, triée par nom. `workflow_count` reste. Lecture ouverte aux mêmes rôles que la liste des workflows, qui donne déjà ces noms (A1).

### 6.4 Transition en double (O2)

Le serveur refuse (400, `{ "graph": ["duplicate_transition"] }`) un graphe où deux transitions ont la même cible et, soit sont toutes deux globales, soit ont un état de départ en commun. Une transition globale et une transition depuis un état vers la même cible ne sont pas un doublon (leurs règles peuvent différer). L'éditeur applique la même règle avant l'envoi (bandeau, tracé à la souris sans effet, fenêtre et panneau qui ne proposent pas le doublon). Un workflow existant qui contient déjà un doublon reste lisible ; son prochain enregistrement demande de retirer le doublon, que le bandeau désigne.

### 6.5 Contrainte en base sur les côtés des flèches (O1)

Une contrainte de vérification sur `WorkflowTransitionSource` limite `source_side` et `target_side` à la chaîne vide et aux quatre côtés. Migration `0131`, avec la mise à jour de `migrations_lockfile.txt`.

### 6.6 Lecture des workflows par les invités (O7, si accepté)

Les routes de lecture `GET workflows/`, `GET workflows/<id>/` et `GET workflow-statuses/` passent de « admin, membre, invité » à « admin, membre ». La lecture du système d'un projet ne change pas (les écrans de tickets en ont besoin). L'éditeur affiche « non autorisé » à un invité.

## 7. Points ouverts : recommandations

| #   | Point                                                             | Recommandation                                                                                                                                                                                                               | Coût si on ne le fait pas                                                                                              |
| --- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| O1  | Contrainte en base sur les côtés des flèches (M7).                | La faire (6.5). Défense en profondeur ; la duplication écrit sans repasser par le validateur.                                                                                                                                | Une valeur fausse en base ne serait arrêtée que par le code.                                                           |
| O2  | Refuser une transition en double (M6).                            | La refuser, côté éditeur et côté serveur (6.4). Deux transitions identiques avec des règles différentes rendent le contrôle ambigu.                                                                                          | Des flèches superposées, invisibles, aux règles contradictoires.                                                       |
| O3  | Trois requêtes par transition à l'enregistrement (M13, hérité).   | Ne pas le faire dans cette livraison ; le noter dans la description de la PR 2. Aucun workflow réel n'approche la borne de 1 000 transitions.                                                                                | Enregistrement lent d'un workflow à la borne.                                                                          |
| O4  | Recalcul des nœuds à chaque image d'un glisser (M3).              | Ne pas le faire ; même note. Mesuré : gênant seulement vers 200 états.                                                                                                                                                       | Glisser saccadé sur un très grand workflow.                                                                            |
| O5  | Consignes clavier intégrées de React Flow en anglais.             | Les traduire (`ariaLabelConfig`, quelques clés dans les 22 langues) : « tout texte passe par les traductions » est une règle de la livraison.                                                                                | Lecteurs d'écran en anglais dans le diagramme.                                                                         |
| O6  | Onglet du projet réservé à qui peut gérer le système.             | Le garder réservé. Personne ne l'a demandé en lecture, et les paramètres d'un projet sont réservés à ses admins dans Plane.                                                                                                  | Un membre ne voit pas quel workflow suit son projet autrement que par les états de ses tickets.                        |
| O7  | Éditeur en lecture seule ouvert aux membres et aux invités.       | Exclure les invités (6.6). Un invité est un compte extérieur, limité à quelques projets ; aujourd'hui il peut lire tous les workflows du workspace, donc des noms d'états repris de projets privés (R15). Moindre privilège. | Divulgation de noms d'états de projets privés à des comptes extérieurs. À confirmer par `/security` dans les deux cas. |
| O8  | Libellé « Ne plus utiliser de workflow » au lieu de « Détacher ». | Garder « Ne plus utiliser de workflow » : c'est le libellé de la maquette validée par l'utilisateur (D6).                                                                                                                    | Rien.                                                                                                                  |

## 8. Sécurité (STRIDE)

Ce qui change côté serveur : 6.1 à 6.6.

| Menace                  | Cas                                                                                                                                                          | Mesure                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usurpation              | Signaler la présence d'un autre, enregistrer au nom d'un autre                                                                                               | L'identité vient de la session ; aucun identifiant d'utilisateur n'est lu dans le corps                                                                                                                                                                         |
| Altération              | Empreinte forgée ou rejouée pour écraser le travail d'un autre ; valeur de côté écrite hors du validateur ; transitions en double aux règles contradictoires | L'empreinte est recalculée par le serveur sous verrou et comparée, elle n'accorde aucun droit ; l'écriture reste réservée aux admins ; contrainte en base (6.5) ; refus des doublons (6.4)                                                                      |
| Répudiation             | Nier un enregistrement                                                                                                                                       | Journal d'audit existant (`workflow.graph_updated`) ; un refus 409 n'écrit rien, donc rien à tracer ; la présence est éphémère et n'est pas une action de configuration                                                                                         |
| Divulgation             | Lire qui modifie quoi ; lire les noms des workflows qui partagent un statut ; lecture par des invités                                                        | Présence réservée aux admins du workspace, limitée au nom affiché d'autres admins du même workspace ; les noms de workflows sont déjà lisibles par les mêmes rôles (A1) ; O7 retire les invités ; 404 identique pour un workflow absent ou d'un autre workspace |
| Déni de service         | Signaux de présence en rafale, empreinte coûteuse, liste des workflows par statut                                                                            | Une clé de cache par admin et par workflow, expiration de 75 secondes, réponse limitée à dix noms ; l'empreinte se calcule sur un graphe déjà borné (200 états, 1 000 transitions) et déjà lu pour l'audit ; la liste par statut se lit en une requête de plus  |
| Élévation de privilèges | Un membre ou un invité signale sa présence, enregistre, ou contourne la confirmation de renommage                                                            | Rôle admin du workspace vérifié côté serveur sur la présence et l'enregistrement ; la confirmation, le champ figé, la garde de sortie et le masquage des actions sont du confort, jamais un contrôle                                                            |

Données : aucune donnée personnelle nouvelle n'est stockée ; la présence garde un identifiant d'utilisateur 75 secondes dans le Redis interne. Aucun appel sortant, aucun secret, rien dans les journaux. En cas d'échec, tout se ferme : sans empreinte valide l'enregistrement est refusé ; sans réponse de présence le bandeau est absent et le 409 protège.

## 9. Tests

Écrits avant le code.

- Serveur, droits : la route de présence, et l'enregistrement du graphe avec empreinte, joués par admin du workspace, admin du projet, membre, invité, non-membre, utilisateur d'un autre workspace. Si O7 est accepté : les trois lectures refusées à l'invité, permises au membre.
- Serveur, contenu :
  - 6.1 : empreinte stable d'une lecture à l'autre ; elle change avec un état, une position, une transition, une règle, un statut renommé depuis un autre workflow ; elle ne change pas quand le workflow est renommé ; empreinte absente ou mal formée (400) ; empreinte périmée (409, rien d'écrit, pas d'audit) ; deux enregistrements à la suite ; création depuis un projet et duplication sans empreinte.
  - 6.2 : signal posé, vu par un autre admin et pas par soi ; effacé par `false` ; expiré ; workflow d'un autre workspace (404) ; corps non booléen (400) ; limite de dix ; un admin désactivé n'est plus listé.
  - 6.3 : noms des workflows d'un statut, triés ; statut inutilisé.
  - 6.4 : deux globales vers la même cible ; source commune ; globale et nommée vers la même cible acceptées.
  - 6.5 : la base refuse une valeur hors liste.
- Web, logique (vitest) : ajout d'une transition avec des états hors workflow (placement, pas d'état de départ imposé) ; retrait et pose du lien DÉMARRER, validation et cible de l'erreur ; retrait de l'état de départ sans report ; détection des doublons ; états partagés renommés ; lignes de la vue Texte ; calculs du système du projet (ajouter, modifier les types, retirer, remplacer, types libres, workflows disponibles) ; choix de la vue lisible.
- Web, affichage (vitest avec `jsdom`) : fenêtre de transition (groupes, champ figé, doublon) ; panneau (état, transition, départ, lecture seule) ; sélection et retrait de la flèche de DÉMARRER ; clic sur une ligne de la vue Texte ; refus 409 et « Recharger » ; bandeau de présence ; confirmation de renommage ; garde de sortie ; onglet du projet (tableau, fenêtres, correspondance, actions masquées).
- Avant fusion : `pnpm check`, suite pytest complète, tests web `unit` et `dom`, synchronisation des 22 langues, parcours manuel des sections 4 et 5 avec les quatre rôles, `/qa`, `/ponytail-review`, `/security`.

## 10. Textes

Tout nouveau texte passe par `packages/i18n` : anglais et français écrits dans le plan, les vingt autres langues avec le skill `translate`. Les textes non relus par un locuteur natif sont marqués `machine_translated` dans la description de la PR 2. En français on dit « ticket ».

## 11. Hors périmètre et évolutions notées

- Traduction des noms d'état, un nom par langue (D13).
- Fusion de deux brouillons concurrents, verrou d'édition.
- Refus de l'écriture concurrente du système d'un projet.
- O3 et O4 (performances à la borne).
- Renommage d'un état partagé : la décision D12 est provisoire ; à reposer à l'utilisateur après ses essais (interdire le renommage partagé, ou le garder avec confirmation).
- Points de la refonte 1 laissés en l'état : ordre de tabulation flèches puis états, libellés français « N'importe lequel », « Tous les états », « Début ».
