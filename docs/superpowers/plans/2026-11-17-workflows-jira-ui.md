# Workflows : liste et vue Texte proches de Jira, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher la liste des workflows et la vue Texte de l'éditeur comme les maquettes « proches de Jira », sans changer les droits ni le comportement métier.

**Architecture:** Le serveur ajoute à la liste des workflows, en lecture seule, les états (nom, catégorie) dans l'ordre du graphe et le nombre de transitions. Côté web, un badge d'état partagé (`StateLozenge`) et cinq teintes de catégorie servent la liste, la vue Texte, le panneau latéral et le diagramme. La vue Texte est reconstruite à partir d'une fonction pure (`textRows`) qui liste, pour chaque état, toutes les transitions qui le touchent.

**Tech Stack:** Django REST Framework, pytest ; React 19, TypeScript, MobX, Tailwind 4, `@makeplane/propel` (Menu, Tooltip, IconButton, icônes), `@plane/blocks` (Select, ConfirmDialog, toast), Vitest et Testing Library, `packages/i18n` (français et anglais seulement depuis le commit `027dddbff1`).

**Spec:** `docs/superpowers/specs/2026-11-17-workflows-jira-ui-design.md`

## Global Constraints

- Branche `feat/workflows-jira-ui`, worktree `.worktrees/feat-workflows` ; ne pas changer de branche.
- Aucune nouvelle dépendance ; composants de `@makeplane/propel` et `@plane/blocks` d'abord.
- Couleurs depuis les jetons du thème uniquement (J2) : aucune couleur hexadécimale dans les composants.
- Toute chaîne visible passe par `t()` ; chaque clé existe en anglais et en français, les deux seules langues livrées (`packages/i18n/src/locales/en` et `fr`) (`pnpm --filter=@plane/i18n sync:check`).
- Droits inchangés : la liste reste lisible par les admins et les membres du workspace, pas par les invités ; les noms de projets restent réservés aux admins (P6).
- Identifiants techniques en anglais ; commentaires d'une ligne qui disent pourquoi ; pas de tiret cadratin.
- Commits Conventional Commits en anglais, sujet de 72 caractères au plus, sans aucune attribution ; jamais `--no-verify`.
- Tests serveur dans la pile isolée : `docker compose -p wfjira -f docker-compose-test.yml run --rm --build api-tests pytest <cible>`, puis `docker compose -p wfjira -f docker-compose-test.yml down -v` à la fin du travail. Tests web : `cd apps/web && npx vitest run <fichiers>`.
- Ne lancer ni `pnpm turbo`, ni `pnpm install`, ni `pnpm check` à la racine (serveur de développement en cours sur le port 3000) ; `npx tsc --noEmit` et `npx oxlint` dans `apps/web` sont permis.

## Écarts au brief décidés pendant le plan

À reporter dans la spec à la tâche 8 :

- **Variantes `initial` et `any`** : `StateLozenge` n'a pas de variante. La vue Texte écrit « Début » et « Tous les états » en texte simple, comme le brief le demande en 4 ; aucun écran n'emploie les variantes (YAGNI).
- **Raison du refus de suppression** : elle s'affiche comme ligne grise de l'entrée « Supprimer » du menu, et non en infobulle. Une entrée désactivée ne reçoit ni survol ni focus de façon fiable, alors qu'une ligne de description est lue par les lecteurs d'écran.
- **Catégorie en texte** : la vue Texte garde, sous le badge de l'état, la catégorie en petit texte gris, pour que la couleur ne soit pas le seul signal (WCAG 1.4.1). Dans la liste, chaque badge porte la catégorie dans son `title`.
- **Coût en requêtes de la liste** : chaque ligne déclenchait déjà une ou deux requêtes pour les projets (`_projects`). Les états et le nombre de transitions n'en ajoutent aucune ; corriger ce coût existant est hors périmètre.

## Fichiers

| Fichier                                                    | Rôle                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/api/plane/app/views/workflow/base.py`                | La liste renvoie `states` et `transition_count`.                        |
| `apps/api/plane/tests/contract/app/test_workflows_app.py`  | Tests de contrat de la liste.                                           |
| `packages/types/src/workflow.ts`                           | `TWorkflowSummary` gagne `states` et `transition_count`.                |
| `apps/web/components/workflow/editor/graph-model.ts`       | Cinq teintes (`toneOf`), nouvelles lignes de la vue Texte (`textRows`). |
| `apps/web/components/workflow/editor/tones.ts`             | Classes des cinq teintes et des barres de répartition.                  |
| `apps/web/components/workflow/state-lozenge.tsx` (nouveau) | Badge d'état partagé.                                                   |
| `apps/web/components/workflow/editor/text-view.tsx`        | Tableau de la vue Texte.                                                |
| `apps/web/components/workflow/editor/editor-header.tsx`    | Fil d'Ariane, titre, description.                                       |
| `apps/web/components/workflow/editor/workflow-editor.tsx`  | Passe la description à l'en-tête.                                       |
| `apps/web/components/workflow/settings/workflow-list.tsx`  | Liste, barre d'outils, menu d'actions.                                  |
| `packages/i18n/src/locales/*/workflow.json`                | Chaînes.                                                                |

---

### Task 1: La liste des workflows renvoie les états et le nombre de transitions

**Files:**

- Modify: `apps/api/plane/app/views/workflow/base.py:146-158` (`WorkflowEndpoint.get`)
- Test: `apps/api/plane/tests/contract/app/test_workflows_app.py` (classe `TestRead`)

**Interfaces:**

- Produces: chaque élément de `GET /api/workspaces/<slug>/workflows/` porte `states: [{"name": str, "group": str}]`, dans l'ordre (`created_at`, `id`) des états du graphe, et `transition_count: int`. `state_count` reste.

- [ ] **Step 1: Write the failing tests**

Ajouter dans `TestRead`, après `test_admins_and_members_read_workflows_and_statuses`, et ajouter `from django.db import connection` et `from django.test.utils import CaptureQueriesContext` aux imports :

```python
    @pytest.mark.parametrize("role", ["admin", "member"])
    def test_the_list_gives_each_workflow_its_states_in_graph_order_and_its_transition_count(
        self, workspace, users, software, role
    ):
        build_workflow(workspace, "Empty", [])
        listed = _client(users[role]).get(WORKFLOWS_URL.format(slug=workspace.slug))
        by_name = {item["name"]: item for item in listed.data}
        assert by_name["Software"]["states"] == [
            {"name": "To do", "group": software.states_by_name["To do"].status.group},
            {"name": "Done", "group": software.states_by_name["Done"].status.group},
        ]
        assert by_name["Software"]["transition_count"] == 1
        assert by_name["Empty"]["states"] == [] and by_name["Empty"]["transition_count"] == 0

    def test_states_and_transitions_add_no_query_per_workflow(self, workspace, users, software):
        client = _client(users["member"])
        url = WORKFLOWS_URL.format(slug=workspace.slug)
        with CaptureQueriesContext(connection) as one:
            client.get(url)
        build_workflow(workspace, "Second", ["A", "B", "C"], [(["A"], "B", None), (["B"], "C", None)])
        with CaptureQueriesContext(connection) as two:
            client.get(url)
        # The project count of a row (_projects) already costs one query per workflow for a member.
        assert len(two.captured_queries) - len(one.captured_queries) <= 1
```

Avant d'écrire le test, vérifier dans le fichier que la fixture `software` a bien une seule transition (`To do` vers `Done`) ; sinon, ajuster le nombre attendu à la vérité de la fixture.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose -p wfjira -f docker-compose-test.yml run --rm --build api-tests pytest plane/tests/contract/app/test_workflows_app.py -k "graph_order or no_query_per_workflow" -q -p no:cacheprovider`
Expected: FAIL avec `KeyError: 'states'`.

- [ ] **Step 3: Implement**

Dans `base.py`, importer `Prefetch` (déjà importé) et remplacer la liste de `WorkflowEndpoint.get` :

```python
        graph_states = WorkflowState.objects.select_related("status").order_by("created_at", "id")
        workflows = (
            Workflow.objects.filter(workspace__slug=slug)
            .annotate(
                state_count=Count("states", distinct=True), transition_count=Count("transitions", distinct=True)
            )
            .prefetch_related(Prefetch("states", queryset=graph_states))
        )
        data = [
            {
                **WorkflowSerializer(workflow).data,
                "state_count": workflow.state_count,
                "transition_count": workflow.transition_count,
                # Graph order, the order of the editor and of a newly linked project (spec 4.1).
                "states": [{"name": state.status.name, "group": state.status.group} for state in workflow.states.all()],
                **_projects(workflow, is_admin),
            }
            for workflow in workflows
        ]
```

`distinct=True` est nécessaire : deux `Count` sur deux jointures se multiplieraient sinon.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose -p wfjira -f docker-compose-test.yml run --rm api-tests pytest plane/tests/contract/app/test_workflows_app.py -q -p no:cacheprovider`
Expected: tous PASS, y compris `test_guests_read_neither_workflows_nor_statuses` (droits inchangés).

- [ ] **Step 5: Lint and commit**

```bash
docker compose -p wfjira -f docker-compose-test.yml run --rm --entrypoint "" api-tests sh -c "ruff check plane/app/views/workflow plane/tests/contract/app/test_workflows_app.py && ruff format --check plane/app/views/workflow plane/tests/contract/app/test_workflows_app.py"
git add apps/api/plane/app/views/workflow/base.py apps/api/plane/tests/contract/app/test_workflows_app.py
git commit -m "feat(api): list the states and transition count of each workflow"
```

---

### Task 2: Cinq teintes de catégorie et badge d'état partagé

**Files:**

- Modify: `apps/web/components/workflow/editor/graph-model.ts:525-532` (`TStateTone`, `toneOf`)
- Modify: `apps/web/components/workflow/editor/tones.ts`
- Create: `apps/web/components/workflow/state-lozenge.tsx`
- Test: `apps/web/components/workflow/editor/graph-model.layout.test.ts:284` (attente de `toneOf`), `apps/web/components/workflow/state-lozenge.test.tsx` (nouveau)
- Modify: `packages/types/src/workflow.ts` (`TWorkflowSummary`)

**Interfaces:**

- Produces: `type TStateTone = "backlog" | "todo" | "progress" | "done" | "cancelled"` ; `toneOf(group: TStateGroups): TStateTone` ; `TONE_CLASS: Record<TStateTone, string>` ; `BAR_CLASS: Record<TStateTone, string>` ; `StateLozenge({ name: string; group: TStateGroups })` qui rend un `<span>` ; `TWorkflowSummary.states: { name: string; group: TStateGroups }[]` et `TWorkflowSummary.transition_count: number`.

- [ ] **Step 1: Write the failing tests**

Dans `graph-model.layout.test.ts`, remplacer l'attente de la ligne 284 par :

```ts
expect((["backlog", "unstarted", "started", "completed", "cancelled"] as const).map(toneOf)).toEqual([
  "backlog",
  "todo",
  "progress",
  "done",
  "cancelled",
]);
```

Créer `apps/web/components/workflow/state-lozenge.test.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StateLozenge } from "./state-lozenge";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("StateLozenge", () => {
  it("shows the name and names its category for those who cannot tell the colours apart", () => {
    render(<StateLozenge name="In review" group="started" />);
    const lozenge = screen.getByText("In review");
    expect(lozenge.getAttribute("title")).toBe("workflows.groups.started");
    expect(lozenge.className).toContain("uppercase");
  });

  it("marks the backlog with a dashed border, unlike a state not started", () => {
    render(
      <>
        <StateLozenge name="Backlog" group="backlog" />
        <StateLozenge name="Todo" group="unstarted" />
      </>
    );
    expect(screen.getByText("Backlog").className).toContain("border-dashed");
    expect(screen.getByText("Todo").className).not.toContain("border-dashed");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run components/workflow/state-lozenge.test.tsx components/workflow/editor/graph-model.layout.test.ts`
Expected: FAIL (module `./state-lozenge` introuvable ; `toneOf("backlog")` vaut `"todo"`).

- [ ] **Step 3: Implement**

`graph-model.ts` :

```ts
export type TStateTone = "backlog" | "todo" | "progress" | "done" | "cancelled";

export const toneOf = (group: TStateGroups): TStateTone => {
  if (group === "backlog") return "backlog";
  if (group === "started") return "progress";
  if (group === "completed") return "done";
  if (group === "cancelled") return "cancelled";
  return "todo";
};
```

`tones.ts`, remplacer `TONE_CLASS` et ajouter `BAR_CLASS` :

```ts
/** Jira's category colours (R16, J2), from theme tokens so both themes keep AA contrast. */
export const TONE_CLASS: Record<TStateTone, string> = {
  backlog: "border-dashed border-strong bg-surface-1 text-secondary",
  todo: "border-subtle bg-layer-2 text-secondary",
  progress: "border-info-subtle bg-info-subtle text-info-primary",
  done: "border-success-subtle bg-success-subtle text-success-primary",
  cancelled: "border-danger-subtle bg-danger-subtle text-danger-primary",
};

/** Solid fills of the 4px category bar of the workflow list (decorative). */
export const BAR_CLASS: Record<TStateTone, string> = {
  backlog: "bg-layer-2",
  todo: "bg-layer-3",
  progress: "bg-info-primary",
  done: "bg-success-primary",
  cancelled: "bg-danger-primary",
};
```

`state-lozenge.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
import type { TStateGroups } from "@plane/types";
import { toneOf } from "./editor/graph-model";
import { TONE_CLASS } from "./editor/tones";

type Props = { name: string; group: TStateGroups };

/** A state as Jira draws it: upper-case name on its category colour (spec 3). */
export function StateLozenge({ name, group }: Props) {
  const { t } = useTranslation();
  return (
    <span
      title={t(`workflows.groups.${group}`)}
      className={`inline-block rounded-sm border px-1.5 py-0.5 text-caption-sm-medium font-bold whitespace-nowrap uppercase ${TONE_CLASS[toneOf(group)]}`}
    >
      {name}
    </span>
  );
}
```

`packages/types/src/workflow.ts`, dans `TWorkflowSummary` après `state_count` :

```ts
/** States in graph order, for the list preview (spec 4.1). */
states: {
  name: string;
  group: TStateGroups;
}
[];
transition_count: number;
```

- [ ] **Step 4: Run the tests and the type check**

Run: `cd apps/web && npx vitest run components/workflow && npx tsc --noEmit`
Expected: les deux nouveaux tests PASS. `tsc` signale les fabriques de `TWorkflowSummary` des tests (par exemple `summary()` de `workflow-list.test.tsx`) : y ajouter `states: []` et `transition_count: 0`, puis relancer jusqu'à zéro erreur. Les tests du diagramme et du panneau latéral doivent rester verts : un état Backlog y prend la teinte pointillée.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workflow packages/types/src/workflow.ts
git commit -m "feat(web): add a shared state lozenge with five category tones"
```

---

### Task 3: Lignes de la vue Texte : toutes les transitions qui touchent un état

**Files:**

- Modify: `apps/web/components/workflow/editor/graph-model.ts:614-650` (`TTextTransition`, `TTextRow`, `textRows`)
- Test: `apps/web/components/workflow/editor/graph-model.layout.test.ts` (bloc « text view and counts »)

**Interfaces:**

- Produces :

```ts
export type TTextLine = {
  /** Transition key; null for the arrival from the start. */
  key: string | null;
  name: string;
  kind: "start" | "any" | "in" | "out";
  /** Source state of an "in" or "out" route. */
  sourceKey?: string;
  targetKey: string;
};
export type TTextRow = { key: string; name: string; group: TStateGroups; isInitial: boolean; lines: TTextLine[] };
export const textRows: (draft: TDraftGraph) => TTextRow[];
```

`TTextTransition` disparaît (seule la vue Texte l'utilise).

- [ ] **Step 1: Write the failing tests**

Remplacer le test « lists the incoming transitions of each state, the start first » par :

```ts
it("lists in each state every transition touching it: start, global, incoming, outgoing", () => {
  expect(textRows(draft)).toEqual([
    {
      key: "a",
      name: "A",
      group: "unstarted",
      isInitial: true,
      lines: [
        { key: null, name: "", kind: "start", targetKey: "a" },
        { key: "g", name: "", kind: "any", targetKey: "a" },
        { key: "t", name: "Go", kind: "out", sourceKey: "a", targetKey: "b" },
      ],
    },
    {
      key: "b",
      name: "B",
      group: "completed",
      isInitial: false,
      lines: [{ key: "t", name: "Go", kind: "in", sourceKey: "a", targetKey: "b" }],
    },
  ]);
});

it("gives one line per source and shows a loop once", () => {
  const several: TDraftGraph = {
    states: [
      state("a", { is_initial: true, status: status("A") }),
      state("b", { status: status("B") }),
      state("c", { status: status("C") }),
    ],
    transitions: [
      { key: "m", name: "Merge", from_any: false, source_keys: ["a", "b"], target_key: "c", rules: [] },
      { key: "l", name: "Again", from_any: false, source_keys: ["c"], target_key: "c", rules: [] },
    ],
  };
  const lines = Object.fromEntries(textRows(several).map((row) => [row.key, row.lines]));
  expect(lines.c).toEqual([
    { key: "m", name: "Merge", kind: "in", sourceKey: "a", targetKey: "c" },
    { key: "m", name: "Merge", kind: "in", sourceKey: "b", targetKey: "c" },
    { key: "l", name: "Again", kind: "in", sourceKey: "c", targetKey: "c" },
  ]);
  expect(lines.a).toEqual([
    { key: null, name: "", kind: "start", targetKey: "a" },
    { key: "m", name: "Merge", kind: "out", sourceKey: "a", targetKey: "c" },
  ]);
  expect(lines.b).toEqual([{ key: "m", name: "Merge", kind: "out", sourceKey: "b", targetKey: "c" }]);
});
```

Garder les helpers `state` et `status` du fichier tels qu'ils sont ; les lire avant d'écrire.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run components/workflow/editor/graph-model.layout.test.ts`
Expected: FAIL (propriété `lines` absente).

- [ ] **Step 3: Implement**

Remplacer `TTextTransition`, `TTextRow` et `textRows` :

```ts
export type TTextLine = {
  key: string | null;
  name: string;
  kind: "start" | "any" | "in" | "out";
  sourceKey?: string;
  targetKey: string;
};
export type TTextRow = { key: string; name: string; group: TStateGroups; isInitial: boolean; lines: TTextLine[] };

/** Text view (spec 5.2): each state with every transition touching it, start and globals first. */
export const textRows = (draft: TDraftGraph): TTextRow[] =>
  draft.states.map((state) => {
    const routes = draft.transitions.filter((transition) => !transition.from_any);
    const line = (kind: TTextLine["kind"], transition: TDraftTransition, sourceKey?: string): TTextLine => ({
      key: transition.key,
      name: transition.name,
      kind,
      ...(sourceKey === undefined ? {} : { sourceKey }),
      targetKey: transition.target_key,
    });
    return {
      key: state.key,
      name: state.status.name,
      group: displayGroup(draft, state),
      isInitial: state.is_initial,
      lines: [
        ...(state.is_initial ? [{ key: null, name: "", kind: "start" as const, targetKey: state.key }] : []),
        ...draft.transitions
          .filter((transition) => transition.from_any && transition.target_key === state.key)
          .map((transition) => line("any", transition)),
        ...routes
          .filter((transition) => transition.target_key === state.key)
          .flatMap((transition) => transition.source_keys.map((source) => line("in", transition, source))),
        // A loop is already listed as incoming.
        ...routes
          .filter((transition) => transition.target_key !== state.key && transition.source_keys.includes(state.key))
          .map((transition) => line("out", transition, state.key)),
      ],
    };
  });
```

Vérifier que `TDraftTransition` est bien le nom du type des transitions dans `graph-model.ts` (il est importé par `add-rule-dialog.tsx`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run components/workflow/editor/graph-model.layout.test.ts`
Expected: PASS. `text-view.tsx` ne compile plus (`tsc`) : la tâche 4 le réécrit, ne pas commiter avant.

- [ ] **Step 5: Do not commit yet** : ce changement part avec la tâche 4, sinon le commit ne compile pas.

---

### Task 4: Tableau de la vue Texte

**Files:**

- Modify: `apps/web/components/workflow/editor/text-view.tsx` (réécriture)
- Test: `apps/web/components/workflow/editor/text-view.test.tsx` (réécriture)

**Interfaces:**

- Consumes: `textRows`, `TTextLine`, `TTextRow` (tâche 3) ; `StateLozenge` (tâche 2) ; `TEditorSelection` de `workflow-canvas` : `{ kind: "state"; key } | { kind: "transition"; key } | { kind: "start" } | null` (lire la définition avant d'écrire).
- Produces: `WorkflowTextView({ draft, selection, onSelect })`, mêmes props qu'aujourd'hui ; `workflow-editor.tsx` ne change pas pour cette tâche.

- [ ] **Step 1: Write the failing tests**

Réécrire `text-view.test.tsx` en gardant le brouillon `draft` du fichier (états `a` initial « Todo » et `b` « Done », transitions `t` « Finish » de `a` vers `b` et `g` globale vers `a`) :

```tsx
const rowOf = (name: string) => screen.getByRole("button", { name }).closest("tr") as HTMLElement;
const lines = (row: HTMLElement) =>
  within(row)
    .queryAllByRole("button", { pressed: false })
    .concat(within(row).queryAllByRole("button", { pressed: true }));

describe("WorkflowTextView", () => {
  it("shows a transition in the row of its source and in the row of its target", () => {
    render(<WorkflowTextView draft={draft} selection={null} onSelect={() => {}} />);
    expect(within(rowOf("Todo")).getAllByText("Finish")).toHaveLength(1);
    expect(within(rowOf("Done")).getAllByText("Finish")).toHaveLength(1);
  });

  it("shows the start and a global transition only in the row of their target", () => {
    render(<WorkflowTextView draft={draft} selection={null} onSelect={() => {}} />);
    expect(within(rowOf("Todo")).getByText("workflows.editor.text.origin_start")).toBeTruthy();
    expect(within(rowOf("Todo")).getByText("workflows.editor.text.origin_any")).toBeTruthy();
    expect(within(rowOf("Done")).queryByText("workflows.editor.text.origin_start")).toBeNull();
    expect(within(rowOf("Done")).queryByText("workflows.editor.text.origin_any")).toBeNull();
  });

  it("opens the panel of a transition, of the start, or of a state", async () => {
    const onSelect = vi.fn();
    render(<WorkflowTextView draft={draft} selection={null} onSelect={onSelect} />);
    const user = userEvent.setup();
    await user.click(within(rowOf("Done")).getByRole("button", { name: /Finish/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "transition", key: "t" });
    await user.click(within(rowOf("Todo")).getByRole("button", { name: /origin_start/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "start" });
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "state", key: "b" });
  });

  it("marks every line of the selected transition as pressed", () => {
    render(<WorkflowTextView draft={draft} selection={{ kind: "transition", key: "t" }} onSelect={() => {}} />);
    expect(screen.getAllByRole("button", { name: /Finish/, pressed: true })).toHaveLength(2);
  });

  it("names a transition without a name", () => {
    render(<WorkflowTextView draft={draft} selection={null} onSelect={() => {}} />);
    expect(within(rowOf("Todo")).getByRole("button", { name: /workflows\.editor\.text\.unnamed/ })).toBeTruthy();
  });

  it("hides the transitions of a collapsed state", async () => {
    render(<WorkflowTextView draft={draft} selection={null} onSelect={() => {}} />);
    const toggle = within(rowOf("Done")).getByRole("button", { name: "workflows.editor.text.toggle" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await userEvent.setup().click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(rowOf("Done")).queryByText("Finish")).toBeNull();
  });

  it("marks the initial state and writes each category as text", () => {
    render(<WorkflowTextView draft={draft} selection={null} onSelect={() => {}} />);
    expect(within(rowOf("Todo")).getByText("workflows.editor.text.initial_state")).toBeTruthy();
    expect(within(rowOf("Done")).getByText("workflows.groups.completed")).toBeTruthy();
  });

  it("says so when the workflow is empty", () => {
    render(<WorkflowTextView draft={{ states: [], transitions: [] }} selection={null} onSelect={() => {}} />);
    expect(screen.getByText("workflows.editor.text.empty")).toBeTruthy();
  });
});
```

Supprimer l'aide `lines` si elle reste inutilisée. Le mock de `@plane/i18n` (`t: (key) => key`) rend `toggle` sans le nom ; c'est voulu.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run components/workflow/editor/text-view.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Réécrire `text-view.tsx` :

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import {
  ArrowNarrowRightOutline,
  ChevronDownOutline,
  ChevronRightOutline,
  CircleOutline,
  StarOutline,
} from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// local imports
import { StateLozenge } from "../state-lozenge";
import { textRows, type TDraftGraph, type TTextLine, type TTextRow } from "./graph-model";
import type { TEditorSelection } from "./workflow-canvas";

type Props = {
  draft: TDraftGraph;
  selection: TEditorSelection;
  onSelect: (selection: TEditorSelection) => void;
};

const CELL = "border-b border-subtle align-top";

export function WorkflowTextView({ draft, selection, onSelect }: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const rows = textRows(draft);
  const byKey = new Map<string, TTextRow>(rows.map((row) => [row.key, row]));

  if (rows.length === 0)
    return <p className="p-6 text-body-sm-regular text-tertiary">{t("workflows.editor.text.empty")}</p>;

  const lozenge = (key: string) => {
    const row = byKey.get(key);
    return row ? <StateLozenge name={row.name} group={row.group} /> : null;
  };
  const source = (line: TTextLine) => {
    if (line.kind === "start") return <span>{t("workflows.editor.text.origin_start")}</span>;
    if (line.kind === "any") return <span>{t("workflows.editor.text.origin_any")}</span>;
    return lozenge(line.sourceKey ?? "");
  };
  const isPressed = (line: TTextLine) =>
    line.key === null ? selection?.kind === "start" : selection?.kind === "transition" && selection.key === line.key;

  return (
    <div className="h-full space-y-4 overflow-auto p-6">
      <div className="overflow-x-auto rounded-md border border-subtle">
        <table
          className="w-full min-w-[760px] table-fixed border-collapse"
          aria-label={t("workflows.editor.view.text")}
        >
          <colgroup>
            <col className="w-12" />
            <col className="w-[32%]" />
            <col />
          </colgroup>
          <thead>
            <tr className="bg-layer-1 text-left text-body-xs-medium text-secondary">
              <th scope="col" className="border-r border-b border-subtle">
                <span className="sr-only">{t("workflows.editor.text.toggle_column")}</span>
              </th>
              <th scope="col" className="border-r border-b border-subtle px-4 py-2.5">
                {t("workflows.editor.text.state")}
              </th>
              <th scope="col" className="border-b border-subtle px-4 py-2.5 text-primary">
                {t("workflows.editor.text.transitions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = !collapsed.includes(row.key);
              const isSelected = selection?.kind === "state" && selection.key === row.key;
              return (
                // Mouse shortcut (D11); the state button of the row is the keyboard path.
                <tr key={row.key} className="cursor-pointer" onClick={() => onSelect({ kind: "state", key: row.key })}>
                  <td className={`${CELL} border-r pt-3 text-center`}>
                    <button
                      type="button"
                      className="inline-flex size-7 items-center justify-center rounded-md text-secondary hover:bg-layer-1 max-md:size-11"
                      aria-expanded={isOpen}
                      aria-label={t("workflows.editor.text.toggle", { name: row.name })}
                      onClick={(event) => {
                        event.stopPropagation();
                        setCollapsed((current) =>
                          isOpen ? [...current, row.key] : current.filter((key) => key !== row.key)
                        );
                      }}
                    >
                      {isOpen ? (
                        <ChevronDownOutline className="size-3.5" aria-hidden />
                      ) : (
                        <ChevronRightOutline className="size-3.5" aria-hidden />
                      )}
                    </button>
                  </td>
                  <td className={`${CELL} border-r px-4 py-4 ${isSelected ? "bg-layer-1-selected" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-sm max-md:min-h-11"
                        aria-current={isSelected ? "true" : undefined}
                        // The editor focuses this row after adding the state (spec 3.3).
                        data-state-key={row.key}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect({ kind: "state", key: row.key });
                        }}
                      >
                        <StateLozenge name={row.name} group={row.group} />
                      </button>
                      {row.isInitial && (
                        <span className="text-caption-md-regular text-tertiary">
                          {t("workflows.editor.text.initial_state")}
                        </span>
                      )}
                    </div>
                    {/* Colour is not the only signal of the category (WCAG 1.4.1). */}
                    <p className="mt-1 text-caption-sm-regular text-tertiary">{t(`workflows.groups.${row.group}`)}</p>
                  </td>
                  <td className={`${CELL} p-0`}>
                    {isOpen &&
                      row.lines.map((line) => {
                        const pressed = isPressed(line);
                        return (
                          <button
                            key={`${line.kind}-${line.key ?? "start"}-${line.sourceKey ?? ""}`}
                            type="button"
                            aria-pressed={pressed}
                            className={`flex w-full flex-col gap-2 border-b border-subtle px-4 py-3.5 text-left last:border-b-0 hover:bg-layer-1 ${pressed ? "bg-accent-subtle shadow-[inset_2px_0_0_var(--border-color-accent-strong)]" : ""}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelect(line.key === null ? { kind: "start" } : { kind: "transition", key: line.key });
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              {line.kind === "start" && <CircleOutline className="size-3 text-secondary" aria-hidden />}
                              {line.kind === "any" && <StarOutline className="size-3 text-secondary" aria-hidden />}
                              {line.name ? (
                                <span className="text-body-sm-semibold text-primary">{line.name}</span>
                              ) : (
                                <span className="text-body-sm-regular text-tertiary italic">
                                  {t("workflows.editor.text.unnamed")}
                                </span>
                              )}
                            </span>
                            <span className="flex flex-wrap items-center gap-2.5 text-body-sm-regular text-primary">
                              {source(line)}
                              <ArrowNarrowRightOutline className="size-4 text-secondary" aria-hidden />
                              {lozenge(line.targetKey)}
                            </span>
                          </button>
                        );
                      })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption-md-regular text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <CircleOutline className="size-3" aria-hidden />
          {t("workflows.editor.text.legend_start")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <StarOutline className="size-3" aria-hidden />
          {t("workflows.editor.text.legend_any")}
        </span>
        <span>{t("workflows.editor.text.legend_click")}</span>
      </p>
    </div>
  );
}
```

Vérifier l'existence de `text-caption-md-regular`, `bg-accent-subtle` et de la variable `--border-color-accent-strong` (classe `ring-accent-strong` déjà utilisée) ; à défaut, prendre la classe voisine qui existe (`text-caption-sm-regular`).

- [ ] **Step 4: Run the tests, the type check and the lint**

Run: `cd apps/web && npx vitest run components/workflow && npx tsc --noEmit && npx oxlint --deny-warnings components/workflow/editor/text-view.tsx components/workflow/editor/graph-model.ts`
Expected: tout PASS, zéro avertissement. Les tests de `workflow-editor.test.tsx` qui cherchent l'ancien libellé « Todo → Done » de la vue Texte sont à adapter au nouveau rendu (une ligne par transition) sans changer leur intention.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workflow/editor
git commit -m "feat(web): list every transition touching a state in the text view"
```

---

### Task 5: En-tête de l'éditeur : fil d'Ariane et description

**Files:**

- Modify: `apps/web/components/workflow/editor/editor-header.tsx`
- Modify: `apps/web/components/workflow/editor/workflow-editor.tsx:256-273` (passe `description`)
- Test: `apps/web/components/workflow/editor/editor-header.test.tsx` (nouveau)

**Interfaces:**

- Consumes: `TWorkflowDetail.description` (déjà fourni par le serveur).
- Produces: `EditorHeader` reçoit `description: string` en plus.

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditorHeader } from "./editor-header";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const props = (extra = {}) => ({
  name: "Support",
  description: "Tickets of the help desk",
  projectCount: 1,
  canEdit: true,
  dirty: false,
  canSave: false,
  isSaving: false,
  onAddState: vi.fn(),
  onAddTransition: vi.fn(),
  onAddRule: vi.fn(),
  onSave: vi.fn(),
  onDiscard: vi.fn(),
  onClose: vi.fn(),
  ...extra,
});

describe("EditorHeader", () => {
  it("leads back to the list through the breadcrumb, with the same guard as Close", async () => {
    const onClose = vi.fn();
    render(<EditorHeader {...props({ onClose })} />);
    const nav = screen.getByRole("navigation", { name: "workflows.editor.breadcrumb" });
    await userEvent.setup().click(nav.querySelector("button") as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { level: 1, name: "Support" })).toBeTruthy();
  });

  it("shows the description in full on hover and nothing when there is none", () => {
    const { rerender } = render(<EditorHeader {...props()} />);
    expect(screen.getByText("Tickets of the help desk").getAttribute("title")).toBe("Tickets of the help desk");
    rerender(<EditorHeader {...props({ description: "" })} />);
    expect(screen.queryByText("Tickets of the help desk")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run components/workflow/editor/editor-header.test.tsx`
Expected: FAIL (pas de `navigation`).

- [ ] **Step 3: Implement**

Dans `editor-header.tsx` : ajouter `description: string` à `Props`, puis remplacer le bloc `<div className="min-w-0 flex-1 space-y-1">…</div>` par :

```tsx
<div className="min-w-0 flex-1 space-y-1">
  <nav aria-label={t("workflows.editor.breadcrumb")} className="text-caption-md-regular text-tertiary">
    {/* Back to the list through Close, so unsaved changes get the same guard. */}
    <button type="button" className="hover:underline" onClick={props.onClose}>
      {t("workflows.label")}
    </button>
    <span aria-hidden className="px-1">
      /
    </span>
    <span aria-current="page">{name}</span>
  </nav>
  <div className="flex flex-wrap items-center gap-2.5">
    <h1 className="truncate text-h5-semibold text-primary">{name}</h1>
    {/* Names only reach workspace admins (P6 of the workflows plan): without them the count is plain text. */}
    {projects && projects.length > 0 ? (
      <details className="relative">
        <summary className={`cursor-pointer ${USED_IN_CLASS}`}>{usedIn}</summary>
        <ul className="shadow-md absolute z-10 mt-1 min-w-48 rounded-md border border-subtle bg-layer-1 p-2 text-body-xs-regular text-primary">
          {projects.map((project) => (
            <li key={project.id}>{project.name}</li>
          ))}
        </ul>
      </details>
    ) : (
      <p className={USED_IN_CLASS}>{usedIn}</p>
    )}
  </div>
  {description && (
    <p title={description} className="line-clamp-2 max-w-3xl text-body-xs-regular text-tertiary">
      {description}
    </p>
  )}
</div>
```

Remplacer `USED_IN_CLASS` par `"text-caption-md-regular text-tertiary max-md:min-h-11"` et retirer l'import `CopyOutline` s'il n'est plus utilisé. Vérifier que `text-h5-semibold` existe (`grep -rn "text-h5-semibold" apps/web/components | head -1`) ; sinon garder `text-body-sm-semibold`. Si le bouton « Fermer » repose sur `onClose` quand rien n'est modifié et sur `onDiscard` sinon, garder ce comportement tel quel (J5).

Dans `workflow-editor.tsx`, ajouter `description={workflow.description}` à `<EditorHeader … />`.

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && npx vitest run components/workflow/editor && npx tsc --noEmit && npx oxlint --deny-warnings components/workflow/editor/editor-header.tsx`
Expected: PASS. Adapter, sans en changer l'intention, les assertions de `workflow-editor.test.tsx` qui lisaient l'ancien rendu de « Utilisé dans ».

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workflow/editor
git commit -m "feat(web): add a breadcrumb and the description to the workflow editor header"
```

---

### Task 6: Liste des workflows

**Files:**

- Modify: `apps/web/components/workflow/settings/workflow-list.tsx` (réécriture)
- Test: `apps/web/components/workflow/settings/workflow-list.test.tsx` (réécriture des cas, mocks gardés)

**Interfaces:**

- Consumes: `TWorkflowSummary.states`, `.transition_count` (tâches 1-2) ; `StateLozenge`, `BAR_CLASS`, `toneOf` (tâche 2) ; `Menu`, `MenuContent`, `MenuItem`, `MenuTrigger` de `@makeplane/propel/components/menu` ; `IconButton` de `@makeplane/propel/components/icon-button` ; `Icon` de `@makeplane/propel/components/icon` ; `Tooltip` de `@makeplane/propel/components/tooltip` ; `Select` de `@plane/blocks/select` (voir son usage dans `apps/web/components/projects/create/attributes.tsx` de `preview` avant les projets secrets : `git show e506a7256e~1:apps/web/components/projects/create/attributes.tsx`).
- Produces: `WorkspaceWorkflowList({ workspaceSlug })`, même signature.

- [ ] **Step 1: Write the failing tests**

Dans `workflow-list.test.tsx`, garder les mocks et `open()`. Étendre `summary()` avec `states: [], transition_count: 0`. Remplacer les blocs `duplication`, `deletion`, `used in` et `write actions` par :

```tsx
const states = (...names: string[]) => names.map((name) => ({ name, group: "started" as const }));
const MORE = "workflows.settings.more_actions";
const DUPLICATE = "workflows.settings.duplicate.action";
const DELETE = "workflows.settings.delete.action";

const openMenu = async (user: ReturnType<typeof userEvent.setup>, index = 0) => {
  await user.click(screen.getAllByRole("button", { name: MORE })[index]);
};

describe("rows", () => {
  it("previews the first five states in flow order, then the rest as a count", () => {
    state.workflows = [
      summary("a", "Software", {
        states: states("A", "B", "C", "D", "E", "F", "G"),
        state_count: 7,
        transition_count: 6,
      }),
    ];
    open();
    for (const name of ["A", "B", "C", "D", "E"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.queryByText("F")).toBeNull();
    expect(screen.getByText("+2")).toBeTruthy();
  });

  it("flags an empty workflow and invites to add a first state", () => {
    state.workflows = [summary("a", "Draft", { state_count: 0 })];
    open();
    expect(screen.getByText("workflows.settings.empty_badge")).toBeTruthy();
    expect(screen.getByRole("link", { name: "workflows.settings.add_first_state" })).toBeTruthy();
  });

  it("keeps the description out of the table, behind a focusable icon", () => {
    state.workflows = [summary("a", "Support", { description: "Help desk" })];
    open();
    expect(screen.queryByRole("columnheader", { name: "workflows.settings.columns.description" })).toBeNull();
    const info = screen.getByRole("button", { name: "workflows.settings.description_label" });
    expect(document.getElementById(info.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Help desk");
  });

  it("says when a workflow is not used", () => {
    open();
    expect(screen.getByText("workflows.settings.not_used")).toBeTruthy();
  });
});

describe("toolbar", () => {
  beforeEach(() => {
    state.workflows = [summary("a", "Software", { project_count: 1 }), summary("b", "Support")];
  });

  it("searches by name and counts what it shows", async () => {
    const user = open();
    await user.type(screen.getByRole("searchbox", { name: "workflows.settings.search" }), "supp");
    expect(screen.queryByText("Software")).toBeNull();
    expect(screen.getByText("Support")).toBeTruthy();
    expect(screen.getByText("workflows.settings.count")).toBeTruthy();
  });

  it("says so when nothing matches", async () => {
    const user = open();
    await user.type(screen.getByRole("searchbox", { name: "workflows.settings.search" }), "zzz");
    expect(screen.getByText("workflows.settings.no_match")).toBeTruthy();
  });

  it("filters on usage", async () => {
    const user = open();
    await user.click(screen.getByRole("combobox", { name: /workflows\.settings\.usage\.label/ }));
    await user.click(screen.getByRole("option", { name: "workflows.settings.usage.unused" }));
    expect(screen.queryByText("Software")).toBeNull();
    expect(screen.getByText("Support")).toBeTruthy();
  });
});

describe("actions menu", () => {
  it("duplicates with a free copy name and confirms with a toast", async () => {
    state.workflows = [summary("a", "Software"), summary("b", "Copy of Software")];
    const user = open();
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: DUPLICATE }));
    await waitFor(() => expect(state.duplicateWorkflow).toHaveBeenCalledWith("ws", "a", "Copy of Software (2)"));
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });

  it("shows the error toast when the server refuses", async () => {
    state.duplicateWorkflow = vi.fn().mockRejectedValue(new Error("no"));
    const user = open();
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: DUPLICATE }));
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
  });

  it("disables deletion of a used workflow and says why", async () => {
    state.workflows = [summary("a", "Software", { project_count: 2 })];
    const user = open();
    await openMenu(user);
    const item = screen.getByRole("menuitem", { name: new RegExp(DELETE) });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("workflows.settings.delete.used_by");
  });

  it("asks for confirmation before removing an unused workflow", async () => {
    const user = open();
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: DELETE }));
    await user.click(await screen.findByRole("button", { name: DELETE }));
    await waitFor(() => expect(state.removeWorkflow).toHaveBeenCalledWith("ws", "a"));
  });

  it("is hidden from a non-admin", () => {
    state.isAdmin = false;
    open();
    expect(screen.queryByRole("button", { name: MORE })).toBeNull();
    expect(screen.queryByRole("link", { name: "workflows.settings.add_first_state" })).toBeNull();
  });
});
```

Le libellé exact des noms accessibles dépend de propel (`MenuItem` avec `description` ajoute la description au nom accessible) : si un `getByRole` échoue pour cette seule raison, ajuster le sélecteur, pas le composant. Garder le test existant sur les noms de projets lus par les technologies d'assistance (bloc « used in »), en changeant seulement le libellé visible si besoin.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run components/workflow/settings/workflow-list.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Réécrire `workflow-list.tsx`. Structure attendue (code complet à écrire à partir de ce squelette, en gardant `handleDelete`, `handleDuplicate`, `fail` et `ConfirmDialog` d'aujourd'hui) :

```tsx
type TUsage = "all" | "used" | "unused";
const USAGES: TUsage[] = ["all", "used", "unused"];
const PREVIEW_SIZE = 5;
const GROUP_ORDER = ["backlog", "unstarted", "started", "completed", "cancelled"] as const;
const CELL_CLASS = "border-t border-subtle px-4 py-3.5 align-top text-body-sm-regular";

function CategoryBar({ states }: { states: TWorkflowSummary["states"] }) {
  const counts = GROUP_ORDER.map((group) => [group, states.filter((item) => item.group === group).length] as const);
  return (
    <div aria-hidden className="mt-2 flex h-1 w-36 gap-0.5 overflow-hidden rounded-xs">
      {counts
        .filter(([, count]) => count > 0)
        .map(([group, count]) => (
          <span key={group} className={BAR_CLASS[toneOf(group)]} style={{ flexGrow: count }} />
        ))}
    </div>
  );
}

function StatePreview({ states }: { states: TWorkflowSummary["states"] }) {
  const shown = states.slice(0, PREVIEW_SIZE);
  const rest = states.slice(PREVIEW_SIZE);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((item, index) => (
        <Fragment key={`${item.name}-${index}`}>
          {index > 0 && (
            <span aria-hidden className="text-caption-md-regular text-tertiary">
              →
            </span>
          )}
          <StateLozenge name={item.name} group={item.group} />
        </Fragment>
      ))}
      {rest.length > 0 && (
        <span
          title={rest.map((item) => item.name).join(", ")}
          className="rounded-sm bg-layer-2 px-1.5 py-0.5 text-caption-md-medium text-secondary"
        >
          +{rest.length}
        </span>
      )}
    </div>
  );
}
```

Dans `WorkflowRow` :

- cellule Nom : `Link` vers l'éditeur ; si `workflow.description`, un `<Tooltip label={workflow.description}>` autour d'un `<button type="button" aria-label={t("workflows.settings.description_label", { name })} aria-describedby={descriptionId}>` contenant `<InfoOutline className="size-3.5" aria-hidden />`, suivi de `<span id={descriptionId} className="sr-only">{workflow.description}</span>` (même motif que la liste des projets d'aujourd'hui) ; si `state_count === 0`, le badge `<span className="rounded-sm bg-warning-subtle px-1.5 py-px text-caption-sm-medium font-bold text-warning-primary uppercase">{t("workflows.settings.empty_badge")}</span>` ; dessous `{state_count}` et, s'il y a des états, `· {transition_count}` (`workflows.settings.state_count` et `workflows.settings.transition_count`) ; puis `<CategoryBar>` s'il y a des états.
- cellule Aperçu : `<StatePreview>` ; sans état, `{t("workflows.settings.no_state")}, ` puis, pour un admin, `<Link href={editorHref}>{t("workflows.settings.add_first_state")}</Link>` (texte simple pour un membre).
- cellule Utilisé dans : `project_count === 0` → `t("workflows.settings.not_used")` en `text-tertiary` ; sinon la puce `rounded-full bg-layer-2 px-2 py-0.5 text-caption-md-regular` avec le compte, et le motif `Tooltip` + `aria-describedby` d'aujourd'hui quand `projectNames` existe.
- cellule Modifié le : `renderFormattedDate(workflow.updated_at)`.
- cellule Actions (admins) : `Link` « Modifier » puis :

```tsx
<Menu>
  <MenuTrigger
    render={
      <IconButton
        icon={<Icon icon={MoreHorizontalOutline} />}
        aria-label={t("workflows.settings.more_actions", { name: workflow.name })}
        variant="ghost"
        size="sm"
      />
    }
  />
  <MenuContent side="bottom" align="end">
    <MenuItem
      label={t("workflows.settings.duplicate.action")}
      disabled={isDuplicating}
      onClick={() => void handleDuplicate()}
    />
    <MenuItem
      variant="danger"
      label={t("workflows.settings.delete.action")}
      // A disabled row gets neither hover nor focus: the reason is a line of the row (plan, deviations).
      description={inUse ? t("workflows.settings.delete.used_by", { count: workflow.project_count }) : undefined}
      disabled={inUse}
      onClick={() => setIsDeleteOpen(true)}
    />
  </MenuContent>
</Menu>
```

Le texte d'aide `delete.in_use` sous la ligne disparaît.

Dans `WorkspaceWorkflowList` :

- état local `query` (chaîne) et `usage` (`TUsage`, défaut `"all"`) ;
- `visible = workflows.filter((w) => w.name.toLowerCase().includes(query.trim().toLowerCase()) && (usage === "all" || (usage === "used") === w.project_count > 0))` ;
- barre d'outils : `<label htmlFor="workflow-search" className="sr-only">` + `<input id="workflow-search" type="search">` dans un cadre avec `SearchOutline`, puis le `Select` d'utilisation (libellé du déclencheur `${t("workflows.settings.usage.label")} : ${t(`workflows.settings.usage.${usage}`)}`, `aria-label` sur le déclencheur égal à `t("workflows.settings.usage.label")`), puis le compteur `t("workflows.settings.count", { count: visible.length })` à droite ;
- en-têtes `name`, `preview`, `projects`, `updated`, puis `actions` pour un admin ; `<table className="w-full min-w-[900px] border-collapse">` dans `<div className="overflow-x-auto rounded-md border border-subtle">`, en-tête sur fond `bg-layer-1` ;
- aucun workflow : le message `workflows.settings.empty` d'aujourd'hui, sans barre d'outils ; aucun résultat : `<p>{t("workflows.settings.no_match")}</p>` à la place du tableau.

Le tiret cadratin de la maquette (« Aucun état », puis le lien) devient une virgule : règle de typographie du projet.

- [ ] **Step 4: Run the tests, the type check and the lint**

Run: `cd apps/web && npx vitest run components/workflow && npx tsc --noEmit && npx oxlint --deny-warnings components/workflow/settings`
Expected: tout PASS, zéro avertissement.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workflow/settings
git commit -m "feat(web): show the workflow list with state previews and a menu"
```

---

### Task 7: Traductions

**Files:**

- Modify: `packages/i18n/src/locales/*/workflow.json` (`en` et `fr`)

**Interfaces:**

- Produces: les clés citées par les tâches 2 à 6.

- [ ] **Step 1: Load the translate skill** (`translate`) et suivre sa méthode (pluriels CLDR, placeholders intacts, ponctuation par langue).

- [ ] **Step 2: Add the English keys** dans `packages/i18n/src/locales/en/workflow.json`, sous `workflows` :

```json
"settings": {
  "search": "Search workflows",
  "usage": { "label": "Usage", "all": "All", "used": "Used", "unused": "Not used" },
  "count": "{count, plural, one {# workflow} other {# workflows}}",
  "transition_count": "{count, plural, one {# transition} other {# transitions}}",
  "empty_badge": "Empty",
  "no_state": "No state",
  "add_first_state": "add a first state",
  "not_used": "Not used",
  "more_actions": "More actions for {name}",
  "description_label": "Description of {name}",
  "no_match": "No workflow matches",
  "columns": { "preview": "States overview" },
  "delete": { "used_by": "{count, plural, one {Used by # project} other {Used by # projects}}" }
},
"editor": {
  "breadcrumb": "Breadcrumb",
  "text": {
    "toggle_column": "Show or hide",
    "initial_state": "Initial state",
    "legend_start": "Initial transition",
    "legend_any": "Global transition (from any state)",
    "legend_click": "Click a transition to edit it in the side panel."
  }
}
```

(À fusionner dans les objets existants, pas à remplacer.) Retirer les clés devenues inutiles, après avoir vérifié avec `grep -rn` qu'aucun code ne les lit plus : `workflows.settings.columns.description`, `workflows.settings.columns.states`, `workflows.settings.delete.in_use`.

Français (`fr`), d'après le brief : « Rechercher un workflow », « Utilisation », « Tous », « Utilisés », « Non utilisés », « {count, plural, one {# workflow} other {# workflows}} », « {count, plural, one {# transition} other {# transitions}} », « Vide », « Aucun état », « ajouter un premier état », « Non utilisé », « Plus d'actions pour {name} », « Description de {name} », « Aucun workflow ne correspond », « Aperçu des états », « {count, plural, one {Utilisé par # projet} other {Utilisé par # projets}} », « Fil d'Ariane », « Déplier ou replier », « État initial », « Transition initiale », « Transition globale (depuis tous les états) », « Clic sur une transition : édition dans le panneau latéral. ».

- [ ] **Step 3: No other locale** : depuis le 2026-11-17, seuls l'anglais et le français sont livrés ; ne rien traduire d'autre.

- [ ] **Step 4: Check**

Run: `pnpm --filter=@plane/i18n sync:check` et `cd apps/web && npx vitest run components/workflow`
Expected: aucune clé manquante ni en trop ; tests verts. Si des types de clés sont générés (`packages/i18n/src/types/keys.generated.ts`), lancer le script de génération du paquet indiqué par son `package.json` et commiter le fichier généré.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n
git commit -m "feat(i18n): add the strings of the Jira-like workflow screens"
```

---

### Task 8: Vérification d'ensemble et mise à jour de la spec

**Files:**

- Modify: `docs/superpowers/specs/2026-11-17-workflows-jira-ui-design.md` (écarts listés en tête de ce plan)

- [ ] **Step 1: Report the plan's deviations in the spec** : sections 3 (pas de variantes), 4.2 (raison de refus dans le menu), 5.2 (catégorie en texte sous le badge), 4.1 (coût existant de `_projects`), avec la date.

- [ ] **Step 2: Full web checks of the touched areas**

Run: `cd apps/web && npx vitest run components/workflow store/workspace/workflow.store.test.ts "app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/workflows" && npx tsc --noEmit && npx oxlint --deny-warnings components/workflow`
Expected: tout vert.

- [ ] **Step 3: Server tests of the area**

Run: `docker compose -p wfjira -f docker-compose-test.yml run --rm api-tests pytest plane/tests -k "workflow" -q -p no:cacheprovider`, puis `docker compose -p wfjira -f docker-compose-test.yml down -v`.
Expected: tout vert.

- [ ] **Step 4: Check on screen** (serveur de développement sur http://localhost:3000, en thème clair et sombre, bureau et 375px) : liste (recherche, filtre, aperçu, badge Vide, menu, suppression refusée), en-tête de l'éditeur (fil d'Ariane, description), vue Texte (transition visible dans les deux lignes, globale et début seulement dans la cible, sélection, repli, légende). Contrôler le contraste des badges dans les deux thèmes avec l'outil d'accessibilité du navigateur.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-workflows-jira-ui-design.md
git commit -m "docs(specs): record the deviations of the Jira-like workflow screens"
```

Puis, hors plan : `/qa` (revue complète de la fonctionnalité) et `/ponytail-review`. `/security` reste à la décision de l'utilisateur.
