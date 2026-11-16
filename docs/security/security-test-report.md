# Rapport de test de sécurité

| Champ     | Valeur                                                 |
| --------- | ------------------------------------------------------ |
| Projet    | Fork de Plane (Cle0phas/plane), workflows, livraison 2 |
| Version   | 0.2                                                    |
| Date      | 2026-11-16                                             |
| Auteur    | Équipe sécurité (asin-harness /security)               |
| Phase ADM | Mise en œuvre et opérationnalisation                   |

Ce rapport remplace celui de la livraison 1 (types de ticket, 2026-11-12), qui reste dans l'historique git (commit `9438110fa2`).

## 1. Périmètre

- Branche testée : `feat/workflows`, commit `bf60153709`, comparée à sa base `525e4c9732` sur `feat/work-item-types` (diff de la branche uniquement : 147 fichiers de code, 145 commits).
- Composants couverts : les routes des statuts et des workflows du workspace (lecture, création, modification, suppression, graphe, copie), la route de présence, les routes du système de workflows d'un projet (lecture, écriture, retrait, aperçu), le contrôle des transitions sur chaque chemin d'écriture de l'état d'un ticket (application web, API publique v1, intake, conversion de brouillon, garde du modèle), le refus de modifier les états d'un projet géré par un workflow, les écritures système sans acteur (application d'un système, synchronisation, clôture automatique), le rendu des données dans le client web, les migrations 0129 à 0131.
- Composants exclus : l'authentification existante de Plane (session, clés d'API, CSRF, cookies), non modifiée par la branche ; le reste du dépôt hors diff.
- Entrées de référence : le fork n'a pas de `docs/architecture/dat.md` (pas de matrice d'autorisation section 5 ni de dépendances externes déclarées), pas de `docs/architecture/api.md` ni de `docs/specs/sfd.md`. Les règles d'accès servant de contrat sont celles des specs : `docs/superpowers/specs/2026-11-12-workflows-design.md` (A1 à A5, section 8 STRIDE) et `docs/superpowers/specs/2026-11-14-workflow-screens-redesign-2-design.md` (O7, sections 6 et 8). Le `CLAUDE.md` du projet ne déclare pas de registre Harbor.
- Exceptions acceptées par les specs, non comptées comme constats : l'écriture concurrente du système d'un projet (la dernière l'emporte) ; un admin de projet peut contourner « limiter qui » en retirant puis en remettant le système (règles A4 et T6, tracé par l'audit) ; la route de présence sans limite de débit propre.

## 2. Méthode

- Méthode security-audit de Cloudflare (vendorisée dans le harnais ASIN), profil `quick` limité au diff : reconnaissance (4 agents), une vague de recherche (6 agents), un passage du critique de couverture, un vérificateur indépendant par candidat (4).
- Classes retenues : `ATTACK-CLASSES.md` (Access control, Business logic, Injection, Feature abuse and data leakage, Chained vulnerabilities and trust boundaries), `DATA-ISOLATION-AND-LIFECYCLE.md`, `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md`, `WEB-PROTOCOL-AND-AUTH.md` (Ordinary CSRF, API-key scope and resource binding), et les compagnons ASIN `ASIN-IAM-XROAD.md#Missing or inconsistent authorisation` et `ASIN-SOVEREIGNTY.md#Personal data in logs or telemetry` et `#Data leaving the perimeter`. L'application n'utilise ni Keycloak ni X-Road : aucun constat n'est tiré de ces classes.
- Conteneur : aucun code de la cible n'a été exécuté. Le bac à sable (`sandbox-run.sh` : réseau coupé, environnement vide, cible en lecture seule) ne fournit pas PostgreSQL, et tous les tests de la fonctionnalité en dépendent. L'image du projet disponible localement était `wfr2-fix-api-tests:latest` (`sha256:3785e7309ba1665e66c8dffc0a79fc97b52c2b5f25a4e35b27b38c4c03da38ac`) ; elle n'a pas servi. Toutes les preuves sont donc des lectures du code source, ce qui interdit le statut « confirmé » : un candidat fondé reste « à valider ».
- Écart à la méthode : les blocs de classes d'attaque et de règles ont été désignés aux agents par fichier et par nom, avec obligation de les lire tels quels, au lieu d'être recopiés dans chaque consigne.
- Dossier d'exécution (non versionné) : `docs/security/runs/2026-11-16-diff-1/`.
- Validateurs : `validate-findings.cjs` : `PASS: 4 findings valid` ; `validate-coverage-ledger.cjs` : `PASS: 21 coverage units valid`.

## 3. Verdict

- Verdict global : **conforme** au sens de la méthode (aucun constat confirmé), **avec un candidat à valider de priorité haute** (section 5) : s'il se confirme, une règle « limiter qui » peut être contournée par un membre du projet. La décision de fusion doit en tenir compte.
- Verdict souveraineté : **conforme**. La livraison n'ajoute aucun appel sortant, aucune télémétrie, aucun secret, aucune image ; le journal d'audit et l'historique ne contiennent que des identifiants techniques et des noms saisis par les admins. Hors périmètre, à traiter avant toute mise en service : la télémétrie d'origine de Plane (section 7, HORS-001).
- Verdict IAM : **conforme**. Chaque route vérifie le rôle côté serveur, le rôle est relu en base à chaque requête, aucune écriture n'est décidée par la seule interface, tout objet est résolu dans le workspace de l'URL.
- Constats par sévérité : critical 0, high 0, medium 0, low 0, informational 0. Un candidat à valider, trois rejetés.
- Couverture : **partielle**. Audit `quick` limité au diff : 13 unités couvertes, 3 unités avec candidats, 3 unités reportées (aucune seconde vague dans ce profil) et 2 unités hors périmètre. Unités reportées :
  1. le retrait d'un type de ticket d'un projet, ou sa suppression, qui change le workflow effectif des tickets sans passer par la garde ;
  2. la logique de l'enregistrement du graphe, de la copie et de la suppression d'un workflow sous concurrence (lecture sans verrou de l'état par la garde pendant un enregistrement) ;
  3. le cycle de vie des projets et des membres face au système (projet archivé ou supprimé dans les comptes d'usage et la lecture du système).
     Aucun registre précédent compatible n'existait pour ce code.

## 4. Constats

Aucun constat confirmé.

## 5. À valider

**VAL-001. Un aller-retour de type par un workflow plus souple place un ticket dans un statut que son propre workflow restreint.** Fichiers : `apps/api/plane/utils/workflows.py` (résolution de l'état lors d'un changement de type), `apps/api/plane/db/models/issue.py` (garde du modèle).

- Ce qui est établi par la lecture du code : quand un changement de type fait passer un ticket à un autre workflow, l'état actuel est gardé s'il existe dans le nouveau workflow, sans contrôle de flèche ni de règle (c'est la règle W9 de la spec). Quand deux workflows d'un même projet partagent des statuts, un membre qui peut modifier le ticket peut le passer au type qui suit le workflow le plus souple, y faire avancer le ticket par une flèche sans règle, puis revenir au type d'origine : l'état est gardé, et le ticket se retrouve dans un statut que le workflow d'origine réserve à d'autres. La spec dit que le changement de type ne doit contourner ni les flèches ni « limiter qui » (W9) ; cette combinaison n'y est pas couverte.
- Ce qui manque pour confirmer : l'observation du résultat. Le bac à sable de l'audit n'a pas de base de données.
- Ce qui le déciderait : un test de contrat, sur la pile de test isolée du projet et des données factices, avec deux workflows partageant deux statuts dont l'un restreint le passage de l'un à l'autre. Comportement sûr : le ticket ne finit jamais dans le statut restreint sous son type d'origine sans que l'acteur y ait droit. À rejouer par l'API publique v1.
- Variante écartée : le simple retour à l'état initial par aller-retour de type est le comportement que W9 spécifie.

Candidats rejetés : 3.

- La lecture du système d'un projet par tout membre ou invité du workspace, sans appartenance au projet : le code applique la règle A3 et la section 6.6 des specs validées ; c'est une décision de conception et non une faille. Elle contredit toutefois la raison de la décision O7 : voir DEC-001 en section 7.
- La liste des workflows sans plafond avec des requêtes par ligne, et l'envoi d'une tâche par ticket déplacé lors d'un changement de système : seuls des administrateurs peuvent les déclencher, dans leur propre périmètre ; ce sont des améliorations de performance (section 7).

## 6. Points vérifiés sans anomalie

- Autorisation des routes du workspace : toutes les écritures (suppression d'un statut, création, modification et suppression d'un workflow, graphe, copie, présence) sont réservées aux admins par le décorateur de chaque méthode ; les lectures des workflows et des statuts sont ouvertes aux admins et aux membres, fermées aux invités ; la liste des noms d'états candidats est réservée aux admins.
- Autorisation des routes du système d'un projet : écriture, retrait et aperçu passent d'abord par le contrôle « admin du workspace ou admin du projet » ; un invité ne peut pas être admin de projet.
- Isolation par workspace : tout objet est lu dans le workspace de l'URL ; les workflows d'un système, les statuts d'un graphe et les utilisateurs nommés dans une règle sont revérifiés dans ce workspace ; réponse 404 identique pour un objet absent ou étranger.
- Session et CSRF : les nouvelles routes héritent de l'authentification par session et du contrôle d'origine sur les méthodes d'écriture.
- Garde des transitions : appelée sur chaque chemin d'écriture de l'état (application web, API v1, intake, conversion de brouillon), doublée par une garde du modèle ; l'acteur vient de la requête ; les règles s'évaluent avec le rôle de projet ; type de règle inconnu ou acteur absent : refus.
- États d'un projet géré : création, modification, suppression et choix de l'état par défaut refusés sur les routes de l'application et de l'API v1.
- Écritures système : les déplacements d'un changement de système sont validés contre le nouveau workflow et tracés ; la clôture automatique ne suit qu'une transition globale sans règle.
- Entrées : graphe validé et borné (200 états, 1 000 transitions, 1 000 statuts par workspace, une règle par transition, 200 utilisateurs par règle), identifiants stricts, couleur par expression régulière ; aucune requête SQL brute.
- Rendu : aucune insertion de HTML, liens construits à partir d'identifiants, textes du serveur rendus comme du texte.
- Migrations 0129 à 0131 : schéma seulement, contraintes uniques conditionnées à la suppression logique, pas de migration de données.
- Présence : clé de cache construite à partir d'identifiants du serveur, 75 secondes ; seuls les admins actifs sont listés.
- Journaux et audit : écriture de l'audit dans la transaction de chaque changement ; ni nom ni courriel dans les entrées ; aucune route ne relit le journal d'audit.

## 7. Plan de remédiation

Aucune tâche de sécurité bloquante au sens de la méthode : aucun constat critical, high ou medium confirmé.

À traiter avant fusion ou à décider par le propriétaire :

| Réf.     | Test de non-régression                                                                                                                                                           | Correctif minimal                                                                                                                                                                                                                 | Bloquant                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| VAL-001  | Deux workflows partageant deux statuts, l'un restreignant le passage ; un membre non autorisé ne peut pas amener le ticket dans le statut restreint par deux changements de type | Lors d'un changement de type vers un autre workflow, ne garder l'état que si l'acteur a le droit d'y entrer selon le nouveau workflow (état initial, ou flèche entrante dont les règles l'admettent) ; sinon poser l'état initial | Oui, si le test confirme    |
| DEC-001  | Un membre et un invité du workspace qui ne sont pas membres d'un projet privé reçoivent 403 à la lecture de son système                                                          | Exiger l'appartenance au projet ou le rôle d'admin du workspace pour lire le système d'un projet (change la règle A3)                                                                                                             | Décision du propriétaire    |
| HORS-001 | Vérifier dans le déploiement que l'export de télémétrie est coupé                                                                                                                | Code d'origine de Plane, hors diff : l'export de métriques d'instance est actif par défaut vers un hôte externe ; le couper par la configuration avant toute mise en service                                                      | Oui pour la mise en service |

Durcissements recommandés, non bloquants :

| Réf.     | Sujet                                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DUR-001  | Vérifier l'appartenance active au projet au début de l'évaluation des règles (défense en profondeur ; aujourd'hui garantie par les routes appelantes)             |
| DUR-002  | Nettoyer les utilisateurs nommés dans une règle quand un membre quitte le workspace (sinon l'enregistrement suivant du graphe est refusé)                         |
| DUR-003  | Ne renvoyer les identifiants d'utilisateurs des règles qu'aux admins dans les lectures des workflows et du système                                                |
| DUR-004  | Filtrer aussi par workspace la lecture des workflows d'un système (défense en profondeur)                                                                         |
| DUR-005  | Compter et précharger les projets dans la liste des workflows ; plafonner ou paginer                                                                              |
| DUR-006  | Envoyer l'historique des tickets déplacés par lot, et ne journaliser qu'une erreur avec le nombre d'échecs                                                        |
| DUR-007  | Limite de débit par utilisateur sur la route de présence et sur les écritures lourdes (graphe, système)                                                           |
| DUR-008  | Borner la taille des entrées d'audit (graphe complet avant et après à chaque enregistrement)                                                                      |
| DUR-009  | Dire dans l'aide de la règle « personne assignée » qu'un membre pouvant s'assigner peut ensuite passer la règle                                                   |
| DUR-010  | Compter aussi les rôles « membre hors projet » et « invité hors projet » dans les matrices de tests du système                                                    |
| DUR-011  | Réunir les règles d'accès (A1 à A5, O7, présence, aperçu) dans une seule matrice, une ligne par route                                                             |
| DUR-012  | Pointer `.npmrc` vers un miroir npm interne quand l'ASIN en fournit un ; prendre une décision explicite sur le lien d'attribution de la bibliothèque de diagramme |
| COUV-001 | Seconde passe d'audit, profil `standard`, sur les 3 unités reportées                                                                                              |
