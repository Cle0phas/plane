# Types de ticket (livraison 1) : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal** : activer de bout en bout les types de ticket de Plane (modèles `IssueType`, `ProjectIssueType`, `Issue.type` déjà présents) : gestion par les admins du workspace, choix par projet, type obligatoire sur chaque ticket, historique, filtre et regroupement, journal d'audit.

**Architecture** : le backend Django ajoute un journal d'audit en ajout seul, crée l'état initial (type « Tâche » par défaut) par signaux `post_save` sur `Workspace` et `Project`, garantit le type par défaut au niveau du modèle `Issue` (défense en profondeur) et refuse en 400 tout type non autorisé dans chaque serializer d'écriture. Deux points d'API (`WorkspaceIssueTypeEndpoint`, `ProjectIssueTypeEndpoint`) portent les règles R1 à R8 et R12. Le frontend ajoute un store MobX `WorkItemTypeStore` sous `workspaceRoot`, deux onglets de paramètres, un sélecteur de type (création et fiche), l'icône du type dans l'identifiant, le filtre et le regroupement par type.

**Tech Stack** : Django 4 + DRF, PostgreSQL, pytest (pile Docker `docker-compose-test.yml`), React Router 8, MobX 6, react-hook-form, `@makeplane/propel`, `@plane/blocks`, `@plane/i18n` (ICU), vitest 4.

**Spec** : `docs/superpowers/specs/2026-11-12-work-item-types-design.md`

## Global Constraints

- TDD strict : chaque étape de code commence par un test qui échoue, exécuté et observé en échec.
- Identifiants techniques en anglais (variables, fonctions, classes, routes, tables, clés i18n, fichiers).
- Commentaires uniquement pour le pourquoi, sur une ligne.
- Aucun tiret cadratin (U+2014) dans le code, les commentaires, les commits ou ce document.
- Commits Conventional Commits `<type>(<scope>): <subject>`, minuscules, impératif, 72 caractères au plus, sans `Co-Authored-By` ni aucune mention d'IA.
- Autorisation contrôlée côté serveur sur chaque opération ; l'interface ne fait que refléter les droits.
- Tout nouveau texte d'interface passe par `packages/i18n` (en et fr écrits dans ce plan, les 20 autres locales via le skill `translate`).
- Migrations générées avec `uv run python manage.py makemigrations <app> -n <name>` (depuis `apps/api`) ; `apps/api/migrations_lockfile.txt` est commité avec elles, jamais édité à la main.
- Jamais `--no-verify`.
- Dépendances JS épinglées via le catalogue pnpm (`"catalog:"`), dépendances Python via `uv`.
- Nouveaux fichiers `.py`, `.ts`, `.tsx` (hors migrations et `*.config.ts`) : en-tête `COPYRIGHT.txt` :
  - Python : `# Copyright (c) 2023-present Plane Software, Inc. and contributors` / `# SPDX-License-Identifier: AGPL-3.0-only` / `# See the LICENSE file for details.`
  - TypeScript : le même texte dans un bloc `/** ... */`.
- Commandes backend : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db <chemin> -v` depuis la racine du dépôt (`--create-db` car `pytest.ini` active `--reuse-db --nomigrations` et le schéma change pendant ce plan).

---

## File Structure

### Backend (`apps/api`)

| Fichier                                                           | Action          | Responsabilité                                                                                                                                                |
| ----------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plane/db/models/audit_log.py`                                    | Create          | Modèle `AuditLog` en ajout seul (table `audit_logs`).                                                                                                         |
| `plane/db/models/issue_type.py`                                   | Modify          | Constantes du type par défaut, `get_or_create_workspace_default_issue_type`, `ensure_project_default_issue_type`, signaux de création, contraintes d'unicité. |
| `plane/db/models/issue.py`                                        | Modify          | `Issue._ensure_default_type` : type par défaut si absent ou non activé dans le projet (invariant 4, R10).                                                     |
| `plane/db/models/__init__.py`                                     | Modify          | Exporter `AuditLog` et `ProjectIssueType`.                                                                                                                    |
| `plane/db/migrations/0126_auditlog.py`                            | Create (généré) | Table `audit_logs`.                                                                                                                                           |
| `plane/db/migrations/0127_backfill_work_item_types.py`            | Create          | Migration de données idempotente, par lots (spec 3.4).                                                                                                        |
| `plane/db/migrations/0128_work_item_type_constraints.py`          | Create (généré) | Unicité du nom (casse ignorée), un seul défaut par workspace et par projet.                                                                                   |
| `migrations_lockfile.txt`                                         | Modify (généré) | Dernière migration de `db`.                                                                                                                                   |
| `plane/utils/audit.py`                                            | Create          | `record_audit(...)` : écrit une entrée d'audit.                                                                                                               |
| `plane/utils/issue_types.py`                                      | Create          | `validate_work_item_type_id(...)` : contrôle R7/R9 partagé par tous les serializers.                                                                          |
| `plane/app/serializers/issue_type.py`                             | Create          | `IssueTypeSerializer` (validation nom, description, `logo_props`), `ProjectIssueTypeSerializer`.                                                              |
| `plane/app/serializers/__init__.py`                               | Modify          | Exporter les deux serializers.                                                                                                                                |
| `plane/app/views/issue_type/base.py`                              | Create          | `WorkspaceIssueTypeEndpoint`, `ProjectIssueTypeEndpoint`.                                                                                                     |
| `plane/app/views/__init__.py`                                     | Modify          | Exporter les deux vues.                                                                                                                                       |
| `plane/app/urls/issue_type.py`                                    | Create          | Les 9 routes de la spec section 5.                                                                                                                            |
| `plane/app/urls/__init__.py`                                      | Modify          | Enregistrer `issue_type_urls`.                                                                                                                                |
| `plane/app/serializers/issue.py`                                  | Modify          | `IssueCreateSerializer` : `type_id` contrôlé, `type` en lecture seule ; `IssueSerializer` et `IssueListDetailSerializer` renvoient `type_id`.                 |
| `plane/app/serializers/draft.py`                                  | Modify          | `DraftIssueCreateSerializer` : `type_id` contrôlé, `type` en lecture seule.                                                                                   |
| `plane/api/serializers/issue.py`                                  | Modify          | Serializer API v1 : `type_id` contrôlé, `type` en lecture seule, défaut laissé au modèle.                                                                     |
| `plane/space/serializer/issue.py`                                 | Modify          | `IssueCreateSerializer` public : `type` en lecture seule.                                                                                                     |
| `plane/app/views/issue/base.py`                                   | Modify          | Ajouter `type_id` aux listes `values(...)` des réponses.                                                                                                      |
| `plane/utils/grouper.py`                                          | Modify          | `type_id` dans `issue_on_results`, valeurs de groupe `type_id`.                                                                                               |
| `plane/utils/issue_filters.py`                                    | Modify          | `filter_issue_type` (paramètre `issue_type`).                                                                                                                 |
| `plane/utils/filters/filterset.py`                                | Modify          | `type_id`, `type_id__in` dans `IssueFilterSet`.                                                                                                               |
| `plane/bgtasks/issue_activities_task.py`                          | Modify          | `track_type` et entrée `type_id` du mapper (R11).                                                                                                             |
| `plane/tests/factories.py`                                        | Modify          | `IssueTypeFactory`, `ProjectIssueTypeFactory`.                                                                                                                |
| `plane/tests/unit/models/test_issue_type_factories.py`            | Create          | Test des fabriques.                                                                                                                                           |
| `plane/tests/unit/models/test_audit_log.py`                       | Create          | Journal d'audit.                                                                                                                                              |
| `plane/tests/unit/models/test_issue_type_defaults.py`             | Create          | État initial, invariant 4, R10.                                                                                                                               |
| `plane/tests/unit/models/test_issue_type_constraints.py`          | Create          | Contraintes d'unicité.                                                                                                                                        |
| `plane/tests/unit/db/test_backfill_work_item_types.py`            | Create          | Migration de données (invariants 1, 2, 4, idempotence, lots).                                                                                                 |
| `plane/tests/contract/app/test_workspace_issue_types_app.py`      | Create          | Routes workspace : droits par profil, R1, R2, R4 à R7, R12, 404 identique.                                                                                    |
| `plane/tests/contract/app/test_project_issue_types_app.py`        | Create          | Routes projet : R2, R3, R7, R8, R12, 404 identique.                                                                                                           |
| `plane/tests/contract/app/test_issue_type_assignment_app.py`      | Create          | R9 sur l'API de l'application et les brouillons, `type_id` dans les réponses.                                                                                 |
| `plane/tests/contract/api/test_issue_type_assignment_api.py`      | Create          | R9 sur l'API v1 (régression de la faille).                                                                                                                    |
| `plane/tests/unit/serializers/test_space_issue_type_read_only.py` | Create          | `type` en lecture seule côté public.                                                                                                                          |
| `plane/tests/unit/bg_tasks/test_issue_type_activity.py`           | Create          | R11 dans la tâche d'activité.                                                                                                                                 |
| `plane/tests/contract/app/test_issue_type_activity_app.py`        | Create          | R11 : la vue transmet `type_id` à la tâche.                                                                                                                   |
| `plane/tests/unit/utils/test_issue_type_filters.py`               | Create          | Filtre et regroupement par type.                                                                                                                              |
| `plane/tests/contract/app/test_issue_type_grouping_app.py`        | Create          | `group_by=type_id` et `issue_type=` sur la liste.                                                                                                             |

### Frontend

| Fichier                                                                                                         | Action        | Responsabilité                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `packages/types/src/work-item-type.ts`                                                                          | Create        | `TIssueType`, `TIssueTypeFormData`, `TIssueTypeUpdatePayload`, `TProjectIssueType`.        |
| `packages/types/src/index.ts`                                                                                   | Modify        | Exporter `./work-item-type`.                                                               |
| `packages/types/src/settings.ts`                                                                                | Modify        | Clés d'onglet `work-item-types` et `work_item_types`.                                      |
| `packages/types/src/view-props.ts`                                                                              | Modify        | `issue_type` dans `TIssueGroupByOptions`, `type_id` dans `WORK_ITEM_FILTER_PROPERTY_KEYS`. |
| `packages/types/src/issues.ts`                                                                                  | Modify        | `issue_type` dans `GroupByColumnTypes`.                                                    |
| `packages/constants/src/fetch-keys.ts`                                                                          | Modify        | `WORKSPACE_WORK_ITEM_TYPES`, `PROJECT_WORK_ITEM_TYPES`.                                    |
| `packages/constants/src/settings/workspace.ts`                                                                  | Modify        | Entrée `work-item-types` (accès ADMIN).                                                    |
| `packages/constants/src/settings/project.ts`                                                                    | Modify        | Entrée `work_item_types` (accès ADMIN).                                                    |
| `packages/constants/src/issue/common.ts`                                                                        | Modify        | Regroupement `issue_type` et propriété d'affichage.                                        |
| `packages/constants/src/issue/filter.ts`                                                                        | Modify        | Filtre `type_id`, regroupement `issue_type` sur la page des tickets.                       |
| `packages/utils/src/work-item-filters/configs/filters/work-item-type.ts`                                        | Create        | `getWorkItemTypeFilterConfig`.                                                             |
| `packages/utils/src/work-item-filters/configs/filters/index.ts`                                                 | Modify        | Export.                                                                                    |
| `packages/i18n/src/locales/*/work-item-type.json`                                                               | Modify        | Nouvelles clés `work_item_types.*` (22 locales).                                           |
| `apps/web/package.json`, `apps/web/vitest.config.ts`, `pnpm-lock.yaml`                                          | Modify/Create | Lanceur vitest pour `apps/web`.                                                            |
| `apps/web/services/work-item-type.service.ts`                                                                   | Create        | Appels HTTP des 9 routes.                                                                  |
| `apps/web/store/workspace/work-item-type.store.ts`                                                              | Create        | `WorkItemTypeStore` et sélecteurs.                                                         |
| `apps/web/store/workspace/work-item-type.store.test.ts`                                                         | Create        | Tests des sélecteurs.                                                                      |
| `apps/web/store/workspace/index.ts`                                                                             | Modify        | Sous-store `workItemType`.                                                                 |
| `apps/web/hooks/store/use-work-item-type.ts`                                                                    | Create        | Hook `useWorkItemType`.                                                                    |
| `apps/web/layouts/auth-layout/workspace-wrapper.tsx`                                                            | Modify        | Chargement des types du workspace.                                                         |
| `apps/web/layouts/auth-layout/project-wrapper.tsx`                                                              | Modify        | Chargement des types du projet.                                                            |
| `apps/web/components/work-item-types/work-item-type-icon.tsx`                                                   | Create        | Icône de type avec libellé texte.                                                          |
| `apps/web/components/work-item-types/work-item-type-select.tsx`                                                 | Create        | Sélecteur de type (création, fiche).                                                       |
| `apps/web/components/work-item-types/helpers.ts`                                                                | Create        | États et motifs des actions interdites, règles d'affichage, changement de type.            |
| `apps/web/components/work-item-types/helpers.test.ts`                                                           | Create        | Tests des helpers.                                                                         |
| `apps/web/components/work-item-types/settings/form-modal.tsx`                                                   | Create        | Fenêtre de création et de modification.                                                    |
| `apps/web/components/work-item-types/settings/workspace-list.tsx`                                               | Create        | Liste et menu « ... » du workspace.                                                        |
| `apps/web/components/work-item-types/settings/project-list.tsx`                                                 | Create        | Liste du projet (utilisé, par défaut).                                                     |
| `apps/web/components/settings/workspace/sidebar/item-icon.tsx`                                                  | Modify        | Icône de l'onglet workspace.                                                               |
| `apps/web/components/settings/project/sidebar/item-icon.tsx`                                                    | Modify        | Icône de l'onglet projet.                                                                  |
| `apps/web/app/routes/core.ts`                                                                                   | Modify        | Deux routes de paramètres.                                                                 |
| `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/work-item-types/{page,header}.tsx`          | Create        | Onglet workspace (spec 6.1).                                                               |
| `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/work-item-types/{page,header}.tsx` | Create        | Onglet projet (spec 6.2).                                                                  |
| `apps/web/components/issues/issue-modal/provider.tsx`                                                           | Modify        | `getIssueTypeIdOnProjectChange` réel.                                                      |
| `apps/web/components/issues/issue-modal/form.tsx`                                                               | Modify        | Sélecteur « Type » en tête du formulaire.                                                  |
| `apps/web/components/issues/issue-detail/issue-identifier.tsx`                                                  | Modify        | Icône du type devant l'identifiant.                                                        |
| `apps/web/components/issues/issue-type-switcher.tsx`                                                            | Modify        | Changement de type depuis la fiche.                                                        |
| `apps/web/components/issues/issue-detail/issue-activity/activity/actions/type.tsx`                              | Create        | Rendu de l'activité « type ».                                                              |
| `apps/web/components/issues/issue-detail/issue-activity/activity/actions/index.ts`                              | Modify        | Export.                                                                                    |
| `apps/web/components/issues/issue-detail/issue-activity/activity/activity-list.tsx`                             | Modify        | Cas `type`.                                                                                |
| `apps/web/components/issues/issue-layouts/utils.tsx`                                                            | Modify        | Colonnes de regroupement par type.                                                         |
| `apps/web/store/issue/helpers/base-issues.store.ts`                                                             | Modify        | Clé de regroupement `issue_type`.                                                          |
| `apps/web/hooks/work-item-filters/use-work-item-filters-config.tsx`                                             | Modify        | Configuration du filtre « Type ».                                                          |
| `apps/web/components/work-item-types/filters.test.ts`                                                           | Create        | Test de la configuration du filtre et des constantes de regroupement.                      |

---

### Task 1: Fabriques de test des types

**Files**

- Modify : `apps/api/plane/db/models/__init__.py` (ligne 82 : `from .issue_type import IssueType`)
- Modify : `apps/api/plane/tests/factories.py` (ligne 9 : import des modèles ; fin de fichier)
- Test : `apps/api/plane/tests/unit/models/test_issue_type_factories.py`

**Interfaces**

- Consumes : `IssueType`, `ProjectIssueType` (`plane/db/models/issue_type.py`), `WorkspaceFactory`, `ProjectFactory`.
- Produces : `plane.db.models.ProjectIssueType` (export), `IssueTypeFactory(workspace=..., name=..., is_default=False, is_active=True)`, `ProjectIssueTypeFactory(project=..., issue_type=..., is_default=False)`.

- [ ] **Step 1 : écrire le test qui échoue**

`apps/api/plane/tests/unit/models/test_issue_type_factories.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import ProjectIssueType
from plane.tests.factories import IssueTypeFactory, ProjectIssueTypeFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def test_issue_type_factory_creates_active_non_default_type():
    issue_type = IssueTypeFactory()
    assert issue_type.is_active
    assert not issue_type.is_default


def test_project_issue_type_factory_links_a_type_of_the_project_workspace():
    link = ProjectIssueTypeFactory()
    assert link.issue_type.workspace_id == link.project.workspace_id
    assert ProjectIssueType.objects.filter(pk=link.pk).exists()
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/models/test_issue_type_factories.py -v`
Expected : `ImportError: cannot import name 'ProjectIssueType' from 'plane.db.models'`.

- [ ] **Step 3 : implémentation minimale**

`apps/api/plane/db/models/__init__.py`, remplacer la ligne 82 :

```python
from .issue_type import IssueType, ProjectIssueType
```

`apps/api/plane/tests/factories.py`, remplacer la ligne d'import des modèles :

```python
from plane.db.models import IssueType, ProjectIssueType, User, Workspace, WorkspaceMember, Project, ProjectMember
```

puis ajouter en fin de fichier :

```python
class IssueTypeFactory(factory.django.DjangoModelFactory):
    """Factory for creating IssueType instances"""

    class Meta:
        model = IssueType

    id = factory.LazyFunction(uuid4)
    workspace = factory.SubFactory(WorkspaceFactory)
    name = factory.Sequence(lambda n: f"Type {n}")
    is_default = False
    is_active = True


class ProjectIssueTypeFactory(factory.django.DjangoModelFactory):
    """Factory for creating ProjectIssueType instances"""

    class Meta:
        model = ProjectIssueType

    id = factory.LazyFunction(uuid4)
    project = factory.SubFactory(ProjectFactory)
    workspace = factory.SelfAttribute("project.workspace")
    issue_type = factory.SubFactory(IssueTypeFactory, workspace=factory.SelfAttribute("..project.workspace"))
    is_default = False
```

- [ ] **Step 4 : relancer, le test passe**

Run : la même commande. Expected : `2 passed`.

- [ ] **Step 5 : commit**

```bash
git add apps/api/plane/db/models/__init__.py apps/api/plane/tests/factories.py apps/api/plane/tests/unit/models/test_issue_type_factories.py
git commit -m "test(api): add issue type factories"
```

---

### Task 2: Journal d'audit (spec 3.3)

**Files**

- Create : `apps/api/plane/db/models/audit_log.py`
- Modify : `apps/api/plane/db/models/__init__.py` (après la ligne `from .issue_type import ...`)
- Create : `apps/api/plane/utils/audit.py`
- Create (généré) : `apps/api/plane/db/migrations/0126_auditlog.py`
- Modify (généré) : `apps/api/migrations_lockfile.txt`
- Test : `apps/api/plane/tests/unit/models/test_audit_log.py`

**Interfaces**

- Consumes : `Workspace`, `User`.
- Produces : modèle `AuditLog(workspace, actor, action, target_type, target_id, before, after, created_at)`, table `audit_logs` ; `record_audit(*, workspace_id, actor_id, action: str, target_type: str, target_id, before: dict | None = None, after: dict | None = None) -> AuditLog`.

Choix : `workspace` et `actor` sont des `ForeignKey(on_delete=DO_NOTHING, db_constraint=False, related_name="+")`. La tâche `soft_delete_related_objects` met à NULL les relations `SET_NULL` et parcourt les relations inverses visibles : une relation cachée en `DO_NOTHING` garde la trace intacte quand un workspace ou un utilisateur est supprimé (répudiation, STRIDE).

- [ ] **Step 1 : écrire le test qui échoue**

`apps/api/plane/tests/unit/models/test_audit_log.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest

from plane.db.models import AuditLog
from plane.utils.audit import record_audit

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def _entry(workspace, user):
    return record_audit(
        workspace_id=workspace.id,
        actor_id=user.id,
        action="issue_type.created",
        target_type="issue_type",
        target_id=uuid4(),
        after={"name": "Bug"},
    )


def test_record_audit_appends_an_entry(workspace, create_user):
    entry = _entry(workspace, create_user)
    stored = AuditLog.objects.get(pk=entry.pk)
    assert stored.workspace_id == workspace.id
    assert stored.actor_id == create_user.id
    assert stored.action == "issue_type.created"
    assert stored.target_type == "issue_type"
    assert stored.target_id == entry.target_id
    assert stored.before is None
    assert stored.after == {"name": "Bug"}
    assert stored.created_at is not None


def test_audit_entry_cannot_be_updated(workspace, create_user):
    entry = _entry(workspace, create_user)
    entry.action = "issue_type.tampered"
    with pytest.raises(ValueError):
        entry.save()
    assert AuditLog.objects.get(pk=entry.pk).action == "issue_type.created"


def test_audit_entry_cannot_be_deleted(workspace, create_user):
    entry = _entry(workspace, create_user)
    with pytest.raises(ValueError):
        entry.delete()
    assert AuditLog.objects.filter(pk=entry.pk).exists()
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/models/test_audit_log.py -v`
Expected : `ImportError: cannot import name 'AuditLog' from 'plane.db.models'`.

- [ ] **Step 3 : implémentation minimale**

`apps/api/plane/db/models/audit_log.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Append-only trail of administration actions; the application never updates or deletes a row."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    # DO_NOTHING without a database constraint keeps the trail when the workspace or the user goes away.
    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.DO_NOTHING, db_constraint=False, related_name="+"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING, db_constraint=False, related_name="+"
    )
    action = models.CharField(max_length=64)
    target_type = models.CharField(max_length=64)
    target_id = models.UUIDField()
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Audit Log"
        verbose_name_plural = "Audit Logs"
        db_table = "audit_logs"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["workspace", "-created_at"], name="audit_log_ws_created_idx")]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("Audit log entries are append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Audit log entries are append-only.")
```

`apps/api/plane/db/models/__init__.py`, ajouter après la ligne `from .issue_type import IssueType, ProjectIssueType` :

```python
from .audit_log import AuditLog
```

`apps/api/plane/utils/audit.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import AuditLog


def record_audit(*, workspace_id, actor_id, action, target_type, target_id, before=None, after=None):
    """Append one administration event (R12); before and after must be JSON-serialisable."""
    return AuditLog.objects.create(
        workspace_id=workspace_id,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=before,
        after=after,
    )
```

Générer la migration :

```bash
cd apps/api && uv run python manage.py makemigrations db -n auditlog
```

Expected : `plane/db/migrations/0126_auditlog.py` créé, `migrations_lockfile.txt` contient `db: 0126_auditlog`. Si un autre numéro sort (une migration `db` arrivée par `preview`), garder le fichier généré tel quel et utiliser ce numéro dans les dépendances des tâches 4.

- [ ] **Step 4 : relancer, le test passe**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/models/test_audit_log.py plane/tests/unit/db/test_migrations_lockfile.py -v`
Expected : tous `passed`.

- [ ] **Step 5 : commit**

```bash
git add apps/api/plane/db/models/audit_log.py apps/api/plane/db/models/__init__.py apps/api/plane/utils/audit.py apps/api/plane/db/migrations/0126_auditlog.py apps/api/migrations_lockfile.txt apps/api/plane/tests/unit/models/test_audit_log.py
git commit -m "feat(api): add append-only audit log"
```

---

### Task 3: État initial des types et garde du modèle Issue (invariants 1, 2, 4 ; R10)

**Files**

- Modify : `apps/api/plane/db/models/issue_type.py` (fichier entier, 56 lignes)
- Modify : `apps/api/plane/db/models/issue.py` (imports lignes 18-27 ; `TRACKED_FIELDS` ligne 105 ; `save` lignes 182-184 ; nouvelle méthode après `_ensure_default_state`, ligne 234)
- Test : `apps/api/plane/tests/unit/models/test_issue_type_defaults.py`

**Interfaces**

- Consumes : `IssueType`, `ProjectIssueType`, `IssueTypeFactory`.
- Produces : `DEFAULT_ISSUE_TYPE_NAME = "Tâche"`, `DEFAULT_ISSUE_TYPE_LOGO_PROPS`, `get_or_create_workspace_default_issue_type(workspace_id) -> IssueType`, `ensure_project_default_issue_type(project) -> None`, receveurs `create_workspace_default_issue_type`, `create_project_default_issue_type` ; `Issue._ensure_default_type(kwargs) -> dict`.

Choix : des signaux `post_save` sur `db.Workspace` et `db.Project` couvrent tous les chemins de création trouvés (vue app `WorkSpaceEndpoint.create`, API d'instance `plane/license/api/views/workspace.py`, `create_dummy_data`, `workspace_seed_task`, `ProjectViewSet.create`, API v1 `plane/api/views/project.py`, `dummy_data_task`) sans dupliquer l'appel ; le modèle `User` utilise déjà ce mécanisme (`plane/db/models/user.py` ligne 298). La garde dans `Issue.save` couvre les chemins sans serializer (intake public `plane/space/views/intake.py`, intake v1 `plane/api/views/intake.py`) et le changement de projet (R10). Plane n'expose aucun déplacement de ticket entre projets aujourd'hui : R10 est donc garanti au niveau du modèle et testé ici.

- [ ] **Step 1 : écrire le test qui échoue**

`apps/api/plane/tests/unit/models/test_issue_type_defaults.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import Issue, IssueType, Project, ProjectIssueType, Workspace
from plane.db.models.issue_type import (
    DEFAULT_ISSUE_TYPE_LOGO_PROPS,
    DEFAULT_ISSUE_TYPE_NAME,
    get_or_create_workspace_default_issue_type,
)
from plane.tests.factories import IssueTypeFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def _project_default_type_id(project):
    return ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id


@pytest.fixture
def project(workspace, create_user):
    return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)


def test_workspace_creation_creates_the_default_type(create_user):
    workspace = Workspace.objects.create(name="Fresh", slug="fresh-workspace", owner=create_user)
    default = IssueType.objects.get(workspace=workspace, is_default=True)
    assert default.name == DEFAULT_ISSUE_TYPE_NAME
    assert default.is_active
    assert default.logo_props == DEFAULT_ISSUE_TYPE_LOGO_PROPS
    assert IssueType.objects.filter(workspace=workspace).count() == 1


def test_project_creation_uses_the_workspace_default_as_project_default(workspace, project):
    link = ProjectIssueType.objects.get(project=project, is_default=True)
    assert link.issue_type == IssueType.objects.get(workspace=workspace, is_default=True)
    assert ProjectIssueType.objects.filter(project=project).count() == 1


def test_workspace_default_lookup_is_idempotent(workspace):
    first = get_or_create_workspace_default_issue_type(workspace.id)
    second = get_or_create_workspace_default_issue_type(workspace.id)
    assert first.pk == second.pk
    assert IssueType.objects.filter(workspace=workspace).count() == 1


def test_workspace_default_lookup_promotes_an_existing_tache(workspace):
    IssueType.all_objects.filter(workspace=workspace).delete()
    existing = IssueType.objects.create(workspace=workspace, name="tâche", is_default=False, is_active=False)
    result = get_or_create_workspace_default_issue_type(workspace.id)
    existing.refresh_from_db()
    assert result.pk == existing.pk
    assert existing.is_default and existing.is_active


def test_work_item_without_type_gets_the_project_default(project):
    issue = Issue.objects.create(name="No type", project=project)
    assert issue.type_id == _project_default_type_id(project)


def test_work_item_keeps_a_type_enabled_in_its_project(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    issue = Issue.objects.create(name="Bug item", project=project, type=bug)
    assert issue.type_id == bug.id


def test_work_item_with_a_type_not_enabled_gets_the_project_default(workspace, project):
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    issue = Issue.objects.create(name="Bug item", project=project, type=bug)
    assert issue.type_id == _project_default_type_id(project)


def test_moving_a_work_item_to_a_project_without_its_type_uses_the_target_default(workspace, project, create_user):
    target = Project.objects.create(name="Target", identifier="TGT", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    issue = Issue.objects.get(pk=Issue.objects.create(name="Mover", project=project, type=bug).pk)

    issue.project = target
    issue.save()

    issue.refresh_from_db()
    assert issue.type_id == _project_default_type_id(target)


def test_moving_a_work_item_keeps_a_type_enabled_in_the_target(workspace, project, create_user):
    target = Project.objects.create(name="Target", identifier="TGT", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    ProjectIssueType.objects.create(project=target, issue_type=bug)
    issue = Issue.objects.get(pk=Issue.objects.create(name="Mover", project=project, type=bug).pk)

    issue.project = target
    issue.save()

    issue.refresh_from_db()
    assert issue.type_id == bug.id


def test_partial_save_backfills_a_missing_type(project):
    issue = Issue.objects.create(name="Legacy", project=project)
    Issue.objects.filter(pk=issue.pk).update(type=None)
    issue = Issue.objects.get(pk=issue.pk)

    issue.save(update_fields=["updated_at"])

    issue.refresh_from_db()
    assert issue.type_id == _project_default_type_id(project)
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/models/test_issue_type_defaults.py -v`
Expected : `ImportError: cannot import name 'DEFAULT_ISSUE_TYPE_LOGO_PROPS'`.

- [ ] **Step 3 : implémentation minimale**

`apps/api/plane/db/models/issue_type.py` (fichier entier) :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import copy

# Django imports
from django.db import models, transaction
from django.db.models import Q
from django.db.models.signals import post_save
from django.dispatch import receiver

# Module imports
from .project import ProjectBaseModel
from .base import BaseModel

DEFAULT_ISSUE_TYPE_NAME = "Tâche"
DEFAULT_ISSUE_TYPE_LOGO_PROPS = {"in_use": "icon", "icon": {"name": "check_box", "color": "#6d7b8a"}}


class IssueType(BaseModel):
    workspace = models.ForeignKey("db.Workspace", related_name="issue_types", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    logo_props = models.JSONField(default=dict)
    is_epic = models.BooleanField(default=False)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    level = models.FloatField(default=0)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        verbose_name = "Issue Type"
        verbose_name_plural = "Issue Types"
        db_table = "issue_types"

    def __str__(self):
        return self.name


class ProjectIssueType(ProjectBaseModel):
    issue_type = models.ForeignKey("db.IssueType", related_name="project_issue_types", on_delete=models.CASCADE)
    level = models.PositiveIntegerField(default=0)
    is_default = models.BooleanField(default=False)

    class Meta:
        unique_together = ["project", "issue_type", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "issue_type"],
                condition=Q(deleted_at__isnull=True),
                name="project_issue_type_unique_project_issue_type_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Issue Type"
        verbose_name_plural = "Project Issue Types"
        db_table = "project_issue_types"
        ordering = ("project", "issue_type")

    def __str__(self):
        return f"{self.project} - {self.issue_type}"


def get_or_create_workspace_default_issue_type(workspace_id):
    """Return the workspace default type, creating it when missing (invariant 1)."""
    issue_type = IssueType.objects.filter(workspace_id=workspace_id, is_default=True).first()
    if issue_type is not None:
        return issue_type
    issue_type = IssueType.objects.filter(workspace_id=workspace_id, name__iexact=DEFAULT_ISSUE_TYPE_NAME).first()
    if issue_type is None:
        return IssueType.objects.create(
            workspace_id=workspace_id,
            name=DEFAULT_ISSUE_TYPE_NAME,
            logo_props=copy.deepcopy(DEFAULT_ISSUE_TYPE_LOGO_PROPS),
            is_default=True,
            is_active=True,
        )
    issue_type.is_default = True
    issue_type.is_active = True
    issue_type.save(update_fields=["is_default", "is_active", "updated_at"])
    return issue_type


def ensure_project_default_issue_type(project):
    """Make the workspace default type the project default when the project has none (invariant 2)."""
    with transaction.atomic():
        if ProjectIssueType.objects.filter(project_id=project.id, is_default=True).exists():
            return
        issue_type = get_or_create_workspace_default_issue_type(project.workspace_id)
        link, created = ProjectIssueType.objects.get_or_create(
            project=project, issue_type=issue_type, defaults={"is_default": True}
        )
        if not created:
            link.is_default = True
            link.save(update_fields=["is_default", "updated_at"])


@receiver(post_save, sender="db.Workspace")
def create_workspace_default_issue_type(sender, instance, created, **kwargs):
    if created:
        get_or_create_workspace_default_issue_type(instance.id)


@receiver(post_save, sender="db.Project")
def create_project_default_issue_type(sender, instance, created, **kwargs):
    if created:
        ensure_project_default_issue_type(instance)
```

`apps/api/plane/db/models/issue.py` :

1. Après la ligne `from .state import StateGroup` (ligne 26), ajouter :

```python
from .issue_type import ProjectIssueType
```

2. Remplacer `TRACKED_FIELDS = ["state_id"]` (ligne 105) par :

```python
    TRACKED_FIELDS = ["state_id", "project_id", "type_id"]
```

3. Dans `save`, remplacer les deux premières lignes :

```python
        self._ensure_default_state()
        kwargs = self._sync_completed_at(kwargs)
```

par :

```python
        self._ensure_default_state()
        kwargs = self._ensure_default_type(kwargs)
        kwargs = self._sync_completed_at(kwargs)
```

4. Ajouter, juste après la méthode `_ensure_default_state` :

```python
    def _ensure_default_type(self, kwargs):
        """Use the project default type when the type is missing or not enabled in the project. Returns kwargs."""
        if self.type_id is not None and not self._state.adding and not self.has_changed("project_id"):
            return kwargs
        if (
            self.type_id is not None
            and ProjectIssueType.objects.filter(
                project_id=self.project_id, issue_type_id=self.type_id, issue_type__deleted_at__isnull=True
            ).exists()
        ):
            return kwargs
        default_type_id = (
            ProjectIssueType.objects.filter(project_id=self.project_id, is_default=True)
            .values_list("issue_type_id", flat=True)
            .first()
        )
        if default_type_id is None:
            return kwargs
        self.type_id = default_type_id
        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            kwargs["update_fields"] = list(set(update_fields) | {"type"})
        return kwargs
```

- [ ] **Step 4 : relancer, les tests passent**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/models plane/tests/unit/bg_tasks/test_issue_activity_scope.py plane/tests/contract/app/test_issue_read_only_fields_app.py -v`
Expected : tous `passed` (les tests existants qui créent des tickets restent verts).

- [ ] **Step 5 : commit**

```bash
git add apps/api/plane/db/models/issue_type.py apps/api/plane/db/models/issue.py apps/api/plane/tests/unit/models/test_issue_type_defaults.py
git commit -m "feat(api): give every workspace, project and work item a default type"
```

---

### Task 4: Migration de données et contraintes (spec 3.4)

**Files**

- Create : `apps/api/plane/db/migrations/0127_backfill_work_item_types.py`
- Modify : `apps/api/plane/db/models/issue_type.py` (`IssueType.Meta`, `ProjectIssueType.Meta.constraints`, import `Lower`)
- Create (généré) : `apps/api/plane/db/migrations/0128_work_item_type_constraints.py`
- Modify (généré) : `apps/api/migrations_lockfile.txt`
- Test : `apps/api/plane/tests/unit/db/test_backfill_work_item_types.py`, `apps/api/plane/tests/unit/models/test_issue_type_constraints.py`

**Interfaces**

- Consumes : modèles historiques `db.Workspace`, `db.Project`, `db.IssueType`, `db.ProjectIssueType`, `db.Issue`.
- Produces : `backfill_work_item_types(apps, schema_editor)`, constante de module `BATCH_SIZE = 1000` ; contraintes `issue_type_unique_lower_name_workspace_when_deleted_at_null`, `issue_type_unique_default_workspace_when_deleted_at_null`, `project_issue_type_unique_default_project_when_deleted_at_null`.

Constat de code : la spec indique une contrainte existante d'unicité du nom par workspace ; la migration `0074_deploy_board_and_project_issues` la supprime (dernière opération). Cette tâche crée la contrainte, insensible à la casse comme l'exige R4, et ajoute l'unicité du défaut (invariants 1 et 2) en défense en profondeur. La migration de données s'exécute avant les contraintes et normalise les doublons de défaut. Elle est `atomic = False` et chaque lot de 1000 tickets est sa propre transaction, pour ne pas garder de verrous longs sur `issues`.

- [ ] **Step 1 : écrire les tests qui échouent**

`apps/api/plane/tests/unit/db/test_backfill_work_item_types.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from importlib import import_module

import pytest
from django.apps import apps as django_apps

from plane.db.models import Issue, IssueType, Project, ProjectIssueType
from plane.tests.factories import IssueTypeFactory

backfill = import_module("plane.db.migrations.0127_backfill_work_item_types")

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def legacy_project(workspace, create_user):
    project = Project.objects.create(name="Legacy", identifier="LEG", workspace=workspace, created_by=create_user)
    # Simulates data created before this feature: no type anywhere.
    IssueType.all_objects.filter(workspace=workspace).delete()
    Issue.objects.create(name="Old 1", project=project)
    Issue.objects.create(name="Old 2", project=project)
    Issue.objects.create(name="Old 3", project=project)
    return project


def test_backfill_restores_the_invariants(workspace, legacy_project):
    assert Issue.objects.filter(project=legacy_project, type__isnull=True).count() == 3

    backfill.backfill_work_item_types(django_apps, None)

    default = IssueType.objects.get(workspace=workspace, is_default=True)
    assert default.name == "Tâche" and default.is_active
    link = ProjectIssueType.objects.get(project=legacy_project, is_default=True)
    assert link.issue_type_id == default.id
    assert not Issue.objects.filter(project=legacy_project, type__isnull=True).exists()


def test_backfill_is_idempotent(workspace, legacy_project):
    backfill.backfill_work_item_types(django_apps, None)
    counts = (IssueType.objects.count(), ProjectIssueType.objects.count())

    backfill.backfill_work_item_types(django_apps, None)

    assert (IssueType.objects.count(), ProjectIssueType.objects.count()) == counts


def test_backfill_updates_work_items_in_batches(workspace, legacy_project, monkeypatch):
    monkeypatch.setattr(backfill, "BATCH_SIZE", 1)

    backfill.backfill_work_item_types(django_apps, None)

    assert not Issue.objects.filter(project=legacy_project, type__isnull=True).exists()


def test_backfill_keeps_an_existing_project_default(workspace, create_user):
    project = Project.objects.create(name="Kept", identifier="KPT", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.filter(project=project).update(is_default=False)
    ProjectIssueType.objects.create(project=project, issue_type=bug, is_default=True)

    backfill.backfill_work_item_types(django_apps, None)

    assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == bug.id

```

`apps/api/plane/tests/unit/models/test_issue_type_constraints.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from plane.db.models import IssueType, Project, ProjectIssueType
from plane.tests.factories import IssueTypeFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def test_type_names_are_unique_per_workspace_ignoring_case(workspace):
    IssueTypeFactory(workspace=workspace, name="Bug")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            IssueTypeFactory(workspace=workspace, name="bUG")


def test_the_name_of_a_deleted_type_can_be_reused(workspace):
    deleted = IssueTypeFactory(workspace=workspace, name="Bug")
    IssueType.all_objects.filter(pk=deleted.pk).update(deleted_at=timezone.now())
    assert IssueTypeFactory(workspace=workspace, name="Bug").pk != deleted.pk


def test_a_workspace_has_at_most_one_default_type(workspace):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            IssueTypeFactory(workspace=workspace, name="Second default", is_default=True)


def test_a_project_has_at_most_one_default_type(workspace, create_user):
    project = Project.objects.create(name="P", identifier="P", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ProjectIssueType.objects.create(project=project, issue_type=bug, is_default=True)
```

Le cas « deux défauts dans un workspace » n'est constructible qu'avant la migration 0128 (la base de test porte déjà les contraintes) ; il est traité par `_ensure_workspace_default` sans test dédié.

- [ ] **Step 2 : lancer les tests et constater l'échec**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/db/test_backfill_work_item_types.py plane/tests/unit/models/test_issue_type_constraints.py -v`
Expected : `ModuleNotFoundError: No module named 'plane.db.migrations.0127_backfill_work_item_types'` et, pour les contraintes, `Failed: DID NOT RAISE <class 'django.db.utils.IntegrityError'>`.

- [ ] **Step 3 : implémentation minimale**

Créer la migration vide puis remplacer son contenu :

```bash
cd apps/api && uv run python manage.py makemigrations db --empty -n backfill_work_item_types
```

`apps/api/plane/db/migrations/0127_backfill_work_item_types.py` (contenu entier) :

```python
from django.db import migrations, transaction

DEFAULT_ISSUE_TYPE_NAME = "Tâche"
DEFAULT_ISSUE_TYPE_LOGO_PROPS = {"in_use": "icon", "icon": {"name": "check_box", "color": "#6d7b8a"}}
BATCH_SIZE = 1000


def _ensure_workspace_default(IssueType, workspace_id):
    types = IssueType._base_manager.filter(workspace_id=workspace_id, deleted_at__isnull=True)
    defaults = list(types.filter(is_default=True).order_by("created_at", "id"))
    if defaults:
        kept = defaults[0]
        types.filter(is_default=True).exclude(pk=kept.pk).update(is_default=False)
        if not kept.is_active:
            types.filter(pk=kept.pk).update(is_active=True)
        return kept.id
    existing = types.filter(name__iexact=DEFAULT_ISSUE_TYPE_NAME).first()
    if existing is not None:
        types.filter(pk=existing.pk).update(is_default=True, is_active=True)
        return existing.id
    return IssueType._base_manager.create(
        workspace_id=workspace_id,
        name=DEFAULT_ISSUE_TYPE_NAME,
        logo_props={"in_use": "icon", "icon": dict(DEFAULT_ISSUE_TYPE_LOGO_PROPS["icon"])},
        is_default=True,
        is_active=True,
    ).id


def _ensure_project_default(IssueType, ProjectIssueType, project_id, workspace_id):
    workspace_type_id = _ensure_workspace_default(IssueType, workspace_id)
    links = ProjectIssueType._base_manager.filter(project_id=project_id, deleted_at__isnull=True)
    usable_defaults = list(
        links.filter(is_default=True, issue_type__is_active=True, issue_type__deleted_at__isnull=True).order_by(
            "created_at", "id"
        )
    )
    if usable_defaults:
        kept = usable_defaults[0]
        links.filter(is_default=True).exclude(pk=kept.pk).update(is_default=False)
        return kept.issue_type_id
    links.filter(is_default=True).update(is_default=False)
    link = links.filter(issue_type_id=workspace_type_id).first()
    if link is None:
        ProjectIssueType._base_manager.create(
            project_id=project_id, workspace_id=workspace_id, issue_type_id=workspace_type_id, is_default=True
        )
    else:
        links.filter(pk=link.pk).update(is_default=True)
    return workspace_type_id


def _backfill_issues(Issue, project_id, type_id):
    while True:
        with transaction.atomic():
            ids = list(
                Issue._base_manager.filter(project_id=project_id, type__isnull=True).values_list("id", flat=True)[
                    :BATCH_SIZE
                ]
            )
            if not ids:
                return
            Issue._base_manager.filter(id__in=ids).update(type_id=type_id)


def backfill_work_item_types(apps, schema_editor):
    """Give every workspace and project a default type and every work item a type (spec 3.4); idempotent."""
    Workspace = apps.get_model("db", "Workspace")
    Project = apps.get_model("db", "Project")
    IssueType = apps.get_model("db", "IssueType")
    ProjectIssueType = apps.get_model("db", "ProjectIssueType")
    Issue = apps.get_model("db", "Issue")

    for workspace_id in Workspace._base_manager.filter(deleted_at__isnull=True).values_list("id", flat=True):
        with transaction.atomic():
            _ensure_workspace_default(IssueType, workspace_id)

    projects = Project._base_manager.filter(deleted_at__isnull=True).values_list("id", "workspace_id")
    for project_id, workspace_id in projects:
        with transaction.atomic():
            type_id = _ensure_project_default(IssueType, ProjectIssueType, project_id, workspace_id)
        _backfill_issues(Issue, project_id, type_id)


class Migration(migrations.Migration):
    # Each batch commits on its own so the issues table is never locked for the whole backfill.
    atomic = False

    dependencies = [
        ("db", "0126_auditlog"),
    ]

    operations = [
        migrations.RunPython(backfill_work_item_types, migrations.RunPython.noop),
    ]
```

Puis, dans `apps/api/plane/db/models/issue_type.py` :

- ajouter l'import `from django.db.models.functions import Lower` sous `from django.db.models import Q` ;
- dans `IssueType.Meta`, après `db_table = "issue_types"`, ajouter :

```python
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                "workspace",
                condition=Q(deleted_at__isnull=True),
                name="issue_type_unique_lower_name_workspace_when_deleted_at_null",
            ),
            models.UniqueConstraint(
                fields=["workspace"],
                condition=Q(is_default=True, deleted_at__isnull=True),
                name="issue_type_unique_default_workspace_when_deleted_at_null",
            ),
        ]
```

- dans `ProjectIssueType.Meta.constraints`, ajouter après la contrainte existante :

```python
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(is_default=True, deleted_at__isnull=True),
                name="project_issue_type_unique_default_project_when_deleted_at_null",
            ),
```

Générer la migration de schéma :

```bash
cd apps/api && uv run python manage.py makemigrations db -n work_item_type_constraints
```

Expected : `0128_work_item_type_constraints.py` contient trois `AddConstraint` et dépend de `0127_backfill_work_item_types` ; `migrations_lockfile.txt` contient `db: 0128_work_item_type_constraints`.

- [ ] **Step 4 : relancer, les tests passent**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/db plane/tests/unit/models -v`
Expected : tous `passed`.

Vérifier aussi l'ordre réel des migrations sur une base vide : `docker compose -f docker-compose-test.yml run --rm --build api-tests python manage.py migrate --plan | tail -5` liste `0126`, `0127`, `0128` dans cet ordre.

- [ ] **Step 5 : commit**

```bash
git add apps/api/plane/db/migrations/0127_backfill_work_item_types.py apps/api/plane/db/migrations/0128_work_item_type_constraints.py apps/api/plane/db/models/issue_type.py apps/api/migrations_lockfile.txt apps/api/plane/tests/unit/db/test_backfill_work_item_types.py apps/api/plane/tests/unit/models/test_issue_type_constraints.py
git commit -m "feat(api): backfill work item types and enforce their uniqueness"
```

---

### Task 5: API des types du workspace (R1, R2, R4, R5, R6, R7, R12)

**Files**

- Create : `apps/api/plane/app/serializers/issue_type.py`
- Modify : `apps/api/plane/app/serializers/__init__.py` (après la ligne 129 `from .webhook import ...`)
- Create : `apps/api/plane/app/views/issue_type/base.py`
- Modify : `apps/api/plane/app/views/__init__.py` (après le bloc `from .webhook.base import (...)`, lignes 230-234)
- Create : `apps/api/plane/app/urls/issue_type.py`
- Modify : `apps/api/plane/app/urls/__init__.py` (imports lignes 5-24, liste `urlpatterns` lignes 26-47)
- Test : `apps/api/plane/tests/contract/app/test_workspace_issue_types_app.py`

**Interfaces**

- Consumes : `record_audit` (tâche 2), `DEFAULT_ISSUE_TYPE_LOGO_PROPS` (tâche 3), `allow_permission`, `ROLE`, `BaseAPIView`.
- Produces :
  - `clean_logo_props(value) -> dict` ; `IssueTypeSerializer` (champs `id, name, description, logo_props, is_active, is_default, issue_count, project_default_count, created_at, updated_at`, contexte `workspace_id` requis).
  - `count_subquery(queryset, field)`, `workspace_issue_types(slug) -> QuerySet[IssueType]` annoté `issue_count`, `project_default_count` ; `issue_type_snapshot(issue_type) -> dict`.
  - `WorkspaceIssueTypeEndpoint` : `get(slug, pk=None)`, `post(slug, pk=None)`, `patch(slug, pk=None)`, `delete(slug, pk=None)`.
  - Routes `workspaces/<str:slug>/issue-types/` et `workspaces/<str:slug>/issue-types/<uuid:pk>/` (nom `workspace-issue-types`).
  - Actions d'audit `issue_type.created`, `issue_type.updated`, `issue_type.deleted`.

Règles de validation à la frontière (spec 7) : `name` nettoyé (`trim_whitespace`), obligatoire, 255 caractères au plus, unique sans tenir compte de la casse ; `description` 1000 caractères au plus ; `logo_props` limité à la forme écrite par le frontend (`TLogoProps` de `packages/types/src/common.ts`) : `{}`, `{"in_use": "emoji", "emoji": {"value": "128512"}}` (codes décimaux joints par `-`, cf. `emojiToString`) ou `{"in_use": "icon", "icon": {"name": "...", "color": "#rrggbb", "background_color": "#rrggbb"}}` ; la clé `emoji.url` est refusée (pas d'URL tierce chargée par les autres membres). `is_default` n'accepte que `true` en PATCH : on ne retire le défaut qu'en en choisissant un autre (R5).

- [ ] **Step 1 : écrire le test qui échoue**

`apps/api/plane/tests/contract/app/test_workspace_issue_types_app.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import AuditLog, Issue, IssueType, Project, ProjectIssueType, WorkspaceMember
from plane.db.models.issue_type import DEFAULT_ISSUE_TYPE_LOGO_PROPS
from plane.tests.factories import IssueTypeFactory, UserFactory, WorkspaceFactory

LIST_URL = "/api/workspaces/{slug}/issue-types/"
DETAIL_URL = "/api/workspaces/{slug}/issue-types/{pk}/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def users(db, workspace, create_user):
    member = UserFactory()
    guest = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
    return {"admin": create_user, "member": member, "guest": guest}


@pytest.fixture
def default_type(workspace):
    return IssueType.objects.get(workspace=workspace, is_default=True)


@pytest.fixture
def bug(workspace):
    return IssueTypeFactory(workspace=workspace, name="Bug")


@pytest.fixture
def project(workspace, create_user):
    return Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkspaceIssueTypeRead:
    @pytest.mark.parametrize("role", ["admin", "member", "guest"])
    def test_every_member_lists_types_with_counts(self, workspace, users, default_type, bug, project, role):
        Issue.objects.create(name="Item", project=project)

        response = _client(users[role]).get(LIST_URL.format(slug=workspace.slug))

        assert response.status_code == status.HTTP_200_OK, response.data
        rows = {row["id"]: row for row in response.data}
        assert list(rows)[0] == str(default_type.id)
        assert rows[str(default_type.id)]["issue_count"] == 1
        assert rows[str(default_type.id)]["project_default_count"] == 1
        assert rows[str(default_type.id)]["is_default"] is True
        assert rows[str(bug.id)]["issue_count"] == 0

    @pytest.mark.parametrize("role", ["admin", "member", "guest"])
    def test_every_member_reads_one_type(self, workspace, users, bug, role):
        response = _client(users[role]).get(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))
        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["name"] == "Bug"

    def test_non_member_is_refused(self, workspace, bug):
        response = _client(UserFactory()).get(LIST_URL.format(slug=workspace.slug))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_a_type_of_another_workspace_looks_missing(self, workspace, users):
        foreign = IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign")
        client = _client(users["admin"])

        missing = client.get(DETAIL_URL.format(slug=workspace.slug, pk=uuid4()))
        hidden = client.get(DETAIL_URL.format(slug=workspace.slug, pk=foreign.id))

        assert missing.status_code == hidden.status_code == status.HTTP_404_NOT_FOUND
        assert missing.data == hidden.data


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkspaceIssueTypeWrite:
    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_non_admins_cannot_write(self, workspace, users, bug, role, mock_celery):
        client = _client(users[role])

        created = client.post(LIST_URL.format(slug=workspace.slug), {"name": "Story"}, format="json")
        updated = client.patch(DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"name": "Story"}, format="json")
        deleted = client.delete(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))

        assert created.status_code == updated.status_code == deleted.status_code == status.HTTP_403_FORBIDDEN
        bug.refresh_from_db()
        assert bug.name == "Bug" and bug.deleted_at is None
        assert not IssueType.objects.filter(workspace=workspace, name="Story").exists()
        assert not AuditLog.objects.exists()

    def test_admin_creates_a_type_with_a_trimmed_name_and_the_default_icon(self, workspace, users):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "  Story  ", "description": "User need"}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        created = IssueType.objects.get(pk=response.data["id"])
        assert created.name == "Story"
        assert created.is_active and not created.is_default
        assert created.logo_props == DEFAULT_ISSUE_TYPE_LOGO_PROPS
        assert response.data["issue_count"] == 0
        entry = AuditLog.objects.get(target_id=created.id)
        assert entry.action == "issue_type.created"
        assert entry.actor_id == users["admin"].id
        assert entry.workspace_id == workspace.id
        assert entry.before is None
        assert entry.after["name"] == "Story"

    def test_is_default_cannot_be_set_at_creation(self, workspace, users, default_type):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "Story", "is_default": True}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert IssueType.objects.get(workspace=workspace, is_default=True) == default_type

    @pytest.mark.parametrize("name", ["", "   ", "x" * 256, "bug", " BUG "])
    def test_invalid_names_are_rejected(self, workspace, users, bug, name):
        response = _client(users["admin"]).post(LIST_URL.format(slug=workspace.slug), {"name": name}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "name" in response.data
        assert not AuditLog.objects.exists()

    def test_too_long_description_is_rejected(self, workspace, users):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "Story", "description": "x" * 1001}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize(
        "logo_props",
        [
            {"in_use": "icon", "icon": {"name": "bug_report", "color": "red"}},
            {"in_use": "icon", "icon": {"name": "<script>", "color": "#ff0000"}},
            {"in_use": "icon", "icon": {"name": "bug_report"}, "extra": 1},
            {"in_use": "emoji", "emoji": {"value": "128512", "url": "https://tracker.example/pixel.png"}},
            {"in_use": "emoji", "emoji": {"value": "smile"}},
            {"in_use": "image"},
            "not-an-object",
        ],
    )
    def test_unexpected_logo_props_are_rejected(self, workspace, users, logo_props):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "Story", "logo_props": logo_props}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "logo_props" in response.data

    @pytest.mark.parametrize(
        "logo_props",
        [
            {"in_use": "icon", "icon": {"name": "bug_report", "color": "#e57a00", "background_color": "#FFFFFF"}},
            {"in_use": "emoji", "emoji": {"value": "128104-8205-128187"}},
        ],
    )
    def test_expected_logo_props_are_stored(self, workspace, users, logo_props):
        response = _client(users["admin"]).post(
            LIST_URL.format(slug=workspace.slug), {"name": "Story", "logo_props": logo_props}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert IssueType.objects.get(pk=response.data["id"]).logo_props == logo_props

    def test_admin_renames_a_type_and_the_audit_keeps_before_and_after(self, workspace, users, bug):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"name": "Defect"}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["name"] == "Defect"
        entry = AuditLog.objects.get(target_id=bug.id, action="issue_type.updated")
        assert entry.before["name"] == "Bug"
        assert entry.after["name"] == "Defect"

    def test_renaming_to_an_existing_name_ignoring_case_is_rejected(self, workspace, users, bug, default_type):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"name": default_type.name.upper()}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_setting_a_new_default_removes_the_previous_one(self, workspace, users, default_type, bug):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"is_default": True}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        default_type.refresh_from_db()
        bug.refresh_from_db()
        assert bug.is_default and not default_type.is_default
        assert IssueType.objects.filter(workspace=workspace, is_default=True).count() == 1
        entry = AuditLog.objects.get(target_id=bug.id, action="issue_type.updated")
        assert entry.before["is_default"] is False and entry.after["is_default"] is True

    def test_unsetting_the_default_is_rejected(self, workspace, users, default_type):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=default_type.id), {"is_default": False}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        default_type.refresh_from_db()
        assert default_type.is_default

    def test_the_default_type_cannot_be_deactivated(self, workspace, users, default_type):
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=default_type.id), {"is_active": False}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        default_type.refresh_from_db()
        assert default_type.is_active

    def test_an_inactive_type_cannot_become_the_default(self, workspace, users, bug):
        IssueType.objects.filter(pk=bug.pk).update(is_active=False)
        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"is_default": True}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_a_project_default_type_cannot_be_deactivated(self, workspace, users, bug, project):
        ProjectIssueType.objects.filter(project=project).update(is_default=False)
        ProjectIssueType.objects.create(project=project, issue_type=bug, is_default=True)

        response = _client(users["admin"]).patch(
            DETAIL_URL.format(slug=workspace.slug, pk=bug.id), {"is_active": False}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        bug.refresh_from_db()
        assert bug.is_active

    def test_a_type_can_be_deactivated_then_reactivated(self, workspace, users, bug):
        client = _client(users["admin"])
        url = DETAIL_URL.format(slug=workspace.slug, pk=bug.id)

        assert client.patch(url, {"is_active": False}, format="json").status_code == status.HTTP_200_OK
        bug.refresh_from_db()
        assert not bug.is_active
        assert client.patch(url, {"is_active": True}, format="json").status_code == status.HTTP_200_OK
        bug.refresh_from_db()
        assert bug.is_active

    def test_the_default_type_cannot_be_deleted(self, workspace, users, default_type, mock_celery):
        response = _client(users["admin"]).delete(DETAIL_URL.format(slug=workspace.slug, pk=default_type.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert IssueType.objects.filter(pk=default_type.pk).exists()

    def test_a_type_used_by_work_items_cannot_be_deleted(self, workspace, users, bug, project, mock_celery):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        Issue.objects.create(name="Bug item", project=project, type=bug)

        response = _client(users["admin"]).delete(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert IssueType.objects.filter(pk=bug.pk).exists()

    def test_a_type_used_only_by_deleted_work_items_is_soft_deleted(self, workspace, users, bug, project, mock_celery):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        issue = Issue.objects.create(name="Gone", project=project, type=bug)
        Issue.all_objects.filter(pk=issue.pk).update(deleted_at=timezone.now())

        response = _client(users["admin"]).delete(DETAIL_URL.format(slug=workspace.slug, pk=bug.id))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not IssueType.objects.filter(pk=bug.pk).exists()
        assert IssueType.all_objects.get(pk=bug.pk).deleted_at is not None
        entry = AuditLog.objects.get(target_id=bug.id, action="issue_type.deleted")
        assert entry.before["name"] == "Bug" and entry.after is None

    def test_admin_cannot_touch_a_type_of_another_workspace(self, workspace, users, mock_celery):
        foreign = IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign")
        client = _client(users["admin"])
        url = DETAIL_URL.format(slug=workspace.slug, pk=foreign.id)

        assert client.patch(url, {"name": "Hijack"}, format="json").status_code == status.HTTP_404_NOT_FOUND
        assert client.delete(url).status_code == status.HTTP_404_NOT_FOUND
        foreign.refresh_from_db()
        assert foreign.name == "Foreign" and foreign.deleted_at is None
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workspace_issue_types_app.py -v`
Expected : échecs `assert 404 == 200` (route inconnue) sur toutes les requêtes.

- [ ] **Step 3 : implémentation minimale**

`apps/api/plane/app/serializers/issue_type.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import re

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import IssueType
from .base import BaseSerializer

LOGO_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")
LOGO_ICON_NAME_PATTERN = re.compile(r"^[a-z0-9_-]{1,64}$")
LOGO_EMOJI_PATTERN = re.compile(r"^[0-9]{1,7}(-[0-9]{1,7}){0,9}$")
INVALID_LOGO_PROPS_MESSAGE = "logo_props must be an emoji code or a named icon with hexadecimal colours."


def clean_logo_props(value):
    """Keep only the logo shape the web app writes, so no URL or markup is stored for other members."""
    if not isinstance(value, dict):
        raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
    if not value:
        return {}
    if set(value) - {"in_use", "emoji", "icon"}:
        raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
    if value.get("in_use") == "emoji":
        emoji = value.get("emoji")
        if (
            not isinstance(emoji, dict)
            or set(emoji) != {"value"}
            or not isinstance(emoji["value"], str)
            or not LOGO_EMOJI_PATTERN.match(emoji["value"])
        ):
            raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
        return {"in_use": "emoji", "emoji": {"value": emoji["value"]}}
    if value.get("in_use") == "icon":
        icon = value.get("icon")
        if not isinstance(icon, dict) or set(icon) - {"name", "color", "background_color"}:
            raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
        name = icon.get("name")
        if not isinstance(name, str) or not LOGO_ICON_NAME_PATTERN.match(name):
            raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
        cleaned = {"name": name}
        for key in ("color", "background_color"):
            if key in icon:
                if not isinstance(icon[key], str) or not LOGO_COLOR_PATTERN.match(icon[key]):
                    raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
                cleaned[key] = icon[key]
        return {"in_use": "icon", "icon": cleaned}
    raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)


class IssueTypeSerializer(BaseSerializer):
    name = serializers.CharField(max_length=255, trim_whitespace=True)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True, trim_whitespace=True)
    logo_props = serializers.JSONField(required=False)
    issue_count = serializers.IntegerField(read_only=True)
    project_default_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = IssueType
        fields = [
            "id",
            "name",
            "description",
            "logo_props",
            "is_active",
            "is_default",
            "issue_count",
            "project_default_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_default", "created_at", "updated_at"]

    def validate_name(self, value):
        duplicates = IssueType.objects.filter(workspace_id=self.context["workspace_id"], name__iexact=value)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError("A work item type with this name already exists.")
        return value

    def validate_logo_props(self, value):
        return clean_logo_props(value)
```

`apps/api/plane/app/serializers/__init__.py`, après la ligne `from .webhook import WebhookSerializer, WebhookLogSerializer` :

```python
from .issue_type import IssueTypeSerializer
```

`apps/api/plane/app/views/issue_type/base.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import copy

# Django imports
from django.db import transaction
from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import IssueTypeSerializer
from plane.db.models import Issue, IssueType, ProjectIssueType, Workspace
from plane.db.models.issue_type import DEFAULT_ISSUE_TYPE_LOGO_PROPS
from plane.utils.audit import record_audit
from ..base import BaseAPIView


def count_subquery(queryset, field):
    """Correlated row count grouped on field, 0 when no row matches."""
    return Coalesce(
        Subquery(
            queryset.order_by().values(field).annotate(count=Count("id")).values("count")[:1],
            output_field=IntegerField(),
        ),
        Value(0),
    )


def workspace_issue_types(slug):
    return IssueType.objects.filter(workspace__slug=slug).annotate(
        issue_count=count_subquery(Issue.objects.filter(type_id=OuterRef("pk")), "type_id"),
        project_default_count=count_subquery(
            ProjectIssueType.objects.filter(issue_type_id=OuterRef("pk"), is_default=True), "issue_type_id"
        ),
    )


def issue_type_snapshot(issue_type):
    return {
        "name": issue_type.name,
        "description": issue_type.description,
        "logo_props": issue_type.logo_props,
        "is_active": issue_type.is_active,
        "is_default": issue_type.is_default,
    }


def _issue_type_update_error(issue_type, is_active, make_default):
    """Return why the update would break R5 or invariant 2, or None."""
    if make_default and not is_active:
        return "An inactive work item type cannot be the default."
    if not is_active and issue_type.is_default:
        return "The default work item type cannot be deactivated."
    if (
        not is_active
        and issue_type.is_active
        and ProjectIssueType.objects.filter(issue_type=issue_type, is_default=True).exists()
    ):
        return "This work item type is the default of a project."
    return None


METHOD_NOT_ALLOWED = {"error": "Method not allowed on this route."}


class WorkspaceIssueTypeEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, pk=None):
        issue_types = workspace_issue_types(slug)
        if pk is None:
            serializer = IssueTypeSerializer(issue_types.order_by("-is_default", "name"), many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(IssueTypeSerializer(issue_types.get(pk=pk)).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk=None):
        if pk is not None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        workspace = Workspace.objects.get(slug=slug)
        serializer = IssueTypeSerializer(data=request.data, context={"workspace_id": workspace.id})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            issue_type = serializer.save(
                workspace_id=workspace.id,
                logo_props=serializer.validated_data.get("logo_props")
                or copy.deepcopy(DEFAULT_ISSUE_TYPE_LOGO_PROPS),
            )
            record_audit(
                workspace_id=workspace.id,
                actor_id=request.user.id,
                action="issue_type.created",
                target_type="issue_type",
                target_id=issue_type.id,
                after=issue_type_snapshot(issue_type),
            )
        data = IssueTypeSerializer(workspace_issue_types(slug).get(pk=issue_type.pk)).data
        return Response(data, status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        make_default = request.data.get("is_default")
        if make_default not in (None, True):
            return Response(
                {"error": "Choose another default work item type instead of unsetting this one."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            issue_type = IssueType.objects.select_for_update(of=("self",)).get(workspace__slug=slug, pk=pk)
            before = issue_type_snapshot(issue_type)
            serializer = IssueTypeSerializer(
                issue_type, data=request.data, partial=True, context={"workspace_id": issue_type.workspace_id}
            )
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            is_active = serializer.validated_data.get("is_active", issue_type.is_active)
            error = _issue_type_update_error(issue_type, is_active, make_default is True)
            if error:
                return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
            if make_default and not issue_type.is_default:
                # Locking every type of the workspace serialises concurrent default changes (R5).
                workspace_types = IssueType.objects.select_for_update().filter(workspace_id=issue_type.workspace_id)
                list(workspace_types)
                workspace_types.filter(is_default=True).update(is_default=False)
                issue_type = serializer.save(is_default=True)
            else:
                issue_type = serializer.save()
            record_audit(
                workspace_id=issue_type.workspace_id,
                actor_id=request.user.id,
                action="issue_type.updated",
                target_type="issue_type",
                target_id=issue_type.id,
                before=before,
                after=issue_type_snapshot(issue_type),
            )
        return Response(
            IssueTypeSerializer(workspace_issue_types(slug).get(pk=issue_type.pk)).data, status=status.HTTP_200_OK
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk=None):
        if pk is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        issue_type = IssueType.objects.get(workspace__slug=slug, pk=pk)
        if issue_type.is_default:
            return Response(
                {"error": "The default work item type cannot be deleted."}, status=status.HTTP_400_BAD_REQUEST
            )
        if Issue.objects.filter(type_id=issue_type.id).exists():
            return Response(
                {"error": "Work items still use this work item type."}, status=status.HTTP_400_BAD_REQUEST
            )
        before = issue_type_snapshot(issue_type)
        with transaction.atomic():
            issue_type.delete()
            record_audit(
                workspace_id=issue_type.workspace_id,
                actor_id=request.user.id,
                action="issue_type.deleted",
                target_type="issue_type",
                target_id=issue_type.id,
                before=before,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
```

`apps/api/plane/app/views/__init__.py`, après le bloc `from .webhook.base import (...)` :

```python
from .issue_type.base import WorkspaceIssueTypeEndpoint
```

`apps/api/plane/app/urls/issue_type.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import WorkspaceIssueTypeEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/issue-types/",
        WorkspaceIssueTypeEndpoint.as_view(),
        name="workspace-issue-types",
    ),
    path(
        "workspaces/<str:slug>/issue-types/<uuid:pk>/",
        WorkspaceIssueTypeEndpoint.as_view(),
        name="workspace-issue-types",
    ),
]
```

`apps/api/plane/app/urls/__init__.py` : ajouter `from .issue_type import urlpatterns as issue_type_urls` après `from .issue import urlpatterns as issue_urls`, et `*issue_type_urls,` après `*issue_urls,` dans `urlpatterns`.

- [ ] **Step 4 : relancer, les tests passent**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workspace_issue_types_app.py -v`
Expected : tous `passed`.

- [ ] **Step 5 : commit**

```bash
git add apps/api/plane/app/serializers/issue_type.py apps/api/plane/app/serializers/__init__.py apps/api/plane/app/views/issue_type/base.py apps/api/plane/app/views/__init__.py apps/api/plane/app/urls/issue_type.py apps/api/plane/app/urls/__init__.py apps/api/plane/tests/contract/app/test_workspace_issue_types_app.py
git commit -m "feat(api): manage workspace work item types"
```

---

### Task 6: API des types d'un projet (R2, R3, R7, R8, R12)

**Files**

- Modify : `apps/api/plane/app/serializers/issue_type.py` (ajout en fin de fichier)
- Modify : `apps/api/plane/app/serializers/__init__.py` (ligne ajoutée en tâche 5)
- Modify : `apps/api/plane/app/views/issue_type/base.py` (imports ; ajout en fin de fichier)
- Modify : `apps/api/plane/app/views/__init__.py` (ligne ajoutée en tâche 5)
- Modify : `apps/api/plane/app/urls/issue_type.py`
- Test : `apps/api/plane/tests/contract/app/test_project_issue_types_app.py`

**Interfaces**

- Consumes : `count_subquery`, `METHOD_NOT_ALLOWED` (tâche 5), `record_audit`.
- Produces :
  - `ProjectIssueTypeSerializer` (champs `id, project_id, issue_type_id, is_default, issue_count`, tous en lecture seule).
  - `can_manage_project_issue_types(user, slug, project_id) -> bool` (R3 : admin du workspace ou admin du projet).
  - `project_issue_types(slug, project_id) -> QuerySet[ProjectIssueType]` annoté `issue_count` ; `project_issue_type_snapshot(link) -> dict`.
  - `ProjectIssueTypeEndpoint` : `get(slug, project_id, issue_type_id=None)`, `post(slug, project_id, issue_type_id=None)` (corps `{"issue_type_id": "<uuid>"}`), `patch(slug, project_id, issue_type_id=None)` (corps `{"is_default": true}`), `delete(slug, project_id, issue_type_id=None)`.
  - Routes `workspaces/<str:slug>/projects/<uuid:project_id>/issue-types/` et `.../issue-types/<uuid:issue_type_id>/` (nom `project-issue-types`).
  - Actions d'audit `project_issue_type.enabled`, `project_issue_type.default_changed`, `project_issue_type.disabled`.

Choix : `allow_permission(level="PROJECT")` n'accepte un admin du workspace que s'il est aussi membre du projet ; R3 vise tout admin du workspace, d'où la fonction `can_manage_project_issue_types` appelée après le contrôle d'appartenance au workspace.

- [ ] **Step 1 : écrire le test qui échoue**

`apps/api/plane/tests/contract/app/test_project_issue_types_app.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import AuditLog, Issue, IssueType, Project, ProjectIssueType, ProjectMember, WorkspaceMember
from plane.tests.factories import IssueTypeFactory, ProjectFactory, UserFactory, WorkspaceFactory

LIST_URL = "/api/workspaces/{slug}/projects/{project_id}/issue-types/"
DETAIL_URL = "/api/workspaces/{slug}/projects/{project_id}/issue-types/{issue_type_id}/"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def users(db, workspace, create_user):
    member = UserFactory()
    guest = UserFactory()
    project_admin = UserFactory()
    outside_admin = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
    WorkspaceMember.objects.create(workspace=workspace, member=project_admin, role=15)
    WorkspaceMember.objects.create(workspace=workspace, member=outside_admin, role=20)
    return {
        "admin": create_user,
        "member": member,
        "guest": guest,
        "project_admin": project_admin,
        "outside_admin": outside_admin,
    }


@pytest.fixture
def project(workspace, users):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=users["admin"])
    ProjectMember.objects.create(project=project, member=users["admin"], role=20)
    ProjectMember.objects.create(project=project, member=users["member"], role=15)
    ProjectMember.objects.create(project=project, member=users["guest"], role=5)
    ProjectMember.objects.create(project=project, member=users["project_admin"], role=20)
    return project


@pytest.fixture
def default_type(workspace):
    return IssueType.objects.get(workspace=workspace, is_default=True)


@pytest.fixture
def bug(workspace):
    return IssueTypeFactory(workspace=workspace, name="Bug")


def _list_url(workspace, project):
    return LIST_URL.format(slug=workspace.slug, project_id=project.id)


def _detail_url(workspace, project, issue_type):
    return DETAIL_URL.format(slug=workspace.slug, project_id=project.id, issue_type_id=issue_type.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectIssueTypeRead:
    @pytest.mark.parametrize("role", ["admin", "member", "guest", "outside_admin"])
    def test_every_workspace_member_lists_the_project_types(self, workspace, users, project, default_type, role):
        Issue.objects.create(name="Item", project=project)

        response = _client(users[role]).get(_list_url(workspace, project))

        assert response.status_code == status.HTTP_200_OK, response.data
        assert len(response.data) == 1
        assert response.data[0]["issue_type_id"] == default_type.id
        assert response.data[0]["is_default"] is True
        assert response.data[0]["issue_count"] == 1

    def test_non_member_is_refused(self, workspace, project):
        assert _client(UserFactory()).get(_list_url(workspace, project)).status_code == status.HTTP_403_FORBIDDEN

    def test_a_project_of_another_workspace_looks_missing(self, workspace, users):
        foreign_project = ProjectFactory(workspace=WorkspaceFactory())
        client = _client(users["admin"])

        hidden = client.get(LIST_URL.format(slug=workspace.slug, project_id=foreign_project.id))
        missing = client.get(LIST_URL.format(slug=workspace.slug, project_id=uuid4()))

        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectIssueTypeWrite:
    @pytest.mark.parametrize("role", ["member", "guest"])
    def test_non_admins_cannot_change_project_types(self, workspace, users, project, default_type, bug, role, mock_celery):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        client = _client(users[role])

        enabled = client.post(_list_url(workspace, project), {"issue_type_id": str(bug.id)}, format="json")
        defaulted = client.patch(_detail_url(workspace, project, bug), {"is_default": True}, format="json")
        removed = client.delete(_detail_url(workspace, project, bug))

        assert enabled.status_code == defaulted.status_code == removed.status_code == status.HTTP_403_FORBIDDEN
        assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == default_type.id
        assert ProjectIssueType.objects.filter(project=project, issue_type=bug).exists()
        assert not AuditLog.objects.exists()

    @pytest.mark.parametrize("role", ["admin", "project_admin", "outside_admin"])
    def test_project_or_workspace_admins_enable_a_type(self, workspace, users, project, bug, role):
        response = _client(users[role]).post(
            _list_url(workspace, project), {"issue_type_id": str(bug.id)}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        link = ProjectIssueType.objects.get(project=project, issue_type=bug)
        assert response.data["is_default"] is False
        entry = AuditLog.objects.get(target_id=link.id)
        assert entry.action == "project_issue_type.enabled"
        assert entry.actor_id == users[role].id
        assert entry.after == {"project_id": str(project.id), "issue_type_id": str(bug.id), "is_default": False}

    def test_enabling_twice_keeps_a_single_link(self, workspace, users, project, bug):
        client = _client(users["admin"])
        url = _list_url(workspace, project)

        assert client.post(url, {"issue_type_id": str(bug.id)}, format="json").status_code == status.HTTP_201_CREATED
        assert client.post(url, {"issue_type_id": str(bug.id)}, format="json").status_code == status.HTTP_200_OK
        assert ProjectIssueType.objects.filter(project=project, issue_type=bug).count() == 1
        assert AuditLog.objects.filter(action="project_issue_type.enabled").count() == 1

    def test_an_inactive_type_cannot_be_enabled(self, workspace, users, project, bug):
        IssueType.objects.filter(pk=bug.pk).update(is_active=False)
        response = _client(users["admin"]).post(
            _list_url(workspace, project), {"issue_type_id": str(bug.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not ProjectIssueType.objects.filter(project=project, issue_type=bug).exists()

    def test_a_type_of_another_workspace_looks_missing(self, workspace, users, project):
        foreign = IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign")
        client = _client(users["admin"])

        hidden = client.post(_list_url(workspace, project), {"issue_type_id": str(foreign.id)}, format="json")
        missing = client.post(_list_url(workspace, project), {"issue_type_id": str(uuid4())}, format="json")

        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert hidden.data == missing.data
        assert not ProjectIssueType.objects.filter(issue_type=foreign).exists()

    @pytest.mark.parametrize("payload", [{}, {"issue_type_id": "not-a-uuid"}, {"issue_type_id": None}])
    def test_a_missing_or_malformed_type_id_is_rejected(self, workspace, users, project, payload):
        response = _client(users["admin"]).post(_list_url(workspace, project), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_setting_the_project_default_moves_the_flag(self, workspace, users, project, default_type, bug):
        ProjectIssueType.objects.create(project=project, issue_type=bug)

        response = _client(users["project_admin"]).patch(
            _detail_url(workspace, project, bug), {"is_default": True}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["is_default"] is True
        assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == bug.id
        entry = AuditLog.objects.get(action="project_issue_type.default_changed")
        assert entry.before == {"default_issue_type_id": str(default_type.id)}
        assert entry.after == {"default_issue_type_id": str(bug.id)}

    def test_an_inactive_enabled_type_cannot_become_the_project_default(self, workspace, users, project, bug):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        IssueType.objects.filter(pk=bug.pk).update(is_active=False)
        response = _client(users["admin"]).patch(
            _detail_url(workspace, project, bug), {"is_default": True}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_only_setting_the_default_is_supported(self, workspace, users, project, default_type):
        response = _client(users["admin"]).patch(
            _detail_url(workspace, project, default_type), {"is_default": False}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert ProjectIssueType.objects.get(project=project, is_default=True).issue_type_id == default_type.id

    def test_a_type_not_enabled_in_the_project_looks_missing(self, workspace, users, project, bug):
        response = _client(users["admin"]).patch(
            _detail_url(workspace, project, bug), {"is_default": True}, format="json"
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_the_project_default_cannot_be_removed(self, workspace, users, project, default_type, mock_celery):
        response = _client(users["admin"]).delete(_detail_url(workspace, project, default_type))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert ProjectIssueType.objects.filter(project=project, issue_type=default_type).exists()

    def test_a_type_used_by_project_work_items_cannot_be_removed(self, workspace, users, project, bug, mock_celery):
        ProjectIssueType.objects.create(project=project, issue_type=bug)
        Issue.objects.create(name="Bug item", project=project, type=bug)

        response = _client(users["admin"]).delete(_detail_url(workspace, project, bug))

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert ProjectIssueType.objects.filter(project=project, issue_type=bug).exists()

    def test_an_unused_type_is_removed_and_audited(self, workspace, users, project, bug, mock_celery):
        link = ProjectIssueType.objects.create(project=project, issue_type=bug)

        response = _client(users["admin"]).delete(_detail_url(workspace, project, bug))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not ProjectIssueType.objects.filter(pk=link.pk).exists()
        entry = AuditLog.objects.get(target_id=link.id, action="project_issue_type.disabled")
        assert entry.before["issue_type_id"] == str(bug.id) and entry.after is None
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_project_issue_types_app.py -v`
Expected : échecs `assert 404 == 200` (route inconnue).

- [ ] **Step 3 : implémentation minimale**

`apps/api/plane/app/serializers/issue_type.py`, remplacer `from plane.db.models import IssueType` par `from plane.db.models import IssueType, ProjectIssueType` et ajouter en fin de fichier :

```python
class ProjectIssueTypeSerializer(BaseSerializer):
    issue_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = ProjectIssueType
        fields = ["id", "project_id", "issue_type_id", "is_default", "issue_count"]
        read_only_fields = fields
```

`apps/api/plane/app/serializers/__init__.py` : remplacer la ligne de la tâche 5 par `from .issue_type import IssueTypeSerializer, ProjectIssueTypeSerializer`.

`apps/api/plane/app/views/issue_type/base.py` :

- ajouter `import uuid` sous `import copy` ;
- remplacer `from plane.app.serializers import IssueTypeSerializer` par `from plane.app.serializers import IssueTypeSerializer, ProjectIssueTypeSerializer` ;
- remplacer `from plane.db.models import Issue, IssueType, ProjectIssueType, Workspace` par :

```python
from plane.db.models import (
    Issue,
    IssueType,
    Project,
    ProjectIssueType,
    ProjectMember,
    Workspace,
    WorkspaceMember,
)
```

- ajouter en fin de fichier :

```python
FORBIDDEN = {"error": "You don't have the required permissions."}


def can_manage_project_issue_types(user, slug, project_id):
    """R3: workspace admins, even outside the project, and admins of the project."""
    if WorkspaceMember.objects.filter(
        member=user, workspace__slug=slug, role=ROLE.ADMIN.value, is_active=True
    ).exists():
        return True
    return ProjectMember.objects.filter(
        member=user, workspace__slug=slug, project_id=project_id, role=ROLE.ADMIN.value, is_active=True
    ).exists()


def project_issue_types(slug, project_id):
    return ProjectIssueType.objects.filter(
        project_id=project_id, project__workspace__slug=slug, issue_type__deleted_at__isnull=True
    ).annotate(
        issue_count=count_subquery(
            Issue.objects.filter(project_id=OuterRef("project_id"), type_id=OuterRef("issue_type_id")), "type_id"
        )
    )


def project_issue_type_snapshot(link):
    return {"project_id": str(link.project_id), "issue_type_id": str(link.issue_type_id), "is_default": link.is_default}


class ProjectIssueTypeEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, project_id, issue_type_id=None):
        if issue_type_id is not None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        links = project_issue_types(slug, project.id).order_by("-is_default", "issue_type__name")
        return Response(ProjectIssueTypeSerializer(links, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, project_id, issue_type_id=None):
        if issue_type_id is not None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        if not can_manage_project_issue_types(request.user, slug, project_id):
            return Response(FORBIDDEN, status=status.HTTP_403_FORBIDDEN)
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        try:
            requested_type_id = uuid.UUID(str(request.data.get("issue_type_id")))
        except ValueError:
            return Response({"error": "issue_type_id must be a valid UUID."}, status=status.HTTP_400_BAD_REQUEST)
        issue_type = IssueType.objects.get(workspace__slug=slug, pk=requested_type_id)
        if not issue_type.is_active:
            return Response(
                {"error": "An inactive work item type cannot be enabled in a project."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            link, created = ProjectIssueType.objects.get_or_create(project=project, issue_type=issue_type)
            if created:
                record_audit(
                    workspace_id=project.workspace_id,
                    actor_id=request.user.id,
                    action="project_issue_type.enabled",
                    target_type="project_issue_type",
                    target_id=link.id,
                    after=project_issue_type_snapshot(link),
                )
        data = ProjectIssueTypeSerializer(project_issue_types(slug, project.id).get(pk=link.pk)).data
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def patch(self, request, slug, project_id, issue_type_id=None):
        if issue_type_id is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        if not can_manage_project_issue_types(request.user, slug, project_id):
            return Response(FORBIDDEN, status=status.HTTP_403_FORBIDDEN)
        if request.data.get("is_default") is not True:
            return Response(
                {"error": "Only setting is_default to true is supported."}, status=status.HTTP_400_BAD_REQUEST
            )
        with transaction.atomic():
            links = list(
                ProjectIssueType.objects.select_for_update(of=("self",))
                .select_related("issue_type")
                .filter(project_id=project_id, project__workspace__slug=slug, issue_type__deleted_at__isnull=True)
            )
            link = next((item for item in links if item.issue_type_id == issue_type_id), None)
            if link is None:
                raise ProjectIssueType.DoesNotExist
            if not link.issue_type.is_active:
                return Response(
                    {"error": "An inactive work item type cannot be the project default."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            previous = next((item for item in links if item.is_default), None)
            if previous is None or previous.pk != link.pk:
                ProjectIssueType.objects.filter(pk__in=[item.pk for item in links if item.is_default]).update(
                    is_default=False
                )
                link.is_default = True
                link.save(update_fields=["is_default", "updated_at"])
                record_audit(
                    workspace_id=link.workspace_id,
                    actor_id=request.user.id,
                    action="project_issue_type.default_changed",
                    target_type="project_issue_type",
                    target_id=link.id,
                    before={"default_issue_type_id": str(previous.issue_type_id) if previous else None},
                    after={"default_issue_type_id": str(link.issue_type_id)},
                )
        data = ProjectIssueTypeSerializer(project_issue_types(slug, project_id).get(pk=link.pk)).data
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def delete(self, request, slug, project_id, issue_type_id=None):
        if issue_type_id is None:
            return Response(METHOD_NOT_ALLOWED, status=status.HTTP_405_METHOD_NOT_ALLOWED)
        if not can_manage_project_issue_types(request.user, slug, project_id):
            return Response(FORBIDDEN, status=status.HTTP_403_FORBIDDEN)
        link = ProjectIssueType.objects.get(
            project_id=project_id, project__workspace__slug=slug, issue_type_id=issue_type_id
        )
        if link.is_default:
            return Response(
                {"error": "The project default work item type cannot be removed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Issue.objects.filter(project_id=project_id, type_id=issue_type_id).exists():
            return Response(
                {"error": "Work items of this project use this work item type."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        before = project_issue_type_snapshot(link)
        with transaction.atomic():
            link.delete()
            record_audit(
                workspace_id=link.workspace_id,
                actor_id=request.user.id,
                action="project_issue_type.disabled",
                target_type="project_issue_type",
                target_id=link.id,
                before=before,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
```

`apps/api/plane/app/views/__init__.py` : remplacer la ligne de la tâche 5 par `from .issue_type.base import WorkspaceIssueTypeEndpoint, ProjectIssueTypeEndpoint`.

`apps/api/plane/app/urls/issue_type.py` : importer `ProjectIssueTypeEndpoint` à côté de `WorkspaceIssueTypeEndpoint` et ajouter à `urlpatterns` :

```python
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issue-types/",
        ProjectIssueTypeEndpoint.as_view(),
        name="project-issue-types",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issue-types/<uuid:issue_type_id>/",
        ProjectIssueTypeEndpoint.as_view(),
        name="project-issue-types",
    ),
```

- [ ] **Step 4 : relancer, les tests passent**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_project_issue_types_app.py plane/tests/contract/app/test_workspace_issue_types_app.py -v`
Expected : tous `passed`.

- [ ] **Step 5 : commit**

```bash
git add apps/api/plane/app/serializers/issue_type.py apps/api/plane/app/serializers/__init__.py apps/api/plane/app/views/issue_type/base.py apps/api/plane/app/views/__init__.py apps/api/plane/app/urls/issue_type.py apps/api/plane/tests/contract/app/test_project_issue_types_app.py
git commit -m "feat(api): choose work item types per project"
```

---

### Task 7: Type contrôlé dans chaque chemin d'écriture (R7, R9) et `type_id` dans les réponses

**Files**

- Create : `apps/api/plane/utils/issue_types.py`
- Modify : `apps/api/plane/app/serializers/issue.py` (imports lignes 20-50 ; `IssueCreateSerializer` lignes 98-116 et fin de `validate` ligne ~180 ; `IssueSerializer.Meta.fields` ligne 821 ; `IssueListDetailSerializer.to_representation` ligne 871)
- Modify : `apps/api/plane/app/serializers/draft.py` (imports ; champs lignes 37-52 ; `read_only_fields` lignes 57-64 ; `validate` lignes 143-152)
- Modify : `apps/api/plane/api/serializers/issue.py` (import `IssueType` ligne 16 ; `type_id` lignes 66-68 ; `read_only_fields` lignes 73-84 ; fin de `validate` ligne ~182 ; `create` lignes 192-199)
- Modify : `apps/api/plane/space/serializer/issue.py` (`IssueCreateSerializer.Meta.read_only_fields` lignes 264-271)
- Modify : `apps/api/plane/app/views/issue/base.py` (listes `values(...)` : ligne 202, ligne 467, `required_fields` ligne 893)
- Modify : `apps/api/plane/utils/grouper.py` (`issue_on_results.required_fields`, ligne 127)
- Test : `apps/api/plane/tests/contract/app/test_issue_type_assignment_app.py`, `apps/api/plane/tests/contract/api/test_issue_type_assignment_api.py`, `apps/api/plane/tests/unit/serializers/test_space_issue_type_read_only.py`

**Interfaces**

- Consumes : `IssueType`, `ProjectIssueType`, `Issue._ensure_default_type` (tâche 3).
- Produces : `INVALID_WORK_ITEM_TYPE_MESSAGE`, `validate_work_item_type_id(type_id, *, project_id, workspace_id=None, current_type_id=None) -> UUID | None` (lève `serializers.ValidationError({"type_id": [...]})`) ; champ d'écriture `type_id` (UUID, optionnel, nullable) dans `IssueCreateSerializer`, `DraftIssueCreateSerializer` et le serializer v1 ; champ modèle `type` en lecture seule partout ; clé `type_id` dans les réponses liste et détail de l'API de l'application.

Constats de code :

- `IssueCreateSerializer`, `DraftIssueCreateSerializer` et `plane/space/serializer/issue.py` déclarent `fields = "__all__"` : le champ modèle `type` y est aujourd'hui inscriptible avec `IssueType.objects.all()` (même faille que `type_id` en v1). Il passe en lecture seule.
- Un `PrimaryKeyRelatedField` répond « Invalid pk ... object does not exist » pour un UUID inconnu et laisse passer un type d'un autre workspace : l'erreur diffère selon l'existence de l'objet. Un `UUIDField` suivi de `validate_work_item_type_id` renvoie le même message dans les deux cas (spec 5 et 7).
- Plane CE n'a ni création en masse de tickets ni modification en masse du type (`bulk-delete-issues`, `bulk-archive-issues`, `issue-dates` seulement) ; l'intake de l'application passe par `IssueCreateSerializer`, les intakes public et v1 créent via `Issue.objects.create` et reçoivent le défaut par la garde du modèle (tâche 3).
- Avec `null` explicite ou sans `type_id`, le ticket reçoit le défaut du projet par `Issue._ensure_default_type`, ce qui remplace la recherche erronée `IssueType.objects.filter(..., is_default=True)` de la v1 (elle lisait `IssueType.is_default` au lieu de `ProjectIssueType.is_default`).

- [ ] **Step 1 : écrire les tests qui échouent**

`apps/api/plane/tests/contract/app/test_issue_type_assignment_app.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""R9: a work item only takes an active type of its own workspace that is enabled in its project."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import DraftIssue, Issue, IssueType, Project, ProjectIssueType, ProjectMember
from plane.tests.factories import IssueTypeFactory, WorkspaceFactory

ISSUES_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/"
ISSUE_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/"
DRAFTS_URL = "/api/workspaces/{slug}/draft-issues/"


@pytest.fixture
def ctx(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    client = APIClient()
    client.force_authenticate(user=create_user)
    return SimpleNamespace(
        client=client,
        workspace=workspace,
        project=project,
        default_type=IssueType.objects.get(workspace=workspace, is_default=True),
        bug=bug,
        not_enabled=IssueTypeFactory(workspace=workspace, name="Story"),
        foreign=IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign"),
        issues_url=ISSUES_URL.format(slug=workspace.slug, project_id=project.id),
    )


def _issue_url(ctx, issue):
    return ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestCreateWorkItemType:
    def test_without_type_the_project_default_is_used(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Plain"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.default_type.id
        assert str(response.data["type_id"]) == str(ctx.default_type.id)

    def test_an_enabled_type_is_kept(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Bug", "type_id": str(ctx.bug.id)}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.bug.id

    def test_a_type_of_another_workspace_is_rejected(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Inject", "type_id": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "type_id" in response.data
        assert not Issue.objects.filter(name="Inject").exists()

    def test_the_error_does_not_reveal_whether_the_type_exists(self, ctx, mock_celery):
        foreign = ctx.client.post(ctx.issues_url, {"name": "A", "type_id": str(ctx.foreign.id)}, format="json")
        missing = ctx.client.post(ctx.issues_url, {"name": "B", "type_id": str(uuid4())}, format="json")
        assert foreign.status_code == missing.status_code == status.HTTP_400_BAD_REQUEST
        assert foreign.data == missing.data

    def test_a_type_not_enabled_in_the_project_is_rejected(self, ctx, mock_celery):
        response = ctx.client.post(
            ctx.issues_url, {"name": "Story", "type_id": str(ctx.not_enabled.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_an_inactive_type_is_rejected(self, ctx, mock_celery):
        IssueType.objects.filter(pk=ctx.bug.pk).update(is_active=False)
        response = ctx.client.post(ctx.issues_url, {"name": "Bug", "type_id": str(ctx.bug.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_the_model_field_name_cannot_bypass_the_check(self, ctx, mock_celery):
        response = ctx.client.post(ctx.issues_url, {"name": "Sneaky", "type": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.default_type.id


@pytest.mark.contract
@pytest.mark.django_db
class TestUpdateWorkItemType:
    def test_changing_to_an_enabled_type(self, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project)
        response = ctx.client.patch(_issue_url(ctx, issue), {"type_id": str(ctx.bug.id)}, format="json")
        assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
        issue.refresh_from_db()
        assert issue.type_id == ctx.bug.id

    def test_changing_to_a_type_of_another_workspace_is_rejected(self, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project)
        response = ctx.client.patch(_issue_url(ctx, issue), {"type_id": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        issue.refresh_from_db()
        assert issue.type_id == ctx.default_type.id

    def test_a_work_item_keeps_its_type_once_deactivated(self, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project, type=ctx.bug)
        IssueType.objects.filter(pk=ctx.bug.pk).update(is_active=False)
        response = ctx.client.patch(
            _issue_url(ctx, issue), {"name": "Renamed", "type_id": str(ctx.bug.id)}, format="json"
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
        issue.refresh_from_db()
        assert issue.type_id == ctx.bug.id and issue.name == "Renamed"


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkItemTypeInResponses:
    def test_detail_returns_type_id(self, ctx):
        issue = Issue.objects.create(name="Item", project=ctx.project, type=ctx.bug)
        response = ctx.client.get(_issue_url(ctx, issue))
        assert response.status_code == status.HTTP_200_OK, response.data
        assert str(response.data["type_id"]) == str(ctx.bug.id)

    def test_list_returns_type_id(self, ctx):
        issue = Issue.objects.create(name="Item", project=ctx.project, type=ctx.bug)
        response = ctx.client.get(ctx.issues_url)
        assert response.status_code == status.HTTP_200_OK, response.data
        rows = {str(row["id"]): row for row in response.data["results"]}
        assert str(rows[str(issue.id)]["type_id"]) == str(ctx.bug.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestDraftWorkItemType:
    def test_a_draft_rejects_a_type_of_another_workspace(self, ctx):
        response = ctx.client.post(
            DRAFTS_URL.format(slug=ctx.workspace.slug),
            {"name": "Draft", "project_id": str(ctx.project.id), "type_id": str(ctx.foreign.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not DraftIssue.objects.filter(name="Draft").exists()

    def test_a_draft_keeps_an_enabled_type(self, ctx):
        response = ctx.client.post(
            DRAFTS_URL.format(slug=ctx.workspace.slug),
            {"name": "Draft", "project_id": str(ctx.project.id), "type_id": str(ctx.bug.id)},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert str(response.data["type_id"]) == str(ctx.bug.id)

    def test_a_draft_without_project_accepts_only_an_active_workspace_type(self, ctx):
        accepted = ctx.client.post(
            DRAFTS_URL.format(slug=ctx.workspace.slug),
            {"name": "Loose", "type_id": str(ctx.not_enabled.id)},
            format="json",
        )
        rejected = ctx.client.post(
            DRAFTS_URL.format(slug=ctx.workspace.slug),
            {"name": "Loose foreign", "type_id": str(ctx.foreign.id)},
            format="json",
        )
        assert accepted.status_code == status.HTTP_201_CREATED, accepted.data
        assert rejected.status_code == status.HTTP_400_BAD_REQUEST
```

`apps/api/plane/tests/contract/api/test_issue_type_assignment_api.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""R9 on the public API v1: regression for the cross-workspace type injection."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from rest_framework import status

from plane.db.models import Issue, IssueType, Project, ProjectIssueType, ProjectMember
from plane.tests.factories import IssueTypeFactory, WorkspaceFactory

ISSUES_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/work-items/"
ISSUE_URL = "/api/v1/workspaces/{slug}/projects/{project_id}/work-items/{issue_id}/"


@pytest.fixture
def ctx(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    return SimpleNamespace(
        workspace=workspace,
        project=project,
        default_type=IssueType.objects.get(workspace=workspace, is_default=True),
        bug=bug,
        not_enabled=IssueTypeFactory(workspace=workspace, name="Story"),
        foreign=IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign"),
        issues_url=ISSUES_URL.format(slug=workspace.slug, project_id=project.id),
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestApiV1WorkItemType:
    def test_without_type_the_project_default_is_used(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Plain"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.default_type.id
        assert response.data["type_id"] == str(ctx.default_type.id)

    def test_a_type_of_another_workspace_is_rejected(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(
            ctx.issues_url, {"name": "Inject", "type_id": str(ctx.foreign.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not Issue.objects.filter(name="Inject").exists()

    def test_the_error_does_not_reveal_whether_the_type_exists(self, api_key_client, ctx, mock_celery):
        foreign = api_key_client.post(ctx.issues_url, {"name": "A", "type_id": str(ctx.foreign.id)}, format="json")
        missing = api_key_client.post(ctx.issues_url, {"name": "B", "type_id": str(uuid4())}, format="json")
        assert foreign.status_code == missing.status_code == status.HTTP_400_BAD_REQUEST
        assert foreign.data == missing.data

    def test_a_type_not_enabled_in_the_project_is_rejected(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(
            ctx.issues_url, {"name": "Story", "type_id": str(ctx.not_enabled.id)}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_the_model_field_name_cannot_bypass_the_check(self, api_key_client, ctx, mock_celery):
        response = api_key_client.post(ctx.issues_url, {"name": "Sneaky", "type": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert Issue.objects.get(pk=response.data["id"]).type_id == ctx.default_type.id

    def test_update_to_an_enabled_type(self, api_key_client, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project)
        url = ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)
        response = api_key_client.patch(url, {"type_id": str(ctx.bug.id)}, format="json")
        assert response.status_code == status.HTTP_200_OK, response.data
        issue.refresh_from_db()
        assert issue.type_id == ctx.bug.id

    def test_update_to_a_type_of_another_workspace_is_rejected(self, api_key_client, ctx, mock_celery):
        issue = Issue.objects.create(name="Item", project=ctx.project)
        url = ISSUE_URL.format(slug=ctx.workspace.slug, project_id=ctx.project.id, issue_id=issue.id)
        response = api_key_client.patch(url, {"type_id": str(ctx.foreign.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        issue.refresh_from_db()
        assert issue.type_id == ctx.default_type.id
```

`apps/api/plane/tests/unit/serializers/test_space_issue_type_read_only.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.space.serializer.issue import IssueCreateSerializer as PublicIssueCreateSerializer


@pytest.mark.unit
def test_public_intake_cannot_choose_the_work_item_type():
    assert PublicIssueCreateSerializer().fields["type"].read_only
```

- [ ] **Step 2 : lancer les tests et constater l'échec**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_issue_type_assignment_app.py plane/tests/contract/api/test_issue_type_assignment_api.py plane/tests/unit/serializers/test_space_issue_type_read_only.py -v`
Expected : `test_a_type_of_another_workspace_is_rejected` échoue (`assert 201 == 400`) sur les deux API ; `test_the_model_field_name_cannot_bypass_the_check` échoue (type étranger enregistré) ; `test_list_returns_type_id` et `test_detail_returns_type_id` échouent sur `KeyError: 'type_id'` ; le test public échoue (`assert False`).

- [ ] **Step 3 : implémentation minimale**

`apps/api/plane/utils/issue_types.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import F

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import IssueType, ProjectIssueType

INVALID_WORK_ITEM_TYPE_MESSAGE = "Work item type is not valid for this project."


def validate_work_item_type_id(type_id, *, project_id, workspace_id=None, current_type_id=None):
    """Return type_id when a work item may take it (R7, R9), else raise one message whatever the cause.

    Keeping the current type is always allowed, so work items keep a type that was deactivated since.
    Without a project (workspace drafts) the type must be an active type of the workspace.
    """
    if type_id is None or type_id == current_type_id:
        return type_id
    if project_id is not None:
        allowed = ProjectIssueType.objects.filter(
            project_id=project_id,
            issue_type_id=type_id,
            issue_type__workspace_id=F("workspace_id"),
            issue_type__is_active=True,
            issue_type__deleted_at__isnull=True,
        ).exists()
    else:
        allowed = IssueType.objects.filter(pk=type_id, workspace_id=workspace_id, is_active=True).exists()
    if not allowed:
        raise serializers.ValidationError({"type_id": [INVALID_WORK_ITEM_TYPE_MESSAGE]})
    return type_id
```

`apps/api/plane/app/serializers/issue.py` :

1. Après le bloc `from plane.utils.content_validator import (...)`, ajouter :

```python
from plane.utils.issue_types import validate_work_item_type_id
```

2. Dans `IssueCreateSerializer`, après `workspace_id = serializers.UUIDField(source="workspace.id", read_only=True)` :

```python
    type_id = serializers.UUIDField(required=False, allow_null=True)
```

3. Dans `IssueCreateSerializer.Meta.read_only_fields`, ajouter `"type",` après `"sequence_id",`.

4. Dans `IssueCreateSerializer.validate`, juste avant le `return attrs` final :

```python
        if "type_id" in attrs:
            attrs["type_id"] = validate_work_item_type_id(
                attrs["type_id"],
                project_id=self.context.get("project_id"),
                current_type_id=self.instance.type_id if self.instance else None,
            )
```

5. Dans `IssueSerializer.Meta.fields`, ajouter `"type_id",` après `"archived_at",` (ligne 821).

6. Dans `IssueListDetailSerializer.to_representation`, ajouter `"type_id": instance.type_id,` après `"archived_at": instance.archived_at,` (ligne 871).

`apps/api/plane/app/serializers/draft.py` :

1. Après le bloc `from plane.utils.content_validator import (...)`, ajouter `from plane.utils.issue_types import validate_work_item_type_id`.
2. Après la déclaration `assignee_ids = serializers.ListField(...)` de `DraftIssueCreateSerializer`, ajouter :

```python
    type_id = serializers.UUIDField(required=False, allow_null=True)
```

3. Dans `Meta.read_only_fields`, ajouter `"type",` après `"updated_at",`.
4. Dans `validate`, juste après le bloc qui calcule `project_id, workspace_id` (lignes 145-148) et avant `self.check_cycle_and_modules(...)` :

```python
        if "type_id" in attrs:
            attrs["type_id"] = validate_work_item_type_id(
                attrs["type_id"],
                project_id=project_id,
                workspace_id=workspace_id,
                current_type_id=self.instance.type_id if self.instance else None,
            )
```

`apps/api/plane/api/serializers/issue.py` :

1. Retirer `IssueType,` de l'import `from plane.db.models import (...)` (ligne 16) ; ajouter sous le bloc `from plane.utils.content_validator import (...)` : `from plane.utils.issue_types import validate_work_item_type_id`.
2. Remplacer les lignes 66-68 (`type_id = serializers.PrimaryKeyRelatedField(...)`) par :

```python
    type_id = serializers.UUIDField(required=False, allow_null=True)
```

3. Dans `Meta.read_only_fields`, ajouter `"type",` après `"sequence_id",`.
4. Dans `validate`, juste avant le `return data` final :

```python
        if "type_id" in data:
            data["type_id"] = validate_work_item_type_id(
                data["type_id"],
                project_id=self.context.get("project_id"),
                current_type_id=self.instance.type_id if self.instance else None,
            )
```

5. Dans `create`, remplacer :

```python
        issue_type = validated_data.pop("type", None)

        if not issue_type:
            # Get default issue type
            issue_type = IssueType.objects.filter(project_issue_types__project_id=project_id, is_default=True).first()
            issue_type = issue_type

        issue = Issue.objects.create(**validated_data, project_id=project_id, type=issue_type)
```

par :

```python
        issue = Issue.objects.create(**validated_data, project_id=project_id)
```

`apps/api/plane/space/serializer/issue.py`, dans `IssueCreateSerializer.Meta.read_only_fields` (lignes 264-271), ajouter `"type",` après `"updated_at",`.

`apps/api/plane/app/views/issue/base.py` : ajouter `"type_id",` après `"deleted_at",` dans `IssueListEndpoint.get` (ligne 202) et dans `IssueViewSet.create` (ligne 467), et après `"archived_at",` dans `required_fields` de `IssuePaginatedViewSet.list` (ligne 893).

`apps/api/plane/utils/grouper.py`, dans `issue_on_results.required_fields`, ajouter `"type_id",` après `"state__group",`.

- [ ] **Step 4 : relancer, les tests passent**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract plane/tests/unit/serializers -v`
Expected : tous `passed` (les tests existants `test_issue_read_only_fields_app.py`, `test_issue_serializer_api.py`, `test_mass_assignment.py` restent verts).

- [ ] **Step 5 : commit**

```bash
git add apps/api/plane/utils/issue_types.py apps/api/plane/app/serializers/issue.py apps/api/plane/app/serializers/draft.py apps/api/plane/api/serializers/issue.py apps/api/plane/space/serializer/issue.py apps/api/plane/app/views/issue/base.py apps/api/plane/utils/grouper.py apps/api/plane/tests/contract/app/test_issue_type_assignment_app.py apps/api/plane/tests/contract/api/test_issue_type_assignment_api.py apps/api/plane/tests/unit/serializers/test_space_issue_type_read_only.py
git commit -m "fix(api): reject work item types outside the project"
```

---

### Task 8: Historique du changement de type (R11)

**Files**

- Modify : `apps/api/plane/bgtasks/issue_activities_task.py` (import `IssueType` dans le bloc lignes 20-34 ; nouvelle fonction après `track_priority`, ligne 196 ; `ISSUE_ACTIVITY_MAPPER` lignes 636-655)
- Test : `apps/api/plane/tests/unit/bg_tasks/test_issue_type_activity.py`, `apps/api/plane/tests/contract/app/test_issue_type_activity_app.py`

**Interfaces**

- Consumes : `IssueDetailSerializer` (contient `type_id` depuis la tâche 7), `writable_data` de la vue (transmet `type_id`).
- Produces : `track_type(requested_data, current_instance, issue_id, project_id, workspace_id, actor_id, issue_activities, epoch)` qui ajoute une `IssueActivity(field="type", verb="updated", old_value=<ancien nom>, new_value=<nouveau nom>, old_identifier=<ancien id>, new_identifier=<nouvel id>)` ; clé `"type_id"` dans `ISSUE_ACTIVITY_MAPPER`.

- [ ] **Step 1 : écrire les tests qui échouent**

`apps/api/plane/tests/unit/bg_tasks/test_issue_type_activity.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from types import SimpleNamespace

import pytest
from django.utils import timezone

from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import Issue, IssueActivity, IssueType, Project, ProjectIssueType
from plane.tests.factories import IssueTypeFactory, WorkspaceFactory

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def scope(workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    return SimpleNamespace(
        user=create_user,
        project=project,
        issue=Issue.objects.create(name="Item", project=project),
        default_type=IssueType.objects.get(workspace=workspace, is_default=True),
        bug=bug,
    )


def _update(scope, requested, current):
    issue_activity(
        type="issue.activity.updated",
        requested_data=json.dumps(requested),
        current_instance=json.dumps(current),
        issue_id=str(scope.issue.id),
        actor_id=str(scope.user.id),
        project_id=str(scope.project.id),
        epoch=int(timezone.now().timestamp()),
    )


def test_a_type_change_is_recorded(scope, mock_celery):
    _update(scope, {"type_id": str(scope.bug.id)}, {"type_id": str(scope.default_type.id)})

    activity = IssueActivity.objects.get(issue=scope.issue, field="type")
    assert activity.verb == "updated"
    assert activity.old_value == scope.default_type.name
    assert activity.new_value == "Bug"
    assert activity.old_identifier == scope.default_type.id
    assert activity.new_identifier == scope.bug.id
    assert activity.actor_id == scope.user.id


def test_the_api_v1_current_instance_key_is_supported(scope, mock_celery):
    _update(scope, {"type_id": str(scope.bug.id)}, {"type": str(scope.default_type.id)})
    assert IssueActivity.objects.filter(issue=scope.issue, field="type").exists()


def test_an_unchanged_type_records_nothing(scope, mock_celery):
    _update(scope, {"type_id": str(scope.default_type.id)}, {"type_id": str(scope.default_type.id)})
    assert not IssueActivity.objects.filter(issue=scope.issue, field="type").exists()


def test_a_type_of_another_workspace_is_never_named(scope, mock_celery):
    foreign = IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign secret")
    _update(scope, {"type_id": str(foreign.id)}, {"type_id": str(scope.default_type.id)})
    assert not IssueActivity.objects.filter(issue=scope.issue, field="type").exists()
```

`apps/api/plane/tests/contract/app/test_issue_type_activity_app.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueType, Project, ProjectIssueType, ProjectMember
from plane.tests.factories import IssueTypeFactory


@pytest.mark.contract
@pytest.mark.django_db
def test_the_update_view_hands_the_type_change_to_the_activity_task(workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    issue = Issue.objects.create(name="Item", project=project)
    default_type = IssueType.objects.get(workspace=workspace, is_default=True)
    client = APIClient()
    client.force_authenticate(user=create_user)

    with (
        mock.patch("plane.app.views.issue.base.issue_activity") as issue_activity,
        mock.patch("plane.app.views.issue.base.model_activity"),
        mock.patch("plane.app.views.issue.base.issue_description_version_task"),
    ):
        response = client.patch(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/",
            {"type_id": str(bug.id)},
            format="json",
        )

    assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
    kwargs = issue_activity.delay.call_args.kwargs
    assert json.loads(kwargs["requested_data"])["type_id"] == str(bug.id)
    assert json.loads(kwargs["current_instance"])["type_id"] == str(default_type.id)
```

- [ ] **Step 2 : lancer les tests et constater l'échec**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/bg_tasks/test_issue_type_activity.py plane/tests/contract/app/test_issue_type_activity_app.py -v`
Expected : `IssueActivity.DoesNotExist` pour `test_a_type_change_is_recorded` ; le test de contrat passe déjà grâce à la tâche 7 (il protège la chaîne vue vers tâche).

- [ ] **Step 3 : implémentation minimale**

`apps/api/plane/bgtasks/issue_activities_task.py` :

1. Ajouter `IssueType,` dans le bloc `from plane.db.models import (...)`, après `IssueSubscriber,`.
2. Après la fonction `track_priority`, ajouter :

```python
# Track changes in the type of the issue (R11)
def track_type(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    current_type_id = current_instance.get("type_id") or current_instance.get("type")
    requested_type_id = requested_data.get("type_id")
    if current_type_id is not None and not is_valid_uuid(str(current_type_id)):
        current_type_id = None
    if requested_type_id is None or not is_valid_uuid(str(requested_type_id)):
        return
    if str(current_type_id) == str(requested_type_id):
        return

    new_type = IssueType.objects.filter(pk=requested_type_id, workspace_id=workspace_id).first()
    if new_type is None:
        return
    old_type = (
        IssueType.all_objects.filter(pk=current_type_id, workspace_id=workspace_id).first()
        if current_type_id
        else None
    )

    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            actor_id=actor_id,
            verb="updated",
            old_value=old_type.name if old_type else None,
            new_value=new_type.name,
            field="type",
            project_id=project_id,
            workspace_id=workspace_id,
            comment="updated the type to",
            old_identifier=old_type.id if old_type else None,
            new_identifier=new_type.id,
            epoch=epoch,
        )
    )
```

3. Dans `ISSUE_ACTIVITY_MAPPER`, ajouter `"type_id": track_type,` après `"priority": track_priority,`.

- [ ] **Step 4 : relancer, les tests passent**

Run : la commande de l'étape 2, puis `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/bg_tasks -v`.
Expected : tous `passed`.

- [ ] **Step 5 : commit**

```bash
git add apps/api/plane/bgtasks/issue_activities_task.py apps/api/plane/tests/unit/bg_tasks/test_issue_type_activity.py apps/api/plane/tests/contract/app/test_issue_type_activity_app.py
git commit -m "feat(api): record work item type changes in the activity log"
```

---

### Task 9: Filtre et regroupement par type côté serveur (spec 6.5)

**Files**

- Modify : `apps/api/plane/utils/issue_filters.py` (nouvelle fonction après `filter_priority`, ligne 131 ; dictionnaire `ISSUE_FILTER`, ligne 435)
- Modify : `apps/api/plane/utils/filters/filterset.py` (`IssueFilterSet`, après `project_id__in`, ligne 167)
- Modify : `apps/api/plane/utils/grouper.py` (import `IssueType` lignes 12-24 ; `issue_group_values` après la branche `priority`, ligne 193)
- Test : `apps/api/plane/tests/unit/utils/test_issue_type_filters.py`, `apps/api/plane/tests/contract/app/test_issue_type_grouping_app.py`

**Interfaces**

- Consumes : `filter_valid_uuids` (même fichier), `UUIDInFilter`.
- Produces : `filter_issue_type(params, issue_filter, method, prefix="")` (paramètre `issue_type`, valeurs UUID séparées par des virgules ou liste) ; filtres riches `type_id`, `type_id__in` ; valeurs de groupe `issue_group_values(field="type_id", ...)` = types non supprimés du workspace, actifs ou non (les tickets gardent un type désactivé, R7).

- [ ] **Step 1 : écrire les tests qui échouent**

`apps/api/plane/tests/unit/utils/test_issue_type_filters.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import UUID, uuid4

import pytest

from plane.db.models import Issue, IssueType, Project, ProjectIssueType
from plane.tests.factories import IssueTypeFactory, WorkspaceFactory
from plane.utils.filters.filterset import IssueFilterSet
from plane.utils.grouper import issue_group_values
from plane.utils.issue_filters import filter_issue_type, issue_filters


@pytest.mark.unit
class TestFilterIssueType:
    def test_get_keeps_only_valid_uuids(self):
        type_id = uuid4()
        assert filter_issue_type({"issue_type": f"{type_id},not-a-uuid,null"}, {}, "GET") == {"type__in": [type_id]}

    def test_post_accepts_a_list(self):
        type_id = uuid4()
        assert filter_issue_type({"issue_type": [str(type_id), "bad"]}, {}, "POST") == {"type__in": [type_id]}

    def test_empty_value_is_a_no_op(self):
        assert filter_issue_type({"issue_type": ""}, {}, "GET") == {}

    def test_prefix_is_applied(self):
        type_id = uuid4()
        result = filter_issue_type({"issue_type": str(type_id)}, {}, "GET", prefix="issue__")
        assert result == {"issue__type__in": [type_id]}

    def test_registered_in_issue_filters(self):
        type_id = uuid4()
        assert issue_filters({"issue_type": str(type_id)}, "GET") == {"type__in": [type_id]}


@pytest.fixture
def typed_issues(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    Issue.objects.create(name="default item", project=project)
    Issue.objects.create(name="bug item", project=project, type=bug)
    return project, bug


def _names(project, data):
    filterset = IssueFilterSet(data=data, queryset=Issue.objects.filter(project=project))
    assert filterset.is_valid(), filterset.errors
    return set(filterset.qs.values_list("name", flat=True))


@pytest.mark.unit
@pytest.mark.django_db
class TestRichTypeFilter:
    def test_exact(self, typed_issues):
        project, bug = typed_issues
        assert _names(project, {"type_id": str(bug.id)}) == {"bug item"}

    def test_in(self, workspace, typed_issues):
        project, bug = typed_issues
        default_id = IssueType.objects.get(workspace=workspace, is_default=True).id
        assert _names(project, {"type_id__in": f"{bug.id},{default_id}"}) == {"bug item", "default item"}


@pytest.mark.unit
@pytest.mark.django_db
def test_group_values_are_the_workspace_types_including_inactive_ones(workspace, typed_issues):
    project, bug = typed_issues
    IssueType.objects.filter(pk=bug.pk).update(is_active=False)
    IssueTypeFactory(workspace=WorkspaceFactory(), name="Foreign")
    default_id = IssueType.objects.get(workspace=workspace, is_default=True).id

    values = issue_group_values(field="type_id", slug=workspace.slug, project_id=project.id)

    assert {UUID(str(value)) for value in values} == {bug.id, default_id}
```

`apps/api/plane/tests/contract/app/test_issue_type_grouping_app.py` :

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueType, Project, ProjectIssueType, ProjectMember
from plane.tests.factories import IssueTypeFactory


@pytest.fixture
def board(db, workspace, create_user):
    project = Project.objects.create(name="Home", identifier="HOME", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    bug = IssueTypeFactory(workspace=workspace, name="Bug")
    ProjectIssueType.objects.create(project=project, issue_type=bug)
    plain = Issue.objects.create(name="Plain", project=project)
    defect = Issue.objects.create(name="Defect", project=project, type=bug)
    client = APIClient()
    client.force_authenticate(user=create_user)
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/"
    return client, url, bug, plain, defect, IssueType.objects.get(workspace=workspace, is_default=True)


@pytest.mark.contract
@pytest.mark.django_db
def test_work_items_are_grouped_by_type(board):
    client, url, bug, plain, defect, default_type = board

    response = client.get(url, {"group_by": "type_id"})

    assert response.status_code == status.HTTP_200_OK, response.data
    groups = response.data["results"]
    assert [str(row["id"]) for row in groups[str(bug.id)]["results"]] == [str(defect.id)]
    assert [str(row["id"]) for row in groups[str(default_type.id)]["results"]] == [str(plain.id)]


@pytest.mark.contract
@pytest.mark.django_db
def test_work_items_are_filtered_by_type(board):
    client, url, bug, plain, defect, default_type = board

    response = client.get(url, {"issue_type": str(bug.id)})

    assert response.status_code == status.HTTP_200_OK, response.data
    assert [str(row["id"]) for row in response.data["results"]] == [str(defect.id)]
```

- [ ] **Step 2 : lancer les tests et constater l'échec**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/utils/test_issue_type_filters.py plane/tests/contract/app/test_issue_type_grouping_app.py -v`
Expected : `ImportError: cannot import name 'filter_issue_type'` puis, pour le contrat, groupes vides (`KeyError`) et filtre ignoré (deux tickets renvoyés).

- [ ] **Step 3 : implémentation minimale**

`apps/api/plane/utils/issue_filters.py`, après `filter_priority` :

```python
def filter_issue_type(params, issue_filter, method, prefix=""):
    raw = params.get("issue_type")
    values = raw.split(",") if isinstance(raw, str) else (raw or [])
    issue_types = filter_valid_uuids([str(value) for value in values if value not in ("", "null")])
    if issue_types:
        issue_filter[f"{prefix}type__in"] = issue_types
    return issue_filter
```

et dans `ISSUE_FILTER`, ajouter `"issue_type": filter_issue_type,` après `"priority": filter_priority,`.

`apps/api/plane/utils/filters/filterset.py`, dans `IssueFilterSet`, après `project_id__in = ...` :

```python
    type_id = filters.UUIDFilter(field_name="type_id")
    type_id__in = UUIDInFilter(field_name="type_id", lookup_expr="in")
```

`apps/api/plane/utils/grouper.py` : ajouter `IssueType,` à l'import `from plane.db.models import (...)`, puis dans `issue_group_values`, après la branche `if field == "priority":` :

```python
    if field == "type_id":
        return list(IssueType.objects.filter(workspace__slug=slug).values_list("id", flat=True))
```

- [ ] **Step 4 : relancer, les tests passent**

Run : `docker compose -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/utils plane/tests/contract/app/test_issue_type_grouping_app.py -v`
Expected : tous `passed`.

- [ ] **Step 5 : commit**

```bash
git add apps/api/plane/utils/issue_filters.py apps/api/plane/utils/filters/filterset.py apps/api/plane/utils/grouper.py apps/api/plane/tests/unit/utils/test_issue_type_filters.py apps/api/plane/tests/contract/app/test_issue_type_grouping_app.py
git commit -m "feat(api): filter and group work items by type"
```

---

### Task 10: Fondation frontend : types, service, store, hook et vitest

**Files**

- Create : `packages/types/src/work-item-type.ts`
- Modify : `packages/types/src/index.ts` (ligne 57, après `export * from "./workspace";`)
- Modify : `packages/constants/src/fetch-keys.ts` (après `WORKSPACE_STATES`, ligne 87)
- Create : `apps/web/services/work-item-type.service.ts`
- Create : `apps/web/store/workspace/work-item-type.store.ts`
- Modify : `apps/web/store/workspace/index.ts` (imports lignes 21-27 ; interface ligne 70 ; champs lignes 86-87 ; constructeur lignes 122-123)
- Create : `apps/web/hooks/store/use-work-item-type.ts`
- Modify : `apps/web/layouts/auth-layout/workspace-wrapper.tsx` (imports lignes 23-40 ; hooks ligne 62 ; après le `useSWR` de `WORKSPACE_STATES`, ligne 112)
- Modify : `apps/web/layouts/auth-layout/project-wrapper.tsx` (imports lignes 16-38 ; hooks ligne 65 ; après le `useSWR` de `PROJECT_LABELS`)
- Modify : `apps/web/package.json` (scripts, devDependencies), `pnpm-lock.yaml` (régénéré)
- Create : `apps/web/vitest.config.ts`
- Test : `apps/web/store/workspace/work-item-type.store.test.ts`

**Interfaces**

- Consumes : routes des tâches 5 et 6, `APIService`, `API_BASE_URL`, `StoreContext`.
- Produces :
  - Types `TIssueType`, `TIssueTypeFormData`, `TIssueTypeUpdatePayload`, `TProjectIssueType`.
  - Clés SWR `WORKSPACE_WORK_ITEM_TYPES(workspaceSlug)`, `PROJECT_WORK_ITEM_TYPES(projectId)`.
  - `WorkItemTypeService` : `list`, `create`, `update`, `remove`, `listProjectTypes`, `enableInProject`, `setProjectDefault`, `disableInProject`.
  - `IWorkItemTypeStore` / `WorkItemTypeStore(service?)` : observables `typesMap`, `projectLinksMap` ; sélecteurs `getWorkspaceTypes()`, `getTypeById(typeId)`, `getProjectTypeLink(projectId, typeId)`, `getProjectAssignableTypes(projectId)`, `getProjectDefaultTypeId(projectId)` ; actions `fetchWorkspaceTypes`, `fetchProjectTypes`, `createType`, `updateType`, `removeType`, `enableInProject`, `setProjectDefault`, `disableInProject`.
  - `workspaceRoot.workItemType` ; hook `useWorkItemType()`.
  - Script `pnpm --filter web test` (vitest, environnement node, alias `@`).

- [ ] **Step 1 : écrire le test qui échoue**

`apps/web/store/workspace/work-item-type.store.test.ts` :

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TIssueType, TProjectIssueType } from "@plane/types";
import type { WorkItemTypeService } from "@/services/work-item-type.service";
import { WorkItemTypeStore } from "./work-item-type.store";

const buildType = (overrides: Partial<TIssueType>): TIssueType => ({
  id: "type",
  name: "Type",
  description: "",
  logo_props: { in_use: "icon", icon: { name: "check_box", color: "#6d7b8a" } },
  is_active: true,
  is_default: false,
  issue_count: 0,
  project_default_count: 0,
  created_at: "2026-11-12T00:00:00Z",
  updated_at: "2026-11-12T00:00:00Z",
  ...overrides,
});

const buildStore = (types: TIssueType[], links: TProjectIssueType[]) => {
  const state = { types };
  const service = {
    list: async () => state.types,
    listProjectTypes: async () => links,
    update: async (_slug: string, typeId: string) => {
      state.types = state.types.map((type) => ({ ...type, is_default: type.id === typeId }));
      return state.types.find((type) => type.id === typeId) as TIssueType;
    },
  } as unknown as WorkItemTypeService;
  return new WorkItemTypeStore(service);
};

const TYPES = [
  buildType({ id: "task", name: "Task", is_default: true }),
  buildType({ id: "bug", name: "Bug" }),
  buildType({ id: "epic", name: "Archived epic", is_active: false }),
  buildType({ id: "story", name: "Story" }),
];

const LINKS: TProjectIssueType[] = [
  { id: "l1", project_id: "p1", issue_type_id: "task", is_default: false, issue_count: 0 },
  { id: "l2", project_id: "p1", issue_type_id: "bug", is_default: true, issue_count: 2 },
  { id: "l3", project_id: "p1", issue_type_id: "epic", is_default: false, issue_count: 1 },
];

const loadedStore = async () => {
  const store = buildStore(TYPES, LINKS);
  await store.fetchWorkspaceTypes("acme");
  await store.fetchProjectTypes("acme", "p1");
  return store;
};

describe("WorkItemTypeStore", () => {
  it("lists every workspace type, inactive ones included, default first then by name", async () => {
    const store = await loadedStore();
    expect(store.getWorkspaceTypes().map((type) => type.id)).toEqual(["task", "epic", "bug", "story"]);
  });

  it("offers only the active types enabled in the project, project default first", async () => {
    const store = await loadedStore();
    expect(store.getProjectAssignableTypes("p1").map((type) => type.id)).toEqual(["bug", "task"]);
  });

  it("returns the project default type", async () => {
    const store = await loadedStore();
    expect(store.getProjectDefaultTypeId("p1")).toBe("bug");
  });

  it("has no default for a project that is not loaded", async () => {
    const store = await loadedStore();
    expect(store.getProjectDefaultTypeId("p2")).toBeNull();
    expect(store.getProjectAssignableTypes("p2")).toEqual([]);
  });

  it("finds a type and its project link by id", async () => {
    const store = await loadedStore();
    expect(store.getTypeById("epic")?.is_active).toBe(false);
    expect(store.getTypeById(null)).toBeUndefined();
    expect(store.getProjectTypeLink("p1", "epic")?.issue_count).toBe(1);
    expect(store.getProjectTypeLink("p1", "story")).toBeUndefined();
  });

  it("reloads the list when another type becomes the default", async () => {
    const store = await loadedStore();
    await store.updateType("acme", "story", { is_default: true });
    expect(store.getTypeById("task")?.is_default).toBe(false);
    expect(store.getTypeById("story")?.is_default).toBe(true);
  });
});
```

- [ ] **Step 2 : ajouter le lanceur, lancer le test et constater l'échec**

`apps/web/package.json` : ajouter `"test": "vitest run"` dans `scripts` (après `"fix:format"`), et `"vitest": "catalog:"` dans `devDependencies` (après `"vite-tsconfig-paths"`). Puis `pnpm install` à la racine (met à jour `pnpm-lock.yaml`).

`apps/web/vitest.config.ts` :

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    name: "unit",
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "build/**", ".react-router/**"],
  },
});
```

Run : `pnpm turbo run test --filter=web`
Expected : échec `Failed to resolve import "./work-item-type.store"`.

- [ ] **Step 3 : implémentation minimale**

`packages/types/src/work-item-type.ts` :

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLogoProps } from "./common";

export type TIssueType = {
  id: string;
  name: string;
  description: string;
  logo_props: TLogoProps;
  is_active: boolean;
  is_default: boolean;
  issue_count: number;
  project_default_count: number;
  created_at: string;
  updated_at: string;
};

export type TIssueTypeFormData = Pick<TIssueType, "name" | "description" | "logo_props">;

export type TIssueTypeUpdatePayload = Partial<TIssueTypeFormData & Pick<TIssueType, "is_active">> & {
  is_default?: true;
};

export type TProjectIssueType = {
  id: string;
  project_id: string;
  issue_type_id: string;
  is_default: boolean;
  issue_count: number;
};
```

`packages/types/src/index.ts`, après `export * from "./workspace";` :

```ts
export * from "./work-item-type";
```

`packages/constants/src/fetch-keys.ts`, après `WORKSPACE_STATES` :

```ts
export const WORKSPACE_WORK_ITEM_TYPES = (workspaceSlug: string) =>
  `WORKSPACE_WORK_ITEM_TYPES_${workspaceSlug.toUpperCase()}`;

export const PROJECT_WORK_ITEM_TYPES = (projectId: string) => `PROJECT_WORK_ITEM_TYPES_${projectId.toUpperCase()}`;
```

`apps/web/services/work-item-type.service.ts` :

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TIssueType, TIssueTypeFormData, TIssueTypeUpdatePayload, TProjectIssueType } from "@plane/types";
import { APIService } from "@/services/api.service";

export class WorkItemTypeService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(workspaceSlug: string): Promise<TIssueType[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/issue-types/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(workspaceSlug: string, data: TIssueTypeFormData): Promise<TIssueType> {
    return this.post(`/api/workspaces/${workspaceSlug}/issue-types/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(workspaceSlug: string, typeId: string, data: TIssueTypeUpdatePayload): Promise<TIssueType> {
    return this.patch(`/api/workspaces/${workspaceSlug}/issue-types/${typeId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(workspaceSlug: string, typeId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/issue-types/${typeId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listProjectTypes(workspaceSlug: string, projectId: string): Promise<TProjectIssueType[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-types/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async enableInProject(workspaceSlug: string, projectId: string, typeId: string): Promise<TProjectIssueType> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-types/`, { issue_type_id: typeId })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async setProjectDefault(workspaceSlug: string, projectId: string, typeId: string): Promise<TProjectIssueType> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-types/${typeId}/`, {
      is_default: true,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async disableInProject(workspaceSlug: string, projectId: string, typeId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issue-types/${typeId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
```

`apps/web/store/workspace/work-item-type.store.ts` :

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { TIssueType, TIssueTypeFormData, TIssueTypeUpdatePayload, TProjectIssueType } from "@plane/types";
// services
import { WorkItemTypeService } from "@/services/work-item-type.service";

export interface IWorkItemTypeStore {
  // observables
  typesMap: Record<string, TIssueType>;
  projectLinksMap: Record<string, TProjectIssueType[]>;
  // computed actions
  getWorkspaceTypes: () => TIssueType[];
  getTypeById: (typeId: string | null | undefined) => TIssueType | undefined;
  getProjectTypeLink: (projectId: string, typeId: string) => TProjectIssueType | undefined;
  getProjectAssignableTypes: (projectId: string) => TIssueType[];
  getProjectDefaultTypeId: (projectId: string) => string | null;
  // fetch actions
  fetchWorkspaceTypes: (workspaceSlug: string) => Promise<TIssueType[]>;
  fetchProjectTypes: (workspaceSlug: string, projectId: string) => Promise<TProjectIssueType[]>;
  // crud actions
  createType: (workspaceSlug: string, data: TIssueTypeFormData) => Promise<TIssueType>;
  updateType: (workspaceSlug: string, typeId: string, data: TIssueTypeUpdatePayload) => Promise<TIssueType>;
  removeType: (workspaceSlug: string, typeId: string) => Promise<void>;
  enableInProject: (workspaceSlug: string, projectId: string, typeId: string) => Promise<void>;
  setProjectDefault: (workspaceSlug: string, projectId: string, typeId: string) => Promise<void>;
  disableInProject: (workspaceSlug: string, projectId: string, typeId: string) => Promise<void>;
}

const byDefaultThenName = (isDefault: (type: TIssueType) => boolean) => (a: TIssueType, b: TIssueType) =>
  Number(isDefault(b)) - Number(isDefault(a)) || a.name.localeCompare(b.name);

export class WorkItemTypeStore implements IWorkItemTypeStore {
  // observables
  typesMap: Record<string, TIssueType> = {};
  projectLinksMap: Record<string, TProjectIssueType[]> = {};
  // services
  service: WorkItemTypeService;

  constructor(service: WorkItemTypeService = new WorkItemTypeService()) {
    makeObservable(this, {
      // observables
      typesMap: observable,
      projectLinksMap: observable,
      // actions
      fetchWorkspaceTypes: action,
      fetchProjectTypes: action,
      createType: action,
      updateType: action,
      removeType: action,
      enableInProject: action,
      setProjectDefault: action,
      disableInProject: action,
    });
    this.service = service;
  }

  getWorkspaceTypes = computedFn(() => Object.values(this.typesMap).sort(byDefaultThenName((type) => type.is_default)));

  getTypeById = computedFn((typeId: string | null | undefined) => (typeId ? this.typesMap[typeId] : undefined));

  getProjectTypeLink = computedFn((projectId: string, typeId: string) =>
    this.projectLinksMap[projectId]?.find((link) => link.issue_type_id === typeId)
  );

  getProjectDefaultTypeId = computedFn(
    (projectId: string) => this.projectLinksMap[projectId]?.find((link) => link.is_default)?.issue_type_id ?? null
  );

  getProjectAssignableTypes = computedFn((projectId: string) => {
    const defaultTypeId = this.getProjectDefaultTypeId(projectId);
    return (this.projectLinksMap[projectId] ?? [])
      .map((link) => this.typesMap[link.issue_type_id])
      .filter((type): type is TIssueType => !!type && type.is_active)
      .sort(byDefaultThenName((type) => type.id === defaultTypeId));
  });

  fetchWorkspaceTypes = async (workspaceSlug: string) => {
    const types = await this.service.list(workspaceSlug);
    runInAction(() => {
      this.typesMap = Object.fromEntries(types.map((type) => [type.id, type]));
    });
    return types;
  };

  fetchProjectTypes = async (workspaceSlug: string, projectId: string) => {
    const links = await this.service.listProjectTypes(workspaceSlug, projectId);
    runInAction(() => {
      this.projectLinksMap[projectId] = links;
    });
    return links;
  };

  createType = async (workspaceSlug: string, data: TIssueTypeFormData) => {
    const created = await this.service.create(workspaceSlug, data);
    runInAction(() => {
      this.typesMap[created.id] = created;
    });
    return created;
  };

  updateType = async (workspaceSlug: string, typeId: string, data: TIssueTypeUpdatePayload) => {
    const updated = await this.service.update(workspaceSlug, typeId, data);
    // A new default also clears the previous one, so the whole list is reloaded.
    if (data.is_default) await this.fetchWorkspaceTypes(workspaceSlug);
    else
      runInAction(() => {
        this.typesMap[updated.id] = updated;
      });
    return updated;
  };

  removeType = async (workspaceSlug: string, typeId: string) => {
    await this.service.remove(workspaceSlug, typeId);
    runInAction(() => {
      delete this.typesMap[typeId];
    });
  };

  enableInProject = async (workspaceSlug: string, projectId: string, typeId: string) => {
    await this.service.enableInProject(workspaceSlug, projectId, typeId);
    await this.fetchProjectTypes(workspaceSlug, projectId);
  };

  setProjectDefault = async (workspaceSlug: string, projectId: string, typeId: string) => {
    await this.service.setProjectDefault(workspaceSlug, projectId, typeId);
    // project_default_count of the workspace types drives the deactivate action, so both lists reload.
    await Promise.all([this.fetchProjectTypes(workspaceSlug, projectId), this.fetchWorkspaceTypes(workspaceSlug)]);
  };

  disableInProject = async (workspaceSlug: string, projectId: string, typeId: string) => {
    await this.service.disableInProject(workspaceSlug, projectId, typeId);
    await this.fetchProjectTypes(workspaceSlug, projectId);
  };
}
```

`apps/web/store/workspace/index.ts` :

- après `import { WebhookStore } from "./webhook.store";` :

```ts
import type { IWorkItemTypeStore } from "./work-item-type.store";
import { WorkItemTypeStore } from "./work-item-type.store";
```

- dans `IWorkspaceRootStore`, après `home: IHomeStore;` : `workItemType: IWorkItemTypeStore;`
- dans `BaseWorkspaceRootStore`, après `apiToken: IApiTokenStore;` : `workItemType: IWorkItemTypeStore;`
- dans le constructeur, après `this.apiToken = new ApiTokenStore(_rootStore);` : `this.workItemType = new WorkItemTypeStore();`

`apps/web/hooks/store/use-work-item-type.ts` :

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useContext } from "react";
// mobx store
import { StoreContext } from "@/lib/store-context";
// types
import type { IWorkItemTypeStore } from "@/store/workspace/work-item-type.store";

export const useWorkItemType = (): IWorkItemTypeStore => {
  const context = useContext(StoreContext);
  if (context === undefined) throw new Error("useWorkItemType must be used within StoreProvider");
  return context.workspaceRoot.workItemType;
};
```

`apps/web/layouts/auth-layout/workspace-wrapper.tsx` :

- ajouter `WORKSPACE_WORK_ITEM_TYPES,` dans l'import `from "@plane/constants"` qui contient `WORKSPACE_STATES` ;
- ajouter `import { useWorkItemType } from "@/hooks/store/use-work-item-type";` après `import { useUser, useUserPermissions } from "@/hooks/store/user";` ;
- après `const { fetchWorkspaceStates } = useProjectState();` : `const { fetchWorkspaceTypes } = useWorkItemType();` ;
- après le `useSWR` de `WORKSPACE_STATES` :

```tsx
// fetch workspace work item types
useSWR(
  workspaceSlug ? WORKSPACE_WORK_ITEM_TYPES(workspaceSlug.toString()) : null,
  workspaceSlug ? () => fetchWorkspaceTypes(workspaceSlug.toString()) : null,
  { revalidateIfStale: false, revalidateOnFocus: false }
);
```

`apps/web/layouts/auth-layout/project-wrapper.tsx` :

- ajouter `PROJECT_WORK_ITEM_TYPES,` dans l'import multi-lignes `from "@plane/constants"` qui contient `PROJECT_LABELS` ;
- ajouter `import { useWorkItemType } from "@/hooks/store/use-work-item-type";` après `import { useUser, useUserPermissions } from "@/hooks/store/user";` ;
- après `const { fetchProjectLabels } = useLabel();` : `const { fetchProjectTypes } = useWorkItemType();` ;
- après le `useSWR` de `PROJECT_LABELS` :

```tsx
// fetching project work item types
useSWR(PROJECT_WORK_ITEM_TYPES(projectId), () => fetchProjectTypes(workspaceSlug, projectId), {
  revalidateIfStale: false,
  revalidateOnFocus: false,
});
```

- [ ] **Step 4 : relancer, les tests passent**

Run : `pnpm turbo run test --filter=web` puis `pnpm --filter web check:types` et `pnpm --filter @plane/types check:types`.
Expected : `6 passed` ; aucune erreur de type.

- [ ] **Step 5 : commit**

```bash
git add packages/types/src/work-item-type.ts packages/types/src/index.ts packages/constants/src/fetch-keys.ts apps/web/services/work-item-type.service.ts apps/web/store/workspace/work-item-type.store.ts apps/web/store/workspace/work-item-type.store.test.ts apps/web/store/workspace/index.ts apps/web/hooks/store/use-work-item-type.ts apps/web/layouts/auth-layout/workspace-wrapper.tsx apps/web/layouts/auth-layout/project-wrapper.tsx apps/web/package.json apps/web/vitest.config.ts pnpm-lock.yaml
git commit -m "feat(web): add work item type store and vitest runner"
```

---

### Task 11: Textes en et fr, puis les 20 autres locales (D7, spec 6.6)

**Files**

- Modify : `packages/i18n/src/locales/en/work-item-type.json`, `packages/i18n/src/locales/fr/work-item-type.json`
- Modify : `packages/i18n/src/locales/{bg,cs,de,es,id,it,ja,ka-ge,ko,nl,pl,pt-BR,ro,ru,sk,tr-TR,ua,vi-VN,zh-CN,zh-TW}/work-item-type.json`

**Interfaces**

- Consumes : clés existantes réutilisées : `work_item_types.label`, `work_item_types.create.{title,button,toast.*}`, `work_item_types.update.{title,button,toast.*}`, `work_item_types.create_update.form.{name,description}.placeholder`, `work_item_types.settings.set_as_default`, `work_item_types.settings.cant_set_default_inactive_message`, `work_item_types.settings.item_delete_confirmation.{title,description,primary_button,toast.*,errors.*}`, `common.default`, `common.actions.edit`, `common.actions.delete`, `cancel`, `deleting`, `common.error.label`, `entity.update.failed`, `issue.label`.
- Produces : les clés ci-dessous, utilisées par les tâches 12 à 16.

Constat : `pnpm --filter=@plane/i18n check:sync` (CI, `--ci`) échoue dès qu'une locale manque une clé de `en`, et le skill `translate` interdit de recopier l'anglais. Les nouvelles clés vont donc dans les 22 locales, pas seulement en et fr (écart avec D7, voir le rapport).

- [ ] **Step 1 : ajouter les clés en anglais (le test de synchronisation échoue)**

Fusionner dans `packages/i18n/src/locales/en/work-item-type.json`, sous l'objet racine `work_item_types` existant (ne rien supprimer) :

```json
{
  "work_item_types": {
    "settings": {
      "list": {
        "description": "Create the work item types that projects in this workspace can use.",
        "inactive_badge": "Inactive",
        "work_item_count": "{count, plural, one {# work item} other {# work items}}",
        "load_error": "Work item types could not be loaded.",
        "more_actions": "Actions for {name}"
      },
      "actions": {
        "deactivate": "Deactivate",
        "reactivate": "Reactivate"
      },
      "disabled_reasons": {
        "default_cannot_be_deactivated": "The default type cannot be deactivated.",
        "project_default_cannot_be_deactivated": "This type is the default type of at least one project."
      },
      "project": {
        "description": "Choose the work item types this project uses and its default type.",
        "used_in_project": "Used in this project",
        "set_default": "Make default",
        "toast_error": "The work item types of this project could not be updated.",
        "disabled_reasons": {
          "project_default": "The default type of the project cannot be removed.",
          "in_use": "Work items of this project use this type.",
          "not_enabled": "Use this type in the project first."
        }
      }
    },
    "create_update": {
      "form": {
        "name": {
          "label": "Name",
          "required": "Name is required.",
          "max_length": "Name must be 255 characters or fewer."
        },
        "description": {
          "label": "Description",
          "max_length": "Description must be 1000 characters or fewer."
        },
        "icon": {
          "label": "Icon"
        }
      }
    },
    "select": {
      "label": "Type"
    },
    "switcher": {
      "label": "Change work item type"
    },
    "activity": {
      "changed_from": "changed the type from",
      "to": "to"
    },
    "filter": {
      "label": "Work item type"
    },
    "group_by": {
      "label": "Work item type"
    },
    "display_property": {
      "label": "Work item type"
    }
  }
}
```

Run : `pnpm --filter=@plane/i18n check:sync`
Expected : code de sortie 1, chaque locale autre que `en` signale 29 clés manquantes (`work_item_types.settings.list.description`, ...).

- [ ] **Step 2 : ajouter le français**

Fusionner dans `packages/i18n/src/locales/fr/work-item-type.json` la même structure avec ces valeurs (vocabulaire existant de la locale fr : « élément de travail », « espace de travail ») :

```json
{
  "work_item_types": {
    "settings": {
      "list": {
        "description": "Créez les types d'éléments de travail que les projets de cet espace de travail peuvent utiliser.",
        "inactive_badge": "Inactif",
        "work_item_count": "{count, plural, one {# élément de travail} other {# éléments de travail}}",
        "load_error": "Impossible de charger les types d'éléments de travail.",
        "more_actions": "Actions pour {name}"
      },
      "actions": {
        "deactivate": "Désactiver",
        "reactivate": "Réactiver"
      },
      "disabled_reasons": {
        "default_cannot_be_deactivated": "Le type par défaut ne peut pas être désactivé.",
        "project_default_cannot_be_deactivated": "Ce type est le type par défaut d'au moins un projet."
      },
      "project": {
        "description": "Choisissez les types d'éléments de travail utilisés par ce projet et son type par défaut.",
        "used_in_project": "Utilisé dans ce projet",
        "set_default": "Définir par défaut",
        "toast_error": "Impossible de mettre à jour les types d'éléments de travail de ce projet.",
        "disabled_reasons": {
          "project_default": "Le type par défaut du projet ne peut pas être retiré.",
          "in_use": "Des éléments de travail de ce projet utilisent ce type.",
          "not_enabled": "Utilisez d'abord ce type dans le projet."
        }
      }
    },
    "create_update": {
      "form": {
        "name": {
          "label": "Nom",
          "required": "Le nom est obligatoire.",
          "max_length": "Le nom doit contenir 255 caractères au maximum."
        },
        "description": {
          "label": "Description",
          "max_length": "La description doit contenir 1000 caractères au maximum."
        },
        "icon": {
          "label": "Icône"
        }
      }
    },
    "select": {
      "label": "Type"
    },
    "switcher": {
      "label": "Changer le type de l'élément de travail"
    },
    "activity": {
      "changed_from": "a changé le type de",
      "to": "à"
    },
    "filter": {
      "label": "Type d'élément de travail"
    },
    "group_by": {
      "label": "Type d'élément de travail"
    },
    "display_property": {
      "label": "Type d'élément de travail"
    }
  }
}
```

- [ ] **Step 3 : traduire les 20 autres locales**

Invoquer le skill `translate` avec la liste des 29 clés ci-dessus (source `en`) et les 20 locales `bg cs de es id it ja ka-ge ko nl pl pt-BR ro ru sk tr-TR ua vi-VN zh-CN zh-TW`. Respecter ses règles : formes plurielles CLDR complètes pour `work_item_count` (par exemple `one`, `few`, `many`, `other` en ru, ua, pl, cs, sk), placeholders `{count}` et `{name}` intacts, glossaire de chaque locale pour « work item ». Aucune valeur anglaise recopiée.

- [ ] **Step 4 : le test de synchronisation passe**

Run : `pnpm --filter=@plane/i18n check:sync && pnpm --filter=@plane/i18n check:types`
Expected : `All locales are in sync with English. No issues found.`, aucune erreur de type.

- [ ] **Step 5 : commit**

```bash
git add packages/i18n/src/locales
git commit -m "feat(i18n): add work item type texts"
```

---

### Task 12: Onglet « Types de ticket » des paramètres du workspace (spec 6.1)

**Files**

- Modify : `packages/types/src/settings.ts` (ligne 13, `TWorkspaceSettingsTabs`)
- Modify : `packages/constants/src/settings/workspace.ts` (`WORKSPACE_SETTINGS` lignes 29-65 ; `GROUPED_WORKSPACE_SETTINGS` ligne 78)
- Modify : `apps/web/components/settings/workspace/sidebar/item-icon.tsx` (lignes 8-25)
- Modify : `apps/web/app/routes/core.ts` (après la route `:workspaceSlug/settings/webhooks/:webhookId`, ligne 284)
- Create : `apps/web/components/work-item-types/work-item-type-icon.tsx`
- Create : `apps/web/components/work-item-types/helpers.ts`
- Create : `apps/web/components/work-item-types/settings/form-modal.tsx`
- Create : `apps/web/components/work-item-types/settings/workspace-list.tsx`
- Create : `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/work-item-types/header.tsx`
- Create : `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/work-item-types/page.tsx`
- Test : `apps/web/components/work-item-types/helpers.test.ts`

**Interfaces**

- Consumes : `useWorkItemType` (tâche 10), clés i18n (tâche 11), `useUserPermissions`, `EUserPermissions`, `EUserPermissionsLevel`.
- Produces :
  - Clé d'onglet `"work-item-types"`, `WORKSPACE_SETTINGS["work-item-types"]` (href `/settings/work-item-types`, accès `[EUserWorkspaceRoles.ADMIN]`), icône `WorkItemsOutline`.
  - `WorkItemTypeIcon({ workItemType, size?, showTooltip?, className? })`.
  - `TWorkItemTypeActionState = { disabled: boolean; reasonKey?: string }`, `getSetDefaultState(type)`, `getDeactivateState(type)`, `getDeleteState(type)`.
  - `WorkItemTypeFormModal({ workspaceSlug, isOpen, workItemType?, onClose })`, `WorkspaceWorkItemTypeList({ workspaceSlug, onEdit })`.
  - Page `:workspaceSlug/settings/work-item-types`, header `WorkItemTypesWorkspaceSettingsHeader`.

Choix : l'entrée va dans la catégorie `FEATURES` des paramètres, vide aujourd'hui ; la barre latérale masque déjà les catégories sans entrée accessible, donc un membre ne voit rien (comme Webhooks). La page refait le contrôle (`NotAuthorizedView`) et le serveur reste l'autorité (R1).

- [ ] **Step 1 : écrire le test qui échoue**

`apps/web/components/work-item-types/helpers.test.ts` :

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { TIssueType } from "@plane/types";
import { getDeactivateState, getDeleteState, getSetDefaultState } from "./helpers";

const buildType = (overrides: Partial<TIssueType> = {}): TIssueType => ({
  id: "bug",
  name: "Bug",
  description: "",
  logo_props: { in_use: "icon", icon: { name: "bug_report", color: "#e57a00" } },
  is_active: true,
  is_default: false,
  issue_count: 0,
  project_default_count: 0,
  created_at: "2026-11-12T00:00:00Z",
  updated_at: "2026-11-12T00:00:00Z",
  ...overrides,
});

describe("workspace work item type actions", () => {
  it("lets an active type become the default", () => {
    expect(getSetDefaultState(buildType())).toEqual({ disabled: false });
  });

  it("refuses an inactive type as default and says why", () => {
    expect(getSetDefaultState(buildType({ is_active: false }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.cant_set_default_inactive_message",
    });
  });

  it("refuses to deactivate the default type", () => {
    expect(getDeactivateState(buildType({ is_default: true }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.disabled_reasons.default_cannot_be_deactivated",
    });
  });

  it("refuses to deactivate the default type of a project", () => {
    expect(getDeactivateState(buildType({ project_default_count: 2 }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.disabled_reasons.project_default_cannot_be_deactivated",
    });
  });

  it("allows deactivating any other type", () => {
    expect(getDeactivateState(buildType())).toEqual({ disabled: false });
  });

  it("refuses to delete the default type", () => {
    expect(getDeleteState(buildType({ is_default: true }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.item_delete_confirmation.errors.cannot_delete_default_work_item_type",
    });
  });

  it("refuses to delete a type used by work items", () => {
    expect(getDeleteState(buildType({ issue_count: 3 }))).toEqual({
      disabled: true,
      reasonKey:
        "work_item_types.settings.item_delete_confirmation.errors.cannot_delete_work_item_type_with_associated_work_items",
    });
  });

  it("allows deleting an unused type", () => {
    expect(getDeleteState(buildType())).toEqual({ disabled: false });
  });
});
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `pnpm --filter web test`
Expected : `Failed to resolve import "./helpers"`.

- [ ] **Step 3 : implémentation minimale**

`apps/web/components/work-item-types/helpers.ts` :

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssueType } from "@plane/types";

/** A disabled action carries the i18n key of its reason, shown to every user (spec 6.1, 6.6). */
export type TWorkItemTypeActionState = { disabled: boolean; reasonKey?: string };

const ALLOWED: TWorkItemTypeActionState = { disabled: false };

export const getSetDefaultState = (workItemType: TIssueType): TWorkItemTypeActionState =>
  workItemType.is_active
    ? ALLOWED
    : { disabled: true, reasonKey: "work_item_types.settings.cant_set_default_inactive_message" };

export const getDeactivateState = (workItemType: TIssueType): TWorkItemTypeActionState => {
  if (workItemType.is_default)
    return { disabled: true, reasonKey: "work_item_types.settings.disabled_reasons.default_cannot_be_deactivated" };
  if (workItemType.project_default_count > 0)
    return {
      disabled: true,
      reasonKey: "work_item_types.settings.disabled_reasons.project_default_cannot_be_deactivated",
    };
  return ALLOWED;
};

export const getDeleteState = (workItemType: TIssueType): TWorkItemTypeActionState => {
  if (workItemType.is_default)
    return {
      disabled: true,
      reasonKey: "work_item_types.settings.item_delete_confirmation.errors.cannot_delete_default_work_item_type",
    };
  if (workItemType.issue_count > 0)
    return {
      disabled: true,
      reasonKey:
        "work_item_types.settings.item_delete_confirmation.errors.cannot_delete_work_item_type_with_associated_work_items",
    };
  return ALLOWED;
};
```

`apps/web/components/work-item-types/work-item-type-icon.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Tooltip } from "@makeplane/propel/components/tooltip";
import { Logo } from "@plane/blocks/emoji-icon-picker";
import type { TIssueType } from "@plane/types";
import { cn } from "@plane/utils";

type TWorkItemTypeIconProps = {
  workItemType: Pick<TIssueType, "name" | "logo_props">;
  size?: number;
  showTooltip?: boolean;
  className?: string;
};

export function WorkItemTypeIcon(props: TWorkItemTypeIconProps) {
  const { workItemType, size = 14, showTooltip = false, className } = props;
  // The type name is the accessible text of the glyph (spec 6.6).
  const icon = (
    <span
      role="img"
      aria-label={workItemType.name}
      className={cn("flex shrink-0 items-center justify-center", className)}
    >
      <Logo logo={workItemType.logo_props} size={size} />
    </span>
  );
  if (!showTooltip) return icon;
  return <Tooltip label={workItemType.name}>{icon}</Tooltip>;
}
```

`apps/web/components/work-item-types/settings/form-modal.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
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
import { EmojiPicker, Logo } from "@plane/blocks/emoji-icon-picker";
import type { ChangeHandlerPayload } from "@plane/blocks/emoji-icon-picker";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TIssueType, TIssueTypeFormData } from "@plane/types";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";

type TWorkItemTypeFormModalProps = {
  workspaceSlug: string;
  isOpen: boolean;
  workItemType?: TIssueType;
  onClose: () => void;
};

const EMPTY_FORM: TIssueTypeFormData = {
  name: "",
  description: "",
  logo_props: { in_use: "icon", icon: { name: "check_box", color: "#6d7b8a" } },
};

export const WorkItemTypeFormModal = observer(function WorkItemTypeFormModal(props: TWorkItemTypeFormModalProps) {
  const { workspaceSlug, isOpen, workItemType, onClose } = props;
  const [isLogoPickerOpen, setIsLogoPickerOpen] = useState(false);
  const { t } = useTranslation();
  const { createType, updateType } = useWorkItemType();
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TIssueTypeFormData>({ defaultValues: EMPTY_FORM });

  useEffect(() => {
    if (!isOpen) return;
    reset(
      workItemType
        ? { name: workItemType.name, description: workItemType.description, logo_props: workItemType.logo_props }
        : EMPTY_FORM
    );
  }, [isOpen, workItemType, reset]);

  const toastKey = workItemType ? "update" : "create";

  const onSubmit = async (formData: TIssueTypeFormData) => {
    const payload = { ...formData, name: formData.name.trim(), description: formData.description.trim() };
    try {
      if (workItemType) await updateType(workspaceSlug, workItemType.id, payload);
      else await createType(workspaceSlug, payload);
      setToast({
        type: "success",
        title: t(`work_item_types.${toastKey}.toast.success.title`),
        message: t(`work_item_types.${toastKey}.toast.success.message`, { name: payload.name }),
      });
      onClose();
    } catch (error) {
      const isNameConflict = !!(error as { name?: string[] } | undefined)?.name;
      setToast({
        type: "error",
        title: t(`work_item_types.${toastKey}.toast.error.title`),
        message: isNameConflict
          ? t(`work_item_types.${toastKey}.toast.error.message.conflict`, { name: payload.name })
          : t(`work_item_types.${toastKey}.toast.error.message.default`),
      });
    }
  };

  const handleLogoChange = (
    selection: ChangeHandlerPayload,
    onChange: (value: TIssueTypeFormData["logo_props"]) => void
  ) => {
    onChange(
      selection.type === "emoji"
        ? { in_use: "emoji", emoji: { value: selection.value } }
        : { in_use: "icon", icon: selection.value }
    );
    setIsLogoPickerOpen(false);
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
                <DialogTitle>
                  {workItemType ? t("work_item_types.update.title") : t("work_item_types.create.title")}
                </DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-5">
                <Controller
                  control={control}
                  name="logo_props"
                  render={({ field: { value, onChange } }) => (
                    <div className="flex flex-col gap-1">
                      <span className="text-body-xs-medium text-secondary">
                        {t("work_item_types.create_update.form.icon.label")}
                      </span>
                      <EmojiPicker
                        iconType="material"
                        isOpen={isLogoPickerOpen}
                        handleToggle={setIsLogoPickerOpen}
                        label={
                          <span className="grid size-9 place-items-center rounded-md border border-subtle bg-layer-2">
                            <Logo logo={value} size={20} />
                          </span>
                        }
                        onChange={(selection) => handleLogoChange(selection, onChange)}
                        defaultIconColor={value.in_use === "icon" ? value.icon?.color : undefined}
                        defaultOpen={value.in_use === "emoji" ? "emoji" : "icon"}
                      />
                    </div>
                  )}
                />
                <Controller
                  control={control}
                  name="name"
                  rules={{
                    validate: (value) =>
                      value.trim().length > 0 || t("work_item_types.create_update.form.name.required"),
                    maxLength: { value: 255, message: t("work_item_types.create_update.form.name.max_length") },
                  }}
                  render={({ field: { value, onChange, ref } }) => (
                    <InputField
                      size="lg"
                      orientation="vertical"
                      id="work-item-type-name"
                      name="name"
                      type="text"
                      required
                      label={t("work_item_types.create_update.form.name.label")}
                      placeholder={t("work_item_types.create_update.form.name.placeholder")}
                      value={value}
                      onChange={onChange}
                      ref={ref}
                      error={errors.name?.message}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="description"
                  rules={{
                    maxLength: { value: 1000, message: t("work_item_types.create_update.form.description.max_length") },
                  }}
                  render={({ field: { value, onChange } }) => (
                    <TextAreaField
                      size="lg"
                      resize="none"
                      autoResize
                      maxRows={6}
                      id="work-item-type-description"
                      name="description"
                      label={t("work_item_types.create_update.form.description.label")}
                      placeholder={t("work_item_types.create_update.form.description.placeholder")}
                      value={value}
                      onChange={onChange}
                      error={errors.description?.message}
                    />
                  )}
                />
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button variant="secondary" size="md" stretch="auto" onClick={onClose} label={t("cancel")} />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              loading={isSubmitting}
              label={workItemType ? t("work_item_types.update.button") : t("work_item_types.create.button")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
});
```

`apps/web/components/work-item-types/settings/workspace-list.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Badge } from "@makeplane/propel/components/badge";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@makeplane/propel/components/menu";
import {
  DefaultTabOutline,
  DeleteOutline,
  EditOutline,
  MoreHorizontalOutline,
  ToggleOffOutline,
  ToggleOnOutline,
} from "@makeplane/propel/icons";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TIssueType, TIssueTypeUpdatePayload } from "@plane/types";
// components
import { getDeactivateState, getDeleteState, getSetDefaultState } from "@/components/work-item-types/helpers";
import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";

type TRowProps = {
  workspaceSlug: string;
  workItemType: TIssueType;
  onEdit: (workItemType: TIssueType) => void;
};

const WorkspaceWorkItemTypeRow = observer(function WorkspaceWorkItemTypeRow(props: TRowProps) {
  const { workspaceSlug, workItemType, onEdit } = props;
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { t } = useTranslation();
  const { updateType, removeType } = useWorkItemType();
  const setDefaultState = getSetDefaultState(workItemType);
  const deactivateState = getDeactivateState(workItemType);
  const deleteState = getDeleteState(workItemType);
  const reason = (reasonKey?: string) => (reasonKey ? t(reasonKey) : undefined);

  const runUpdate = async (payload: TIssueTypeUpdatePayload) => {
    try {
      await updateType(workspaceSlug, workItemType.id, payload);
      setToast({
        type: "success",
        title: t("work_item_types.update.toast.success.title"),
        message: t("work_item_types.update.toast.success.message", { name: workItemType.name }),
      });
    } catch {
      setToast({
        type: "error",
        title: t("work_item_types.update.toast.error.title"),
        message: t("work_item_types.update.toast.error.message.default"),
      });
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await removeType(workspaceSlug, workItemType.id);
      setToast({
        type: "success",
        title: t("work_item_types.settings.item_delete_confirmation.toast.success.title"),
        message: t("work_item_types.settings.item_delete_confirmation.toast.success.message"),
      });
      setIsDeleteOpen(false);
    } catch {
      setToast({
        type: "error",
        title: t("work_item_types.settings.item_delete_confirmation.toast.error.title"),
        message: t("work_item_types.settings.item_delete_confirmation.toast.error.message"),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <WorkItemTypeIcon workItemType={workItemType} size={18} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body-sm-medium text-primary">{workItemType.name}</span>
          {workItemType.is_default && <Badge variant="brand" size="xs" label={t("common.default")} />}
          {!workItemType.is_active && (
            <Badge variant="neutral" size="xs" label={t("work_item_types.settings.list.inactive_badge")} />
          )}
        </div>
        {workItemType.description && (
          <p className="truncate text-body-xs-regular text-tertiary">{workItemType.description}</p>
        )}
      </div>
      <span className="shrink-0 text-body-xs-regular text-tertiary">
        {t("work_item_types.settings.list.work_item_count", { count: workItemType.issue_count })}
      </span>
      <Menu>
        <MenuTrigger
          render={
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t("work_item_types.settings.list.more_actions", { name: workItemType.name })}
              icon={<Icon icon={MoreHorizontalOutline} />}
            />
          }
        />
        <MenuContent side="bottom" align="end">
          <MenuItem
            icon={<Icon icon={EditOutline} />}
            label={t("common.actions.edit")}
            onClick={() => onEdit(workItemType)}
          />
          {!workItemType.is_default && (
            <MenuItem
              icon={<Icon icon={DefaultTabOutline} />}
              label={t("work_item_types.settings.set_as_default")}
              description={reason(setDefaultState.reasonKey)}
              disabled={setDefaultState.disabled}
              onClick={() => void runUpdate({ is_default: true })}
            />
          )}
          {workItemType.is_active ? (
            <MenuItem
              icon={<Icon icon={ToggleOffOutline} />}
              label={t("work_item_types.settings.actions.deactivate")}
              description={reason(deactivateState.reasonKey)}
              disabled={deactivateState.disabled}
              onClick={() => void runUpdate({ is_active: false })}
            />
          ) : (
            <MenuItem
              icon={<Icon icon={ToggleOnOutline} />}
              label={t("work_item_types.settings.actions.reactivate")}
              onClick={() => void runUpdate({ is_active: true })}
            />
          )}
          <MenuSeparator />
          <MenuItem
            variant="danger"
            icon={<Icon icon={DeleteOutline} />}
            label={t("common.actions.delete")}
            description={reason(deleteState.reasonKey)}
            disabled={deleteState.disabled}
            onClick={() => setIsDeleteOpen(true)}
          />
        </MenuContent>
      </Menu>
      <ConfirmDialog
        handleClose={() => setIsDeleteOpen(false)}
        handleSubmit={handleDelete}
        isSubmitting={isDeleting}
        isOpen={isDeleteOpen}
        title={t("work_item_types.settings.item_delete_confirmation.title")}
        content={t("work_item_types.settings.item_delete_confirmation.description")}
        primaryButtonText={{
          loading: t("deleting"),
          default: t("work_item_types.settings.item_delete_confirmation.primary_button"),
        }}
      />
    </li>
  );
});

type TWorkspaceWorkItemTypeListProps = {
  workspaceSlug: string;
  onEdit: (workItemType: TIssueType) => void;
};

export const WorkspaceWorkItemTypeList = observer(function WorkspaceWorkItemTypeList(
  props: TWorkspaceWorkItemTypeListProps
) {
  const { workspaceSlug, onEdit } = props;
  const { t } = useTranslation();
  const { getWorkspaceTypes } = useWorkItemType();

  return (
    <ul aria-label={t("work_item_types.label")} className="divide-y divide-subtle rounded-lg border border-subtle">
      {getWorkspaceTypes().map((workItemType) => (
        <WorkspaceWorkItemTypeRow
          key={workItemType.id}
          workspaceSlug={workspaceSlug}
          workItemType={workItemType}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
});
```

`packages/types/src/settings.ts`, ligne 13 :

```ts
export type TWorkspaceSettingsTabs =
  | "general"
  | "members"
  | "billing-and-plans"
  | "export"
  | "webhooks"
  | "work-item-types";
```

`packages/constants/src/settings/workspace.ts` : ajouter dans `WORKSPACE_SETTINGS`, après `webhooks` :

```ts
  "work-item-types": {
    key: "work-item-types",
    i18n_label: "work_item_types.label",
    href: `/settings/work-item-types`,
    access: [EUserWorkspaceRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/settings/work-item-types/`,
  },
```

et remplacer `[WORKSPACE_SETTINGS_CATEGORY.FEATURES]: [],` par `[WORKSPACE_SETTINGS_CATEGORY.FEATURES]: [WORKSPACE_SETTINGS["work-item-types"]],`.

`apps/web/components/settings/workspace/sidebar/item-icon.tsx` : ajouter `WorkItemsOutline,` à l'import `@makeplane/propel/icons` et `"work-item-types": WorkItemsOutline,` après `webhooks: WebhooksOutline,`.

`apps/web/app/routes/core.ts`, après la route `:workspaceSlug/settings/webhooks/:webhookId` :

```ts
          route(
            ":workspaceSlug/settings/work-item-types",
            "./(all)/[workspaceSlug]/(settings)/settings/(workspace)/work-item-types/page.tsx"
          ),
```

`apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/work-item-types/header.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { WORKSPACE_SETTINGS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { SettingsPageHeader } from "@/components/settings/page-header";
import { WORKSPACE_SETTINGS_ICONS } from "@/components/settings/workspace/sidebar/item-icon";

export const WorkItemTypesWorkspaceSettingsHeader = observer(function WorkItemTypesWorkspaceSettingsHeader() {
  const { t } = useTranslation();
  const settingsDetails = WORKSPACE_SETTINGS["work-item-types"];
  const Icon = WORKSPACE_SETTINGS_ICONS["work-item-types"];

  return (
    <SettingsPageHeader
      leftItem={
        <div className="flex items-center gap-2">
          <Breadcrumbs>
            <Breadcrumbs.Item
              component={
                <BreadcrumbLink
                  label={t(settingsDetails.i18n_label)}
                  icon={<Icon className="size-4 text-tertiary" />}
                />
              }
            />
          </Breadcrumbs>
        </div>
      }
    />
  );
});
```

`apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/work-item-types/page.tsx` :

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
import { EUserPermissions, EUserPermissionsLevel, WORKSPACE_WORK_ITEM_TYPES } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@makeplane/propel/components/button";
import { Loader } from "@plane/blocks/skeleton";
import type { TIssueType } from "@plane/types";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { WorkItemTypeFormModal } from "@/components/work-item-types/settings/form-modal";
import { WorkspaceWorkItemTypeList } from "@/components/work-item-types/settings/workspace-list";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { WorkItemTypesWorkspaceSettingsHeader } from "./header";

function WorkItemTypesSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const [modalState, setModalState] = useState<{ isOpen: boolean; workItemType?: TIssueType }>({ isOpen: false });
  const { t } = useTranslation();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const { currentWorkspace } = useWorkspace();
  const { fetchWorkspaceTypes, getWorkspaceTypes } = useWorkItemType();
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const { isLoading, error } = useSWR(
    isWorkspaceAdmin ? WORKSPACE_WORK_ITEM_TYPES(workspaceSlug) : null,
    isWorkspaceAdmin ? () => fetchWorkspaceTypes(workspaceSlug) : null
  );
  const workItemTypes = getWorkspaceTypes();
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - ${t("work_item_types.label")}` : undefined;

  if (workspaceUserInfo && !isWorkspaceAdmin) return <NotAuthorizedView section="settings" className="h-auto" />;

  return (
    <SettingsContentWrapper header={<WorkItemTypesWorkspaceSettingsHeader />}>
      <PageHead title={pageTitle} />
      <WorkItemTypeFormModal
        workspaceSlug={workspaceSlug}
        isOpen={modalState.isOpen}
        workItemType={modalState.workItemType}
        onClose={() => setModalState({ isOpen: false })}
      />
      <SettingsHeading
        title={t("work_item_types.label")}
        description={t("work_item_types.settings.list.description")}
        control={
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            label={t("work_item_types.create.button")}
            onClick={() => setModalState({ isOpen: true })}
          />
        }
      />
      <div className="mt-4">
        {error ? (
          <p role="alert" className="text-body-sm-regular text-danger-primary">
            {t("work_item_types.settings.list.load_error")}
          </p>
        ) : isLoading && workItemTypes.length === 0 ? (
          <Loader className="space-y-3">
            <Loader.Item height="56px" />
            <Loader.Item height="56px" />
          </Loader>
        ) : (
          <WorkspaceWorkItemTypeList
            workspaceSlug={workspaceSlug}
            onEdit={(workItemType) => setModalState({ isOpen: true, workItemType })}
          />
        )}
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(WorkItemTypesSettingsPage);
```

- [ ] **Step 4 : relancer, les tests et les contrôles passent**

Run : `pnpm --filter web test && pnpm turbo run check:types --filter=web && pnpm --filter web check:lint`
Expected : tests `passed`, aucune erreur de type ni de lint.

Vérification manuelle rapide (`pnpm dev` + API Docker) : en admin, `/<slug>/settings/work-item-types` liste « Tâche » avec le badge par défaut ; « Supprimer » et « Désactiver » de « Tâche » sont grisés avec leur motif ; création, renommage, désactivation fonctionnent. En membre, l'entrée n'apparaît pas et l'URL directe affiche « Accès non autorisé ».

- [ ] **Step 5 : commit**

```bash
git add packages/types/src/settings.ts packages/constants/src/settings/workspace.ts apps/web/components/settings/workspace/sidebar/item-icon.tsx apps/web/app/routes/core.ts apps/web/components/work-item-types "apps/web/app/(all)/[workspaceSlug]/(settings)/settings/(workspace)/work-item-types"
git commit -m "feat(web): add workspace work item types settings"
```

---

### Task 13: Onglet « Types de ticket » des paramètres du projet (spec 6.2)

**Files**

- Modify : `packages/types/src/settings.ts` (`TProjectSettingsTabs`, lignes 22-33)
- Modify : `packages/constants/src/settings/project.ts` (`PROJECT_SETTINGS` après `estimates`, ligne 102 ; `GROUPED_PROJECT_SETTINGS` lignes 123-127)
- Modify : `apps/web/components/settings/project/sidebar/item-icon.tsx`
- Modify : `apps/web/app/routes/core.ts` (après la route `.../estimates`, ligne 340)
- Modify : `apps/web/components/work-item-types/helpers.ts`, `apps/web/components/work-item-types/helpers.test.ts`
- Create : `apps/web/components/work-item-types/settings/project-list.tsx`
- Create : `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/work-item-types/header.tsx`
- Create : `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/work-item-types/page.tsx`

**Interfaces**

- Consumes : `getProjectTypeLink`, `getWorkspaceTypes`, `enableInProject`, `disableInProject`, `setProjectDefault` (tâche 10), `WorkItemTypeIcon`, `TWorkItemTypeActionState` (tâche 12).
- Produces : `getProjectToggleState(link)`, `getProjectDefaultState(link)` ; `ProjectWorkItemTypeList({ workspaceSlug, projectId })` ; clé d'onglet `"work_item_types"`, `PROJECT_SETTINGS.work_item_types` (href `/work-item-types`, accès `[EUserProjectRoles.ADMIN]`) ; page `:workspaceSlug/settings/projects/:projectId/work-item-types`.

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `apps/web/components/work-item-types/helpers.test.ts` (compléter l'import de `./helpers` avec `getProjectDefaultState, getProjectToggleState` et ajouter `TProjectIssueType` à l'import de types) :

```ts
const buildLink = (overrides: Partial<TProjectIssueType> = {}): TProjectIssueType => ({
  id: "link",
  project_id: "p1",
  issue_type_id: "bug",
  is_default: false,
  issue_count: 0,
  ...overrides,
});

describe("project work item type actions", () => {
  it("lets an admin enable a type that is not used yet", () => {
    expect(getProjectToggleState(undefined)).toEqual({ disabled: false });
  });

  it("refuses to remove the project default", () => {
    expect(getProjectToggleState(buildLink({ is_default: true }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.project.disabled_reasons.project_default",
    });
  });

  it("refuses to remove a type used by work items of the project", () => {
    expect(getProjectToggleState(buildLink({ issue_count: 1 }))).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.project.disabled_reasons.in_use",
    });
  });

  it("allows removing an unused type", () => {
    expect(getProjectToggleState(buildLink())).toEqual({ disabled: false });
  });

  it("only offers the default choice for an enabled type", () => {
    expect(getProjectDefaultState(undefined)).toEqual({
      disabled: true,
      reasonKey: "work_item_types.settings.project.disabled_reasons.not_enabled",
    });
    expect(getProjectDefaultState(buildLink())).toEqual({ disabled: false });
  });
});
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `pnpm --filter web test`
Expected : `getProjectToggleState is not a function` (export absent).

- [ ] **Step 3 : implémentation minimale**

`apps/web/components/work-item-types/helpers.ts` : remplacer l'import par `import type { TIssueType, TProjectIssueType } from "@plane/types";` et ajouter :

```ts
export const getProjectToggleState = (link: TProjectIssueType | undefined): TWorkItemTypeActionState => {
  if (!link) return ALLOWED;
  if (link.is_default)
    return { disabled: true, reasonKey: "work_item_types.settings.project.disabled_reasons.project_default" };
  if (link.issue_count > 0)
    return { disabled: true, reasonKey: "work_item_types.settings.project.disabled_reasons.in_use" };
  return ALLOWED;
};

export const getProjectDefaultState = (link: TProjectIssueType | undefined): TWorkItemTypeActionState =>
  link ? ALLOWED : { disabled: true, reasonKey: "work_item_types.settings.project.disabled_reasons.not_enabled" };
```

`apps/web/components/work-item-types/settings/project-list.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TIssueType } from "@plane/types";
// components
import { getProjectDefaultState, getProjectToggleState } from "@/components/work-item-types/helpers";
import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";

type TRowProps = { workspaceSlug: string; projectId: string; workItemType: TIssueType };

const ProjectWorkItemTypeRow = observer(function ProjectWorkItemTypeRow(props: TRowProps) {
  const { workspaceSlug, projectId, workItemType } = props;
  const [isPending, setIsPending] = useState(false);
  const { t } = useTranslation();
  const { getProjectTypeLink, enableInProject, disableInProject, setProjectDefault } = useWorkItemType();
  const link = getProjectTypeLink(projectId, workItemType.id);
  const toggleState = getProjectToggleState(link);
  const defaultState = getProjectDefaultState(link);
  const reasonId = `work-item-type-${workItemType.id}-reason`;
  const reasonKey = toggleState.reasonKey ?? (link?.is_default ? undefined : defaultState.reasonKey);

  const run = async (operation: () => Promise<void>) => {
    setIsPending(true);
    try {
      await operation();
    } catch {
      setToast({
        type: "error",
        title: t("common.error.label"),
        message: t("work_item_types.settings.project.toast_error"),
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <WorkItemTypeIcon workItemType={workItemType} size={18} />
      <div className="min-w-0 flex-1">
        <span className="truncate text-body-sm-medium text-primary">{workItemType.name}</span>
        {reasonKey && (
          <p id={reasonId} className="text-body-xs-regular text-tertiary">
            {t(reasonKey)}
          </p>
        )}
      </div>
      <Checkbox
        label={t("work_item_types.settings.project.used_in_project")}
        checked={!!link}
        disabled={isPending || toggleState.disabled}
        aria-describedby={reasonKey ? reasonId : undefined}
        onCheckedChange={(checked) =>
          void run(() =>
            checked
              ? enableInProject(workspaceSlug, projectId, workItemType.id)
              : disableInProject(workspaceSlug, projectId, workItemType.id)
          )
        }
      />
      {link?.is_default ? (
        <Badge variant="brand" size="xs" label={t("common.default")} />
      ) : (
        <Button
          variant="secondary"
          size="sm"
          label={t("work_item_types.settings.project.set_default")}
          disabled={isPending || defaultState.disabled}
          aria-describedby={defaultState.disabled ? reasonId : undefined}
          onClick={() => void run(() => setProjectDefault(workspaceSlug, projectId, workItemType.id))}
        />
      )}
    </li>
  );
});

type TProjectWorkItemTypeListProps = { workspaceSlug: string; projectId: string };

export const ProjectWorkItemTypeList = observer(function ProjectWorkItemTypeList(props: TProjectWorkItemTypeListProps) {
  const { workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  const { getWorkspaceTypes, getProjectTypeLink } = useWorkItemType();
  // Active types can be added; inactive ones stay listed while the project still uses them (R7).
  const workItemTypes = getWorkspaceTypes().filter(
    (workItemType) => workItemType.is_active || !!getProjectTypeLink(projectId, workItemType.id)
  );

  return (
    <ul aria-label={t("work_item_types.label")} className="divide-y divide-subtle rounded-lg border border-subtle">
      {workItemTypes.map((workItemType) => (
        <ProjectWorkItemTypeRow
          key={workItemType.id}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          workItemType={workItemType}
        />
      ))}
    </ul>
  );
});
```

`packages/types/src/settings.ts` : ajouter `| "work_item_types"` après `| "estimates"` dans `TProjectSettingsTabs`.

`packages/constants/src/settings/project.ts` : ajouter après l'entrée `estimates` :

```ts
  work_item_types: {
    key: "work_item_types",
    i18n_label: "work_item_types.label",
    href: `/work-item-types`,
    access: [EUserProjectRoles.ADMIN],
    highlight: (pathname: string, baseUrl: string) => pathname === `${baseUrl}/work-item-types/`,
  },
```

et ajouter `PROJECT_SETTINGS["work_item_types"],` après `PROJECT_SETTINGS["estimates"],` dans `GROUPED_PROJECT_SETTINGS[PROJECT_SETTINGS_CATEGORY.WORK_STRUCTURE]`.

`apps/web/components/settings/project/sidebar/item-icon.tsx` : ajouter `WorkItemsOutline,` à l'import `@makeplane/propel/icons` et `work_item_types: WorkItemsOutline,` après `estimates: EstimateOutline,`.

`apps/web/app/routes/core.ts`, après la route `// Project Estimates` :

```ts
            // Project Work Item Types
            route(
              ":workspaceSlug/settings/projects/:projectId/work-item-types",
              "./(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/work-item-types/page.tsx"
            ),
```

`apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/work-item-types/header.tsx` : identique au header de la tâche 12, avec `PROJECT_SETTINGS` (depuis `@plane/constants`), `PROJECT_SETTINGS_ICONS` (depuis `@/components/settings/project/sidebar/item-icon`), la clé `work_item_types` et le nom `WorkItemTypesProjectSettingsHeader` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { PROJECT_SETTINGS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { SettingsPageHeader } from "@/components/settings/page-header";
import { PROJECT_SETTINGS_ICONS } from "@/components/settings/project/sidebar/item-icon";

export const WorkItemTypesProjectSettingsHeader = observer(function WorkItemTypesProjectSettingsHeader() {
  const { t } = useTranslation();
  const settingsDetails = PROJECT_SETTINGS.work_item_types;
  const Icon = PROJECT_SETTINGS_ICONS.work_item_types;

  return (
    <SettingsPageHeader
      leftItem={
        <div className="flex items-center gap-2">
          <Breadcrumbs>
            <Breadcrumbs.Item
              component={
                <BreadcrumbLink
                  label={t(settingsDetails.i18n_label)}
                  icon={<Icon className="size-4 text-tertiary" />}
                />
              }
            />
          </Breadcrumbs>
        </div>
      }
    />
  );
});
```

`apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/work-item-types/page.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { ProjectWorkItemTypeList } from "@/components/work-item-types/settings/project-list";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { WorkItemTypesProjectSettingsHeader } from "./header";

function WorkItemTypesProjectSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { currentProjectDetails } = useProject();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  // R3: project admins and workspace admins; the server checks it again on every call.
  const canManage =
    allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId) ||
    allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
  const pageTitle = currentProjectDetails?.name
    ? `${currentProjectDetails.name} - ${t("work_item_types.label")}`
    : undefined;

  if (workspaceUserInfo && !canManage) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;

  return (
    <SettingsContentWrapper header={<WorkItemTypesProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <SettingsHeading
        title={t("work_item_types.label")}
        description={t("work_item_types.settings.project.description")}
      />
      <div className="mt-4">
        <ProjectWorkItemTypeList workspaceSlug={workspaceSlug} projectId={projectId} />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(WorkItemTypesProjectSettingsPage);
```

- [ ] **Step 4 : relancer, les tests et les contrôles passent**

Run : `pnpm --filter web test && pnpm turbo run check:types --filter=web && pnpm --filter web check:lint`
Expected : tests `passed`, aucune erreur.

Vérification manuelle rapide : en admin du projet, la case de « Tâche » est grisée avec le motif « Le type par défaut du projet ne peut pas être retiré » ; cocher un nouveau type puis « Définir par défaut » déplace le badge ; un membre voit « Accès non autorisé ».

- [ ] **Step 5 : commit**

```bash
git add packages/types/src/settings.ts packages/constants/src/settings/project.ts apps/web/components/settings/project/sidebar/item-icon.tsx apps/web/app/routes/core.ts apps/web/components/work-item-types "apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/work-item-types"
git commit -m "feat(web): choose work item types in project settings"
```

---

### Task 14: Icône du type et sélecteur « Type » à la création (spec 6.3, 6.4 icône, 6.5 icône)

**Files**

- Modify : `apps/web/components/work-item-types/helpers.ts`, `apps/web/components/work-item-types/helpers.test.ts`
- Create : `apps/web/components/work-item-types/work-item-type-select.tsx`
- Modify : `apps/web/components/issues/issue-detail/issue-identifier.tsx` (fichier entier, 42 lignes)
- Modify : `apps/web/components/issues/issue-modal/provider.tsx` (imports lignes 7-14 ; ligne 28 ; ligne 47)
- Modify : `apps/web/components/issues/issue-modal/form.tsx` (import ligne 13 ; imports composants lignes 39-45 ; en-tête lignes 370-376)

**Interfaces**

- Consumes : `getTypeById`, `getProjectAssignableTypes`, `getProjectDefaultTypeId`, `fetchProjectTypes` (tâche 10), `WorkItemTypeIcon` (tâche 12), `PROJECT_WORK_ITEM_TYPES`.
- Produces :
  - `getIdentifierVisibility(displayProperties: IIssueDisplayProperties | undefined) -> { showKey: boolean; showType: boolean }`.
  - `WorkItemTypeSelect({ projectId, value, onChange(typeId: string), variant: SelectVariant, label: string, disabled?, tabIndex?, testId? })` : options = types actifs activés dans le projet, valeur vide affichée comme défaut du projet, libellé accessible par `<label htmlFor>`.
  - `IssueIdentifier` affiche l'icône du type (avec infobulle et libellé texte) devant `PRJ-12` quand `displayProperties.issue_type` n'est pas faux : listes, Kanban, tableur, Gantt et fiche, car tous ces écrans rendent `IssueIdentifier`.
  - `getIssueTypeIdOnProjectChange(projectId)` renvoie le défaut du projet (le crochet existant de `form.tsx`, lignes 187-199, remet le type au défaut au changement de projet).

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `apps/web/components/work-item-types/helpers.test.ts` (compléter l'import de `./helpers` avec `getIdentifierVisibility`) :

```ts
describe("identifier visibility", () => {
  it("shows the key and the type by default", () => {
    expect(getIdentifierVisibility(undefined)).toEqual({ showKey: true, showType: true });
  });

  it("follows the display properties of the view", () => {
    expect(getIdentifierVisibility({ key: true, issue_type: false })).toEqual({ showKey: true, showType: false });
    expect(getIdentifierVisibility({ key: false, issue_type: true })).toEqual({ showKey: false, showType: true });
  });
});
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `pnpm --filter web test`
Expected : `getIdentifierVisibility is not a function`.

- [ ] **Step 3 : implémentation minimale**

`apps/web/components/work-item-types/helpers.ts` : compléter l'import de types avec `IIssueDisplayProperties` et ajouter :

```ts
export const getIdentifierVisibility = (displayProperties: IIssueDisplayProperties | undefined) => ({
  showKey: displayProperties ? !!displayProperties.key : true,
  showType: displayProperties ? !!displayProperties.issue_type : true,
});
```

`apps/web/components/work-item-types/work-item-type-select.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useId } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { PROJECT_WORK_ITEM_TYPES } from "@plane/constants";
import { Select } from "@plane/blocks/select";
import type { SelectVariant } from "@plane/blocks/select";
import type { TIssueType } from "@plane/types";
// components
import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";

type TWorkItemTypeSelectProps = {
  projectId: string | null | undefined;
  value: string | null | undefined;
  onChange: (typeId: string) => void;
  variant: SelectVariant;
  label: string;
  disabled?: boolean;
  tabIndex?: number;
  testId?: string;
};

export const WorkItemTypeSelect = observer(function WorkItemTypeSelect(props: TWorkItemTypeSelectProps) {
  const { projectId, value, onChange, variant, label, disabled = false, tabIndex, testId } = props;
  const triggerId = useId();
  const { workspaceSlug } = useParams();
  const { getProjectAssignableTypes, getProjectDefaultTypeId, getTypeById, fetchProjectTypes } = useWorkItemType();
  useSWR(
    workspaceSlug && projectId ? PROJECT_WORK_ITEM_TYPES(projectId) : null,
    workspaceSlug && projectId ? () => fetchProjectTypes(workspaceSlug.toString(), projectId) : null,
    { revalidateIfStale: false, revalidateOnFocus: false }
  );
  const options = projectId ? getProjectAssignableTypes(projectId) : [];
  // An empty value is shown as the project default, which the server assigns on save (R9).
  const selected = getTypeById(value || (projectId ? getProjectDefaultTypeId(projectId) : null)) ?? null;

  return (
    <>
      <label htmlFor={triggerId} className="sr-only">
        {label}
      </label>
      <Select<TIssueType>
        getValues={() => options}
        value={selected}
        onChange={(typeId) => {
          if (typeId) onChange(typeId);
        }}
        disabled={disabled}
        placeholder={label}
        showSearch={false}
        pinSelected={false}
        getOptionValue={(option) => option.id}
        getOptionLabel={(option) => option.name}
        getOptionIcon={(option) => <WorkItemTypeIcon workItemType={option} size={16} />}
      >
        <Select.Trigger<TIssueType>
          id={triggerId}
          disabled={disabled}
          variant={variant}
          tabIndex={tabIndex}
          data-testid={testId}
          prependIcon={(types) => (types[0] ? <WorkItemTypeIcon workItemType={types[0]} /> : undefined)}
          label={(types) => types[0]?.name ?? label}
        >
          {(types) => <span className="min-w-0 grow truncate text-left">{types[0]?.name ?? label}</span>}
        </Select.Trigger>
      </Select>
    </>
  );
});
```

`apps/web/components/issues/issue-detail/issue-identifier.tsx` (fichier entier) :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import type { TIssueIdentifierProps } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { IdentifierText } from "@/components/issues/issue-detail/identifier-text";
import { getIdentifierVisibility } from "@/components/work-item-types/helpers";
import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";

export const IssueIdentifier = observer(function IssueIdentifier(props: TIssueIdentifierProps) {
  const { projectId, variant, size, displayProperties, enableClickToCopyIdentifier = false } = props;
  // store hooks
  const { getProjectIdentifierById } = useProject();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getTypeById } = useWorkItemType();
  // Determine if the component is using store data or not
  const isUsingStoreData = "issueId" in props;
  // derived values
  const issue = isUsingStoreData ? getIssueById(props.issueId) : null;
  const projectIdentifier = isUsingStoreData ? getProjectIdentifierById(projectId) : props.projectIdentifier;
  const issueSequenceId = isUsingStoreData ? issue?.sequence_id : props.issueSequenceId;
  const workItemType = getTypeById(isUsingStoreData ? issue?.type_id : props.issueTypeId);
  const { showKey, showType } = getIdentifierVisibility(displayProperties);
  const shouldRenderType = showType && !!workItemType;

  if (!showKey && !shouldRenderType) return null;

  return (
    <div className="flex shrink-0 items-center space-x-2">
      {shouldRenderType && workItemType && <WorkItemTypeIcon workItemType={workItemType} showTooltip />}
      {showKey && (
        <IdentifierText
          identifier={`${projectIdentifier}-${issueSequenceId}`}
          enableClickToCopyIdentifier={enableClickToCopyIdentifier}
          variant={variant}
          size={size}
        />
      )}
    </div>
  );
});
```

`apps/web/components/issues/issue-modal/provider.tsx` :

- ajouter `import { useWorkItemType } from "@/hooks/store/use-work-item-type";` après `import { useUser } from "@/hooks/store/user/user-user";` ;
- après `const { projectsWithCreatePermissions } = useUser();` : `const { getProjectDefaultTypeId } = useWorkItemType();` ;
- remplacer `getIssueTypeIdOnProjectChange: () => null,` par `getIssueTypeIdOnProjectChange: (projectId: string) => getProjectDefaultTypeId(projectId),`.

`apps/web/components/issues/issue-modal/form.tsx` :

- remplacer `import { FormProvider, useForm } from "react-hook-form";` par `import { Controller, FormProvider, useForm } from "react-hook-form";` ;
- ajouter `import { WorkItemTypeSelect } from "@/components/work-item-types/work-item-type-select";` après le bloc `from "@/components/issues/issue-modal/components"` ;
- dans le `<div className="flex items-center gap-x-1">` qui contient `IssueProjectSelect` (lignes 370-376), ajouter après `<IssueProjectSelect ... />` :

```tsx
<Controller
  control={control}
  name="type_id"
  render={({ field: { value, onChange } }) => (
    <WorkItemTypeSelect
      projectId={projectId}
      value={value}
      onChange={(typeId) => {
        onChange(typeId);
        handleFormChange();
      }}
      variant="pill-md"
      label={t("work_item_types.select.label")}
      testId="create-work-item-type-select"
    />
  )}
/>
```

- [ ] **Step 4 : relancer, les tests et les contrôles passent**

Run : `pnpm --filter web test && pnpm turbo run check:types --filter=web && pnpm --filter web check:lint`
Expected : tests `passed`, aucune erreur.

Vérification manuelle rapide : la fenêtre de création affiche « Type » préréglé sur le défaut du projet et ne propose que les types activés ; changer de projet remet le défaut du nouveau projet ; l'icône du type apparaît devant l'identifiant dans la liste, le Kanban, le tableur et la fiche, et disparaît quand la propriété d'affichage « Type d'élément de travail » est décochée (tâche 16).

- [ ] **Step 5 : commit**

```bash
git add apps/web/components/work-item-types apps/web/components/issues/issue-detail/issue-identifier.tsx apps/web/components/issues/issue-modal/provider.tsx apps/web/components/issues/issue-modal/form.tsx
git commit -m "feat(web): pick and show the work item type"
```

---

### Task 15: Changement de type depuis la fiche et rendu de l'historique (spec 6.4, R11)

**Files**

- Modify : `apps/web/components/work-item-types/helpers.ts`, `apps/web/components/work-item-types/helpers.test.ts`
- Modify : `apps/web/components/issues/issue-type-switcher.tsx` (fichier entier, 30 lignes)
- Create : `apps/web/components/issues/issue-detail/issue-activity/activity/actions/type.tsx`
- Modify : `apps/web/components/issues/issue-detail/issue-activity/activity/actions/index.ts` (après `export * from "./priority";`)
- Modify : `apps/web/components/issues/issue-detail/issue-activity/activity/activity-list.tsx` (import lignes 14-33 ; `switch` ligne 66)

**Interfaces**

- Consumes : `WorkItemTypeSelect`, `IssueIdentifier` (tâche 14), `useIssueDetail().updateIssue(workspaceSlug, projectId, issueId, data)` (recharge aussi l'activité), activité backend `field="type"` (tâche 8).
- Produces : `getWorkItemTypeChange(currentTypeId: string | null | undefined, nextTypeId: string) -> { type_id: string } | null` ; `IssueTypeActivity({ activityId, ends })`.

Les deux usages existants (`main-content.tsx` ligne 122, `peek-overview/issue-detail.tsx` ligne 103) passent déjà `disabled={isArchived || !isEditable}` ou `disabled={isArchived || disabled}` : seuls ceux qui peuvent modifier le ticket ouvrent le menu ; le serveur contrôle à nouveau (tâche 7).

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `apps/web/components/work-item-types/helpers.test.ts` (compléter l'import avec `getWorkItemTypeChange`) :

```ts
describe("work item type change", () => {
  it("sends nothing when the type does not change", () => {
    expect(getWorkItemTypeChange("bug", "bug")).toBeNull();
  });

  it("sends the new type id otherwise", () => {
    expect(getWorkItemTypeChange("task", "bug")).toEqual({ type_id: "bug" });
    expect(getWorkItemTypeChange(null, "bug")).toEqual({ type_id: "bug" });
  });
});
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `pnpm --filter web test`
Expected : `getWorkItemTypeChange is not a function`.

- [ ] **Step 3 : implémentation minimale**

`apps/web/components/work-item-types/helpers.ts`, ajouter :

```ts
export const getWorkItemTypeChange = (currentTypeId: string | null | undefined, nextTypeId: string) =>
  currentTypeId === nextTypeId ? null : { type_id: nextTypeId };
```

`apps/web/components/issues/issue-type-switcher.tsx` (fichier entier) :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
// components
import { IssueIdentifier } from "@/components/issues/issue-detail/issue-identifier";
import { getWorkItemTypeChange } from "@/components/work-item-types/helpers";
import { WorkItemTypeSelect } from "@/components/work-item-types/work-item-type-select";
// store hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

export type TIssueTypeSwitcherProps = {
  issueId: string;
  disabled: boolean;
};

export const IssueTypeSwitcher = observer(function IssueTypeSwitcher(props: TIssueTypeSwitcherProps) {
  const { issueId, disabled } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  // store hooks
  const {
    issue: { getIssueById },
    updateIssue,
  } = useIssueDetail();
  // derived values
  const issue = getIssueById(issueId);

  if (!issue || !issue.project_id) return <></>;
  const projectId = issue.project_id;

  const handleChange = async (typeId: string) => {
    const change = getWorkItemTypeChange(issue.type_id, typeId);
    if (!change || !workspaceSlug) return;
    try {
      await updateIssue(workspaceSlug.toString(), projectId, issueId, change);
    } catch {
      setToast({
        type: "error",
        title: t("common.error.label"),
        message: t("entity.update.failed", { entity: t("issue.label") }),
      });
    }
  };

  return (
    <div className="flex items-center gap-1">
      <WorkItemTypeSelect
        projectId={projectId}
        value={issue.type_id}
        onChange={(typeId) => void handleChange(typeId)}
        variant="icon-md"
        label={t("work_item_types.switcher.label")}
        disabled={disabled}
      />
      <IssueIdentifier
        issueId={issueId}
        projectId={projectId}
        size="md"
        enableClickToCopyIdentifier
        displayProperties={{ key: true, issue_type: false }}
      />
    </div>
  );
});
```

`apps/web/components/issues/issue-detail/issue-activity/activity/actions/type.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { WorkItemsOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent } from "./";

type TIssueTypeActivity = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueTypeActivity = observer(function IssueTypeActivity(props: TIssueTypeActivity) {
  const { activityId, ends } = props;
  const { t } = useTranslation();
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<WorkItemsOutline className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {t("work_item_types.activity.changed_from")}{" "}
        <span className="font-medium text-primary">{activity.old_value}</span> {t("work_item_types.activity.to")}{" "}
        <span className="font-medium text-primary">{activity.new_value}</span>.
      </>
    </IssueActivityBlockComponent>
  );
});
```

`actions/index.ts`, après `export * from "./priority";` : `export * from "./type";`.

`activity-list.tsx` : ajouter `IssueTypeActivity,` dans l'import `from "./actions"` après `IssuePriorityActivity,`, et dans le `switch`, après le cas `"priority"` :

```tsx
    case "type":
      return <IssueTypeActivity {...componentDefaultProps} />;
```

- [ ] **Step 4 : relancer, les tests et les contrôles passent**

Run : `pnpm --filter web test && pnpm turbo run check:types --filter=web && pnpm --filter web check:lint`
Expected : tests `passed`, aucune erreur.

Vérification manuelle rapide : sur la fiche, un clic sur l'icône du type ouvre la liste des types du projet ; un choix met à jour l'icône et ajoute « a changé le type de Tâche à Bug » dans l'historique ; en invité (fiche en lecture seule) le menu ne s'ouvre pas.

- [ ] **Step 5 : commit**

```bash
git add apps/web/components/work-item-types apps/web/components/issues/issue-type-switcher.tsx apps/web/components/issues/issue-detail/issue-activity/activity
git commit -m "feat(web): change the work item type from its details"
```

---

### Task 16: Filtre, regroupement et propriété d'affichage « Type » (spec 6.5)

**Files**

- Modify : `packages/types/src/view-props.ts` (`TIssueGroupByOptions` lignes 14-26 ; `WORK_ITEM_FILTER_PROPERTY_KEYS` lignes 96-112)
- Modify : `packages/types/src/issues.ts` (`GroupByColumnTypes` lignes 119-129)
- Modify : `packages/constants/src/issue/common.ts` (`EIssueGroupByToServerOptions` lignes 27-40 ; `EIssueGroupBYServerToProperty` lignes 42-53 ; `ISSUE_GROUP_BY_OPTIONS` ligne 119 ; `ISSUE_DISPLAY_PROPERTIES` ligne 176)
- Modify : `packages/constants/src/issue/filter.ts` (`EServerGroupByToFilterOptions` lignes 21-32 ; `ISSUE_DISPLAY_FILTERS_BY_PAGE.issues`, lignes 206-245)
- Create : `packages/utils/src/work-item-filters/configs/filters/work-item-type.ts`
- Modify : `packages/utils/src/work-item-filters/configs/filters/index.ts`
- Modify : `apps/web/store/issue/helpers/base-issues.store.ts` (`ISSUE_GROUP_BY_KEY` lignes 115-127 ; `ISSUE_FILTER_DEFAULT_DATA` lignes 129-141)
- Modify : `apps/web/components/issues/issue-layouts/utils.tsx` (imports ; `groupByColumnMap` lignes 142-156 ; nouvelle fonction après `getPriorityColumns`, ligne 283)
- Modify : `apps/web/hooks/work-item-filters/use-work-item-filters-config.tsx` (imports lignes 7-60 ; hooks ligne ~95 ; nouvelle config après `priorityFilterConfig`, ligne 306 ; `configs` et `configMap`, lignes 365-400)
- Test : `apps/web/components/work-item-types/filters.test.ts`

**Interfaces**

- Consumes : routes de la tâche 9 (`type_id`, `type_id__in`, `group_by=type_id`), `getWorkspaceTypes` (tâche 10), `WorkItemTypeIcon`.
- Produces : option de regroupement `"issue_type"` (serveur `type_id`), propriété de filtre riche `"type_id"`, `TCreateWorkItemTypeFilterParams`, `getWorkItemTypeFilterConfig(key)(params)`, `getWorkItemTypeMultiSelectConfig(params, operator)`, propriété d'affichage `issue_type` listée dans les options d'affichage.

- [ ] **Step 1 : écrire le test qui échoue**

`apps/web/components/work-item-types/filters.test.ts` :

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  EIssueGroupBYServerToProperty,
  EIssueGroupByToServerOptions,
  ISSUE_DISPLAY_FILTERS_BY_PAGE,
  ISSUE_DISPLAY_PROPERTIES,
  ISSUE_GROUP_BY_OPTIONS,
} from "@plane/constants";
import { WORK_ITEM_FILTER_PROPERTY_KEYS } from "@plane/types";
import type { TWorkItemFilterProperty } from "@plane/types";
import { getWorkItemTypeFilterConfig } from "@plane/utils";
import type { TCreateWorkItemTypeFilterParams } from "@plane/utils";

describe("work item type filter and grouping", () => {
  it("groups by type on the server type_id column", () => {
    expect(EIssueGroupByToServerOptions["issue_type"]).toBe("type_id");
    expect(EIssueGroupBYServerToProperty["type_id"]).toBe("type_id");
    expect(ISSUE_GROUP_BY_OPTIONS.some((option) => option.key === "issue_type")).toBe(true);
    const layouts = ISSUE_DISPLAY_FILTERS_BY_PAGE.issues?.layoutOptions;
    expect(layouts?.list?.display_filters?.group_by).toContain("issue_type");
    expect(layouts?.kanban?.display_filters?.group_by).toContain("issue_type");
    expect(layouts?.kanban?.display_filters?.sub_group_by).toContain("issue_type");
  });

  it("offers the type filter and display property on the work items page", () => {
    expect(WORK_ITEM_FILTER_PROPERTY_KEYS).toContain("type_id");
    expect(ISSUE_DISPLAY_FILTERS_BY_PAGE.issues?.filters).toContain("type_id");
    expect(ISSUE_DISPLAY_PROPERTIES.some((property) => property.key === "issue_type")).toBe(true);
  });

  it("builds the type filter config with the translated label", () => {
    const config = getWorkItemTypeFilterConfig<TWorkItemFilterProperty>("type_id")({
      isEnabled: true,
      allowedOperators: new Set(),
      label: "Work item type",
      workItemTypes: [],
    } as unknown as TCreateWorkItemTypeFilterParams);
    expect(config.id).toBe("type_id");
    expect(config.label).toBe("Work item type");
  });
});
```

- [ ] **Step 2 : lancer le test et constater l'échec**

Run : `pnpm turbo run test --filter=web`
Expected : échecs `expected undefined to be 'type_id'` et `getWorkItemTypeFilterConfig is not a function`.

- [ ] **Step 3 : implémentation minimale**

`packages/types/src/view-props.ts` : ajouter `| "issue_type"` après `| "priority"` dans `TIssueGroupByOptions`, et `"type_id",` après `"priority",` dans `WORK_ITEM_FILTER_PROPERTY_KEYS`.

`packages/types/src/issues.ts` : ajouter `| "issue_type"` après `| "priority"` dans `GroupByColumnTypes`.

`packages/constants/src/issue/common.ts` :

- `EIssueGroupByToServerOptions` : ajouter `"issue_type" = "type_id",` après `"priority" = "priority",` ;
- `EIssueGroupBYServerToProperty` : ajouter `"type_id" = "type_id",` après `"priority" = "priority",` ;
- `ISSUE_GROUP_BY_OPTIONS` : ajouter `{ key: "issue_type", titleTranslationKey: "work_item_types.group_by.label" },` après l'entrée `priority` ;
- `ISSUE_DISPLAY_PROPERTIES` : ajouter `{ key: "issue_type", titleTranslationKey: "work_item_types.display_property.label" },` après l'entrée `key`.

`packages/constants/src/issue/filter.ts` :

- `EServerGroupByToFilterOptions` : ajouter `"type_id" = "issue_type",` après `"priority" = "priority",` ;
- `ISSUE_DISPLAY_FILTERS_BY_PAGE.issues.filters` : ajouter `"type_id",` après `"priority",` ;
- `issues.layoutOptions.list.display_filters.group_by` : `["state", "priority", "issue_type", "cycle", "module", "labels", "assignees", "created_by", null]` ;
- `issues.layoutOptions.kanban.display_filters.group_by` : `["state", "priority", "issue_type", "cycle", "module", "labels", "assignees", "created_by"]` ;
- `issues.layoutOptions.kanban.display_filters.sub_group_by` : `["state", "priority", "issue_type", "cycle", "module", "labels", "assignees", "created_by", null]`.

`packages/utils/src/work-item-filters/configs/filters/work-item-type.ts` :

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { TFilterProperty, TIssueType, TSupportedOperators } from "@plane/types";
import { EQUALITY_OPERATOR, COLLECTION_OPERATOR } from "@plane/types";
// local imports
import type { TCreateFilterConfigParams, IFilterIconConfig, TCreateFilterConfig } from "../../../rich-filters";
import { createFilterConfig, getMultiSelectConfig, createOperatorConfigEntry } from "../../../rich-filters";

/**
 * Work item type filter params; the label comes from the caller so it is translated.
 */
export type TCreateWorkItemTypeFilterParams = TCreateFilterConfigParams &
  IFilterIconConfig<TIssueType> & {
    label: string;
    workItemTypes: TIssueType[];
  };

export const getWorkItemTypeMultiSelectConfig = (
  params: TCreateWorkItemTypeFilterParams,
  singleValueOperator: TSupportedOperators
) =>
  getMultiSelectConfig<TIssueType, string, TIssueType>(
    {
      items: params.workItemTypes,
      getId: (workItemType) => workItemType.id,
      getLabel: (workItemType) => workItemType.name,
      getValue: (workItemType) => workItemType.id,
      getIconData: (workItemType) => workItemType,
    },
    {
      singleValueOperator,
      ...params,
    },
    {
      getOptionIcon: params.getOptionIcon,
    }
  );

export const getWorkItemTypeFilterConfig =
  <P extends TFilterProperty>(key: P): TCreateFilterConfig<P, TCreateWorkItemTypeFilterParams> =>
  (params: TCreateWorkItemTypeFilterParams) =>
    createFilterConfig<P>({
      id: key,
      ...params,
      label: params.label,
      icon: params.filterIcon,
      supportedOperatorConfigsMap: new Map([
        createOperatorConfigEntry(COLLECTION_OPERATOR.IN, params, (updatedParams) =>
          getWorkItemTypeMultiSelectConfig(updatedParams, EQUALITY_OPERATOR.EXACT)
        ),
      ]),
    });
```

`packages/utils/src/work-item-filters/configs/filters/index.ts` : ajouter `export * from "./work-item-type";` après `export * from "./user";`.

`apps/web/store/issue/helpers/base-issues.store.ts` : ajouter `issue_type: "type_id",` après `priority: "priority",` dans `ISSUE_GROUP_BY_KEY` et dans `ISSUE_FILTER_DEFAULT_DATA`.

`apps/web/components/issues/issue-layouts/utils.tsx` :

- ajouter `import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";` après `import { store } from "@/lib/store-context";` ;
- dans `groupByColumnMap`, ajouter `issue_type: getWorkItemTypeColumns,` après `priority: getPriorityColumns,` ;
- après `getPriorityColumns` :

```tsx
// Inactive types stay listed: existing work items keep them (R7).
const getWorkItemTypeColumns = (): IGroupByColumn[] =>
  store.workspaceRoot.workItemType.getWorkspaceTypes().map((workItemType) => ({
    id: workItemType.id,
    name: workItemType.name,
    icon: <WorkItemTypeIcon workItemType={workItemType} size={16} />,
    payload: { type_id: workItemType.id },
  }));
```

`apps/web/hooks/work-item-filters/use-work-item-filters-config.tsx` :

- ajouter `WorkItemsOutline,` à l'import `@makeplane/propel/icons` ; `import { useTranslation } from "@plane/i18n";` sous les imports `@plane/blocks` ; `getWorkItemTypeFilterConfig,` dans l'import `from "@plane/utils"` ; `import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";` et `import { useWorkItemType } from "@/hooks/store/use-work-item-type";` dans les imports `@/` ;
- après `const { getUserDetails } = useMember();` :

```tsx
const { getWorkspaceTypes } = useWorkItemType();
const { t } = useTranslation();
const workItemTypes = getWorkspaceTypes();
```

- après `priorityFilterConfig` :

```tsx
// work item type filter config
const workItemTypeFilterConfig = useMemo(
  () =>
    getWorkItemTypeFilterConfig<TWorkItemFilterProperty>("type_id")({
      isEnabled: isFilterEnabled("type_id") && workItemTypes.length > 0,
      filterIcon: WorkItemsOutline,
      label: t("work_item_types.filter.label"),
      workItemTypes,
      getOptionIcon: (workItemType) => <WorkItemTypeIcon workItemType={workItemType} />,
      ...operatorConfigs,
    }),
  [isFilterEnabled, workItemTypes, operatorConfigs, t]
);
```

- ajouter `workItemTypeFilterConfig,` après `priorityFilterConfig,` dans `configs`, et `type_id: workItemTypeFilterConfig,` après `priority: priorityFilterConfig,` dans `configMap`.

- [ ] **Step 4 : relancer, les tests et les contrôles passent**

Run : `pnpm turbo run test --filter=web && pnpm check:types && pnpm --filter web check:lint`
Expected : tests `passed`, aucune erreur (le compilateur signale tout autre `Record` indexé par `TIssueGroupByOptions` ou `GroupByColumnTypes` oublié ; le compléter avec `issue_type` sur le modèle de `priority`).

Vérification manuelle rapide : sur la liste des tickets d'un projet, « Filtres » propose « Type d'élément de travail » avec les icônes ; « Affichage » propose le regroupement et le sous-regroupement « Type d'élément de travail » et la propriété d'affichage du même nom ; regrouper par type affiche une colonne par type avec son icône.

- [ ] **Step 5 : commit**

```bash
git add packages/types/src/view-props.ts packages/types/src/issues.ts packages/constants/src/issue/common.ts packages/constants/src/issue/filter.ts packages/utils/src/work-item-filters/configs/filters apps/web/store/issue/helpers/base-issues.store.ts apps/web/components/issues/issue-layouts/utils.tsx apps/web/hooks/work-item-filters/use-work-item-filters-config.tsx apps/web/components/work-item-types/filters.test.ts
git commit -m "feat(web): filter and group work items by type"
```

---

### Task 17: Vérification finale

**Files** : aucun fichier nouveau ; corrections éventuelles dans les fichiers des tâches 1 à 16.

**Interfaces** : aucune.

- [ ] **Step 1 : contrôles statiques**

Run :

```bash
pnpm check
pnpm --filter=@plane/i18n check:sync
cd apps/api && uv run ruff check . && uv run ruff format --check . && cd ../..
grep -rnP "\x{2014}" docs/superpowers apps/api/plane apps/web/components/work-item-types packages/i18n/src/locales/en/work-item-type.json packages/i18n/src/locales/fr/work-item-type.json || echo "no em dash"
```

Expected : tout passe, `no em dash`.

- [ ] **Step 2 : suites de tests complètes**

Run :

```bash
docker compose -f docker-compose-test.yml up --build --abort-on-container-exit --exit-code-from api-tests
docker compose -f docker-compose-test.yml down -v
pnpm turbo run test
```

Expected : code de sortie 0 pour pytest (unit, contract, smoke) et pour vitest (web, blocks, services, editor, live).

- [ ] **Step 3 : migration sur une copie des données**

Sur une base locale peuplée (`docker-compose-local.yml`, workspace de démonstration créé avant cette branche) : `cd apps/api && uv run python manage.py migrate`, puis vérifier en shell Django : aucun `Issue` non supprimé avec `type_id` nul, un seul `IssueType` par défaut par workspace, un seul `ProjectIssueType` par défaut par projet. Relancer `migrate db 0126` puis `migrate` : la migration 0127 se rejoue sans erreur (idempotence).

- [ ] **Step 4 : parcours manuel dans le navigateur (spec 8)**

En admin du workspace :

1. Paramètres > Types de ticket : « Tâche » présent, badge « Par défaut », supprimer et désactiver grisés avec motif lisible au clavier (Tab, Entrée, Échap).
2. Créer « Bug » (icône, couleur, description), le renommer, essayer « tâche » (refus « existe déjà »).
3. Paramètres du projet > Types de ticket : cocher « Bug », le définir par défaut, constater que « Tâche » peut être retiré puis remis.
4. Créer un ticket : « Type » vaut « Bug », la liste ne montre que les types du projet ; changer de projet remet le défaut de l'autre projet.
5. Fiche du ticket : changer le type, voir l'entrée d'historique.
6. Liste, Kanban, tableur : icône devant l'identifiant ; filtre et regroupement par type.
7. Désactiver « Bug » (refusé tant qu'il est défaut d'un projet ; après changement du défaut, accepté) : les tickets gardent « Bug », il disparaît des choix de création.
8. Supprimer un type utilisé : refusé ; inutilisé : accepté.

En membre puis en invité : 9. L'entrée « Types de ticket » n'apparaît pas dans les paramètres du workspace ni du projet ; l'URL directe affiche « Accès non autorisé ». 10. Le membre crée un ticket avec un type du projet et change le type d'un ticket ; l'invité ne peut pas changer le type. 11. Basculer la langue en français puis en anglais : aucun texte en dur.

- [ ] **Step 5 : revues avant fusion**

1. `superpowers:verification-before-completion` avec la sortie réelle des étapes 1 à 3.
2. Revue de code : `mattpocock-skills:code-review` depuis `upstream/preview` (axes standards et spec).
3. `/ponytail-review`.
4. `/security` : authentification et autorisation des 9 routes, R9 sur les deux API, `logo_props`, journal d'audit, migration (verrous, idempotence).
5. Corriger chaque constat dans un commit dédié (`fix(api): ...`, `fix(web): ...`), relancer les étapes 1 et 2.

---

## Couverture de la spec

| Élément de la spec                                                  | Tâche(s)    | Test(s)                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 à D3, D8 (modèle existant, types du workspace, choix par projet) | 3, 5, 6     | `test_issue_type_defaults.py`, `test_workspace_issue_types_app.py`, `test_project_issue_types_app.py`                                                                                                                                        |
| D4 (« Tâche » seul type créé)                                       | 3, 4        | `test_workspace_creation_creates_the_default_type`, `test_backfill_restores_the_invariants`                                                                                                                                                  |
| D5 (tout ticket a un type, `is_issue_type_enabled` ignoré)          | 3, 4, 7     | `test_work_item_without_type_gets_the_project_default`, `test_partial_save_backfills_a_missing_type`                                                                                                                                         |
| D6 (filtre et regroupement)                                         | 9, 16       | `test_issue_type_filters.py`, `test_issue_type_grouping_app.py`, `filters.test.ts`                                                                                                                                                           |
| D7 (i18n en et fr)                                                  | 11, 12 à 16 | `check:sync` (tâche 11)                                                                                                                                                                                                                      |
| Invariant 1 (un défaut actif par workspace)                         | 3, 4, 5     | `test_a_workspace_has_at_most_one_default_type`, `test_setting_a_new_default_removes_the_previous_one`, `test_the_default_type_cannot_be_deactivated`                                                                                        |
| Invariant 2 (un défaut actif par projet)                            | 3, 4, 5, 6  | `test_a_project_has_at_most_one_default_type`, `test_a_project_default_type_cannot_be_deactivated`, `test_setting_the_project_default_moves_the_flag`                                                                                        |
| Invariant 3 (type du workspace, activé dans le projet)              | 3, 7        | `test_work_item_with_a_type_not_enabled_gets_the_project_default`, `TestCreateWorkItemType`, `TestApiV1WorkItemType`                                                                                                                         |
| Invariant 4 (type non nul après la livraison)                       | 3, 4        | `test_partial_save_backfills_a_missing_type`, `test_backfill_*`                                                                                                                                                                              |
| Table `audit_logs` (3.3)                                            | 2           | `test_audit_log.py`                                                                                                                                                                                                                          |
| Migration de données (3.4), par lots, idempotente                   | 4           | `test_backfill_work_item_types.py`                                                                                                                                                                                                           |
| État initial à la création d'un workspace ou d'un projet            | 3           | `test_workspace_creation_*`, `test_project_creation_*`                                                                                                                                                                                       |
| R1                                                                  | 5           | `test_non_admins_cannot_write`, `test_admin_creates_*`                                                                                                                                                                                       |
| R2                                                                  | 5, 6        | `test_every_member_lists_types_with_counts`, `test_every_member_reads_one_type`, `test_every_workspace_member_lists_the_project_types`                                                                                                       |
| R3                                                                  | 6           | `test_non_admins_cannot_change_project_types`, `test_project_or_workspace_admins_enable_a_type`                                                                                                                                              |
| R4                                                                  | 4, 5        | `test_invalid_names_are_rejected`, `test_renaming_to_an_existing_name_ignoring_case_is_rejected`, `test_type_names_are_unique_per_workspace_ignoring_case`                                                                                   |
| R5                                                                  | 5           | `test_setting_a_new_default_removes_the_previous_one`, `test_unsetting_the_default_is_rejected`, `test_the_default_type_cannot_be_deactivated`, `test_the_default_type_cannot_be_deleted`                                                    |
| R6                                                                  | 5           | `test_a_type_used_by_work_items_cannot_be_deleted`, `test_a_type_used_only_by_deleted_work_items_is_soft_deleted`                                                                                                                            |
| R7                                                                  | 5, 6, 7, 10 | `test_a_type_can_be_deactivated_then_reactivated`, `test_an_inactive_type_cannot_be_enabled`, `test_an_inactive_type_is_rejected`, `test_a_work_item_keeps_its_type_once_deactivated`, `offers only the active types enabled in the project` |
| R8                                                                  | 6           | `test_the_project_default_cannot_be_removed`, `test_a_type_used_by_project_work_items_cannot_be_removed`                                                                                                                                     |
| R9 (app, v1, brouillons, création en masse)                         | 3, 7        | `test_issue_type_assignment_app.py`, `test_issue_type_assignment_api.py`, `TestDraftWorkItemType`, `test_space_issue_type_read_only.py`                                                                                                      |
| R10                                                                 | 3           | `test_moving_a_work_item_to_a_project_without_its_type_uses_the_target_default`, `test_moving_a_work_item_keeps_a_type_enabled_in_the_target`                                                                                                |
| R11                                                                 | 8, 15       | `test_issue_type_activity.py`, `test_issue_type_activity_app.py`, parcours manuel (tâche 17, étape 4.5)                                                                                                                                      |
| R12                                                                 | 5, 6        | assertions `AuditLog` dans `test_workspace_issue_types_app.py` et `test_project_issue_types_app.py`                                                                                                                                          |
| Route GET `workspaces/<slug>/issue-types/`                          | 5           | `TestWorkspaceIssueTypeRead`                                                                                                                                                                                                                 |
| Route POST `workspaces/<slug>/issue-types/`                         | 5           | `test_admin_creates_*`, `test_non_admins_cannot_write`                                                                                                                                                                                       |
| Route GET `workspaces/<slug>/issue-types/<pk>/`                     | 5           | `test_every_member_reads_one_type`, `test_a_type_of_another_workspace_looks_missing`                                                                                                                                                         |
| Route PATCH `workspaces/<slug>/issue-types/<pk>/`                   | 5           | `test_admin_renames_*`, `test_setting_a_new_default_*`, `test_a_type_can_be_deactivated_then_reactivated`                                                                                                                                    |
| Route DELETE `workspaces/<slug>/issue-types/<pk>/`                  | 5           | `test_a_type_used_*`, `test_the_default_type_cannot_be_deleted`                                                                                                                                                                              |
| Route GET `.../projects/<project_id>/issue-types/`                  | 6           | `TestProjectIssueTypeRead`                                                                                                                                                                                                                   |
| Route POST `.../projects/<project_id>/issue-types/`                 | 6           | `test_project_or_workspace_admins_enable_a_type`, `test_enabling_twice_keeps_a_single_link`                                                                                                                                                  |
| Route PATCH `.../issue-types/<issue_type_id>/`                      | 6           | `test_setting_the_project_default_moves_the_flag`, `test_only_setting_the_default_is_supported`                                                                                                                                              |
| Route DELETE `.../issue-types/<issue_type_id>/`                     | 6           | `test_an_unused_type_is_removed_and_audited`, tests R8                                                                                                                                                                                       |
| Compteur de tickets dans la liste du workspace                      | 5           | `test_every_member_lists_types_with_counts`                                                                                                                                                                                                  |
| `type_id` dans les réponses liste et détail                         | 7           | `TestWorkItemTypeInResponses`                                                                                                                                                                                                                |
| Même réponse pour inexistant et hors workspace                      | 5, 6, 7     | `test_a_type_of_another_workspace_looks_missing` (x2), `test_a_project_of_another_workspace_looks_missing`, `test_the_error_does_not_reveal_whether_the_type_exists` (x2)                                                                    |
| UI 6.1 (onglet workspace, menu, motifs, états)                      | 12          | `helpers.test.ts` (actions du workspace), parcours manuel 17.4.1-2, 7-9                                                                                                                                                                      |
| UI 6.2 (onglet projet)                                              | 13          | `helpers.test.ts` (actions du projet), parcours manuel 17.4.3, 9                                                                                                                                                                             |
| UI 6.3 (sélecteur à la création)                                    | 14          | store `getProjectAssignableTypes`, `getProjectDefaultTypeId`, parcours manuel 17.4.4                                                                                                                                                         |
| UI 6.4 (icône, menu de changement, historique)                      | 14, 15      | `getIdentifierVisibility`, `getWorkItemTypeChange`, parcours manuel 17.4.5                                                                                                                                                                   |
| UI 6.5 (icône sur cartes et lignes, filtre, regroupement)           | 9, 14, 16   | `filters.test.ts`, tests backend de la tâche 9, parcours manuel 17.4.6                                                                                                                                                                       |
| UI 6.6 (libellé texte, clavier, motifs accessibles, i18n)           | 11 à 16     | `WorkItemTypeIcon` (`role="img"`, `aria-label`), `aria-describedby` des motifs, parcours manuel 17.4.1, 11                                                                                                                                   |
| STRIDE usurpation                                                   | existant    | authentification Plane, `test_non_member_is_refused`                                                                                                                                                                                         |
| STRIDE altération                                                   | 7           | tests R9 des deux API                                                                                                                                                                                                                        |
| STRIDE répudiation                                                  | 2, 5, 6     | journal d'audit en ajout seul                                                                                                                                                                                                                |
| STRIDE divulgation                                                  | 5, 6, 7, 8  | réponses 404 identiques, `test_a_type_of_another_workspace_is_never_named`                                                                                                                                                                   |
| STRIDE déni de service                                              | 4, 5        | lots de 1000, `atomic = False`, bornes de longueur                                                                                                                                                                                           |
| STRIDE élévation de privilèges                                      | 5, 6        | tests par profil                                                                                                                                                                                                                             |
| Validation des entrées (nom, description, `logo_props`, UUID)       | 5, 6, 7     | `test_unexpected_logo_props_are_rejected`, `test_a_missing_or_malformed_type_id_is_rejected`                                                                                                                                                 |
| Tests backend (section 8)                                           | 1 à 9       | voir lignes ci-dessus                                                                                                                                                                                                                        |
| Tests frontend vitest (stores, sélecteurs, filtre)                  | 10, 12 à 16 | `work-item-type.store.test.ts`, `helpers.test.ts`, `filters.test.ts`                                                                                                                                                                         |
| Vérification manuelle admin puis membre                             | 17          | étape 4                                                                                                                                                                                                                                      |
| Avant fusion : `pnpm check`, pytest Docker, revue, `/security`      | 17          | étapes 1, 2, 5                                                                                                                                                                                                                               |
| Hors périmètre (section 9 : hiérarchie, champs par type, workflows) | aucune      | `is_epic`, `level`, `external_*` restent inutilisés                                                                                                                                                                                          |
