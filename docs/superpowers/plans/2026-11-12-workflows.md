# Workflows (livraison 2) : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal** : des workflows partagés au niveau du workspace (statuts, transitions, règle « limiter qui »), reliés aux projets par type de ticket et imposés par le serveur sur chaque chemin d'écriture, avec un éditeur en diagramme et un assistant de rattachement.

**Architecture** : le backend ajoute des statuts de workspace (`WorkflowStatus`), des workflows qui les placent dans un graphe (`WorkflowState`, `WorkflowTransition`, sources, règles) et un système par projet (`ProjectWorkflowScheme` et ses lignes par type). Les états de projet ordinaires de Plane sont liés aux statuts par `State.workflow_status` et synchronisés par un service unique (`plane/utils/workflow_sync.py`). Un second service (`plane/utils/workflows.py`) résout le workflow d'un ticket et décide de chaque transition ; il est appelé par les serializers d'écriture des tickets, l'intake et l'automatisation, avec un filet dans `Issue.save`. Le frontend ajoute un store MobX `WorkflowStore`, deux onglets de paramètres (liste et éditeur React Flow côté workspace, système et assistant côté projet), le filtrage des sélecteurs d'état et du glisser-déposer par une fonction pure partagée.

**Tech Stack** : Django 5.2 + DRF, PostgreSQL 15, Celery, pytest (pile Docker `docker-compose-test.yml`), React Router 8 (SPA), MobX 6, SWR, `@xyflow/react` 12, `@makeplane/propel`, `@plane/blocks`, `@plane/i18n` (ICU), vitest 4.

**Spec** : `docs/superpowers/specs/2026-11-12-workflows-design.md` (amendée W17 : statuts partagés). Dépend de la livraison 1 : `docs/superpowers/specs/2026-11-12-work-item-types-design.md`.

## Global Constraints

- TDD strict : chaque étape de code commence par un test qui échoue, exécuté et observé en échec.
- Identifiants techniques en anglais (variables, fonctions, classes, routes, tables, clés i18n, fichiers).
- Commentaires uniquement pour le pourquoi, sur une ligne.
- Aucun tiret cadratin (U+2014) dans le code, les commentaires, les commits ou ce document.
- Commits Conventional Commits `<type>(<scope>): <subject>`, minuscules, impératif, 72 caractères au plus, sans `Co-Authored-By` ni aucune mention d'IA.
- Autorisation contrôlée côté serveur sur chaque opération ; l'interface ne fait que refléter les droits (A1 à A5).
- Refus d'une transition : réponse 400 de corps `{"workflow": ["transition_not_allowed"]}`, identique quelle que soit la raison (4.5). Changement de type sans état d'arrivée possible : `{"workflow": ["arrival_state_required"]}` (W9).
- Bornes (spec 8) : 1 000 statuts par workspace, 200 états et 1 000 transitions par workflow, noms 255 caractères.
- Tout nouveau texte d'interface passe par `packages/i18n` (en et fr écrits dans ce plan, les 20 autres locales via le skill `translate`) ; en français on dit « ticket ».
- Migrations générées avec `uv run python manage.py makemigrations db -n <name>` (depuis `apps/api`) ; `apps/api/migrations_lockfile.txt` est commité avec elles, jamais édité à la main.
- Jamais `--no-verify`.
- Dépendances JS épinglées via le catalogue pnpm (`"catalog:"`, version exacte publiée depuis plus de 30 jours), dépendances Python via `uv`.
- Nouveaux fichiers `.py`, `.ts`, `.tsx` (hors migrations, `*.config.ts`, `*.d.ts`) : en-tête `COPYRIGHT.txt` :
  - Python : `# Copyright (c) 2023-present Plane Software, Inc. and contributors` / `# SPDX-License-Identifier: AGPL-3.0-only` / `# See the LICENSE file for details.`
  - TypeScript : le même texte dans un bloc `/** ... */`.
- Commandes backend, depuis la racine du worktree : `docker compose -p wf-<tâche> -f docker-compose-test.yml run --rm --build api-tests pytest --create-db <chemin> -v` (`-p` unique par exécution pour ne pas partager la base avec une autre exécution ; `--create-db` car `pytest.ini` active `--reuse-db --nomigrations`).
- Tests qui enregistrent une activité ou une tâche Celery : fixture `mock_celery` (déjà fournie par `plane/tests/conftest.py`).
- Frontend : conventions de Plane (MobX + SWR), dérogation explicite aux règles ASIN FE-2, FE-3, FE-6.

## Décisions prises en écrivant ce plan

Elles complètent la spec sans la contredire ; chacune est reprise dans la tâche qui l'implémente.

| #   | Décision                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | L'éditeur enregistre tout le graphe d'un coup : `PUT .../workflows/<id>/graph/` (états, statuts créés ou modifiés, transitions, règles), en une transaction. C'est ce que demande l'enregistrement explicite (7.2).                                                                                                                                        |
| P2  | Les lignes internes du graphe (états de workflow, transitions, sources, règles, système et lignes du système) sont supprimées physiquement ; leur historique est dans l'instantané du journal d'audit. `WorkflowStatus` et `Workflow` gardent la suppression logique de Plane.                                                                             |
| P3  | L'acteur d'une transition est l'utilisateur de la requête lu par `crum.get_current_user()`, comme le fait déjà `BaseModel` pour `created_by` ; sans acteur (tâche Celery), une règle « limiter qui » refuse.                                                                                                                                               |
| P4  | La déduction automatique du groupe ignore les transitions globales : une flèche « depuis n'importe quel état » vers « Annulé » ne doit pas empêcher « Livré » d'être un état final.                                                                                                                                                                        |
| P5  | Un ticket en triage, ou dans un état non géré, n'a pour sorties que les transitions globales.                                                                                                                                                                                                                                                              |
| P6  | La liste des projets qui utilisent un workflow n'est renvoyée qu'aux admins du workspace ; les autres membres reçoivent le nombre (A1 sans divulguer les noms de projets privés).                                                                                                                                                                          |
| P7  | Un statut ne peut pas s'appeler « Triage » (sans tenir compte de la casse) : le nom est déjà pris par l'état de triage de l'intake dans chaque projet.                                                                                                                                                                                                     |
| P8  | Échanger les noms de deux statuts dans un même enregistrement est refusé par la contrainte d'unicité (400) ; il faut deux enregistrements. Limite assumée, notée dans le code.                                                                                                                                                                             |
| P9  | Pour l'automatisation (T4), seule une transition globale sans règle compte : la tâche n'a pas d'acteur (P3).                                                                                                                                                                                                                                               |
| P10 | Le corps de `GET .../workflow-scheme/` embarque les graphes des workflows du système, pour que le frontend calcule les états atteignables sans requête supplémentaire.                                                                                                                                                                                     |
| P11 | Les formulaires de l'éditeur et de l'assistant utilisent les éléments HTML natifs (`select`, cases à cocher, `input type="color"`), utilisables au clavier et par les lecteurs d'écran sans adaptation ; boutons et champs texte viennent de `@makeplane/propel` comme dans la livraison 1. La revue d'interface prévue après ce lot pourra les remplacer. |

---

## File Structure

### Backend (`apps/api`)

| Fichier                                                                                                      | Action          | Responsabilité                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `plane/db/models/workflow.py`                                                                                | Create          | Modèles des statuts, workflows, transitions, règles et systèmes ; bornes et constantes.                                                 |
| `plane/db/models/state.py`                                                                                   | Modify          | `State.workflow_status` et contrainte d'unicité par projet (invariant 3).                                                               |
| `plane/db/models/issue.py`                                                                                   | Modify          | Ordre des gardes de `save`, état par défaut sous workflow, filet du modèle (4.4), `type_id` suivi.                                      |
| `plane/db/models/__init__.py`                                                                                | Modify          | Exporter les nouveaux modèles.                                                                                                          |
| `plane/db/migrations/0129_workflows.py`                                                                      | Create (généré) | Tables et contraintes.                                                                                                                  |
| `migrations_lockfile.txt`                                                                                    | Modify (généré) | Dernière migration de `db`.                                                                                                             |
| `plane/utils/workflows.py`                                                                                   | Create          | `workflow_id_for`, `initial_state`, `check_transition`, `resolve_workflow_state` (4.1, T1, T2, 4.5).                                    |
| `plane/utils/workflow_sync.py`                                                                               | Create          | `sync_project_states`, `mapping_needs`, `apply_scheme`, `detach_scheme`, `status_usage`, `deduce_groups` (W4, W5, W10, W11, 5.1 à 5.3). |
| `plane/app/serializers/workflow.py`                                                                          | Create          | Lecture des statuts et workflows ; validation du graphe, des règles et du système de projet.                                            |
| `plane/utils/workflow_graph.py`                                                                              | Create          | Instantané du graphe (`workflow_graph`) et enregistrement complet (`save_workflow_graph`, P1).                                          |
| `plane/app/serializers/__init__.py`                                                                          | Modify          | Exports.                                                                                                                                |
| `plane/app/serializers/state.py`                                                                             | Modify          | `workflow_status` en lecture seule dans les réponses.                                                                                   |
| `plane/app/views/workflow/base.py`                                                                           | Create          | Routes des statuts, des workflows, du graphe et du système de projet.                                                                   |
| `plane/app/views/__init__.py`                                                                                | Modify          | Exports.                                                                                                                                |
| `plane/app/urls/workflow.py`                                                                                 | Create          | Les 7 routes.                                                                                                                           |
| `plane/app/urls/__init__.py`                                                                                 | Modify          | Enregistrer `workflow_urls`.                                                                                                            |
| `plane/app/serializers/issue.py`                                                                             | Modify          | `IssueCreateSerializer.validate` appelle `resolve_workflow_state`.                                                                      |
| `plane/api/serializers/issue.py`                                                                             | Modify          | Même appel dans le serializer de l'API v1.                                                                                              |
| `plane/app/serializers/intake.py`, `plane/api/serializers/intake.py`                                         | Modify          | T3 : acceptation vers l'état initial du workflow.                                                                                       |
| `plane/bgtasks/issue_automation_task.py`                                                                     | Modify          | T4 et correction de l'état choisi hors projet.                                                                                          |
| `plane/app/views/state/base.py`, `plane/api/views/state.py`                                                  | Modify          | 5.4 : écritures refusées sur un projet doté d'un système.                                                                               |
| `plane/tests/factories.py`                                                                                   | Modify          | `WorkflowStatusFactory`, `WorkflowFactory`.                                                                                             |
| `plane/tests/workflow_builders.py`                                                                           | Create          | `build_workflow`, `link_project` : construire un workflow et relier un projet en une ligne dans les tests.                              |
| `plane/tests/unit/models/test_workflow_models.py`                                                            | Create          | Contraintes et invariants 1, 3, 6.                                                                                                      |
| `plane/tests/unit/utils/test_workflows.py`                                                                   | Create          | Résolution, `check_transition`, « limiter qui ».                                                                                        |
| `plane/tests/unit/utils/test_workflow_sync.py`                                                               | Create          | Synchronisation, correspondance, rattachement, détachement, groupes.                                                                    |
| `plane/tests/unit/serializers/test_workflow_graph.py`                                                        | Create          | Validation du graphe et des règles.                                                                                                     |
| `plane/tests/contract/app/test_workflows_app.py`                                                             | Create          | Routes des statuts et workflows : droits, 404, 5.2, audit.                                                                              |
| `plane/tests/contract/app/test_workflow_scheme_app.py`                                                       | Create          | Routes du système : droits, correspondance, rattachement, détachement, audit.                                                           |
| `plane/tests/contract/app/test_workflow_enforcement_app.py`                                                  | Create          | Contrôle sur l'application et les brouillons (T1, T2, 4.1, 4.5).                                                                        |
| `plane/tests/contract/api/test_workflow_enforcement_api.py`                                                  | Create          | Contrôle sur l'API v1 et sa clé d'API.                                                                                                  |
| `plane/tests/unit/models/test_issue_workflow_guard.py`                                                       | Create          | Filet du modèle (4.4) et état par défaut sous workflow.                                                                                 |
| `plane/tests/contract/app/test_managed_states_app.py`, `plane/tests/contract/api/test_managed_states_api.py` | Create          | États en lecture seule et `workflow_status` en lecture seule (5.4).                                                                     |
| `plane/tests/unit/serializers/test_intake_accept_workflow.py`                                                | Create          | Intake (T3) sur les deux serializers.                                                                                                   |
| `plane/tests/unit/bg_tasks/test_close_old_issues_workflow.py`                                                | Create          | Automatisation (T4) et correction hors projet.                                                                                          |

### Frontend

| Fichier                                                                                                                                                | Action         | Responsabilité                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------ |
| `pnpm-workspace.yaml`, `apps/web/package.json`                                                                                                         | Modify         | `@xyflow/react` épinglé.                                                 |
| `packages/types/src/workflow.ts`, `packages/types/src/index.ts`                                                                                        | Create, Modify | Types des statuts, workflows, graphe, système, correspondance.           |
| `packages/types/src/state.ts`                                                                                                                          | Modify         | `workflow_status` sur `IState`.                                          |
| `packages/constants/src/fetch-keys.ts`                                                                                                                 | Modify         | Clés SWR.                                                                |
| `apps/web/services/workflow.service.ts`                                                                                                                | Create         | Appels HTTP.                                                             |
| `apps/web/store/workspace/workflow.store.ts` (+ `.test.ts`), `apps/web/store/workspace/index.ts`                                                       | Create, Modify | Store MobX.                                                              |
| `apps/web/hooks/store/use-workflow.ts`                                                                                                                 | Create         | Hook d'accès au store.                                                   |
| `apps/web/components/workflow/helpers.ts` (+ `.test.ts`)                                                                                               | Create         | États atteignables, état initial, clés de refus (logique pure partagée). |
| `apps/web/components/workflow/use-allowed-states.ts`                                                                                                   | Create         | Hook qui applique `helpers.ts` aux stores.                               |
| `apps/web/components/workflow/use-workflow-drag-n-drop.ts`, `drag-n-drop-helpers.ts` (+ `.test.ts`)                                                    | Modify, Create | Glisser-déposer réel (7.4).                                              |
| `apps/web/components/workflow/arrival-state-dialog.tsx`                                                                                                | Create         | Choix de l'état d'arrivée (W9).                                          |
| `apps/web/components/workflow/project/scheme-helpers.ts` (+ `.test.ts`)                                                                                | Create         | Corps du système et clés d'erreur de l'assistant.                        |
| `apps/web/components/workflow/editor/graph-model.ts` (+ `.test.ts`)                                                                                    | Create         | Brouillon du graphe dans l'éditeur (logique pure).                       |
| `apps/web/components/workflow/editor/*.tsx`                                                                                                            | Create         | Éditeur : diagramme, formulaires clavier, panneau latéral.               |
| `apps/web/components/workflow/settings/*.tsx`                                                                                                          | Create         | Liste des workflows du workspace.                                        |
| `apps/web/components/workflow/project/project-workflow-scheme.tsx`                                                                                     | Create         | Système du projet et assistant.                                          |
| `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/**`                                                                      | Create         | Pages liste et éditeur.                                                  |
| `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/workflows/**`                                                             | Create         | Page du système du projet.                                               |
| `apps/web/app/routes/core.ts`, `packages/constants/src/settings/{workspace,project}.ts`, `packages/types/src/settings.ts`, icônes des barres latérales | Modify         | Onglets.                                                                 |
| `apps/web/components/project-states/root.tsx`                                                                                                          | Modify         | Lecture seule et bandeau (5.4).                                          |
| `apps/web/components/dropdowns/state/state-select.tsx` et ses appelants                                                                                | Modify         | `allowedStateIds` (7.4).                                                 |
| `apps/web/components/issues/issue-modal/components/default-properties.tsx`                                                                             | Modify         | État initial en lecture seule à la création.                             |
| `apps/web/components/issues/issue-type-switcher.tsx`                                                                                                   | Modify         | Choix de l'état d'arrivée (W9).                                          |
| `apps/web/hooks/use-group-dragndrop.ts`, `kanban/kanban-group.tsx`, `list/list-group.tsx`, `group-drag-overlay.tsx`                                    | Modify         | Blocage et message traduit.                                              |
| `apps/web/components/issues/issue-detail/root.tsx`, `peek-overview/root.tsx`                                                                           | Modify         | Message de refus traduit (4.5).                                          |
| `packages/i18n/src/locales/*/workflow.json`                                                                                                            | Modify         | Textes (22 locales).                                                     |

---

### Task 1: Modèles, migration et outils de test (spec 3.1, 3.2, W17, P2, P7)

**Files:**

- Create: `apps/api/plane/db/models/workflow.py`
- Modify: `apps/api/plane/db/models/state.py` (champ `workflow_status`, contrainte dans `Meta.constraints`)
- Modify: `apps/api/plane/db/models/__init__.py`
- Create (généré): `apps/api/plane/db/migrations/0129_workflows.py`, Modify (généré): `apps/api/migrations_lockfile.txt`
- Modify: `apps/api/plane/tests/factories.py`
- Create: `apps/api/plane/tests/workflow_builders.py`
- Test: `apps/api/plane/tests/unit/models/test_workflow_models.py`

**Interfaces:**

- Produces (modèles, tous exportés par `plane.db.models`) : `WorkflowStatus(workspace, name, color, group, group_is_auto, sequence)`, `Workflow(workspace, name, description)`, `WorkflowState(workflow, status, position_x, position_y, is_initial)` (related_name `states` sur `Workflow`, `workflow_states` sur `WorkflowStatus`), `WorkflowTransition(workflow, target, name, from_any)` (related_name `transitions`), `WorkflowTransitionSource(transition, source)` (related_name `sources`), `WorkflowTransitionRule(transition, rule_type, params)` (related_name `rules`), `ProjectWorkflowScheme(project, workspace, default_workflow)` (`project` en `OneToOneField`, related_name `workflow_scheme`), `ProjectWorkflowSchemeItem(scheme, issue_type, workflow)` (related_name `items`), `State.workflow_status`.
- Produces (constantes de `plane.db.models.workflow`) : `MAX_STATUSES_PER_WORKSPACE = 1000`, `MAX_STATES_PER_WORKFLOW = 200`, `MAX_TRANSITIONS_PER_WORKFLOW = 1000`, `RULE_RESTRICT_ACTORS = "restrict_actors"`, `WORKFLOW_GROUPS` (les groupes de `StateGroup` sauf `triage`), `RESERVED_STATUS_NAMES = {"triage"}`.
- Produces (tests) : `WorkflowStatusFactory`, `WorkflowFactory` ; `build_workflow(workspace, name, statuses, transitions=(), initial=None) -> Workflow` avec l'attribut `states_by_name: dict[str, WorkflowState]`, où `transitions` est une suite de triplets `(sources, target, rule_params)` : `sources` vaut `"*"` pour une transition globale ou une liste de noms de statuts, `rule_params` vaut `None` ou le dictionnaire de la règle `restrict_actors`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/plane/tests/unit/models/test_workflow_models.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.db import IntegrityError, transaction

from plane.db.models import (
    Project,
    ProjectWorkflowScheme,
    ProjectWorkflowSchemeItem,
    State,
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkflowTransition,
    WorkflowTransitionRule,
    WorkflowTransitionSource,
)
from plane.tests.factories import IssueTypeFactory, WorkflowFactory, WorkflowStatusFactory
from plane.tests.workflow_builders import build_workflow

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def project(workspace, create_user):
    return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)


def test_status_names_are_unique_per_workspace_whatever_the_case(workspace):
    WorkflowStatusFactory(workspace=workspace, name="To do")
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowStatusFactory(workspace=workspace, name="TO DO")


def test_a_deleted_status_frees_its_name(workspace):
    WorkflowStatus.objects.filter(pk=WorkflowStatusFactory(workspace=workspace, name="To do").pk).delete()
    assert WorkflowStatusFactory(workspace=workspace, name="To do").name == "To do"


def test_a_status_never_uses_the_triage_group(workspace):
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowStatusFactory(workspace=workspace, group="triage")


def test_workflow_names_are_unique_per_workspace_whatever_the_case(workspace):
    WorkflowFactory(workspace=workspace, name="Software")
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowFactory(workspace=workspace, name="software")


def test_a_workflow_has_at_most_one_initial_state(workspace):
    workflow = build_workflow(workspace, "Software", ["To do", "Done"])
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowState.objects.filter(pk=workflow.states_by_name["Done"].pk).update(is_initial=True)


def test_a_status_appears_once_per_workflow(workspace):
    workflow = build_workflow(workspace, "Software", ["To do"])
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkflowState.objects.create(workflow=workflow, status=workflow.states_by_name["To do"].status)


def test_two_workflows_share_a_status(workspace):
    software = build_workflow(workspace, "Software", ["To do", "Done"])
    support = build_workflow(workspace, "Support", ["To do", "Closed"])
    assert software.states_by_name["To do"].status_id == support.states_by_name["To do"].status_id
    assert WorkflowStatus.objects.filter(workspace=workspace).count() == 3


def test_the_builder_creates_sources_and_rules(workspace):
    workflow = build_workflow(
        workspace,
        "Software",
        ["To do", "Doing", "Done"],
        [(["To do"], "Doing", None), ("*", "Done", {"roles": [20]})],
    )
    local = WorkflowTransition.objects.get(workflow=workflow, target=workflow.states_by_name["Doing"])
    globally = WorkflowTransition.objects.get(workflow=workflow, target=workflow.states_by_name["Done"])
    assert local.from_any is False
    assert list(WorkflowTransitionSource.objects.filter(transition=local).values_list("source__status__name", flat=True)) == [
        "To do"
    ]
    assert globally.from_any is True
    assert WorkflowTransitionRule.objects.get(transition=globally).params == {"roles": [20]}


def test_a_project_state_links_one_status_at_most(workspace, project):
    status = WorkflowStatusFactory(workspace=workspace)
    State.objects.create(name="A", project=project, workflow_status=status)
    with pytest.raises(IntegrityError), transaction.atomic():
        State.objects.create(name="B", project=project, workflow_status=status)


def test_a_project_has_one_scheme_and_one_line_per_type(workspace, project):
    workflow = WorkflowFactory(workspace=workspace)
    scheme = ProjectWorkflowScheme.objects.create(project=project, workspace=workspace, default_workflow=workflow)
    bug = IssueTypeFactory(workspace=workspace)
    ProjectWorkflowSchemeItem.objects.create(scheme=scheme, issue_type=bug, workflow=workflow)
    with pytest.raises(IntegrityError), transaction.atomic():
        ProjectWorkflowScheme.objects.create(project=project, workspace=workspace, default_workflow=workflow)
    with pytest.raises(IntegrityError), transaction.atomic():
        ProjectWorkflowSchemeItem.objects.create(scheme=scheme, issue_type=bug, workflow=workflow)


def test_deleting_a_workflow_row_removes_its_graph(workspace):
    workflow = build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", {"creator": True})])
    Workflow.objects.filter(pk=workflow.pk).delete(soft=False)
    assert not WorkflowState.objects.exists()
    assert not WorkflowTransition.objects.exists()
    assert not WorkflowTransitionRule.objects.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -p wf-t1 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/models/test_workflow_models.py -v`
Expected: FAIL at collection with `ImportError: cannot import name 'ProjectWorkflowScheme' from 'plane.db.models'`.

- [ ] **Step 3: Write the models**

Create `apps/api/plane/db/models/workflow.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

# Module imports
from .base import BaseModel
from .state import StateGroup

MAX_STATUSES_PER_WORKSPACE = 1000
MAX_STATES_PER_WORKFLOW = 200
MAX_TRANSITIONS_PER_WORKFLOW = 1000
RULE_RESTRICT_ACTORS = "restrict_actors"
WORKFLOW_GROUPS = [group for group in StateGroup.values if group != StateGroup.TRIAGE.value]
# The intake creates a project state named "Triage" in every project (P7).
RESERVED_STATUS_NAMES = {"triage"}


class WorkflowGraphRow(models.Model):
    """Inner row of a workflow graph: hard-deleted with its parent, history kept in the audit snapshot (P2)."""

    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class WorkflowStatus(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workflow_statuses")
    name = models.CharField(max_length=255)
    color = models.CharField(max_length=7)
    group = models.CharField(max_length=20, choices=StateGroup.choices, default=StateGroup.STARTED)
    group_is_auto = models.BooleanField(default=True)
    sequence = models.FloatField(default=65535)

    class Meta:
        db_table = "workflow_statuses"
        ordering = ("sequence", "name")
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                "workspace",
                condition=Q(deleted_at__isnull=True),
                name="workflow_status_unique_lower_name_workspace_when_deleted_at_null",
            ),
            models.CheckConstraint(condition=~Q(group=StateGroup.TRIAGE.value), name="workflow_status_group_not_triage"),
        ]

    def __str__(self):
        return self.name


class Workflow(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workflows")
    name = models.CharField(max_length=255)
    description = models.CharField(max_length=1000, blank=True, default="")

    class Meta:
        db_table = "workflows"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                "workspace",
                condition=Q(deleted_at__isnull=True),
                name="workflow_unique_lower_name_workspace_when_deleted_at_null",
            ),
        ]

    def __str__(self):
        return self.name


class WorkflowState(WorkflowGraphRow):
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="states")
    status = models.ForeignKey(WorkflowStatus, on_delete=models.PROTECT, related_name="workflow_states")
    position_x = models.FloatField(default=0)
    position_y = models.FloatField(default=0)
    is_initial = models.BooleanField(default=False)

    class Meta:
        db_table = "workflow_states"
        constraints = [
            models.UniqueConstraint(fields=["workflow", "status"], name="workflow_state_unique_status"),
            models.UniqueConstraint(
                fields=["workflow"], condition=Q(is_initial=True), name="workflow_state_single_initial"
            ),
        ]


class WorkflowTransition(WorkflowGraphRow):
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="transitions")
    target = models.ForeignKey(WorkflowState, on_delete=models.CASCADE, related_name="incoming_transitions")
    name = models.CharField(max_length=255, blank=True, default="")
    from_any = models.BooleanField(default=False)

    class Meta:
        db_table = "workflow_transitions"


class WorkflowTransitionSource(WorkflowGraphRow):
    transition = models.ForeignKey(WorkflowTransition, on_delete=models.CASCADE, related_name="sources")
    source = models.ForeignKey(WorkflowState, on_delete=models.CASCADE, related_name="outgoing_sources")

    class Meta:
        db_table = "workflow_transition_sources"
        constraints = [
            models.UniqueConstraint(fields=["transition", "source"], name="workflow_transition_source_unique"),
        ]


class WorkflowTransitionRule(WorkflowGraphRow):
    transition = models.ForeignKey(WorkflowTransition, on_delete=models.CASCADE, related_name="rules")
    rule_type = models.CharField(max_length=64, choices=[(RULE_RESTRICT_ACTORS, "Restrict actors")])
    params = models.JSONField(default=dict)

    class Meta:
        db_table = "workflow_transition_rules"
        constraints = [
            models.UniqueConstraint(fields=["transition", "rule_type"], name="workflow_transition_rule_unique_type"),
        ]


class ProjectWorkflowScheme(WorkflowGraphRow):
    project = models.OneToOneField("db.Project", on_delete=models.CASCADE, related_name="workflow_scheme")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workflow_schemes")
    default_workflow = models.ForeignKey(Workflow, on_delete=models.PROTECT, related_name="default_for_schemes")

    class Meta:
        db_table = "project_workflow_schemes"


class ProjectWorkflowSchemeItem(WorkflowGraphRow):
    scheme = models.ForeignKey(ProjectWorkflowScheme, on_delete=models.CASCADE, related_name="items")
    issue_type = models.ForeignKey("db.IssueType", on_delete=models.CASCADE, related_name="workflow_scheme_items")
    workflow = models.ForeignKey(Workflow, on_delete=models.PROTECT, related_name="scheme_items")

    class Meta:
        db_table = "project_workflow_scheme_items"
        constraints = [
            models.UniqueConstraint(fields=["scheme", "issue_type"], name="project_workflow_scheme_item_unique_type"),
        ]
```

In `apps/api/plane/db/models/state.py`, add the field after `external_id`:

```python
    # Set when the project follows workflows: the state mirrors this workspace status (W4).
    workflow_status = models.ForeignKey(
        "db.WorkflowStatus", on_delete=models.SET_NULL, null=True, blank=True, related_name="project_states"
    )
```

and append to `Meta.constraints`:

```python
            models.UniqueConstraint(
                fields=["project", "workflow_status"],
                condition=Q(deleted_at__isnull=True, workflow_status__isnull=False),
                name="state_unique_project_workflow_status_when_deleted_at_null",
            ),
```

In `apps/api/plane/db/models/__init__.py`, after the `issue_type` line:

```python
from .workflow import (
    ProjectWorkflowScheme,
    ProjectWorkflowSchemeItem,
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkflowTransition,
    WorkflowTransitionRule,
    WorkflowTransitionSource,
)
```

- [ ] **Step 4: Add the test helpers**

In `apps/api/plane/tests/factories.py`, extend the model import with `Workflow, WorkflowStatus` and append:

```python
class WorkflowStatusFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = WorkflowStatus

    workspace = factory.SubFactory(WorkspaceFactory)
    name = factory.Sequence(lambda n: f"Status {n}")
    color = "#3A3A3A"
    group = "started"


class WorkflowFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Workflow

    workspace = factory.SubFactory(WorkspaceFactory)
    name = factory.Sequence(lambda n: f"Workflow {n}")
```

Create `apps/api/plane/tests/workflow_builders.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import (
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkflowTransition,
    WorkflowTransitionRule,
    WorkflowTransitionSource,
)
from plane.db.models.workflow import RULE_RESTRICT_ACTORS


def build_workflow(workspace, name, statuses, transitions=(), initial=None):
    """Create a workflow over shared statuses; transitions are (sources or "*", target, rule params or None)."""
    workflow = Workflow.objects.create(workspace=workspace, name=name)
    initial = initial or statuses[0]
    states = {}
    for index, status_name in enumerate(statuses):
        status = WorkflowStatus.objects.filter(workspace=workspace, name__iexact=status_name).first()
        if status is None:
            status = WorkflowStatus.objects.create(workspace=workspace, name=status_name, color="#3A3A3A")
        states[status_name] = WorkflowState.objects.create(
            workflow=workflow, status=status, is_initial=status_name == initial, position_x=index * 240
        )
    for sources, target, rule_params in transitions:
        transition = WorkflowTransition.objects.create(workflow=workflow, target=states[target], from_any=sources == "*")
        if sources != "*":
            for source in sources:
                WorkflowTransitionSource.objects.create(transition=transition, source=states[source])
        if rule_params is not None:
            WorkflowTransitionRule.objects.create(transition=transition, rule_type=RULE_RESTRICT_ACTORS, params=rule_params)
    workflow.states_by_name = states
    return workflow
```

- [ ] **Step 5: Generate the migration**

Run (from `apps/api`): `uv run python manage.py makemigrations db -n workflows`
Expected: `plane/db/migrations/0129_workflows.py` created (8 models, `State.workflow_status`, the new constraints) and `migrations_lockfile.txt` now reads `db: 0129_workflows`. Read the generated file: it must contain no `RunPython` and no change to unrelated models; if `makemigrations` needs a database, run it in the container instead: `docker compose -p wf-t1 -f docker-compose-test.yml run --rm api-tests python manage.py makemigrations db -n workflows`.

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose -p wf-t1 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/models/test_workflow_models.py -v`
Expected: 11 passed.

- [ ] **Step 7: Check the migration applies on a real schema**

Run: `docker compose -p wf-t1 -f docker-compose-test.yml run --rm api-tests sh -c "python manage.py migrate --noinput && python manage.py makemigrations --check --dry-run"`
Expected: migrations applied, then `No changes detected`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/plane/db/models/workflow.py apps/api/plane/db/models/state.py apps/api/plane/db/models/__init__.py apps/api/plane/db/migrations/0129_workflows.py apps/api/migrations_lockfile.txt apps/api/plane/tests/factories.py apps/api/plane/tests/workflow_builders.py apps/api/plane/tests/unit/models/test_workflow_models.py
git commit -m "feat(api): add workflow, status and project scheme models"
```

---

### Task 2: Résolution du workflow et contrôle des transitions (spec 3.3, 4.1, 4.5, T1, T2, W6, W9, P3, P5)

**Files:**

- Create: `apps/api/plane/utils/workflows.py`
- Test: `apps/api/plane/tests/unit/utils/test_workflows.py`

**Interfaces:**

- Consumes: modèles de la Task 1, `build_workflow`.
- Produces (`plane.utils.workflows`) :
  - `TRANSITION_NOT_ALLOWED = "transition_not_allowed"`, `ARRIVAL_STATE_REQUIRED = "arrival_state_required"`, `refusal(code) -> rest_framework.serializers.ValidationError` (corps `{"workflow": [code]}`).
  - `workflow_id_for(project_id, type_id) -> UUID | None`.
  - `project_default_type_id(project_id) -> UUID | None`.
  - `state_in_workflow(state, workflow_id) -> bool`.
  - `initial_state(project_id, workflow_id) -> State | None`.
  - `check_transition(issue, from_state, to_state, actor, workflow_id=None) -> bool`.
  - `resolve_workflow_state(*, project_id, instance, state, state_given, type_id) -> State | None` : l'état que le ticket doit prendre (création : l'état initial), `None` pour laisser la requête telle quelle ; lève `refusal(...)`. `type_id` est le type demandé, `None` s'il n'est pas demandé. L'acteur est `crum.get_current_user()` (P3).

- [ ] **Step 1: Write the failing test**

Create `apps/api/plane/tests/unit/utils/test_workflows.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from crum import set_current_user
from rest_framework import serializers

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueType,
    Project,
    ProjectMember,
    ProjectWorkflowScheme,
    ProjectWorkflowSchemeItem,
    State,
    WorkspaceMember,
)
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory, UserFactory
from plane.tests.workflow_builders import build_workflow
from plane.utils.workflows import (
    ARRIVAL_STATE_REQUIRED,
    TRANSITION_NOT_ALLOWED,
    check_transition,
    initial_state,
    resolve_workflow_state,
    workflow_id_for,
)

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def users(workspace, create_user):
    people = {"admin": create_user}
    for name, role in (("member", 15), ("guest", 5), ("other_member", 15), ("outside_admin", 20)):
        people[name] = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=people[name], role=role)
    return people


@pytest.fixture
def project(workspace, users):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=users["admin"])
    for name, role in (("admin", 20), ("member", 15), ("guest", 5), ("other_member", 15)):
        ProjectMember.objects.create(project=project, member=users[name], role=role)
    return project


@pytest.fixture
def software(workspace):
    return build_workflow(
        workspace,
        "Software",
        ["To do", "Doing", "Done", "Cancelled"],
        [
            (["To do"], "Doing", None),
            (["Doing"], "Done", {"roles": [20]}),
            ("*", "Cancelled", None),
        ],
    )


@pytest.fixture
def support(workspace):
    return build_workflow(workspace, "Support", ["New", "Doing", "Closed"], [(["New"], "Doing", None)])


@pytest.fixture
def bug(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    return bug


def _link(project, default_workflow, items=None):
    """Attach a scheme and one project state per status, as Task 3's service will do."""
    scheme = ProjectWorkflowScheme.objects.create(project=project, workspace=project.workspace, default_workflow=default_workflow)
    for issue_type, workflow in (items or {}).items():
        ProjectWorkflowSchemeItem.objects.create(scheme=scheme, issue_type=issue_type, workflow=workflow)
    for workflow in [default_workflow, *(items or {}).values()]:
        for name, workflow_state in workflow.states_by_name.items():
            State.objects.get_or_create(
                project=project, workflow_status=workflow_state.status, defaults={"name": name, "color": "#3A3A3A"}
            )
    return {state.name: state for state in State.objects.filter(project=project)}


def _issue(project, state, creator=None, **kwargs):
    # BaseModel.save overwrites created_by from the request user unless created_by_id is passed.
    issue = Issue(name="Item", project=project, state=state, **kwargs)
    issue.save(created_by_id=creator.id if creator else None)
    return issue


def _code(error):
    return error.value.detail["workflow"][0]


class TestResolution:
    def test_a_project_without_scheme_has_no_workflow(self, project):
        assert workflow_id_for(project.id, None) is None

    def test_types_without_a_line_follow_the_default_workflow(self, project, software, support, bug):
        _link(project, software, {bug: support})
        default_type_id = IssueType.objects.get(workspace=project.workspace, is_default=True).id
        assert workflow_id_for(project.id, default_type_id) == software.id
        assert workflow_id_for(project.id, None) == software.id
        assert workflow_id_for(project.id, bug.id) == support.id

    def test_initial_state_is_the_project_state_of_the_initial_status(self, project, software):
        states = _link(project, software)
        assert initial_state(project.id, software.id) == states["To do"]


class TestCheckTransition:
    def test_a_free_project_allows_everything(self, project, users):
        a = State.objects.create(name="A", project=project)
        b = State.objects.create(name="B", project=project)
        assert check_transition(_issue(project, a), a, b, users["guest"]) is True

    def test_an_arrow_allows_and_its_absence_refuses(self, project, software, users):
        states = _link(project, software)
        issue = _issue(project, states["To do"])
        assert check_transition(issue, states["To do"], states["Doing"], users["member"]) is True
        assert check_transition(issue, states["To do"], states["Done"], users["member"]) is False

    def test_a_global_transition_comes_from_any_state(self, project, software, users):
        states = _link(project, software)
        issue = _issue(project, states["Doing"])
        assert check_transition(issue, states["Doing"], states["Cancelled"], users["guest"]) is True

    def test_a_state_outside_the_workflow_is_refused(self, project, software, users):
        states = _link(project, software)
        stray = State.objects.create(name="Stray", project=project)
        assert check_transition(_issue(project, states["To do"]), states["To do"], stray, users["admin"]) is False

    def test_staying_in_the_same_state_is_not_a_transition(self, project, software, users):
        states = _link(project, software)
        assert check_transition(_issue(project, states["Done"]), states["Done"], states["Done"], users["guest"]) is True

    def test_from_triage_only_global_transitions_apply(self, project, software, users):
        states = _link(project, software)
        triage = State.objects.create(name="Triage", project=project, group="triage")
        issue = _issue(project, triage)
        assert check_transition(issue, triage, states["Doing"], users["admin"]) is False
        assert check_transition(issue, triage, states["Cancelled"], users["admin"]) is True


class TestRestrictActors:
    @pytest.fixture
    def states(self, project, workspace):
        workflow = build_workflow(
            workspace,
            "Guarded",
            ["Open", "Roles", "Named", "Assignee", "Creator", "Mixed"],
            [
                (["Open"], "Roles", {"roles": [15, 20]}),
                (["Open"], "Named", {"user_ids": []}),
                (["Open"], "Assignee", {"assignee": True}),
                (["Open"], "Creator", {"creator": True}),
                (["Open"], "Mixed", {"roles": [20], "creator": True}),
            ],
        )
        return _link(project, workflow)

    def test_roles(self, project, states, users):
        issue = _issue(project, states["Open"])
        assert check_transition(issue, states["Open"], states["Roles"], users["member"]) is True
        assert check_transition(issue, states["Open"], states["Roles"], users["guest"]) is False

    def test_workspace_admins_outside_the_rule_are_not_exempt(self, project, states, users):
        issue = _issue(project, states["Open"])
        assert check_transition(issue, states["Open"], states["Roles"], users["outside_admin"]) is False

    def test_named_users(self, project, states, users):
        from plane.db.models import WorkflowTransitionRule

        WorkflowTransitionRule.objects.filter(transition__target__status__name="Named").update(
            params={"user_ids": [str(users["guest"].id)]}
        )
        issue = _issue(project, states["Open"])
        assert check_transition(issue, states["Open"], states["Named"], users["guest"]) is True
        assert check_transition(issue, states["Open"], states["Named"], users["member"]) is False

    def test_assignee(self, project, states, users):
        issue = _issue(project, states["Open"])
        IssueAssignee.objects.create(issue=issue, assignee=users["guest"], project=project)
        assert check_transition(issue, states["Open"], states["Assignee"], users["guest"]) is True
        assert check_transition(issue, states["Open"], states["Assignee"], users["member"]) is False

    def test_creator(self, project, states, users):
        issue = _issue(project, states["Open"], creator=users["other_member"])
        assert check_transition(issue, states["Open"], states["Creator"], users["other_member"]) is True
        assert check_transition(issue, states["Open"], states["Creator"], users["member"]) is False

    def test_criteria_combine_with_or(self, project, states, users):
        issue = _issue(project, states["Open"], creator=users["guest"])
        assert check_transition(issue, states["Open"], states["Mixed"], users["guest"]) is True
        assert check_transition(issue, states["Open"], states["Mixed"], users["admin"]) is True
        assert check_transition(issue, states["Open"], states["Mixed"], users["member"]) is False

    def test_without_actor_a_rule_refuses(self, project, states):
        issue = _issue(project, states["Open"])
        assert check_transition(issue, states["Open"], states["Roles"], None) is False


class TestResolveWorkflowState:
    @pytest.fixture(autouse=True)
    def actor(self, users):
        set_current_user(users["member"])
        yield
        set_current_user(None)

    def test_creation_without_state_takes_the_initial_state(self, project, software):
        states = _link(project, software)
        resolved = resolve_workflow_state(project_id=project.id, instance=None, state=None, state_given=False, type_id=None)
        assert resolved == states["To do"]

    def test_creation_in_another_state_is_refused(self, project, software):
        states = _link(project, software)
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=None, state=states["Doing"], state_given=True, type_id=None)
        assert _code(error) == TRANSITION_NOT_ALLOWED

    def test_creation_uses_the_workflow_of_the_requested_type(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        resolved = resolve_workflow_state(project_id=project.id, instance=None, state=None, state_given=False, type_id=bug.id)
        assert resolved == states["New"]

    def test_creation_in_triage_is_left_alone(self, project, software):
        _link(project, software)
        triage = State.objects.create(name="Triage", project=project, group="triage")
        assert resolve_workflow_state(project_id=project.id, instance=None, state=triage, state_given=True, type_id=None) is None

    def test_a_free_project_is_left_alone(self, project):
        state = State.objects.create(name="A", project=project)
        assert resolve_workflow_state(project_id=project.id, instance=None, state=state, state_given=True, type_id=None) is None

    def test_an_allowed_move_passes_and_a_forbidden_one_is_refused(self, project, software):
        states = _link(project, software)
        issue = _issue(project, states["To do"])
        assert (
            resolve_workflow_state(project_id=project.id, instance=issue, state=states["Doing"], state_given=True, type_id=None)
            is None
        )
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=issue, state=states["Done"], state_given=True, type_id=None)
        assert _code(error) == TRANSITION_NOT_ALLOWED

    def test_clearing_the_state_is_refused(self, project, software):
        states = _link(project, software)
        issue = _issue(project, states["To do"])
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=issue, state=None, state_given=True, type_id=None)
        assert _code(error) == TRANSITION_NOT_ALLOWED

    def test_type_change_keeps_a_state_present_in_the_new_workflow(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        issue = _issue(project, states["Doing"])
        assert resolve_workflow_state(project_id=project.id, instance=issue, state=None, state_given=False, type_id=bug.id) is None

    def test_type_change_requires_an_arrival_state_otherwise(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        issue = _issue(project, states["To do"])
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=issue, state=None, state_given=False, type_id=bug.id)
        assert _code(error) == ARRIVAL_STATE_REQUIRED

    def test_type_change_accepts_any_state_of_the_new_workflow_without_arrow(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        issue = _issue(project, states["To do"])
        assert (
            resolve_workflow_state(project_id=project.id, instance=issue, state=states["Closed"], state_given=True, type_id=bug.id)
            is None
        )

    def test_type_change_refuses_an_arrival_outside_the_new_workflow(self, project, software, support, bug):
        states = _link(project, software, {bug: support})
        issue = _issue(project, states["To do"])
        with pytest.raises(serializers.ValidationError) as error:
            resolve_workflow_state(project_id=project.id, instance=issue, state=states["Done"], state_given=True, type_id=bug.id)
        assert _code(error) == TRANSITION_NOT_ALLOWED
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -p wf-t2 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/utils/test_workflows.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'plane.utils.workflows'`.

- [ ] **Step 3: Write the service**

Create `apps/api/plane/utils/workflows.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from crum import get_current_user
from django.db.models import Q
from rest_framework import serializers

# Module imports
from plane.db.models import (
    IssueAssignee,
    ProjectIssueType,
    ProjectMember,
    ProjectWorkflowScheme,
    ProjectWorkflowSchemeItem,
    State,
    StateGroup,
    WorkflowState,
    WorkflowTransition,
)
from plane.db.models.workflow import RULE_RESTRICT_ACTORS

TRANSITION_NOT_ALLOWED = "transition_not_allowed"
ARRIVAL_STATE_REQUIRED = "arrival_state_required"


def refusal(code):
    """One body per refusal kind, whatever the cause, so a refusal reveals nothing of the configuration (4.5)."""
    return serializers.ValidationError({"workflow": [code]})


def workflow_id_for(project_id, type_id):
    """Spec 3.3: the type's workflow in the project scheme, else the scheme default; None for a free project."""
    scheme = ProjectWorkflowScheme.objects.filter(project_id=project_id).values("id", "default_workflow_id").first()
    if scheme is None:
        return None
    if type_id is not None:
        workflow_id = (
            ProjectWorkflowSchemeItem.objects.filter(scheme_id=scheme["id"], issue_type_id=type_id)
            .values_list("workflow_id", flat=True)
            .first()
        )
        if workflow_id is not None:
            return workflow_id
    return scheme["default_workflow_id"]


def project_default_type_id(project_id):
    return (
        ProjectIssueType.objects.filter(project_id=project_id, is_default=True)
        .values_list("issue_type_id", flat=True)
        .first()
    )


def state_in_workflow(state, workflow_id):
    return (
        state is not None
        and state.workflow_status_id is not None
        and WorkflowState.objects.filter(workflow_id=workflow_id, status_id=state.workflow_status_id).exists()
    )


def initial_state(project_id, workflow_id):
    """The project state mirroring the workflow's initial status (W7)."""
    status_id = (
        WorkflowState.objects.filter(workflow_id=workflow_id, is_initial=True).values_list("status_id", flat=True).first()
    )
    if status_id is None:
        return None
    return State.objects.filter(project_id=project_id, workflow_status_id=status_id).first()


def _actor_allowed(params, issue, actor):
    """W6: any one criterion admits the actor; workspace admins are not exempt."""
    if actor is None or not getattr(actor, "is_authenticated", False):
        return False
    actor_id = str(actor.id)
    if actor_id in params.get("user_ids", []):
        return True
    if params.get("creator") is True and str(issue.created_by_id) == actor_id:
        return True
    if params.get("assignee") is True and IssueAssignee.objects.filter(issue_id=issue.id, assignee_id=actor.id).exists():
        return True
    roles = params.get("roles", [])
    return bool(roles) and ProjectMember.objects.filter(
        project_id=issue.project_id, member_id=actor.id, is_active=True, role__in=roles
    ).exists()


def _rule_allows(rule, issue, actor):
    if rule.rule_type == RULE_RESTRICT_ACTORS:
        return _actor_allowed(rule.params, issue, actor)
    # An unknown rule type fails closed.
    return False


def check_transition(issue, from_state, to_state, actor, workflow_id=None):
    """Spec 4.1: whether the issue's workflow lets actor move it from from_state to to_state."""
    if workflow_id is None:
        workflow_id = workflow_id_for(issue.project_id, issue.type_id)
    if workflow_id is None:
        return True
    if from_state is not None and to_state is not None and from_state.pk == to_state.pk:
        return True
    if to_state is None or to_state.workflow_status_id is None:
        return False
    # Triage and unmanaged states have no arrow of their own, only global ones (P5).
    sources = Q(from_any=True)
    if from_state is not None and from_state.workflow_status_id is not None:
        sources |= Q(sources__source__status_id=from_state.workflow_status_id)
    transitions = (
        WorkflowTransition.objects.filter(sources, workflow_id=workflow_id, target__status_id=to_state.workflow_status_id)
        .distinct()
        .prefetch_related("rules")
    )
    return any(all(_rule_allows(rule, issue, actor) for rule in transition.rules.all()) for transition in transitions)


def resolve_workflow_state(*, project_id, instance, state, state_given, type_id):
    """State a written work item must take (T1, T2, 4.1), None to keep the request as is; raises one refusal."""
    if state is not None and state.group == StateGroup.TRIAGE.value:
        # Intake items stay in triage outside any workflow (invariant 6).
        return None
    if instance is None:
        workflow_id = workflow_id_for(project_id, type_id or project_default_type_id(project_id))
        if workflow_id is None:
            return None
        initial = initial_state(project_id, workflow_id)
        if initial is None or (state_given and state is not None and state.pk != initial.pk):
            raise refusal(TRANSITION_NOT_ALLOWED)
        return initial
    new_type_id = type_id if type_id is not None else instance.type_id
    workflow_id = workflow_id_for(project_id, new_type_id)
    if workflow_id is None:
        return None
    if state_given and state is None:
        raise refusal(TRANSITION_NOT_ALLOWED)
    if new_type_id != instance.type_id:
        # A type change is a change of workflow, not a move inside one: no arrow needed (T2).
        if state_given:
            if not state_in_workflow(state, workflow_id):
                raise refusal(TRANSITION_NOT_ALLOWED)
            return None
        if state_in_workflow(instance.state, workflow_id):
            return None
        raise refusal(ARRIVAL_STATE_REQUIRED)
    if not state_given or state.pk == instance.state_id:
        return None
    if not check_transition(instance, instance.state, state, get_current_user(), workflow_id=workflow_id):
        raise refusal(TRANSITION_NOT_ALLOWED)
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose -p wf-t2 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/utils/test_workflows.py -v`
Expected: 27 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/plane/utils/workflows.py apps/api/plane/tests/unit/utils/test_workflows.py
git commit -m "feat(api): resolve work item workflows and check transitions"
```

---

### Task 3: Synchronisation, correspondance, rattachement et détachement (spec W4, W5, W10, W11, W17, 5.1 à 5.3, T6, P4)

**Files:**

- Create: `apps/api/plane/utils/workflow_sync.py`
- Modify: `apps/api/plane/tests/workflow_builders.py` (ajout de `link_project`)
- Test: `apps/api/plane/tests/unit/utils/test_workflow_sync.py`

**Interfaces:**

- Consumes: modèles (Task 1), `initial_state`, `workflow_id_for` (Task 2), `record_audit(*, workspace_id, actor_id, action, target_type, target_id, before=None, after=None)` (livraison 1), `issue_activity.delay(...)` (`plane.bgtasks.issue_activities_task`).
- Produces (`plane.utils.workflow_sync`) :
  - `class SchemeError(Exception)` avec `code: str` et `details: list | None` ; codes `invalid_scheme`, `mapping_incomplete`, `invalid_mapping`, `status_in_use`.
  - `sync_project_states(project) -> dict[UUID, State]` (statut vers état de projet).
  - `validate_scheme(project, default_workflow_id, items) -> None` (lève `SchemeError("invalid_scheme")`).
  - `mapping_needs(project, default_workflow_id, items) -> list[dict]` ; chaque besoin : `{"state_id", "state_name", "workflow_id", "issue_count", "auto_status_id"}` (identifiants en chaînes, `auto_status_id` `None` si aucun statut de même nom).
  - `apply_scheme(*, project, default_workflow_id, items, mappings, actor_id) -> dict[UUID, State]` : `items` = `{type_id: workflow_id}`, `mappings` = `{(state_id, workflow_id): status_id}` (UUID).
  - `detach_scheme(*, project, actor_id) -> bool` (faux si le projet n'avait pas de système).
  - `projects_using(workflow_id) -> QuerySet[Project]`.
  - `status_usage(workflow_id, status_ids) -> list[dict]` : `{"project_id", "project_name", "issue_count"}` des tickets qui suivent ce workflow et sont dans ces statuts.
  - `deduce_groups(workflow_id) -> list[WorkflowStatus]` (statuts dont le groupe a changé).
  - `propagate_statuses(statuses) -> None` (nom, couleur, groupe vers les états de projet liés).
  - `resync_workflow(workflow_id) -> None` (`sync_project_states` sur chaque projet qui l'utilise).
- Produces (tests) : `link_project(project, default_workflow, items=None, actor=None) -> dict[str, State]` (nom vers état de projet), `items` = `{IssueType: Workflow}`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/plane/tests/unit/utils/test_workflow_sync.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import (
    AuditLog,
    Issue,
    Project,
    ProjectWorkflowScheme,
    State,
    WorkflowState,
    WorkflowStatus,
)
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project
from plane.utils.workflow_sync import (
    SchemeError,
    apply_scheme,
    deduce_groups,
    detach_scheme,
    mapping_needs,
    propagate_statuses,
    status_usage,
    sync_project_states,
)

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def project(workspace, create_user):
    return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)


@pytest.fixture
def software(workspace):
    return build_workflow(
        workspace, "Software", ["To do", "Doing", "Done"], [(["To do"], "Doing", None), (["Doing"], "Done", None)]
    )


@pytest.fixture
def support(workspace):
    return build_workflow(workspace, "Support", ["New", "To do", "Closed"], [(["New"], "Closed", None)])


@pytest.fixture
def bug(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    return bug


def _apply(project, default_workflow, items=None, mappings=None, actor=None):
    return apply_scheme(
        project=project,
        default_workflow_id=default_workflow.id,
        items={issue_type.id: workflow.id for issue_type, workflow in (items or {}).items()},
        mappings=mappings or {},
        actor_id=(actor.id if actor else project.workspace.owner_id),
    )


class TestSync:
    def test_one_project_state_per_status_even_when_shared(self, project, software, support, bug):
        states = link_project(project, software, {bug: support})
        assert sorted(states) == ["Closed", "Doing", "Done", "New", "To do"]
        assert State.objects.filter(project=project, name="To do").count() == 1
        assert all(state.workflow_status_id is not None for state in states.values())

    def test_the_default_state_is_the_initial_state_of_the_default_workflow(self, project, software, support, bug):
        states = link_project(project, software, {bug: support})
        assert list(State.objects.filter(project=project, default=True)) == [states["To do"]]

    def test_an_unmanaged_state_with_the_same_name_is_reused(self, project, software, create_user):
        legacy = State.objects.create(name="TO DO", project=project, color="#000000")
        issue = Issue.objects.create(name="Item", project=project, state=legacy)
        states = link_project(project, software)
        assert states["To do"].pk == legacy.pk
        issue.refresh_from_db()
        assert issue.state_id == legacy.pk

    def test_status_changes_reach_every_linked_project(self, workspace, project, software, create_user):
        other = Project.objects.create(name="Other", identifier="OTH", workspace=workspace, created_by=create_user)
        link_project(project, software)
        link_project(other, software)
        status = software.states_by_name["Doing"].status
        status.name, status.color, status.group = "In progress", "#00FF00", "started"
        status.save()
        propagate_statuses([status])
        assert State.objects.filter(workflow_status=status, name="In progress", color="#00FF00").count() == 2

    def test_a_status_left_by_every_workflow_of_the_scheme_loses_its_empty_state(self, project, software):
        states = link_project(project, software)
        WorkflowState.objects.filter(pk=software.states_by_name["Done"].pk).delete()
        sync_project_states(project)
        assert not State.objects.filter(pk=states["Done"].pk).exists()


class TestMappingAndApply:
    def test_needs_list_states_absent_from_the_target_workflow(self, project, software, support, bug):
        legacy = State.objects.create(name="Backlog", project=project)
        same_name = State.objects.create(name="Doing", project=project)
        Issue.objects.create(name="Task", project=project, state=legacy)
        Issue.objects.create(name="Bug", project=project, state=same_name, type=bug)
        Issue.objects.create(name="Task 2", project=project, state=same_name)
        triage = State.objects.create(name="Triage", project=project, group="triage")
        Issue.objects.create(name="Intake", project=project, state=triage)

        needs = mapping_needs(project, software.id, {bug.id: support.id})

        simplified = sorted((need["state_name"], need["workflow_id"], need["issue_count"], need["auto_status_id"]) for need in needs)
        doing_status_id = str(software.states_by_name["Doing"].status_id)
        assert simplified == sorted(
            [
                ("Backlog", str(software.id), 1, None),
                ("Doing", str(support.id), 1, None),
                ("Doing", str(software.id), 1, doing_status_id),
            ]
        )

    def test_apply_refuses_an_incomplete_mapping(self, project, software):
        legacy = State.objects.create(name="Backlog", project=project)
        Issue.objects.create(name="Task", project=project, state=legacy)
        with pytest.raises(SchemeError) as error:
            _apply(project, software)
        assert error.value.code == "mapping_incomplete"
        assert not ProjectWorkflowScheme.objects.exists()

    def test_apply_refuses_an_arrival_outside_the_target_workflow(self, project, software, support):
        legacy = State.objects.create(name="Backlog", project=project)
        Issue.objects.create(name="Task", project=project, state=legacy)
        with pytest.raises(SchemeError) as error:
            _apply(project, software, mappings={(legacy.id, software.id): support.states_by_name["New"].status_id})
        assert error.value.code == "invalid_mapping"

    def test_apply_moves_items_records_history_and_audit(
        self, project, software, mock_celery, django_capture_on_commit_callbacks
    ):
        legacy = State.objects.create(name="Backlog", project=project)
        issue = Issue.objects.create(name="Task", project=project, state=legacy)
        with django_capture_on_commit_callbacks(execute=True):
            states = _apply(project, software, mappings={(legacy.id, software.id): software.states_by_name["Doing"].status_id})
        issue.refresh_from_db()
        assert issue.state_id == states[software.states_by_name["Doing"].status_id].id
        assert not State.objects.filter(pk=legacy.pk).exists()
        assert mock_celery.call_count == 1
        assert mock_celery.call_args.kwargs["issue_id"] == str(issue.id)
        entry = AuditLog.objects.get(action="project_workflow_scheme.applied")
        assert entry.target_id == project.id
        assert entry.after["default_workflow_id"] == str(software.id)
        assert entry.after["moved_issue_count"] == 1

    def test_applying_twice_changes_nothing_the_second_time(self, project, software, mock_celery):
        _apply(project, software)
        _apply(project, software)
        assert ProjectWorkflowScheme.objects.count() == 1
        assert AuditLog.objects.filter(action="project_workflow_scheme.applied").count() == 1

    def test_apply_refuses_a_foreign_or_empty_workflow_and_a_type_not_enabled(self, workspace, project, software):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        empty = build_workflow(workspace, "Empty", ["Only"])
        WorkflowState.objects.filter(workflow=empty).delete()
        stranger = IssueTypeFactory(workspace=workspace, name="Stranger")
        for default_workflow, items in ((foreign, {}), (empty, {}), (software, {stranger: software})):
            with pytest.raises(SchemeError) as error:
                _apply(project, default_workflow, items)
            assert error.value.code == "invalid_scheme"

    def test_changing_the_workflow_of_a_type_needs_a_mapping_for_its_items(self, project, software, support, bug, mock_celery):
        states = link_project(project, software, {bug: support})
        Issue.objects.create(name="Bug", project=project, state=states["New"], type=bug)
        needs = mapping_needs(project, software.id, {})
        assert [(need["state_name"], need["workflow_id"]) for need in needs] == [("New", str(software.id))]

    def test_detach_keeps_the_states_and_unlinks_them(self, project, software):
        states = link_project(project, software)
        assert detach_scheme(project=project, actor_id=project.workspace.owner_id) is True
        assert not ProjectWorkflowScheme.objects.exists()
        assert State.objects.filter(pk=states["To do"].pk, workflow_status__isnull=True).exists()
        assert AuditLog.objects.filter(action="project_workflow_scheme.detached", target_id=project.id).exists()
        assert detach_scheme(project=project, actor_id=project.workspace.owner_id) is False


class TestUsageAndGroups:
    def test_usage_counts_only_items_following_the_workflow(self, project, software, support, bug):
        states = link_project(project, software, {bug: support})
        Issue.objects.create(name="Task", project=project, state=states["To do"])
        Issue.objects.create(name="Bug", project=project, state=states["To do"], type=bug)
        usage = status_usage(software.id, [software.states_by_name["To do"].status_id])
        assert usage == [{"project_id": str(project.id), "project_name": "Home", "issue_count": 1}]

    def test_groups_follow_the_graph_and_ignore_global_transitions(self, workspace):
        workflow = build_workflow(
            workspace,
            "Flow",
            ["Open", "Work", "Shipped", "Dropped"],
            [(["Open"], "Work", None), (["Work"], "Shipped", None), ("*", "Dropped", None)],
        )
        deduce_groups(workflow.id)
        groups = {name: WorkflowStatus.objects.get(pk=state.status_id).group for name, state in workflow.states_by_name.items()}
        assert groups == {"Open": "unstarted", "Work": "started", "Shipped": "completed", "Dropped": "completed"}

    def test_a_manual_group_or_a_shared_status_is_left_alone(self, workspace):
        first = build_workflow(workspace, "First", ["Open", "Shared"], [(["Open"], "Shared", None)])
        build_workflow(workspace, "Second", ["Shared", "End"], [(["Shared"], "End", None)])
        WorkflowStatus.objects.filter(name="Open").update(group="backlog", group_is_auto=False)
        deduce_groups(first.id)
        assert WorkflowStatus.objects.get(name="Open").group == "backlog"
        assert WorkflowStatus.objects.get(name="Shared").group == "started"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -p wf-t3 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/utils/test_workflow_sync.py -v`
Expected: FAIL at collection with `ImportError: cannot import name 'link_project' from 'plane.tests.workflow_builders'`.

- [ ] **Step 3: Write the service**

Create `apps/api/plane/utils/workflow_sync.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json

# Django imports
from django.db import transaction
from django.db.models import Case, Count, Q, Value, When
from django.utils import timezone

# Module imports
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import (
    Issue,
    Project,
    ProjectIssueType,
    ProjectWorkflowScheme,
    ProjectWorkflowSchemeItem,
    State,
    StateGroup,
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkflowTransitionSource,
)
from plane.utils.audit import record_audit


class SchemeError(Exception):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.code = code
        self.details = details


def _normalise(default_workflow_id, items):
    """Scheme identifiers as strings, so request data and ORM values compare equal."""
    return str(default_workflow_id), {str(type_id): str(workflow_id) for type_id, workflow_id in items.items()}


def _type_filter(workflow_id, default_workflow_id, items):
    """Work items whose type follows workflow_id under a scheme of this default and these lines (strings)."""
    own = [type_id for type_id, item_workflow_id in items.items() if item_workflow_id == workflow_id]
    if workflow_id != default_workflow_id:
        return Q(type_id__in=own)
    others = [type_id for type_id, item_workflow_id in items.items() if item_workflow_id != workflow_id]
    # NOT IN drops null types, which follow the default workflow.
    return ~Q(type_id__in=others) | Q(type_id__isnull=True)


def _statuses_by_workflow(workflow_ids):
    result = {workflow_id: {} for workflow_id in workflow_ids}
    for workflow_id, status_id, name in WorkflowState.objects.filter(workflow_id__in=workflow_ids).values_list(
        "workflow_id", "status_id", "status__name"
    ):
        result[str(workflow_id)][str(status_id)] = name.lower()
    return result


def sync_project_states(project):
    """W4, W17: exactly one managed project state per status of the scheme workflows; returns {status_id: State}."""
    scheme = ProjectWorkflowScheme.objects.get(project_id=project.id)
    workflow_ids = {scheme.default_workflow_id, *scheme.items.values_list("workflow_id", flat=True)}
    statuses = WorkflowStatus.objects.filter(workflow_states__workflow_id__in=workflow_ids).distinct()
    linked = {
        state.workflow_status_id: state
        for state in State.objects.filter(project_id=project.id, workflow_status__isnull=False)
    }
    # State.objects already hides the intake triage state.
    unmanaged = {
        state.name.lower(): state for state in State.objects.filter(project_id=project.id, workflow_status__isnull=True)
    }
    result = {}
    for status in statuses.order_by("sequence", "name"):
        state = linked.get(status.id) or unmanaged.pop(status.name.lower(), None)
        if state is None:
            state = State(project_id=project.id, workspace_id=project.workspace_id)
        values = {"name": status.name, "color": status.color, "group": status.group, "workflow_status_id": status.id}
        if state._state.adding or any(getattr(state, field) != value for field, value in values.items()):
            for field, value in values.items():
                setattr(state, field, value)
            state.save()
        result[status.id] = state
    obsolete = [state.pk for status_id, state in linked.items() if status_id not in result]
    if obsolete:
        if Issue.objects.filter(state_id__in=obsolete).exists():
            raise SchemeError("status_in_use")
        State.objects.filter(pk__in=obsolete).delete()
    initial_status_id = (
        WorkflowState.objects.filter(workflow_id=scheme.default_workflow_id, is_initial=True)
        .values_list("status_id", flat=True)
        .get()
    )
    # One UPDATE so the project never has zero or two defaults.
    State.objects.filter(project_id=project.id).update(
        default=Case(When(pk=result[initial_status_id].pk, then=Value(True)), default=Value(False))
    )
    return result


def mapping_needs(project, default_workflow_id, items):
    """W10: (current state, target workflow) pairs holding work items whose status the target workflow lacks."""
    default_workflow_id, items = _normalise(default_workflow_id, items)
    statuses = _statuses_by_workflow({default_workflow_id, *items.values()})
    states = {state.pk: state for state in State.objects.filter(project_id=project.id)}
    rows = (
        Issue.objects.filter(project_id=project.id, state_id__in=states.keys())
        .values("state_id", "type_id")
        .annotate(count=Count("id"))
    )
    needs = {}
    for row in rows:
        workflow_id = items.get(str(row["type_id"]), default_workflow_id)
        state = states[row["state_id"]]
        if str(state.workflow_status_id) in statuses[workflow_id]:
            continue
        key = (str(state.pk), workflow_id)
        if key not in needs:
            # Only an unmanaged state is adopted by name; a managed one carries another status.
            auto = None
            if state.workflow_status_id is None:
                auto = next(
                    (status_id for status_id, name in statuses[workflow_id].items() if name == state.name.lower()), None
                )
            needs[key] = {
                "state_id": key[0],
                "state_name": state.name,
                "workflow_id": workflow_id,
                "issue_count": 0,
                "auto_status_id": auto,
            }
        needs[key]["issue_count"] += row["count"]
    return sorted(needs.values(), key=lambda need: (need["state_name"].lower(), need["workflow_id"]))


def validate_scheme(project, default_workflow_id, items):
    """Workflows of the project workspace with an initial state, types enabled in the project (invariant 4)."""
    default_workflow_id, items = _normalise(default_workflow_id, items)
    workflow_ids = {default_workflow_id, *items.values()}
    valid_workflows = (
        Workflow.objects.filter(pk__in=workflow_ids, workspace_id=project.workspace_id, states__is_initial=True)
        .distinct()
        .count()
    )
    enabled_types = ProjectIssueType.objects.filter(project_id=project.id, issue_type_id__in=items.keys()).count()
    if valid_workflows != len(workflow_ids) or enabled_types != len(items):
        raise SchemeError("invalid_scheme")


def _scheme_snapshot(scheme):
    if scheme is None:
        return None
    return {
        "default_workflow_id": str(scheme.default_workflow_id),
        "items": {
            str(type_id): str(workflow_id)
            for type_id, workflow_id in scheme.items.values_list("issue_type_id", "workflow_id")
        },
    }


def _save_scheme(project, default_workflow_id, items):
    scheme = ProjectWorkflowScheme.objects.filter(project_id=project.id).first()
    before = _scheme_snapshot(scheme)
    if scheme is None:
        scheme = ProjectWorkflowScheme.objects.create(
            project_id=project.id, workspace_id=project.workspace_id, default_workflow_id=default_workflow_id
        )
    elif str(scheme.default_workflow_id) != default_workflow_id:
        scheme.default_workflow_id = default_workflow_id
        scheme.save(update_fields=["default_workflow", "updated_at"])
    if _scheme_snapshot(scheme)["items"] != items:
        scheme.items.all().delete()
        ProjectWorkflowSchemeItem.objects.bulk_create(
            ProjectWorkflowSchemeItem(scheme=scheme, issue_type_id=type_id, workflow_id=workflow_id)
            for type_id, workflow_id in items.items()
        )
    return scheme, before


def _move_issues(project, planned, states_by_status, default_workflow_id, items):
    """System operation (T6): no transition check; the history is recorded once the transaction commits."""
    moves = []
    now = timezone.now()
    for need, arrival in planned:
        target = states_by_status[arrival]
        issue_ids = list(
            Issue.objects.filter(
                _type_filter(need["workflow_id"], default_workflow_id, items),
                project_id=project.id,
                state_id=need["state_id"],
            ).values_list("id", flat=True)
        )
        Issue.objects.filter(pk__in=issue_ids).update(
            state_id=target.pk,
            updated_at=now,
            completed_at=now if target.group == StateGroup.COMPLETED.value else None,
        )
        moves += [(issue_id, need["state_id"], target.pk) for issue_id in issue_ids]
    return moves


def _drop_unmanaged_states(project):
    leftovers = State.objects.filter(project_id=project.id, workflow_status__isnull=True)
    if Issue.objects.filter(state__in=leftovers).exists():
        raise SchemeError("mapping_incomplete")
    Project.objects.filter(pk=project.pk, default_state__in=leftovers).update(default_state=None)
    leftovers.delete()


def _record_moves(moves, project_id, actor_id):
    epoch = int(timezone.now().timestamp())
    for issue_id, old_state_id, new_state_id in moves:
        issue_activity.delay(
            type="issue.activity.updated",
            requested_data=json.dumps({"state_id": str(new_state_id)}),
            current_instance=json.dumps({"state_id": str(old_state_id)}),
            issue_id=str(issue_id),
            project_id=str(project_id),
            actor_id=str(actor_id),
            epoch=epoch,
            notification=False,
        )


def apply_scheme(*, project, default_workflow_id, items, mappings, actor_id):
    """Spec 5.1 step 3: attach or change the scheme and move work items as mapped, in one replayable transaction."""
    default_workflow_id, items = _normalise(default_workflow_id, items)
    mappings = {(str(state_id), str(workflow_id)): str(status_id) for (state_id, workflow_id), status_id in mappings.items()}
    with transaction.atomic():
        project = Project.objects.select_for_update(of=("self",)).get(pk=project.pk)
        validate_scheme(project, default_workflow_id, items)
        statuses = _statuses_by_workflow({default_workflow_id, *items.values()})
        planned, missing = [], []
        for need in mapping_needs(project, default_workflow_id, items):
            arrival = mappings.get((need["state_id"], need["workflow_id"])) or need["auto_status_id"]
            if arrival is None:
                missing.append(need)
            elif arrival not in statuses[need["workflow_id"]]:
                raise SchemeError("invalid_mapping", [need])
            elif need["auto_status_id"] is None:
                planned.append((need, arrival))
        if missing:
            raise SchemeError("mapping_incomplete", missing)

        scheme, before = _save_scheme(project, default_workflow_id, items)
        # Linking first creates the target states; the moves then leave the old states empty.
        states = sync_project_states(project)
        moves = _move_issues(project, planned, {str(key): state for key, state in states.items()}, default_workflow_id, items)
        _drop_unmanaged_states(project)
        after = _scheme_snapshot(scheme)
        if before != after or moves:
            record_audit(
                workspace_id=project.workspace_id,
                actor_id=actor_id,
                action="project_workflow_scheme.applied",
                target_type="project",
                target_id=project.id,
                before=before,
                after={**after, "moved_issue_count": len(moves)},
            )
        if moves:
            transaction.on_commit(lambda: _record_moves(moves, project.id, actor_id))
    return states


def detach_scheme(*, project, actor_id):
    """Spec 5.3: the project becomes free again; its states stay and lose their link."""
    with transaction.atomic():
        scheme = ProjectWorkflowScheme.objects.select_for_update(of=("self",)).filter(project_id=project.id).first()
        if scheme is None:
            return False
        before = _scheme_snapshot(scheme)
        State.objects.filter(project_id=project.id).update(workflow_status=None)
        scheme.delete()
        record_audit(
            workspace_id=project.workspace_id,
            actor_id=actor_id,
            action="project_workflow_scheme.detached",
            target_type="project",
            target_id=project.id,
            before=before,
        )
        return True


def projects_using(workflow_id):
    return Project.objects.filter(
        Q(workflow_scheme__default_workflow_id=workflow_id) | Q(workflow_scheme__items__workflow_id=workflow_id)
    ).distinct()


def status_usage(workflow_id, status_ids):
    """W11: per linked project, the work items following this workflow that sit in these statuses."""
    usage = []
    schemes = (
        ProjectWorkflowScheme.objects.filter(Q(default_workflow_id=workflow_id) | Q(items__workflow_id=workflow_id))
        .distinct()
        .select_related("project")
        .order_by("project__name")
    )
    for scheme in schemes:
        items = dict(scheme.items.values_list("issue_type_id", "workflow_id"))
        count = Issue.objects.filter(
            _type_filter(workflow_id, scheme.default_workflow_id, items),
            project_id=scheme.project_id,
            state__workflow_status_id__in=status_ids,
        ).count()
        if count:
            usage.append({"project_id": str(scheme.project_id), "project_name": scheme.project.name, "issue_count": count})
    return usage


def deduce_groups(workflow_id):
    """W5, P4: re-derive the auto group of statuses this workflow alone uses; global transitions do not count."""
    with_exit = set(
        WorkflowTransitionSource.objects.filter(transition__workflow_id=workflow_id).values_list("source_id", flat=True)
    )
    changed = []
    for state in WorkflowState.objects.filter(workflow_id=workflow_id).select_related("status"):
        status = state.status
        if not status.group_is_auto or WorkflowState.objects.filter(status_id=status.id).count() > 1:
            continue
        if state.is_initial:
            group = StateGroup.UNSTARTED.value
        elif state.pk in with_exit:
            group = StateGroup.STARTED.value
        else:
            group = StateGroup.COMPLETED.value
        if status.group != group:
            status.group = group
            status.save(update_fields=["group", "updated_at"])
            changed.append(status)
    return changed


def propagate_statuses(statuses):
    """W17: a status edit reaches every project state mirroring it, in every project."""
    for status in statuses:
        State.objects.filter(workflow_status_id=status.id).update(name=status.name, color=status.color, group=status.group)


def resync_workflow(workflow_id):
    """Re-sync every project using the workflow, locking projects in id order like apply_scheme does."""
    project_ids = list(projects_using(workflow_id).values_list("id", flat=True))
    for project in Project.objects.select_for_update(of=("self",)).filter(pk__in=project_ids).order_by("id"):
        sync_project_states(project)
```

Append to `apps/api/plane/tests/workflow_builders.py`:

```python
def link_project(project, default_workflow, items=None, actor=None):
    """Attach a scheme to a project holding no work item in a conflicting state; returns {state name: State}."""
    from plane.utils.workflow_sync import apply_scheme

    states = apply_scheme(
        project=project,
        default_workflow_id=default_workflow.id,
        items={issue_type.id: workflow.id for issue_type, workflow in (items or {}).items()},
        mappings={},
        # The audit trail needs a real actor; tests default to the workspace owner.
        actor_id=(actor.id if actor else project.workspace.owner_id),
    )
    return {state.name: state for state in states.values()}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose -p wf-t3 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/utils/test_workflow_sync.py plane/tests/unit/utils/test_workflows.py -v`
Expected: 16 passed in `test_workflow_sync.py`, 27 still passing in `test_workflows.py`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/plane/utils/workflow_sync.py apps/api/plane/tests/workflow_builders.py apps/api/plane/tests/unit/utils/test_workflow_sync.py
git commit -m "feat(api): sync project states with workflow schemes"
```

---

### Task 4: Validation et enregistrement du graphe (spec 5.2, 7.2, 8, W5, W11, W14, W17, P1, P7, P8)

**Files:**

- Create: `apps/api/plane/app/serializers/workflow.py`
- Create: `apps/api/plane/utils/workflow_graph.py`
- Modify: `apps/api/plane/app/serializers/__init__.py`
- Test: `apps/api/plane/tests/unit/serializers/test_workflow_graph.py`

**Interfaces:**

- Consumes: modèles et constantes (Task 1), `StrictUUIDField` (`plane.utils.issue_types`), `status_usage`, `deduce_groups`, `propagate_statuses`, `resync_workflow` (Task 3), `record_audit`.
- Produces (`plane.app.serializers.workflow`, exportés par `plane.app.serializers`) :
  - `WorkflowStatusSerializer` (lecture : `id, name, color, group, group_is_auto, sequence, workflow_count`).
  - `WorkflowSerializer` (écriture de `name`, `description` ; contexte `workspace_id` ; message `DUPLICATE_WORKFLOW_NAME_MESSAGE`).
  - `WorkflowGraphInputSerializer` (contexte `workspace_id`) ; erreurs de structure sous la clé `graph` avec un code : `duplicate_state_key`, `duplicate_status`, `duplicate_status_name`, `initial_state_required`, `invalid_transition`, `reserved_status_name`, `invalid_rule`.
- Produces (`plane.utils.workflow_graph`) :
  - `class GraphError(Exception)` avec `code` et `details` ; codes `invalid_status`, `status_changed`, `status_limit`, `status_in_use` (détails : la liste de `status_usage`).
  - `workflow_graph(workflow) -> dict` : `{"id", "name", "description", "updated_at", "states": [{"id", "status": {...}, "position_x", "position_y", "is_initial"}], "transitions": [{"id", "name", "from_any", "source_ids", "target_id", "rules": [{"type", "params"}]}]}`.
  - `save_workflow_graph(*, workflow, graph, actor_id) -> dict` (le nouveau `workflow_graph`), à appeler dans une transaction qui a verrouillé `workflow`.
- Format d'entrée du graphe (P1) : `{"states": [{"key", "status": {"id"?, "name", "color", "group"?}, "position_x", "position_y", "is_initial"}], "transitions": [{"name"?, "from_any", "source_keys", "target_key", "rules": [{"type": "restrict_actors", "params": {"roles"?, "user_ids"?, "assignee"?, "creator"?}}]}]}`. La `key` d'un état existant est son `id` ; un état nouveau prend une clé libre (64 caractères au plus). Un `status.id` désigne un statut existant du workspace (ses nom, couleur, groupe sont alors mis à jour, pour tous les workflows : W17) ; sans `id`, le statut est créé. `group` absent ou `null` : groupe déduit (W5).

- [ ] **Step 1: Write the failing test**

Create `apps/api/plane/tests/unit/serializers/test_workflow_graph.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.app.serializers import WorkflowGraphInputSerializer
from plane.db.models import (
    AuditLog,
    Issue,
    Project,
    State,
    WorkflowState,
    WorkflowStatus,
    WorkflowTransition,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project
from plane.utils.workflow_graph import GraphError, save_workflow_graph, workflow_graph

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def _state(key, name, initial=False, status_id=None, group=None):
    status = {"name": name, "color": "#3A3A3A", "group": group}
    if status_id:
        status["id"] = str(status_id)
    return {"key": key, "status": status, "position_x": 0, "position_y": 0, "is_initial": initial}


def _transition(sources, target, rules=None, from_any=False):
    return {"name": "", "from_any": from_any, "source_keys": sources, "target_key": target, "rules": rules or []}


def _validate(workspace, data):
    serializer = WorkflowGraphInputSerializer(data=data, context={"workspace_id": workspace.id})
    return serializer.is_valid(), serializer


class TestGraphInput:
    def test_a_valid_graph_passes(self, workspace):
        valid, serializer = _validate(
            workspace,
            {"states": [_state("a", "Open", True), _state("b", "Shipped")], "transitions": [_transition(["a"], "b")]},
        )
        assert valid, serializer.errors

    @pytest.mark.parametrize(
        "data, code",
        [
            ({"states": [_state("a", "Open"), _state("b", "Done")], "transitions": []}, "initial_state_required"),
            ({"states": [_state("a", "Open", True), _state("b", "Done", True)], "transitions": []}, "initial_state_required"),
            ({"states": [_state("a", "Open", True), _state("a", "Done")], "transitions": []}, "duplicate_state_key"),
            ({"states": [_state("a", "Open", True), _state("b", "OPEN")], "transitions": []}, "duplicate_status_name"),
            ({"states": [_state("a", "Triage", True)], "transitions": []}, "reserved_status_name"),
            ({"states": [_state("a", "Open", True)], "transitions": [_transition(["a"], "zz")]}, "invalid_transition"),
            ({"states": [_state("a", "Open", True), _state("b", "B")], "transitions": [_transition([], "b")]}, "invalid_transition"),
            (
                {"states": [_state("a", "Open", True), _state("b", "B")], "transitions": [_transition(["a"], "b", from_any=True)]},
                "invalid_transition",
            ),
            ({"states": [_state("a", "Open", True)], "transitions": [_transition(["a"], "a")]}, "invalid_transition"),
        ],
    )
    def test_structural_errors_have_one_code(self, workspace, data, code):
        valid, serializer = _validate(workspace, data)
        assert not valid
        assert serializer.errors["graph"] == [code]

    def test_the_same_status_cannot_appear_twice(self, workspace):
        status = WorkflowStatus.objects.create(workspace=workspace, name="Open", color="#3A3A3A")
        valid, serializer = _validate(
            workspace,
            {"states": [_state("a", "Open", True, status.id), _state("b", "Other", False, status.id)], "transitions": []},
        )
        assert not valid and serializer.errors["graph"] == ["duplicate_status"]

    @pytest.mark.parametrize(
        "params",
        [
            {},
            {"roles": [99]},
            {"roles": [20], "admins": True},
            {"assignee": "yes"},
            {"user_ids": [123]},
        ],
    )
    def test_rule_params_are_strict(self, workspace, params):
        valid, serializer = _validate(
            workspace,
            {
                "states": [_state("a", "Open", True), _state("b", "B")],
                "transitions": [_transition(["a"], "b", [{"type": "restrict_actors", "params": params}])],
            },
        )
        assert not valid

    def test_named_users_must_be_active_members_of_the_workspace(self, workspace):
        member = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
        outsider = UserFactory()
        for user, expected in ((member, True), (outsider, False)):
            valid, _ = _validate(
                workspace,
                {
                    "states": [_state("a", "Open", True), _state("b", "B")],
                    "transitions": [
                        _transition(["a"], "b", [{"type": "restrict_actors", "params": {"user_ids": [str(user.id)]}}])
                    ],
                },
            )
            assert valid is expected

    def test_bounds(self, workspace):
        states = [_state(str(index), f"S{index}", index == 0) for index in range(201)]
        valid, _ = _validate(workspace, {"states": states, "transitions": []})
        assert not valid


class TestSaveGraph:
    @pytest.fixture
    def project(self, workspace, create_user):
        return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)

    def _save(self, workflow, data, actor):
        valid, serializer = _validate(workflow.workspace, data)
        assert valid, serializer.errors
        return save_workflow_graph(workflow=workflow, graph=serializer.validated_data, actor_id=actor.id)

    def test_new_statuses_states_and_transitions_are_created(self, workspace, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        open_state = workflow.states_by_name["Open"]
        graph = self._save(
            workflow,
            {
                "states": [_state(str(open_state.id), "Open", True, open_state.status_id), _state("new", "Shipped")],
                "transitions": [_transition([str(open_state.id)], "new")],
            },
            create_user,
        )
        assert [state["status"]["name"] for state in graph["states"]] == ["Open", "Shipped"]
        assert graph["transitions"][0]["source_ids"] == [str(open_state.id)]
        assert WorkflowStatus.objects.get(name="Shipped").group == "completed"
        entry = AuditLog.objects.get(action="workflow.graph_updated")
        assert entry.target_id == workflow.id
        assert [state["status"]["name"] for state in entry.before["states"]] == ["Open"]

    def test_editing_a_shared_status_reaches_every_workflow_and_project(self, workspace, project, create_user):
        first = build_workflow(workspace, "First", ["Open", "Done"], [(["Open"], "Done", None)])
        build_workflow(workspace, "Second", ["Open"])
        link_project(project, first)
        states = first.states_by_name
        self._save(
            first,
            {
                "states": [
                    _state(str(states["Open"].id), "Ready", True, states["Open"].status_id),
                    _state(str(states["Done"].id), "Done", False, states["Done"].status_id),
                ],
                "transitions": [_transition([str(states["Open"].id)], str(states["Done"].id))],
            },
            create_user,
        )
        assert WorkflowStatus.objects.get(pk=states["Open"].status_id).name == "Ready"
        assert State.objects.filter(project=project, name="Ready").exists()

    def test_a_status_added_reaches_linked_projects(self, workspace, project, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        link_project(project, workflow)
        open_state = workflow.states_by_name["Open"]
        self._save(
            workflow,
            {
                "states": [_state(str(open_state.id), "Open", True, open_state.status_id), _state("n", "Review")],
                "transitions": [_transition([str(open_state.id)], "n")],
            },
            create_user,
        )
        assert State.objects.filter(project=project, name="Review", workflow_status__isnull=False).exists()

    def test_removing_a_status_holding_items_is_refused_with_counts(self, workspace, project, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", None)])
        states = link_project(project, workflow)
        Issue.objects.create(name="Item", project=project, state=states["Done"])
        open_state = workflow.states_by_name["Open"]
        with pytest.raises(GraphError) as error:
            self._save(
                workflow,
                {"states": [_state(str(open_state.id), "Open", True, open_state.status_id)], "transitions": []},
                create_user,
            )
        assert error.value.code == "status_in_use"
        assert error.value.details == [{"project_id": str(project.id), "project_name": "Home", "issue_count": 1}]

    def test_removing_an_empty_status_drops_its_project_state(self, workspace, project, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", None)])
        states = link_project(project, workflow)
        open_state = workflow.states_by_name["Open"]
        self._save(
            workflow,
            {"states": [_state(str(open_state.id), "Open", True, open_state.status_id)], "transitions": []},
            create_user,
        )
        assert not WorkflowState.objects.filter(workflow=workflow, status__name="Done").exists()
        assert not WorkflowTransition.objects.filter(workflow=workflow).exists()
        assert not State.objects.filter(pk=states["Done"].pk).exists()

    def test_an_existing_state_keeps_its_status(self, workspace, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        other = WorkflowStatus.objects.create(workspace=workspace, name="Other", color="#3A3A3A")
        with pytest.raises(GraphError) as error:
            self._save(
                workflow,
                {"states": [_state(str(workflow.states_by_name["Open"].id), "Other", True, other.id)], "transitions": []},
                create_user,
            )
        assert error.value.code == "status_changed"

    def test_a_status_of_another_workspace_is_refused(self, workspace, create_user):
        workflow = build_workflow(workspace, "Flow", ["Open"])
        foreign = WorkflowStatus.objects.create(workspace=WorkspaceFactory(), name="Foreign", color="#3A3A3A")
        with pytest.raises(GraphError) as error:
            self._save(workflow, {"states": [_state("x", "Foreign", True, foreign.id)], "transitions": []}, create_user)
        assert error.value.code == "invalid_status"

    def test_the_workspace_status_bound(self, workspace, create_user, monkeypatch):
        monkeypatch.setattr("plane.utils.workflow_graph.MAX_STATUSES_PER_WORKSPACE", 1)
        workflow = build_workflow(workspace, "Flow", ["Open"])
        open_state = workflow.states_by_name["Open"]
        with pytest.raises(GraphError) as error:
            self._save(
                workflow,
                {"states": [_state(str(open_state.id), "Open", True, open_state.status_id), _state("n", "New")], "transitions": []},
                create_user,
            )
        assert error.value.code == "status_limit"

    def test_snapshot_shape(self, workspace):
        workflow = build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", {"creator": True})])
        graph = workflow_graph(workflow)
        assert graph["transitions"][0]["rules"] == [{"type": "restrict_actors", "params": {"creator": True}}]
        assert graph["states"][0]["is_initial"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -p wf-t4 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/serializers/test_workflow_graph.py -v`
Expected: FAIL at collection with `ImportError: cannot import name 'WorkflowGraphInputSerializer' from 'plane.app.serializers'`.

- [ ] **Step 3: Write the serializers**

Create `apps/api/plane/app/serializers/workflow.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from plane.app.permissions import ROLE
from plane.db.models import Workflow, WorkflowStatus, WorkspaceMember
from plane.db.models.workflow import (
    MAX_STATES_PER_WORKFLOW,
    MAX_TRANSITIONS_PER_WORKFLOW,
    RESERVED_STATUS_NAMES,
    RULE_RESTRICT_ACTORS,
    WORKFLOW_GROUPS,
)
from plane.utils.issue_types import StrictUUIDField
from .base import BaseSerializer

DUPLICATE_WORKFLOW_NAME_MESSAGE = "A workflow with this name already exists."
ROLE_VALUES = [ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value]


def graph_error(code):
    return serializers.ValidationError({"graph": [code]})


class WorkflowStatusSerializer(BaseSerializer):
    workflow_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = WorkflowStatus
        fields = ["id", "name", "color", "group", "group_is_auto", "sequence", "workflow_count"]
        read_only_fields = fields


class WorkflowSerializer(BaseSerializer):
    name = serializers.CharField(max_length=255, trim_whitespace=True)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True, trim_whitespace=True)

    class Meta:
        model = Workflow
        fields = ["id", "name", "description", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_name(self, value):
        duplicates = Workflow.objects.filter(workspace_id=self.context["workspace_id"], name__iexact=value)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError(DUPLICATE_WORKFLOW_NAME_MESSAGE)
        return value


class StrictBooleanField(serializers.Field):
    # JSON true or false only: "yes", 1 or "true" must not count (same rule as the type routes).
    def to_internal_value(self, data):
        if data is not True and data is not False:
            raise serializers.ValidationError("Must be true or false.")
        return data

    def to_representation(self, value):
        return value


class RestrictActorsParamsSerializer(serializers.Serializer):
    roles = serializers.ListField(child=serializers.ChoiceField(choices=ROLE_VALUES), required=False, max_length=3)
    user_ids = serializers.ListField(child=StrictUUIDField(), required=False, max_length=200)
    assignee = StrictBooleanField(required=False)
    creator = StrictBooleanField(required=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise graph_error("invalid_rule")
        return super().to_internal_value(data)

    def validate(self, attrs):
        user_ids = list(dict.fromkeys(str(user_id) for user_id in attrs.get("user_ids", [])))
        if user_ids and WorkspaceMember.objects.filter(
            workspace_id=self.context["workspace_id"], member_id__in=user_ids, is_active=True
        ).count() != len(user_ids):
            raise graph_error("invalid_rule")
        params = {}
        if attrs.get("roles"):
            params["roles"] = sorted(set(attrs["roles"]))
        if user_ids:
            params["user_ids"] = user_ids
        for flag in ("assignee", "creator"):
            if attrs.get(flag) is True:
                params[flag] = True
        if not params:
            raise graph_error("invalid_rule")
        return params


class GraphRuleInputSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=[RULE_RESTRICT_ACTORS])
    params = serializers.JSONField()

    def validate(self, attrs):
        params = RestrictActorsParamsSerializer(data=attrs["params"], context=self.context)
        if not params.is_valid():
            raise graph_error("invalid_rule")
        return {"type": attrs["type"], "params": params.validated_data}


class GraphStatusInputSerializer(serializers.Serializer):
    id = StrictUUIDField(required=False)
    name = serializers.CharField(max_length=255, trim_whitespace=True)
    color = serializers.RegexField(r"^#[0-9a-fA-F]{6}$")
    group = serializers.ChoiceField(choices=WORKFLOW_GROUPS, required=False, allow_null=True)


class GraphStateInputSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=64)
    status = GraphStatusInputSerializer()
    position_x = serializers.FloatField(min_value=-1_000_000, max_value=1_000_000)
    position_y = serializers.FloatField(min_value=-1_000_000, max_value=1_000_000)
    is_initial = StrictBooleanField()


class GraphTransitionInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    from_any = StrictBooleanField()
    source_keys = serializers.ListField(
        child=serializers.CharField(max_length=64), required=False, default=list, max_length=MAX_STATES_PER_WORKFLOW
    )
    target_key = serializers.CharField(max_length=64)
    rules = serializers.ListField(child=GraphRuleInputSerializer(), required=False, default=list, max_length=1)


class WorkflowGraphInputSerializer(serializers.Serializer):
    states = serializers.ListField(child=GraphStateInputSerializer(), max_length=MAX_STATES_PER_WORKFLOW)
    transitions = serializers.ListField(
        child=GraphTransitionInputSerializer(), max_length=MAX_TRANSITIONS_PER_WORKFLOW
    )

    def validate(self, attrs):
        states = attrs["states"]
        keys = [state["key"] for state in states]
        if len(set(keys)) != len(keys):
            raise graph_error("duplicate_state_key")
        names = [state["status"]["name"].lower() for state in states]
        if any(name in RESERVED_STATUS_NAMES for name in names):
            raise graph_error("reserved_status_name")
        status_ids = [state["status"]["id"] for state in states if "id" in state["status"]]
        if len(set(status_ids)) != len(status_ids):
            raise graph_error("duplicate_status")
        if len(set(names)) != len(names):
            raise graph_error("duplicate_status_name")
        if states and sum(1 for state in states if state["is_initial"]) != 1:
            raise graph_error("initial_state_required")
        for transition in attrs["transitions"]:
            sources = transition["source_keys"]
            if (
                transition["target_key"] not in keys
                or any(source not in keys for source in sources)
                or len(set(sources)) != len(sources)
                or transition["target_key"] in sources
                or transition["from_any"] == bool(sources)
            ):
                raise graph_error("invalid_transition")
        return attrs
```

In `apps/api/plane/app/serializers/__init__.py`, after the `issue_type` line:

```python
from .workflow import WorkflowGraphInputSerializer, WorkflowSerializer, WorkflowStatusSerializer
```

- [ ] **Step 4: Write the graph service**

Create `apps/api/plane/utils/workflow_graph.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Module imports
from plane.db.models import (
    WorkflowState,
    WorkflowStatus,
    WorkflowTransition,
    WorkflowTransitionRule,
    WorkflowTransitionSource,
)
from plane.db.models.workflow import MAX_STATUSES_PER_WORKSPACE
from plane.utils.audit import record_audit
from plane.utils.workflow_sync import deduce_groups, propagate_statuses, resync_workflow, status_usage


class GraphError(Exception):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.code = code
        self.details = details


def _status_data(status):
    return {
        "id": str(status.id),
        "name": status.name,
        "color": status.color,
        "group": status.group,
        "group_is_auto": status.group_is_auto,
    }


def workflow_graph(workflow):
    """The editor's view of a workflow, also used as the audit snapshot (W14)."""
    states = WorkflowState.objects.filter(workflow_id=workflow.id).select_related("status").order_by("created_at", "id")
    transitions = (
        WorkflowTransition.objects.filter(workflow_id=workflow.id)
        .prefetch_related("sources", "rules")
        .order_by("created_at", "id")
    )
    return {
        "id": str(workflow.id),
        "name": workflow.name,
        "description": workflow.description,
        "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
        "states": [
            {
                "id": str(state.id),
                "status": _status_data(state.status),
                "position_x": state.position_x,
                "position_y": state.position_y,
                "is_initial": state.is_initial,
            }
            for state in states
        ],
        "transitions": [
            {
                "id": str(transition.id),
                "name": transition.name,
                "from_any": transition.from_any,
                "source_ids": sorted(str(source.source_id) for source in transition.sources.all()),
                "target_id": str(transition.target_id),
                "rules": [{"type": rule.rule_type, "params": rule.params} for rule in transition.rules.all()],
            }
            for transition in transitions
        ],
    }


def _resolve_statuses(workflow, graph, existing):
    """Lock the referenced statuses and check the request may use them; returns {status id: WorkflowStatus}."""
    ids = [state["status"]["id"] for state in graph["states"] if "id" in state["status"]]
    statuses = {
        str(status.id): status
        for status in WorkflowStatus.objects.select_for_update(of=("self",))
        .filter(workspace_id=workflow.workspace_id, pk__in=ids)
        .order_by("id")
    }
    if len(statuses) != len(ids):
        raise GraphError("invalid_status")
    for state in graph["states"]:
        current = existing.get(state["key"])
        if current is not None and str(current.status_id) != str(state["status"].get("id")):
            raise GraphError("status_changed")
    new_count = sum(1 for state in graph["states"] if "id" not in state["status"])
    if new_count and WorkflowStatus.objects.filter(workspace_id=workflow.workspace_id).count() + new_count > (
        MAX_STATUSES_PER_WORKSPACE
    ):
        raise GraphError("status_limit")
    return statuses


def _write_status(workflow, data, statuses):
    """Create the status, or apply the edit to the shared one (W17); returns (status, edited)."""
    group = data.get("group")
    if "id" not in data:
        status = WorkflowStatus.objects.create(
            workspace_id=workflow.workspace_id,
            name=data["name"],
            color=data["color"],
            group=group or "started",
            group_is_auto=group is None,
        )
        return status, False
    status = statuses[str(data["id"])]
    changes = {"name": data["name"], "color": data["color"]}
    if group is not None:
        changes.update(group=group, group_is_auto=False)
    if all(getattr(status, field) == value for field, value in changes.items()):
        return status, False
    for field, value in changes.items():
        setattr(status, field, value)
    # shortcut: swapping two status names in one save hits the unique constraint (P8), save twice instead.
    status.save()
    return status, True


def save_workflow_graph(*, workflow, graph, actor_id):
    """P1: replace the graph of a locked workflow, then propagate to every linked project (5.2)."""
    before = workflow_graph(workflow)
    existing = {str(state.id): state for state in WorkflowState.objects.filter(workflow_id=workflow.id)}
    statuses = _resolve_statuses(workflow, graph, existing)
    keys = {state["key"] for state in graph["states"]}
    removed = [state for key, state in existing.items() if key not in keys]
    if removed:
        usage = status_usage(workflow.id, [state.status_id for state in removed])
        if usage:
            raise GraphError("status_in_use", usage)

    edited = {}
    status_by_key = {}
    for state in graph["states"]:
        status, was_edited = _write_status(workflow, state["status"], statuses)
        status_by_key[state["key"]] = status
        if was_edited:
            edited[status.id] = status

    WorkflowState.objects.filter(pk__in=[state.pk for state in removed]).delete()
    # Clear the initial flag first so the single-initial constraint holds while rows change.
    WorkflowState.objects.filter(workflow_id=workflow.id).update(is_initial=False)
    state_by_key = {}
    for state in graph["states"]:
        row = existing.get(state["key"]) or WorkflowState(workflow_id=workflow.id, status=status_by_key[state["key"]])
        row.position_x = state["position_x"]
        row.position_y = state["position_y"]
        row.is_initial = state["is_initial"]
        row.save()
        state_by_key[state["key"]] = row

    WorkflowTransition.objects.filter(workflow_id=workflow.id).delete()
    for item in graph["transitions"]:
        transition = WorkflowTransition.objects.create(
            workflow_id=workflow.id, target=state_by_key[item["target_key"]], name=item["name"], from_any=item["from_any"]
        )
        WorkflowTransitionSource.objects.bulk_create(
            WorkflowTransitionSource(transition=transition, source=state_by_key[key]) for key in item["source_keys"]
        )
        WorkflowTransitionRule.objects.bulk_create(
            WorkflowTransitionRule(transition=transition, rule_type=rule["type"], params=rule["params"])
            for rule in item["rules"]
        )

    for status in deduce_groups(workflow.id):
        edited[status.id] = status
    propagate_statuses(edited.values())
    resync_workflow(workflow.id)
    workflow.save(update_fields=["updated_at"])
    after = workflow_graph(workflow)
    record_audit(
        workspace_id=workflow.workspace_id,
        actor_id=actor_id,
        action="workflow.graph_updated",
        target_type="workflow",
        target_id=workflow.id,
        before=before,
        after=after,
    )
    return after
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose -p wf-t4 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/serializers/test_workflow_graph.py -v`
Expected: 27 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/plane/app/serializers/workflow.py apps/api/plane/app/serializers/__init__.py apps/api/plane/utils/workflow_graph.py apps/api/plane/tests/unit/serializers/test_workflow_graph.py
git commit -m "feat(api): validate and save workflow graphs"
```

---

### Task 5: API des statuts et des workflows du workspace (spec A1, A2, A5, 5.2, W14, P6)

**Files:**

- Create: `apps/api/plane/app/views/workflow/base.py`
- Modify: `apps/api/plane/app/views/__init__.py`
- Create: `apps/api/plane/app/urls/workflow.py`
- Modify: `apps/api/plane/app/urls/__init__.py`
- Test: `apps/api/plane/tests/contract/app/test_workflows_app.py`

**Interfaces:**

- Consumes: serializers et `workflow_graph`, `save_workflow_graph`, `GraphError` (Task 4), `projects_using` (Task 3), `record_audit`.
- Produces (routes, toutes sous `/api/`) :
  - `GET workspaces/<slug>/workflow-statuses/` (membres) ; `DELETE workspaces/<slug>/workflow-statuses/<uuid:pk>/` (admins).
  - `GET, POST workspaces/<slug>/workflows/` ; `GET, PATCH, DELETE workspaces/<slug>/workflows/<uuid:pk>/` (lecture : membres ; écriture : admins).
  - `PUT workspaces/<slug>/workflows/<uuid:pk>/graph/` (admins).
  - Corps d'un workflow en liste : `{"id", "name", "description", "created_at", "updated_at", "state_count", "project_count", "projects"?}` ; en détail et après `PUT .../graph/` : `workflow_graph(...)` plus `project_count` et `projects`? (`projects` = `[{"id", "name"}]`, seulement pour un admin du workspace, P6).
  - Refus : `{"graph": [code]}` (plus `"projects"` pour `status_in_use`) ; `{"error": "status_in_use"}` à la suppression d'un statut utilisé ; `{"error": "workflow_in_use"}` à la suppression d'un workflow relié.
- Produces (Python) : `WorkflowStatusEndpoint`, `WorkflowEndpoint`, `WorkflowGraphEndpoint`, `workflow_detail(workflow, is_admin) -> dict` dans `plane.app.views.workflow.base`, `is_workspace_admin(user, slug) -> bool`.
- Actions d'audit : `workflow_status.deleted`, `workflow.created`, `workflow.updated`, `workflow.deleted`, `workflow.graph_updated` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `apps/api/plane/tests/contract/app/test_workflows_app.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    AuditLog,
    Issue,
    Project,
    ProjectMember,
    Workflow,
    WorkflowState,
    WorkflowStatus,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project

STATUSES_URL = "/api/workspaces/{slug}/workflow-statuses/"
STATUS_URL = "/api/workspaces/{slug}/workflow-statuses/{pk}/"
WORKFLOWS_URL = "/api/workspaces/{slug}/workflows/"
WORKFLOW_URL = "/api/workspaces/{slug}/workflows/{pk}/"
GRAPH_URL = "/api/workspaces/{slug}/workflows/{pk}/graph/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def users(db, workspace, create_user):
    people = {"admin": create_user}
    for name, role in (("member", 15), ("guest", 5)):
        people[name] = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=people[name], role=role)
    return people


@pytest.fixture
def project(workspace, users):
    project = Project.objects.create(name="Secret", identifier="SEC", workspace=workspace, created_by=users["admin"])
    ProjectMember.objects.create(project=project, member=users["admin"], role=20)
    return project


@pytest.fixture
def software(workspace):
    return build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])


def _graph_payload(workflow, extra_states=(), drop=()):
    states = [
        {
            "key": str(state.id),
            "status": {"id": str(state.status_id), "name": state.status.name, "color": state.status.color},
            "position_x": 0,
            "position_y": 0,
            "is_initial": state.is_initial,
        }
        for name, state in workflow.states_by_name.items()
        if name not in drop
    ]
    return {"states": states + list(extra_states), "transitions": []}


@pytest.mark.contract
@pytest.mark.django_db
class TestRead:
    @pytest.mark.parametrize("role", ["admin", "member", "guest"])
    def test_every_member_reads_workflows_and_statuses(self, workspace, users, software, role):
        client = _client(users[role])
        listed = client.get(WORKFLOWS_URL.format(slug=workspace.slug))
        detail = client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        statuses = client.get(STATUSES_URL.format(slug=workspace.slug))
        assert listed.status_code == detail.status_code == statuses.status_code == status.HTTP_200_OK
        assert listed.data[0]["state_count"] == 2
        assert [state["status"]["name"] for state in detail.data["states"]] == ["To do", "Done"]
        assert {item["name"] for item in statuses.data} == {"To do", "Done"}

    def test_project_names_only_reach_workspace_admins(self, workspace, users, project, software):
        link_project(project, software)
        as_admin = _client(users["admin"]).get(WORKFLOWS_URL.format(slug=workspace.slug)).data[0]
        as_member = _client(users["member"]).get(WORKFLOWS_URL.format(slug=workspace.slug)).data[0]
        assert as_admin["projects"] == [{"id": str(project.id), "name": "Secret"}]
        assert as_member["project_count"] == 1
        assert "projects" not in as_member

    def test_non_member_is_refused(self, workspace, software):
        assert _client(UserFactory()).get(WORKFLOWS_URL.format(slug=workspace.slug)).status_code == (
            status.HTTP_403_FORBIDDEN
        )

    def test_a_workflow_of_another_workspace_looks_missing(self, workspace, users):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        client = _client(users["admin"])
        hidden = client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=foreign.id))
        missing = client.get(WORKFLOW_URL.format(slug=workspace.slug, pk=uuid4()))
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data


@pytest.mark.contract
@pytest.mark.django_db
class TestWrite:
    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_non_admins_cannot_write(self, workspace, users, software, role):
        client = _client(users[role])
        responses = [
            client.post(WORKFLOWS_URL.format(slug=workspace.slug), {"name": "New"}, format="json"),
            client.patch(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id), {"name": "X"}, format="json"),
            client.delete(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id)),
            client.put(GRAPH_URL.format(slug=workspace.slug, pk=software.id), _graph_payload(software), format="json"),
            client.delete(STATUS_URL.format(slug=workspace.slug, pk=software.states_by_name["Done"].status_id)),
        ]
        assert {response.status_code for response in responses} == {status.HTTP_403_FORBIDDEN}
        assert not AuditLog.objects.exists()

    def test_create_rename_and_audit(self, workspace, users):
        client = _client(users["admin"])
        created = client.post(WORKFLOWS_URL.format(slug=workspace.slug), {"name": "Support"}, format="json")
        assert created.status_code == status.HTTP_201_CREATED, created.data
        duplicate = client.post(WORKFLOWS_URL.format(slug=workspace.slug), {"name": "SUPPORT"}, format="json")
        assert duplicate.status_code == status.HTTP_400_BAD_REQUEST
        assert "name" in duplicate.data
        renamed = client.patch(WORKFLOW_URL.format(slug=workspace.slug, pk=created.data["id"]), {"name": "Help"}, format="json")
        assert renamed.status_code == status.HTTP_200_OK
        assert list(AuditLog.objects.order_by("created_at").values_list("action", flat=True)) == [
            "workflow.created",
            "workflow.updated",
        ]

    def test_a_linked_workflow_cannot_be_deleted(self, workspace, users, project, software):
        link_project(project, software)
        response = _client(users["admin"]).delete(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "workflow_in_use"

    def test_deleting_a_workflow_frees_its_statuses(self, workspace, users, software):
        client = _client(users["admin"])
        assert client.delete(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id)).status_code == (
            status.HTTP_204_NO_CONTENT
        )
        assert not Workflow.objects.filter(pk=software.id).exists()
        assert not WorkflowState.objects.filter(workflow_id=software.id).exists()
        done_id = software.states_by_name["Done"].status_id
        assert client.delete(STATUS_URL.format(slug=workspace.slug, pk=done_id)).status_code == status.HTTP_204_NO_CONTENT
        assert not WorkflowStatus.objects.filter(pk=done_id).exists()
        assert AuditLog.objects.filter(action="workflow_status.deleted", target_id=done_id).exists()

    def test_a_status_used_by_a_workflow_cannot_be_deleted(self, workspace, users, software):
        response = _client(users["admin"]).delete(
            STATUS_URL.format(slug=workspace.slug, pk=software.states_by_name["Done"].status_id)
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"error": "status_in_use"}


@pytest.mark.contract
@pytest.mark.django_db
class TestGraph:
    def test_admin_saves_a_graph(self, workspace, users, software):
        new_state = {
            "key": "n1",
            "status": {"name": "Review", "color": "#00AA00"},
            "position_x": 10,
            "position_y": 20,
            "is_initial": False,
        }
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), _graph_payload(software, [new_state]), format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        assert [state["status"]["name"] for state in response.data["states"]] == ["To do", "Done", "Review"]
        assert AuditLog.objects.filter(action="workflow.graph_updated").count() == 1

    def test_removing_a_used_status_is_refused_with_project_counts(self, workspace, users, project, software):
        states = link_project(project, software)
        Issue.objects.create(name="Item", project=project, state=states["Done"])
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), _graph_payload(software, drop=["Done"]), format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["graph"] == ["status_in_use"]
        assert response.data["projects"] == [{"project_id": str(project.id), "project_name": "Secret", "issue_count": 1}]

    def test_a_new_status_named_like_an_existing_one_is_refused(self, workspace, users, software):
        WorkflowStatus.objects.create(workspace=workspace, name="Shelved", color="#3A3A3A")
        clash = {"key": "n1", "status": {"name": "shelved", "color": "#3A3A3A"}, "position_x": 0, "position_y": 0, "is_initial": False}
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), _graph_payload(software, [clash]), format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"graph": ["duplicate_status_name"]}

    def test_a_graph_of_another_workspace_looks_missing(self, workspace, users, software):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        response = _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=foreign.id), _graph_payload(software), format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_a_non_object_body_is_refused(self, workspace, users, software):
        response = _client(users["admin"]).put(GRAPH_URL.format(slug=workspace.slug, pk=software.id), [], format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -p wf-t5 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -v`
Expected: FAIL: every route answers 404 (not registered).

- [ ] **Step 3: Write the views**

Create `apps/api/plane/app/views/workflow/base.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Count

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import WorkflowGraphInputSerializer, WorkflowSerializer, WorkflowStatusSerializer
from plane.app.serializers.workflow import DUPLICATE_WORKFLOW_NAME_MESSAGE
from plane.db.models import Workflow, WorkflowState, WorkflowStatus, Workspace, WorkspaceMember
from plane.utils.audit import record_audit
from plane.utils.workflow_graph import GraphError, save_workflow_graph, workflow_graph
from plane.utils.workflow_sync import projects_using
from ..base import BaseAPIView

METHOD_NOT_ALLOWED = {"error": "Method not allowed on this route."}
NOT_AN_OBJECT = {"error": "The payload must be an object."}
WORKFLOW_NAME_CONSTRAINT = "workflow_unique_lower_name_workspace_when_deleted_at_null"
STATUS_NAME_CONSTRAINT = "workflow_status_unique_lower_name_workspace_when_deleted_at_null"


def _constraint_name(error):
    return getattr(getattr(error.__cause__, "diag", None), "constraint_name", None)


def is_workspace_admin(user, slug):
    return WorkspaceMember.objects.filter(
        member=user, workspace__slug=slug, role=ROLE.ADMIN.value, is_active=True
    ).exists()


def _projects(workflow, is_admin):
    projects = projects_using(workflow.id).order_by("name")
    data = {"project_count": projects.count()}
    # Members read workflows (A1) but private project names stay with admins (P6).
    if is_admin:
        data["projects"] = [{"id": str(project.id), "name": project.name} for project in projects]
    return data


def workflow_detail(workflow, is_admin):
    return {**workflow_graph(workflow), **_projects(workflow, is_admin)}


def _workflow_snapshot(workflow):
    return {"name": workflow.name, "description": workflow.description}


class WorkflowStatusEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, pk=None):
        if pk is not None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        statuses = WorkflowStatus.objects.filter(workspace__slug=slug).annotate(workflow_count=Count("workflow_states"))
        return Response(WorkflowStatusSerializer(statuses, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        with transaction.atomic():
            workflow_status = WorkflowStatus.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
            if WorkflowState.objects.filter(status_id=workflow_status.id).exists():
                return Response({"error": "status_in_use"}, status=status.HTTP_400_BAD_REQUEST)
            record_audit(
                workspace_id=workflow_status.workspace_id,
                actor_id=request.user.id,
                action="workflow_status.deleted",
                target_type="workflow_status",
                target_id=workflow_status.id,
                before={"name": workflow_status.name, "color": workflow_status.color, "group": workflow_status.group},
            )
            # Queryset delete: soft, without the per-row cascade task.
            WorkflowStatus.objects.filter(pk=workflow_status.pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkflowEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, pk=None):
        is_admin = is_workspace_admin(request.user, slug)
        if pk is not None:
            workflow = Workflow.objects.get(workspace__slug=slug, pk=pk)
            return Response(workflow_detail(workflow, is_admin), status=status.HTTP_200_OK)
        workflows = Workflow.objects.filter(workspace__slug=slug).annotate(state_count=Count("states"))
        data = [
            {**WorkflowSerializer(workflow).data, "state_count": workflow.state_count, **_projects(workflow, is_admin)}
            for workflow in workflows
        ]
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk=None):
        if pk is not None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkflowSerializer(data=request.data, context={"workspace_id": workspace.id})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                workflow = serializer.save(workspace_id=workspace.id)
                record_audit(
                    workspace_id=workspace.id,
                    actor_id=request.user.id,
                    action="workflow.created",
                    target_type="workflow",
                    target_id=workflow.id,
                    after=_workflow_snapshot(workflow),
                )
        except IntegrityError as error:
            if _constraint_name(error) != WORKFLOW_NAME_CONSTRAINT:
                raise
            return Response({"name": [DUPLICATE_WORKFLOW_NAME_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(workflow_detail(workflow, True), status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        if not isinstance(request.data, dict):
            return Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                workflow = Workflow.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
                before = _workflow_snapshot(workflow)
                serializer = WorkflowSerializer(
                    workflow, data=request.data, partial=True, context={"workspace_id": workflow.workspace_id}
                )
                if not serializer.is_valid():
                    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                workflow = serializer.save()
                record_audit(
                    workspace_id=workflow.workspace_id,
                    actor_id=request.user.id,
                    action="workflow.updated",
                    target_type="workflow",
                    target_id=workflow.id,
                    before=before,
                    after=_workflow_snapshot(workflow),
                )
        except IntegrityError as error:
            if _constraint_name(error) != WORKFLOW_NAME_CONSTRAINT:
                raise
            return Response({"name": [DUPLICATE_WORKFLOW_NAME_MESSAGE]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(workflow_detail(workflow, True), status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        with transaction.atomic():
            workflow = Workflow.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
            if projects_using(workflow.id).exists():
                return Response({"error": "workflow_in_use"}, status=status.HTTP_400_BAD_REQUEST)
            record_audit(
                workspace_id=workflow.workspace_id,
                actor_id=request.user.id,
                action="workflow.deleted",
                target_type="workflow",
                target_id=workflow.id,
                before=workflow_graph(workflow),
            )
            # The graph rows go for good (P2), which frees the statuses they referenced.
            WorkflowState.objects.filter(workflow_id=workflow.id).delete()
            Workflow.objects.filter(pk=workflow.pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkflowGraphEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def put(self, request, slug, pk):
        if not isinstance(request.data, dict):
            return Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkflowGraphInputSerializer(data=request.data, context={"workspace_id": workspace.id})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                workflow = Workflow.objects.select_for_update(of=("self",)).get(workspace_id=workspace.id, pk=pk)
                save_workflow_graph(workflow=workflow, graph=serializer.validated_data, actor_id=request.user.id)
        except GraphError as error:
            body = {"graph": [error.code]}
            if error.details:
                body["projects"] = error.details
            return Response(body, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as error:
            if _constraint_name(error) != STATUS_NAME_CONSTRAINT:
                raise
            return Response({"graph": ["duplicate_status_name"]}, status=status.HTTP_400_BAD_REQUEST)
        workflow.refresh_from_db()
        return Response(workflow_detail(workflow, True), status=status.HTTP_200_OK)
```

In `apps/api/plane/app/views/__init__.py`, after the `issue_type` block:

```python
from .workflow.base import WorkflowEndpoint, WorkflowGraphEndpoint, WorkflowStatusEndpoint
```

Create `apps/api/plane/app/urls/workflow.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import WorkflowEndpoint, WorkflowGraphEndpoint, WorkflowStatusEndpoint

urlpatterns = [
    path("workspaces/<str:slug>/workflow-statuses/", WorkflowStatusEndpoint.as_view(), name="workflow-statuses"),
    path("workspaces/<str:slug>/workflow-statuses/<uuid:pk>/", WorkflowStatusEndpoint.as_view(), name="workflow-status"),
    path("workspaces/<str:slug>/workflows/", WorkflowEndpoint.as_view(), name="workflows"),
    path("workspaces/<str:slug>/workflows/<uuid:pk>/", WorkflowEndpoint.as_view(), name="workflow"),
    path("workspaces/<str:slug>/workflows/<uuid:pk>/graph/", WorkflowGraphEndpoint.as_view(), name="workflow-graph"),
]
```

In `apps/api/plane/app/urls/__init__.py`, next to `issue_type_urls`: `from .workflow import urlpatterns as workflow_urls` and `*workflow_urls,` in `urlpatterns`.

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose -p wf-t5 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -v`
Expected: 17 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/plane/app/views/workflow/base.py apps/api/plane/app/views/__init__.py apps/api/plane/app/urls/workflow.py apps/api/plane/app/urls/__init__.py apps/api/plane/tests/contract/app/test_workflows_app.py
git commit -m "feat(api): add workspace workflow and status routes"
```

---

### Task 6: API du système de projet et assistant de rattachement (spec A3, A4, A5, W10, 5.1, 5.3, P10)

**Files:**

- Modify: `apps/api/plane/app/serializers/workflow.py`, `apps/api/plane/app/serializers/__init__.py`
- Modify: `apps/api/plane/app/views/workflow/base.py`, `apps/api/plane/app/views/__init__.py`
- Modify: `apps/api/plane/app/urls/workflow.py`
- Test: `apps/api/plane/tests/contract/app/test_workflow_scheme_app.py`

**Interfaces:**

- Consumes: `apply_scheme`, `detach_scheme`, `mapping_needs`, `validate_scheme`, `SchemeError` (Task 3), `workflow_graph` (Task 4), `can_manage_project_issue_types(user, slug, project_id)` (livraison 1, `plane.app.views.issue_type.base` : même règle que A4).
- Produces (routes) :
  - `GET, PUT, DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/workflow-scheme/` (lecture : membres du workspace ; écriture : admin du projet ou du workspace).
  - `POST /api/workspaces/<slug>/projects/<uuid:project_id>/workflow-scheme/preview/` (admin du projet ou du workspace).
  - Corps d'entrée : `{"default_workflow_id", "items": [{"issue_type_id", "workflow_id"}], "mappings": [{"state_id", "workflow_id", "status_id"}]}` (`mappings` ignoré par `preview`).
  - Corps de `GET` et de la réponse à `PUT` : `{"default_workflow_id": str | null, "items": [...], "workflows": [workflow_graph, ...]}` (P10) ; projet libre : `{"default_workflow_id": null, "items": [], "workflows": []}`.
  - Réponse de `preview` : `{"needs": [...]}` (format de `mapping_needs`).
  - Refus : `{"scheme": [code]}`, plus `"needs"` pour `mapping_incomplete` et `invalid_mapping`.
- Produces (Python) : `ProjectWorkflowSchemeInputSerializer` ; `ProjectWorkflowSchemeEndpoint`, `ProjectWorkflowSchemePreviewEndpoint`, `scheme_body(project) -> dict`.
- Actions d'audit : `project_workflow_scheme.applied`, `project_workflow_scheme.detached` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `apps/api/plane/tests/contract/app/test_workflow_scheme_app.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    AuditLog,
    Issue,
    Project,
    ProjectMember,
    ProjectWorkflowScheme,
    State,
    WorkspaceMember,
)
from plane.tests.factories import IssueTypeFactory, ProjectFactory, ProjectIssueTypeFactory, UserFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project

SCHEME_URL = "/api/workspaces/{slug}/projects/{project_id}/workflow-scheme/"
PREVIEW_URL = "/api/workspaces/{slug}/projects/{project_id}/workflow-scheme/preview/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def users(db, workspace, create_user):
    people = {"admin": create_user}
    for name, role in (("member", 15), ("guest", 5), ("project_admin", 15), ("outside_admin", 20)):
        people[name] = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=people[name], role=role)
    return people


@pytest.fixture
def project(workspace, users):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=users["admin"])
    for name, role in (("admin", 20), ("member", 15), ("guest", 5), ("project_admin", 20)):
        ProjectMember.objects.create(project=project, member=users[name], role=role)
    return project


@pytest.fixture
def software(workspace):
    return build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])


@pytest.fixture
def support(workspace):
    return build_workflow(workspace, "Support", ["New", "Closed"], [(["New"], "Closed", None)])


@pytest.fixture
def bug(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    return bug


def _url(template, workspace, project):
    return template.format(slug=workspace.slug, project_id=project.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestRead:
    @pytest.mark.parametrize("role", ["admin", "member", "guest", "outside_admin"])
    def test_every_workspace_member_reads_the_scheme(self, workspace, users, project, software, bug, support, role):
        link_project(project, software, {bug: support})
        response = _client(users[role]).get(_url(SCHEME_URL, workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["default_workflow_id"] == str(software.id)
        assert response.data["items"] == [{"issue_type_id": str(bug.id), "workflow_id": str(support.id)}]
        assert sorted(workflow["name"] for workflow in response.data["workflows"]) == ["Software", "Support"]

    def test_a_free_project_has_an_empty_scheme(self, workspace, users, project):
        response = _client(users["member"]).get(_url(SCHEME_URL, workspace, project))
        assert response.data == {"default_workflow_id": None, "items": [], "workflows": []}

    def test_non_member_is_refused_and_foreign_projects_look_missing(self, workspace, users, project):
        assert _client(UserFactory()).get(_url(SCHEME_URL, workspace, project)).status_code == status.HTTP_403_FORBIDDEN
        foreign = ProjectFactory(workspace=WorkspaceFactory())
        client = _client(users["admin"])
        hidden = client.get(SCHEME_URL.format(slug=workspace.slug, project_id=foreign.id))
        missing = client.get(SCHEME_URL.format(slug=workspace.slug, project_id=uuid4()))
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data


@pytest.mark.contract
@pytest.mark.django_db
class TestWrite:
    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_non_managers_cannot_write(self, workspace, users, project, software, role):
        client = _client(users[role])
        body = {"default_workflow_id": str(software.id), "items": []}
        responses = [
            client.put(_url(SCHEME_URL, workspace, project), body, format="json"),
            client.post(_url(PREVIEW_URL, workspace, project), body, format="json"),
            client.delete(_url(SCHEME_URL, workspace, project)),
        ]
        assert {response.status_code for response in responses} == {status.HTTP_403_FORBIDDEN}
        assert not ProjectWorkflowScheme.objects.exists()

    @pytest.mark.parametrize("role", ["admin", "project_admin", "outside_admin"])
    def test_project_or_workspace_admins_link_a_project(self, workspace, users, project, software, role, mock_celery):
        response = _client(users[role]).put(
            _url(SCHEME_URL, workspace, project), {"default_workflow_id": str(software.id), "items": []}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        assert set(State.objects.filter(project=project).values_list("name", flat=True)) == {"To do", "Done"}
        entry = AuditLog.objects.get(action="project_workflow_scheme.applied")
        assert entry.actor_id == users[role].id

    def test_preview_then_apply_with_a_mapping(self, workspace, users, project, software, mock_celery):
        legacy = State.objects.create(name="Backlog", project=project)
        issue = Issue.objects.create(name="Item", project=project, state=legacy)
        client = _client(users["admin"])
        body = {"default_workflow_id": str(software.id), "items": []}

        preview = client.post(_url(PREVIEW_URL, workspace, project), body, format="json")
        assert preview.status_code == status.HTTP_200_OK
        assert [(need["state_name"], need["issue_count"]) for need in preview.data["needs"]] == [("Backlog", 1)]

        refused = client.put(_url(SCHEME_URL, workspace, project), body, format="json")
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert refused.data["scheme"] == ["mapping_incomplete"]
        assert refused.data["needs"][0]["state_id"] == str(legacy.id)

        done = software.states_by_name["Done"].status_id
        body["mappings"] = [{"state_id": str(legacy.id), "workflow_id": str(software.id), "status_id": str(done)}]
        applied = client.put(_url(SCHEME_URL, workspace, project), body, format="json")
        assert applied.status_code == status.HTTP_200_OK, applied.data
        issue.refresh_from_db()
        assert issue.state.workflow_status_id == done

    def test_invalid_schemes_are_refused(self, workspace, users, project, software, bug):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        stranger = IssueTypeFactory(workspace=workspace, name="Stranger")
        client = _client(users["admin"])
        bodies = [
            {"default_workflow_id": str(foreign.id), "items": []},
            {"default_workflow_id": str(software.id), "items": [{"issue_type_id": str(stranger.id), "workflow_id": str(software.id)}]},
        ]
        for body in bodies:
            response = client.put(_url(SCHEME_URL, workspace, project), body, format="json")
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert response.data == {"scheme": ["invalid_scheme"]}

    def test_a_type_listed_twice_is_refused(self, workspace, users, project, software, bug):
        line = {"issue_type_id": str(bug.id), "workflow_id": str(software.id)}
        response = _client(users["admin"]).put(
            _url(SCHEME_URL, workspace, project), {"default_workflow_id": str(software.id), "items": [line, line]}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_detach(self, workspace, users, project, software):
        link_project(project, software)
        response = _client(users["project_admin"]).delete(_url(SCHEME_URL, workspace, project))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not ProjectWorkflowScheme.objects.exists()
        assert not State.objects.filter(project=project, workflow_status__isnull=False).exists()

    def test_an_archived_project_cannot_be_linked(self, workspace, users, project, software):
        Project.objects.filter(pk=project.pk).update(archived_at=timezone.now())
        response = _client(users["admin"]).put(
            _url(SCHEME_URL, workspace, project), {"default_workflow_id": str(software.id), "items": []}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -p wf-t6 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflow_scheme_app.py -v`
Expected: FAIL: the routes answer 404.

- [ ] **Step 3: Write the input serializer**

Append to `apps/api/plane/app/serializers/workflow.py`:

```python
class SchemeItemInputSerializer(serializers.Serializer):
    issue_type_id = StrictUUIDField()
    workflow_id = StrictUUIDField()


class SchemeMappingInputSerializer(serializers.Serializer):
    state_id = StrictUUIDField()
    workflow_id = StrictUUIDField()
    status_id = StrictUUIDField()


class ProjectWorkflowSchemeInputSerializer(serializers.Serializer):
    default_workflow_id = StrictUUIDField()
    items = serializers.ListField(child=SchemeItemInputSerializer(), required=False, default=list, max_length=200)
    mappings = serializers.ListField(
        child=SchemeMappingInputSerializer(), required=False, default=list, max_length=MAX_STATES_PER_WORKFLOW * 5
    )

    def validate_items(self, items):
        type_ids = [item["issue_type_id"] for item in items]
        if len(set(type_ids)) != len(type_ids):
            raise serializers.ValidationError("Each work item type appears once.")
        return items
```

and export it: `from .workflow import ProjectWorkflowSchemeInputSerializer, WorkflowGraphInputSerializer, WorkflowSerializer, WorkflowStatusSerializer`.

- [ ] **Step 4: Write the views and routes**

Append to `apps/api/plane/app/views/workflow/base.py` (and add the imports `ProjectWorkflowSchemeInputSerializer` from `plane.app.serializers`, `Project`, `ProjectWorkflowScheme` from `plane.db.models`, `can_manage_project_issue_types` from `plane.app.views.issue_type.base`, `SchemeError, apply_scheme, detach_scheme, mapping_needs, validate_scheme` from `plane.utils.workflow_sync`):

```python
FORBIDDEN = {"error": "You don't have the required permissions."}


def _require_project_manager(request, slug, project_id):
    """A4 is the same rule as R3 of the work item types: workspace admins and project admins."""
    if can_manage_project_issue_types(request.user, slug, project_id):
        return None
    return Response(FORBIDDEN, status=status.HTTP_403_FORBIDDEN)


def _writable_project(slug, project_id):
    return Project.objects.get(workspace__slug=slug, pk=project_id, archived_at__isnull=True)


def _scheme_input(request):
    if not isinstance(request.data, dict):
        return None, Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
    serializer = ProjectWorkflowSchemeInputSerializer(data=request.data)
    if not serializer.is_valid():
        return None, Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    data = serializer.validated_data
    items = {item["issue_type_id"]: item["workflow_id"] for item in data["items"]}
    mappings = {(mapping["state_id"], mapping["workflow_id"]): mapping["status_id"] for mapping in data["mappings"]}
    return (data["default_workflow_id"], items, mappings), None


def _scheme_refusal(error):
    body = {"scheme": [error.code]}
    if error.details:
        body["needs"] = error.details
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


def scheme_body(project):
    scheme = ProjectWorkflowScheme.objects.filter(project_id=project.id).first()
    if scheme is None:
        return {"default_workflow_id": None, "items": [], "workflows": []}
    items = list(scheme.items.order_by("created_at").values_list("issue_type_id", "workflow_id"))
    workflow_ids = {scheme.default_workflow_id, *(workflow_id for _, workflow_id in items)}
    return {
        "default_workflow_id": str(scheme.default_workflow_id),
        "items": [{"issue_type_id": str(type_id), "workflow_id": str(workflow_id)} for type_id, workflow_id in items],
        # Embedded so the web app computes reachable states without another round trip (P10).
        "workflows": [workflow_graph(workflow) for workflow in Workflow.objects.filter(pk__in=workflow_ids).order_by("name")],
    }


class ProjectWorkflowSchemeEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        return Response(scheme_body(project), status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def put(self, request, slug, project_id):
        refusal = _require_project_manager(request, slug, project_id)
        if refusal:
            return refusal
        scheme_input, error_response = _scheme_input(request)
        if error_response:
            return error_response
        default_workflow_id, items, mappings = scheme_input
        project = _writable_project(slug, project_id)
        try:
            apply_scheme(
                project=project,
                default_workflow_id=default_workflow_id,
                items=items,
                mappings=mappings,
                actor_id=request.user.id,
            )
        except SchemeError as error:
            return _scheme_refusal(error)
        return Response(scheme_body(project), status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def delete(self, request, slug, project_id):
        refusal = _require_project_manager(request, slug, project_id)
        if refusal:
            return refusal
        detach_scheme(project=_writable_project(slug, project_id), actor_id=request.user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectWorkflowSchemePreviewEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, project_id):
        refusal = _require_project_manager(request, slug, project_id)
        if refusal:
            return refusal
        scheme_input, error_response = _scheme_input(request)
        if error_response:
            return error_response
        default_workflow_id, items, _ = scheme_input
        project = _writable_project(slug, project_id)
        try:
            validate_scheme(project, default_workflow_id, items)
        except SchemeError as error:
            return _scheme_refusal(error)
        return Response({"needs": mapping_needs(project, default_workflow_id, items)}, status=status.HTTP_200_OK)
```

Replace the views export line by:

```python
from .workflow.base import (
    ProjectWorkflowSchemeEndpoint,
    ProjectWorkflowSchemePreviewEndpoint,
    WorkflowEndpoint,
    WorkflowGraphEndpoint,
    WorkflowStatusEndpoint,
)
```

Append to `urlpatterns` in `apps/api/plane/app/urls/workflow.py` (and import both endpoints):

```python
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/workflow-scheme/",
        ProjectWorkflowSchemeEndpoint.as_view(),
        name="project-workflow-scheme",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/workflow-scheme/preview/",
        ProjectWorkflowSchemePreviewEndpoint.as_view(),
        name="project-workflow-scheme-preview",
    ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose -p wf-t6 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflow_scheme_app.py plane/tests/contract/app/test_workflows_app.py -v`
Expected: 16 passed in `test_workflow_scheme_app.py`, 17 still passing in `test_workflows_app.py`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/plane/app/serializers/workflow.py apps/api/plane/app/serializers/__init__.py apps/api/plane/app/views/workflow/base.py apps/api/plane/app/views/__init__.py apps/api/plane/app/urls/workflow.py apps/api/plane/tests/contract/app/test_workflow_scheme_app.py
git commit -m "feat(api): link projects to workflow schemes"
```

---

### Task 7: Contrôle sur les chemins d'écriture des tickets (spec 4.2, 4.5, T1, T2, W8, W9, P3)

**Files:**

- Modify: `apps/api/plane/app/serializers/issue.py` (`IssueCreateSerializer.validate`)
- Modify: `apps/api/plane/api/serializers/issue.py` (`IssueSerializer.validate`)
- Test: `apps/api/plane/tests/contract/app/test_workflow_enforcement_app.py`
- Test: `apps/api/plane/tests/contract/api/test_workflow_enforcement_api.py`

**Interfaces:**

- Consumes: `resolve_workflow_state(*, project_id, instance, state, state_given, type_id)` (Task 2), `link_project`, `build_workflow`.
- Produces: rien de nouveau ; le comportement des routes de tickets existantes change sous workflow (application : création, modification, sous-tickets, intake, conversion de brouillon, tous via `IssueCreateSerializer` ; API v1 : création, `PATCH`, `PUT` d'upsert, via `IssueSerializer`). Les brouillons eux-mêmes ne sont pas contrôlés (4.2).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/plane/tests/contract/app/test_workflow_enforcement_app.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from types import SimpleNamespace
from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import DraftIssue, Issue, Project, ProjectMember, State, WorkspaceMember
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory, UserFactory
from plane.tests.workflow_builders import build_workflow, link_project

ISSUES_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/"
ISSUE_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/"
REFUSED = {"workflow": ["transition_not_allowed"]}


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def ctx(db, workspace, create_user):
    member = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    ProjectMember.objects.create(project=project, member=member, role=15)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    software = build_workflow(
        workspace,
        "Software",
        ["To do", "Doing", "Done", "Cancelled"],
        [(["To do"], "Doing", None), (["Doing"], "Done", {"roles": [20]}), ("*", "Cancelled", None)],
    )
    support = build_workflow(workspace, "Support", ["New", "Doing", "Closed"], [(["New"], "Closed", None)])
    states = link_project(project, software, {bug: support})
    return SimpleNamespace(
        workspace=workspace,
        project=project,
        admin=create_user,
        member=member,
        bug=bug,
        states=states,
        issues_url=ISSUES_URL.format(slug=workspace.slug, project_id=project.id),
    )


def _issue(ctx, state_name, **kwargs):
    return Issue.objects.create(name="Item", project=ctx.project, state=ctx.states[state_name], **kwargs)


def _patch(ctx, user, issue, data):
    url = ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)
    return _client(user).patch(url, data, format="json")


@pytest.mark.contract
@pytest.mark.django_db
class TestCreation:
    def test_a_new_item_enters_the_initial_state_of_its_workflow(self, ctx, mock_celery):
        plain = _client(ctx.member).post(ctx.issues_url, {"name": "Task"}, format="json")
        bug = _client(ctx.member).post(ctx.issues_url, {"name": "Bug", "type_id": str(ctx.bug.id)}, format="json")
        assert plain.status_code == bug.status_code == status.HTTP_201_CREATED, (plain.data, bug.data)
        assert Issue.objects.get(pk=plain.data["id"]).state_id == ctx.states["To do"].id
        assert Issue.objects.get(pk=bug.data["id"]).state_id == ctx.states["New"].id

    def test_another_state_at_creation_is_refused(self, ctx, mock_celery):
        response = _client(ctx.admin).post(
            ctx.issues_url, {"name": "Shortcut", "state_id": str(ctx.states["Done"].id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == REFUSED
        assert not Issue.objects.filter(name="Shortcut").exists()


@pytest.mark.contract
@pytest.mark.django_db
class TestTransitions:
    def test_an_arrow_allows_the_move(self, ctx, mock_celery):
        issue = _issue(ctx, "To do")
        response = _patch(ctx, ctx.member, issue, {"state_id": str(ctx.states["Doing"].id)})
        assert response.status_code == status.HTTP_200_OK, response.data
        issue.refresh_from_db()
        assert issue.state_id == ctx.states["Doing"].id

    def test_every_refusal_looks_the_same(self, ctx, mock_celery):
        stray = State.objects.create(name="Stray", project=ctx.project)
        no_arrow = _patch(ctx, ctx.admin, _issue(ctx, "To do"), {"state_id": str(ctx.states["Done"].id)})
        no_right = _patch(ctx, ctx.member, _issue(ctx, "Doing"), {"state_id": str(ctx.states["Done"].id)})
        outside = _patch(ctx, ctx.admin, _issue(ctx, "To do"), {"state_id": str(stray.id)})
        assert no_arrow.status_code == no_right.status_code == outside.status_code == status.HTTP_400_BAD_REQUEST
        assert no_arrow.data == no_right.data == outside.data == REFUSED
        assert mock_celery.call_count == 0

    def test_the_role_rule_admits_the_admin(self, ctx, mock_celery):
        issue = _issue(ctx, "Doing")
        assert _patch(ctx, ctx.admin, issue, {"state_id": str(ctx.states["Done"].id)}).status_code == status.HTTP_200_OK

    def test_a_global_transition_works_from_anywhere(self, ctx, mock_celery):
        issue = _issue(ctx, "Doing")
        response = _patch(ctx, ctx.member, issue, {"state_id": str(ctx.states["Cancelled"].id)})
        assert response.status_code == status.HTTP_200_OK

    def test_a_free_project_is_not_controlled(self, ctx, workspace, mock_celery):
        free = Project.objects.create(name="Free", identifier="FREE", workspace=workspace)
        ProjectMember.objects.create(project=free, member=ctx.member, role=15)
        a = State.objects.create(name="A", project=free)
        b = State.objects.create(name="B", project=free)
        issue = Issue.objects.create(name="Free", project=free, state=a)
        url = ISSUE_URL.format(slug=workspace.slug, project_id=free.id, issue_id=issue.id)
        assert _client(ctx.member).patch(url, {"state_id": str(b.id)}, format="json").status_code == status.HTTP_200_OK


@pytest.mark.contract
@pytest.mark.django_db
class TestTypeChange:
    def test_a_type_change_needing_an_arrival_state_is_refused_without_one(self, ctx, mock_celery):
        issue = _issue(ctx, "To do")
        response = _patch(ctx, ctx.member, issue, {"type_id": str(ctx.bug.id)})
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"workflow": ["arrival_state_required"]}

    def test_a_type_change_with_an_arrival_state(self, ctx, mock_celery):
        issue = _issue(ctx, "To do")
        response = _patch(ctx, ctx.member, issue, {"type_id": str(ctx.bug.id), "state_id": str(ctx.states["Closed"].id)})
        assert response.status_code == status.HTTP_200_OK, response.data
        issue.refresh_from_db()
        assert (issue.type_id, issue.state_id) == (ctx.bug.id, ctx.states["Closed"].id)

    def test_a_type_change_keeps_a_shared_state(self, ctx, mock_celery):
        issue = _issue(ctx, "Doing")
        assert _patch(ctx, ctx.member, issue, {"type_id": str(ctx.bug.id)}).status_code == status.HTTP_200_OK


@pytest.mark.contract
@pytest.mark.django_db
class TestDraftConversion:
    @pytest.fixture(autouse=True)
    def _no_side_effects(self, mock_celery):
        with (
            mock.patch("plane.app.views.workspace.draft.base_host", return_value="http://testserver"),
            mock.patch("plane.db.mixins.soft_delete_related_objects"),
        ):
            yield

    def _convert(self, ctx, data):
        draft = DraftIssue(name="Draft", project=ctx.project, workspace=ctx.workspace)
        draft.save(created_by_id=ctx.admin.id)
        return _client(ctx.admin).post(
            f"/api/workspaces/{ctx.workspace.slug}/draft-to-issue/{draft.id}/", {"name": "Draft", **data}, format="json"
        )

    def test_a_converted_draft_enters_the_initial_state(self, ctx):
        response = self._convert(ctx, {})
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(name="Draft").state_id == ctx.states["To do"].id

    def test_a_converted_draft_cannot_skip_the_workflow(self, ctx):
        response = self._convert(ctx, {"state_id": str(ctx.states["Done"].id)})
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == REFUSED
```

Create `apps/api/plane/tests/contract/api/test_workflow_enforcement_api.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from types import SimpleNamespace

import pytest
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, WorkflowTransitionRule
from plane.tests.workflow_builders import build_workflow, link_project

ISSUES_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/work-items/"
ISSUE_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/work-items/{issue_id}/"
REFUSED = {"workflow": ["transition_not_allowed"]}


@pytest.fixture
def ctx(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    software = build_workflow(
        workspace,
        "Software",
        ["To do", "Doing", "Done"],
        [(["To do"], "Doing", None), (["Doing"], "Done", {"roles": [15]})],
    )
    return SimpleNamespace(
        workspace=workspace,
        project=project,
        user=create_user,
        states=link_project(project, software),
        issues_url=ISSUES_URL.format(slug=workspace.slug, project_id=project.id),
    )


def _url(ctx, issue):
    return ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestApiV1Workflow:
    def test_creation_takes_the_initial_state(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Plain"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).state_id == ctx.states["To do"].id

    def test_creation_in_another_state_is_refused(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Skip", "state": str(ctx.states["Done"].id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == REFUSED

    def test_patch_follows_the_arrows(self, api_key_client, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project, state=ctx.states["To do"])
        refused = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Done"].id)}, format="json")
        allowed = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Doing"].id)}, format="json")
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert refused.data == REFUSED
        assert allowed.status_code == status.HTTP_200_OK, allowed.data

    def test_the_rule_is_checked_against_the_key_owner(self, api_key_client, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project, state=ctx.states["Doing"])
        # The key owner is a project admin (20) and the rule admits members (15) only.
        refused = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Done"].id)}, format="json")
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        WorkflowTransitionRule.objects.update(params={"user_ids": [str(ctx.user.id)]})
        allowed = api_key_client.patch(_url(ctx, issue), {"state": str(ctx.states["Done"].id)}, format="json")
        assert allowed.status_code == status.HTTP_200_OK, allowed.data
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose -p wf-t7 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflow_enforcement_app.py plane/tests/contract/api/test_workflow_enforcement_api.py -v`
Expected: FAIL: the refusal tests get 201 or 200 instead of 400, and the initial-state tests find the project default state set by `link_project` only for default-type items (the bug creation lands in "To do" instead of "New").

- [ ] **Step 3: Call the service from both serializers**

In `apps/api/plane/app/serializers/issue.py`, import `from plane.utils.workflows import resolve_workflow_state` and append to `IssueCreateSerializer.validate`, after the `type_id` block and before `return attrs`:

```python
        # Workflow last: it needs the validated state and type (spec 4.2).
        state = resolve_workflow_state(
            project_id=self.context.get("project_id"),
            instance=self.instance,
            state=attrs.get("state"),
            state_given="state" in attrs,
            type_id=attrs.get("type_id"),
        )
        if state is not None:
            attrs["state"] = state
```

In `apps/api/plane/api/serializers/issue.py`, same import and, at the same place in `IssueSerializer.validate`:

```python
        # Workflow last: it needs the validated state and type (spec 4.2).
        state = resolve_workflow_state(
            project_id=self.context.get("project_id"),
            instance=self.instance,
            state=data.get("state"),
            state_given="state" in data,
            type_id=data.get("type_id"),
        )
        if state is not None:
            data["state"] = state
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose -p wf-t7 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflow_enforcement_app.py plane/tests/contract/api/test_workflow_enforcement_api.py plane/tests/contract/app/test_issue_type_assignment_app.py plane/tests/contract/api/test_issue_type_assignment_api.py -v`
Expected: 12 + 4 passed in the new files; the delivery 1 type tests still pass (their projects have no scheme).

- [ ] **Step 5: Commit**

```bash
git add apps/api/plane/app/serializers/issue.py apps/api/plane/api/serializers/issue.py apps/api/plane/tests/contract/app/test_workflow_enforcement_app.py apps/api/plane/tests/contract/api/test_workflow_enforcement_api.py
git commit -m "feat(api): enforce workflows on work item writes"
```

---

### Task 8: Filet de sécurité dans le modèle `Issue` (spec 4.4, invariant 5, W7)

**Files:**

- Modify: `apps/api/plane/db/models/issue.py` (`TRACKED_FIELDS`, `save`, `_ensure_default_state`, nouvelle `_ensure_workflow_state`)
- Test: `apps/api/plane/tests/unit/models/test_issue_workflow_guard.py`

**Interfaces:**

- Consumes: `workflow_id_for`, `initial_state`, `state_in_workflow` (Task 2), importés dans les méthodes (comme `State` aujourd'hui) pour éviter l'import circulaire `plane.utils.workflows` vers `plane.db.models`.
- Produces: `Issue.save` lève `django.core.exceptions.ValidationError` (400 via `BaseAPIView.handle_exception`) quand un ticket d'un projet doté d'un système entre dans un état hors du workflow de son type ; sans état, un ticket prend l'état initial de son workflow. Pas de contrôle de l'acteur ni des flèches. Les opérations système de la Task 3 passent par `QuerySet.update` et ne sont pas concernées (T6).

- [ ] **Step 1: Write the failing test**

Create `apps/api/plane/tests/unit/models/test_issue_workflow_guard.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.core.exceptions import ValidationError

from plane.db.models import Issue, Project, State
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory
from plane.tests.workflow_builders import build_workflow, link_project

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def ctx(workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    software = build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])
    support = build_workflow(workspace, "Support", ["New", "Closed"], [(["New"], "Closed", None)])
    states = link_project(project, software, {bug: support})
    return project, bug, states


def test_without_state_an_item_enters_the_initial_state_of_its_workflow(ctx):
    project, bug, states = ctx
    assert Issue.objects.create(name="Task", project=project).state_id == states["To do"].id
    assert Issue.objects.create(name="Bug", project=project, type=bug).state_id == states["New"].id


def test_a_state_of_another_workflow_is_refused(ctx):
    project, bug, states = ctx
    with pytest.raises(ValidationError):
        Issue.objects.create(name="Bug", project=project, type=bug, state=states["Done"])


def test_a_move_out_of_the_workflow_is_refused_but_arrows_are_not_checked_here(ctx):
    project, _, states = ctx
    issue = Issue.objects.create(name="Task", project=project)
    issue.state = states["Closed"]
    with pytest.raises(ValidationError):
        issue.save()
    issue.refresh_from_db()
    issue.state = states["Done"]
    issue.save()
    # No arrow leads back to "To do": the model checks membership only, the serializers check arrows.
    issue.state = states["To do"]
    issue.save()
    issue.refresh_from_db()
    assert issue.state_id == states["To do"].id


def test_a_type_change_into_a_workflow_without_the_state_is_refused(ctx):
    project, bug, states = ctx
    issue = Issue.objects.create(name="Task", project=project)
    issue.type = bug
    with pytest.raises(ValidationError):
        issue.save()


def test_triage_stays_allowed(ctx):
    project, _, _ = ctx
    triage = State.objects.create(name="Triage", project=project, group="triage")
    assert Issue.objects.create(name="Intake", project=project, state=triage).state_id == triage.id


def test_a_free_project_is_untouched(workspace):
    free = Project.objects.create(name="Free", identifier="FREE", workspace=workspace)
    state = State.objects.create(name="Anything", project=free)
    assert Issue.objects.create(name="Free", project=free, state=state).state_id == state.id


def test_saving_other_fields_does_not_recheck(ctx):
    project, _, states = ctx
    issue = Issue.objects.create(name="Task", project=project)
    Issue.objects.filter(pk=issue.pk).update(state=states["Closed"])
    issue.refresh_from_db()
    issue.name = "Renamed"
    issue.save()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -p wf-t8 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/models/test_issue_workflow_guard.py -v`
Expected: FAIL: the bug lands in "To do" (project default) and the three refusal tests do not raise.

- [ ] **Step 3: Write the guard**

In `apps/api/plane/db/models/issue.py`:

1. `TRACKED_FIELDS = ["state_id", "project_id", "type_id"]`.
2. Start of `save` (the type must be known before the state is defaulted or checked):

```python
    def save(self, *args, **kwargs):
        kwargs = self._ensure_default_type(kwargs)
        self._ensure_default_state()
        self._ensure_workflow_state()
        kwargs = self._sync_completed_at(kwargs)
```

3. In `_ensure_default_state`, right after the `if self.state is not None: return` guard:

```python
        from plane.utils.workflows import initial_state, workflow_id_for

        workflow_id = workflow_id_for(self.project_id, self.type_id)
        if workflow_id is not None:
            self.state = initial_state(self.project_id, workflow_id)
            return
```

4. New method after `_ensure_default_state`:

```python
    def _ensure_workflow_state(self):
        """Spec 4.4: under a workflow scheme an item only rests in a managed state of its own workflow."""
        if self.state_id is None or not (
            self._state.adding or self.has_changed("state_id") or self.has_changed("type_id")
        ):
            return
        if self.state.group == StateGroup.TRIAGE.value:
            return
        from plane.utils.workflows import state_in_workflow, workflow_id_for

        workflow_id = workflow_id_for(self.project_id, self.type_id)
        if workflow_id is not None and not state_in_workflow(self.state, workflow_id):
            raise ValidationError("The state is not part of the work item workflow.")
```

- [ ] **Step 4: Run test to verify it passes, then the neighbours**

Run: `docker compose -p wf-t8 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/models/ plane/tests/unit/utils/ plane/tests/contract/app/test_workflow_enforcement_app.py -v`
Expected: 7 passed in the new file; every other test of these folders still passes (the delivery 1 type defaults included).

- [ ] **Step 5: Commit**

```bash
git add apps/api/plane/db/models/issue.py apps/api/plane/tests/unit/models/test_issue_workflow_guard.py
git commit -m "feat(api): guard work item states against their workflow in the model"
```

---

### Task 9: Intake et automatisation (spec T3, T4, P9)

**Files:**

- Modify: `apps/api/plane/utils/workflows.py` (ajout de `intake_accept_state`, `workflow_close_state`)
- Modify: `apps/api/plane/app/serializers/intake.py`, `apps/api/plane/api/serializers/intake.py` (`validate` et `update`)
- Modify: `apps/api/plane/bgtasks/issue_automation_task.py` (`close_old_issues`)
- Test: `apps/api/plane/tests/unit/serializers/test_intake_accept_workflow.py`
- Test: `apps/api/plane/tests/unit/bg_tasks/test_close_old_issues_workflow.py`

**Interfaces:**

- Consumes: `workflow_id_for`, `initial_state` (Task 2).
- Produces (`plane.utils.workflows`) :
  - `intake_accept_state(issue) -> State | None` : l'état initial du workflow du ticket, ou l'état par défaut du projet s'il est libre (T3).
  - `workflow_close_state(project_id, workflow_id) -> State | None` : l'état de projet d'un statut du groupe `cancelled`, cible d'une transition globale sans règle du workflow (T4, P9).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/plane/tests/unit/serializers/test_intake_accept_workflow.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.api.serializers import IntakeIssueUpdateSerializer
from plane.app.serializers import IntakeIssueSerializer
from plane.db.models import Intake, IntakeIssue, Issue, Project, State
from plane.db.models.intake import IntakeIssueStatus
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory
from plane.tests.workflow_builders import build_workflow, link_project

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def make_intake_issue(workspace, create_user):
    def make(project, issue_type=None):
        triage = State.objects.get_or_create(
            name="Triage", project=project, defaults={"group": "triage", "color": "#3A3A3A"}
        )[0]
        intake = Intake.objects.get_or_create(name="Intake", project=project, workspace=workspace)[0]
        issue = Issue.objects.create(name="Incoming", project=project, state=triage, type=issue_type)
        return IntakeIssue.objects.create(
            intake=intake, issue=issue, project=project, workspace=workspace, status=IntakeIssueStatus.PENDING
        )

    return make


def _accept(serializer_class, intake_issue):
    serializer = serializer_class(intake_issue, data={"status": IntakeIssueStatus.ACCEPTED}, partial=True)
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    intake_issue.issue.refresh_from_db()
    return intake_issue.issue.state


@pytest.mark.parametrize("serializer_class", [IntakeIssueSerializer, IntakeIssueUpdateSerializer])
def test_accepting_enters_the_initial_state_of_the_item_workflow(workspace, create_user, make_intake_issue, serializer_class):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueTypeFactory(project=project, issue_type=bug)
    software = build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])
    support = build_workflow(workspace, "Support", ["New", "Closed"], [(["New"], "Closed", None)])
    states = link_project(project, software, {bug: support})
    assert _accept(serializer_class, make_intake_issue(project, bug)) == states["New"]
    assert _accept(serializer_class, make_intake_issue(project)) == states["To do"]


@pytest.mark.parametrize("serializer_class", [IntakeIssueSerializer, IntakeIssueUpdateSerializer])
def test_a_free_project_still_uses_its_default_state(workspace, create_user, make_intake_issue, serializer_class):
    project = Project.objects.create(name="Free", identifier="FREE", workspace=workspace, created_by=create_user)
    default = State.objects.create(name="Backlog", project=project, default=True)
    assert _accept(serializer_class, make_intake_issue(project)) == default
```

Create `apps/api/plane/tests/unit/bg_tasks/test_close_old_issues_workflow.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

import pytest
from django.utils import timezone

from plane.bgtasks.issue_automation_task import close_old_issues
from plane.db.models import Issue, Project, State, WorkflowStatus
from plane.tests.factories import ProjectFactory, WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def stale(workspace, create_user):
    def make(project, state):
        issue = Issue.objects.create(name="Stale", project=project, state=state)
        Issue.objects.filter(pk=issue.pk).update(updated_at=timezone.now() - timedelta(days=90))
        return issue

    return make


def _project(workspace, create_user, identifier):
    return Project.objects.create(
        name=identifier, identifier=identifier, workspace=workspace, created_by=create_user, close_in=1
    )


def test_a_free_project_closes_into_its_own_cancelled_state(workspace, create_user, stale, mock_celery):
    foreign_project = ProjectFactory(workspace=WorkspaceFactory())
    foreign = State.objects.create(name="Gone", project=foreign_project, group="cancelled")
    State.objects.filter(pk=foreign.pk).update(sequence=1)
    project = _project(workspace, create_user, "FREE")
    open_state = State.objects.create(name="Open", project=project, group="started")
    cancelled = State.objects.create(name="Cancelled", project=project, group="cancelled")
    issue = stale(project, open_state)

    close_old_issues()

    issue.refresh_from_db()
    assert issue.state_id == cancelled.id


def test_under_a_workflow_only_a_rule_free_global_transition_to_a_cancelled_state_closes(
    workspace, create_user, stale, mock_celery
):
    closing = build_workflow(workspace, "Closing", ["Open", "Dropped"], [("*", "Dropped", None)])
    guarded = build_workflow(workspace, "Guarded", ["Start", "Shelved"], [("*", "Shelved", {"roles": [20]})])
    WorkflowStatus.objects.filter(name__in=["Dropped", "Shelved"]).update(group="cancelled")
    first = _project(workspace, create_user, "ONE")
    second = _project(workspace, create_user, "TWO")
    first_states = link_project(first, closing)
    second_states = link_project(second, guarded)
    closed = stale(first, first_states["Open"])
    kept = stale(second, second_states["Start"])

    close_old_issues()

    closed.refresh_from_db()
    kept.refresh_from_db()
    assert closed.state_id == first_states["Dropped"].id
    assert kept.state_id == second_states["Start"].id


def test_without_any_closing_state_nothing_moves(workspace, create_user, stale, mock_celery):
    project = _project(workspace, create_user, "NONE")
    open_state = State.objects.create(name="Open", project=project, group="started")
    issue = stale(project, open_state)

    close_old_issues()

    issue.refresh_from_db()
    assert issue.state_id == open_state.id
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose -p wf-t9 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/serializers/test_intake_accept_workflow.py plane/tests/unit/bg_tasks/test_close_old_issues_workflow.py -v`
Expected: FAIL: the bug intake item lands in "To do" (both serializers) ; the free project item goes to the foreign "Gone" state or stays (not its own cancelled state) ; the guarded item and the item without closing state get a null or foreign state.

- [ ] **Step 3: Write the helpers**

Append to `apps/api/plane/utils/workflows.py`:

```python
def intake_accept_state(issue):
    """T3: an accepted intake item enters its workflow's initial state, or the project default when free."""
    workflow_id = workflow_id_for(issue.project_id, issue.type_id)
    if workflow_id is not None:
        return initial_state(issue.project_id, workflow_id)
    return State.objects.filter(project_id=issue.project_id, default=True).first()


def workflow_close_state(project_id, workflow_id):
    """T4: a cancelled state reachable by a rule-free global transition; the task has no actor (P9)."""
    status_id = (
        WorkflowTransition.objects.filter(
            workflow_id=workflow_id,
            from_any=True,
            rules__isnull=True,
            target__status__group=StateGroup.CANCELLED.value,
        )
        .order_by("created_at")
        .values_list("target__status_id", flat=True)
        .first()
    )
    if status_id is None:
        return None
    return State.objects.filter(project_id=project_id, workflow_status_id=status_id).first()
```

- [ ] **Step 4: Use them in both intake serializers**

In `apps/api/plane/app/serializers/intake.py` and `apps/api/plane/api/serializers/intake.py`, import `from plane.utils.workflows import intake_accept_state`, then:

- in `validate`, replace the `default_state = State.objects.filter(workspace=..., project=..., default=True).first()` lookup by `default_state = intake_accept_state(issue)` (the error message stays);
- in `update`, replace the same lookup by `default_state = intake_accept_state(issue)`.

Remove the `State` import from a file only if nothing else in it uses `State`.

- [ ] **Step 5: Rewrite the target choice of `close_old_issues`**

In `apps/api/plane/bgtasks/issue_automation_task.py`, import `from plane.db.models import StateGroup` (with the other models) and `from plane.utils.workflows import workflow_close_state, workflow_id_for`, then replace the block from `if issues:` to the end of the `issues_to_update` loop by:

```python
            if issues:
                # The fallback must come from this project: the unscoped lookup could pick another tenant's state.
                fallback = (
                    project.default_state
                    if project.default_state and project.default_state.project_id == project_id
                    else State.objects.filter(project_id=project_id, group=StateGroup.CANCELLED.value).first()
                )
                workflows_by_type = {}
                close_states = {}
                issues_to_update = []
                for issue in issues:
                    if issue.type_id not in workflows_by_type:
                        workflows_by_type[issue.type_id] = workflow_id_for(project_id, issue.type_id)
                    workflow_id = workflows_by_type[issue.type_id]
                    if workflow_id is None:
                        close_state = fallback
                    else:
                        if workflow_id not in close_states:
                            close_states[workflow_id] = workflow_close_state(project_id, workflow_id)
                        close_state = close_states[workflow_id]
                    # No reachable closing state: the item stays where it is (T4).
                    if close_state is None or close_state.pk == issue.state_id:
                        continue
                    issue.state = close_state
                    issues_to_update.append(issue)
```

Keep the `bulk_update` and the activity loop below it unchanged.

- [ ] **Step 6: Run tests to verify they pass**

Run: `docker compose -p wf-t9 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/serializers/test_intake_accept_workflow.py plane/tests/unit/bg_tasks/ plane/tests/contract/api/test_intake_issue_update.py -v`
Expected: 4 + 3 passed in the new files; the existing intake and background task tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/plane/utils/workflows.py apps/api/plane/app/serializers/intake.py apps/api/plane/api/serializers/intake.py apps/api/plane/bgtasks/issue_automation_task.py apps/api/plane/tests/unit/serializers/test_intake_accept_workflow.py apps/api/plane/tests/unit/bg_tasks/test_close_old_issues_workflow.py
git commit -m "fix(api): keep intake and auto-close inside the item workflow"
```

---

### Task 10: États gérés en lecture seule et `workflow_status` dans les réponses (spec 5.4, invariants 3 et 4)

**Files:**

- Modify: `apps/api/plane/utils/workflows.py` (ajout de `MANAGED_STATES_REFUSAL`, `project_has_scheme`)
- Modify: `apps/api/plane/app/views/state/base.py` (`create`, `partial_update`, `mark_as_default`, `destroy`)
- Modify: `apps/api/plane/api/views/state.py` (`StateListCreateAPIEndpoint.post`, `StateDetailAPIEndpoint.patch` et `.delete`)
- Modify: `apps/api/plane/app/serializers/state.py`, `apps/api/plane/api/serializers/state.py` (`workflow_status` en lecture seule)
- Test: `apps/api/plane/tests/contract/app/test_managed_states_app.py`
- Test: `apps/api/plane/tests/contract/api/test_managed_states_api.py`

**Interfaces:**

- Produces (`plane.utils.workflows`) : `MANAGED_STATES_REFUSAL = {"error": "managed_by_workflow"}`, `project_has_scheme(project_id) -> bool`.
- Produces (réponses) : chaque état renvoyé par l'application et l'API v1 porte `workflow_status` (identifiant du statut ou `null`) ; ce champ n'est jamais écrit par un client (sinon un état d'un projet libre pourrait pointer sur un statut d'un autre workspace).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/plane/tests/contract/app/test_managed_states_app.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status

from plane.db.models import Project, ProjectMember, State, WorkflowStatus
from plane.tests.factories import WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project

STATES_URL = "/api/workspaces/{slug}/projects/{project_id}/states/"
STATE_URL = "/api/workspaces/{slug}/projects/{project_id}/states/{pk}/"
DEFAULT_URL = "/api/workspaces/{slug}/projects/{project_id}/states/{pk}/mark-default/"
REFUSED = {"error": "managed_by_workflow"}


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestManagedStates:
    def test_every_state_write_is_refused_under_a_scheme(self, session_client, workspace, project):
        states = link_project(project, build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", None)]))
        args = {"slug": workspace.slug, "project_id": project.id}
        done = states["Done"]
        responses = [
            session_client.post(STATES_URL.format(**args), {"name": "Extra", "color": "#000000", "group": "started"}, format="json"),
            session_client.patch(STATE_URL.format(pk=done.id, **args), {"name": "Renamed"}, format="json"),
            session_client.patch(STATE_URL.format(pk=done.id, **args), {"sequence": 1}, format="json"),
            session_client.post(DEFAULT_URL.format(pk=done.id, **args)),
            session_client.delete(STATE_URL.format(pk=done.id, **args)),
        ]
        assert [response.status_code for response in responses] == [status.HTTP_400_BAD_REQUEST] * 5
        assert all(response.data == REFUSED for response in responses)
        done.refresh_from_db()
        assert (done.name, done.default) == ("Done", False)
        assert not State.objects.filter(project=project, name="Extra").exists()

    def test_states_expose_their_status_and_clients_cannot_set_it(self, session_client, workspace, project):
        foreign_status = WorkflowStatus.objects.create(workspace=WorkspaceFactory(), name="Foreign", color="#3A3A3A")
        args = {"slug": workspace.slug, "project_id": project.id}
        created = session_client.post(
            STATES_URL.format(**args),
            {"name": "Mine", "color": "#000000", "group": "started", "workflow_status": str(foreign_status.id)},
            format="json",
        )
        assert created.status_code == status.HTTP_200_OK, created.data
        assert created.data["workflow_status"] is None
        assert State.objects.get(pk=created.data["id"]).workflow_status_id is None
        listed = session_client.get(STATES_URL.format(**args))
        assert all("workflow_status" in state for state in listed.data)

    def test_a_free_project_keeps_editing_its_states(self, session_client, workspace, project):
        state = State.objects.create(name="Open", project=project)
        response = session_client.patch(
            STATE_URL.format(slug=workspace.slug, project_id=project.id, pk=state.id), {"name": "Ready"}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
```

Create `apps/api/plane/tests/contract/api/test_managed_states_api.py`:

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status

from plane.db.models import Project, ProjectMember, State, WorkflowStatus
from plane.tests.factories import WorkspaceFactory
from plane.tests.workflow_builders import build_workflow, link_project

STATES_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/states/"
STATE_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/states/{pk}/"


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestManagedStatesApiV1:
    def test_writes_are_refused_under_a_scheme(self, api_key_client, workspace, project):
        states = link_project(project, build_workflow(workspace, "Flow", ["Open", "Done"], [(["Open"], "Done", None)]))
        args = {"slug": workspace.slug, "project_id": project.id}
        responses = [
            api_key_client.post(STATES_URL.format(**args), {"name": "Extra", "color": "#000000"}, format="json"),
            api_key_client.patch(STATE_URL.format(pk=states["Done"].id, **args), {"default": True}, format="json"),
            api_key_client.delete(STATE_URL.format(pk=states["Done"].id, **args)),
        ]
        assert [response.status_code for response in responses] == [status.HTTP_400_BAD_REQUEST] * 3
        assert all(response.data == {"error": "managed_by_workflow"} for response in responses)

    def test_workflow_status_is_read_only(self, api_key_client, workspace, project):
        foreign_status = WorkflowStatus.objects.create(workspace=WorkspaceFactory(), name="Foreign", color="#3A3A3A")
        response = api_key_client.post(
            STATES_URL.format(slug=workspace.slug, project_id=project.id),
            {"name": "Mine", "color": "#000000", "workflow_status": str(foreign_status.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        assert State.objects.get(pk=response.data["id"]).workflow_status_id is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose -p wf-t10 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_managed_states_app.py plane/tests/contract/api/test_managed_states_api.py -v`
Expected: FAIL: the writes succeed under a scheme, `workflow_status` is missing from the app responses and the API v1 stores the foreign status.

- [ ] **Step 3: Write the guard**

Append to `apps/api/plane/utils/workflows.py`:

```python
MANAGED_STATES_REFUSAL = {"error": "managed_by_workflow"}


def project_has_scheme(project_id):
    return ProjectWorkflowScheme.objects.filter(project_id=project_id).exists()
```

In `apps/api/plane/app/views/state/base.py`, import both names and make `create`, `partial_update`, `mark_as_default` and `destroy` start with:

```python
        # Spec 5.4: the states of a linked project mirror its workflows and change only through them.
        if project_has_scheme(project_id):
            return Response(MANAGED_STATES_REFUSAL, status=status.HTTP_400_BAD_REQUEST)
```

In `apps/api/plane/api/views/state.py`, the same three lines at the start of `StateListCreateAPIEndpoint.post`, `StateDetailAPIEndpoint.patch` and `StateDetailAPIEndpoint.delete`.

In `apps/api/plane/app/serializers/state.py`, add `"workflow_status"` to `StateSerializer.Meta.fields` and to its `read_only_fields`. In `apps/api/plane/api/serializers/state.py`, add `"workflow_status"` to `read_only_fields`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose -p wf-t10 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_managed_states_app.py plane/tests/contract/api/test_managed_states_api.py plane/tests/contract/api/test_state_admin_scope.py -v`
Expected: 3 + 2 passed in the new files; `test_state_admin_scope.py` still passes.

- [ ] **Step 5: Run the whole backend suite**

Run: `docker compose -p wf-t10 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db`
Expected: every test passes (1 785 before this delivery, plus the new ones). Any failure is fixed here before the frontend starts.

- [ ] **Step 6: Commit**

```bash
git add apps/api/plane/utils/workflows.py apps/api/plane/app/views/state/base.py apps/api/plane/api/views/state.py apps/api/plane/app/serializers/state.py apps/api/plane/api/serializers/state.py apps/api/plane/tests/contract/app/test_managed_states_app.py apps/api/plane/tests/contract/api/test_managed_states_api.py
git commit -m "feat(api): make workflow-managed project states read-only"
```

---

### Task 11: Fondation frontend : dépendance, types, service, store et logique des états atteignables (spec 7.4, 4.5, P10)

**Files:**

- Modify: `pnpm-workspace.yaml` (catalogue), `apps/web/package.json`, `pnpm-lock.yaml` (régénéré)
- Create: `packages/types/src/workflow.ts`; Modify: `packages/types/src/index.ts`, `packages/types/src/state.ts`
- Modify: `packages/constants/src/fetch-keys.ts`
- Create: `apps/web/services/workflow.service.ts`
- Create: `apps/web/store/workspace/workflow.store.ts`, `apps/web/store/workspace/workflow.store.test.ts`; Modify: `apps/web/store/workspace/index.ts`
- Create: `apps/web/hooks/store/use-workflow.ts`
- Create: `apps/web/components/workflow/helpers.ts`, `apps/web/components/workflow/helpers.test.ts`
- Create: `apps/web/components/workflow/use-allowed-states.ts`; Modify: `apps/web/components/workflow/index.ts`
- Modify: `apps/web/layouts/auth-layout/project-wrapper.tsx` (chargement du système du projet)

**Interfaces:**

- Consumes: routes des Tasks 5 et 6 ; `IState.workflow_status` (Task 10).
- Produces (types, `@plane/types`) : `TWorkflowStatus`, `TWorkflowRule`, `TWorkflowRestrictActorsParams`, `TWorkflowState`, `TWorkflowTransition`, `TWorkflowGraph`, `TWorkflowDetail`, `TWorkflowSummary`, `TWorkflowProjectRef`, `TWorkflowFormData`, `TWorkflowGraphPayload`, `TWorkflowGraphPayloadState`, `TWorkflowGraphPayloadTransition`, `TProjectWorkflowScheme`, `TProjectWorkflowSchemeItem`, `TProjectWorkflowSchemePayload`, `TWorkflowMapping`, `TWorkflowMappingNeed`, `TWorkflowStatusUsage` ; `IState.workflow_status?: string | null`.
- Produces (clés SWR, `@plane/constants`) : `WORKSPACE_WORKFLOWS(slug)`, `WORKSPACE_WORKFLOW_STATUSES(slug)`, `WORKFLOW_DETAIL(workflowId)`, `PROJECT_WORKFLOW_SCHEME(projectId)`.
- Produces (store, `useWorkflow()`) : `IWorkflowStore` ci-dessous.
- Produces (`@/components/workflow`) : `getIssueWorkflow(scheme, typeId)`, `getAllowedTargetStateIds({ scheme, projectStates, issue, actor })`, `getInitialStateId(scheme, projectStates, typeId)`, `getWorkflowStateIds(scheme, projectStates, typeId)`, `getWorkflowRefusalKey(error)`, `WORKFLOW_REFUSAL_KEYS`, types `TWorkflowActor`, `TWorkflowIssue` ; hooks `useWorkflowActor(workspaceSlug, projectId)`, `useAllowedStateIds(workspaceSlug, projectId, issue)`, `useProjectWorkflowScheme(projectId)`.

- [ ] **Step 1: Pin `@xyflow/react`**

Run: `pnpm view @xyflow/react time --json` and pick the most recent 12.x version published more than 30 days before today (Global Constraints). Add it to the `catalog:` of `pnpm-workspace.yaml` in alphabetical order, exact version (no `^`), for example `"@xyflow/react": 12.x.y`, then add `"@xyflow/react": "catalog:"` to the `dependencies` of `apps/web/package.json` and run `pnpm install`.
Expected: `pnpm-lock.yaml` gains `@xyflow/react` and its dependencies; `pnpm install` ends without a peer dependency error for React 19.

- [ ] **Step 2: Write the types and fetch keys**

Create `packages/types/src/workflow.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TStateGroups } from "./state";

export type TWorkflowStatus = {
  id: string;
  name: string;
  color: string;
  group: TStateGroups;
  group_is_auto: boolean;
  sequence?: number;
  workflow_count?: number;
};

export type TWorkflowRestrictActorsParams = {
  roles?: number[];
  user_ids?: string[];
  assignee?: true;
  creator?: true;
};

export type TWorkflowRule = { type: "restrict_actors"; params: TWorkflowRestrictActorsParams };

export type TWorkflowState = {
  id: string;
  status: TWorkflowStatus;
  position_x: number;
  position_y: number;
  is_initial: boolean;
};

export type TWorkflowTransition = {
  id: string;
  name: string;
  from_any: boolean;
  source_ids: string[];
  target_id: string;
  rules: TWorkflowRule[];
};

export type TWorkflowProjectRef = { id: string; name: string };

export type TWorkflowGraph = {
  id: string;
  name: string;
  description: string;
  updated_at: string | null;
  states: TWorkflowState[];
  transitions: TWorkflowTransition[];
};

export type TWorkflowDetail = TWorkflowGraph & { project_count: number; projects?: TWorkflowProjectRef[] };

export type TWorkflowSummary = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  state_count: number;
  project_count: number;
  projects?: TWorkflowProjectRef[];
};

export type TWorkflowFormData = { name: string; description?: string };

export type TWorkflowGraphPayloadState = {
  key: string;
  status: { id?: string; name: string; color: string; group?: TStateGroups | null };
  position_x: number;
  position_y: number;
  is_initial: boolean;
};

export type TWorkflowGraphPayloadTransition = {
  name: string;
  from_any: boolean;
  source_keys: string[];
  target_key: string;
  rules: TWorkflowRule[];
};

export type TWorkflowGraphPayload = {
  states: TWorkflowGraphPayloadState[];
  transitions: TWorkflowGraphPayloadTransition[];
};

export type TProjectWorkflowSchemeItem = { issue_type_id: string; workflow_id: string };

export type TProjectWorkflowScheme = {
  default_workflow_id: string | null;
  items: TProjectWorkflowSchemeItem[];
  workflows: TWorkflowGraph[];
};

export type TWorkflowMapping = { state_id: string; workflow_id: string; status_id: string };

export type TProjectWorkflowSchemePayload = {
  default_workflow_id: string;
  items: TProjectWorkflowSchemeItem[];
  mappings?: TWorkflowMapping[];
};

export type TWorkflowMappingNeed = {
  state_id: string;
  state_name: string;
  workflow_id: string;
  issue_count: number;
  auto_status_id: string | null;
};

export type TWorkflowStatusUsage = { project_id: string; project_name: string; issue_count: number };
```

In `packages/types/src/index.ts`, after the `work-item-type` export: `export * from "./workflow";`. In `packages/types/src/state.ts`, add to `IState`: `workflow_status?: string | null;`.

In `packages/constants/src/fetch-keys.ts`, after `PROJECT_WORK_ITEM_TYPES`:

```ts
export const WORKSPACE_WORKFLOWS = (workspaceSlug: string) => `WORKSPACE_WORKFLOWS_${workspaceSlug.toUpperCase()}`;
export const WORKSPACE_WORKFLOW_STATUSES = (workspaceSlug: string) =>
  `WORKSPACE_WORKFLOW_STATUSES_${workspaceSlug.toUpperCase()}`;
export const WORKFLOW_DETAIL = (workflowId: string) => `WORKFLOW_DETAIL_${workflowId.toUpperCase()}`;
export const PROJECT_WORKFLOW_SCHEME = (projectId: string) => `PROJECT_WORKFLOW_SCHEME_${projectId.toUpperCase()}`;
```

- [ ] **Step 3: Write the failing tests**

Create `apps/web/components/workflow/helpers.test.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { IState, TProjectWorkflowScheme, TWorkflowGraph, TWorkflowRule } from "@plane/types";
import {
  getAllowedTargetStateIds,
  getInitialStateId,
  getWorkflowRefusalKey,
  getWorkflowStateIds,
  type TWorkflowIssue,
} from "./helpers";

const status = (id: string) => ({ id, name: id, color: "#3A3A3A", group: "started" as const, group_is_auto: true });
const node = (id: string, isInitial = false) => ({
  id: `n-${id}`,
  status: status(id),
  position_x: 0,
  position_y: 0,
  is_initial: isInitial,
});
const arrow = (sources: string[] | "*", target: string, rules: TWorkflowRule[] = []) => ({
  id: `t-${target}-${sources}`,
  name: "",
  from_any: sources === "*",
  source_ids: sources === "*" ? [] : sources.map((source) => `n-${source}`),
  target_id: `n-${target}`,
  rules,
});
const projectState = (statusId: string | null, id = `s-${statusId}`): IState => ({
  id,
  color: "#3A3A3A",
  default: false,
  description: "",
  group: "started",
  name: statusId ?? id,
  project_id: "p",
  sequence: 0,
  workspace_id: "w",
  order: 0,
  workflow_status: statusId,
});

const software: TWorkflowGraph = {
  id: "software",
  name: "Software",
  description: "",
  updated_at: null,
  states: [node("todo", true), node("doing"), node("done"), node("cancelled")],
  transitions: [
    arrow(["todo"], "doing"),
    arrow(["doing"], "done", [{ type: "restrict_actors", params: { roles: [20], creator: true } }]),
    arrow("*", "cancelled"),
  ],
};
const support: TWorkflowGraph = {
  id: "support",
  name: "Support",
  description: "",
  updated_at: null,
  states: [node("new", true), node("doing")],
  transitions: [arrow(["new"], "doing")],
};
const scheme: TProjectWorkflowScheme = {
  default_workflow_id: "software",
  items: [{ issue_type_id: "bug", workflow_id: "support" }],
  workflows: [software, support],
};
const states = ["todo", "doing", "done", "cancelled", "new"].map((id) => projectState(id));
const issue = (stateStatus: string, overrides: Partial<TWorkflowIssue> = {}): TWorkflowIssue => ({
  state_id: `s-${stateStatus}`,
  type_id: "task",
  assignee_ids: [],
  created_by: "someone",
  ...overrides,
});
const member = { userId: "me", projectRole: 15 };

describe("getAllowedTargetStateIds", () => {
  it("returns null for a free project", () => {
    expect(
      getAllowedTargetStateIds({
        scheme: { default_workflow_id: null, items: [], workflows: [] },
        projectStates: states,
        issue: issue("todo"),
        actor: member,
      })
    ).toBeNull();
  });

  it("keeps the current state and adds arrow targets and global targets", () => {
    const allowed = getAllowedTargetStateIds({ scheme, projectStates: states, issue: issue("todo"), actor: member });
    expect([...(allowed ?? [])].sort()).toEqual(["s-cancelled", "s-doing", "s-todo"]);
  });

  it("applies restrict actors with OR between criteria", () => {
    const asMember = getAllowedTargetStateIds({ scheme, projectStates: states, issue: issue("doing"), actor: member });
    const asCreator = getAllowedTargetStateIds({
      scheme,
      projectStates: states,
      issue: issue("doing", { created_by: "me" }),
      actor: member,
    });
    const asAdmin = getAllowedTargetStateIds({
      scheme,
      projectStates: states,
      issue: issue("doing"),
      actor: { userId: "me", projectRole: 20 },
    });
    expect(asMember?.has("s-done")).toBe(false);
    expect(asCreator?.has("s-done")).toBe(true);
    expect(asAdmin?.has("s-done")).toBe(true);
  });

  it("uses the workflow of the item type", () => {
    const allowed = getAllowedTargetStateIds({
      scheme,
      projectStates: states,
      issue: issue("new", { type_id: "bug" }),
      actor: member,
    });
    expect([...(allowed ?? [])].sort()).toEqual(["s-doing", "s-new"]);
  });

  it("offers only global transitions from an unmanaged state", () => {
    const stray = projectState(null, "s-stray");
    const allowed = getAllowedTargetStateIds({
      scheme,
      projectStates: [...states, stray],
      issue: issue("x", { state_id: "s-stray" }),
      actor: member,
    });
    expect([...(allowed ?? [])].sort()).toEqual(["s-cancelled", "s-stray"]);
  });

  it("refuses rules without a known actor", () => {
    const allowed = getAllowedTargetStateIds({
      scheme,
      projectStates: states,
      issue: issue("doing", { created_by: "me" }),
      actor: { userId: undefined, projectRole: undefined },
    });
    expect(allowed?.has("s-done")).toBe(false);
  });
});

describe("initial and workflow states", () => {
  it("returns the initial state of the type workflow", () => {
    expect(getInitialStateId(scheme, states, "task")).toBe("s-todo");
    expect(getInitialStateId(scheme, states, "bug")).toBe("s-new");
    expect(getInitialStateId({ default_workflow_id: null, items: [], workflows: [] }, states, "task")).toBeUndefined();
  });

  it("lists the states of the type workflow", () => {
    expect([...(getWorkflowStateIds(scheme, states, "bug") ?? [])].sort()).toEqual(["s-doing", "s-new"]);
  });
});

describe("getWorkflowRefusalKey", () => {
  it("maps the two server codes and ignores anything else", () => {
    expect(getWorkflowRefusalKey({ workflow: ["transition_not_allowed"] })).toBe("workflows.workflow_disabled.title");
    expect(getWorkflowRefusalKey({ workflow: ["arrival_state_required"] })).toBe(
      "workflows.refusal.arrival_state_required"
    );
    expect(getWorkflowRefusalKey({ workflow: ["<script>"] })).toBeUndefined();
    expect(getWorkflowRefusalKey({ detail: "x" })).toBeUndefined();
    expect(getWorkflowRefusalKey(undefined)).toBeUndefined();
  });
});
```

Create `apps/web/store/workspace/workflow.store.test.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TProjectWorkflowScheme, TWorkflowDetail, TWorkflowSummary } from "@plane/types";
import type { WorkflowService } from "@/services/workflow.service";
import { WorkflowStore } from "./workflow.store";

const summary = (id: string, name: string): TWorkflowSummary => ({
  id,
  name,
  description: "",
  created_at: "2026-11-12T00:00:00Z",
  updated_at: "2026-11-12T00:00:00Z",
  state_count: 0,
  project_count: 0,
});
const detail = (id: string, name: string): TWorkflowDetail => ({
  id,
  name,
  description: "",
  updated_at: null,
  states: [],
  transitions: [],
  project_count: 1,
  projects: [{ id: "p", name: "Secret" }],
});

const buildStore = (overrides: object = {}) =>
  new WorkflowStore({
    list: async () => [summary("b", "Beta"), summary("a", "Alpha")],
    listStatuses: async () => [],
    saveGraph: async (_slug: string, id: string) => detail(id, "Saved"),
    getProjectScheme: async (): Promise<TProjectWorkflowScheme> => ({
      default_workflow_id: "a",
      items: [],
      workflows: [{ ...detail("a", "Alpha"), project_count: undefined, projects: undefined }],
    }),
    ...overrides,
  } as unknown as WorkflowService);

describe("WorkflowStore", () => {
  it("keeps workflows per workspace, sorted by name", async () => {
    const store = buildStore();
    await store.fetchWorkflows("acme");
    expect(store.getWorkspaceWorkflows("acme").map((workflow) => workflow.name)).toEqual(["Alpha", "Beta"]);
    expect(store.getWorkspaceWorkflows("other")).toEqual([]);
  });

  it("refreshes cached project schemes after a graph save", async () => {
    const store = buildStore();
    await store.fetchProjectScheme("acme", "project");
    await store.saveGraph("acme", "a", { states: [], transitions: [] });
    const cached = store.getProjectScheme("project");
    expect(cached?.workflows[0].name).toBe("Saved");
    expect(cached?.workflows[0]).not.toHaveProperty("projects");
    expect(store.getWorkflowDetail("a")?.name).toBe("Saved");
  });

  it("propagates service errors", async () => {
    const store = buildStore({
      saveGraph: async () => {
        throw { graph: ["status_in_use"] };
      },
    });
    await expect(store.saveGraph("acme", "a", { states: [], transitions: [] })).rejects.toEqual({
      graph: ["status_in_use"],
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run components/workflow/helpers.test.ts store/workspace/workflow.store.test.ts`
Expected: FAIL: `Failed to resolve import "./helpers"` and `"./workflow.store"`.

- [ ] **Step 5: Write the service, the store and the hook**

Create `apps/web/services/workflow.service.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TProjectWorkflowScheme,
  TProjectWorkflowSchemePayload,
  TWorkflowDetail,
  TWorkflowFormData,
  TWorkflowGraphPayload,
  TWorkflowMappingNeed,
  TWorkflowStatus,
  TWorkflowSummary,
} from "@plane/types";
import { APIService } from "@/services/api.service";

export class WorkflowService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  // Every method rethrows the response body: callers map error codes, never raw server text.
  private request<T>(promise: Promise<{ data: T }>): Promise<T> {
    return promise
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  list(workspaceSlug: string): Promise<TWorkflowSummary[]> {
    return this.request(this.get(`/api/workspaces/${workspaceSlug}/workflows/`));
  }

  retrieve(workspaceSlug: string, workflowId: string): Promise<TWorkflowDetail> {
    return this.request(this.get(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/`));
  }

  create(workspaceSlug: string, data: TWorkflowFormData): Promise<TWorkflowDetail> {
    return this.request(this.post(`/api/workspaces/${workspaceSlug}/workflows/`, data));
  }

  update(workspaceSlug: string, workflowId: string, data: Partial<TWorkflowFormData>): Promise<TWorkflowDetail> {
    return this.request(this.patch(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/`, data));
  }

  remove(workspaceSlug: string, workflowId: string): Promise<void> {
    return this.request(this.delete(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/`));
  }

  saveGraph(workspaceSlug: string, workflowId: string, payload: TWorkflowGraphPayload): Promise<TWorkflowDetail> {
    return this.request(this.put(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/graph/`, payload));
  }

  listStatuses(workspaceSlug: string): Promise<TWorkflowStatus[]> {
    return this.request(this.get(`/api/workspaces/${workspaceSlug}/workflow-statuses/`));
  }

  removeStatus(workspaceSlug: string, statusId: string): Promise<void> {
    return this.request(this.delete(`/api/workspaces/${workspaceSlug}/workflow-statuses/${statusId}/`));
  }

  getProjectScheme(workspaceSlug: string, projectId: string): Promise<TProjectWorkflowScheme> {
    return this.request(this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/workflow-scheme/`));
  }

  previewProjectScheme(
    workspaceSlug: string,
    projectId: string,
    payload: TProjectWorkflowSchemePayload
  ): Promise<{ needs: TWorkflowMappingNeed[] }> {
    return this.request(
      this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/workflow-scheme/preview/`, payload)
    );
  }

  applyProjectScheme(
    workspaceSlug: string,
    projectId: string,
    payload: TProjectWorkflowSchemePayload
  ): Promise<TProjectWorkflowScheme> {
    return this.request(this.put(`/api/workspaces/${workspaceSlug}/projects/${projectId}/workflow-scheme/`, payload));
  }

  detachProjectScheme(workspaceSlug: string, projectId: string): Promise<void> {
    return this.request(this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/workflow-scheme/`));
  }
}
```

Create `apps/web/store/workspace/workflow.store.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type {
  TProjectWorkflowScheme,
  TProjectWorkflowSchemePayload,
  TWorkflowDetail,
  TWorkflowFormData,
  TWorkflowGraph,
  TWorkflowGraphPayload,
  TWorkflowMappingNeed,
  TWorkflowStatus,
  TWorkflowSummary,
} from "@plane/types";
import { WorkflowService } from "@/services/workflow.service";

export interface IWorkflowStore {
  workflowsMap: Record<string, Record<string, TWorkflowSummary>>;
  detailsMap: Record<string, TWorkflowDetail>;
  statusesMap: Record<string, TWorkflowStatus[]>;
  schemesMap: Record<string, TProjectWorkflowScheme>;
  getWorkspaceWorkflows: (workspaceSlug: string) => TWorkflowSummary[];
  getWorkflowDetail: (workflowId: string) => TWorkflowDetail | undefined;
  getWorkspaceStatuses: (workspaceSlug: string) => TWorkflowStatus[];
  getProjectScheme: (projectId: string) => TProjectWorkflowScheme | undefined;
  fetchWorkflows: (workspaceSlug: string) => Promise<TWorkflowSummary[]>;
  fetchWorkflowDetail: (workspaceSlug: string, workflowId: string) => Promise<TWorkflowDetail>;
  fetchStatuses: (workspaceSlug: string) => Promise<TWorkflowStatus[]>;
  createWorkflow: (workspaceSlug: string, data: TWorkflowFormData) => Promise<TWorkflowDetail>;
  updateWorkflow: (
    workspaceSlug: string,
    workflowId: string,
    data: Partial<TWorkflowFormData>
  ) => Promise<TWorkflowDetail>;
  removeWorkflow: (workspaceSlug: string, workflowId: string) => Promise<void>;
  saveGraph: (workspaceSlug: string, workflowId: string, payload: TWorkflowGraphPayload) => Promise<TWorkflowDetail>;
  removeStatus: (workspaceSlug: string, statusId: string) => Promise<void>;
  fetchProjectScheme: (workspaceSlug: string, projectId: string) => Promise<TProjectWorkflowScheme>;
  previewProjectScheme: (
    workspaceSlug: string,
    projectId: string,
    payload: TProjectWorkflowSchemePayload
  ) => Promise<TWorkflowMappingNeed[]>;
  applyProjectScheme: (
    workspaceSlug: string,
    projectId: string,
    payload: TProjectWorkflowSchemePayload
  ) => Promise<TProjectWorkflowScheme>;
  detachProjectScheme: (workspaceSlug: string, projectId: string) => Promise<void>;
}

const toGraph = ({ id, name, description, updated_at, states, transitions }: TWorkflowDetail): TWorkflowGraph => ({
  id,
  name,
  description,
  updated_at,
  states,
  transitions,
});

export class WorkflowStore implements IWorkflowStore {
  // Keyed by workspace slug so a workspace switch or a late response never mixes workspaces.
  workflowsMap: Record<string, Record<string, TWorkflowSummary>> = {};
  detailsMap: Record<string, TWorkflowDetail> = {};
  statusesMap: Record<string, TWorkflowStatus[]> = {};
  schemesMap: Record<string, TProjectWorkflowScheme> = {};
  private service: WorkflowService;

  constructor(service: WorkflowService = new WorkflowService()) {
    makeObservable(this, {
      workflowsMap: observable,
      detailsMap: observable,
      statusesMap: observable,
      schemesMap: observable,
      fetchWorkflows: action,
      fetchWorkflowDetail: action,
      fetchStatuses: action,
      createWorkflow: action,
      updateWorkflow: action,
      removeWorkflow: action,
      saveGraph: action,
      removeStatus: action,
      fetchProjectScheme: action,
      applyProjectScheme: action,
      detachProjectScheme: action,
    });
    this.service = service;
  }

  getWorkspaceWorkflows = computedFn((workspaceSlug: string) =>
    Object.values(this.workflowsMap[workspaceSlug] ?? {}).sort((a, b) => a.name.localeCompare(b.name))
  );

  getWorkflowDetail = computedFn((workflowId: string) => this.detailsMap[workflowId]);

  getWorkspaceStatuses = computedFn((workspaceSlug: string) => this.statusesMap[workspaceSlug] ?? []);

  getProjectScheme = computedFn((projectId: string) => this.schemesMap[projectId]);

  fetchWorkflows = async (workspaceSlug: string) => {
    const workflows = await this.service.list(workspaceSlug);
    runInAction(() => {
      this.workflowsMap[workspaceSlug] = Object.fromEntries(workflows.map((workflow) => [workflow.id, workflow]));
    });
    return workflows;
  };

  fetchWorkflowDetail = async (workspaceSlug: string, workflowId: string) => {
    const workflow = await this.service.retrieve(workspaceSlug, workflowId);
    runInAction(() => {
      this.detailsMap[workflowId] = workflow;
    });
    return workflow;
  };

  fetchStatuses = async (workspaceSlug: string) => {
    const statuses = await this.service.listStatuses(workspaceSlug);
    runInAction(() => {
      this.statusesMap[workspaceSlug] = statuses;
    });
    return statuses;
  };

  createWorkflow = async (workspaceSlug: string, data: TWorkflowFormData) => {
    const workflow = await this.service.create(workspaceSlug, data);
    runInAction(() => {
      this.detailsMap[workflow.id] = workflow;
    });
    await this.fetchWorkflows(workspaceSlug).catch(() => undefined);
    return workflow;
  };

  updateWorkflow = async (workspaceSlug: string, workflowId: string, data: Partial<TWorkflowFormData>) => {
    const workflow = await this.service.update(workspaceSlug, workflowId, data);
    runInAction(() => {
      this.detailsMap[workflowId] = workflow;
    });
    await this.fetchWorkflows(workspaceSlug).catch(() => undefined);
    return workflow;
  };

  removeWorkflow = async (workspaceSlug: string, workflowId: string) => {
    await this.service.remove(workspaceSlug, workflowId);
    runInAction(() => {
      delete this.workflowsMap[workspaceSlug]?.[workflowId];
      delete this.detailsMap[workflowId];
    });
  };

  saveGraph = async (workspaceSlug: string, workflowId: string, payload: TWorkflowGraphPayload) => {
    const workflow = await this.service.saveGraph(workspaceSlug, workflowId, payload);
    runInAction(() => {
      this.detailsMap[workflowId] = workflow;
      // Linked projects read the graph from their cached scheme (P10): keep it current.
      for (const scheme of Object.values(this.schemesMap)) {
        scheme.workflows = scheme.workflows.map((graph) => (graph.id === workflowId ? toGraph(workflow) : graph));
      }
    });
    // Counts and shared statuses changed too.
    await Promise.allSettled([this.fetchWorkflows(workspaceSlug), this.fetchStatuses(workspaceSlug)]);
    return workflow;
  };

  removeStatus = async (workspaceSlug: string, statusId: string) => {
    await this.service.removeStatus(workspaceSlug, statusId);
    runInAction(() => {
      this.statusesMap[workspaceSlug] = (this.statusesMap[workspaceSlug] ?? []).filter((item) => item.id !== statusId);
    });
  };

  fetchProjectScheme = async (workspaceSlug: string, projectId: string) => {
    const scheme = await this.service.getProjectScheme(workspaceSlug, projectId);
    runInAction(() => {
      this.schemesMap[projectId] = scheme;
    });
    return scheme;
  };

  previewProjectScheme = async (workspaceSlug: string, projectId: string, payload: TProjectWorkflowSchemePayload) =>
    (await this.service.previewProjectScheme(workspaceSlug, projectId, payload)).needs;

  applyProjectScheme = async (workspaceSlug: string, projectId: string, payload: TProjectWorkflowSchemePayload) => {
    const scheme = await this.service.applyProjectScheme(workspaceSlug, projectId, payload);
    runInAction(() => {
      this.schemesMap[projectId] = scheme;
    });
    return scheme;
  };

  detachProjectScheme = async (workspaceSlug: string, projectId: string) => {
    await this.service.detachProjectScheme(workspaceSlug, projectId);
    runInAction(() => {
      this.schemesMap[projectId] = { default_workflow_id: null, items: [], workflows: [] };
    });
  };
}
```

In `apps/web/store/workspace/index.ts`, mirror `workItemType`: import `IWorkflowStore` and `WorkflowStore`, add `workflow: IWorkflowStore;` to `IWorkspaceRootStore` and `this.workflow = new WorkflowStore();` in the constructor.

Create `apps/web/hooks/store/use-workflow.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useContext } from "react";
import { StoreContext } from "@/lib/store-context";
import type { IWorkflowStore } from "@/store/workspace/workflow.store";

export const useWorkflow = (): IWorkflowStore => {
  const context = useContext(StoreContext);
  if (context === undefined) throw new Error("useWorkflow must be used within StoreProvider");
  return context.workspaceRoot.workflow;
};
```

- [ ] **Step 6: Write the pure helpers and their hooks**

Create `apps/web/components/workflow/helpers.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IState, TIssue, TProjectWorkflowScheme, TWorkflowGraph, TWorkflowRule } from "@plane/types";

export type TWorkflowActor = { userId: string | undefined; projectRole: number | undefined };
export type TWorkflowIssue = Pick<TIssue, "state_id" | "type_id" | "assignee_ids" | "created_by">;

// The server answers one of these codes, never free text (spec 4.5).
export const WORKFLOW_REFUSAL_KEYS = {
  transition_not_allowed: "workflows.workflow_disabled.title",
  arrival_state_required: "workflows.refusal.arrival_state_required",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const getIssueWorkflow = (
  scheme: TProjectWorkflowScheme | undefined,
  typeId: string | null | undefined
): TWorkflowGraph | undefined => {
  if (!scheme?.default_workflow_id) return undefined;
  const workflowId =
    scheme.items.find((item) => item.issue_type_id === typeId)?.workflow_id ?? scheme.default_workflow_id;
  return scheme.workflows.find((workflow) => workflow.id === workflowId);
};

const stateIdsByStatus = (projectStates: IState[]) =>
  new Map(
    projectStates.flatMap((state) => (state.workflow_status ? [[state.workflow_status, state.id] as const] : []))
  );

// Mirrors the server rule (W6): any one criterion admits the actor, workspace admins are not exempt.
const ruleAllows = (rule: TWorkflowRule, issue: TWorkflowIssue, actor: TWorkflowActor) => {
  if (rule.type !== "restrict_actors" || !actor.userId) return false;
  const { roles = [], user_ids = [], assignee, creator } = rule.params;
  return (
    user_ids.includes(actor.userId) ||
    (creator === true && issue.created_by === actor.userId) ||
    (assignee === true && issue.assignee_ids.includes(actor.userId)) ||
    (actor.projectRole !== undefined && roles.includes(actor.projectRole))
  );
};

/** Spec 7.4: states the actor may move the item to, plus its current state; null for a free project. */
export const getAllowedTargetStateIds = ({
  scheme,
  projectStates,
  issue,
  actor,
}: {
  scheme: TProjectWorkflowScheme | undefined;
  projectStates: IState[];
  issue: TWorkflowIssue;
  actor: TWorkflowActor;
}): Set<string> | null => {
  if (!scheme?.default_workflow_id) return null;
  const allowed = new Set<string>(issue.state_id ? [issue.state_id] : []);
  const workflow = getIssueWorkflow(scheme, issue.type_id);
  if (!workflow) return allowed;
  const byStatus = stateIdsByStatus(projectStates);
  const currentStatus = projectStates.find((state) => state.id === issue.state_id)?.workflow_status;
  const currentNode = workflow.states.find((node) => node.status.id === currentStatus);
  for (const transition of workflow.transitions) {
    // Unmanaged and triage states only have global exits (P5).
    const fromHere = transition.from_any || (!!currentNode && transition.source_ids.includes(currentNode.id));
    if (!fromHere || !transition.rules.every((rule) => ruleAllows(rule, issue, actor))) continue;
    const target = workflow.states.find((node) => node.id === transition.target_id);
    const stateId = target && byStatus.get(target.status.id);
    if (stateId) allowed.add(stateId);
  }
  return allowed;
};

export const getInitialStateId = (
  scheme: TProjectWorkflowScheme | undefined,
  projectStates: IState[],
  typeId: string | null | undefined
): string | undefined => {
  const initial = getIssueWorkflow(scheme, typeId)?.states.find((node) => node.is_initial);
  return initial ? stateIdsByStatus(projectStates).get(initial.status.id) : undefined;
};

/** W9: every state of the type's workflow can receive an item changing type; null for a free project. */
export const getWorkflowStateIds = (
  scheme: TProjectWorkflowScheme | undefined,
  projectStates: IState[],
  typeId: string | null | undefined
): Set<string> | null => {
  const workflow = getIssueWorkflow(scheme, typeId);
  if (!workflow) return null;
  const byStatus = stateIdsByStatus(projectStates);
  return new Set(workflow.states.flatMap((node) => byStatus.get(node.status.id) ?? []));
};

export const getWorkflowRefusalKey = (error: unknown): string | undefined => {
  if (!isRecord(error) || !Array.isArray(error.workflow)) return undefined;
  const code = error.workflow[0];
  return typeof code === "string" && code in WORKFLOW_REFUSAL_KEYS
    ? WORKFLOW_REFUSAL_KEYS[code as keyof typeof WORKFLOW_REFUSAL_KEYS]
    : undefined;
};
```

Create `apps/web/components/workflow/use-allowed-states.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useWorkflow } from "@/hooks/store/use-workflow";
// local imports
import { getAllowedTargetStateIds, type TWorkflowActor, type TWorkflowIssue } from "./helpers";

export const useProjectWorkflowScheme = (projectId: string | undefined) => {
  const { getProjectScheme } = useWorkflow();
  return projectId ? getProjectScheme(projectId) : undefined;
};

export const useWorkflowActor = (workspaceSlug: string | undefined, projectId: string | undefined): TWorkflowActor => {
  const { data: currentUser } = useUser();
  const { getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();
  return {
    userId: currentUser?.id,
    projectRole:
      workspaceSlug && projectId ? getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId) : undefined,
  };
};

/** States offered to the actor for this item (7.4); null when the project is free or the item unknown. */
export const useAllowedStateIds = (
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  issue: TWorkflowIssue | undefined
): Set<string> | null => {
  const scheme = useProjectWorkflowScheme(projectId);
  const { getProjectStates } = useProjectState();
  const actor = useWorkflowActor(workspaceSlug, projectId);
  if (!issue || !projectId) return null;
  return getAllowedTargetStateIds({ scheme, projectStates: getProjectStates(projectId) ?? [], issue, actor });
};
```

Append to `apps/web/components/workflow/index.ts`:

```ts
export * from "./helpers";
export * from "./use-allowed-states";
```

In `apps/web/layouts/auth-layout/project-wrapper.tsx`, next to the `PROJECT_WORK_ITEM_TYPES` fetch:

```ts
// fetching the project workflow scheme (graphs included, P10)
useSWR(PROJECT_WORKFLOW_SCHEME(projectId), () => fetchProjectScheme(workspaceSlug, projectId), {
  revalidateIfStale: false,
  revalidateOnFocus: false,
});
```

with `const { fetchProjectScheme } = useWorkflow();` and the `PROJECT_WORKFLOW_SCHEME` import from `@plane/constants`.

- [ ] **Step 7: Run tests to verify they pass, then the checks**

Run: `pnpm --filter web exec vitest run components/workflow/helpers.test.ts store/workspace/workflow.store.test.ts`
Expected: 9 + 3 passed.
Run: `pnpm turbo run check:types --filter=web --filter=@plane/types --filter=@plane/constants`
Expected: no error.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml apps/web/package.json packages/types/src/workflow.ts packages/types/src/index.ts packages/types/src/state.ts packages/constants/src/fetch-keys.ts apps/web/services/workflow.service.ts apps/web/store/workspace/workflow.store.ts apps/web/store/workspace/workflow.store.test.ts apps/web/store/workspace/index.ts apps/web/hooks/store/use-workflow.ts apps/web/components/workflow/helpers.ts apps/web/components/workflow/helpers.test.ts apps/web/components/workflow/use-allowed-states.ts apps/web/components/workflow/index.ts apps/web/layouts/auth-layout/project-wrapper.tsx
git commit -m "feat(web): add workflow store, service and reachable state logic"
```

---

### Task 12: Textes en et fr, puis les 20 autres locales (W15)

**Files:**

- Modify: `packages/i18n/src/locales/en/workflow.json`, `packages/i18n/src/locales/fr/workflow.json`
- Modify: `packages/i18n/src/locales/<20 autres>/workflow.json`

**Interfaces:**

- Produces: les clés `workflows.*` utilisées par les Tasks 13 à 18 (liste exhaustive ci-dessous). Les clés EE déjà présentes sous `workflows` (`workflow_states`, `workflow_disabled`, `workflow_enabled`, `workflow_tree`, `empty_state`, `quick_actions`, `confirmation_modals`, `toasts`) restent ; seule `workflows.workflow_disabled.title` est réutilisée.

- [ ] **Step 1: Add the English keys**

Merge into the `workflows` object of `packages/i18n/src/locales/en/workflow.json` (keep the existing keys):

```json
{
  "label": "Workflows",
  "groups": {
    "backlog": "Backlog",
    "unstarted": "Not started",
    "started": "In progress",
    "completed": "Done",
    "cancelled": "Cancelled"
  },
  "roles": { "admin": "Admin", "member": "Member", "guest": "Guest" },
  "settings": {
    "description": "A workflow lists the states of work items and the transitions allowed between them. Each project chooses a workflow per work item type.",
    "create": "Create workflow",
    "empty": "No workflow yet.",
    "load_error": "Workflows could not be loaded.",
    "columns": { "name": "Name", "states": "States", "projects": "Projects" },
    "state_count": "{count, plural, one {# state} other {# states}}",
    "project_count": "{count, plural, one {# project} other {# projects}}",
    "open": "Open",
    "delete": {
      "action": "Delete",
      "title": "Delete this workflow?",
      "description": "The workflow and its diagram are deleted. Its statuses stay available to other workflows.",
      "in_use": "Projects still use this workflow."
    },
    "form": {
      "create_title": "Create a workflow",
      "name": "Name",
      "description": "Description",
      "duplicate": "A workflow with this name already exists.",
      "submit": "Create",
      "cancel": "Cancel"
    },
    "error": "The workflow could not be saved. Try again."
  },
  "editor": {
    "back": "Back to workflows",
    "save": "Save",
    "discard": "Discard changes",
    "saved": "Workflow saved.",
    "unsaved": "Unsaved changes",
    "read_only": "Only workspace admins can change workflows.",
    "start": "START",
    "global": "From any state",
    "diagram_label": "Workflow diagram",
    "add_state": {
      "title": "Add a state",
      "existing": "Existing status",
      "new": "New status",
      "name": "Name",
      "color": "Color",
      "group": "Category",
      "group_auto": "Automatic",
      "submit": "Add state"
    },
    "add_transition": {
      "title": "Add a transition",
      "sources": "From",
      "any_state": "Any state",
      "target": "To",
      "name": "Name (optional)",
      "submit": "Add transition"
    },
    "panel": {
      "close": "Close",
      "state": "State",
      "transition": "Transition",
      "set_initial": "Make it the initial state",
      "initial": "Initial state",
      "shared": "{count, plural, one {Shared with # other workflow: changes apply there too.} other {Shared with # other workflows: changes apply there too.}}",
      "remove_state": "Remove state",
      "remove_transition": "Remove transition"
    },
    "restrict": {
      "title": "Restrict who can move",
      "description": "Without restriction, anyone who can edit the work item can use this transition.",
      "roles": "Roles",
      "users": "People",
      "assignee": "Assignee of the work item",
      "creator": "Creator of the work item",
      "clear": "Remove restriction"
    },
    "errors": {
      "initial_state_required": "Choose exactly one initial state.",
      "duplicate_state_key": "A state appears twice. Reload the page.",
      "duplicate_status": "A status appears twice in this workflow.",
      "duplicate_status_name": "Two states have the same name, or a status with this name already exists: pick it from the existing statuses.",
      "invalid_transition": "A transition is incomplete.",
      "reserved_status_name": "The name \"Triage\" is reserved for the intake.",
      "invalid_rule": "A restriction is incomplete.",
      "invalid_status": "A status no longer exists. Reload the page.",
      "status_changed": "A state changed status. Reload the page.",
      "status_limit": "The workspace has reached 1,000 statuses.",
      "status_in_use": "These states still hold work items, move them first:",
      "status_in_use_project": "{project}: {count, plural, one {# work item} other {# work items}}",
      "default": "The workflow could not be saved."
    }
  },
  "scheme": {
    "description": "Choose the workflow each work item type follows in this project.",
    "free": "This project does not use workflows: any state change is allowed.",
    "default_workflow": "Default workflow",
    "per_type": "Workflow for {type}",
    "same_as_default": "Same as the default workflow",
    "choose": "Choose a workflow",
    "next": "Continue",
    "back": "Back",
    "apply": "Apply",
    "detach": "Stop using workflows",
    "detach_confirm": "The states stay, become editable again, and any state change is allowed again.",
    "mapping": {
      "title": "Move work items",
      "description": "These states hold work items but are not part of the chosen workflow. Choose where the work items go.",
      "row": "{state} in {workflow}: {count, plural, one {# work item} other {# work items}}",
      "pick": "Arrival state",
      "none": "Nothing to move."
    },
    "applied": "The project now follows its workflows.",
    "detached": "The project no longer uses workflows.",
    "errors": {
      "invalid_scheme": "A workflow or a type is no longer valid. Reload the page.",
      "mapping_incomplete": "Choose an arrival state for every line.",
      "invalid_mapping": "An arrival state is not part of its workflow.",
      "default": "The change could not be applied."
    }
  },
  "refusal": {
    "arrival_state_required": "Choose the state this work item enters in its new workflow."
  },
  "managed_states": {
    "banner": "These states come from the project workflows. Change them in Workspace settings, Workflows."
  },
  "type_change": {
    "title": "Choose the arrival state",
    "description": "The current state is not part of the workflow of this type.",
    "submit": "Change type",
    "cancel": "Cancel"
  },
  "creation": {
    "initial_state": "New work items start in this state."
  }
}
```

- [ ] **Step 2: Add the French keys**

Merge into the `workflows` object of `packages/i18n/src/locales/fr/workflow.json`:

```json
{
  "label": "Workflows",
  "groups": {
    "backlog": "Backlog",
    "unstarted": "Non commencé",
    "started": "En cours",
    "completed": "Terminé",
    "cancelled": "Annulé"
  },
  "roles": { "admin": "Admin", "member": "Membre", "guest": "Invité" },
  "settings": {
    "description": "Un workflow liste les états des tickets et les passages autorisés entre eux. Chaque projet choisit un workflow par type de ticket.",
    "create": "Créer un workflow",
    "empty": "Aucun workflow pour l’instant.",
    "load_error": "Impossible de charger les workflows.",
    "columns": { "name": "Nom", "states": "États", "projects": "Projets" },
    "state_count": "{count, plural, one {# état} other {# états}}",
    "project_count": "{count, plural, one {# projet} other {# projets}}",
    "open": "Ouvrir",
    "delete": {
      "action": "Supprimer",
      "title": "Supprimer ce workflow ?",
      "description": "Le workflow et son diagramme sont supprimés. Ses statuts restent disponibles pour les autres workflows.",
      "in_use": "Des projets utilisent encore ce workflow."
    },
    "form": {
      "create_title": "Créer un workflow",
      "name": "Nom",
      "description": "Description",
      "duplicate": "Un workflow porte déjà ce nom.",
      "submit": "Créer",
      "cancel": "Annuler"
    },
    "error": "Impossible d’enregistrer le workflow. Réessayez."
  },
  "editor": {
    "back": "Retour aux workflows",
    "save": "Enregistrer",
    "discard": "Annuler les changements",
    "saved": "Workflow enregistré.",
    "unsaved": "Modifications non enregistrées",
    "read_only": "Seuls les admins de l’espace de travail peuvent modifier les workflows.",
    "start": "DÉBUT",
    "global": "Depuis n’importe quel état",
    "diagram_label": "Diagramme du workflow",
    "add_state": {
      "title": "Ajouter un état",
      "existing": "Statut existant",
      "new": "Nouveau statut",
      "name": "Nom",
      "color": "Couleur",
      "group": "Catégorie",
      "group_auto": "Automatique",
      "submit": "Ajouter l’état"
    },
    "add_transition": {
      "title": "Ajouter une transition",
      "sources": "Depuis",
      "any_state": "N’importe quel état",
      "target": "Vers",
      "name": "Nom (facultatif)",
      "submit": "Ajouter la transition"
    },
    "panel": {
      "close": "Fermer",
      "state": "État",
      "transition": "Transition",
      "set_initial": "En faire l’état initial",
      "initial": "État initial",
      "shared": "{count, plural, one {Partagé avec # autre workflow : les changements s’y appliquent aussi.} other {Partagé avec # autres workflows : les changements s’y appliquent aussi.}}",
      "remove_state": "Retirer l’état",
      "remove_transition": "Retirer la transition"
    },
    "restrict": {
      "title": "Limiter qui peut passer",
      "description": "Sans limite, toute personne qui peut modifier le ticket peut utiliser cette transition.",
      "roles": "Rôles",
      "users": "Personnes",
      "assignee": "Responsable du ticket",
      "creator": "Créateur du ticket",
      "clear": "Retirer la limite"
    },
    "errors": {
      "initial_state_required": "Choisissez exactement un état initial.",
      "duplicate_state_key": "Un état apparaît deux fois. Rechargez la page.",
      "duplicate_status": "Un statut apparaît deux fois dans ce workflow.",
      "duplicate_status_name": "Deux états portent le même nom, ou un statut de ce nom existe déjà : choisissez-le parmi les statuts existants.",
      "invalid_transition": "Une transition est incomplète.",
      "reserved_status_name": "Le nom « Triage » est réservé à l’intake.",
      "invalid_rule": "Une limite est incomplète.",
      "invalid_status": "Un statut n’existe plus. Rechargez la page.",
      "status_changed": "Un état a changé de statut. Rechargez la page.",
      "status_limit": "L’espace de travail a atteint 1 000 statuts.",
      "status_in_use": "Ces états contiennent encore des tickets, déplacez-les d’abord :",
      "status_in_use_project": "{project} : {count, plural, one {# ticket} other {# tickets}}",
      "default": "Impossible d’enregistrer le workflow."
    }
  },
  "scheme": {
    "description": "Choisissez le workflow que suit chaque type de ticket dans ce projet.",
    "free": "Ce projet n’utilise pas de workflow : tout changement d’état est permis.",
    "default_workflow": "Workflow par défaut",
    "per_type": "Workflow pour {type}",
    "same_as_default": "Comme le workflow par défaut",
    "choose": "Choisir un workflow",
    "next": "Continuer",
    "back": "Retour",
    "apply": "Appliquer",
    "detach": "Ne plus utiliser de workflow",
    "detach_confirm": "Les états restent, redeviennent modifiables, et tout changement d’état est de nouveau permis.",
    "mapping": {
      "title": "Déplacer les tickets",
      "description": "Ces états contiennent des tickets mais ne font pas partie du workflow choisi. Choisissez où vont les tickets.",
      "row": "{state} dans {workflow} : {count, plural, one {# ticket} other {# tickets}}",
      "pick": "État d’arrivée",
      "none": "Rien à déplacer."
    },
    "applied": "Le projet suit maintenant ses workflows.",
    "detached": "Le projet n’utilise plus de workflow.",
    "errors": {
      "invalid_scheme": "Un workflow ou un type n’est plus valide. Rechargez la page.",
      "mapping_incomplete": "Choisissez un état d’arrivée pour chaque ligne.",
      "invalid_mapping": "Un état d’arrivée ne fait pas partie de son workflow.",
      "default": "Impossible d’appliquer le changement."
    }
  },
  "refusal": {
    "arrival_state_required": "Choisissez l’état dans lequel ce ticket entre dans son nouveau workflow."
  },
  "managed_states": {
    "banner": "Ces états viennent des workflows du projet. Modifiez-les dans Paramètres de l’espace de travail, Workflows."
  },
  "type_change": {
    "title": "Choisir l’état d’arrivée",
    "description": "L’état actuel ne fait pas partie du workflow de ce type.",
    "submit": "Changer de type",
    "cancel": "Annuler"
  },
  "creation": {
    "initial_state": "Les nouveaux tickets commencent dans cet état."
  }
}
```

- [ ] **Step 3: Translate the 20 other locales**

Invoke the `translate` skill on `packages/i18n/src/locales/en/workflow.json` for the new keys only (every locale except `en` and `fr`). Keep the ICU plurals and placeholders (`{count}`, `{project}`, `{state}`, `{workflow}`, `{type}`) intact; "Workflow" stays untranslated where the existing locale files already keep it.

- [ ] **Step 4: Check the keys**

Run: `pnpm --filter=@plane/i18n sync:check`
Expected: every locale has the same keys as `en`.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/locales
git commit -m "feat(i18n): add workflow editor, scheme and refusal strings"
```

---

### Task 13: Onglet « Workflows » des paramètres du workspace : liste, création, suppression (spec 7.1, A2)

**Files:**

- Modify: `packages/types/src/settings.ts` (`TWorkspaceSettingsTabs` reçoit `"workflows"`)
- Modify: `packages/constants/src/settings/workspace.ts` (entrée `workflows`, groupe `FEATURES`)
- Modify: `apps/web/components/settings/workspace/sidebar/item-icon.tsx`
- Modify: `apps/web/app/routes/core.ts`
- Create: `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/page.tsx`, `.../workflows/header.tsx`
- Create: `apps/web/components/workflow/settings/workflow-create-modal.tsx`, `apps/web/components/workflow/settings/workflow-list.tsx`

**Interfaces:**

- Consumes: `useWorkflow()` (Task 11), clés `workflows.*` (Task 12), `WORKSPACE_WORKFLOWS`.
- Produces: la route `/:workspaceSlug/settings/workflows` ; le lien de chaque ligne mène à `/:workspaceSlug/settings/workflows/:workflowId` (page créée par la Task 15).

- [ ] **Step 1: Register the tab**

In `packages/types/src/settings.ts`, add `| "workflows"` to `TWorkspaceSettingsTabs`. In `packages/constants/src/settings/workspace.ts`, after the `"work-item-types"` entry:

```ts
  workflows: {
    key: "workflows",
    i18n_label: "workflows.label",
    href: `/settings/workflows`,
    access: [EUserWorkspaceRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname.startsWith(`${baseUrl}/settings/workflows/`),
  },
```

and add `WORKSPACE_SETTINGS.workflows` after `WORKSPACE_SETTINGS["work-item-types"]` in the `FEATURES` group. In `apps/web/components/settings/workspace/sidebar/item-icon.tsx`, import `WorkflowsOutline` from `@makeplane/propel/icons` and add `workflows: WorkflowsOutline,`. In `apps/web/app/routes/core.ts`, after the `work-item-types` workspace route, inside the same layout:

```ts
          route(
            ":workspaceSlug/settings/workflows",
            "./(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/page.tsx"
          ),
```

- [ ] **Step 2: Write the create modal**

Create `apps/web/components/workflow/settings/workflow-create-modal.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
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
import { TextAreaField } from "@makeplane/propel/components/text-area-field";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowDetail, TWorkflowFormData } from "@plane/types";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";

type Props = {
  workspaceSlug: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (workflow: TWorkflowDetail) => void;
};

const EMPTY: TWorkflowFormData = { name: "", description: "" };

export const WorkflowCreateModal = observer(function WorkflowCreateModal(props: Props) {
  const { workspaceSlug, isOpen, onClose, onCreated } = props;
  const { t } = useTranslation();
  const { createWorkflow } = useWorkflow();
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TWorkflowFormData>({ defaultValues: EMPTY });

  useEffect(() => {
    if (isOpen) reset(EMPTY);
  }, [isOpen, reset]);

  const onSubmit = async (data: TWorkflowFormData) => {
    try {
      const workflow = await createWorkflow(workspaceSlug, {
        name: data.name.trim(),
        description: data.description?.trim(),
      });
      onCreated(workflow);
    } catch (error) {
      // Only the field array of a name conflict is mapped; server text is never shown.
      if (typeof error === "object" && error !== null && Array.isArray((error as { name?: unknown }).name)) {
        setError("name", { message: t("workflows.settings.form.duplicate") });
        return;
      }
      setToast({ type: "error", title: t("common.error.label"), message: t("workflows.settings.error") });
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t("workflows.settings.form.create_title")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-5">
                <Controller
                  control={control}
                  name="name"
                  rules={{ validate: (value) => (value.trim().length > 0 && value.trim().length <= 255) || " " }}
                  render={({ field: { value, onChange, ref } }) => (
                    <InputField
                      size="lg"
                      orientation="vertical"
                      id="workflow-name"
                      name="name"
                      type="text"
                      required
                      label={t("workflows.settings.form.name")}
                      value={value}
                      onChange={onChange}
                      ref={ref}
                      error={errors.name?.message?.trim() || undefined}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="description"
                  render={({ field: { value, onChange } }) => (
                    <TextAreaField
                      size="lg"
                      resize="none"
                      autoResize
                      maxRows={6}
                      id="workflow-description"
                      name="description"
                      label={t("workflows.settings.form.description")}
                      value={value ?? ""}
                      onChange={onChange}
                    />
                  )}
                />
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              onClick={onClose}
              label={t("workflows.settings.form.cancel")}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              loading={isSubmitting}
              label={t("workflows.settings.form.submit")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
});
```

- [ ] **Step 3: Write the list**

Create `apps/web/components/workflow/settings/workflow-list.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowSummary } from "@plane/types";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";

type RowProps = { workspaceSlug: string; workflow: TWorkflowSummary };

const WorkflowRow = observer(function WorkflowRow({ workspaceSlug, workflow }: RowProps) {
  const { t } = useTranslation();
  const { removeWorkflow } = useWorkflow();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const inUse = workflow.project_count > 0;
  const deleteReasonId = `workflow-delete-reason-${workflow.id}`;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await removeWorkflow(workspaceSlug, workflow.id);
      setIsDeleteOpen(false);
    } catch {
      setToast({ type: "error", title: t("common.error.label"), message: t("workflows.settings.error") });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <li className="flex items-center gap-4 border-b border-subtle px-2 py-3">
      <div className="min-w-0 flex-1">
        <Link
          href={`/${workspaceSlug}/settings/workflows/${workflow.id}`}
          className="text-body-sm-medium text-primary hover:underline"
        >
          {workflow.name}
        </Link>
        {workflow.projects && workflow.projects.length > 0 && (
          <p className="truncate text-caption-sm-regular text-tertiary">
            {workflow.projects.map((project) => project.name).join(", ")}
          </p>
        )}
      </div>
      <span className="w-24 text-body-xs-regular text-secondary">
        {t("workflows.settings.state_count", { count: workflow.state_count })}
      </span>
      <span className="w-24 text-body-xs-regular text-secondary">
        {t("workflows.settings.project_count", { count: workflow.project_count })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        stretch="auto"
        label={t("workflows.settings.delete.action")}
        disabled={inUse}
        aria-describedby={inUse ? deleteReasonId : undefined}
        onClick={() => setIsDeleteOpen(true)}
      />
      {inUse && (
        <span id={deleteReasonId} className="sr-only">
          {t("workflows.settings.delete.in_use")}
        </span>
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
    </li>
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

  if (workflows.length === 0)
    return <p className="text-body-sm-regular text-tertiary">{t("workflows.settings.empty")}</p>;
  return (
    <ul aria-label={t("workflows.label")}>
      {workflows.map((workflow) => (
        <WorkflowRow key={workflow.id} workspaceSlug={workspaceSlug} workflow={workflow} />
      ))}
    </ul>
  );
});
```

- [ ] **Step 4: Write the page and its header**

Create `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/header.tsx` as a copy of the delivery 1 header `.../work-item-types/header.tsx`, with the component renamed `WorkflowsWorkspaceSettingsHeader` and the key `"workflows"` in `WORKSPACE_SETTINGS["workflows"]` and `WORKSPACE_SETTINGS_ICONS["workflows"]`.

Create `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/page.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { EUserPermissions, EUserPermissionsLevel, WORKSPACE_WORKFLOWS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@makeplane/propel/components/button";
import { Loader } from "@plane/blocks/skeleton";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { WorkflowCreateModal } from "@/components/workflow/settings/workflow-create-modal";
import { WorkspaceWorkflowList } from "@/components/workflow/settings/workflow-list";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { WorkflowsWorkspaceSettingsHeader } from "./header";

function WorkflowsSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const router = useAppRouter();
  const { t } = useTranslation();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const { currentWorkspace } = useWorkspace();
  const { fetchWorkflows, getWorkspaceWorkflows } = useWorkflow();
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const { isLoading, error } = useSWR(
    isWorkspaceAdmin ? WORKSPACE_WORKFLOWS(workspaceSlug) : null,
    isWorkspaceAdmin ? () => fetchWorkflows(workspaceSlug) : null
  );
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - ${t("workflows.label")}` : undefined;
  const loader = (
    <Loader className="space-y-3">
      <Loader.Item height="56px" />
      <Loader.Item height="56px" />
    </Loader>
  );

  // Until the role is known, show neither the list nor the create button.
  if (!workspaceUserInfo)
    return <SettingsContentWrapper header={<WorkflowsWorkspaceSettingsHeader />}>{loader}</SettingsContentWrapper>;
  if (!isWorkspaceAdmin) return <NotAuthorizedView section="settings" className="h-auto" />;

  return (
    <SettingsContentWrapper header={<WorkflowsWorkspaceSettingsHeader />}>
      <PageHead title={pageTitle} />
      <WorkflowCreateModal
        workspaceSlug={workspaceSlug}
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(workflow) => {
          setIsCreateOpen(false);
          router.push(`/${workspaceSlug}/settings/workflows/${workflow.id}`);
        }}
      />
      <SettingsHeading
        title={t("workflows.label")}
        description={t("workflows.settings.description")}
        control={
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            label={t("workflows.settings.create")}
            onClick={() => setIsCreateOpen(true)}
          />
        }
      />
      <div className="mt-4">
        {error ? (
          <p role="alert" className="text-body-sm-regular text-danger-primary">
            {t("workflows.settings.load_error")}
          </p>
        ) : isLoading && getWorkspaceWorkflows(workspaceSlug).length === 0 ? (
          loader
        ) : (
          <WorkspaceWorkflowList workspaceSlug={workspaceSlug} />
        )}
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(WorkflowsSettingsPage);
```

- [ ] **Step 5: Check**

Run: `pnpm turbo run check:types --filter=web --filter=@plane/types --filter=@plane/constants && pnpm --filter web exec oxlint components/workflow app`
Expected: no error, no new warning.
Then, with the local stack running on this branch (`.claude/launch.json` configuration of the worktree, API container rebuilt with the migration), open `/<workspace>/settings/workflows` as a workspace admin: the tab appears under Features, a workflow can be created (redirect to its editor URL, which answers 404 until Task 15) and deleted; as a member, the tab is absent and the URL shows "not authorized".

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/settings.ts packages/constants/src/settings/workspace.ts apps/web/components/settings/workspace/sidebar/item-icon.tsx apps/web/app/routes/core.ts "apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows" apps/web/components/workflow/settings
git commit -m "feat(web): add the workspace workflows settings tab"
```

---

### Task 14: Brouillon du graphe de l'éditeur, logique pure (spec 7.2, W5, W7, P1)

**Files:**

- Create: `apps/web/components/workflow/editor/graph-model.ts`
- Test: `apps/web/components/workflow/editor/graph-model.test.ts`

**Interfaces:**

- Consumes: types `TWorkflowDetail`, `TWorkflowStatus`, `TWorkflowGraphPayload`, `TWorkflowRule`, `TWorkflowRestrictActorsParams`, `TStateGroups` (Task 11).
- Produces (`@/components/workflow/editor/graph-model`) :
  - types `TDraftStatus = { id?: string; name: string; color: string; group: TStateGroups | null; shared_count: number }`, `TDraftState = { key; status: TDraftStatus; position_x; position_y; is_initial }`, `TDraftTransition = { key; name; from_any; source_keys: string[]; target_key; rules: TWorkflowRule[] }`, `TDraftGraph = { states: TDraftState[]; transitions: TDraftTransition[] }` ;
  - `fromDetail(detail, statuses) -> TDraftGraph`, `toPayload(draft) -> TWorkflowGraphPayload`, `isDraftDirty(draft, saved) -> boolean` ;
  - `addState(draft, key, status) -> TDraftGraph`, `removeState(draft, key)`, `setInitial(draft, key)`, `updateStatus(draft, key, patch)`, `moveState(draft, key, x, y)` ;
  - `addTransition(draft, transition)`, `updateTransition(draft, key, patch)`, `removeTransition(draft, key)`, `setRestriction(draft, transitionKey, params | null)` ;
  - `validateDraft(draft) -> string[]` (codes identiques à ceux du serveur, Task 4) ;
  - `getGraphErrorKey(error) -> { key: string; projects: TWorkflowStatusUsage[] }`.
    Toutes les fonctions rendent un nouveau brouillon sans modifier l'ancien.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/workflow/editor/graph-model.test.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TWorkflowDetail } from "@plane/types";
import {
  addState,
  addTransition,
  fromDetail,
  getGraphErrorKey,
  isDraftDirty,
  removeState,
  setInitial,
  setRestriction,
  toPayload,
  updateStatus,
  validateDraft,
  type TDraftGraph,
} from "./graph-model";

const detail: TWorkflowDetail = {
  id: "w",
  name: "Flow",
  description: "",
  updated_at: null,
  project_count: 0,
  states: [
    {
      id: "a",
      status: { id: "sa", name: "Open", color: "#111111", group: "unstarted", group_is_auto: true },
      position_x: 0,
      position_y: 0,
      is_initial: true,
    },
    {
      id: "b",
      status: { id: "sb", name: "Done", color: "#222222", group: "cancelled", group_is_auto: false },
      position_x: 240,
      position_y: 0,
      is_initial: false,
    },
  ],
  transitions: [{ id: "t", name: "Finish", from_any: false, source_ids: ["a"], target_id: "b", rules: [] }],
};
const statuses = [
  { id: "sa", name: "Open", color: "#111111", group: "unstarted" as const, group_is_auto: true, workflow_count: 2 },
  { id: "sb", name: "Done", color: "#222222", group: "cancelled" as const, group_is_auto: false, workflow_count: 1 },
];
const newStatus = { name: "Review", color: "#333333", group: null, shared_count: 0 };

describe("graph model", () => {
  it("round-trips the server graph and keeps auto groups automatic", () => {
    const draft = fromDetail(detail, statuses);
    expect(draft.states[0].status).toEqual({ id: "sa", name: "Open", color: "#111111", group: null, shared_count: 1 });
    expect(draft.states[1].status.group).toBe("cancelled");
    expect(toPayload(draft)).toEqual({
      states: [
        {
          key: "a",
          status: { id: "sa", name: "Open", color: "#111111", group: null },
          position_x: 0,
          position_y: 0,
          is_initial: true,
        },
        {
          key: "b",
          status: { id: "sb", name: "Done", color: "#222222", group: "cancelled" },
          position_x: 240,
          position_y: 0,
          is_initial: false,
        },
      ],
      transitions: [{ name: "Finish", from_any: false, source_keys: ["a"], target_key: "b", rules: [] }],
    });
  });

  it("makes the first state initial and keeps exactly one initial", () => {
    const first = addState({ states: [], transitions: [] }, "n1", newStatus);
    expect(first.states[0].is_initial).toBe(true);
    const second = setInitial(addState(first, "n2", { ...newStatus, name: "Other" }), "n2");
    expect(second.states.filter((state) => state.is_initial).map((state) => state.key)).toEqual(["n2"]);
  });

  it("removing a state drops its arrows and hands the initial flag over", () => {
    let draft: TDraftGraph = fromDetail(detail, statuses);
    draft = addTransition(draft, { key: "g", name: "", from_any: true, source_keys: [], target_key: "a", rules: [] });
    const without = removeState(draft, "a");
    expect(without.states.map((state) => state.key)).toEqual(["b"]);
    expect(without.states[0].is_initial).toBe(true);
    expect(without.transitions).toEqual([]);
  });

  it("does not mutate the previous draft", () => {
    const draft = fromDetail(detail, statuses);
    const renamed = updateStatus(draft, "a", { name: "Ready" });
    expect(draft.states[0].status.name).toBe("Open");
    expect(renamed.states[0].status.name).toBe("Ready");
    expect(isDraftDirty(renamed, draft)).toBe(true);
    expect(isDraftDirty(fromDetail(detail, statuses), draft)).toBe(false);
  });

  it("sets and clears a restriction", () => {
    const draft = fromDetail(detail, statuses);
    const restricted = setRestriction(draft, "t", { roles: [20], creator: true });
    expect(restricted.transitions[0].rules).toEqual([
      { type: "restrict_actors", params: { roles: [20], creator: true } },
    ]);
    expect(setRestriction(restricted, "t", null).transitions[0].rules).toEqual([]);
  });

  it("validates like the server", () => {
    const draft = fromDetail(detail, statuses);
    expect(validateDraft(draft)).toEqual([]);
    expect(validateDraft(updateStatus(draft, "b", { name: "open" }))).toContain("duplicate_status_name");
    expect(validateDraft(updateStatus(draft, "b", { name: "Triage" }))).toContain("reserved_status_name");
    expect(
      validateDraft(
        addTransition(draft, { key: "x", name: "", from_any: false, source_keys: [], target_key: "b", rules: [] })
      )
    ).toContain("invalid_transition");
    expect(validateDraft(setRestriction(draft, "t", {}))).toContain("invalid_rule");
    expect(
      validateDraft({ ...draft, states: draft.states.map((state) => ({ ...state, is_initial: false })) })
    ).toContain("initial_state_required");
  });

  it("maps server errors to i18n keys", () => {
    const usage = [{ project_id: "p", project_name: "Home", issue_count: 2 }];
    expect(getGraphErrorKey({ graph: ["status_in_use"], projects: usage })).toEqual({
      key: "workflows.editor.errors.status_in_use",
      projects: usage,
    });
    expect(getGraphErrorKey({ graph: ["<b>"] })).toEqual({ key: "workflows.editor.errors.default", projects: [] });
    expect(getGraphErrorKey(undefined).key).toBe("workflows.editor.errors.default");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run components/workflow/editor/graph-model.test.ts`
Expected: FAIL: `Failed to resolve import "./graph-model"`.

- [ ] **Step 3: Write the model**

Create `apps/web/components/workflow/editor/graph-model.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type {
  TStateGroups,
  TWorkflowDetail,
  TWorkflowGraphPayload,
  TWorkflowRestrictActorsParams,
  TWorkflowRule,
  TWorkflowStatus,
  TWorkflowStatusUsage,
} from "@plane/types";

/** group null: the server deduces it (W5). shared_count: other workflows using the status (W17). */
export type TDraftStatus = {
  id?: string;
  name: string;
  color: string;
  group: TStateGroups | null;
  shared_count: number;
};
export type TDraftState = {
  key: string;
  status: TDraftStatus;
  position_x: number;
  position_y: number;
  is_initial: boolean;
};
export type TDraftTransition = {
  key: string;
  name: string;
  from_any: boolean;
  source_keys: string[];
  target_key: string;
  rules: TWorkflowRule[];
};
export type TDraftGraph = { states: TDraftState[]; transitions: TDraftTransition[] };

const RESERVED_STATUS_NAMES = new Set(["triage"]);
const GRAPH_ERROR_CODES = new Set([
  "initial_state_required",
  "duplicate_state_key",
  "duplicate_status",
  "duplicate_status_name",
  "invalid_transition",
  "reserved_status_name",
  "invalid_rule",
  "invalid_status",
  "status_changed",
  "status_limit",
  "status_in_use",
]);

export const fromDetail = (detail: TWorkflowDetail, statuses: TWorkflowStatus[]): TDraftGraph => ({
  states: detail.states.map((state) => {
    const usage = statuses.find((status) => status.id === state.status.id)?.workflow_count ?? 1;
    return {
      key: state.id,
      status: {
        id: state.status.id,
        name: state.status.name,
        color: state.status.color,
        group: state.status.group_is_auto ? null : state.status.group,
        shared_count: Math.max(usage - 1, 0),
      },
      position_x: state.position_x,
      position_y: state.position_y,
      is_initial: state.is_initial,
    };
  }),
  transitions: detail.transitions.map((transition) => ({
    key: transition.id,
    name: transition.name,
    from_any: transition.from_any,
    source_keys: [...transition.source_ids],
    target_key: transition.target_id,
    rules: transition.rules,
  })),
});

export const toPayload = (draft: TDraftGraph): TWorkflowGraphPayload => ({
  states: draft.states.map((state) => ({
    key: state.key,
    status: {
      ...(state.status.id ? { id: state.status.id } : {}),
      name: state.status.name.trim(),
      color: state.status.color,
      group: state.status.group,
    },
    position_x: state.position_x,
    position_y: state.position_y,
    is_initial: state.is_initial,
  })),
  transitions: draft.transitions.map((transition) => ({
    name: transition.name.trim(),
    from_any: transition.from_any,
    source_keys: transition.from_any ? [] : transition.source_keys,
    target_key: transition.target_key,
    rules: transition.rules,
  })),
});

export const isDraftDirty = (draft: TDraftGraph, saved: TDraftGraph) =>
  JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(saved));

export const addState = (draft: TDraftGraph, key: string, status: TDraftStatus): TDraftGraph => {
  const index = draft.states.length;
  return {
    ...draft,
    states: [
      ...draft.states,
      // A new box lands on a 4-column grid; the admin can drag it afterwards.
      { key, status, position_x: (index % 4) * 240, position_y: Math.floor(index / 4) * 160, is_initial: index === 0 },
    ],
  };
};

export const setInitial = (draft: TDraftGraph, key: string): TDraftGraph => ({
  ...draft,
  states: draft.states.map((state) => ({ ...state, is_initial: state.key === key })),
});

export const removeState = (draft: TDraftGraph, key: string): TDraftGraph => {
  const removed = draft.states.find((state) => state.key === key);
  let states = draft.states.filter((state) => state.key !== key);
  if (removed?.is_initial && states.length > 0)
    states = states.map((state, index) => ({ ...state, is_initial: index === 0 }));
  const transitions = draft.transitions
    .filter((transition) => transition.target_key !== key)
    .map((transition) => ({ ...transition, source_keys: transition.source_keys.filter((source) => source !== key) }))
    .filter((transition) => transition.from_any || transition.source_keys.length > 0);
  return { states, transitions };
};

export const updateStatus = (draft: TDraftGraph, key: string, patch: Partial<TDraftStatus>): TDraftGraph => ({
  ...draft,
  states: draft.states.map((state) =>
    state.key === key ? { ...state, status: { ...state.status, ...patch } } : state
  ),
});

export const moveState = (draft: TDraftGraph, key: string, x: number, y: number): TDraftGraph => ({
  ...draft,
  states: draft.states.map((state) => (state.key === key ? { ...state, position_x: x, position_y: y } : state)),
});

export const addTransition = (draft: TDraftGraph, transition: TDraftTransition): TDraftGraph => ({
  ...draft,
  transitions: [...draft.transitions, transition],
});

export const updateTransition = (draft: TDraftGraph, key: string, patch: Partial<TDraftTransition>): TDraftGraph => ({
  ...draft,
  transitions: draft.transitions.map((transition) =>
    transition.key === key ? { ...transition, ...patch } : transition
  ),
});

export const removeTransition = (draft: TDraftGraph, key: string): TDraftGraph => ({
  ...draft,
  transitions: draft.transitions.filter((transition) => transition.key !== key),
});

export const setRestriction = (
  draft: TDraftGraph,
  transitionKey: string,
  params: TWorkflowRestrictActorsParams | null
): TDraftGraph =>
  updateTransition(draft, transitionKey, { rules: params ? [{ type: "restrict_actors", params }] : [] });

const isRuleComplete = ({ params }: TWorkflowRule) =>
  (params.roles?.length ?? 0) > 0 ||
  (params.user_ids?.length ?? 0) > 0 ||
  params.assignee === true ||
  params.creator === true;

/** Same checks as the server (Task 4), so the admin sees them before saving. */
export const validateDraft = (draft: TDraftGraph): string[] => {
  const errors = new Set<string>();
  const keys = new Set(draft.states.map((state) => state.key));
  const names = draft.states.map((state) => state.status.name.trim().toLowerCase());
  if (names.some((name) => RESERVED_STATUS_NAMES.has(name))) errors.add("reserved_status_name");
  if (new Set(names).size !== names.length) errors.add("duplicate_status_name");
  const ids = draft.states.flatMap((state) => (state.status.id ? [state.status.id] : []));
  if (new Set(ids).size !== ids.length) errors.add("duplicate_status");
  if (draft.states.length > 0 && draft.states.filter((state) => state.is_initial).length !== 1)
    errors.add("initial_state_required");
  for (const transition of draft.transitions) {
    const sources = transition.from_any ? [] : transition.source_keys;
    if (
      !keys.has(transition.target_key) ||
      sources.some((source) => !keys.has(source) || source === transition.target_key) ||
      (!transition.from_any && sources.length === 0)
    )
      errors.add("invalid_transition");
    if (!transition.rules.every(isRuleComplete)) errors.add("invalid_rule");
  }
  return [...errors];
};

export const getGraphErrorKey = (error: unknown): { key: string; projects: TWorkflowStatusUsage[] } => {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const code = Array.isArray(record.graph) ? record.graph[0] : undefined;
  const projects = Array.isArray(record.projects) ? (record.projects as TWorkflowStatusUsage[]) : [];
  if (typeof code === "string" && GRAPH_ERROR_CODES.has(code))
    return { key: `workflows.editor.errors.${code}`, projects };
  return { key: "workflows.editor.errors.default", projects: [] };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run components/workflow/editor/graph-model.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workflow/editor/graph-model.ts apps/web/components/workflow/editor/graph-model.test.ts
git commit -m "feat(web): model workflow graph drafts for the editor"
```

---

### Task 15: Éditeur de workflow : diagramme, formulaires clavier, panneau latéral (spec 7.2, 7.5, W13, W17, P11)

**Files:**

- Create: `apps/web/components/workflow/editor/state-node.tsx`
- Create: `apps/web/components/workflow/editor/workflow-canvas.tsx`
- Create: `apps/web/components/workflow/editor/add-state-form.tsx`
- Create: `apps/web/components/workflow/editor/add-transition-form.tsx`
- Create: `apps/web/components/workflow/editor/restrict-actors-form.tsx`
- Create: `apps/web/components/workflow/editor/side-panel.tsx`
- Create: `apps/web/components/workflow/editor/workflow-editor.tsx`
- Create: `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/[workflowId]/page.tsx`
- Modify: `apps/web/app/routes/core.ts`

**Interfaces:**

- Consumes: `graph-model` (Task 14), `useWorkflow()` (Task 11), `useMember().workspace` (`workspaceMemberIds`, `getWorkspaceMemberDetails(id)?.member` avec `id`, `display_name` ; la liste est déjà chargée par `workspace-wrapper.tsx`), clés `workflows.editor.*`, `workflows.groups.*`, `workflows.roles.*`.
- Produces: la route `/:workspaceSlug/settings/workflows/:workflowId`. Le contrôle d'accès de la mise en page des paramètres du workspace s'appuie sur les deux premiers segments (`/settings/workflows`), donc cette page est réservée aux admins comme la liste ; l'éditeur garde un mode lecture seule (`readOnly`) pour un non-admin, en défense en profondeur.

- [ ] **Step 1: Write the diagram**

Create `apps/web/components/workflow/editor/state-node.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export type TStateNodeData = {
  name: string;
  color: string;
  groupLabel: string;
  isInitial: boolean;
  startLabel: string;
  globalLabel: string | undefined;
};
export type TStateNode = Node<TStateNodeData, "workflowState">;

export function WorkflowStateNode({ data, selected }: NodeProps<TStateNode>) {
  return (
    <div
      className={`min-w-40 rounded-md border-2 bg-layer-1 px-3 py-2 ${selected ? "ring-2 ring-accent-strong" : ""}`}
      style={{ borderColor: data.color }}
    >
      <Handle type="target" position={Position.Top} />
      {data.isInitial && (
        <span className="mb-1 inline-block rounded-sm bg-accent-primary px-1 text-caption-sm-medium text-on-color">
          {data.startLabel}
        </span>
      )}
      <div className="text-body-sm-medium text-primary">{data.name}</div>
      <div className="text-caption-sm-regular text-tertiary">{data.groupLabel}</div>
      {data.globalLabel && (
        <div className="mt-1 text-caption-sm-regular text-secondary" title={data.globalLabel}>
          {data.globalLabel}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

Create `apps/web/components/workflow/editor/workflow-canvas.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { applyNodeChanges, Background, Controls, MarkerType, ReactFlow, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslation } from "@plane/i18n";
// local imports
import type { TDraftGraph } from "./graph-model";
import { WorkflowStateNode, type TStateNode } from "./state-node";

export type TEditorSelection = { kind: "state" | "transition"; key: string } | null;

type Props = {
  draft: TDraftGraph;
  readOnly: boolean;
  selection: TEditorSelection;
  onSelect: (selection: TEditorSelection) => void;
  onMove: (key: string, x: number, y: number) => void;
  onConnect: (sourceKey: string, targetKey: string) => void;
};

// Stable reference: React Flow warns and re-mounts nodes when nodeTypes changes.
const NODE_TYPES = { workflowState: WorkflowStateNode };

export function WorkflowCanvas({ draft, readOnly, selection, onSelect, onMove, onConnect }: Props) {
  const { t } = useTranslation();

  const derivedNodes = useMemo<TStateNode[]>(
    () =>
      draft.states.map((state) => {
        const globals = draft.transitions.filter(
          (transition) => transition.from_any && transition.target_key === state.key
        );
        const group = state.status.group;
        return {
          id: state.key,
          type: "workflowState",
          position: { x: state.position_x, y: state.position_y },
          selected: selection?.kind === "state" && selection.key === state.key,
          draggable: !readOnly,
          connectable: !readOnly,
          data: {
            name: state.status.name,
            color: state.status.color,
            groupLabel: group ? t(`workflows.groups.${group}`) : t("workflows.editor.add_state.group_auto"),
            isInitial: state.is_initial,
            startLabel: t("workflows.editor.start"),
            globalLabel: globals.length > 0 ? t("workflows.editor.global") : undefined,
          },
        };
      }),
    [draft, readOnly, selection, t]
  );
  // React Flow moves a dragged node through onNodesChange; the draft only learns the final position on drop.
  const [nodes, setNodes] = useState<TStateNode[]>(derivedNodes);
  useEffect(() => setNodes(derivedNodes), [derivedNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      draft.transitions.flatMap((transition) =>
        transition.from_any
          ? []
          : transition.source_keys.map((source) => ({
              id: `${transition.key}:${source}`,
              source,
              target: transition.target_key,
              label: transition.name || undefined,
              markerEnd: { type: MarkerType.ArrowClosed },
              selected: selection?.kind === "transition" && selection.key === transition.key,
              data: { transitionKey: transition.key },
            }))
      ),
    [draft, selection]
  );

  return (
    <div className="h-[560px] w-full rounded-md border border-subtle" aria-label={t("workflows.editor.diagram_label")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
        fitView
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        onNodeClick={(_, node) => onSelect({ kind: "state", key: node.id })}
        onEdgeClick={(_, edge) => onSelect({ kind: "transition", key: String(edge.data?.transitionKey) })}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_, node) => onMove(node.id, node.position.x, node.position.y)}
        onConnect={(connection) => {
          if (connection.source && connection.target && connection.source !== connection.target)
            onConnect(connection.source, connection.target);
        }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Write the keyboard forms and the side panel**

Create `apps/web/components/workflow/editor/add-state-form.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups, TWorkflowStatus } from "@plane/types";
// local imports
import type { TDraftStatus } from "./graph-model";

const GROUPS: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

type Props = {
  availableStatuses: TWorkflowStatus[];
  onAdd: (status: TDraftStatus) => void;
};

export function AddStateForm({ availableStatuses, onAdd }: Props) {
  const { t } = useTranslation();
  const [existingId, setExistingId] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3A3A3A");
  const [group, setGroup] = useState<TStateGroups | "">("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const existing = availableStatuses.find((status) => status.id === existingId);
    if (existing) {
      onAdd({
        id: existing.id,
        name: existing.name,
        color: existing.color,
        group: existing.group_is_auto ? null : existing.group,
        shared_count: existing.workflow_count ?? 0,
      });
      setExistingId("");
      return;
    }
    if (!name.trim()) return;
    onAdd({ name: name.trim(), color, group: group || null, shared_count: 0 });
    setName("");
    setGroup("");
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby="workflow-add-state-title">
      <h3 id="workflow-add-state-title" className="text-body-sm-medium text-primary">
        {t("workflows.editor.add_state.title")}
      </h3>
      <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
        {t("workflows.editor.add_state.existing")}
        <select
          className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
          value={existingId}
          onChange={(event) => setExistingId(event.target.value)}
        >
          <option value="">{t("workflows.editor.add_state.new")}</option>
          {availableStatuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </label>
      {!existingId && (
        <>
          <InputField
            size="md"
            orientation="vertical"
            id="workflow-new-status-name"
            name="name"
            type="text"
            label={t("workflows.editor.add_state.name")}
            value={name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
          />
          <label className="flex items-center gap-2 text-body-xs-medium text-secondary">
            {t("workflows.editor.add_state.color")}
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
            {t("workflows.editor.add_state.group")}
            <select
              className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
              value={group}
              onChange={(event) => setGroup(event.target.value as TStateGroups | "")}
            >
              <option value="">{t("workflows.editor.add_state.group_auto")}</option>
              {GROUPS.map((item) => (
                <option key={item} value={item}>
                  {t(`workflows.groups.${item}`)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <Button
        variant="secondary"
        size="sm"
        stretch="auto"
        type="submit"
        label={t("workflows.editor.add_state.submit")}
      />
    </form>
  );
}
```

Create `apps/web/components/workflow/editor/add-transition-form.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
// local imports
import type { TDraftGraph, TDraftTransition } from "./graph-model";

type Props = { draft: TDraftGraph; onAdd: (transition: Omit<TDraftTransition, "key">) => void };

export function AddTransitionForm({ draft, onAdd }: Props) {
  const { t } = useTranslation();
  const [fromAny, setFromAny] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");

  const toggleSource = (key: string) =>
    setSources((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!target || (!fromAny && sources.length === 0)) return;
    onAdd({
      name,
      from_any: fromAny,
      source_keys: fromAny ? [] : sources.filter((key) => key !== target),
      target_key: target,
      rules: [],
    });
    setSources([]);
    setTarget("");
    setName("");
    setFromAny(false);
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby="workflow-add-transition-title">
      <h3 id="workflow-add-transition-title" className="text-body-sm-medium text-primary">
        {t("workflows.editor.add_transition.title")}
      </h3>
      <fieldset className="space-y-1">
        <legend className="text-body-xs-medium text-secondary">{t("workflows.editor.add_transition.sources")}</legend>
        <label className="flex items-center gap-2 text-body-xs-regular">
          <input type="checkbox" checked={fromAny} onChange={(event) => setFromAny(event.target.checked)} />
          {t("workflows.editor.add_transition.any_state")}
        </label>
        {!fromAny &&
          draft.states.map((state) => (
            <label key={state.key} className="flex items-center gap-2 text-body-xs-regular">
              <input type="checkbox" checked={sources.includes(state.key)} onChange={() => toggleSource(state.key)} />
              {state.status.name}
            </label>
          ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
        {t("workflows.editor.add_transition.target")}
        <select
          className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          required
        >
          <option value="" disabled />
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
        id="workflow-new-transition-name"
        name="transition-name"
        type="text"
        label={t("workflows.editor.add_transition.name")}
        value={name}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
      />
      <Button
        variant="secondary"
        size="sm"
        stretch="auto"
        type="submit"
        label={t("workflows.editor.add_transition.submit")}
      />
    </form>
  );
}
```

Create `apps/web/components/workflow/editor/restrict-actors-form.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowRestrictActorsParams } from "@plane/types";
// hooks
import { useMember } from "@/hooks/store/use-member";

const ROLES = [
  { value: 20, key: "admin" },
  { value: 15, key: "member" },
  { value: 5, key: "guest" },
] as const;

type Props = {
  params: TWorkflowRestrictActorsParams | null;
  readOnly: boolean;
  onChange: (params: TWorkflowRestrictActorsParams | null) => void;
};

const toggle = <T,>(list: T[] | undefined, value: T) =>
  list?.includes(value) ? list.filter((item) => item !== value) : [...(list ?? []), value];

export const RestrictActorsForm = observer(function RestrictActorsForm({ params, readOnly, onChange }: Props) {
  const { t } = useTranslation();
  const {
    workspace: { workspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();
  const current = params ?? {};
  const update = (patch: TWorkflowRestrictActorsParams) => onChange({ ...current, ...patch });

  return (
    <fieldset className="space-y-2" disabled={readOnly}>
      <legend className="text-body-sm-medium text-primary">{t("workflows.editor.restrict.title")}</legend>
      <p className="text-caption-sm-regular text-tertiary">{t("workflows.editor.restrict.description")}</p>
      <div className="space-y-1">
        <span className="text-body-xs-medium text-secondary">{t("workflows.editor.restrict.roles")}</span>
        {ROLES.map((role) => (
          <label key={role.value} className="flex items-center gap-2 text-body-xs-regular">
            <input
              type="checkbox"
              checked={current.roles?.includes(role.value) ?? false}
              onChange={() => update({ roles: toggle(current.roles, role.value) })}
            />
            {t(`workflows.roles.${role.key}`)}
          </label>
        ))}
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        <span className="text-body-xs-medium text-secondary">{t("workflows.editor.restrict.users")}</span>
        {(workspaceMemberIds ?? []).map((memberId) => {
          const member = getWorkspaceMemberDetails(memberId)?.member;
          if (!member) return null;
          return (
            <label key={member.id} className="flex items-center gap-2 text-body-xs-regular">
              <input
                type="checkbox"
                checked={current.user_ids?.includes(member.id) ?? false}
                onChange={() => update({ user_ids: toggle(current.user_ids, member.id) })}
              />
              {member.display_name}
            </label>
          );
        })}
      </div>
      {(["assignee", "creator"] as const).map((flag) => (
        <label key={flag} className="flex items-center gap-2 text-body-xs-regular">
          <input
            type="checkbox"
            checked={current[flag] === true}
            onChange={(event) => update({ [flag]: event.target.checked ? true : undefined })}
          />
          {t(`workflows.editor.restrict.${flag}`)}
        </label>
      ))}
      {params && !readOnly && (
        <Button
          variant="secondary"
          size="sm"
          stretch="auto"
          label={t("workflows.editor.restrict.clear")}
          onClick={() => onChange(null)}
        />
      )}
    </fieldset>
  );
});
```

Create `apps/web/components/workflow/editor/side-panel.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups } from "@plane/types";
// local imports
import {
  removeState,
  removeTransition,
  setInitial,
  setRestriction,
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
  readOnly: boolean;
  onChange: (draft: TDraftGraph) => void;
  onClose: () => void;
};

export const WorkflowSidePanel = observer(function WorkflowSidePanel({
  draft,
  selection,
  readOnly,
  onChange,
  onClose,
}: Props) {
  const { t } = useTranslation();
  if (!selection) return null;
  const state = selection.kind === "state" ? draft.states.find((item) => item.key === selection.key) : undefined;
  const transition =
    selection.kind === "transition" ? draft.transitions.find((item) => item.key === selection.key) : undefined;
  if (!state && !transition) return null;

  return (
    <aside
      className="w-80 shrink-0 space-y-4 rounded-md border border-subtle p-4"
      aria-label={t(state ? "workflows.editor.panel.state" : "workflows.editor.panel.transition")}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-body-sm-medium text-primary">
          {t(state ? "workflows.editor.panel.state" : "workflows.editor.panel.transition")}
        </h3>
        <Button variant="ghost" size="sm" stretch="auto" label={t("workflows.editor.panel.close")} onClick={onClose} />
      </div>
      {state && (
        <fieldset className="space-y-3" disabled={readOnly}>
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
          <label className="flex items-center gap-2 text-body-xs-medium text-secondary">
            {t("workflows.editor.add_state.color")}
            <input
              type="color"
              value={state.status.color}
              onChange={(event) => onChange(updateStatus(draft, state.key, { color: event.target.value }))}
            />
          </label>
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
          <Button
            variant="danger-outline"
            size="sm"
            stretch="auto"
            label={t("workflows.editor.panel.remove_state")}
            onClick={() => {
              onChange(removeState(draft, state.key));
              onClose();
            }}
          />
        </fieldset>
      )}
      {transition && (
        <div className="space-y-3">
          <fieldset className="space-y-3" disabled={readOnly}>
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
            <p className="text-body-xs-regular text-secondary">
              {transition.from_any
                ? t("workflows.editor.global")
                : transition.source_keys
                    .map((key) => draft.states.find((item) => item.key === key)?.status.name)
                    .join(", ")}
              {" → "}
              {draft.states.find((item) => item.key === transition.target_key)?.status.name}
            </p>
          </fieldset>
          <RestrictActorsForm
            params={transition.rules[0]?.params ?? null}
            readOnly={readOnly}
            onChange={(params) => onChange(setRestriction(draft, transition.key, params))}
          />
          {!readOnly && (
            <Button
              variant="danger-outline"
              size="sm"
              stretch="auto"
              label={t("workflows.editor.panel.remove_transition")}
              onClick={() => {
                onChange(removeTransition(draft, transition.key));
                onClose();
              }}
            />
          )}
        </div>
      )}
    </aside>
  );
});
```

- [ ] **Step 3: Write the editor root and its page**

Create `apps/web/components/workflow/editor/workflow-editor.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowDetail, TWorkflowStatus, TWorkflowStatusUsage } from "@plane/types";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
// local imports
import { AddStateForm } from "./add-state-form";
import { AddTransitionForm } from "./add-transition-form";
import {
  addState,
  addTransition,
  fromDetail,
  getGraphErrorKey,
  isDraftDirty,
  moveState,
  toPayload,
  validateDraft,
  type TDraftGraph,
} from "./graph-model";
import { WorkflowSidePanel } from "./side-panel";
import { WorkflowCanvas, type TEditorSelection } from "./workflow-canvas";

type Props = {
  workspaceSlug: string;
  workflow: TWorkflowDetail;
  statuses: TWorkflowStatus[];
  readOnly: boolean;
};

export const WorkflowEditor = observer(function WorkflowEditor({ workspaceSlug, workflow, statuses, readOnly }: Props) {
  const { t } = useTranslation();
  const { saveGraph } = useWorkflow();
  const saved = useMemo(() => fromDetail(workflow, statuses), [workflow, statuses]);
  const [draft, setDraft] = useState<TDraftGraph>(saved);
  const [selection, setSelection] = useState<TEditorSelection>(null);
  const [serverError, setServerError] = useState<{ key: string; projects: TWorkflowStatusUsage[] } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setDraft(saved), [saved]);

  const errors = validateDraft(draft);
  const dirty = isDraftDirty(draft, saved);
  const usedStatusIds = new Set(draft.states.flatMap((state) => (state.status.id ? [state.status.id] : [])));

  const save = async () => {
    setServerError(null);
    setIsSaving(true);
    try {
      await saveGraph(workspaceSlug, workflow.id, toPayload(draft));
      setToast({ type: "success", title: t("workflows.editor.saved"), message: "" });
    } catch (error) {
      setServerError(getGraphErrorKey(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/${workspaceSlug}/settings/workflows`}
          className="text-body-sm-regular text-secondary hover:underline"
        >
          {t("workflows.editor.back")}
        </Link>
        <h2 className="flex-1 text-h5-semibold text-primary">{workflow.name}</h2>
        {dirty && <span className="text-caption-sm-regular text-warning-primary">{t("workflows.editor.unsaved")}</span>}
        {!readOnly && (
          <>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              disabled={!dirty || isSaving}
              label={t("workflows.editor.discard")}
              onClick={() => setDraft(saved)}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              disabled={!dirty || errors.length > 0}
              loading={isSaving}
              label={t("workflows.editor.save")}
              onClick={save}
            />
          </>
        )}
      </div>
      {readOnly && <p className="text-body-sm-regular text-secondary">{t("workflows.editor.read_only")}</p>}
      {(errors.length > 0 || serverError) && (
        <div
          role="alert"
          className="rounded-md border border-danger-subtle bg-danger-subtle p-3 text-body-sm-regular text-danger-primary"
        >
          {errors.map((code) => (
            <p key={code}>{t(`workflows.editor.errors.${code}`)}</p>
          ))}
          {serverError && <p>{t(serverError.key)}</p>}
          {serverError?.projects.map((project) => (
            <p key={project.project_id}>
              {t("workflows.editor.errors.status_in_use_project", {
                project: project.project_name,
                count: project.issue_count,
              })}
            </p>
          ))}
        </div>
      )}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <WorkflowCanvas
            draft={draft}
            readOnly={readOnly}
            selection={selection}
            onSelect={setSelection}
            onMove={(key, x, y) => setDraft((current) => moveState(current, key, x, y))}
            onConnect={(source, target) =>
              setDraft((current) =>
                addTransition(current, {
                  key: `new-${crypto.randomUUID()}`,
                  name: "",
                  from_any: false,
                  source_keys: [source],
                  target_key: target,
                  rules: [],
                })
              )
            }
          />
        </div>
        <WorkflowSidePanel
          draft={draft}
          selection={selection}
          readOnly={readOnly}
          onChange={setDraft}
          onClose={() => setSelection(null)}
        />
      </div>
      {!readOnly && (
        <div className="grid gap-6 md:grid-cols-2">
          <AddStateForm
            availableStatuses={statuses.filter((status) => !usedStatusIds.has(status.id))}
            onAdd={(status) => setDraft((current) => addState(current, `new-${crypto.randomUUID()}`, status))}
          />
          <AddTransitionForm
            draft={draft}
            onAdd={(transition) =>
              setDraft((current) => addTransition(current, { ...transition, key: `new-${crypto.randomUUID()}` }))
            }
          />
        </div>
      )}
    </div>
  );
});
```

Create `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/[workflowId]/page.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import {
  EUserPermissions,
  EUserPermissionsLevel,
  WORKFLOW_DETAIL,
  WORKSPACE_WORKFLOW_STATUSES,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/blocks/skeleton";
// components
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { WorkflowEditor } from "@/components/workflow/editor/workflow-editor";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { WorkflowsWorkspaceSettingsHeader } from "../header";
import type { Route } from "./+types/page";

function WorkflowEditorPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, workflowId } = params;
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  const { fetchWorkflowDetail, fetchStatuses, getWorkflowDetail, getWorkspaceStatuses } = useWorkflow();
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const detail = useSWR(WORKFLOW_DETAIL(workflowId), () => fetchWorkflowDetail(workspaceSlug, workflowId));
  const statuses = useSWR(WORKSPACE_WORKFLOW_STATUSES(workspaceSlug), () => fetchStatuses(workspaceSlug));
  const workflow = getWorkflowDetail(workflowId);

  return (
    <SettingsContentWrapper header={<WorkflowsWorkspaceSettingsHeader />}>
      <PageHead title={workflow ? `${workflow.name} - ${t("workflows.label")}` : undefined} />
      {detail.error || statuses.error ? (
        <p role="alert" className="text-body-sm-regular text-danger-primary">
          {t("workflows.settings.load_error")}
        </p>
      ) : !workflow || !statuses.data ? (
        <Loader className="space-y-3">
          <Loader.Item height="560px" />
        </Loader>
      ) : (
        <WorkflowEditor
          workspaceSlug={workspaceSlug}
          workflow={workflow}
          statuses={getWorkspaceStatuses(workspaceSlug)}
          readOnly={!isWorkspaceAdmin}
        />
      )}
    </SettingsContentWrapper>
  );
}

export default observer(WorkflowEditorPage);
```

In `apps/web/app/routes/core.ts`, after the workspace `workflows` route:

```ts
          route(
            ":workspaceSlug/settings/workflows/:workflowId",
            "./(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/[workflowId]/page.tsx"
          ),
```

- [ ] **Step 4: Check types, lint and the screen**

Run: `pnpm turbo run check:types --filter=web && pnpm --filter web exec oxlint components/workflow app && pnpm --filter web exec vitest run components/workflow`
Expected: no error; every workflow test still passes.

Then on the local stack, as a workspace admin: create a workflow, add three states with the keyboard form (the first one carries START), add transitions with the form and by dragging from a box's bottom handle to another box, add a global transition (badge on the target box), set "restrict who" on a transition, save, reload: everything is back as saved. Remove a state holding work items in a linked project: the red banner lists the projects with their counts. Tab through the whole page: every action is reachable without the mouse, focus stays visible.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workflow/editor "apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/workflows/[workflowId]" apps/web/app/routes/core.ts
git commit -m "feat(web): add the workflow diagram editor"
```

---

### Task 16: Onglet « Workflows » des paramètres du projet : système et assistant de rattachement (spec 5.1, 5.3, 7.3, A4, W10)

**Files:**

- Modify: `packages/types/src/settings.ts` (`TProjectSettingsTabs` reçoit `"workflows"`)
- Modify: `packages/constants/src/settings/project.ts` (entrée `workflows`, groupe `WORK_STRUCTURE`)
- Modify: `apps/web/components/settings/project/sidebar/item-icon.tsx`
- Modify: `apps/web/app/routes/core.ts`
- Create: `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/workflows/page.tsx`, `.../workflows/header.tsx`
- Create: `apps/web/components/workflow/project/project-workflow-scheme.tsx`
- Create: `apps/web/components/workflow/project/scheme-helpers.ts`, `apps/web/components/workflow/project/scheme-helpers.test.ts`

**Interfaces:**

- Consumes: `useWorkflow()` (`fetchWorkflows`, `getWorkspaceWorkflows`, `fetchWorkflowDetail`, `getWorkflowDetail`, `getProjectScheme`, `fetchProjectScheme`, `previewProjectScheme`, `applyProjectScheme`, `detachProjectScheme`), `useWorkItemType().getProjectAssignableTypes(workspaceSlug, projectId)`, `useProjectState().fetchProjectStates(workspaceSlug, projectId)`.
- Produces (`scheme-helpers.ts`) : `buildSchemePayload(defaultWorkflowId, typeChoices, arrivals) -> TProjectWorkflowSchemePayload` où `typeChoices: Record<string, string>` (type vers workflow, `""` = comme le défaut) et `arrivals: Record<string, string>` (clé `${state_id}:${workflow_id}` vers `status_id`) ; `pendingNeeds(needs) -> TWorkflowMappingNeed[]` (besoins sans correspondance automatique) ; `getSchemeErrorKey(error) -> string`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/workflow/project/scheme-helpers.test.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { buildSchemePayload, getSchemeErrorKey, pendingNeeds } from "./scheme-helpers";

describe("scheme helpers", () => {
  it("drops types that follow the default and builds mappings", () => {
    expect(
      buildSchemePayload("software", { bug: "support", task: "", story: "software" }, { "s1:support": "st-new" })
    ).toEqual({
      default_workflow_id: "software",
      items: [
        { issue_type_id: "bug", workflow_id: "support" },
        { issue_type_id: "story", workflow_id: "software" },
      ],
      mappings: [{ state_id: "s1", workflow_id: "support", status_id: "st-new" }],
    });
  });

  it("keeps only the needs the server cannot map by name", () => {
    const need = { state_id: "s", state_name: "A", workflow_id: "w", issue_count: 1 };
    expect(
      pendingNeeds([
        { ...need, auto_status_id: "x" },
        { ...need, auto_status_id: null },
      ])
    ).toEqual([{ ...need, auto_status_id: null }]);
  });

  it("maps scheme refusals to i18n keys", () => {
    expect(getSchemeErrorKey({ scheme: ["mapping_incomplete"] })).toBe("workflows.scheme.errors.mapping_incomplete");
    expect(getSchemeErrorKey({ scheme: ["other"] })).toBe("workflows.scheme.errors.default");
    expect(getSchemeErrorKey(null)).toBe("workflows.scheme.errors.default");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run components/workflow/project/scheme-helpers.test.ts`
Expected: FAIL: `Failed to resolve import "./scheme-helpers"`.

- [ ] **Step 3: Write the helpers**

Create `apps/web/components/workflow/project/scheme-helpers.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TProjectWorkflowSchemePayload, TWorkflowMappingNeed } from "@plane/types";

const SCHEME_ERROR_CODES = new Set(["invalid_scheme", "mapping_incomplete", "invalid_mapping"]);

export const needKey = (need: Pick<TWorkflowMappingNeed, "state_id" | "workflow_id">) =>
  `${need.state_id}:${need.workflow_id}`;

export const buildSchemePayload = (
  defaultWorkflowId: string,
  typeChoices: Record<string, string>,
  arrivals: Record<string, string>
): TProjectWorkflowSchemePayload => ({
  default_workflow_id: defaultWorkflowId,
  items: Object.entries(typeChoices)
    .filter(([, workflowId]) => workflowId !== "")
    .map(([issueTypeId, workflowId]) => ({ issue_type_id: issueTypeId, workflow_id: workflowId })),
  mappings: Object.entries(arrivals).map(([key, statusId]) => {
    const [stateId, workflowId] = key.split(":");
    return { state_id: stateId, workflow_id: workflowId, status_id: statusId };
  }),
});

export const pendingNeeds = (needs: TWorkflowMappingNeed[]) => needs.filter((need) => need.auto_status_id === null);

export const getSchemeErrorKey = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && Array.isArray((error as { scheme?: unknown }).scheme)
      ? (error as { scheme: unknown[] }).scheme[0]
      : undefined;
  return typeof code === "string" && SCHEME_ERROR_CODES.has(code)
    ? `workflows.scheme.errors.${code}`
    : "workflows.scheme.errors.default";
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run components/workflow/project/scheme-helpers.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write the scheme screen**

Create `apps/web/components/workflow/project/project-workflow-scheme.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowMappingNeed } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { useWorkflow } from "@/hooks/store/use-workflow";
// local imports
import { buildSchemePayload, getSchemeErrorKey, needKey, pendingNeeds } from "./scheme-helpers";

type Props = { workspaceSlug: string; projectId: string };

const SELECT_CLASS = "rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular";

export const ProjectWorkflowScheme = observer(function ProjectWorkflowScheme({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const {
    getWorkspaceWorkflows,
    getProjectScheme,
    fetchWorkflowDetail,
    getWorkflowDetail,
    previewProjectScheme,
    applyProjectScheme,
    detachProjectScheme,
  } = useWorkflow();
  const { getProjectAssignableTypes } = useWorkItemType();
  const { fetchProjectStates } = useProjectState();
  const scheme = getProjectScheme(projectId);
  const workflows = getWorkspaceWorkflows(workspaceSlug);
  const types = getProjectAssignableTypes(workspaceSlug, projectId);

  const [defaultWorkflowId, setDefaultWorkflowId] = useState("");
  const [typeChoices, setTypeChoices] = useState<Record<string, string>>({});
  const [needs, setNeeds] = useState<TWorkflowMappingNeed[] | null>(null);
  const [arrivals, setArrivals] = useState<Record<string, string>>({});
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDetachOpen, setIsDetachOpen] = useState(false);

  useEffect(() => {
    setDefaultWorkflowId(scheme?.default_workflow_id ?? "");
    setTypeChoices(Object.fromEntries((scheme?.items ?? []).map((item) => [item.issue_type_id, item.workflow_id])));
  }, [scheme]);

  const payload = () => buildSchemePayload(defaultWorkflowId, typeChoices, arrivals);

  const refresh = () => Promise.allSettled([fetchProjectStates(workspaceSlug, projectId)]);

  const goToMapping = async () => {
    setErrorKey(null);
    setIsBusy(true);
    try {
      const chosen = new Set([defaultWorkflowId, ...Object.values(typeChoices).filter(Boolean)]);
      await Promise.all([...chosen].map((workflowId) => fetchWorkflowDetail(workspaceSlug, workflowId)));
      setArrivals({});
      setNeeds(pendingNeeds(await previewProjectScheme(workspaceSlug, projectId, payload())));
    } catch (error) {
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const apply = async () => {
    setErrorKey(null);
    setIsBusy(true);
    try {
      await applyProjectScheme(workspaceSlug, projectId, payload());
      await refresh();
      setNeeds(null);
      setToast({ type: "success", title: t("workflows.scheme.applied"), message: "" });
    } catch (error) {
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const detach = async () => {
    setIsBusy(true);
    try {
      await detachProjectScheme(workspaceSlug, projectId);
      await refresh();
      setIsDetachOpen(false);
      setToast({ type: "success", title: t("workflows.scheme.detached"), message: "" });
    } catch (error) {
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const workflowName = (workflowId: string) => workflows.find((workflow) => workflow.id === workflowId)?.name ?? "";

  return (
    <div className="space-y-6">
      {!scheme?.default_workflow_id && (
        <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.free")}</p>
      )}
      {errorKey && (
        <p role="alert" className="text-body-sm-regular text-danger-primary">
          {t(errorKey)}
        </p>
      )}
      {needs === null ? (
        <div className="space-y-4">
          <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
            {t("workflows.scheme.default_workflow")}
            <select
              className={SELECT_CLASS}
              value={defaultWorkflowId}
              onChange={(event) => setDefaultWorkflowId(event.target.value)}
            >
              <option value="" disabled>
                {t("workflows.scheme.choose")}
              </option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>
          {types.map((type) => (
            <label key={type.id} className="flex flex-col gap-1 text-body-xs-medium text-secondary">
              {t("workflows.scheme.per_type", { type: type.name })}
              <select
                className={SELECT_CLASS}
                value={typeChoices[type.id] ?? ""}
                onChange={(event) => setTypeChoices((current) => ({ ...current, [type.id]: event.target.value }))}
              >
                <option value="">{t("workflows.scheme.same_as_default")}</option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              disabled={!defaultWorkflowId}
              loading={isBusy}
              label={t("workflows.scheme.next")}
              onClick={goToMapping}
            />
            {scheme?.default_workflow_id && (
              <Button
                variant="danger-outline"
                size="md"
                stretch="auto"
                label={t("workflows.scheme.detach")}
                onClick={() => setIsDetachOpen(true)}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-body-md-medium text-primary">{t("workflows.scheme.mapping.title")}</h3>
          {needs.length === 0 ? (
            <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.mapping.none")}</p>
          ) : (
            <>
              <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.mapping.description")}</p>
              {needs.map((need) => (
                <label key={needKey(need)} className="flex flex-col gap-1 text-body-xs-medium text-secondary">
                  {t("workflows.scheme.mapping.row", {
                    state: need.state_name,
                    workflow: workflowName(need.workflow_id),
                    count: need.issue_count,
                  })}
                  <select
                    className={SELECT_CLASS}
                    aria-label={t("workflows.scheme.mapping.pick")}
                    value={arrivals[needKey(need)] ?? ""}
                    onChange={(event) =>
                      setArrivals((current) => ({ ...current, [needKey(need)]: event.target.value }))
                    }
                  >
                    <option value="" disabled>
                      {t("workflows.scheme.mapping.pick")}
                    </option>
                    {(getWorkflowDetail(need.workflow_id)?.states ?? []).map((state) => (
                      <option key={state.status.id} value={state.status.id}>
                        {state.status.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              label={t("workflows.scheme.back")}
              onClick={() => setNeeds(null)}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              loading={isBusy}
              disabled={needs.some((need) => !arrivals[needKey(need)])}
              label={t("workflows.scheme.apply")}
              onClick={apply}
            />
          </div>
        </div>
      )}
      <ConfirmDialog
        handleClose={() => setIsDetachOpen(false)}
        handleSubmit={detach}
        isSubmitting={isBusy}
        isOpen={isDetachOpen}
        title={t("workflows.scheme.detach")}
        content={t("workflows.scheme.detach_confirm")}
        primaryButtonText={{ loading: t("workflows.scheme.detach"), default: t("workflows.scheme.detach") }}
      />
    </div>
  );
});
```

- [ ] **Step 6: Register the tab and write the page**

In `packages/types/src/settings.ts`, add `| "workflows"` to `TProjectSettingsTabs`. In `packages/constants/src/settings/project.ts`, after the `work_item_types` entry:

```ts
  workflows: {
    key: "workflows",
    i18n_label: "workflows.label",
    href: `/workflows`,
    access: [EUserProjectRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/workflows/`,
  },
```

and add `PROJECT_SETTINGS["workflows"]` after `PROJECT_SETTINGS["work_item_types"]` in the `WORK_STRUCTURE` group. In `apps/web/components/settings/project/sidebar/item-icon.tsx`, import `WorkflowsOutline` from `@makeplane/propel/icons` and add `workflows: WorkflowsOutline,`. In `apps/web/app/routes/core.ts`, after the project `work-item-types` route:

```ts
            // Project Workflows
            route(
              ":workspaceSlug/settings/projects/:projectId/workflows",
              "./(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/workflows/page.tsx"
            ),
```

Create `.../projects/[projectId]/workflows/header.tsx` as a copy of `.../projects/[projectId]/work-item-types/header.tsx` with the component renamed `WorkflowsProjectSettingsHeader` and the key `"workflows"`.

Create `.../projects/[projectId]/workflows/page.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import {
  EUserPermissions,
  EUserPermissionsLevel,
  PROJECT_WORKFLOW_SCHEME,
  WORKSPACE_WORKFLOWS,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Loader } from "@plane/blocks/skeleton";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { ProjectWorkflowScheme } from "@/components/workflow/project/project-workflow-scheme";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { WorkflowsProjectSettingsHeader } from "./header";

function WorkflowsProjectSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { currentProjectDetails } = useProject();
  const { getProjectRoleByWorkspaceSlugAndProjectId, allowPermissions } = useUserPermissions();
  const { fetchWorkflows, fetchProjectScheme } = useWorkflow();
  // A4 is checked again by the server on every call.
  const isRoleKnown = getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId) !== undefined;
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const workflows = useSWR(
    canManage ? WORKSPACE_WORKFLOWS(workspaceSlug) : null,
    canManage ? () => fetchWorkflows(workspaceSlug) : null
  );
  const scheme = useSWR(
    canManage ? PROJECT_WORKFLOW_SCHEME(projectId) : null,
    canManage ? () => fetchProjectScheme(workspaceSlug, projectId) : null
  );
  const pageTitle = currentProjectDetails?.name ? `${currentProjectDetails.name} - ${t("workflows.label")}` : undefined;
  const loader = (
    <Loader className="space-y-3">
      <Loader.Item height="56px" />
      <Loader.Item height="56px" />
    </Loader>
  );

  if (!isRoleKnown)
    return <SettingsContentWrapper header={<WorkflowsProjectSettingsHeader />}>{loader}</SettingsContentWrapper>;
  if (!canManage) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;

  return (
    <SettingsContentWrapper header={<WorkflowsProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <SettingsHeading title={t("workflows.label")} description={t("workflows.scheme.description")} />
      <div className="mt-4">
        {(workflows.error && !workflows.data) || (scheme.error && !scheme.data) ? (
          <p role="alert" className="text-body-sm-regular text-danger-primary">
            {t("workflows.settings.load_error")}
          </p>
        ) : !workflows.data || !scheme.data ? (
          loader
        ) : (
          <ProjectWorkflowScheme workspaceSlug={workspaceSlug} projectId={projectId} />
        )}
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(WorkflowsProjectSettingsPage);
```

- [ ] **Step 7: Check**

Run: `pnpm turbo run check:types --filter=web --filter=@plane/types --filter=@plane/constants && pnpm --filter web exec oxlint components/workflow app && pnpm --filter web exec vitest run components/workflow`
Expected: no error; every workflow test passes.
On the local stack, as a project admin who is not workspace admin: link a project that has work items in a state absent from the chosen workflow: the mapping step lists it with its count, Apply moves the items (their activity shows the state change), the project states become the workflow statuses; "Stop using workflows" asks for confirmation and makes the project free again. As a project member: the tab is absent and the URL shows "not authorized".

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/settings.ts packages/constants/src/settings/project.ts apps/web/components/settings/project/sidebar/item-icon.tsx apps/web/app/routes/core.ts "apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/workflows" apps/web/components/workflow/project
git commit -m "feat(web): link projects to workflows from project settings"
```

---

### Task 17: Paramètres du projet > States en lecture seule sous workflow (spec 5.4)

**Files:**

- Modify: `apps/web/components/workflow/helpers.ts`, `apps/web/components/workflow/helpers.test.ts` (ajout de `isProjectWorkflowManaged`)
- Modify: `apps/web/components/project-states/root.tsx`

**Interfaces:**

- Consumes: `useProjectWorkflowScheme(projectId)` (Task 11), clé `workflows.managed_states.banner`.
- Produces: `isProjectWorkflowManaged(scheme) -> boolean`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/components/workflow/helpers.test.ts` (and import `isProjectWorkflowManaged`):

```ts
describe("isProjectWorkflowManaged", () => {
  it("is true only when the project has a scheme", () => {
    expect(isProjectWorkflowManaged(scheme)).toBe(true);
    expect(isProjectWorkflowManaged({ default_workflow_id: null, items: [], workflows: [] })).toBe(false);
    expect(isProjectWorkflowManaged(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run components/workflow/helpers.test.ts`
Expected: FAIL: `isProjectWorkflowManaged is not a function`.

- [ ] **Step 3: Implement**

Append to `apps/web/components/workflow/helpers.ts`:

```ts
/** Spec 5.4: a linked project's states mirror its workflows and are edited there only. */
export const isProjectWorkflowManaged = (scheme: TProjectWorkflowScheme | undefined) => !!scheme?.default_workflow_id;
```

In `apps/web/components/project-states/root.tsx`: import `useProjectWorkflowScheme` and `isProjectWorkflowManaged` from `@/components/workflow` and `useTranslation` from `@plane/i18n`; compute

```ts
const isManaged = isProjectWorkflowManaged(useProjectWorkflowScheme(projectId));
```

next to `isEditable`, pass `isEditable={isEditable && !isManaged}` to `GroupList`, and render above it, when `isManaged`:

```tsx
{
  isManaged && (
    <p role="note" className="mb-3 rounded-md border border-subtle bg-layer-2 p-3 text-body-sm-regular text-secondary">
      {t("workflows.managed_states.banner")}
    </p>
  );
}
```

(wrap the returned `GroupList` and the note in a fragment). The server refuses the same writes (Task 10); this only reflects it.

- [ ] **Step 4: Run test to verify it passes, then check**

Run: `pnpm --filter web exec vitest run components/workflow/helpers.test.ts && pnpm turbo run check:types --filter=web`
Expected: 10 passed; no type error.
On the local stack: the States page of a linked project shows the note, no add, edit, delete, reorder or default action; a free project's page is unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workflow/helpers.ts apps/web/components/workflow/helpers.test.ts apps/web/components/project-states/root.tsx
git commit -m "feat(web): show workflow-managed project states as read-only"
```

---

### Task 18: Côté tickets : sélecteurs filtrés, état initial à la création, état d'arrivée au changement de type, messages de refus (spec 7.4, T1, T2, W9, 4.5)

**Files:**

- Modify: `apps/web/components/dropdowns/state/state-select.tsx` (prop `allowedStateIds`)
- Modify: `apps/web/components/issues/issue-detail/detail-meta-row.tsx`
- Modify: `apps/web/components/issues/issue-layouts/properties/all-properties.tsx`
- Modify: `apps/web/components/issues/issue-layouts/spreadsheet/columns/state-column.tsx`
- Modify: `apps/web/components/issues/issue-detail-widgets/sub-issues/issues-list/properties.tsx`
- Modify: `apps/web/components/issues/issue-modal/components/default-properties.tsx`
- Create: `apps/web/components/workflow/arrival-state-dialog.tsx`
- Modify: `apps/web/components/issues/issue-type-switcher.tsx`
- Modify: `apps/web/components/issues/issue-detail/root.tsx`, `apps/web/components/issues/peek-overview/root.tsx` (message de refus)

**Interfaces:**

- Consumes: `useAllowedStateIds`, `useProjectWorkflowScheme`, `getInitialStateId`, `getWorkflowStateIds`, `getWorkflowRefusalKey` (Task 11) ; le bloc `StateSelectBlock` de `@plane/blocks/property-select` accepte déjà `allowedStateIds?: Set<string> | null` (son commentaire le réserve aux workflows).
- Produces: `StateSelect` accepte `allowedStateIds?: Set<string> | null` ; `ArrivalStateDialog` (`{ isOpen, projectId, stateIds: Set<string>, onSubmit(stateId), onClose }`).

- [ ] **Step 1: Pass the filter through `StateSelect`**

In `apps/web/components/dropdowns/state/state-select.tsx`, add to `StateSelectWebProps`:

```ts
  /** Spec 7.4: states the workflow lets this user pick (current state included); null or absent shows all. */
  allowedStateIds?: Set<string> | null;
```

destructure it and pass `allowedStateIds={allowedStateIds}` to `StateSelectBlock`. Replace the "CE change" sentence of the file docblock about `allowedStateIds` staying unset by: "Workflows pass `allowedStateIds` (spec 7.4); a free project leaves it unset."

- [ ] **Step 2: Filter every transition picker**

In each file below, import `useAllowedStateIds` from `@/components/workflow`, call it before any early `return` (hooks rule), and pass the result as `allowedStateIds` to the `StateSelect`:

- `issue-detail/detail-meta-row.tsx`: `const allowedStateIds = useAllowedStateIds(workspaceSlug, projectId, getIssueById(issueId));` placed right after the store hooks, before `if (!issue) return null;`.
- `issue-layouts/properties/all-properties.tsx`: `const allowedStateIds = useAllowedStateIds(workspaceSlug?.toString(), issue.project_id ?? undefined, issue);` next to the existing `useParams()` call; add `allowedStateIds={allowedStateIds}` to the `StateSelect` in `renderState`.
- `issue-layouts/spreadsheet/columns/state-column.tsx`: add `const { workspaceSlug } = useParams();` (from `next/navigation`) and `const allowedStateIds = useAllowedStateIds(workspaceSlug?.toString(), issue.project_id ?? undefined, issue);`.
- `issue-detail-widgets/sub-issues/issues-list/properties.tsx`: `const allowedStateIds = useAllowedStateIds(workspaceSlug, issue.project_id ?? undefined, issue);` before `if (!displayProperties) return <></>;`.

Drafts, intake and the active cycle widget keep the unfiltered picker: drafts are not controlled (4.2), intake items stay in triage (invariant 6).

- [ ] **Step 3: Fix the state at creation**

In `apps/web/components/issues/issue-modal/components/default-properties.tsx`: import `useWatch` from `react-hook-form`, `useEffect` from `react`, and `getInitialStateId`, `useProjectWorkflowScheme` from `@/components/workflow`; extend the `useProjectState()` destructuring with `getProjectStates`; then, after the existing derived values:

```ts
const typeId = useWatch({ control, name: "type_id" });
const scheme = useProjectWorkflowScheme(projectId ?? undefined);
// T1: a new item enters its workflow's initial state; the server refuses any other.
const workflowInitialStateId =
  !id || isDraft ? getInitialStateId(scheme, (projectId && getProjectStates(projectId)) || [], typeId) : undefined;
```

and replace the `state_id` `Controller` render by:

```tsx
        render={({ field: { value, onChange } }) =>
          workflowInitialStateId ? (
            <WorkflowInitialState
              stateId={workflowInitialStateId}
              value={value}
              onChange={onChange}
              projectId={projectId ?? undefined}
              tabIndex={getIndex("state_id")}
            />
          ) : (
            <StateSelect
              testId="create-work-item-state-select"
              // an empty state shows the project's default state, as the legacy dropdown did
              value={value || getProjectDefaultStateId(projectId)}
              onChange={(stateId) => {
                onChange(stateId);
                handleFormChange();
              }}
              projectId={projectId ?? undefined}
              variant="pill-md"
              tabIndex={getIndex("state_id")}
            />
          )
        }
```

with, in the same file above `IssueDefaultProperties`:

```tsx
type TWorkflowInitialStateProps = {
  stateId: string;
  value: string | null | undefined;
  onChange: (stateId: string) => void;
  projectId: string | undefined;
  tabIndex: number;
};

// Keeps the form value on the initial state while the type changes, and shows it read-only.
function WorkflowInitialState({ stateId, value, onChange, projectId, tabIndex }: TWorkflowInitialStateProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (value !== stateId) onChange(stateId);
  }, [stateId, value, onChange]);
  return (
    <StateSelect
      testId="create-work-item-state-select"
      value={stateId}
      onChange={() => undefined}
      projectId={projectId}
      variant="pill-md"
      tabIndex={tabIndex}
      disabled
      tooltip={{ heading: t("workflows.creation.initial_state") }}
    />
  );
}
```

- [ ] **Step 4: Ask for the arrival state on a type change**

Create `apps/web/components/workflow/arrival-state-dialog.tsx`:

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
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
// components
import { StateSelect } from "@/components/dropdowns/state/state-select";

type Props = {
  isOpen: boolean;
  projectId: string;
  stateIds: Set<string>;
  onSubmit: (stateId: string) => void;
  onClose: () => void;
};

export const ArrivalStateDialog = observer(function ArrivalStateDialog({
  isOpen,
  projectId,
  stateIds,
  onSubmit,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [stateId, setStateId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setStateId(null);
  }, [isOpen]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>{t("workflows.type_change.title")}</DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody tabIndex={0}>
            <p className="mb-3 text-body-sm-regular text-secondary">{t("workflows.type_change.description")}</p>
            <StateSelect
              value={stateId}
              onChange={setStateId}
              projectId={projectId}
              variant="select-ghost-lg"
              allowedStateIds={stateIds}
            />
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            label={t("workflows.type_change.cancel")}
            onClick={onClose}
          />
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            disabled={!stateId}
            label={t("workflows.type_change.submit")}
            onClick={() => stateId && onSubmit(stateId)}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
});
```

Export it from `apps/web/components/workflow/index.ts`. In `apps/web/components/issues/issue-type-switcher.tsx`: import `useState`, `ArrivalStateDialog`, `getWorkflowStateIds`, `getWorkflowRefusalKey`, `useProjectWorkflowScheme` and `useProjectState`; before the early return add

```ts
const [pendingTypeId, setPendingTypeId] = useState<string | null>(null);
const scheme = useProjectWorkflowScheme(issue?.project_id ?? undefined);
const { getProjectStates } = useProjectState();
```

and replace `handleChange` by:

```ts
const submitChange = async (change: Partial<TIssue>) => {
  if (!workspaceSlug) return;
  try {
    // The store applies the change optimistically and reverts it when the request fails.
    await updateIssue(workspaceSlug.toString(), projectId, issueId, change);
  } catch (error) {
    setToast({
      type: "error",
      title: t("common.error.label"),
      message: t(getWorkflowRefusalKey(error) ?? "entity.update.failed", { entity: t("issue.label", { count: 1 }) }),
    });
  }
};

const handleChange = async (typeId: string) => {
  const change = getWorkItemTypeChange(issue.type_id, typeId);
  if (!change) return;
  // W9: the current state must exist in the new workflow, otherwise the user picks the arrival state.
  const targetStateIds = getWorkflowStateIds(scheme, getProjectStates(projectId) ?? [], typeId);
  if (targetStateIds && (!issue.state_id || !targetStateIds.has(issue.state_id))) {
    setPendingTypeId(typeId);
    return;
  }
  await submitChange(change);
};
```

and render, after `IssueIdentifier`:

```tsx
{
  pendingTypeId && (
    <ArrivalStateDialog
      isOpen
      projectId={projectId}
      stateIds={getWorkflowStateIds(scheme, getProjectStates(projectId) ?? [], pendingTypeId) ?? new Set()}
      onClose={() => setPendingTypeId(null)}
      onSubmit={(stateId) => {
        const typeId = pendingTypeId;
        setPendingTypeId(null);
        void submitChange({ type_id: typeId, state_id: stateId });
      }}
    />
  );
}
```

(`TIssue` comes from `@plane/types`).

- [ ] **Step 5: Show the workflow refusal instead of the generic error**

In `apps/web/components/issues/issue-detail/root.tsx` (`issueOperations.update`, catch block) and `apps/web/components/issues/peek-overview/root.tsx` (`update`, `.catch` block), name the caught error `error` and replace the toast message by

```ts
message: t(getWorkflowRefusalKey(error) ?? "entity.update.failed", { entity: t("issue.label", { count: 1 }) }),
```

importing `getWorkflowRefusalKey` from `@/components/workflow`. The server answers a code only (4.5); nothing of its text is displayed.

- [ ] **Step 6: Check**

Run: `pnpm turbo run check:types --filter=web && pnpm --filter web exec oxlint components && pnpm --filter web exec vitest run`
Expected: no error; every web test passes.
On the local stack, in a linked project, as a member: the state picker of the detail, the list chip, the spreadsheet cell and a sub-item offer only the current state and the reachable ones; a "restrict who" transition not granted to the member is absent; the creation modal shows the initial state read-only and switching the type in the modal switches the initial state; changing the type of an item whose state is absent from the new workflow opens the arrival dialog, and choosing a state applies both; a free project behaves as before.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/dropdowns/state/state-select.tsx apps/web/components/issues apps/web/components/workflow/arrival-state-dialog.tsx apps/web/components/workflow/index.ts
git commit -m "feat(web): restrict state pickers to workflow transitions"
```

---

### Task 19: Glisser-déposer du Kanban et de la liste (spec 7.4)

**Files:**

- Modify: `apps/web/components/workflow/use-workflow-drag-n-drop.ts`
- Modify: `apps/web/components/issues/issue-layouts/kanban/kanban-group.tsx`, `apps/web/components/issues/issue-layouts/list/list-group.tsx`
- Modify: `apps/web/components/issues/issue-layouts/group-drag-overlay.tsx`
- Modify: `apps/web/hooks/use-group-dragndrop.ts`
- Create: `apps/web/components/workflow/drag-n-drop-helpers.ts`, `apps/web/components/workflow/drag-n-drop-helpers.test.ts`

**Interfaces:**

- Consumes: `useProjectWorkflowScheme`, `useWorkflowActor`, `getAllowedTargetStateIds`, `getWorkflowRefusalKey` (Task 11).
- Produces: `isWorkflowDropForbidden({ groupBy, subGroupBy, destinationGroupId, destinationSubGroupId, allowed }) -> boolean` ; `useWorkFlowFDragNDrop(groupBy, subGroupBy)` garde son nom et ses champs, et `handleWorkFlowState(sourceGroupId, destinationGroupId, sourceSubGroupId?, destinationSubGroupId?, issue?)` reçoit en cinquième argument le ticket glissé.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/workflow/drag-n-drop-helpers.test.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { isWorkflowDropForbidden } from "./drag-n-drop-helpers";

const allowed = new Set(["s-todo", "s-doing"]);

describe("isWorkflowDropForbidden", () => {
  it("checks the state column when grouped by state", () => {
    expect(isWorkflowDropForbidden({ groupBy: "state", destinationGroupId: "s-done", allowed })).toBe(true);
    expect(isWorkflowDropForbidden({ groupBy: "state", destinationGroupId: "s-doing", allowed })).toBe(false);
  });

  it("checks the state sub-group too", () => {
    expect(
      isWorkflowDropForbidden({
        groupBy: "priority",
        subGroupBy: "state",
        destinationGroupId: "high",
        destinationSubGroupId: "s-done",
        allowed,
      })
    ).toBe(true);
  });

  it("never blocks a free project or a layout not grouped by state", () => {
    expect(isWorkflowDropForbidden({ groupBy: "state", destinationGroupId: "s-done", allowed: null })).toBe(false);
    expect(isWorkflowDropForbidden({ groupBy: "priority", destinationGroupId: "high", allowed })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run components/workflow/drag-n-drop-helpers.test.ts`
Expected: FAIL: `Failed to resolve import "./drag-n-drop-helpers"`.

- [ ] **Step 3: Write the helper and the real hook**

Create `apps/web/components/workflow/drag-n-drop-helpers.ts`:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssueGroupByOptions } from "@plane/types";

/** Spec 7.4: a drop changes the state only when a state column or sub-group is the destination. */
export const isWorkflowDropForbidden = ({
  groupBy,
  subGroupBy,
  destinationGroupId,
  destinationSubGroupId,
  allowed,
}: {
  groupBy: TIssueGroupByOptions | undefined;
  subGroupBy?: TIssueGroupByOptions;
  destinationGroupId: string;
  destinationSubGroupId?: string;
  allowed: Set<string> | null;
}) => {
  if (!allowed) return false;
  if (groupBy === "state" && !allowed.has(destinationGroupId)) return true;
  return subGroupBy === "state" && !!destinationSubGroupId && !allowed.has(destinationSubGroupId);
};
```

Replace `apps/web/components/workflow/use-workflow-drag-n-drop.ts` by:

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import type { TIssue, TIssueGroupByOptions } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
// local imports
import { isWorkflowDropForbidden } from "./drag-n-drop-helpers";
import { getAllowedTargetStateIds } from "./helpers";
import { useProjectWorkflowScheme, useWorkflowActor } from "./use-allowed-states";

/** Each column calls it: the column learns whether the item being dragged may land in it (spec 7.4). */
export const useWorkFlowFDragNDrop = (groupBy: TIssueGroupByOptions | undefined, subGroupBy?: TIssueGroupByOptions) => {
  const { workspaceSlug, projectId } = useParams();
  const scheme = useProjectWorkflowScheme(projectId?.toString());
  const actor = useWorkflowActor(workspaceSlug?.toString(), projectId?.toString());
  const { getProjectStates } = useProjectState();
  const [workflowDisabledSource, setWorkflowDisabledSource] = useState<string | undefined>(undefined);

  const handleWorkFlowState = useCallback(
    (
      sourceGroupId: string,
      destinationGroupId: string,
      _sourceSubGroupId?: string,
      destinationSubGroupId?: string,
      issue?: TIssue
    ) => {
      const allowed =
        issue && issue.project_id
          ? getAllowedTargetStateIds({ scheme, projectStates: getProjectStates(issue.project_id) ?? [], issue, actor })
          : null;
      const forbidden = isWorkflowDropForbidden({
        groupBy,
        subGroupBy,
        destinationGroupId,
        destinationSubGroupId,
        allowed,
      });
      setWorkflowDisabledSource(forbidden ? sourceGroupId : undefined);
    },
    [scheme, actor, getProjectStates, groupBy, subGroupBy]
  );

  return {
    workflowDisabledSource,
    isWorkflowDropDisabled: workflowDisabledSource !== undefined,
    // Creation stays possible in any column: the server puts new items in the initial state (T1).
    getIsWorkflowWorkItemCreationDisabled: (_groupId: string, _subGroupId?: string) => false,
    handleWorkFlowState,
  };
};
```

Remove the `/* eslint-disable ... */` line that the stub carried if nothing in the file needs it any more.

- [ ] **Step 4: Pass the dragged item and block the drop**

In `kanban/kanban-group.tsx`: in `onDragEnter` and `onDragStart`, call `handleWorkFlowState(source?.groupId, groupId, source?.subGroupId, sub_group_id, source?.id ? issuesMap[source.id] : undefined)`; in `onDrop`, replace the guard by

```ts
if (isWorkflowDropDisabled || isDropDisabled) {
  const message = isWorkflowDropDisabled ? t("workflows.workflow_disabled.title") : dropErrorMessage;
  if (message) setToast({ type: "warning", title: t("common.warning"), message });
  return;
}
```

so a workflow refusal blocks the drop even without `dropErrorMessage`.

In `list/list-group.tsx`: in `onDrag`, read `const sourceId = source?.data?.id as string | undefined;` and call `handleWorkFlowState(sourceGroupId, currentGroupId, undefined, undefined, sourceId ? issuesMap[sourceId] : undefined)`; in `onDrop`, show `t("workflows.workflow_disabled.title")` when `isWorkflowDropDisabled` (keep `group.dropErrorMessage` for the other case).

In `group-drag-overlay.tsx`, when `workflowDisabledSource` is set and the drop is disabled, render the message `t("workflows.workflow_disabled.title")` (with `useTranslation`) in place of `null`, so the forbidden column states its reason to sighted users and, through the text, to assistive technologies (7.5).

In `apps/web/hooks/use-group-dragndrop.ts`, add `const { t } = useTranslation();` and import `getWorkflowRefusalKey` from `@/components/workflow`; make the update of `updateIssueOnDrop` show the refusal when the server still refuses (the card goes back through the store's revert):

```ts
updateIssue &&
  updateIssue(projectId, issueId, data).catch((error: unknown) =>
    setToast({
      ...errorToastProps,
      message: t(getWorkflowRefusalKey(error) ?? "entity.update.failed", { entity: t("issue.label", { count: 1 }) }),
    })
  );
```

- [ ] **Step 5: Run tests and checks**

Run: `pnpm --filter web exec vitest run && pnpm turbo run check:types --filter=web && pnpm --filter web exec oxlint components hooks`
Expected: 3 new tests pass with the others; no type or lint error.
On the local stack, Kanban grouped by state in a linked project: dragging a card greys the columns it cannot reach and shows the reason; dropping there leaves the card in place with the translated warning; an allowed column accepts it. Same in the list layout. A free project is unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/workflow apps/web/components/issues/issue-layouts apps/web/hooks/use-group-dragndrop.ts
git commit -m "feat(web): block kanban and list drops outside workflow transitions"
```

---

### Task 20: Vérification finale (spec 9)

**Files:** aucun nouveau ; corrections éventuelles dans les fichiers des tâches précédentes.

- [ ] **Step 1: Backend suite on a fresh database**

Run: `docker compose -p wf-final -f docker-compose-test.yml run --rm --build api-tests pytest --create-db`
Expected: every test passes; note the count.

- [ ] **Step 2: Migration on a populated copy**

On a copy of the local development database (never the original), run `python manage.py migrate` in the API container, then link a project holding work items through the API and check that every item stays in a state of its workflow (`invariant 5`): `Issue.objects.filter(project=...).exclude(state__group="triage").exclude(state__workflow_status__workflow_states__workflow=...)` returns nothing for a single-workflow scheme.

- [ ] **Step 3: Frontend checks**

Run: `pnpm check && pnpm turbo run test --filter=web && pnpm --filter=@plane/i18n sync:check`
Expected: format, lint, types, tests and locales all pass.

- [ ] **Step 4: Manual run through the spec**

On the local stack, as workspace admin, project admin, member and guest (accounts of `test-accounts.md`, never real passwords): sections 7.1 to 7.4 and the access rules A1 to A5 behave as written; tab through the editor and the scheme wizard without a mouse (7.5).

- [ ] **Step 5: Record the result**

Write the counts and anything not verified in the SDD ledger, then hand over to the final code review, `/ponytail-review` and `/security` (the delivery touches authorisation and API exposure).

---

## Couverture de la spec

| Spec                                    | Tâches                |
| --------------------------------------- | --------------------- |
| W1, W3, 3.3 (résolution)                | 2                     |
| W2, W17 (statuts partagés)              | 1, 3, 4, 15           |
| W4 (états synchronisés)                 | 3, 10, 17             |
| W5 (groupes déduits), P4                | 3, 4, 14              |
| W6 (limiter qui), P3                    | 2, 4, 7, 11, 15       |
| W7 (état initial)                       | 1, 2, 8, 14, 18       |
| W8 (optionnel, contrôle serveur)        | 2, 7, 8               |
| W9, T2 (changement de type)             | 2, 7, 18              |
| W10, 5.1 (correspondance, rattachement) | 3, 6, 16              |
| W11, 5.2 (retrait refusé, compte)       | 3, 4, 5, 15           |
| W12, A1 à A5 (droits)                   | 5, 6, 13, 16          |
| W13, 7.2, 7.5 (éditeur, accessibilité)  | 14, 15                |
| W14 (audit)                             | 3, 4, 5               |
| W15 (i18n)                              | 12                    |
| W16 (approche A)                        | 1, 3                  |
| 3.2 invariants 1 à 6                    | 1, 3, 8, 10           |
| 4.1, 4.5 (contrôle et refus uniques)    | 2, 7, 11, 18, 19      |
| 4.2 (points d'appel)                    | 7                     |
| 4.4 (filet du modèle)                   | 8                     |
| T1 (création)                           | 2, 7, 18              |
| T3 (intake)                             | 9                     |
| T4 (automatisation, correction)         | 9                     |
| T5 (archivage inchangé)                 | aucune (rien à faire) |
| T6 (opérations système tracées)         | 3                     |
| 5.3 (détacher)                          | 3, 6, 16              |
| 5.4 (States en lecture seule)           | 10, 17                |
| 7.1 (liste)                             | 13                    |
| 7.3 (onglet projet)                     | 16                    |
| 7.4 (sélecteurs, Kanban, création)      | 11, 18, 19            |
| 8 (STRIDE, bornes)                      | 1, 4, 5, 6, 7, 10     |
| 9 (tests)                               | toutes, 20            |
