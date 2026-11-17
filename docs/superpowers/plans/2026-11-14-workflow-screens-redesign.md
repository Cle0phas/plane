# Refonte des écrans de workflows : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal** : refaire l'éditeur de workflow, la liste des workflows et l'onglet Workflows du projet sur le modèle de Jira, avec la sélection des états existants, la création depuis un projet, la duplication et des flèches accrochées au côté choisi.

**Architecture** : le serveur reçoit quatre ajouts (côtés des flèches, états proposés, création depuis un projet, duplication) ; la création depuis un projet et la duplication construisent un graphe au format existant et passent par `save_workflow_graph`. Côté web, la logique du brouillon (`graph-model.ts`) est étendue et reste pure ; toute la présentation de l'éditeur est remplacée (en-tête, diagramme, fenêtres, panneau, vue Texte), puis la liste et l'onglet du projet.

**Tech Stack** : Django 5.2 + DRF, PostgreSQL 15, pytest (pile Docker `docker-compose-test.yml`), React Router 8 (SPA), MobX 6, SWR, `@xyflow/react` 12.12.0, `@makeplane/propel`, `@plane/blocks`, `@plane/i18n` (ICU), vitest 4, `jsdom` 23.2.0 et `@testing-library/react` 16.3.3 (déjà dans le catalogue pnpm, utilisés par `packages/blocks`).

**Spec** : `docs/superpowers/specs/2026-11-14-workflow-screens-redesign-design.md`. Elle complète `docs/superpowers/specs/2026-11-12-workflows-design.md` (modèle, contrôle des transitions, règles A1 à A5), que l'exécutant lit aussi.

## Global Constraints

- TDD strict : toute étape qui ajoute de la logique ou un composant de l'éditeur commence par un test qui échoue, exécuté et observé en échec. Les tâches 12 et 13 câblent des écrans sur une logique déjà testée ; elles le disent et se vérifient par les types, le lint et un parcours à l'écran.
- Identifiants techniques en anglais (variables, fonctions, classes, routes, tables, clés i18n, fichiers).
- Commentaires uniquement pour le pourquoi, sur une ligne.
- Aucun tiret cadratin (U+2014) dans le code, les commentaires, les commits ou ce document. Aucun emoji.
- Commits Conventional Commits `<type>(<scope>): <subject>`, minuscules, impératif, 72 caractères au plus, sans `Co-Authored-By` ni aucune mention d'IA. Jamais `--no-verify`.
- Autorisation contrôlée côté serveur sur chaque opération ; l'interface ne fait que refléter les droits. Les trois nouvelles routes sont réservées aux admins du workspace.
- Tout objet est résolu dans le workspace de l'URL ; un objet absent ou d'un autre workspace reçoit la même réponse 404.
- Bornes inchangées : 1 000 statuts par workspace, 200 états et 1 000 transitions par workflow, noms 255 caractères. Réponse des états proposés limitée à 500 entrées.
- Côtés d'une flèche : exactement `top`, `right`, `bottom`, `left`.
- Couleurs par catégorie : gris (backlog, unstarted), bleu (started), vert (completed), rouge (cancelled).
- Tout nouveau texte d'interface passe par `packages/i18n` (en et fr écrits dans ce plan, les 20 autres locales via le skill `translate`) ; en français on dit « ticket ».
- Migrations générées avec `uv run python manage.py makemigrations db -n <name>` (depuis `apps/api`) ; `apps/api/migrations_lockfile.txt` est commité avec elles, jamais édité à la main.
- Aucune dépendance d'exécution nouvelle. Dépendances de développement ajoutées à `apps/web` par `"catalog:"` uniquement.
- Nouveaux fichiers `.py`, `.ts`, `.tsx` (hors migrations, `*.config.ts`, `*.d.ts`) : en-tête `COPYRIGHT.txt` (trois lignes `#` en Python, bloc `/** ... */` en TypeScript), recopié d'un fichier voisin.
- Frontend : conventions de Plane (MobX + SWR), dérogation explicite aux règles ASIN FE-2, FE-3, FE-6. Primitives de `@makeplane/propel`, composites de `@plane/blocks`.
- API de `@xyflow/react` : avant d'utiliser une prop ou un type cité dans ce plan, le vérifier dans les types installés (`apps/web/node_modules/@xyflow/react/dist/esm/`). Si un nom diffère, garder le comportement décrit et adapter le nom.
- Commandes backend, depuis la racine du worktree : `docker compose -p wfr-<tâche> -f docker-compose-test.yml run --rm --build api-tests pytest --create-db <chemin> -v`, puis `docker compose -p wfr-<tâche> -f docker-compose-test.yml down -v`.
- Commandes web, depuis la racine du worktree : `pnpm --filter=web exec vitest run <chemin relatif à apps/web>`.

## Décisions prises en écrivant ce plan

Elles complètent la spec sans la contredire ; chacune est reprise dans la tâche qui l'implémente.

| #   | Décision                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | La création depuis un projet construit un graphe au format de la charge utile, le valide avec `WorkflowGraphInputSerializer`, puis appelle `save_workflow_graph` : mêmes validations et mêmes bornes que l'éditeur. Conséquence : une entrée d'audit `workflow.graph_updated` suit l'entrée `workflow.created`. |
| X2  | La duplication appelle `save_workflow_graph` sans repasser par le sérialiseur : le graphe vient de lignes déjà validées du même workspace, et une règle citant un membre devenu inactif ne doit pas faire échouer la copie. Une entrée `workflow.graph_updated` suit l'entrée `workflow.duplicated`.            |
| X3  | Un état de projet nommé « Triage » (nom réservé, P7 du plan des workflows) ou dont le nom est vide n'est ni proposé ni repris, même hors catégorie triage. Une couleur d'état qui n'est pas de la forme `#RRGGBB` est remplacée par `#3A3A3A`.                                                                  |
| X4  | Les côtés sont stockés sur `WorkflowTransitionSource` en deux `CharField` vides par défaut ; chaîne vide signifie automatique.                                                                                                                                                                                  |
| X5  | Dans le brouillon, un statut porte `known_group`, la catégorie connue du serveur ou de la proposition. La catégorie affichée est `group`, sinon `known_group`, sinon la déduction de W5 calculée sur le brouillon. Sans cela un statut à catégorie automatique n'aurait jamais de couleur.                      |
| X6  | Le diagramme synchronise ses nœuds sur une signature en chaîne (`JSON.stringify`), jamais sur l'identité d'un tableau : c'est ce qui a causé la boucle de rendu corrigée le 2026-11-14.                                                                                                                         |
| X7  | Le nœud « DÉMARRER » et sa flèche sont des éléments d'affichage dérivés de `is_initial` ; ils ne sont pas enregistrés.                                                                                                                                                                                          |
| X8  | La liste « Rechercher ou créer » est un champ de filtre suivi de cases à cocher natives (P11 du plan des workflows : éléments HTML natifs, utilisables au clavier sans adaptation).                                                                                                                             |
| X9  | Icônes : celles de `@makeplane/propel/icons` (`StateOutline`, `WorkflowsOutline`, `AutomationsOutline`, `CopyOutline`, `ChevronRightOutline`, `ChevronDownOutline`, `PlusCircleOutline`), l'application web n'utilisant pas Lucide.                                                                             |
| X10 | `WorkflowEditor` reçoit `onSave` et `onClose` en props au lieu de lire le store et le routeur : la page fait le lien, et le composant se teste sans simuler le store.                                                                                                                                           |
| X11 | L'adresse de l'éditeur ne change pas ; sa route est déclarée sous la mise en page du workspace, hors de la mise en page des paramètres.                                                                                                                                                                         |
| X12 | Tests d'affichage : second projet vitest `dom` dans `apps/web`, sur le modèle de `packages/blocks` (`**/*.test.tsx`, `jsdom`).                                                                                                                                                                                  |
| X13 | Sous 768 px, la largeur est lue une fois à l'ouverture de l'éditeur (`matchMedia`) : vue Texte par défaut et édition désactivée.                                                                                                                                                                                |

---

## File Structure

### Backend (`apps/api`)

| Fichier                                                     | Action          | Responsabilité                                                                         |
| ----------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `plane/db/models/workflow.py`                               | Modify          | `TRANSITION_SIDES`, champs `source_side` et `target_side`.                             |
| `plane/db/migrations/0130_workflow_transition_sides.py`     | Create (généré) | Les deux colonnes.                                                                     |
| `migrations_lockfile.txt`                                   | Modify (généré) | Dernière migration.                                                                    |
| `plane/app/serializers/workflow.py`                         | Modify          | Champ `sides` de la charge utile et sa validation.                                     |
| `plane/utils/workflow_graph.py`                             | Modify          | `sides` en lecture et à l'enregistrement.                                              |
| `plane/utils/workflow_seed.py`                              | Create          | Fonctions pures de lecture : `candidate_statuses`, `graph_from_project`, `graph_copy`. |
| `plane/app/views/workflow/base.py`                          | Modify          | Route des états proposés, `source_project_id` à la création, route de duplication.     |
| `plane/app/views/__init__.py`, `plane/app/urls/workflow.py` | Modify          | Export et routes.                                                                      |
| `plane/tests/unit/utils/test_workflow_seed.py`              | Create          | Tests des trois fonctions.                                                             |
| `plane/tests/contract/app/test_workflows_app.py`            | Modify          | Tests des routes (droits, contenu, audit).                                             |

### Types et web

| Fichier                                                                                                          | Action                   | Responsabilité                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `packages/types/src/workflow.ts`                                                                                 | Modify                   | `TWorkflowSide`, `TWorkflowSides`, `TWorkflowStatusCandidate`, `source_project_id`.              |
| `apps/web/services/workflow.service.ts`                                                                          | Modify                   | `listCandidates`, `duplicate`.                                                                   |
| `apps/web/store/workspace/workflow.store.ts` (+ test)                                                            | Modify                   | `candidatesMap`, `fetchCandidates`, `duplicateWorkflow`.                                         |
| `apps/web/components/workflow/editor/graph-model.ts` (+ test)                                                    | Modify                   | Côtés, placement, catégorie affichée, options de la liste, lignes de la vue Texte, nom de copie. |
| `packages/i18n/src/locales/*/workflow.json`                                                                      | Modify                   | Nouveaux textes.                                                                                 |
| `apps/web/vitest.config.ts`, `apps/web/vitest.setup.dom.ts`, `apps/web/package.json`                             | Modify, Create, Modify   | Projet de tests `dom`.                                                                           |
| `apps/web/components/workflow/editor/workflow-editor.tsx` (+ `.test.tsx`)                                        | Rewrite                  | Coque de l'éditeur : état, bandeaux, vues, fenêtres.                                             |
| `apps/web/components/workflow/editor/editor-header.tsx`                                                          | Create                   | En-tête.                                                                                         |
| `apps/web/components/workflow/editor/workflow-canvas.tsx`                                                        | Rewrite                  | Diagramme.                                                                                       |
| `apps/web/components/workflow/editor/state-node.tsx`, `start-node.tsx`                                           | Rewrite, Create          | Nœuds.                                                                                           |
| `apps/web/components/workflow/editor/add-status-dialog.tsx` (+ `.test.tsx`)                                      | Create                   | « Ajouter un état ».                                                                             |
| `apps/web/components/workflow/editor/add-transition-dialog.tsx`, `add-rule-dialog.tsx`                           | Create                   | Fenêtres de transition et de règle.                                                              |
| `apps/web/components/workflow/editor/side-panel.tsx`                                                             | Rewrite                  | Panneau droit.                                                                                   |
| `apps/web/components/workflow/editor/text-view.tsx` (+ `.test.tsx`)                                              | Create                   | Vue Texte.                                                                                       |
| `apps/web/components/workflow/editor/add-state-form.tsx`, `add-transition-form.tsx`, `workflow-element-list.tsx` | Delete                   | Remplacés par les fenêtres et la vue Texte.                                                      |
| `apps/web/app/routes/core.ts`, `apps/web/app/(all)/[workspaceSlug]/workflow-editor/[workflowId]/page.tsx`        | Modify, Create (déplacé) | Route plein écran.                                                                               |
| `apps/web/components/workflow/settings/workflow-list.tsx`, `workflow-create-modal.tsx`                           | Rewrite, Modify          | Tableau, duplication, « Partir du projet ».                                                      |
| `apps/web/components/workflow/project/project-workflow-scheme.tsx`, `scheme-helpers.ts` (+ test)                 | Modify                   | Tableau du projet relié.                                                                         |

---

### Task 1: Côtés des flèches côté serveur (spec 4.4, R17, X4)

**Files:**

- Modify: `apps/api/plane/db/models/workflow.py`
- Create: `apps/api/plane/db/migrations/0130_workflow_transition_sides.py` (généré)
- Modify: `apps/api/migrations_lockfile.txt` (généré)
- Modify: `apps/api/plane/app/serializers/workflow.py`
- Modify: `apps/api/plane/utils/workflow_graph.py`
- Test: `apps/api/plane/tests/contract/app/test_workflows_app.py`

**Interfaces:**

- Consumes : `_client`, `_graph_payload`, les fixtures `users` et `software`, `GRAPH_URL`, `WORKFLOW_URL` du fichier de test existant.
- Produces :
  - `plane.db.models.workflow.TRANSITION_SIDES = ["top", "right", "bottom", "left"]` ;
  - champs `WorkflowTransitionSource.source_side` et `.target_side` (`str`, vide = automatique) ;
  - chaque transition de `workflow_graph(workflow)` porte `"sides": {<id de l'état source>: {"source": <côté>, "target": <côté>}}` (dictionnaire vide si aucun côté) ;
  - chaque transition de la charge utile accepte `"sides": {<clé de la source>: {"source": <côté>, "target": <côté>}}` ; après validation, `transition["sides"]` existe toujours.

- [ ] **Step 1: Write the failing tests**

À la fin de `apps/api/plane/tests/contract/app/test_workflows_app.py` :

```python
@pytest.mark.contract
@pytest.mark.django_db
class TestTransitionSides:
    def _payload(self, software, build):
        payload = _graph_payload(software)
        todo, done = (str(software.states_by_name[name].id) for name in ("To do", "Done"))
        payload["transitions"] = [
            {"name": "", "from_any": False, "source_keys": [todo], "target_key": done, "rules": [], "sides": build(todo)}
        ]
        return payload

    def test_sides_survive_a_save_and_a_reload(self, workspace, users, software):
        client = _client(users["admin"])
        todo = str(software.states_by_name["To do"].id)
        payload = self._payload(software, lambda key: {key: {"source": "right", "target": "left"}})
        saved = client.put(GRAPH_URL.format(slug=workspace.slug, pk=software.id), payload, format="json")
        assert saved.status_code == status.HTTP_200_OK
        assert saved.data["transitions"][0]["sides"] == {todo: {"source": "right", "target": "left"}}
        reloaded = client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        assert reloaded.data["transitions"][0]["sides"] == {todo: {"source": "right", "target": "left"}}

    def test_a_transition_without_sides_reports_an_empty_mapping(self, workspace, users, software):
        payload = self._payload(software, lambda key: {})
        del payload["transitions"][0]["sides"]
        saved = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), payload, format="json"
        )
        assert saved.status_code == status.HTTP_200_OK
        assert saved.data["transitions"][0]["sides"] == {}

    @pytest.mark.parametrize(
        "build",
        [
            lambda key: {"other": {"source": "top", "target": "left"}},
            lambda key: {key: {"source": "middle", "target": "left"}},
            lambda key: {key: {"source": "top"}},
            lambda key: {key: {"source": "top", "target": "left", "extra": 1}},
            lambda key: {key: "top"},
        ],
        ids=["foreign-key", "unknown-side", "missing-target", "extra-key", "not-an-object"],
    )
    def test_bad_sides_are_refused(self, workspace, users, software, build):
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), self._payload(software, build), format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"graph": ["invalid_transition"]}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run : `docker compose -p wfr-t1 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -k TestTransitionSides -v`
Expected : FAIL, `KeyError: 'sides'` sur les deux premiers tests ; les cas refusés renvoient 200 au lieu de 400.

- [ ] **Step 3: Add the model fields**

Dans `apps/api/plane/db/models/workflow.py`, après `RESERVED_STATUS_NAMES` :

```python
TRANSITION_SIDES = ["top", "right", "bottom", "left"]
```

et dans `WorkflowTransitionSource`, après le champ `source` :

```python
    # Empty: the editor picks the closest pair of sides (X4).
    source_side = models.CharField(max_length=6, blank=True, default="", choices=[(side, side) for side in TRANSITION_SIDES])
    target_side = models.CharField(max_length=6, blank=True, default="", choices=[(side, side) for side in TRANSITION_SIDES])
```

- [ ] **Step 4: Generate the migration**

Run (depuis `apps/api`) : `uv run python manage.py makemigrations db -n workflow_transition_sides`
Expected : création de `plane/db/migrations/0130_workflow_transition_sides.py` avec deux `AddField`, et `migrations_lockfile.txt` réécrit. Vérifier que la migration ne contient rien d'autre.

- [ ] **Step 5: Validate `sides` in the serializer**

Dans `apps/api/plane/app/serializers/workflow.py`, ajouter `TRANSITION_SIDES` à l'import de `plane.db.models.workflow`, puis dans `GraphTransitionInputSerializer`, après `rules` :

```python
    # Validated in WorkflowGraphInputSerializer.validate, next to the sources it refers to.
    sides = serializers.DictField(child=serializers.JSONField(), required=False, default=dict)
```

Dans `WorkflowGraphInputSerializer.validate`, à la fin de la boucle `for transition in attrs["transitions"]:`, après le bloc `if (...): raise graph_error("invalid_transition")` :

```python
            sides = {}
            for key, value in transition["sides"].items():
                if (
                    key not in sources
                    or not isinstance(value, dict)
                    or set(value) != {"source", "target"}
                    or value["source"] not in TRANSITION_SIDES
                    or value["target"] not in TRANSITION_SIDES
                ):
                    raise graph_error("invalid_transition")
                sides[key] = {"source": value["source"], "target": value["target"]}
            transition["sides"] = sides
```

- [ ] **Step 6: Read and write `sides` in the graph helpers**

Dans `apps/api/plane/utils/workflow_graph.py`, fonction `workflow_graph`, ajouter au dictionnaire de chaque transition, après `"source_ids"` :

```python
                "sides": {
                    str(source.source_id): {"source": source.source_side, "target": source.target_side}
                    for source in transition.sources.all()
                    if source.source_side and source.target_side
                },
```

et dans `save_workflow_graph`, remplacer le `bulk_create` des sources par :

```python
        sides = item.get("sides", {})
        WorkflowTransitionSource.objects.bulk_create(
            WorkflowTransitionSource(
                transition=transition,
                source=state_by_key[key],
                source_side=sides.get(key, {}).get("source", ""),
                target_side=sides.get(key, {}).get("target", ""),
            )
            for key in item["source_keys"]
        )
```

- [ ] **Step 7: Run the new tests, then every workflow test**

Run : `docker compose -p wfr-t1 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -k TestTransitionSides -v`
Expected : 7 passed.

Run : `docker compose -p wfr-t1 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests -k workflow -q`
Expected : tout passe. Si un test existant compare une transition entière à un dictionnaire littéral, lui ajouter `"sides": {}` ; ne rien changer d'autre. Puis `docker compose -p wfr-t1 -f docker-compose-test.yml down -v`.

- [ ] **Step 8: Lint and commit**

Run (depuis `apps/api`) : `uv run ruff check . && uv run ruff format --check .`

```bash
git add apps/api/plane/db/models/workflow.py apps/api/plane/db/migrations/0130_workflow_transition_sides.py apps/api/migrations_lockfile.txt apps/api/plane/app/serializers/workflow.py apps/api/plane/utils/workflow_graph.py apps/api/plane/tests
git commit -m "feat(api): store the sides a workflow arrow leaves and enters by"
```

---

### Task 2: États proposés (spec 4.1, R7, R15, X3)

**Files:**

- Create: `apps/api/plane/utils/workflow_seed.py`
- Create: `apps/api/plane/tests/unit/utils/test_workflow_seed.py`
- Modify: `apps/api/plane/app/views/workflow/base.py`
- Modify: `apps/api/plane/app/views/__init__.py`
- Modify: `apps/api/plane/app/urls/workflow.py`
- Test: `apps/api/plane/tests/contract/app/test_workflows_app.py`

**Interfaces:**

- Consumes : `State`, `WorkflowStatus`, `RESERVED_STATUS_NAMES`.
- Produces :
  - `plane.utils.workflow_seed.GROUP_ORDER = ["backlog", "unstarted", "started", "completed", "cancelled"]` ;
  - `plane.utils.workflow_seed.status_color(value) -> str` ;
  - `plane.utils.workflow_seed.candidate_statuses(workspace_id) -> list[dict]`, chaque entrée `{"name": str, "color": str, "group": str}` ;
  - route `GET /api/workspaces/<slug>/workflow-statuses/candidates/`, nom `workflow-status-candidates`, classe `WorkflowStatusCandidatesEndpoint`.

- [ ] **Step 1: Write the failing unit tests**

Créer `apps/api/plane/tests/unit/utils/test_workflow_seed.py` (avec l'en-tête de copyright) :

```python
import pytest
from django.utils import timezone

from plane.db.models import Project, State, WorkflowStatus
from plane.utils.workflow_seed import candidate_statuses


def make_project(workspace, name, identifier):
    return Project.objects.create(name=name, identifier=identifier, workspace=workspace)


def make_state(project, name, group, color="#3A3A3A", default=False):
    return State.objects.create(
        project=project, workspace=project.workspace, name=name, group=group, color=color, default=default
    )


@pytest.mark.unit
@pytest.mark.django_db
class TestCandidateStatuses:
    def test_each_name_once_with_the_oldest_values(self, workspace):
        first = make_project(workspace, "First", "ONE")
        second = make_project(workspace, "Second", "TWO")
        make_state(first, "Todo", "unstarted", "#111111")
        make_state(second, "TODO", "started", "#222222")
        assert candidate_statuses(workspace.id) == [{"name": "Todo", "color": "#111111", "group": "unstarted"}]

    def test_sorted_by_category_then_name(self, workspace):
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Done", "completed")
        make_state(project, "Review", "started")
        make_state(project, "Build", "started")
        make_state(project, "Backlog", "backlog")
        assert [item["name"] for item in candidate_statuses(workspace.id)] == ["Backlog", "Build", "Review", "Done"]

    def test_existing_statuses_triage_and_deleted_rows_are_left_out(self, workspace):
        project = make_project(workspace, "First", "ONE")
        gone = make_project(workspace, "Gone", "TWO")
        WorkflowStatus.objects.create(workspace=workspace, name="todo", color="#3A3A3A")
        make_state(project, "Todo", "unstarted")
        make_state(project, "Triage", "triage")
        make_state(project, "triage", "started")
        removed = make_state(project, "Removed", "started")
        make_state(gone, "Hidden", "started")
        # Queryset updates: a model delete() would queue the cascade task.
        State.objects.filter(pk=removed.pk).update(deleted_at=timezone.now())
        Project.objects.filter(pk=gone.pk).update(deleted_at=timezone.now())
        make_state(project, "Kept", "started")
        assert [item["name"] for item in candidate_statuses(workspace.id)] == ["Kept"]

    def test_other_workspaces_are_ignored_and_bad_colours_replaced(self, workspace):
        from plane.tests.factories import WorkspaceFactory

        foreign = make_project(WorkspaceFactory(), "Foreign", "FOR")
        make_state(foreign, "Elsewhere", "started")
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Odd", "started", "red")
        assert candidate_statuses(workspace.id) == [{"name": "Odd", "color": "#3A3A3A", "group": "started"}]

    def test_the_list_is_capped(self, workspace, monkeypatch):
        monkeypatch.setattr("plane.utils.workflow_seed.CANDIDATE_LIMIT", 2)
        project = make_project(workspace, "First", "ONE")
        for name in ("A", "B", "C"):
            make_state(project, name, "started")
        assert [item["name"] for item in candidate_statuses(workspace.id)] == ["A", "B"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run : `docker compose -p wfr-t2 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/utils/test_workflow_seed.py -v`
Expected : FAIL, `ModuleNotFoundError: No module named 'plane.utils.workflow_seed'`.

- [ ] **Step 3: Write `candidate_statuses`**

Créer `apps/api/plane/utils/workflow_seed.py` (avec l'en-tête de copyright) :

```python
# Python imports
import re

# Module imports
from plane.db.models import State, WorkflowStatus
from plane.db.models.workflow import RESERVED_STATUS_NAMES

GROUP_ORDER = ["backlog", "unstarted", "started", "completed", "cancelled"]
CANDIDATE_LIMIT = 500
DEFAULT_STATUS_COLOR = "#3A3A3A"
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def status_color(value):
    # Project states accept any text as a colour; statuses only take #RRGGBB (X3).
    return value if COLOR_PATTERN.match(value or "") else DEFAULT_STATUS_COLOR


def candidate_statuses(workspace_id):
    """Project state names that are not workspace statuses yet, one entry per name (spec 4.1)."""
    taken = {
        name.lower() for name in WorkflowStatus.objects.filter(workspace_id=workspace_id).values_list("name", flat=True)
    }
    candidates = {}
    # State.objects already leaves out triage and soft-deleted rows.
    states = (
        State.objects.filter(workspace_id=workspace_id, project__deleted_at__isnull=True)
        .order_by("created_at", "id")
        .values_list("name", "color", "group")
    )
    for name, color, group in states:
        key = name.strip().lower()
        if not key or key in taken or key in RESERVED_STATUS_NAMES or key in candidates or group not in GROUP_ORDER:
            continue
        candidates[key] = {"name": name.strip(), "color": status_color(color), "group": group}
    ordered = sorted(candidates.values(), key=lambda item: (GROUP_ORDER.index(item["group"]), item["name"].lower()))
    return ordered[:CANDIDATE_LIMIT]
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run : `docker compose -p wfr-t2 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests/unit/utils/test_workflow_seed.py -v`
Expected : 5 passed.

- [ ] **Step 5: Write the failing route tests**

Dans `apps/api/plane/tests/contract/app/test_workflows_app.py`, ajouter `State` à l'import de `plane.db.models`, la constante

```python
CANDIDATES_URL = "/api/workspaces/{slug}/workflow-statuses/candidates/"
```

et à la fin du fichier :

```python
def _state(project, name, group, default=False):
    return State.objects.create(
        project=project, workspace=project.workspace, name=name, group=group, color="#3A3A3A", default=default
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestStatusCandidates:
    def test_admin_reads_project_states_that_are_not_statuses(self, workspace, users, project, software):
        _state(project, "To do", "unstarted")
        _state(project, "In review", "started")
        response = _client(users["admin"]).get(CANDIDATES_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_200_OK
        assert response.data == [{"name": "In review", "color": "#3A3A3A", "group": "started"}]

    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_other_roles_are_refused(self, workspace, users, project, role):
        _state(project, "In review", "started")
        response = _client(users[role]).get(CANDIDATES_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_a_project_admin_who_is_only_a_workspace_member_is_refused(self, workspace, users, project):
        ProjectMember.objects.create(project=project, member=users["member"], role=20)
        response = _client(users["member"]).get(CANDIDATES_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_non_members_are_refused(self, workspace, project):
        outsider = UserFactory()
        WorkspaceMember.objects.create(workspace=WorkspaceFactory(), member=outsider, role=20)
        response = _client(outsider).get(CANDIDATES_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_403_FORBIDDEN
```

Run : `docker compose -p wfr-t2 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -k TestStatusCandidates -v`
Expected : FAIL, 404 sur toutes les requêtes (route absente).

- [ ] **Step 6: Add the endpoint and its route**

Dans `apps/api/plane/app/views/workflow/base.py`, ajouter l'import `from plane.utils.workflow_seed import candidate_statuses` et, après `WorkflowStatusEndpoint` :

```python
class WorkflowStatusCandidatesEndpoint(BaseAPIView):
    # Admins only: the names come from every project of the workspace, private ones included (R15).
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        return Response(candidate_statuses(workspace.id), status=status.HTTP_200_OK)
```

Dans `apps/api/plane/app/views/__init__.py`, ajouter `WorkflowStatusCandidatesEndpoint` à l'import existant `from .workflow.base import (...)`.

Dans `apps/api/plane/app/urls/workflow.py`, ajouter `WorkflowStatusCandidatesEndpoint` à l'import et, juste après la route `workflow-statuses` :

```python
    path(
        "workspaces/<str:slug>/workflow-statuses/candidates/",
        WorkflowStatusCandidatesEndpoint.as_view(),
        name="workflow-status-candidates",
    ),
```

- [ ] **Step 7: Run the route tests, lint, commit**

Run : `docker compose -p wfr-t2 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -k TestStatusCandidates -v`
Expected : 5 passed. Puis `docker compose -p wfr-t2 -f docker-compose-test.yml down -v`.

Run (depuis `apps/api`) : `uv run ruff check . && uv run ruff format --check .`

```bash
git add apps/api/plane/utils/workflow_seed.py apps/api/plane/tests apps/api/plane/app/views apps/api/plane/app/urls/workflow.py
git commit -m "feat(api): list project states that can become workflow statuses"
```

---

### Task 3: Création d'un workflow depuis un projet (spec 4.2, 4.5, 5.2, R9, R10, X1)

**Files:**

- Modify: `apps/api/plane/utils/workflow_seed.py`
- Modify: `apps/api/plane/tests/unit/utils/test_workflow_seed.py`
- Modify: `apps/api/plane/app/views/workflow/base.py`
- Test: `apps/api/plane/tests/contract/app/test_workflows_app.py`

**Interfaces:**

- Consumes : `status_color`, `GROUP_ORDER` (Task 2) ; `WorkflowGraphInputSerializer`, `save_workflow_graph`, `GraphError` ; les `sides` de Task 1 (le sérialiseur les pose toujours).
- Produces :
  - `plane.utils.workflow_seed.PLACEMENT_STEP = 240` ;
  - `plane.utils.workflow_seed.graph_from_project(project) -> dict` au format de la charge utile du graphe (`{"states": [...], "transitions": [...]}`), clés d'état égales aux identifiants des états du projet ;
  - `POST /api/workspaces/<slug>/workflows/` accepte `source_project_id` ; réponses : 201 avec le détail, 400 (`{"source_project_id": [...]}`, ou le corps d'erreur du graphe), 404 (projet absent ou étranger).

- [ ] **Step 1: Write the failing unit tests**

À la fin de `apps/api/plane/tests/unit/utils/test_workflow_seed.py`, en ajoutant `graph_from_project` à l'import :

```python
def names(graph, keys):
    by_key = {state["key"]: state["status"]["name"] for state in graph["states"]}
    return [by_key[key] for key in keys]


@pytest.mark.unit
@pytest.mark.django_db
class TestGraphFromProject:
    def _project(self, workspace):
        project = make_project(workspace, "TEST2", "TEST2")
        make_state(project, "Backlog", "backlog", default=True)
        make_state(project, "Todo", "unstarted")
        make_state(project, "In Progress", "started")
        make_state(project, "Done", "completed")
        make_state(project, "Cancelled", "cancelled")
        make_state(project, "Ready for dev", "started")
        make_state(project, "Triage", "triage")
        return project

    def test_states_follow_category_then_project_rank(self, workspace):
        graph = graph_from_project(self._project(workspace))
        assert [state["status"]["name"] for state in graph["states"]] == [
            "Backlog",
            "Todo",
            "In Progress",
            "Ready for dev",
            "Done",
            "Cancelled",
        ]
        assert [state["position_x"] for state in graph["states"]] == [0, 240, 480, 720, 960, 1200]
        assert {state["position_y"] for state in graph["states"]} == {0}
        assert [state["status"]["name"] for state in graph["states"] if state["is_initial"]] == ["Backlog"]

    def test_chain_and_global_transitions(self, workspace):
        graph = graph_from_project(self._project(workspace))
        chain = [item for item in graph["transitions"] if not item["from_any"]]
        assert [names(graph, [*item["source_keys"], item["target_key"]]) for item in chain] == [
            ["Backlog", "Todo"],
            ["Todo", "In Progress"],
            ["In Progress", "Ready for dev"],
            ["Ready for dev", "Done"],
        ]
        anywhere = [item for item in graph["transitions"] if item["from_any"]]
        assert names(graph, [item["target_key"] for item in anywhere]) == ["Backlog", "Cancelled"]
        assert all(item["source_keys"] == [] and item["rules"] == [] for item in anywhere)

    def test_the_first_state_starts_when_the_default_is_missing_or_cancelled(self, workspace):
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Todo", "unstarted")
        make_state(project, "Dropped", "cancelled", default=True)
        graph = graph_from_project(project)
        assert [state["status"]["name"] for state in graph["states"] if state["is_initial"]] == ["Todo"]

    def test_an_existing_status_is_reused_and_a_new_one_keeps_the_state_values(self, workspace):
        existing = WorkflowStatus.objects.create(workspace=workspace, name="todo", color="#123456")
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Todo", "unstarted", "#AAAAAA")
        make_state(project, "Review", "started", "#BBBBBB")
        graph = graph_from_project(project)
        assert graph["states"][0]["status"] == {"id": str(existing.id), "name": "todo", "color": "#123456"}
        assert graph["states"][1]["status"] == {"name": "Review", "color": "#BBBBBB", "group": "started"}

    def test_names_differing_by_case_and_reserved_names_give_one_state(self, workspace):
        project = make_project(workspace, "First", "ONE")
        make_state(project, "Todo", "unstarted")
        make_state(project, "TODO", "started")
        make_state(project, "triage", "started")
        assert [state["status"]["name"] for state in graph_from_project(project)["states"]] == ["Todo"]

    def test_an_empty_project_gives_an_empty_graph(self, workspace):
        assert graph_from_project(make_project(workspace, "First", "ONE")) == {"states": [], "transitions": []}
```

Run : `docker compose -p wfr-t3 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/utils/test_workflow_seed.py -k TestGraphFromProject -v`
Expected : FAIL, `ImportError: cannot import name 'graph_from_project'`.

- [ ] **Step 2: Write `graph_from_project`**

À la fin de `apps/api/plane/utils/workflow_seed.py`, en ajoutant `PLACEMENT_STEP = 240` aux constantes :

```python
def _transition(target, sources=None):
    return {
        "name": "",
        "from_any": sources is None,
        "source_keys": [str(state.id) for state in sources or []],
        "target_key": str(target.id),
        "rules": [],
    }


def graph_from_project(project):
    """Graph payload reproducing the states of a project as a chain (spec 5.2)."""
    statuses = {
        status.name.lower(): status for status in WorkflowStatus.objects.filter(workspace_id=project.workspace_id)
    }
    rows, seen = [], set()
    for state in State.objects.filter(project_id=project.id).order_by("sequence", "created_at", "id"):
        key = state.name.strip().lower()
        if not key or key in seen or key in RESERVED_STATUS_NAMES or state.group not in GROUP_ORDER:
            continue
        seen.add(key)
        rows.append(state)
    # Stable sort: the project rank is kept inside a category.
    rows.sort(key=lambda state: GROUP_ORDER.index(state.group))
    live = [state for state in rows if state.group != "cancelled"]
    initial = next((state for state in live if state.default), (live or rows or [None])[0])

    states = []
    for index, state in enumerate(rows):
        existing = statuses.get(state.name.strip().lower())
        if existing is not None:
            status = {"id": str(existing.id), "name": existing.name, "color": existing.color}
        else:
            status = {"name": state.name.strip(), "color": status_color(state.color), "group": state.group}
        states.append(
            {
                "key": str(state.id),
                "status": status,
                "position_x": index * PLACEMENT_STEP,
                "position_y": 0,
                "is_initial": state is initial,
            }
        )
    transitions = [_transition(target, [source]) for source, target in zip(live, live[1:])]
    cancelled = [state for state in rows if state.group == "cancelled" and state is not initial]
    transitions += [_transition(state) for state in ([initial] if initial is not None else []) + cancelled]
    return {"states": states, "transitions": transitions}
```

Run : `docker compose -p wfr-t3 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests/unit/utils/test_workflow_seed.py -v`
Expected : 11 passed.

- [ ] **Step 3: Write the failing route tests**

À la fin de `apps/api/plane/tests/contract/app/test_workflows_app.py` :

```python
def _seed_project(project):
    _state(project, "Backlog", "backlog", default=True)
    _state(project, "Doing", "started")
    _state(project, "Dropped", "cancelled")
    State.objects.create(project=project, workspace=project.workspace, name="Triage", group="triage", color="#3A3A3A")


@pytest.mark.contract
@pytest.mark.django_db
class TestCreateFromProject:
    def _post(self, user, workspace, **body):
        return _client(user).post(WORKFLOWS_URL.format(slug=workspace.slug), body, format="json")

    def test_admin_creates_a_workflow_holding_the_project_graph(self, workspace, users, project):
        _seed_project(project)
        response = self._post(users["admin"], workspace, name="From project", source_project_id=str(project.id))
        assert response.status_code == status.HTTP_201_CREATED
        states = response.data["states"]
        assert [state["status"]["name"] for state in states] == ["Backlog", "Doing", "Dropped"]
        assert [state["status"]["name"] for state in states if state["is_initial"]] == ["Backlog"]
        by_id = {state["id"]: state["status"]["name"] for state in states}
        transitions = response.data["transitions"]
        assert sorted(
            ([by_id[source] for source in item["source_ids"]], by_id[item["target_id"]], item["from_any"])
            for item in transitions
        ) == [([], "Backlog", True), ([], "Dropped", True), (["Backlog"], "Doing", False)]
        assert response.data["project_count"] == 0
        assert not ProjectWorkflowScheme.objects.filter(project=project).exists()

    def test_the_creation_is_audited_with_its_source(self, workspace, users, project):
        _seed_project(project)
        response = self._post(users["admin"], workspace, name="From project", source_project_id=str(project.id))
        entry = AuditLog.objects.get(action="workflow.created", target_id=response.data["id"])
        assert entry.after["source_project_id"] == str(project.id)
        assert entry.actor_id == users["admin"].id

    def test_without_a_source_the_workflow_is_empty(self, workspace, users):
        response = self._post(users["admin"], workspace, name="Empty")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["states"] == []
        assert "source_project_id" not in AuditLog.objects.get(action="workflow.created").after

    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_other_roles_cannot_create_from_a_project(self, workspace, users, project, role):
        _seed_project(project)
        response = self._post(users[role], workspace, name="Nope", source_project_id=str(project.id))
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Workflow.objects.filter(name="Nope").exists()

    def test_a_project_of_another_workspace_looks_missing(self, workspace, users):
        foreign = Project.objects.create(name="Foreign", identifier="FOR", workspace=WorkspaceFactory())
        hidden = self._post(users["admin"], workspace, name="A", source_project_id=str(foreign.id))
        missing = self._post(users["admin"], workspace, name="B", source_project_id=str(uuid4()))
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data
        assert not Workflow.objects.filter(workspace=workspace).exists()

    def test_a_malformed_project_id_is_refused(self, workspace, users):
        response = self._post(users["admin"], workspace, name="A", source_project_id=123)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "source_project_id" in response.data

    def test_too_many_states_create_nothing(self, workspace, users, project):
        State.objects.bulk_create(
            State(
                project=project,
                workspace=workspace,
                name=f"State {index}",
                slug=f"state-{index}",
                group="started",
                color="#3A3A3A",
                sequence=index,
            )
            for index in range(201)
        )
        response = self._post(users["admin"], workspace, name="Huge", source_project_id=str(project.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Workflow.objects.filter(name="Huge").exists()
        assert not WorkflowStatus.objects.filter(workspace=workspace).exists()
        assert not AuditLog.objects.filter(action="workflow.created").exists()
```

Ajouter `ProjectWorkflowScheme` à l'import de `plane.db.models` du fichier de test. Si `State` n'a pas de champ `slug`, retirer cet argument du `bulk_create`.

Run : `docker compose -p wfr-t3 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -k TestCreateFromProject -v`
Expected : FAIL, les workflows créés sont vides et les refus attendus renvoient 201.

- [ ] **Step 4: Accept `source_project_id` on creation**

Dans `apps/api/plane/app/views/workflow/base.py` :

Imports à ajouter : `from rest_framework import serializers`, `from plane.utils.issue_types import StrictUUIDField`, et `graph_from_project` à l'import de `plane.utils.workflow_seed`.

Après `_workflow_snapshot` :

```python
class SeedError(Exception):
    def __init__(self, body):
        super().__init__("seed")
        self.body = body


def _seed(workflow, graph, actor_id):
    """Check a server-built graph like a client payload, then save it (X1)."""
    serializer = WorkflowGraphInputSerializer(data=graph, context={"workspace_id": workflow.workspace_id})
    if not serializer.is_valid():
        raise SeedError(serializer.errors)
    save_workflow_graph(workflow=workflow, graph=serializer.validated_data, actor_id=actor_id)
```

Remplacer la méthode `post` de `WorkflowEndpoint` par :

```python
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk=None):
        if pk is not None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkflowSerializer(data=request.data, context={"workspace_id": workspace.id})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        source = None
        source_id = request.data.get("source_project_id") if isinstance(request.data, dict) else None
        if source_id is not None:
            try:
                source_id = StrictUUIDField().run_validation(source_id)
            except serializers.ValidationError as error:
                return Response({"source_project_id": error.detail}, status=status.HTTP_400_BAD_REQUEST)
            # A project of another workspace raises DoesNotExist: same 404 as a missing one (A5).
            source = Project.objects.get(workspace_id=workspace.id, pk=source_id)
        try:
            with transaction.atomic():
                workflow = serializer.save(workspace_id=workspace.id)
                snapshot = _workflow_snapshot(workflow)
                if source is not None:
                    snapshot["source_project_id"] = str(source.id)
                record_audit(
                    workspace_id=workspace.id,
                    actor_id=request.user.id,
                    action="workflow.created",
                    target_type="workflow",
                    target_id=workflow.id,
                    after=snapshot,
                )
                if source is not None:
                    _seed(workflow, graph_from_project(source), request.user.id)
        except SeedError as error:
            return Response(error.body, status=status.HTTP_400_BAD_REQUEST)
        except GraphError as error:
            return Response({"graph": [error.code]}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as error:
            if _constraint_name(error) == STATUS_NAME_CONSTRAINT:
                return Response({"graph": ["duplicate_status_name"]}, status=status.HTTP_400_BAD_REQUEST)
            if _constraint_name(error) != WORKFLOW_NAME_CONSTRAINT:
                raise
            return Response({"name": [DUPLICATE_WORKFLOW_NAME_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
        workflow.refresh_from_db()
        return Response(workflow_detail(workflow, True), status=status.HTTP_201_CREATED)
```

- [ ] **Step 5: Run the tests, lint, commit**

Run : `docker compose -p wfr-t3 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py plane/tests/unit/utils/test_workflow_seed.py -v`
Expected : tout passe, dont les 8 tests de `TestCreateFromProject` et les tests existants de `TestWrite`. Puis `docker compose -p wfr-t3 -f docker-compose-test.yml down -v`.

Run (depuis `apps/api`) : `uv run ruff check . && uv run ruff format --check .`

```bash
git add apps/api/plane/utils/workflow_seed.py apps/api/plane/app/views/workflow/base.py apps/api/plane/tests
git commit -m "feat(api): create a workflow from the states of a project"
```

---

### Task 4: Duplication d'un workflow (spec 4.3, 4.5, R11, X2)

**Files:**

- Modify: `apps/api/plane/utils/workflow_seed.py`
- Modify: `apps/api/plane/app/views/workflow/base.py`
- Modify: `apps/api/plane/app/views/__init__.py`
- Modify: `apps/api/plane/app/urls/workflow.py`
- Test: `apps/api/plane/tests/contract/app/test_workflows_app.py`

**Interfaces:**

- Consumes : `workflow_graph` (avec `sides`, Task 1), `save_workflow_graph`, `WorkflowSerializer`, `build_workflow`.
- Produces :
  - `plane.utils.workflow_seed.graph_copy(workflow) -> dict` au format validé du graphe (chaque transition porte `sides`) ;
  - route `POST /api/workspaces/<slug>/workflows/<uuid:pk>/duplicate/`, nom `workflow-duplicate`, classe `WorkflowDuplicateEndpoint`, corps `{"name": str}` ; 201 avec le détail de la copie ; 400 `{"name": [...]}` ; 404.

- [ ] **Step 1: Write the failing tests**

Dans `apps/api/plane/tests/contract/app/test_workflows_app.py`, ajouter la constante

```python
DUPLICATE_URL = "/api/workspaces/{slug}/workflows/{pk}/duplicate/"
```

et à la fin du fichier :

```python
def _shape(detail):
    """A graph without its identifiers, to compare a copy with its source."""
    by_id = {state["id"]: state["status"]["name"] for state in detail["states"]}
    states = sorted(
        (state["status"]["id"], state["position_x"], state["position_y"], state["is_initial"])
        for state in detail["states"]
    )
    transitions = sorted(
        (
            item["name"],
            item["from_any"],
            sorted(by_id[source] for source in item["source_ids"]),
            by_id[item["target_id"]],
            sorted((by_id[source], sides["source"], sides["target"]) for source, sides in item["sides"].items()),
            str(item["rules"]),
        )
        for item in detail["transitions"]
    )
    return states, transitions


@pytest.mark.contract
@pytest.mark.django_db
class TestDuplicate:
    @pytest.fixture
    def rich(self, workspace, users):
        workflow = build_workflow(
            workspace,
            "Rich",
            ["To do", "Doing", "Done"],
            [(["To do"], "Doing", {"roles": [20]}), (["Doing"], "Done", None), ("*", "To do", None)],
        )
        source = workflow.states_by_name["To do"].outgoing_sources.get()
        source.source_side, source.target_side = "right", "left"
        source.save()
        return workflow

    def _post(self, user, workspace, pk, **body):
        return _client(user).post(DUPLICATE_URL.format(slug=workspace.slug, pk=pk), body, format="json")

    def test_the_copy_matches_its_source(self, workspace, users, rich):
        original = _client(users["admin"]).get(WORKFLOW_URL.format(slug=workspace.slug, pk=rich.id)).data
        response = self._post(users["admin"], workspace, rich.id, name="Copy of Rich")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["id"] != str(rich.id)
        assert response.data["name"] == "Copy of Rich"
        assert response.data["project_count"] == 0
        assert _shape(response.data) == _shape(original)
        assert not {state["id"] for state in response.data["states"]} & {state["id"] for state in original["states"]}

    def test_changing_the_copy_leaves_the_source_alone(self, workspace, users, rich):
        client = _client(users["admin"])
        before = _shape(client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=rich.id)).data)
        copy = self._post(users["admin"], workspace, rich.id, name="Copy of Rich").data
        emptied = client.put(
            GRAPH_URL.format(slug=workspace.slug, pk=copy["id"]), {"states": [], "transitions": []}, format="json"
        )
        assert emptied.status_code == status.HTTP_200_OK
        assert _shape(client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=rich.id)).data) == before

    def test_the_copy_of_a_linked_workflow_is_linked_to_nothing(self, workspace, users, project, software):
        link_project(project, software)
        response = self._post(users["admin"], workspace, software.id, name="Copy")
        assert response.data["project_count"] == 0
        assert ProjectWorkflowScheme.objects.count() == 1

    def test_the_duplication_is_audited(self, workspace, users, rich):
        response = self._post(users["admin"], workspace, rich.id, name="Copy of Rich")
        entry = AuditLog.objects.get(action="workflow.duplicated")
        assert str(entry.target_id) == response.data["id"]
        assert entry.after["source_workflow_id"] == str(rich.id)
        assert entry.actor_id == users["admin"].id

    def test_a_taken_or_missing_name_is_refused(self, workspace, users, rich):
        taken = self._post(users["admin"], workspace, rich.id, name="rich")
        missing = self._post(users["admin"], workspace, rich.id)
        assert taken.status_code == missing.status_code == status.HTTP_400_BAD_REQUEST
        assert "name" in taken.data and "name" in missing.data
        assert Workflow.objects.filter(workspace=workspace).count() == 1

    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_other_roles_cannot_duplicate(self, workspace, users, rich, role):
        response = self._post(users[role], workspace, rich.id, name="Nope")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert Workflow.objects.filter(workspace=workspace).count() == 1

    def test_a_workflow_of_another_workspace_looks_missing(self, workspace, users):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        hidden = self._post(users["admin"], workspace, foreign.id, name="Copy")
        missing = self._post(users["admin"], workspace, uuid4(), name="Copy")
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data
```

Run : `docker compose -p wfr-t4 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -k TestDuplicate -v`
Expected : FAIL, 404 sur toutes les requêtes (route absente).

- [ ] **Step 2: Write `graph_copy`**

À la fin de `apps/api/plane/utils/workflow_seed.py`, en ajoutant l'import `from plane.utils.workflow_graph import workflow_graph` :

```python
def graph_copy(workflow):
    """Validated-shape graph reproducing a workflow, keyed by its own state ids (spec 4.3)."""
    graph = workflow_graph(workflow)
    return {
        "states": [
            {
                "key": state["id"],
                "status": {
                    "id": state["status"]["id"],
                    "name": state["status"]["name"],
                    "color": state["status"]["color"],
                },
                "position_x": state["position_x"],
                "position_y": state["position_y"],
                "is_initial": state["is_initial"],
            }
            for state in graph["states"]
        ],
        "transitions": [
            {
                "name": item["name"],
                "from_any": item["from_any"],
                "source_keys": item["source_ids"],
                "target_key": item["target_id"],
                "rules": item["rules"],
                "sides": item["sides"],
            }
            for item in graph["transitions"]
        ],
    }
```

- [ ] **Step 3: Add the endpoint and its route**

Dans `apps/api/plane/app/views/workflow/base.py`, ajouter `graph_copy` à l'import de `plane.utils.workflow_seed` et, après `WorkflowGraphEndpoint` :

```python
class WorkflowDuplicateEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk):
        if not isinstance(request.data, dict):
            return Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
        workspace = Workspace.objects.get(slug=slug)
        source = Workflow.objects.get(workspace_id=workspace.id, pk=pk)
        serializer = WorkflowSerializer(
            data={"name": request.data.get("name"), "description": source.description},
            context={"workspace_id": workspace.id},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                copy = serializer.save(workspace_id=workspace.id)
                record_audit(
                    workspace_id=workspace.id,
                    actor_id=request.user.id,
                    action="workflow.duplicated",
                    target_type="workflow",
                    target_id=copy.id,
                    after={**_workflow_snapshot(copy), "source_workflow_id": str(source.id)},
                )
                # Rows already validated in this workspace: saved as they are (X2).
                save_workflow_graph(workflow=copy, graph=graph_copy(source), actor_id=request.user.id)
        except GraphError as error:
            return Response({"graph": [error.code]}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as error:
            if _constraint_name(error) != WORKFLOW_NAME_CONSTRAINT:
                raise
            return Response({"name": [DUPLICATE_WORKFLOW_NAME_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
        copy.refresh_from_db()
        return Response(workflow_detail(copy, True), status=status.HTTP_201_CREATED)
```

Dans `apps/api/plane/app/views/__init__.py`, ajouter `WorkflowDuplicateEndpoint` à l'import `from .workflow.base import (...)`. Dans `apps/api/plane/app/urls/workflow.py`, l'importer et ajouter après la route `workflow-graph` :

```python
    path(
        "workspaces/<str:slug>/workflows/<uuid:pk>/duplicate/",
        WorkflowDuplicateEndpoint.as_view(),
        name="workflow-duplicate",
    ),
```

- [ ] **Step 4: Run the tests, lint, commit**

Run : `docker compose -p wfr-t4 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests -k workflow -q`
Expected : tout passe, dont les 8 tests de `TestDuplicate`. Puis `docker compose -p wfr-t4 -f docker-compose-test.yml down -v`.

Run (depuis `apps/api`) : `uv run ruff check . && uv run ruff format --check .`

```bash
git add apps/api/plane/utils/workflow_seed.py apps/api/plane/app/views apps/api/plane/app/urls/workflow.py apps/api/plane/tests
git commit -m "feat(api): duplicate a workflow"
```

---

### Task 5: Types, service et store (spec 4.1 à 4.4)

**Files:**

- Modify: `packages/types/src/workflow.ts`
- Modify: `apps/web/services/workflow.service.ts`
- Modify: `apps/web/store/workspace/workflow.store.ts`
- Test: `apps/web/store/workspace/workflow.store.test.ts`

**Interfaces:**

- Consumes : les routes des tâches 2 à 4.
- Produces :
  - types `TWorkflowSide`, `TWorkflowSides`, `TWorkflowStatusCandidate` ; champs facultatifs `TWorkflowTransition.sides`, `TWorkflowGraphPayloadTransition.sides`, `TWorkflowFormData.source_project_id` ;
  - `WorkflowService.listCandidates(workspaceSlug): Promise<TWorkflowStatusCandidate[]>` ;
  - `WorkflowService.duplicate(workspaceSlug, workflowId, name): Promise<TWorkflowDetail>` ;
  - `IWorkflowStore.getWorkspaceCandidates(workspaceSlug): TWorkflowStatusCandidate[]`, `fetchCandidates(workspaceSlug)`, `duplicateWorkflow(workspaceSlug, workflowId, name): Promise<TWorkflowDetail>`.

- [ ] **Step 1: Write the failing store tests**

Dans `apps/web/store/workspace/workflow.store.test.ts`, ajouter `listCandidates: async () => [],` aux méthodes par défaut de `buildStore`, puis à la fin du `describe("WorkflowStore", ...)` :

```ts
it("keeps status candidates per workspace", async () => {
  const store = buildStore({
    listCandidates: async () => [{ name: "Review", color: "#3A3A3A", group: "started" }],
  });
  await store.fetchCandidates("acme");
  expect(store.getWorkspaceCandidates("acme").map((candidate) => candidate.name)).toEqual(["Review"]);
  expect(store.getWorkspaceCandidates("other")).toEqual([]);
});

it("stores a duplicated workflow and refreshes the list", async () => {
  const calls: string[] = [];
  const store = buildStore({
    duplicate: async (_slug: string, id: string, name: string) => {
      calls.push(`${id}:${name}`);
      return detail("copy", name);
    },
  });
  const copy = await store.duplicateWorkflow("acme", "a", "Copy of Alpha");
  expect(calls).toEqual(["a:Copy of Alpha"]);
  expect(copy.id).toBe("copy");
  expect(store.getWorkflowDetail("copy")?.name).toBe("Copy of Alpha");
  expect(store.getWorkspaceWorkflows("acme")).toHaveLength(2);
});

it("refreshes the candidates after a graph save", async () => {
  let reads = 0;
  const store = buildStore({
    listCandidates: async () => {
      reads += 1;
      return [];
    },
  });
  await store.saveGraph("acme", "a", { states: [], transitions: [] });
  expect(reads).toBe(1);
});
```

Run : `pnpm --filter=web exec vitest run store/workspace/workflow.store.test.ts`
Expected : FAIL, `store.fetchCandidates is not a function`, `store.duplicateWorkflow is not a function`, `expected 0 to be 1`.

- [ ] **Step 2: Extend the shared types**

Dans `packages/types/src/workflow.ts`, après `TWorkflowRule` :

```ts
export type TWorkflowSide = "top" | "right" | "bottom" | "left";

/** Sides an arrow leaves and enters by, keyed by source state id (response) or source key (payload). */
export type TWorkflowSides = Record<string, { source: TWorkflowSide; target: TWorkflowSide }>;

export type TWorkflowStatusCandidate = { name: string; color: string; group: TStateGroups };
```

Ajouter `sides?: TWorkflowSides;` à `TWorkflowTransition` et à `TWorkflowGraphPayloadTransition` (après `rules`), et remplacer `TWorkflowFormData` par :

```ts
export type TWorkflowFormData = { name: string; description?: string; source_project_id?: string };
```

- [ ] **Step 3: Extend the service**

Dans `apps/web/services/workflow.service.ts`, ajouter `TWorkflowStatusCandidate` à l'import des types, puis après `removeStatus` :

```ts
  listCandidates(workspaceSlug: string): Promise<TWorkflowStatusCandidate[]> {
    return this.unwrap(this.get(`/api/workspaces/${workspaceSlug}/workflow-statuses/candidates/`));
  }

  duplicate(workspaceSlug: string, workflowId: string, name: string): Promise<TWorkflowDetail> {
    return this.unwrap(this.post(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/duplicate/`, { name }));
  }
```

- [ ] **Step 4: Extend the store**

Dans `apps/web/store/workspace/workflow.store.ts` :

- ajouter `TWorkflowStatusCandidate` à l'import des types ;
- dans `IWorkflowStore`, ajouter :

```ts
  candidatesMap: Record<string, TWorkflowStatusCandidate[]>;
  getWorkspaceCandidates: (workspaceSlug: string) => TWorkflowStatusCandidate[];
  fetchCandidates: (workspaceSlug: string) => Promise<TWorkflowStatusCandidate[]>;
  duplicateWorkflow: (workspaceSlug: string, workflowId: string, name: string) => Promise<TWorkflowDetail>;
```

- avant la classe :

```ts
// One shared array: a new [] on every read would look like a change to readers.
const NO_CANDIDATES: TWorkflowStatusCandidate[] = [];
```

- dans la classe : le champ `candidatesMap: Record<string, TWorkflowStatusCandidate[]> = {};`, les entrées `candidatesMap: observable,`, `fetchCandidates: action,`, `duplicateWorkflow: action,` dans `makeObservable`, et :

```ts
getWorkspaceCandidates = computedFn((workspaceSlug: string) => this.candidatesMap[workspaceSlug] ?? NO_CANDIDATES);

fetchCandidates = async (workspaceSlug: string) => {
  const candidates = await this.service.listCandidates(workspaceSlug);
  runInAction(() => {
    this.candidatesMap[workspaceSlug] = candidates;
  });
  return candidates;
};

duplicateWorkflow = async (workspaceSlug: string, workflowId: string, name: string) => {
  const workflow = await this.service.duplicate(workspaceSlug, workflowId, name);
  runInAction(() => {
    this.detailsMap[workflow.id] = workflow;
  });
  await this.fetchWorkflows(workspaceSlug).catch(() => undefined);
  return workflow;
};
```

- dans `saveGraph`, remplacer la ligne `await Promise.allSettled([...])` par :

```ts
// Counts and shared statuses changed too; a saved candidate is now a status.
await Promise.allSettled([
  this.fetchWorkflows(workspaceSlug),
  this.fetchStatuses(workspaceSlug),
  this.fetchCandidates(workspaceSlug),
]);
```

- [ ] **Step 5: Run the tests, check types, commit**

Run : `pnpm --filter=web exec vitest run store/workspace/workflow.store.test.ts`
Expected : tous les tests du fichier passent.

Run : `pnpm turbo run check:types --filter=web`
Expected : aucune erreur.

```bash
git add packages/types/src/workflow.ts apps/web/services/workflow.service.ts apps/web/store/workspace
git commit -m "feat(web): read status candidates and duplicate workflows in the store"
```

---

### Task 6: Logique du brouillon (spec 3.2, 3.3, 3.7, 4.3, 5.1, X5)

**Files:**

- Modify: `apps/web/components/workflow/editor/graph-model.ts`
- Modify: `apps/web/components/workflow/editor/graph-model.test.ts`
- Create: `apps/web/components/workflow/editor/graph-model.layout.test.ts`
- Modify: `apps/web/components/workflow/editor/workflow-editor.tsx` (un seul appel, pour garder la compilation)

**Interfaces:**

- Consumes : types de la tâche 5.
- Produces (tout est exporté par `graph-model.ts`) :
  - `TDraftStatus.known_group?: TStateGroups` ; `TDraftTransition.sides?: TWorkflowSides` ;
  - `PLACEMENT_STEP = 240` ; `GROUP_COLORS: Record<TStateGroups, string>` ;
  - `type TNewState = { key: string; status: TDraftStatus; globalKey?: string }` ;
  - `addStates(draft, entries: TNewState[]): TDraftGraph` (remplace `addState`, supprimé) ;
  - `closestSides(source: {x, y}, target: {x, y}): { source: TWorkflowSide; target: TWorkflowSide }` ;
  - `connectStates(draft, key, sourceKey, sourceSide, targetKey, targetSide): TDraftGraph` ;
  - `displayGroup(draft, state): TStateGroups` ; `type TStateTone = "todo" | "progress" | "done" | "cancelled"` ; `toneOf(group): TStateTone` ;
  - `type TStatusOption = { id?: string; name: string; color: string; group: TStateGroups; group_is_auto: boolean; workflow_count: number }` ;
  - `statusOptions(statuses, candidates, draft): TStatusOption[]` ; `optionToStatus(option): TDraftStatus` ; `createdStatus(name, group): TDraftStatus` ;
  - `statusNameError(name, draft): "required" | "too_long" | "reserved" | "present" | null` ;
  - `transitionCounts(draft, key): { incoming: number; outgoing: number }` ;
  - `type TTextTransition = { key: string | null; name: string; origin: "start" | "any" | "state"; sourceName?: string }` ; `type TTextRow = { key: string; name: string; group: TStateGroups; transitions: TTextTransition[] }` ; `textRows(draft): TTextRow[]` ;
  - `uniqueName(base: string, taken: string[]): string`.

- [ ] **Step 1: Write the failing tests**

Créer `apps/web/components/workflow/editor/graph-model.layout.test.ts` (avec l'en-tête de copyright) :

```ts
import { describe, expect, it } from "vitest";
import type { TWorkflowDetail, TWorkflowStatus } from "@plane/types";
import {
  addStates,
  closestSides,
  connectStates,
  createdStatus,
  displayGroup,
  fromDetail,
  optionToStatus,
  statusNameError,
  statusOptions,
  textRows,
  toneOf,
  toPayload,
  transitionCounts,
  uniqueName,
  type TDraftGraph,
  type TDraftState,
  type TDraftStatus,
} from "./graph-model";

const status = (name: string, extra: Partial<TDraftStatus> = {}): TDraftStatus => ({
  name,
  color: "#3A3A3A",
  group: null,
  shared_count: 0,
  ...extra,
});
const state = (key: string, extra: Partial<TDraftState> = {}): TDraftState => ({
  key,
  status: status(key),
  position_x: 0,
  position_y: 0,
  is_initial: false,
  ...extra,
});
const EMPTY: TDraftGraph = { states: [], transitions: [] };

describe("addStates", () => {
  it("starts a row at the origin and makes the first state initial", () => {
    const draft = addStates(EMPTY, [
      { key: "a", status: status("A") },
      { key: "b", status: status("B") },
    ]);
    expect(draft.states.map((item) => [item.key, item.position_x, item.position_y, item.is_initial])).toEqual([
      ["a", 0, 0, true],
      ["b", 240, 0, false],
    ]);
  });

  it("lines new states up to the right of the last one", () => {
    const base: TDraftGraph = {
      states: [state("a", { position_x: 100, position_y: 50, is_initial: true })],
      transitions: [],
    };
    const draft = addStates(base, [
      { key: "b", status: status("B") },
      { key: "c", status: status("C") },
    ]);
    expect(draft.states.slice(1).map((item) => [item.position_x, item.position_y, item.is_initial])).toEqual([
      [340, 50, false],
      [580, 50, false],
    ]);
  });

  it("adds a transition from any state when a global key is given", () => {
    const draft = addStates(EMPTY, [{ key: "a", status: status("A"), globalKey: "g" }]);
    expect(draft.transitions).toEqual([
      { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [], sides: {} },
    ]);
  });
});

describe("sides", () => {
  it("picks the closest pair of sides", () => {
    expect(closestSides({ x: 0, y: 0 }, { x: 300, y: 40 })).toEqual({ source: "right", target: "left" });
    expect(closestSides({ x: 300, y: 0 }, { x: 0, y: 40 })).toEqual({ source: "left", target: "right" });
    expect(closestSides({ x: 0, y: 0 }, { x: 40, y: 300 })).toEqual({ source: "bottom", target: "top" });
    expect(closestSides({ x: 0, y: 300 }, { x: 40, y: 0 })).toEqual({ source: "top", target: "bottom" });
  });

  it("records the sides of a drawn arrow and refuses a loop or an unknown state", () => {
    const base: TDraftGraph = { states: [state("a"), state("b")], transitions: [] };
    const draft = connectStates(base, "t", "a", "top", "b", "bottom");
    expect(draft.transitions).toEqual([
      {
        key: "t",
        name: "",
        from_any: false,
        source_keys: ["a"],
        target_key: "b",
        rules: [],
        sides: { a: { source: "top", target: "bottom" } },
      },
    ]);
    expect(connectStates(base, "t", "a", "top", "a", "bottom")).toBe(base);
    expect(connectStates(base, "t", "a", "top", "zz", "bottom")).toBe(base);
  });

  it("round-trips sides and drops those of a removed source", () => {
    const detail: TWorkflowDetail = {
      id: "w",
      name: "W",
      description: "",
      updated_at: null,
      project_count: 0,
      states: [
        {
          id: "a",
          status: { id: "sa", name: "A", color: "#3A3A3A", group: "started", group_is_auto: true },
          position_x: 0,
          position_y: 0,
          is_initial: true,
        },
        {
          id: "b",
          status: { id: "sb", name: "B", color: "#3A3A3A", group: "completed", group_is_auto: false },
          position_x: 240,
          position_y: 0,
          is_initial: false,
        },
      ],
      transitions: [
        {
          id: "t",
          name: "",
          from_any: false,
          source_ids: ["a"],
          target_id: "b",
          rules: [],
          sides: { a: { source: "right", target: "left" } },
        },
      ],
    };
    const draft = fromDetail(detail, []);
    expect(draft.states[0].status.known_group).toBe("started");
    expect(toPayload(draft).transitions[0].sides).toEqual({ a: { source: "right", target: "left" } });
    const edited = {
      ...draft,
      transitions: [
        {
          ...draft.transitions[0],
          sides: { a: { source: "top", target: "left" }, gone: { source: "top", target: "left" } },
        },
      ],
    };
    expect(toPayload(edited as TDraftGraph).transitions[0].sides).toEqual({ a: { source: "top", target: "left" } });
  });
});

describe("categories", () => {
  it("shows the chosen category, then the known one, then the deduced one", () => {
    const draft: TDraftGraph = {
      states: [
        state("chosen", { status: status("Chosen", { group: "cancelled", known_group: "started" }) }),
        state("known", { status: status("Known", { known_group: "backlog" }) }),
        state("first", { is_initial: true }),
        state("middle"),
        state("last"),
      ],
      transitions: [
        { key: "t", name: "", from_any: false, source_keys: ["middle"], target_key: "last", rules: [] },
        { key: "g", name: "", from_any: true, source_keys: [], target_key: "first", rules: [] },
      ],
    };
    expect(draft.states.map((item) => displayGroup(draft, item))).toEqual([
      "cancelled",
      "backlog",
      "unstarted",
      "started",
      "completed",
    ]);
  });

  it("maps the five categories to four tones", () => {
    expect((["backlog", "unstarted", "started", "completed", "cancelled"] as const).map(toneOf)).toEqual([
      "todo",
      "todo",
      "progress",
      "done",
      "cancelled",
    ]);
  });
});

describe("status options", () => {
  const statuses: TWorkflowStatus[] = [
    { id: "s1", name: "Todo", color: "#111111", group: "unstarted", group_is_auto: false, workflow_count: 2 },
    { id: "s2", name: "Used", color: "#222222", group: "started", group_is_auto: true, workflow_count: 1 },
  ];
  const candidates = [
    { name: "Review", color: "#333333", group: "started" as const },
    { name: "todo", color: "#444444", group: "backlog" as const },
  ];
  const draft: TDraftGraph = { states: [state("u", { status: status("used") })], transitions: [] };

  it("lists statuses then candidates, without names already in the workflow or listed twice", () => {
    expect(statusOptions(statuses, candidates, draft).map((option) => option.name)).toEqual(["Todo", "Review"]);
  });

  it("turns an option into a draft status", () => {
    const [existing, candidate] = statusOptions(statuses, candidates, draft);
    expect(optionToStatus(existing)).toEqual({
      id: "s1",
      name: "Todo",
      color: "#111111",
      group: "unstarted",
      known_group: "unstarted",
      shared_count: 2,
    });
    expect(optionToStatus(candidate)).toEqual({
      name: "Review",
      color: "#333333",
      group: "started",
      known_group: "started",
      shared_count: 0,
    });
    expect(optionToStatus({ ...existing, group_is_auto: true }).group).toBeNull();
  });

  it("builds a created status with the colour of its category", () => {
    expect(createdStatus("  New  ", "completed")).toEqual({
      name: "New",
      color: "#16A34A",
      group: "completed",
      shared_count: 0,
    });
    expect(createdStatus("Auto", null)).toEqual({ name: "Auto", color: "#3A3A3A", group: null, shared_count: 0 });
  });

  it("explains why a name cannot be added", () => {
    expect(statusNameError("  ", draft)).toBe("required");
    expect(statusNameError("x".repeat(256), draft)).toBe("too_long");
    expect(statusNameError("Triage", draft)).toBe("reserved");
    expect(statusNameError("USED", draft)).toBe("present");
    expect(statusNameError("Fresh", draft)).toBeNull();
  });
});

describe("text view and counts", () => {
  const draft: TDraftGraph = {
    states: [state("a", { is_initial: true, status: status("A") }), state("b", { status: status("B") })],
    transitions: [
      { key: "t", name: "Go", from_any: false, source_keys: ["a"], target_key: "b", rules: [] },
      { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [] },
    ],
  };

  it("lists the incoming transitions of each state, the start first", () => {
    expect(textRows(draft)).toEqual([
      {
        key: "a",
        name: "A",
        group: "unstarted",
        transitions: [
          { key: null, name: "", origin: "start" },
          { key: "g", name: "", origin: "any" },
        ],
      },
      {
        key: "b",
        name: "B",
        group: "completed",
        transitions: [{ key: "t", name: "Go", origin: "state", sourceName: "A" }],
      },
    ]);
  });

  it("counts incoming and outgoing transitions", () => {
    expect(transitionCounts(draft, "a")).toEqual({ incoming: 1, outgoing: 1 });
    expect(transitionCounts(draft, "b")).toEqual({ incoming: 1, outgoing: 0 });
  });
});

describe("uniqueName", () => {
  it("returns the base, then numbered names, within 255 characters", () => {
    expect(uniqueName("Copy of A", ["A"])).toBe("Copy of A");
    expect(uniqueName("Copy of A", ["copy of a", "Copy of A (2)"])).toBe("Copy of A (3)");
    const long = uniqueName("x".repeat(300), ["x".repeat(255)]);
    expect(long).toHaveLength(255);
    expect(long.endsWith(" (2)")).toBe(true);
  });
});
```

Run : `pnpm --filter=web exec vitest run components/workflow/editor/graph-model.layout.test.ts`
Expected : FAIL à l'import (`addStates` et les autres fonctions ne sont pas exportées).

- [ ] **Step 2: Extend the draft model**

Dans `apps/web/components/workflow/editor/graph-model.ts` :

1. Ajouter à l'import des types : `TWorkflowSide`, `TWorkflowSides`, `TWorkflowStatusCandidate`.

2. Remplacer `TDraftStatus` et `TDraftTransition` par :

```ts
/**
 * group null: the server deduces it (W5). known_group: the category the server or the candidate
 * already has, used for display only (X5). shared_count: other workflows using the status (W17).
 */
export type TDraftStatus = {
  id?: string;
  name: string;
  color: string;
  group: TStateGroups | null;
  known_group?: TStateGroups;
  shared_count: number;
};
```

```ts
export type TDraftTransition = {
  key: string;
  name: string;
  from_any: boolean;
  source_keys: string[];
  target_key: string;
  rules: TWorkflowRule[];
  /** Sides chosen while drawing, keyed by source key; a missing entry means automatic. */
  sides?: TWorkflowSides;
};
```

3. Dans `fromDetail`, ajouter `known_group: state.status.group,` au statut (après `group`), et `sides: { ...transition.sides },` à chaque transition (après `rules`).

4. Dans `toPayload`, ajouter à chaque transition, après `rules` :

```ts
    // Only the sides of sources the transition still has are sent.
    sides: Object.fromEntries(
      Object.entries(transition.sides ?? {}).filter(
        ([key]) => !transition.from_any && transition.source_keys.includes(key)
      )
    ),
```

5. Supprimer la fonction `addState` et la remplacer par :

```ts
export const PLACEMENT_STEP = 240;

export type TNewState = { key: string; status: TDraftStatus; globalKey?: string };

/** New states line up to the right of the last one (R12); globalKey adds a transition from any state. */
export const addStates = (draft: TDraftGraph, entries: TNewState[]): TDraftGraph => {
  const last = draft.states[draft.states.length - 1];
  const hasInitial = draft.states.some((state) => state.is_initial);
  const states = entries.map((entry, index) => ({
    key: entry.key,
    status: entry.status,
    position_x: last ? last.position_x + (index + 1) * PLACEMENT_STEP : index * PLACEMENT_STEP,
    position_y: last?.position_y ?? 0,
    is_initial: !hasInitial && index === 0,
  }));
  const transitions = entries.flatMap((entry) =>
    entry.globalKey
      ? [
          {
            key: entry.globalKey,
            name: "",
            from_any: true,
            source_keys: [],
            target_key: entry.key,
            rules: [],
            sides: {},
          },
        ]
      : []
  );
  return { states: [...draft.states, ...states], transitions: [...draft.transitions, ...transitions] };
};
```

6. À la fin du fichier :

```ts
type TPoint = { x: number; y: number };

/** Sides used when an arrow was not drawn by hand: the pair facing each other. */
export const closestSides = (source: TPoint, target: TPoint): { source: TWorkflowSide; target: TWorkflowSide } => {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
  return dy >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
};

export const connectStates = (
  draft: TDraftGraph,
  key: string,
  sourceKey: string,
  sourceSide: TWorkflowSide,
  targetKey: string,
  targetSide: TWorkflowSide
): TDraftGraph => {
  const known = (stateKey: string) => draft.states.some((state) => state.key === stateKey);
  if (sourceKey === targetKey || !known(sourceKey) || !known(targetKey)) return draft;
  return addTransition(draft, {
    key,
    name: "",
    from_any: false,
    source_keys: [sourceKey],
    target_key: targetKey,
    rules: [],
    sides: { [sourceKey]: { source: sourceSide, target: targetSide } },
  });
};

/** Category shown for a state: chosen, else known, else deduced like the server does (W5, X5). */
export const displayGroup = (draft: TDraftGraph, state: TDraftState): TStateGroups => {
  if (state.status.group) return state.status.group;
  if (state.status.known_group) return state.status.known_group;
  if (state.is_initial) return "unstarted";
  const leaves = draft.transitions.some(
    (transition) => !transition.from_any && transition.source_keys.includes(state.key)
  );
  return leaves ? "started" : "completed";
};

export type TStateTone = "todo" | "progress" | "done" | "cancelled";

export const toneOf = (group: TStateGroups): TStateTone => {
  if (group === "started") return "progress";
  if (group === "completed") return "done";
  if (group === "cancelled") return "cancelled";
  return "todo";
};

/** Colour given to a status created in the editor: the default Plane colour of its category. */
export const GROUP_COLORS: Record<TStateGroups, string> = {
  backlog: "#A3A3A3",
  unstarted: "#3A3A3A",
  started: "#F59E0B",
  completed: "#16A34A",
  cancelled: "#EF4444",
};

export type TStatusOption = {
  id?: string;
  name: string;
  color: string;
  group: TStateGroups;
  group_is_auto: boolean;
  workflow_count: number;
};

/** "Search or create" list (R7): workspace statuses, then project states, minus names already used. */
export const statusOptions = (
  statuses: TWorkflowStatus[],
  candidates: TWorkflowStatusCandidate[],
  draft: TDraftGraph
): TStatusOption[] => {
  const seen = new Set(draft.states.map((state) => state.status.name.trim().toLowerCase()));
  const all: TStatusOption[] = [
    ...statuses.map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      group: item.group,
      group_is_auto: item.group_is_auto,
      workflow_count: item.workflow_count ?? 0,
    })),
    ...candidates.map((item) => ({ ...item, group_is_auto: false, workflow_count: 0 })),
  ];
  return all.filter((option) => {
    const key = option.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const optionToStatus = (option: TStatusOption): TDraftStatus => ({
  ...(option.id ? { id: option.id } : {}),
  name: option.name,
  color: option.color,
  group: option.group_is_auto ? null : option.group,
  known_group: option.group,
  shared_count: option.workflow_count,
});

export const createdStatus = (name: string, group: TStateGroups | null): TDraftStatus => ({
  name: name.trim(),
  color: GROUP_COLORS[group ?? "unstarted"],
  group,
  shared_count: 0,
});

export const statusNameError = (
  name: string,
  draft: TDraftGraph
): "required" | "too_long" | "reserved" | "present" | null => {
  const key = name.trim().toLowerCase();
  if (!key) return "required";
  if (key.length > 255) return "too_long";
  if (RESERVED_STATUS_NAMES.has(key)) return "reserved";
  if (draft.states.some((state) => state.status.name.trim().toLowerCase() === key)) return "present";
  return null;
};

export const transitionCounts = (draft: TDraftGraph, key: string) => ({
  incoming: draft.transitions.filter((transition) => transition.target_key === key).length,
  outgoing: draft.transitions.filter((transition) => !transition.from_any && transition.source_keys.includes(key))
    .length,
});

export type TTextTransition = {
  key: string | null;
  name: string;
  origin: "start" | "any" | "state";
  sourceName?: string;
};
export type TTextRow = { key: string; name: string; group: TStateGroups; transitions: TTextTransition[] };

/** Text view (spec 3.7): each state with the transitions that lead to it, the start first. */
export const textRows = (draft: TDraftGraph): TTextRow[] => {
  const nameOf = (key: string) => draft.states.find((state) => state.key === key)?.status.name ?? "";
  return draft.states.map((state) => ({
    key: state.key,
    name: state.status.name,
    group: displayGroup(draft, state),
    transitions: [
      ...(state.is_initial ? [{ key: null, name: "", origin: "start" as const }] : []),
      ...draft.transitions
        .filter((transition) => transition.target_key === state.key)
        .flatMap((transition): TTextTransition[] =>
          transition.from_any
            ? [{ key: transition.key, name: transition.name, origin: "any" }]
            : transition.source_keys.map((source) => ({
                key: transition.key,
                name: transition.name,
                origin: "state",
                sourceName: nameOf(source),
              }))
        ),
    ],
  }));
};

/** First free name among base, "base (2)", "base (3)"..., kept within 255 characters (spec 4.3). */
export const uniqueName = (base: string, taken: string[]): string => {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? "" : ` (${index})`;
    const candidate = `${base.trim().slice(0, 255 - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
};
```

- [ ] **Step 3: Keep the callers compiling**

`addState` avait deux utilisateurs.

Dans `apps/web/components/workflow/editor/graph-model.test.ts` : supprimer le ou les tests qui appellent `addState` (repérer avec `grep -n "addState" apps/web/components/workflow/editor/graph-model.test.ts`) et retirer `addState` de l'import ; le placement est désormais couvert par `graph-model.layout.test.ts`.

Dans `apps/web/components/workflow/editor/workflow-editor.tsx` : remplacer `addState` par `addStates` dans l'import et, dans la prop `onAdd` de `AddStateForm`, remplacer l'appel par :

```tsx
            onAdd={(status) => setDraft((current) => addStates(current, [{ key: `new-${uuidv4()}`, status }]))}
```

Cet appel disparaît à la tâche 8 ; il ne sert qu'à garder chaque commit compilable.

- [ ] **Step 4: Run the tests, check types, commit**

Run : `pnpm --filter=web exec vitest run components/workflow`
Expected : tous les fichiers de test passent, dont les 15 tests de `graph-model.layout.test.ts`.

Run : `pnpm turbo run check:types check:lint --filter=web`
Expected : aucune erreur.

```bash
git add apps/web/components/workflow/editor
git commit -m "feat(web): model arrow sides, placement and status options in the draft"
```

---

### Task 7: Textes en et fr, puis les 20 autres locales

**Files:**

- Modify: `packages/i18n/src/locales/en/workflow.json`
- Modify: `packages/i18n/src/locales/fr/workflow.json`
- Modify: `packages/i18n/src/locales/<les 20 autres>/workflow.json` (skill `translate`)

**Interfaces:**

- Produces : les clés ci-dessous, toutes sous `workflows`. Les tâches 8 à 13 n'utilisent que ces clés et celles qui existent déjà.

- [ ] **Step 1: Add the English keys**

Dans `packages/i18n/src/locales/en/workflow.json`, sous `workflows`, fusionner les clés suivantes dans les objets existants (ne supprimer aucune clé existante ; `editor.read_only` et `editor.global` changent de valeur) :

```json
{
  "editor": {
    "close": "Close",
    "read_only": "You are not allowed to edit this workflow.",
    "small_screen": "Open this workflow on a wider screen to edit it.",
    "global": "Any state",
    "used_in": "{count, plural, one {Used in # project} other {Used in # projects}}",
    "show_labels": "Show transition labels",
    "zoom": "Zoom",
    "minimap": "Mini-map",
    "state_label": "State {name}, category {group}, {incoming} incoming, {outgoing} outgoing",
    "view": { "label": "View", "diagram": "Diagram", "text": "Text" },
    "add_rule": {
      "title": "Add a rule",
      "transition": "Transition",
      "none": "Add a transition first.",
      "submit": "Apply"
    },
    "add_state": {
      "description": "A state shows how far a work item has progressed. Pick existing states or type a name to create one.",
      "search": "Search or create",
      "create_option": "Create \"{name}\"",
      "allow_any": "Allow transitions from any state",
      "none": "No state matches.",
      "selected": "{count, plural, one {# selected} other {# selected}}",
      "errors": {
        "too_long": "The name must be 255 characters or fewer.",
        "present": "This workflow already has a state with this name.",
        "reserved": "This name is reserved."
      }
    },
    "panel": {
      "empty_title": "Build custom workflows",
      "empty_body": "Workflows match the way your team works. Add states, which become the columns of your project board, then link them with transitions and limit who may use them with rules.",
      "empty_hint": "Select a state to see its details.",
      "color": "Board column color",
      "incoming": "Incoming",
      "outgoing": "Outgoing",
      "add_incoming": "Add an incoming transition",
      "add_outgoing": "Add an outgoing transition",
      "collapse": "Collapse panel",
      "expand": "Expand panel"
    },
    "text": {
      "state": "State",
      "transitions": "Transitions",
      "origin_start": "Start",
      "origin_any": "Any state",
      "unnamed": "Unnamed transition",
      "toggle": "Show or hide the transitions of {name}",
      "empty": "This workflow has no state yet."
    }
  },
  "settings": {
    "edit": "Edit",
    "columns": { "description": "Description", "updated": "Updated", "actions": "Actions" },
    "duplicate": {
      "action": "Duplicate",
      "copy_name": "Copy of {name}",
      "success": "Workflow duplicated"
    },
    "form": {
      "source_project": "Start from project",
      "source_project_none": "No project (empty workflow)"
    }
  },
  "scheme": {
    "link": "Link to a workflow",
    "change": "Change workflows",
    "view_workflow": "View",
    "edit_workflow": "Edit workflow",
    "other_types": "All other types",
    "table": { "workflow": "Workflow", "types": "Work item types", "actions": "Actions" }
  }
}
```

- [ ] **Step 2: Add the French keys**

Dans `packages/i18n/src/locales/fr/workflow.json`, sous `workflows`, de la même façon (et mettre `editor.start` à `"DÉMARRER"`) :

```json
{
  "editor": {
    "close": "Fermer",
    "read_only": "Vous n'êtes pas autorisé à modifier ce workflow.",
    "small_screen": "Ouvrez ce workflow sur un écran plus large pour le modifier.",
    "start": "DÉMARRER",
    "global": "N'importe lequel",
    "used_in": "{count, plural, one {Utilisé dans # projet} other {Utilisé dans # projets}}",
    "show_labels": "Afficher les étiquettes de transition",
    "zoom": "Zoom",
    "minimap": "Mini-carte",
    "state_label": "État {name}, catégorie {group}, {incoming} entrantes, {outgoing} sortantes",
    "view": { "label": "Vue", "diagram": "Diagramme", "text": "Texte" },
    "add_rule": {
      "title": "Ajouter une règle",
      "transition": "Transition",
      "none": "Ajoutez d'abord une transition.",
      "submit": "Appliquer"
    },
    "add_state": {
      "description": "Un état indique la progression du ticket. Choisissez des états existants ou saisissez un nom pour en créer un.",
      "search": "Rechercher ou créer",
      "create_option": "Créer « {name} »",
      "allow_any": "Autoriser les transitions depuis n'importe quel état",
      "none": "Aucun état ne correspond.",
      "selected": "{count, plural, one {# sélectionné} other {# sélectionnés}}",
      "errors": {
        "too_long": "Le nom doit faire 255 caractères au plus.",
        "present": "Ce workflow a déjà un état de ce nom.",
        "reserved": "Ce nom est réservé."
      }
    },
    "panel": {
      "empty_title": "Créer des workflows sur mesure",
      "empty_body": "Les workflows correspondent à la façon de travailler de votre équipe. Ajoutez des états, qui deviennent les colonnes du tableau de votre projet, reliez-les par des transitions et limitez par des règles qui peut les emprunter.",
      "empty_hint": "Sélectionnez un état pour consulter ses informations.",
      "color": "Couleur de la colonne du tableau",
      "incoming": "Entrant",
      "outgoing": "Sortant",
      "add_incoming": "Ajouter une transition entrante",
      "add_outgoing": "Ajouter une transition sortante",
      "collapse": "Réduire le panneau",
      "expand": "Ouvrir le panneau"
    },
    "text": {
      "state": "État",
      "transitions": "Transitions",
      "origin_start": "Début",
      "origin_any": "Tous les états",
      "unnamed": "Transition sans nom",
      "toggle": "Afficher ou masquer les transitions de {name}",
      "empty": "Ce workflow n'a encore aucun état."
    }
  },
  "settings": {
    "edit": "Modifier",
    "columns": { "description": "Description", "updated": "Modifié le", "actions": "Actions" },
    "duplicate": {
      "action": "Dupliquer",
      "copy_name": "Copie de {name}",
      "success": "Workflow dupliqué"
    },
    "form": {
      "source_project": "Partir du projet",
      "source_project_none": "Aucun projet (workflow vide)"
    }
  },
  "scheme": {
    "link": "Relier à un workflow",
    "change": "Changer les workflows",
    "view_workflow": "Voir",
    "edit_workflow": "Modifier le workflow",
    "other_types": "Tous les autres types",
    "table": { "workflow": "Workflow", "types": "Types de ticket", "actions": "Actions" }
  }
}
```

- [ ] **Step 3: Translate the 20 other locales**

Invoquer le skill `translate` pour les clés ajoutées ou modifiées aux étapes 1 et 2, dans les 20 autres locales de `packages/i18n/src/locales`. Le skill impose : formes plurielles CLDR de chaque langue pour `editor.used_in` et `editor.add_state.selected`, espaces réservés `{name}`, `{group}`, `{incoming}`, `{outgoing}`, `{count}` conservés tels quels, guillemets de la langue pour `create_option`, aucun texte anglais recopié.

- [ ] **Step 4: Check the locales and commit**

Run : `pnpm --filter=@plane/i18n sync:check`
Expected : `All locales are in sync with English. No issues found.`

Run : `pnpm exec oxfmt --check packages/i18n/src/locales`
Expected : aucun fichier à reformater (sinon `pnpm exec oxfmt packages/i18n/src/locales`).

```bash
git add packages/i18n/src/locales
git commit -m "feat(i18n): add the texts of the redesigned workflow screens"
```

---

### Task 8: Tests d'affichage et fenêtres de l'éditeur (spec 3.3, 3.4, 3.5, R8, R19, X8, X12)

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/web/vitest.config.ts`
- Create: `apps/web/vitest.setup.dom.ts`
- Create: `apps/web/components/workflow/editor/add-status-dialog.tsx`
- Create: `apps/web/components/workflow/editor/add-status-dialog.test.tsx`
- Create: `apps/web/components/workflow/editor/add-transition-dialog.tsx`
- Create: `apps/web/components/workflow/editor/add-rule-dialog.tsx`

**Interfaces:**

- Consumes : `statusNameError`, `optionToStatus`, `createdStatus`, `TStatusOption`, `TDraftGraph`, `TDraftStatus`, `TDraftTransition` (Task 6) ; `RestrictActorsForm` (existant, props `params`, `readOnly`, `onChange`) ; clés i18n de la tâche 7.
- Produces :
  - `AddStatusDialog({ isOpen, draft, options, onClose, onAdd })`, avec `onAdd: (statuses: TDraftStatus[], allowAny: boolean) => void` ;
  - `AddTransitionDialog({ isOpen, draft, preset, onClose, onAdd })`, avec `preset: { sourceKey?: string; targetKey?: string } | null` et `onAdd: (transition: Omit<TDraftTransition, "key">) => void` ;
  - `AddRuleDialog({ isOpen, draft, presetKey, onClose, onApply })`, avec `presetKey: string | null` et `onApply: (transitionKey: string, params: TWorkflowRestrictActorsParams | null) => void` ;
  - le projet vitest `dom` : tout fichier `*.test.tsx` de `apps/web` tourne sous `jsdom`.

- [ ] **Step 1: Add the DOM test project**

Dans `apps/web/package.json`, ajouter à `devDependencies` (ordre alphabétique) :

```json
    "@testing-library/react": "catalog:",
    "@testing-library/user-event": "catalog:",
    "jsdom": "catalog:",
```

Run : `pnpm install`
Expected : le fichier de verrouillage ne change que pour `apps/web` ; les trois versions sont celles du catalogue (16.3.3, 14.6.1, 23.2.0).

Remplacer le bloc `test` de `apps/web/vitest.config.ts` par :

```ts
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: ["node_modules/**", "build/**", ".react-router/**"],
        },
      },
      {
        // Component tests that need a DOM but not a real browser, like packages/blocks (X12).
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          exclude: ["node_modules/**", "build/**", ".react-router/**"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
    ],
  },
```

Créer `apps/web/vitest.setup.dom.ts` (avec l'en-tête de copyright) :

```ts
// jsdom runs no layout; patching its prototypes is this file's purpose.
/* oxlint-disable no-extend-native */

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// React Flow measures nodes through these (reactflow.dev, "Testing"); the observer reports at once.
class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

class TestDOMMatrixReadOnly {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}

globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
(globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = TestDOMMatrixReadOnly;

Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    get(this: HTMLElement) {
      return parseFloat(this.style.height) || 1;
    },
  },
  offsetWidth: {
    get(this: HTMLElement) {
      return parseFloat(this.style.width) || 1;
    },
  },
});
(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;

// The editor reads the viewport width once (X13); jsdom has no matchMedia.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

afterEach(() => cleanup());
```

Si une fenêtre de `@makeplane/propel` ne s'affiche pas sous `jsdom`, reprendre les bouchons de `packages/blocks/vitest.setup.dom.ts` (observateurs, défilement) dans ce fichier, sans rien retirer.

- [ ] **Step 2: Write the failing dialog tests**

Créer `apps/web/components/workflow/editor/add-status-dialog.test.tsx` (avec l'en-tête de copyright) :

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddStatusDialog } from "./add-status-dialog";
import type { TDraftGraph, TStatusOption } from "./graph-model";

// The key stands for the text; a new t on every render mirrors the real hook.
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const options: TStatusOption[] = [
  { id: "s1", name: "Todo", color: "#111111", group: "unstarted", group_is_auto: false, workflow_count: 2 },
  { name: "Review", color: "#333333", group: "started", group_is_auto: false, workflow_count: 0 },
  { name: "Done", color: "#444444", group: "completed", group_is_auto: false, workflow_count: 0 },
];
const draft: TDraftGraph = {
  states: [
    {
      key: "u",
      status: { name: "Used", color: "#3A3A3A", group: null, shared_count: 0 },
      position_x: 0,
      position_y: 0,
      is_initial: true,
    },
  ],
  transitions: [],
};
const ADD = "workflows.editor.add_state.submit";

const open = (onAdd = vi.fn()) => {
  render(<AddStatusDialog isOpen draft={draft} options={options} onClose={() => {}} onAdd={onAdd} />);
  return { onAdd, user: userEvent.setup() };
};

describe("AddStatusDialog", () => {
  it("adds every ticked state in one go", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: /Todo/ }));
    await user.click(screen.getByRole("checkbox", { name: /Review/ }));
    await user.click(screen.getByRole("button", { name: ADD }));
    expect(onAdd).toHaveBeenCalledWith(
      [
        { id: "s1", name: "Todo", color: "#111111", group: "unstarted", known_group: "unstarted", shared_count: 2 },
        { name: "Review", color: "#333333", group: "started", known_group: "started", shared_count: 0 },
      ],
      false
    );
  });

  it("keeps the add button disabled until a state is picked", async () => {
    const { user } = open();
    expect(screen.getByRole("button", { name: ADD })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("checkbox", { name: /Done/ }));
    expect(screen.getByRole("button", { name: ADD })).toHaveProperty("disabled", false);
  });

  it("filters the list and creates a state from the typed name", async () => {
    const { onAdd, user } = open();
    await user.type(screen.getByRole("textbox", { name: "workflows.editor.add_state.name" }), "Fresh");
    expect(screen.queryByRole("checkbox", { name: /Todo/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "workflows.editor.add_state.create_option" }));
    await user.click(screen.getByRole("checkbox", { name: "workflows.editor.add_state.allow_any" }));
    await user.click(screen.getByRole("button", { name: ADD }));
    expect(onAdd).toHaveBeenCalledWith([{ name: "Fresh", color: "#3A3A3A", group: null, shared_count: 0 }], true);
  });

  it("refuses a name the workflow already has", async () => {
    const { user } = open();
    await user.type(screen.getByRole("textbox", { name: "workflows.editor.add_state.name" }), "used");
    expect(screen.queryByRole("button", { name: "workflows.editor.add_state.create_option" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("workflows.editor.add_state.errors.present");
  });
});
```

Run : `pnpm --filter=web exec vitest run components/workflow/editor/add-status-dialog.test.tsx`
Expected : FAIL, le module `./add-status-dialog` n'existe pas. (Ce premier lancement prouve aussi que le projet `dom` démarre.)

- [ ] **Step 3: Write `AddStatusDialog`**

Créer `apps/web/components/workflow/editor/add-status-dialog.tsx` (avec l'en-tête de copyright) :

```tsx
import { useEffect, useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups } from "@plane/types";
// local imports
import {
  createdStatus,
  optionToStatus,
  statusNameError,
  type TDraftGraph,
  type TDraftStatus,
  type TStatusOption,
} from "./graph-model";

type Props = {
  isOpen: boolean;
  draft: TDraftGraph;
  options: TStatusOption[];
  onClose: () => void;
  onAdd: (statuses: TDraftStatus[], allowAny: boolean) => void;
};

type TCreated = { name: string; group: TStateGroups | null };

const GROUPS: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];
const keyOf = (name: string) => name.trim().toLowerCase();

export function AddStatusDialog({ isOpen, draft, options, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [created, setCreated] = useState<TCreated[]>([]);
  const [allowAny, setAllowAny] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setChecked([]);
    setCreated([]);
    setAllowAny(false);
  }, [isOpen]);

  const needle = keyOf(query);
  const visible = options.filter((option) => keyOf(option.name).includes(needle));
  const isListed =
    options.some((option) => keyOf(option.name) === needle) || created.some((item) => keyOf(item.name) === needle);
  const createError = needle !== "" && !isListed ? statusNameError(query, draft) : null;
  const canCreate = needle !== "" && !isListed && createError === null;
  const count = checked.length + created.length;

  const toggle = (name: string) =>
    setChecked((current) =>
      current.includes(keyOf(name)) ? current.filter((key) => key !== keyOf(name)) : [...current, keyOf(name)]
    );

  const submit = () =>
    onAdd(
      [
        ...options.filter((option) => checked.includes(keyOf(option.name))).map(optionToStatus),
        ...created.map((item) => createdStatus(item.name, item.group)),
      ],
      allowAny
    );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (count > 0) submit();
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t("workflows.editor.add_state.title")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-4">
                <p className="text-body-sm-regular text-secondary">{t("workflows.editor.add_state.description")}</p>
                <InputField
                  size="md"
                  orientation="vertical"
                  id="workflow-status-search"
                  name="status-search"
                  type="text"
                  label={t("workflows.editor.add_state.name")}
                  placeholder={t("workflows.editor.add_state.search")}
                  value={query}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                />
                {createError && createError !== "required" && (
                  <p role="alert" className="text-body-xs-regular text-danger-primary">
                    {t(`workflows.editor.add_state.errors.${createError}`)}
                  </p>
                )}
                <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={t("workflows.editor.add_state.search")}>
                  {visible.map((option) => (
                    <li key={keyOf(option.name)}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-layer-1">
                        <input
                          type="checkbox"
                          checked={checked.includes(keyOf(option.name))}
                          onChange={() => toggle(option.name)}
                        />
                        <span className="flex-1 text-body-sm-regular text-primary">{option.name}</span>
                        <span className="text-caption-sm-regular text-tertiary">
                          {t(`workflows.groups.${option.group}`)}
                        </span>
                      </label>
                    </li>
                  ))}
                  {visible.length === 0 && !canCreate && (
                    <li className="px-2 py-1.5 text-body-sm-regular text-tertiary">
                      {t("workflows.editor.add_state.none")}
                    </li>
                  )}
                </ul>
                {canCreate && (
                  <Button
                    variant="secondary"
                    size="sm"
                    stretch="auto"
                    label={t("workflows.editor.add_state.create_option", { name: query.trim() })}
                    onClick={() => {
                      setCreated((current) => [...current, { name: query.trim(), group: null }]);
                      setQuery("");
                    }}
                  />
                )}
                {created.map((item) => (
                  <div key={keyOf(item.name)} className="flex items-center gap-2 rounded-md bg-layer-1 px-2 py-1.5">
                    <span className="flex-1 text-body-sm-regular text-primary">{item.name}</span>
                    <select
                      className="rounded-md border border-subtle bg-layer-1 px-2 py-1"
                      aria-label={`${t("workflows.editor.add_state.group")} ${item.name}`}
                      value={item.group ?? ""}
                      onChange={(event) =>
                        setCreated((current) =>
                          current.map((other) =>
                            other === item
                              ? { ...other, group: (event.target.value || null) as TStateGroups | null }
                              : other
                          )
                        )
                      }
                    >
                      <option value="">{t("workflows.editor.add_state.group_auto")}</option>
                      {GROUPS.map((group) => (
                        <option key={group} value={group}>
                          {t(`workflows.groups.${group}`)}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      stretch="auto"
                      label={`${t("workflows.editor.panel.remove_state")} ${item.name}`}
                      onClick={() => setCreated((current) => current.filter((other) => other !== item))}
                    />
                  </div>
                ))}
                <label className="flex items-center gap-2 text-body-sm-regular text-secondary">
                  <input type="checkbox" checked={allowAny} onChange={(event) => setAllowAny(event.target.checked)} />
                  {t("workflows.editor.add_state.allow_any")}
                </label>
                <p aria-live="polite" className="text-caption-sm-regular text-tertiary">
                  {count > 0 ? t("workflows.editor.add_state.selected", { count }) : ""}
                </p>
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              label={t("workflows.settings.form.cancel")}
              onClick={onClose}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              disabled={count === 0}
              label={t("workflows.editor.add_state.submit")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Run : `pnpm --filter=web exec vitest run components/workflow/editor/add-status-dialog.test.tsx`
Expected : 4 passed.

- [ ] **Step 4: Write `AddTransitionDialog`**

Créer `apps/web/components/workflow/editor/add-transition-dialog.tsx` (avec l'en-tête de copyright) :

```tsx
import { useEffect, useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
// local imports
import type { TDraftGraph, TDraftTransition } from "./graph-model";

type Props = {
  isOpen: boolean;
  draft: TDraftGraph;
  preset: { sourceKey?: string; targetKey?: string } | null;
  onClose: () => void;
  onAdd: (transition: Omit<TDraftTransition, "key">) => void;
};

export function AddTransitionDialog({ isOpen, draft, preset, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  const [fromAny, setFromAny] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const presetSource = preset?.sourceKey;
  const presetTarget = preset?.targetKey;

  useEffect(() => {
    if (!isOpen) return;
    setFromAny(false);
    setSources(presetSource ? [presetSource] : []);
    setTarget(presetTarget ?? "");
    setName("");
  }, [isOpen, presetSource, presetTarget]);

  const isValid = target !== "" && (fromAny || sources.length > 0) && (fromAny || !sources.includes(target));

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isValid) return;
            onAdd({
              name: name.trim(),
              from_any: fromAny,
              source_keys: fromAny ? [] : sources,
              target_key: target,
              rules: [],
              sides: {},
            });
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t("workflows.editor.add_transition.title")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-4">
                <fieldset className="space-y-1">
                  <legend className="text-body-xs-medium text-secondary">
                    {t("workflows.editor.add_transition.sources")}
                  </legend>
                  <label className="flex items-center gap-2 text-body-sm-regular text-primary">
                    <input type="checkbox" checked={fromAny} onChange={(event) => setFromAny(event.target.checked)} />
                    {t("workflows.editor.add_transition.any_state")}
                  </label>
                  {draft.states.map((state) => (
                    <label key={state.key} className="flex items-center gap-2 text-body-sm-regular text-primary">
                      <input
                        type="checkbox"
                        disabled={fromAny || state.key === target}
                        checked={!fromAny && sources.includes(state.key)}
                        onChange={() =>
                          setSources((current) =>
                            current.includes(state.key)
                              ? current.filter((key) => key !== state.key)
                              : [...current, state.key]
                          )
                        }
                      />
                      {state.status.name}
                    </label>
                  ))}
                </fieldset>
                <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
                  {t("workflows.editor.add_transition.target")}
                  <select
                    className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
                    value={target}
                    onChange={(event) => {
                      setTarget(event.target.value);
                      setSources((current) => current.filter((key) => key !== event.target.value));
                    }}
                  >
                    <option value="" disabled>
                      {t("workflows.scheme.choose")}
                    </option>
                    {draft.states.map((state) => (
                      <option key={state.key} value={state.key}>
                        {state.status.name}
                      </option>
                    ))}
                  </select>
                </label>
                <InputField
                  size="md"
                  orientation="vertical"
                  id="workflow-transition-new-name"
                  name="transition-name"
                  type="text"
                  label={t("workflows.editor.add_transition.name")}
                  value={name}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
                />
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              label={t("workflows.settings.form.cancel")}
              onClick={onClose}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              disabled={!isValid}
              label={t("workflows.editor.add_transition.submit")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Write `AddRuleDialog`**

Créer `apps/web/components/workflow/editor/add-rule-dialog.tsx` (avec l'en-tête de copyright) :

```tsx
import { useEffect, useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowRestrictActorsParams } from "@plane/types";
// local imports
import type { TDraftGraph, TDraftTransition } from "./graph-model";
import { RestrictActorsForm } from "./restrict-actors-form";

type Props = {
  isOpen: boolean;
  draft: TDraftGraph;
  presetKey: string | null;
  onClose: () => void;
  onApply: (transitionKey: string, params: TWorkflowRestrictActorsParams | null) => void;
};

export function AddRuleDialog({ isOpen, draft, presetKey, onClose, onApply }: Props) {
  const { t } = useTranslation();
  const [transitionKey, setTransitionKey] = useState("");
  const [params, setParams] = useState<TWorkflowRestrictActorsParams | null>(null);
  const firstKey = draft.transitions[0]?.key ?? "";

  useEffect(() => {
    if (isOpen) setTransitionKey(presetKey ?? firstKey);
  }, [isOpen, presetKey, firstKey]);

  const transition = draft.transitions.find((item) => item.key === transitionKey);
  const currentParams = transition?.rules[0]?.params ?? null;
  // Each transition shows its own rule when it is picked.
  useEffect(() => setParams(currentParams), [transitionKey, isOpen]); // oxlint-disable-line react-hooks/exhaustive-deps

  const nameOf = (key: string) => draft.states.find((state) => state.key === key)?.status.name ?? "";
  const labelOf = (item: TDraftTransition) => {
    const origin = item.from_any ? t("workflows.editor.global") : item.source_keys.map(nameOf).join(", ");
    const route = `${origin} → ${nameOf(item.target_key)}`;
    return item.name ? `${item.name} (${route})` : route;
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (transition) onApply(transition.key, params);
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t("workflows.editor.add_rule.title")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              {draft.transitions.length === 0 ? (
                <p className="text-body-sm-regular text-secondary">{t("workflows.editor.add_rule.none")}</p>
              ) : (
                <div className="space-y-4">
                  <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
                    {t("workflows.editor.add_rule.transition")}
                    <select
                      className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
                      value={transitionKey}
                      onChange={(event) => setTransitionKey(event.target.value)}
                    >
                      {draft.transitions.map((item) => (
                        <option key={item.key} value={item.key}>
                          {labelOf(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <RestrictActorsForm params={params} readOnly={false} onChange={setParams} />
                </div>
              )}
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              label={t("workflows.settings.form.cancel")}
              onClick={onClose}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              disabled={!transition}
              label={t("workflows.editor.add_rule.submit")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Run every web test, check, commit**

Run : `pnpm turbo run test check:types check:lint --filter=web`
Expected : les projets `unit` et `dom` passent ; aucune erreur de type ni de lint.

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/vitest.config.ts apps/web/vitest.setup.dom.ts apps/web/components/workflow/editor
git commit -m "feat(web): add the status, transition and rule dialogs of the editor"
```

---

### Task 9: Vue Texte (spec 3.7, 5.1)

**Files:**

- Create: `apps/web/components/workflow/editor/tones.ts`
- Create: `apps/web/components/workflow/editor/text-view.tsx`
- Create: `apps/web/components/workflow/editor/text-view.test.tsx`

**Interfaces:**

- Consumes : `textRows`, `toneOf`, `TStateTone`, `TDraftGraph` (Task 6) ; le type `TEditorSelection` exporté par `workflow-canvas.tsx` (`{ kind: "state" | "transition"; key: string } | null`, inchangé par la tâche 10).
- Produces :
  - `TONE_CLASS: Record<TStateTone, string>` (classes de fond, de texte et de bordure) ;
  - `WorkflowTextView({ draft, selection, onSelect })`, avec `onSelect: (selection: TEditorSelection) => void`.

- [ ] **Step 1: Write the failing test**

Créer `apps/web/components/workflow/editor/text-view.test.tsx` (avec l'en-tête de copyright) :

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph } from "./graph-model";
import { WorkflowTextView } from "./text-view";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const draft: TDraftGraph = {
  states: [
    {
      key: "a",
      status: { name: "Todo", color: "#3A3A3A", group: null, shared_count: 0 },
      position_x: 0,
      position_y: 0,
      is_initial: true,
    },
    {
      key: "b",
      status: { name: "Done", color: "#3A3A3A", group: null, shared_count: 0 },
      position_x: 240,
      position_y: 0,
      is_initial: false,
    },
  ],
  transitions: [
    { key: "t", name: "Finish", from_any: false, source_keys: ["a"], target_key: "b", rules: [] },
    { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [] },
  ],
};

describe("WorkflowTextView", () => {
  it("lists every state with the transitions that lead to it", () => {
    render(<WorkflowTextView draft={draft} selection={null} onSelect={() => {}} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Todo");
    expect(rows[0].textContent).toContain("workflows.editor.text.origin_start");
    expect(rows[0].textContent).toContain("workflows.editor.text.origin_any");
    expect(rows[1].textContent).toContain("Finish");
    expect(rows[1].textContent).toContain("Todo → Done");
  });

  it("selects a state or a transition", async () => {
    const onSelect = vi.fn();
    render(<WorkflowTextView draft={draft} selection={null} onSelect={onSelect} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "state", key: "b" });
    await user.click(screen.getByRole("button", { name: /Finish/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "t" });
  });

  it("hides the transitions of a collapsed state", async () => {
    render(<WorkflowTextView draft={draft} selection={null} onSelect={() => {}} />);
    const toggles = screen.getAllByRole("button", { name: "workflows.editor.text.toggle" });
    await userEvent.setup().click(toggles[1]);
    expect(toggles[1].getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /Finish/ })).toBeNull();
  });

  it("says so when the workflow is empty", () => {
    render(<WorkflowTextView draft={{ states: [], transitions: [] }} selection={null} onSelect={() => {}} />);
    expect(screen.getByText("workflows.editor.text.empty")).toBeTruthy();
  });
});
```

Run : `pnpm --filter=web exec vitest run components/workflow/editor/text-view.test.tsx`
Expected : FAIL, le module `./text-view` n'existe pas.

- [ ] **Step 2: Write the tone classes and the text view**

Créer `apps/web/components/workflow/editor/tones.ts` (avec l'en-tête de copyright) :

```ts
import type { TStateTone } from "./graph-model";

/** Jira's category colours (R16), taken from the theme tokens so both themes keep AA contrast. */
export const TONE_CLASS: Record<TStateTone, string> = {
  todo: "border-subtle bg-layer-2 text-secondary",
  progress: "border-info-subtle bg-info-subtle text-info-primary",
  done: "border-success-subtle bg-success-subtle text-success-primary",
  cancelled: "border-danger-subtle bg-danger-subtle text-danger-primary",
};
```

Créer `apps/web/components/workflow/editor/text-view.tsx` (avec l'en-tête de copyright) :

```tsx
import { useState } from "react";
import { ChevronDownOutline, ChevronRightOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// local imports
import { textRows, toneOf, type TDraftGraph, type TTextTransition } from "./graph-model";
import { TONE_CLASS } from "./tones";
import type { TEditorSelection } from "./workflow-canvas";

type Props = {
  draft: TDraftGraph;
  selection: TEditorSelection;
  onSelect: (selection: TEditorSelection) => void;
};

export function WorkflowTextView({ draft, selection, onSelect }: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const rows = textRows(draft);

  if (rows.length === 0)
    return <p className="p-6 text-body-sm-regular text-tertiary">{t("workflows.editor.text.empty")}</p>;

  const originOf = (item: TTextTransition) => {
    if (item.origin === "start") return t("workflows.editor.text.origin_start");
    if (item.origin === "any") return t("workflows.editor.text.origin_any");
    return item.sourceName ?? "";
  };

  return (
    <div className="h-full overflow-auto p-6">
      <table
        className="w-full table-fixed border-separate border-spacing-0 rounded-lg border border-subtle"
        aria-label={t("workflows.editor.view.text")}
      >
        <thead>
          <tr className="text-left text-body-xs-medium text-secondary">
            <th className="w-12 border-b border-subtle p-2" />
            <th className="w-72 border-b border-subtle p-2">{t("workflows.editor.text.state")}</th>
            <th className="border-b border-subtle p-2">{t("workflows.editor.text.transitions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = !collapsed.includes(row.key);
            const isSelected = selection?.kind === "state" && selection.key === row.key;
            return (
              <tr key={row.key} className="align-top">
                <td className="border-b border-subtle p-2">
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md hover:bg-layer-1"
                    aria-expanded={isOpen}
                    aria-label={t("workflows.editor.text.toggle", { name: row.name })}
                    onClick={() =>
                      setCollapsed((current) =>
                        isOpen ? [...current, row.key] : current.filter((key) => key !== row.key)
                      )
                    }
                  >
                    {isOpen ? (
                      <ChevronDownOutline className="size-4" aria-hidden />
                    ) : (
                      <ChevronRightOutline className="size-4" aria-hidden />
                    )}
                  </button>
                </td>
                <td className={`border-b border-subtle p-2 ${isSelected ? "bg-layer-1-selected" : ""}`}>
                  <button
                    type="button"
                    className={`rounded-sm border px-2 py-1 text-caption-sm-medium uppercase ${TONE_CLASS[toneOf(row.group)]}`}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => onSelect({ kind: "state", key: row.key })}
                  >
                    {row.name}
                  </button>
                  <p className="mt-1 text-caption-sm-regular text-tertiary">{t(`workflows.groups.${row.group}`)}</p>
                </td>
                <td className="border-b border-subtle p-2">
                  {isOpen && (
                    <ul className="space-y-1">
                      {row.transitions.map((item, index) => {
                        const route = `${originOf(item)} → ${row.name}`;
                        const label = item.name ? `${item.name} (${route})` : route;
                        const key = item.key;
                        return (
                          <li key={`${key ?? "start"}-${index}`} className="text-body-sm-regular text-primary">
                            {key === null ? (
                              <span>{label}</span>
                            ) : (
                              <button
                                type="button"
                                className="rounded-sm text-left hover:underline"
                                aria-current={
                                  selection?.kind === "transition" && selection.key === key ? "true" : undefined
                                }
                                onClick={() => onSelect({ kind: "transition", key })}
                              >
                                {label}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Run the tests, check, commit**

Run : `pnpm --filter=web exec vitest run components/workflow/editor/text-view.test.tsx`
Expected : 4 passed.

Run : `pnpm turbo run check:types check:lint --filter=web`
Expected : aucune erreur.

```bash
git add apps/web/components/workflow/editor/tones.ts apps/web/components/workflow/editor/text-view.tsx apps/web/components/workflow/editor/text-view.test.tsx
git commit -m "feat(web): add the text view of the workflow editor"
```

---

### Task 10: Diagramme (spec 3.2, R16, R17, R18, X6, X7)

**Files:**

- Modify: `apps/web/components/workflow/editor/tones.ts`
- Rewrite: `apps/web/components/workflow/editor/state-node.tsx`
- Create: `apps/web/components/workflow/editor/start-node.tsx`
- Rewrite: `apps/web/components/workflow/editor/workflow-canvas.tsx`
- Create: `apps/web/components/workflow/editor/workflow-canvas.test.tsx`
- Modify: `apps/web/components/workflow/editor/workflow-editor.tsx` (appel du diagramme uniquement)

**Interfaces:**

- Consumes : `closestSides`, `displayGroup`, `toneOf`, `transitionCounts`, `connectStates`, `setInitial`, `removeState`, `removeTransition` (Task 6) ; `TONE_CLASS` (Task 9).
- Produces :
  - `INVERSE_CLASS: string` dans `tones.ts` (fond sombre, texte clair, pour le nœud de départ et les pastilles) ;
  - `START_NODE_ID = "__start__"`, `START_EDGE_ID = "__start_edge__"`, `WorkflowStartNode` ;
  - `SIDES: TWorkflowSide[]`, `WorkflowStateNode`, `TStateNodeData` ;
  - `WorkflowCanvas(props)` et le type `TEditorSelection` (inchangé), avec les props :

```ts
type Props = {
  draft: TDraftGraph;
  canEdit: boolean;
  showLabels: boolean;
  selection: TEditorSelection;
  onSelect: (selection: TEditorSelection) => void;
  onMove: (moves: { key: string; x: number; y: number }[]) => void;
  onConnect: (sourceKey: string, sourceSide: TWorkflowSide, targetKey: string, targetSide: TWorkflowSide) => void;
  onSetInitial: (key: string) => void;
  onRemoveState: (key: string) => void;
  onRemoveTransition: (key: string) => void;
};
```

- [ ] **Step 1: Write the failing test**

Créer `apps/web/components/workflow/editor/workflow-canvas.test.tsx` (avec l'en-tête de copyright) :

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph } from "./graph-model";
import { WorkflowCanvas } from "./workflow-canvas";

// A new t on every render, like the real hook: with the immediate ResizeObserver of the setup file,
// this is the exact condition of the render loop fixed on 2026-11-14 (X6).
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const draft: TDraftGraph = {
  states: [
    {
      key: "a",
      status: { name: "Todo", color: "#3A3A3A", group: null, shared_count: 0 },
      position_x: 0,
      position_y: 0,
      is_initial: true,
    },
    {
      key: "b",
      status: { name: "Done", color: "#3A3A3A", group: null, shared_count: 0 },
      position_x: 240,
      position_y: 0,
      is_initial: false,
    },
  ],
  transitions: [
    { key: "t", name: "Finish", from_any: false, source_keys: ["a"], target_key: "b", rules: [] },
    { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [] },
  ],
};
const noop = () => {};

const renderCanvas = (onSelect: (selection: unknown) => void = noop) =>
  render(
    <div style={{ width: 800, height: 600 }}>
      <WorkflowCanvas
        draft={draft}
        canEdit
        showLabels={false}
        selection={null}
        onSelect={onSelect}
        onMove={noop}
        onConnect={noop}
        onSetInitial={noop}
        onRemoveState={noop}
        onRemoveTransition={noop}
      />
    </div>
  );

describe("WorkflowCanvas", () => {
  it("draws the start node, the states and the any-state pill without a render loop", () => {
    renderCanvas();
    expect(screen.getByText("workflows.editor.start")).toBeTruthy();
    expect(screen.getByText("Todo")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("workflows.editor.global")).toBeTruthy();
  });

  it("selects a state on a click and a global transition on a click on its pill", async () => {
    const onSelect = vi.fn();
    renderCanvas(onSelect);
    const user = userEvent.setup();
    await user.click(screen.getByText("Done"));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "state", key: "b" });
    await user.click(screen.getByText("workflows.editor.global"));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "g" });
  });
});
```

Run : `pnpm --filter=web exec vitest run components/workflow/editor/workflow-canvas.test.tsx`
Expected : FAIL. Le diagramme actuel n'a pas de prop `canEdit`, n'affiche ni nœud de départ ni pastille cliquable.

- [ ] **Step 2: Write the nodes**

À la fin de `apps/web/components/workflow/editor/tones.ts` :

```ts
/** Dark shape with light text in both themes: start node and "any state" pills. */
export const INVERSE_CLASS = "bg-(--text-color-primary) text-(--background-color-surface-1)";
```

Vérifier que les deux variables existent dans `apps/web/node_modules/@makeplane/propel/dist/styles/variables.css` ; si l'une porte un autre nom, prendre la variable de texte principal et celle du fond de page.

Remplacer tout le contenu de `apps/web/components/workflow/editor/state-node.tsx` (en gardant l'en-tête de copyright) :

```tsx
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AutomationsOutline } from "@makeplane/propel/icons";
import type { TWorkflowSide } from "@plane/types";
// local imports
import type { TStateTone } from "./graph-model";
import { INVERSE_CLASS, TONE_CLASS } from "./tones";

export type TStateNodeData = {
  name: string;
  tone: TStateTone;
  groupLabel: string;
  globalKey: string | null;
  globalLabel: string;
  globalSelected: boolean;
};
export type TStateNode = Node<TStateNodeData, "workflowState">;

export const SIDES: TWorkflowSide[] = ["top", "right", "bottom", "left"];
const POSITION: Record<TWorkflowSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

export function WorkflowStateNode({ data, selected }: NodeProps<TStateNode>) {
  return (
    <div className="relative">
      {data.globalKey && (
        // Read by the canvas click handler: the pill selects its transition, not the state.
        <span
          data-global-key={data.globalKey}
          className={`absolute -top-7 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-caption-sm-medium whitespace-nowrap ${INVERSE_CLASS} ${data.globalSelected ? "ring-2 ring-accent-strong" : ""}`}
        >
          <AutomationsOutline className="size-3" aria-hidden />
          {data.globalLabel}
        </span>
      )}
      <div
        title={data.groupLabel}
        className={`min-w-32 rounded-sm border-2 px-4 py-2 text-center text-caption-sm-medium uppercase ${TONE_CLASS[data.tone]} ${selected ? "ring-2 ring-accent-strong" : ""}`}
      >
        {data.name}
      </div>
      {SIDES.map((side) => (
        // Every side both starts and receives arrows (loose connection mode, R17).
        <Handle
          key={side}
          id={side}
          type="source"
          position={POSITION[side]}
          className={selected ? "opacity-100" : "opacity-0"}
        />
      ))}
    </div>
  );
}
```

Créer `apps/web/components/workflow/editor/start-node.tsx` (avec l'en-tête de copyright) :

```tsx
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
// local imports
import { INVERSE_CLASS } from "./tones";

export const START_NODE_ID = "__start__";
export const START_EDGE_ID = "__start_edge__";

export type TStartNode = Node<{ label: string }, "workflowStart">;

/** Display only (X7): derived from the initial state, never saved. */
export function WorkflowStartNode({ data }: NodeProps<TStartNode>) {
  return (
    <div className={`flex size-20 items-center justify-center rounded-full text-caption-sm-medium ${INVERSE_CLASS}`}>
      {data.label}
      <Handle id="right" type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}
```

- [ ] **Step 3: Write the canvas**

Remplacer tout le contenu de `apps/web/components/workflow/editor/workflow-canvas.tsx` (en gardant l'en-tête de copyright) :

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  ConnectionMode,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
// oxlint-disable-next-line import/no-unassigned-import -- React Flow stylesheet
import "@xyflow/react/dist/style.css";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowSide } from "@plane/types";
// local imports
import { closestSides, displayGroup, toneOf, transitionCounts, type TDraftGraph } from "./graph-model";
import { START_EDGE_ID, START_NODE_ID, WorkflowStartNode } from "./start-node";
import { SIDES, WorkflowStateNode } from "./state-node";

export type TEditorSelection = { kind: "state" | "transition"; key: string } | null;

type Props = {
  draft: TDraftGraph;
  canEdit: boolean;
  showLabels: boolean;
  selection: TEditorSelection;
  onSelect: (selection: TEditorSelection) => void;
  onMove: (moves: { key: string; x: number; y: number }[]) => void;
  onConnect: (sourceKey: string, sourceSide: TWorkflowSide, targetKey: string, targetSide: TWorkflowSide) => void;
  onSetInitial: (key: string) => void;
  onRemoveState: (key: string) => void;
  onRemoveTransition: (key: string) => void;
};

// Stable reference: React Flow re-mounts nodes when nodeTypes changes.
const NODE_TYPES = { workflowState: WorkflowStateNode, workflowStart: WorkflowStartNode };
const START_GAP = 160;
const ARROW = { type: MarkerType.ArrowClosed };

const toSide = (value: string | null | undefined, fallback: TWorkflowSide): TWorkflowSide =>
  SIDES.includes(value as TWorkflowSide) ? (value as TWorkflowSide) : fallback;

function FitOnChange({ count }: { count: number }) {
  const flow = useReactFlow();
  const flowRef = useRef(flow);
  flowRef.current = flow;
  // Refit only when a state is added or removed, never on a pan or a drag (R12).
  useEffect(() => {
    const frame = requestAnimationFrame(() => void flowRef.current.fitView({ padding: 0.2 }));
    return () => cancelAnimationFrame(frame);
  }, [count]);
  return null;
}

function ZoomSlider({ label }: { label: string }) {
  const zoom = useStore((state) => state.transform[2]);
  const { zoomTo } = useReactFlow();
  return (
    <input
      type="range"
      className="w-40"
      aria-label={label}
      min={0.25}
      max={2}
      step={0.05}
      value={zoom}
      onChange={(event) => void zoomTo(Number(event.target.value))}
    />
  );
}

export function WorkflowCanvas({
  draft,
  canEdit,
  showLabels,
  selection,
  onSelect,
  onMove,
  onConnect,
  onSetInitial,
  onRemoveState,
  onRemoveTransition,
}: Props) {
  const { t } = useTranslation();
  const initial = draft.states.find((state) => state.is_initial);

  const specs: Node[] = [
    {
      id: START_NODE_ID,
      type: "workflowStart",
      position: initial ? { x: initial.position_x - START_GAP, y: initial.position_y - 22 } : { x: 0, y: 0 },
      draggable: false,
      selectable: false,
      deletable: false,
      connectable: canEdit,
      ariaLabel: t("workflows.editor.start"),
      data: { label: t("workflows.editor.start") },
    },
    ...draft.states.map((state) => {
      const group = displayGroup(draft, state);
      const groupLabel = t(`workflows.groups.${group}`);
      const globalKey =
        draft.transitions.find((transition) => transition.from_any && transition.target_key === state.key)?.key ?? null;
      return {
        id: state.key,
        type: "workflowState",
        position: { x: state.position_x, y: state.position_y },
        selected: selection?.kind === "state" && selection.key === state.key,
        draggable: canEdit,
        connectable: canEdit,
        deletable: canEdit,
        ariaLabel: t("workflows.editor.state_label", {
          name: state.status.name,
          group: groupLabel,
          ...transitionCounts(draft, state.key),
        }),
        data: {
          name: state.status.name,
          tone: toneOf(group),
          groupLabel,
          globalKey,
          globalLabel: t("workflows.editor.global"),
          globalSelected: globalKey !== null && selection?.kind === "transition" && selection.key === globalKey,
        },
      };
    }),
  ];

  // React Flow moves a dragged node through onNodesChange, so the nodes live in local state. They are
  // re-read from the draft when their content changes, compared as a string: an effect keyed on the
  // array, or on t, restarts on every render and loops with the node measurements (X6).
  const signature = JSON.stringify(specs);
  const specsRef = useRef(specs);
  specsRef.current = specs;
  const [nodes, setNodes] = useState<Node[]>(specs);
  useEffect(() => {
    setNodes((current) =>
      specsRef.current.map((spec) => {
        const measured = current.find((node) => node.id === spec.id)?.measured;
        return measured ? { ...spec, measured } : spec;
      })
    );
  }, [signature]);

  const edges = useMemo<Edge[]>(() => {
    const nameOf = (key: string) => draft.states.find((item) => item.key === key)?.status.name ?? "";
    const positionOf = (key: string) => {
      const state = draft.states.find((item) => item.key === key);
      return state ? { x: state.position_x, y: state.position_y } : undefined;
    };
    const startEdge: Edge[] = initial
      ? [
          {
            id: START_EDGE_ID,
            source: START_NODE_ID,
            sourceHandle: "right",
            target: initial.key,
            targetHandle: "left",
            type: "step",
            markerEnd: ARROW,
            selectable: false,
            deletable: false,
            reconnectable: canEdit ? "target" : false,
          },
        ]
      : [];
    const transitionEdges = draft.transitions.flatMap((transition) =>
      transition.from_any
        ? []
        : transition.source_keys.flatMap((source): Edge[] => {
            const from = positionOf(source);
            const to = positionOf(transition.target_key);
            if (!from || !to) return [];
            const sides = transition.sides?.[source] ?? closestSides(from, to);
            return [
              {
                id: `${transition.key}:${source}`,
                source,
                sourceHandle: sides.source,
                target: transition.target_key,
                targetHandle: sides.target,
                type: "step",
                label: showLabels && transition.name ? transition.name : undefined,
                markerEnd: ARROW,
                selected: selection?.kind === "transition" && selection.key === transition.key,
                deletable: canEdit,
                ariaLabel: `${transition.name ? `${transition.name}: ` : ""}${nameOf(source)} → ${nameOf(transition.target_key)}`,
                data: { transitionKey: transition.key },
              },
            ];
          })
    );
    return [...startEdge, ...transitionEdges];
  }, [draft, initial, selection, showLabels, canEdit]);

  const handleConnect = ({ source, target, sourceHandle, targetHandle }: Connection) => {
    if (!source || !target || source === target || target === START_NODE_ID) return;
    // An arrow drawn from the start node moves the start (R18).
    if (source === START_NODE_ID) return onSetInitial(target);
    onConnect(source, toSide(sourceHandle, "right"), target, toSide(targetHandle, "left"));
  };

  return (
    <div role="group" className="size-full" aria-label={t("workflows.editor.diagram_label")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        connectionMode={ConnectionMode.Loose}
        fitView
        minZoom={0.25}
        maxZoom={2}
        nodesDraggable={canEdit}
        nodesConnectable={canEdit}
        edgesReconnectable={canEdit}
        deleteKeyCode={canEdit ? "Delete" : null}
        onNodesChange={(changes) => {
          setNodes((current) => applyNodeChanges(changes, current));
          // Keyboard use never goes through onNodeClick or onNodeDragStop: Enter selects a focused
          // node and the arrow keys move it, both reported here only (spec 3.9).
          const picked = changes.find(
            (change) => change.type === "select" && change.selected && change.id !== START_NODE_ID
          );
          if (picked && picked.type === "select" && !(selection?.kind === "state" && selection.key === picked.id))
            onSelect({ kind: "state", key: picked.id });
          const moves = changes.flatMap((change) =>
            change.type === "position" && change.position && change.dragging !== true && change.id !== START_NODE_ID
              ? [{ key: change.id, x: change.position.x, y: change.position.y }]
              : []
          );
          if (moves.length > 0) onMove(moves);
        }}
        onEdgesChange={(changes) => {
          // Enter on a focused arrow: the only way a keyboard user selects a transition in the diagram.
          const picked = changes.find((change) => change.type === "select" && change.selected);
          if (picked && picked.type === "select" && picked.id !== START_EDGE_ID)
            onSelect({ kind: "transition", key: picked.id.split(":")[0] });
        }}
        onNodeClick={(event, node) => {
          if (node.id === START_NODE_ID) return;
          const globalKey = (event.target as HTMLElement).closest("[data-global-key]")?.getAttribute("data-global-key");
          onSelect(globalKey ? { kind: "transition", key: globalKey } : { kind: "state", key: node.id });
        }}
        onEdgeClick={(_, edge) => {
          const key = edge.data?.transitionKey;
          if (typeof key === "string") onSelect({ kind: "transition", key });
        }}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_, __, dragged) =>
          onMove(
            dragged
              .filter((node) => node.id !== START_NODE_ID)
              .map((node) => ({ key: node.id, x: node.position.x, y: node.position.y }))
          )
        }
        onConnect={handleConnect}
        onReconnect={(_, connection) => {
          if (connection.target && connection.target !== START_NODE_ID) onSetInitial(connection.target);
        }}
        onNodesDelete={(deleted) => {
          for (const node of deleted) if (node.id !== START_NODE_ID) onRemoveState(node.id);
        }}
        onEdgesDelete={(deleted) => {
          const keys = new Set(deleted.map((edge) => edge.data?.transitionKey));
          for (const key of keys) if (typeof key === "string") onRemoveTransition(key);
        }}
      >
        <FitOnChange count={draft.states.length} />
        <MiniMap pannable zoomable ariaLabel={t("workflows.editor.minimap")} />
        <Panel position="bottom-left">
          <ZoomSlider label={t("workflows.editor.zoom")} />
        </Panel>
      </ReactFlow>
    </div>
  );
}
```

Points à vérifier dans les types installés avant de lancer les tests : `ConnectionMode.Loose`, `edgesReconnectable`, `onReconnect`, le champ `reconnectable` d'une arête, `ariaLabel` sur un nœud et sur `MiniMap`, le type d'arête `"step"`, `Panel`, `useStore`. Le fond n'a ni grille ni composant `Background` : c'est voulu (spec 3.2). Vérifier aussi la forme des changements reçus par `onNodesChange` et `onEdgesChange` (`type: "select"` avec `selected`, `type: "position"` avec `position` et `dragging`) et le champ `ariaLabel` d'une arête. Une clé de transition ne contient jamais de deux-points (identifiant du serveur ou `new-<uuid>`), ce qui permet de la relire dans l'identifiant de l'arête.

- [ ] **Step 4: Keep the current editor compiling**

Dans `apps/web/components/workflow/editor/workflow-editor.tsx`, ajouter `connectStates`, `removeState`, `removeTransition`, `setInitial` à l'import de `./graph-model` (et en retirer `addTransition` s'il n'est plus utilisé ailleurs dans le fichier), puis remplacer l'élément `<WorkflowCanvas ... />` et le `<div className="min-w-0 flex-1">` qui l'entoure par :

```tsx
<div className="h-[560px] min-w-0 flex-1 rounded-md border border-subtle">
  <WorkflowCanvas
    draft={draft}
    canEdit={!readOnly}
    showLabels
    selection={selection}
    onSelect={setSelection}
    onMove={(moves) =>
      setDraft((current) => moves.reduce((acc, move) => moveState(acc, move.key, move.x, move.y), current))
    }
    onConnect={(source, sourceSide, target, targetSide) =>
      setDraft((current) => connectStates(current, `new-${uuidv4()}`, source, sourceSide, target, targetSide))
    }
    onSetInitial={(key) => setDraft((current) => setInitial(current, key))}
    onRemoveState={(key) => setDraft((current) => removeState(current, key))}
    onRemoveTransition={(key) => setDraft((current) => removeTransition(current, key))}
  />
</div>
```

- [ ] **Step 5: Run the tests, check, commit**

Run : `pnpm --filter=web exec vitest run components/workflow/editor/workflow-canvas.test.tsx`
Expected : 2 passed, sans message « Maximum update depth exceeded » dans la sortie.

Run : `pnpm turbo run test check:types check:lint --filter=web`
Expected : tout passe.

Vérification à l'écran (pile locale, `http://localhost:3000/<workspace>/settings/workflows/<id>`) : le nœud « DÉMARRER » pointe l'état de départ ; un état sélectionné montre quatre points ; une flèche tirée d'un point à un autre reste sur ces deux côtés après « Enregistrer » et rechargement ; la touche Suppr retire l'état sélectionné ; la mini-carte et le curseur de zoom fonctionnent ; aucune erreur dans la console.

```bash
git add apps/web/components/workflow/editor
git commit -m "feat(web): redraw the workflow diagram with a start node and four-sided arrows"
```

---

### Task 11: Coque de l'éditeur, en-tête, panneau droit et route plein écran (spec 3.1, 3.6, 3.8, 3.9, X10, X11, X13)

**Files:**

- Modify: `apps/web/components/workflow/editor/graph-model.ts`
- Modify: `apps/web/components/workflow/editor/graph-model.layout.test.ts`
- Create: `apps/web/components/workflow/editor/editor-header.tsx`
- Rewrite: `apps/web/components/workflow/editor/side-panel.tsx`
- Rewrite: `apps/web/components/workflow/editor/workflow-editor.tsx`
- Create: `apps/web/components/workflow/editor/workflow-editor.test.tsx`
- Delete: `apps/web/components/workflow/editor/add-state-form.tsx`, `add-transition-form.tsx`, `workflow-element-list.tsx`
- Modify: `packages/constants/src/fetch-keys.ts`
- Move: `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/[workflowId]/page.tsx` vers `apps/web/app/(all)/[workspaceSlug]/workflow-editor/[workflowId]/page.tsx`
- Modify: `apps/web/app/routes/core.ts`

**Interfaces:**

- Consumes : tout ce que produisent les tâches 5 à 10.
- Produces :
  - `errorTarget(draft, code): { kind: "state" | "transition"; key: string } | null` dans `graph-model.ts` ;
  - `WORKSPACE_WORKFLOW_CANDIDATES(workspaceSlug): string` dans `@plane/constants` ;
  - `WorkflowEditor({ workflow, statuses, candidates, readOnly, onSave, onClose })`, avec `onSave: (payload: TWorkflowGraphPayload) => Promise<TWorkflowDetail>` ;
  - `EditorHeader(props)` et `WorkflowSidePanel(props)` (props dans le code ci-dessous).

- [ ] **Step 1: Write the failing tests**

À la fin de `apps/web/components/workflow/editor/graph-model.layout.test.ts`, en ajoutant `errorTarget` à l'import :

```ts
describe("errorTarget", () => {
  const draft: TDraftGraph = {
    states: [
      state("a", { status: status("Same") }),
      state("b", { status: status("same") }),
      state("c", { status: status(" ") }),
    ],
    transitions: [
      { key: "ok", name: "", from_any: false, source_keys: ["a"], target_key: "b", rules: [] },
      { key: "bad", name: "", from_any: false, source_keys: [], target_key: "b", rules: [] },
      {
        key: "rule",
        name: "",
        from_any: true,
        source_keys: [],
        target_key: "a",
        rules: [{ type: "restrict_actors", params: {} }],
      },
    ],
  };

  it("points at the element behind a validation code", () => {
    expect(errorTarget(draft, "duplicate_status_name")).toEqual({ kind: "state", key: "b" });
    expect(errorTarget(draft, "status_name_required")).toEqual({ kind: "state", key: "c" });
    expect(errorTarget(draft, "invalid_transition")).toEqual({ kind: "transition", key: "bad" });
    expect(errorTarget(draft, "invalid_rule")).toEqual({ kind: "transition", key: "rule" });
    expect(errorTarget(draft, "initial_state_required")).toBeNull();
  });
});
```

Créer `apps/web/components/workflow/editor/workflow-editor.test.tsx` (avec l'en-tête de copyright) :

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TWorkflowDetail, TWorkflowStatus, TWorkflowStatusCandidate } from "@plane/types";
import { WorkflowEditor } from "./workflow-editor";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/blocks/toast", () => ({ setToast: vi.fn() }));
// The rule form reads the member store; it is out of scope here.
vi.mock("./restrict-actors-form", () => ({ RestrictActorsForm: () => null }));

const statusOf = (id: string, name: string): TWorkflowStatus => ({
  id,
  name,
  color: "#3A3A3A",
  group: "started",
  group_is_auto: true,
  workflow_count: 1,
});
const workflow: TWorkflowDetail = {
  id: "w",
  name: "Software",
  description: "",
  updated_at: null,
  project_count: 2,
  projects: [
    { id: "p1", name: "Alpha" },
    { id: "p2", name: "Beta" },
  ],
  states: [
    { id: "a", status: statusOf("sa", "Todo"), position_x: 0, position_y: 0, is_initial: true },
    { id: "b", status: statusOf("sb", "Done"), position_x: 240, position_y: 0, is_initial: false },
  ],
  transitions: [{ id: "t", name: "Finish", from_any: false, source_ids: ["a"], target_id: "b", rules: [], sides: {} }],
};
const statuses = [statusOf("sa", "Todo"), statusOf("sb", "Done")];
const candidates: TWorkflowStatusCandidate[] = [{ name: "Review", color: "#333333", group: "started" }];

const renderEditor = (props: Partial<React.ComponentProps<typeof WorkflowEditor>> = {}) =>
  render(
    <div style={{ width: 1280, height: 800 }}>
      <WorkflowEditor
        workflow={workflow}
        statuses={statuses}
        candidates={candidates}
        readOnly={false}
        onSave={async () => workflow}
        onClose={() => {}}
        {...props}
      />
    </div>
  );

describe("WorkflowEditor", () => {
  it("opens a workflow that has states", () => {
    renderEditor();
    expect(screen.getByRole("heading", { name: "Software" })).toBeTruthy();
    expect(screen.getByText("workflows.editor.start")).toBeTruthy();
    expect(screen.getByText("Todo")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByRole("button", { name: "workflows.editor.save" })).toHaveProperty("disabled", true);
  });

  it("shows no editing tool to a reader", () => {
    renderEditor({ readOnly: true });
    expect(screen.getByText("workflows.editor.read_only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "workflows.editor.add_state.title" })).toBeNull();
    expect(screen.queryByRole("button", { name: "workflows.editor.save" })).toBeNull();
    expect(screen.getByRole("button", { name: "workflows.editor.close" })).toBeTruthy();
  });

  it("adds a ticked state and saves the graph", async () => {
    const onSave = vi.fn(async () => workflow);
    renderEditor({ onSave });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.add_state.title" }));
    await user.click(screen.getByRole("checkbox", { name: /Review/ }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.add_state.submit" }));
    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.states.map((item: { status: { name: string } }) => item.status.name)).toEqual([
      "Todo",
      "Done",
      "Review",
    ]);
    expect(payload.states[2].position_x).toBe(480);
  });

  it("switches to the text view and opens the panel of a selected state", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.view.text" }));
    expect(screen.getByRole("table")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("heading", { name: "workflows.editor.panel.state" })).toBeTruthy();
  });

  it("discards unsaved changes", async () => {
    renderEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.add_state.title" }));
    await user.click(screen.getByRole("checkbox", { name: /Review/ }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.add_state.submit" }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.discard" }));
    expect(screen.queryByText("Review")).toBeNull();
    expect(screen.getByRole("button", { name: "workflows.editor.close" })).toBeTruthy();
  });
});
```

Run : `pnpm --filter=web exec vitest run components/workflow/editor/workflow-editor.test.tsx components/workflow/editor/graph-model.layout.test.ts`
Expected : FAIL. `errorTarget` n'est pas exporté ; l'éditeur actuel attend `workspaceSlug`, lit le store et n'a ni bouton « Fermer » ni fenêtre d'ajout.

- [ ] **Step 2: Add `errorTarget`**

À la fin de `apps/web/components/workflow/editor/graph-model.ts` :

```ts
/** Element a validateDraft code points at, so the error banner can select it (spec 3.8). */
export const errorTarget = (draft: TDraftGraph, code: string): { kind: "state" | "transition"; key: string } | null => {
  const keys = new Set(draft.states.map((state) => state.key));
  const nameOf = (state: TDraftState) => state.status.name.trim().toLowerCase();
  const state = (test: (item: TDraftState, index: number) => boolean) => {
    const found = draft.states.find(test);
    return found ? { kind: "state" as const, key: found.key } : null;
  };
  const transition = (test: (item: TDraftTransition) => boolean) => {
    const found = draft.transitions.find(test);
    return found ? { kind: "transition" as const, key: found.key } : null;
  };
  switch (code) {
    case "status_name_required":
      return state((item) => nameOf(item) === "");
    case "reserved_status_name":
      return state((item) => RESERVED_STATUS_NAMES.has(nameOf(item)));
    case "duplicate_status_name":
      return state((item, index) => draft.states.findIndex((other) => nameOf(other) === nameOf(item)) !== index);
    case "invalid_transition":
      return transition((item) => {
        const sources = item.from_any ? [] : item.source_keys;
        return (
          !keys.has(item.target_key) ||
          (!item.from_any && sources.length === 0) ||
          new Set(sources).size !== sources.length ||
          sources.some((source) => !keys.has(source) || source === item.target_key)
        );
      });
    case "invalid_rule":
      return transition((item) => item.rules.length > 1 || !item.rules.every(isRuleComplete));
    default:
      return null;
  }
};
```

- [ ] **Step 3: Write the header**

Créer `apps/web/components/workflow/editor/editor-header.tsx` (avec l'en-tête de copyright) :

```tsx
import { Button } from "@makeplane/propel/components/button";
import { AutomationsOutline, CopyOutline, StateOutline, WorkflowsOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowProjectRef } from "@plane/types";

type Props = {
  name: string;
  projectCount: number;
  projects?: TWorkflowProjectRef[];
  canEdit: boolean;
  dirty: boolean;
  canSave: boolean;
  isSaving: boolean;
  onAddState: () => void;
  onAddTransition: () => void;
  onAddRule: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
};

const TOOL_CLASS =
  "flex flex-col items-center gap-1 rounded-md px-3 py-1 text-caption-sm-regular text-secondary hover:bg-layer-1 max-md:min-h-11";

export function EditorHeader(props: Props) {
  const { name, projectCount, projects, canEdit, dirty, canSave, isSaving } = props;
  const { t } = useTranslation();
  const tools = [
    { label: t("workflows.editor.add_state.title"), Icon: StateOutline, onClick: props.onAddState },
    { label: t("workflows.editor.add_transition.title"), Icon: WorkflowsOutline, onClick: props.onAddTransition },
    { label: t("workflows.editor.add_rule.title"), Icon: AutomationsOutline, onClick: props.onAddRule },
  ];

  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-subtle px-6 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="truncate text-body-sm-semibold text-primary">{name}</h1>
        <details className="relative">
          <summary className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-subtle px-2 py-0.5 text-caption-sm-medium text-secondary">
            <CopyOutline className="size-3" aria-hidden />
            {t("workflows.editor.used_in", { count: projectCount })}
          </summary>
          {/* Names only reach workspace admins (P6 of the workflows plan). */}
          {projects && projects.length > 0 && (
            <ul className="absolute z-10 mt-1 min-w-48 rounded-md border border-subtle bg-layer-1 p-2 text-body-xs-regular text-primary shadow-md">
              {projects.map((project) => (
                <li key={project.id}>{project.name}</li>
              ))}
            </ul>
          )}
        </details>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1">
          {tools.map(({ label, Icon, onClick }) => (
            <button key={label} type="button" className={TOOL_CLASS} onClick={onClick}>
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-1 items-center justify-end gap-2">
        {canEdit && (
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            disabled={!canSave || isSaving}
            loading={isSaving}
            label={t("workflows.editor.save")}
            onClick={props.onSave}
          />
        )}
        <Button
          variant="secondary"
          size="md"
          stretch="auto"
          disabled={isSaving}
          label={t(dirty ? "workflows.editor.discard" : "workflows.editor.close")}
          onClick={dirty ? props.onDiscard : props.onClose}
        />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Rewrite the right panel**

Remplacer tout le contenu de `apps/web/components/workflow/editor/side-panel.tsx` (en gardant l'en-tête de copyright) :

```tsx
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { ChevronRightOutline, PlusCircleOutline, WorkflowsOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups } from "@plane/types";
// local imports
import {
  removeState,
  removeTransition,
  setInitial,
  setRestriction,
  transitionCounts,
  updateStatus,
  updateTransition,
  type TDraftGraph,
} from "./graph-model";
import { RestrictActorsForm } from "./restrict-actors-form";
import type { TEditorSelection } from "./workflow-canvas";

const GROUPS: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

type Props = {
  draft: TDraftGraph;
  selection: TEditorSelection;
  canEdit: boolean;
  onChange: (draft: TDraftGraph) => void;
  onSelect: (selection: TEditorSelection) => void;
  onAddTransition: (preset: { sourceKey?: string; targetKey?: string }) => void;
  // Bumped when the selection comes from the text view, so keyboard users land in the panel.
  focusSignal: number;
};

export const WorkflowSidePanel = observer(function WorkflowSidePanel({
  draft,
  selection,
  canEdit,
  onChange,
  onSelect,
  onAddTransition,
  focusSignal,
}: Props) {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const handledSignal = useRef(0);

  useEffect(() => {
    if (focusSignal === handledSignal.current) return;
    handledSignal.current = focusSignal;
    setIsCollapsed(false);
    headingRef.current?.focus();
  }, [focusSignal]);

  const state = selection?.kind === "state" ? draft.states.find((item) => item.key === selection.key) : undefined;
  const transition =
    selection?.kind === "transition" ? draft.transitions.find((item) => item.key === selection.key) : undefined;
  const title = state ? "workflows.editor.panel.state" : "workflows.editor.panel.transition";
  const counts = state ? transitionCounts(draft, state.key) : null;
  const nameOf = (key: string) => draft.states.find((item) => item.key === key)?.status.name ?? "";

  const toggle = (
    <button
      type="button"
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-subtle bg-layer-1 max-md:size-11"
      aria-expanded={!isCollapsed}
      aria-label={t(isCollapsed ? "workflows.editor.panel.expand" : "workflows.editor.panel.collapse")}
      onClick={() => setIsCollapsed((value) => !value)}
    >
      <ChevronRightOutline className={`size-4 ${isCollapsed ? "rotate-180" : ""}`} aria-hidden />
    </button>
  );

  if (isCollapsed) return <div className="border-l border-subtle p-2">{toggle}</div>;

  return (
    <aside
      // Below 1024px the panel overlays the canvas, and only while something is selected (spec 3.8).
      className={`flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-subtle bg-layer-2 p-4 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-10 max-lg:w-full max-lg:max-w-[400px] ${state || transition ? "" : "max-lg:hidden"}`}
      aria-label={t(state || transition ? title : "workflows.editor.panel.empty_title")}
    >
      <div className="flex items-start gap-2">
        {toggle}
        {(state || transition) && (
          <h2 ref={headingRef} tabIndex={-1} className="flex-1 text-h5-semibold text-primary">
            {t(title)}
          </h2>
        )}
      </div>

      {!state && !transition && (
        <div className="space-y-3 pt-8 text-center">
          <WorkflowsOutline className="mx-auto size-12 text-tertiary" aria-hidden />
          <h2 className="text-h5-semibold text-primary">{t("workflows.editor.panel.empty_title")}</h2>
          <p className="text-body-sm-regular text-secondary">{t("workflows.editor.panel.empty_body")}</p>
          <p className="text-body-sm-regular text-secondary">{t("workflows.editor.panel.empty_hint")}</p>
        </div>
      )}

      {state && counts && (
        <fieldset className="space-y-4" disabled={!canEdit}>
          {state.status.shared_count > 0 && (
            <p role="note" className="text-caption-sm-regular text-warning-primary">
              {t("workflows.editor.panel.shared", { count: state.status.shared_count })}
            </p>
          )}
          <InputField
            size="md"
            orientation="vertical"
            id="workflow-state-name"
            name="state-name"
            type="text"
            label={t("workflows.editor.add_state.name")}
            value={state.status.name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(updateStatus(draft, state.key, { name: event.target.value }))
            }
          />
          <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
            {t("workflows.editor.add_state.group")}
            <select
              className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
              value={state.status.group ?? ""}
              onChange={(event) =>
                onChange(updateStatus(draft, state.key, { group: (event.target.value || null) as TStateGroups | null }))
              }
            >
              <option value="">{t("workflows.editor.add_state.group_auto")}</option>
              {GROUPS.map((group) => (
                <option key={group} value={group}>
                  {t(`workflows.groups.${group}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-body-xs-medium text-secondary">
            {t("workflows.editor.panel.color")}
            <input
              type="color"
              value={state.status.color}
              onChange={(event) => onChange(updateStatus(draft, state.key, { color: event.target.value }))}
            />
          </label>
          <div className="space-y-2">
            <h3 className="text-body-sm-medium text-primary">{t("workflows.editor.text.transitions")}</h3>
            {(
              [
                ["incoming", counts.incoming, { targetKey: state.key }, "add_incoming"],
                ["outgoing", counts.outgoing, { sourceKey: state.key }, "add_outgoing"],
              ] as const
            ).map(([kind, count, preset, addKey]) => (
              <div key={kind} className="flex items-center gap-2 text-body-sm-regular text-secondary">
                <span className="flex-1">{t(`workflows.editor.panel.${kind}`)}</span>
                <span className="rounded-full bg-layer-1 px-2 text-caption-sm-medium">{count}</span>
                {canEdit && (
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md hover:bg-layer-1 max-md:size-11"
                    aria-label={t(`workflows.editor.panel.${addKey}`)}
                    onClick={() => onAddTransition(preset)}
                  >
                    <PlusCircleOutline className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
          {state.is_initial ? (
            <p className="text-body-xs-medium text-secondary">{t("workflows.editor.panel.initial")}</p>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              stretch="auto"
              label={t("workflows.editor.panel.set_initial")}
              onClick={() => onChange(setInitial(draft, state.key))}
            />
          )}
          {canEdit && (
            <Button
              variant="danger-outline"
              size="sm"
              stretch="auto"
              label={t("workflows.editor.panel.remove_state")}
              onClick={() => {
                onChange(removeState(draft, state.key));
                onSelect(null);
              }}
            />
          )}
        </fieldset>
      )}

      {transition && (
        <div className="space-y-4">
          <fieldset className="space-y-3" disabled={!canEdit}>
            <InputField
              size="md"
              orientation="vertical"
              id="workflow-transition-name"
              name="transition-name"
              type="text"
              label={t("workflows.editor.add_transition.name")}
              value={transition.name}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange(updateTransition(draft, transition.key, { name: event.target.value }))
              }
            />
            <p className="text-body-sm-regular text-secondary">
              {transition.from_any ? t("workflows.editor.global") : transition.source_keys.map(nameOf).join(", ")}
              {" → "}
              {nameOf(transition.target_key)}
            </p>
          </fieldset>
          <RestrictActorsForm
            params={transition.rules[0]?.params ?? null}
            readOnly={!canEdit}
            onChange={(params) => onChange(setRestriction(draft, transition.key, params))}
          />
          {canEdit && (
            <Button
              variant="danger-outline"
              size="sm"
              stretch="auto"
              label={t("workflows.editor.panel.remove_transition")}
              onClick={() => {
                onChange(removeTransition(draft, transition.key));
                onSelect(null);
              }}
            />
          )}
        </div>
      )}
    </aside>
  );
});
```

- [ ] **Step 5: Rewrite the editor shell**

Remplacer tout le contenu de `apps/web/components/workflow/editor/workflow-editor.tsx` (en gardant l'en-tête de copyright) :

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import { v4 as uuidv4 } from "uuid";
import type {
  TWorkflowDetail,
  TWorkflowGraphPayload,
  TWorkflowStatus,
  TWorkflowStatusCandidate,
  TWorkflowStatusUsage,
} from "@plane/types";
// local imports
import { AddRuleDialog } from "./add-rule-dialog";
import { AddStatusDialog } from "./add-status-dialog";
import { AddTransitionDialog } from "./add-transition-dialog";
import { EditorHeader } from "./editor-header";
import {
  addStates,
  addTransition,
  connectStates,
  errorTarget,
  fromDetail,
  getDraftErrorKey,
  getGraphErrorKey,
  isDraftDirty,
  moveState,
  removeState,
  removeTransition,
  setInitial,
  setRestriction,
  shouldResetDraft,
  statusOptions,
  toPayload,
  validateDraft,
  type TDraftGraph,
} from "./graph-model";
import { WorkflowSidePanel } from "./side-panel";
import { WorkflowTextView } from "./text-view";
import { WorkflowCanvas, type TEditorSelection } from "./workflow-canvas";

type Props = {
  workflow: TWorkflowDetail;
  statuses: TWorkflowStatus[];
  candidates: TWorkflowStatusCandidate[];
  readOnly: boolean;
  // Injected by the page (X10): the editor knows neither the store nor the router.
  onSave: (payload: TWorkflowGraphPayload) => Promise<TWorkflowDetail>;
  onClose: () => void;
};

type TPreset = { sourceKey?: string; targetKey?: string };
type TDialog = { kind: "state" } | { kind: "transition"; preset: TPreset | null } | { kind: "rule" } | null;

const VIEW_CLASS = "rounded-sm px-3 py-1 text-body-xs-medium max-md:min-h-11";

export const WorkflowEditor = observer(function WorkflowEditor(props: Props) {
  const { workflow, statuses, candidates, readOnly, onSave, onClose } = props;
  const { t } = useTranslation();
  // Read once (X13): below 768px the editor opens on the text view and does not edit.
  const [isSmall] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const canEdit = !readOnly && !isSmall;
  const saved = useMemo(() => fromDetail(workflow, statuses), [workflow, statuses]);
  const [draft, setDraft] = useState<TDraftGraph>(saved);
  const [selection, setSelection] = useState<TEditorSelection>(null);
  const [view, setView] = useState<"diagram" | "text">(isSmall ? "text" : "diagram");
  const [showLabels, setShowLabels] = useState(false);
  const [dialog, setDialog] = useState<TDialog>(null);
  const [serverError, setServerError] = useState<{ key: string; projects: TWorkflowStatusUsage[] } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const savedRef = useRef(saved);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // A refresh (focus revalidation, status counts) must never wipe unsaved edits.
  useEffect(() => {
    const previous = savedRef.current;
    savedRef.current = saved;
    if (shouldResetDraft(previous, saved, draftRef.current)) setDraft(saved);
  }, [saved]);

  const errors = validateDraft(draft);
  const dirty = isDraftDirty(draft, saved);
  const options = useMemo(() => statusOptions(statuses, candidates, draft), [statuses, candidates, draft]);
  const selectedTransitionKey = selection?.kind === "transition" ? selection.key : null;

  const save = async () => {
    setServerError(null);
    setIsSaving(true);
    try {
      const result = await onSave(toPayload(draft));
      setDraft(fromDetail(result, statuses));
      setSelection(null);
      setToast({ type: "success", title: t("workflows.editor.saved"), message: "" });
    } catch (error) {
      setServerError(getGraphErrorKey(error));
    } finally {
      setIsSaving(false);
    }
  };

  const notice = readOnly ? "workflows.editor.read_only" : isSmall ? "workflows.editor.small_screen" : null;

  return (
    <div className="flex size-full flex-col bg-surface-1">
      <a href="#workflow-editor-main" className="sr-only focus:not-sr-only">
        {t("workflows.editor.diagram_label")}
      </a>
      <EditorHeader
        name={workflow.name}
        projectCount={workflow.project_count}
        projects={workflow.projects}
        canEdit={canEdit}
        dirty={dirty}
        canSave={dirty && errors.length === 0}
        isSaving={isSaving}
        onAddState={() => setDialog({ kind: "state" })}
        onAddTransition={() => setDialog({ kind: "transition", preset: null })}
        onAddRule={() => setDialog({ kind: "rule" })}
        onSave={save}
        onDiscard={() => {
          setDraft(saved);
          setSelection(null);
          setServerError(null);
        }}
        onClose={onClose}
      />
      {notice && (
        <p role="status" className="border-b border-subtle bg-layer-1 px-6 py-2 text-body-sm-regular text-secondary">
          {t(notice)}
        </p>
      )}
      {(errors.length > 0 || serverError) && (
        <div className="space-y-2 border-b border-danger-subtle bg-danger-subtle px-6 py-2 text-body-sm-regular text-danger-primary">
          <ul aria-live="polite">
            {errors.map((code) => {
              const target = errorTarget(draft, code);
              return (
                <li key={code}>
                  {target ? (
                    <button type="button" className="text-left underline" onClick={() => setSelection(target)}>
                      {t(getDraftErrorKey(code))}
                    </button>
                  ) : (
                    t(getDraftErrorKey(code))
                  )}
                </li>
              );
            })}
          </ul>
          {serverError && (
            <div role="alert">
              <p>{t(serverError.key)}</p>
              {serverError.projects.map((project) => (
                <p key={project.project_id}>
                  {t("workflows.editor.errors.status_in_use_project", {
                    project: project.project_name,
                    count: project.issue_count,
                  })}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 px-6 py-3">
        <div
          role="group"
          aria-label={t("workflows.editor.view.label")}
          className="flex rounded-md border border-subtle p-0.5"
        >
          {(["diagram", "text"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={view === item}
              className={`${VIEW_CLASS} ${view === item ? "bg-layer-1-selected text-primary" : "text-secondary"}`}
              onClick={() => setView(item)}
            >
              {t(`workflows.editor.view.${item}`)}
            </button>
          ))}
        </div>
        {view === "diagram" && (
          <label className="flex items-center gap-2 text-body-sm-regular text-secondary max-md:min-h-11">
            <input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} />
            {t("workflows.editor.show_labels")}
          </label>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <main id="workflow-editor-main" className="min-w-0 flex-1">
          {view === "diagram" ? (
            <WorkflowCanvas
              draft={draft}
              canEdit={canEdit}
              showLabels={showLabels}
              selection={selection}
              onSelect={setSelection}
              onMove={(moves) =>
                setDraft((current) => moves.reduce((acc, move) => moveState(acc, move.key, move.x, move.y), current))
              }
              onConnect={(source, sourceSide, target, targetSide) =>
                setDraft((current) => connectStates(current, `new-${uuidv4()}`, source, sourceSide, target, targetSide))
              }
              onSetInitial={(key) => setDraft((current) => setInitial(current, key))}
              onRemoveState={(key) => {
                setDraft((current) => removeState(current, key));
                setSelection(null);
              }}
              onRemoveTransition={(key) => {
                setDraft((current) => removeTransition(current, key));
                setSelection(null);
              }}
            />
          ) : (
            <WorkflowTextView
              draft={draft}
              selection={selection}
              onSelect={(next) => {
                setSelection(next);
                setFocusSignal((value) => value + 1);
              }}
            />
          )}
        </main>
        <WorkflowSidePanel
          draft={draft}
          selection={selection}
          canEdit={canEdit}
          onChange={setDraft}
          onSelect={setSelection}
          onAddTransition={(preset) => setDialog({ kind: "transition", preset })}
          focusSignal={focusSignal}
        />
      </div>
      <AddStatusDialog
        isOpen={dialog?.kind === "state"}
        draft={draft}
        options={options}
        onClose={() => setDialog(null)}
        onAdd={(picked, allowAny) => {
          const entries = picked.map((status) => ({
            key: `new-${uuidv4()}`,
            status,
            globalKey: allowAny ? `new-${uuidv4()}` : undefined,
          }));
          setDraft((current) => addStates(current, entries));
          setSelection({ kind: "state", key: entries[entries.length - 1].key });
          setDialog(null);
        }}
      />
      <AddTransitionDialog
        isOpen={dialog?.kind === "transition"}
        draft={draft}
        preset={dialog?.kind === "transition" ? dialog.preset : null}
        onClose={() => setDialog(null)}
        onAdd={(transition) => {
          setDraft((current) => addTransition(current, { ...transition, key: `new-${uuidv4()}` }));
          setDialog(null);
        }}
      />
      <AddRuleDialog
        isOpen={dialog?.kind === "rule"}
        draft={draft}
        presetKey={selectedTransitionKey}
        onClose={() => setDialog(null)}
        onApply={(transitionKey, params) => {
          setDraft((current) => setRestriction(current, transitionKey, params));
          setDialog(null);
        }}
      />
    </div>
  );
});
```

- [ ] **Step 6: Delete the old forms**

```bash
git rm apps/web/components/workflow/editor/add-state-form.tsx apps/web/components/workflow/editor/add-transition-form.tsx apps/web/components/workflow/editor/workflow-element-list.tsx
grep -rn "add-state-form\|add-transition-form\|workflow-element-list" apps/web --include=*.ts --include=*.tsx
```

Expected : le `grep` ne renvoie rien. S'il renvoie une ligne de `apps/web/components/workflow/index.ts`, la retirer.

- [ ] **Step 7: Move the page out of the settings shell**

Dans `packages/constants/src/fetch-keys.ts`, après `WORKSPACE_WORKFLOW_STATUSES` :

```ts
export const WORKSPACE_WORKFLOW_CANDIDATES = (workspaceSlug: string) =>
  `WORKSPACE_WORKFLOW_CANDIDATES_${workspaceSlug.toUpperCase()}`;
```

```bash
mkdir -p "apps/web/app/(all)/[workspaceSlug]/workflow-editor/[workflowId]"
git mv "apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/[workflowId]/page.tsx" "apps/web/app/(all)/[workspaceSlug]/workflow-editor/[workflowId]/page.tsx"
```

Remplacer tout le contenu du fichier déplacé (en gardant l'en-tête de copyright) :

```tsx
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import {
  EUserPermissions,
  EUserPermissionsLevel,
  WORKFLOW_DETAIL,
  WORKSPACE_WORKFLOW_CANDIDATES,
  WORKSPACE_WORKFLOW_STATUSES,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/blocks/skeleton";
// components
import { PageHead } from "@/components/core/page-title";
import { WorkflowEditor } from "@/components/workflow/editor/workflow-editor";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useAppRouter } from "@/hooks/use-app-router";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";

const SWR_OPTIONS = { revalidateOnFocus: false, revalidateIfStale: false };

function WorkflowEditorPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, workflowId } = params;
  const { t } = useTranslation();
  const router = useAppRouter();
  const { allowPermissions } = useUserPermissions();
  const {
    fetchWorkflowDetail,
    fetchStatuses,
    fetchCandidates,
    getWorkflowDetail,
    getWorkspaceStatuses,
    getWorkspaceCandidates,
    saveGraph,
  } = useWorkflow();
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const detail = useSWR(WORKFLOW_DETAIL(workflowId), () => fetchWorkflowDetail(workspaceSlug, workflowId), SWR_OPTIONS);
  const statuses = useSWR(WORKSPACE_WORKFLOW_STATUSES(workspaceSlug), () => fetchStatuses(workspaceSlug), SWR_OPTIONS);
  // Admins only (R15): the server refuses everyone else; a failure only shortens the list.
  useSWR(
    isWorkspaceAdmin ? WORKSPACE_WORKFLOW_CANDIDATES(workspaceSlug) : null,
    isWorkspaceAdmin ? () => fetchCandidates(workspaceSlug) : null,
    SWR_OPTIONS
  );
  const workflow = getWorkflowDetail(workflowId);

  return (
    <div className="relative size-full overflow-hidden rounded-lg border border-subtle bg-surface-1">
      <PageHead title={workflow ? `${workflow.name} - ${t("workflows.label")}` : undefined} />
      {detail.error || statuses.error ? (
        <p role="alert" className="p-6 text-body-sm-regular text-danger-primary">
          {t("workflows.settings.load_error")}
        </p>
      ) : !workflow || !statuses.data ? (
        <Loader className="space-y-3 p-6">
          <Loader.Item height="560px" />
        </Loader>
      ) : (
        <WorkflowEditor
          key={workflow.id}
          workflow={workflow}
          statuses={getWorkspaceStatuses(workspaceSlug)}
          candidates={getWorkspaceCandidates(workspaceSlug)}
          readOnly={!isWorkspaceAdmin}
          onSave={(payload) => saveGraph(workspaceSlug, workflow.id, payload)}
          onClose={() => router.push(`/${workspaceSlug}/settings/workflows`)}
        />
      )}
    </div>
  );
}

export default observer(WorkflowEditorPage);
```

Dans `apps/web/app/routes/core.ts` :

1. supprimer, dans le groupe `layout("./(all)/[workspaceSlug]/(settings)/settings/(workspace)/layout.tsx", [...])`, le bloc

```ts
          route(
            ":workspaceSlug/settings/workflows/:workflowId",
            "./(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/[workflowId]/page.tsx"
          ),
```

2. ajouter, comme premier enfant de `layout("./(all)/[workspaceSlug]/layout.tsx", [`, avant le commentaire `PROJECTS APP SECTION` :

```ts
      // Workflow editor: full screen, outside the settings shell; the address is unchanged (X11).
      route(
        ":workspaceSlug/settings/workflows/:workflowId",
        "./(all)/[workspaceSlug]/workflow-editor/[workflowId]/page.tsx"
      ),
```

- [ ] **Step 8: Run the tests, check, look at the screen, commit**

Run : `pnpm turbo run test check:types check:lint --filter=web`
Expected : tout passe, dont les 5 tests de `workflow-editor.test.tsx` et le test `errorTarget`.

Vérification à l'écran (pile locale) : la liste ouvre l'éditeur sans le menu des paramètres ; « Ajouter un état » propose les états des projets ; cocher trois états les aligne à droite et recale la vue ; « Enregistrer » puis rechargement conserve le graphe ; « Fermer » revient à la liste ; un membre non admin voit le bandeau et aucun outil ; à 700 px de large la vue Texte s'ouvre et aucun outil d'ajout n'apparaît ; les deux thèmes sont lisibles.

```bash
git add apps/web/components/workflow/editor apps/web/app packages/constants/src/fetch-keys.ts
git commit -m "feat(web): rebuild the workflow editor as a full-screen workspace"
```

---

### Task 12: Liste des workflows, création depuis un projet, duplication (spec 6.1, R9, R11, R14)

Cette tâche câble l'écran sur une logique déjà testée : `uniqueName` (tâche 6), `duplicateWorkflow` (tâche 5), `source_project_id` (tâche 3). Elle n'ajoute aucune règle ; elle se vérifie par les types, le lint et un parcours à l'écran.

**Files:**

- Rewrite: `apps/web/components/workflow/settings/workflow-list.tsx`
- Modify: `apps/web/components/workflow/settings/workflow-create-modal.tsx`

**Interfaces:**

- Consumes : `useWorkflow()` (`getWorkspaceWorkflows`, `removeWorkflow`, `duplicateWorkflow`, `createWorkflow`) ; `uniqueName` ; `useProject()` (`workspaceProjectIds`, `getProjectById`) ; `renderFormattedDate` de `@plane/utils` ; clés i18n de la tâche 7.
- Produces : `WorkspaceWorkflowList({ workspaceSlug })` et `WorkflowCreateModal(props)`, mêmes props qu'aujourd'hui ; la page de la liste ne change pas.

- [ ] **Step 1: Rewrite the list as a table**

Remplacer tout le contenu de `apps/web/components/workflow/settings/workflow-list.tsx` (en gardant l'en-tête de copyright) :

```tsx
import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowSummary } from "@plane/types";
import { renderFormattedDate } from "@plane/utils";
// components
import { uniqueName } from "@/components/workflow/editor/graph-model";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";

type RowProps = { workspaceSlug: string; workflow: TWorkflowSummary; takenNames: string[] };

const CELL_CLASS = "border-b border-subtle p-2 align-top text-body-xs-regular text-secondary";

const WorkflowRow = observer(function WorkflowRow({ workspaceSlug, workflow, takenNames }: RowProps) {
  const { t } = useTranslation();
  const { removeWorkflow, duplicateWorkflow } = useWorkflow();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const inUse = workflow.project_count > 0;
  const deleteReasonId = `workflow-delete-reason-${workflow.id}`;
  const editorHref = `/${workspaceSlug}/settings/workflows/${workflow.id}`;
  const fail = () =>
    setToast({ type: "error", title: t("common.error.label"), message: t("workflows.settings.error") });

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await removeWorkflow(workspaceSlug, workflow.id);
      setIsDeleteOpen(false);
    } catch {
      fail();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDuplicate = async () => {
    setIsDuplicating(true);
    try {
      const name = uniqueName(t("workflows.settings.duplicate.copy_name", { name: workflow.name }), takenNames);
      await duplicateWorkflow(workspaceSlug, workflow.id, name);
      setToast({ type: "success", title: t("workflows.settings.duplicate.success"), message: "" });
    } catch {
      fail();
    } finally {
      setIsDuplicating(false);
    }
  };

  return (
    <tr>
      <td className={CELL_CLASS}>
        <Link href={editorHref} className="text-body-sm-medium text-primary hover:underline">
          {workflow.name}
        </Link>
      </td>
      <td className={CELL_CLASS}>{workflow.description}</td>
      <td className={CELL_CLASS}>{t("workflows.settings.state_count", { count: workflow.state_count })}</td>
      <td className={CELL_CLASS}>
        {t("workflows.settings.project_count", { count: workflow.project_count })}
        {workflow.projects && workflow.projects.length > 0 && (
          <p className="text-caption-sm-regular text-tertiary">
            {workflow.projects.map((project) => project.name).join(", ")}
          </p>
        )}
      </td>
      <td className={CELL_CLASS}>{renderFormattedDate(workflow.updated_at)}</td>
      <td className={CELL_CLASS}>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={editorHref} className="text-body-xs-medium text-accent-primary hover:underline">
            {t("workflows.settings.edit")}
          </Link>
          <Button
            variant="secondary"
            size="sm"
            stretch="auto"
            loading={isDuplicating}
            label={t("workflows.settings.duplicate.action")}
            onClick={handleDuplicate}
          />
          <Button
            variant="secondary"
            size="sm"
            stretch="auto"
            label={t("workflows.settings.delete.action")}
            disabled={inUse}
            aria-describedby={inUse ? deleteReasonId : undefined}
            onClick={() => setIsDeleteOpen(true)}
          />
        </div>
        {inUse && (
          <p id={deleteReasonId} className="mt-1 text-caption-sm-regular text-tertiary">
            {t("workflows.settings.delete.in_use")}
          </p>
        )}
        <ConfirmDialog
          handleClose={() => setIsDeleteOpen(false)}
          handleSubmit={handleDelete}
          isSubmitting={isDeleting}
          isOpen={isDeleteOpen}
          title={t("workflows.settings.delete.title")}
          content={t("workflows.settings.delete.description")}
          primaryButtonText={{ loading: t("deleting"), default: t("workflows.settings.delete.action") }}
        />
      </td>
    </tr>
  );
});

export const WorkspaceWorkflowList = observer(function WorkspaceWorkflowList({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const { t } = useTranslation();
  const { getWorkspaceWorkflows } = useWorkflow();
  const workflows = getWorkspaceWorkflows(workspaceSlug);
  const takenNames = workflows.map((workflow) => workflow.name);
  const columns = ["name", "description", "states", "projects", "updated", "actions"];

  if (workflows.length === 0)
    return <p className="text-body-sm-regular text-tertiary">{t("workflows.settings.empty")}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-0" aria-label={t("workflows.label")}>
        <thead>
          <tr className="text-left text-body-xs-medium text-secondary">
            {columns.map((column) => (
              <th key={column} scope="col" className="border-b border-subtle p-2">
                {t(`workflows.settings.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workflows.map((workflow) => (
            <WorkflowRow key={workflow.id} workspaceSlug={workspaceSlug} workflow={workflow} takenNames={takenNames} />
          ))}
        </tbody>
      </table>
    </div>
  );
});
```

Si `renderFormattedDate` n'est pas exporté par `@plane/utils` (`grep -rn "export const renderFormattedDate" packages/utils/src`), le remplacer par `new Date(workflow.updated_at).toLocaleDateString()` et retirer l'import.

- [ ] **Step 2: Add "Start from project" to the create dialog**

Dans `apps/web/components/workflow/settings/workflow-create-modal.tsx` :

1. ajouter l'import `import { useProject } from "@/hooks/store/use-project";` ;
2. remplacer `EMPTY` par :

```tsx
const EMPTY: TWorkflowFormData = { name: "", description: "", source_project_id: "" };
```

3. dans le composant, après `const { createWorkflow } = useWorkflow();` :

```tsx
const { workspaceProjectIds, getProjectById } = useProject();
```

4. dans `onSubmit`, remplacer l'appel à `createWorkflow` par :

```tsx
const workflow = await createWorkflow(workspaceSlug, {
  name: data.name.trim(),
  description: data.description?.trim(),
  // An empty choice means an empty workflow: the field is then left out.
  ...(data.source_project_id ? { source_project_id: data.source_project_id } : {}),
});
```

5. dans le formulaire, après le `Controller` de `description` :

```tsx
<label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
  {t("workflows.settings.form.source_project")}
  <Controller
    control={control}
    name="source_project_id"
    render={({ field: { value, onChange } }) => (
      <select
        className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular"
        value={value ?? ""}
        onChange={onChange}
      >
        <option value="">{t("workflows.settings.form.source_project_none")}</option>
        {(workspaceProjectIds ?? []).map((projectId) => {
          const project = getProjectById(projectId);
          return project ? (
            <option key={projectId} value={projectId}>
              {project.name}
            </option>
          ) : null;
        })}
      </select>
    )}
  />
</label>
```

Le serveur reste seul juge du projet choisi (tâche 3) ; un refus affiche le message d'erreur générique déjà présent.

- [ ] **Step 3: Check, look at the screen, commit**

Run : `pnpm turbo run test check:types check:lint --filter=web`
Expected : tout passe.

Vérification à l'écran : la liste est un tableau à six colonnes ; « Dupliquer » ajoute « Copie de <nom> », puis « Copie de <nom> (2) » ; la copie s'ouvre avec le même diagramme et n'est reliée à aucun projet ; « Supprimer » est inactif, avec son motif, pour un workflow utilisé ; « Créer un workflow » avec un projet choisi ouvre l'éditeur sur la chaîne de ses états, sans projet sur un workflow vide.

```bash
git add apps/web/components/workflow/settings
git commit -m "feat(web): list workflows in a table, duplicate them, start from a project"
```

---

### Task 13: Onglet Workflows du projet (spec 6.2, R13)

**Files:**

- Modify: `apps/web/components/workflow/project/scheme-helpers.ts`
- Modify: `apps/web/components/workflow/project/scheme-helpers.test.ts`
- Modify: `apps/web/components/workflow/project/project-workflow-scheme.tsx`

**Interfaces:**

- Consumes : `TProjectWorkflowScheme` ; l'état et les fonctions déjà présents dans `ProjectWorkflowScheme` (`scheme`, `types`, `needs`, `goToMapping`, `apply`, `detach`, `isPristine`, `setSyncTick`).
- Produces : `type TSchemeRow = { workflowId: string; isDefault: boolean; typeIds: string[] }` et `schemeRows(scheme): TSchemeRow[]` dans `scheme-helpers.ts`.

- [ ] **Step 1: Write the failing test**

À la fin de `apps/web/components/workflow/project/scheme-helpers.test.ts`, en ajoutant `schemeRows` à l'import :

```ts
describe("schemeRows", () => {
  it("returns nothing for a project without a scheme", () => {
    expect(schemeRows({ default_workflow_id: null, items: [] })).toEqual([]);
  });

  it("puts the default workflow first and groups the types of each other workflow", () => {
    expect(
      schemeRows({
        default_workflow_id: "default",
        items: [
          { issue_type_id: "bug", workflow_id: "strict" },
          { issue_type_id: "task", workflow_id: "default" },
          { issue_type_id: "story", workflow_id: "strict" },
        ],
      })
    ).toEqual([
      { workflowId: "default", isDefault: true, typeIds: ["task"] },
      { workflowId: "strict", isDefault: false, typeIds: ["bug", "story"] },
    ]);
  });
});
```

Run : `pnpm --filter=web exec vitest run components/workflow/project/scheme-helpers.test.ts`
Expected : FAIL, `schemeRows` n'est pas exporté.

- [ ] **Step 2: Write `schemeRows`**

Dans `apps/web/components/workflow/project/scheme-helpers.ts`, ajouter `TProjectWorkflowScheme` à l'import des types, puis à la fin du fichier :

```ts
export type TSchemeRow = { workflowId: string; isDefault: boolean; typeIds: string[] };

/** Rows of the linked-project table (ECR-038): the default workflow first, then each other workflow. */
export const schemeRows = (scheme: Pick<TProjectWorkflowScheme, "default_workflow_id" | "items">): TSchemeRow[] => {
  if (!scheme.default_workflow_id) return [];
  const rows: TSchemeRow[] = [{ workflowId: scheme.default_workflow_id, isDefault: true, typeIds: [] }];
  for (const item of scheme.items) {
    let row = rows.find((candidate) => candidate.workflowId === item.workflow_id);
    if (!row) {
      row = { workflowId: item.workflow_id, isDefault: false, typeIds: [] };
      rows.push(row);
    }
    row.typeIds.push(item.issue_type_id);
  }
  return rows;
};
```

Run : `pnpm --filter=web exec vitest run components/workflow/project/scheme-helpers.test.ts`
Expected : tous les tests du fichier passent.

- [ ] **Step 3: Show the table for a linked project**

Dans `apps/web/components/workflow/project/project-workflow-scheme.tsx` :

1. Imports : ajouter `import Link from "next/link";`, `import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";`, `import { useUserPermissions } from "@/hooks/store/user";`, et `schemeRows` à l'import de `./scheme-helpers`.

2. Après la ligne `const [isDetachOpen, setIsDetachOpen] = useState(false);` :

```tsx
// The wizard only shows while linking or changing; a linked project shows its table.
const [isEditing, setIsEditing] = useState(false);
const { allowPermissions } = useUserPermissions();
const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
const rows = scheme ? schemeRows(scheme) : [];
const isLinked = rows.length > 0;
```

3. Dans `apply`, après `setNeeds(null);`, ajouter `setIsEditing(false);`. Dans `detach`, après `setIsDetachOpen(false);` (branche de succès), ajouter `setIsEditing(false);`.

4. Avant le `return`, ajouter :

```tsx
const cancelEditing = () => {
  isPristine.current = true;
  setSyncTick((tick) => tick + 1);
  setNeeds(null);
  setErrorKey(null);
  setIsEditing(false);
};
```

5. Dans le JSX, remplacer le bloc

```tsx
{
  !scheme?.default_workflow_id && <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.free")}</p>;
}
```

par :

```tsx
{
  !isLinked && !isEditing && (
    <div className="space-y-3">
      <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.free")}</p>
      <Button
        variant="primary"
        size="md"
        stretch="auto"
        label={t("workflows.scheme.link")}
        onClick={() => setIsEditing(true)}
      />
    </div>
  );
}
{
  isLinked && !isEditing && (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size="md"
          stretch="auto"
          label={t("workflows.scheme.change")}
          onClick={() => setIsEditing(true)}
        />
        <Button
          variant="danger-outline"
          size="md"
          stretch="auto"
          label={t("workflows.scheme.detach")}
          onClick={() => setIsDetachOpen(true)}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-0" aria-label={t("workflows.label")}>
          <thead>
            <tr className="text-left text-body-xs-medium text-secondary">
              {(["workflow", "types", "actions"] as const).map((column) => (
                <th key={column} scope="col" className="border-b border-subtle p-2">
                  {t(`workflows.scheme.table.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = `/${workspaceSlug}/settings/workflows/${row.workflowId}`;
              const typeNames = row.typeIds.map((typeId) => types.find((type) => type.id === typeId)?.name ?? "");
              return (
                <tr key={row.workflowId} className="align-top text-body-sm-regular text-primary">
                  <td className="border-b border-subtle p-2">
                    {scheme?.workflows.find((workflow) => workflow.id === row.workflowId)?.name}
                  </td>
                  <td className="border-b border-subtle p-2 text-secondary">
                    {[...typeNames.filter(Boolean), ...(row.isDefault ? [t("workflows.scheme.other_types")] : [])].join(
                      ", "
                    )}
                  </td>
                  <td className="border-b border-subtle p-2">
                    <Link href={href} className="text-body-xs-medium text-accent-primary hover:underline">
                      {t(isWorkspaceAdmin ? "workflows.scheme.edit_workflow" : "workflows.scheme.view_workflow")}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

6. Envelopper l'expression existante `{needs === null ? ( ... ) : ( ... )}` (les deux étapes de l'assistant, jusqu'à sa parenthèse fermante) dans `{isEditing && ( ... )}`. Dans sa première branche, retirer le bouton « Détacher » (le bloc `{scheme?.default_workflow_id && (<Button variant="danger-outline" ... />)}`), désormais au-dessus du tableau, et ajouter à sa place :

```tsx
<Button
  variant="secondary"
  size="md"
  stretch="auto"
  disabled={isBusy}
  label={t("workflows.settings.form.cancel")}
  onClick={cancelEditing}
/>
```

Le `ConfirmDialog` de détachement reste à sa place, hors de ces blocs.

- [ ] **Step 4: Check, look at the screen, commit**

Run : `pnpm turbo run test check:types check:lint --filter=web`
Expected : tout passe.

Vérification à l'écran, en admin du projet : projet non relié, le texte et le bouton « Relier à un workflow » ; l'assistant en trois étapes fonctionne comme avant et « Annuler » revient à l'état initial ; projet relié, le tableau liste le workflow par défaut avec « Tous les autres types » et une ligne par autre workflow ; « Changer les workflows » rouvre l'assistant prérempli ; « Détacher » demande confirmation ; le lien ouvre l'éditeur, en lecture seule pour qui n'est pas admin du workspace.

```bash
git add apps/web/components/workflow/project
git commit -m "feat(web): show the workflows of a linked project in a table"
```

---

### Task 14: Vérification finale (spec 8, 9)

**Files:** aucun nouveau ; corrections éventuelles dans les fichiers des tâches précédentes, plus le nettoyage des textes inutilisés.

- [ ] **Step 1: Remove the texts nothing uses any more**

Pour chaque clé de `workflows.editor`, `workflows.settings` et `workflows.scheme` de `packages/i18n/src/locales/en/workflow.json`, chercher son dernier segment de chemin complet dans `apps/web` (par exemple `grep -rn "workflows.editor.add_state.existing" apps/web`). Les clés que les tâches 8 à 13 ont rendues orphelines sont au moins `workflows.editor.back`, `workflows.editor.add_state.existing`, `workflows.editor.add_state.new`, `workflows.editor.add_state.color`, `workflows.editor.panel.close`. Retirer des 22 locales toute clé sans occurrence, et aucune autre.

Run : `pnpm --filter=@plane/i18n sync:check`
Expected : `All locales are in sync with English. No issues found.`

```bash
git add packages/i18n/src/locales
git commit -m "chore(i18n): remove the workflow editor texts left unused"
```

- [ ] **Step 2: Backend suite on a fresh database**

Run : `docker compose -p wfr-final -f docker-compose-test.yml run --rm --build api-tests pytest --create-db`
Expected : tout passe ; noter le nombre de tests (1 989 avant cette refonte, plus ceux des tâches 1 à 4). Puis `docker compose -p wfr-final -f docker-compose-test.yml down -v`.

- [ ] **Step 3: Migration on the local database**

Run : `docker exec prototype-jira-api-1 python manage.py migrate db`
Expected : `Applying db.0130_workflow_transition_sides... OK`. Puis `docker exec prototype-jira-api-1 python manage.py makemigrations --check --dry-run` : `No changes detected`.

- [ ] **Step 4: Frontend checks**

Run : `pnpm check && pnpm turbo run test --filter=web && pnpm --filter=@plane/i18n sync:check`
Expected : format, lint, types, tests des projets `unit` et `dom`, et locales passent.

- [ ] **Step 5: Manual run through the acceptance criteria**

Sur la pile locale, dérouler les huit critères de la section 9 de la spec, puis les sections 3 et 6, avec quatre comptes : admin du workspace, admin du projet, membre, invité. Contrôler en plus :

- tout l'éditeur au clavier seul, dans le diagramme puis dans la vue Texte (spec 3.9) ;
- les trois nouvelles routes refusent un membre, par `curl` avec sa session : 403 sur `workflow-statuses/candidates/`, sur `POST workflows/` avec `source_project_id`, sur `workflows/<id>/duplicate/` ;
- les deux thèmes, et une largeur de 700 px ;
- aucune erreur dans la console du navigateur, sur les trois écrans.

- [ ] **Step 6: Record the result and hand over**

Noter dans le compte rendu de l'exécution les nombres de tests et tout ce qui n'a pas pu être vérifié, puis passer la main à `/qa`, `/ponytail-review` et `/security` (la livraison touche l'autorisation et l'exposition d'API), qui portent sur toute la livraison 2 (décision R6).

---

## Couverture de la spec

| Spec                                                  | Tâches                    |
| ----------------------------------------------------- | ------------------------- |
| R1 (modèle inchangé), R6 (livraison)                  | aucune (rien à faire), 14 |
| R2, R16, 5.1 (cible visuelle, couleurs)               | 9, 10, 11                 |
| R3 (trois écrans)                                     | 11, 12, 13                |
| R4, 3.7 (vues Diagramme et Texte)                     | 9, 11                     |
| R5, 3.5 (règle « limiter qui »)                       | 8                         |
| R7, 4.1, R15 (états proposés)                         | 2, 5, 6, 8                |
| R8, 3.3 (sélection multiple, « Rechercher ou créer ») | 6, 8                      |
| R9, R10, 4.2, 5.2 (création depuis un projet)         | 3, 5, 12                  |
| R11, 4.3 (duplication)                                | 4, 5, 6, 12               |
| R12 (placement, recalage)                             | 6, 10                     |
| R13, 6.2 (onglet du projet)                           | 13                        |
| R14, 6.1 (liste)                                      | 12                        |
| R17, 4.4 (côtés des flèches)                          | 1, 5, 6, 10               |
| R18 (nœud « DÉMARRER »)                               | 10                        |
| R19, 4.6 (tests d'affichage)                          | 8, 9, 10, 11              |
| 3.1 (en-tête)                                         | 11                        |
| 3.2 (diagramme)                                       | 10                        |
| 3.4 (fenêtre de transition)                           | 8                         |
| 3.6 (panneau droit)                                   | 11                        |
| 3.8 (lecture seule, refus, petits écrans)             | 11                        |
| 3.9 (accessibilité)                                   | 9, 10, 11, 14             |
| 3.10 (non repris)                                     | aucune (rien à faire)     |
| 4.5 (journal d'audit)                                 | 3, 4                      |
| 7 (STRIDE)                                            | 1, 2, 3, 4, 14            |
| 8 (tests)                                             | toutes                    |
| 9 (critères d'acceptation)                            | 14                        |
