# Deuxième refonte des écrans de workflows : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal** : livrer les décisions D1 à D13 de la deuxième refonte (fenêtre de transition élargie et champ figé, lien DÉMARRER supprimable et obligatoire, panneau droit redessiné, onglet du projet par workflow, refus 409 et bandeau de présence, garde de sortie, taille lisible), plus les points ouverts acceptés (O1, O2, O5, O7).

**Architecture** : la logique du brouillon (`graph-model.ts`) reste pure et reçoit les nouvelles règles (lien DÉMARRER, doublons, transition avec états ajoutés, renommages partagés) ; les composants de l'éditeur sont modifiés un par un autour d'elle. Le serveur reçoit une empreinte du graphe comparée sous verrou (409), une route de présence adossée au cache Redis, les noms des workflows par statut, le refus des transitions en double, une contrainte sur les côtés et le retrait des invités des lectures. L'onglet du projet est réécrit côté web sans toucher au serveur.

**Tech Stack** : Django 5.2 + DRF, PostgreSQL 15, cache `django_redis`, pytest (pile Docker `docker-compose-test.yml`), React Router 8.3 (`useBlocker`), MobX 6, SWR, `@xyflow/react` 12.12.0, `@makeplane/propel`, `@plane/blocks`, `@plane/i18n` (ICU), vitest 4 (projets `unit` pour `*.test.ts`, `dom` pour `*.test.tsx`).

**Spec** : `docs/superpowers/specs/2026-11-14-workflow-screens-redesign-2-design.md` (validée le 2026-11-14, points O1 à O8 acceptés tels que recommandés). Elle complète `docs/superpowers/specs/2026-11-14-workflow-screens-redesign-design.md` et `docs/superpowers/specs/2026-11-12-workflows-design.md`, que l'exécutant lit aussi pour les sections citées par sa tâche.

## Global Constraints

- TDD strict : toute étape qui ajoute de la logique ou un composant commence par un test qui échoue, exécuté et observé en échec avant le code.
- Identifiants techniques en anglais (variables, fonctions, classes, routes, clés i18n, fichiers). Commentaires uniquement pour le pourquoi, une ligne quand le sens tient, trois au plus.
- Aucun tiret cadratin (U+2014) dans le code, les commentaires, les commits, les traductions. Aucun emoji.
- Commits Conventional Commits `<type>(<scope>): <subject>`, minuscules, impératif, 72 caractères au plus, un changement logique par commit, sans `Co-Authored-By` ni aucune mention d'IA. Jamais `--no-verify`. Ne jamais réécrire l'historique (pas de `rebase`, `amend`, `filter-branch`, `reset`).
- Le crochet de pre-commit lance `oxlint --deny-warnings` et `oxfmt` sur les fichiers indexés : un échec se corrige dans le code.
- Travailler uniquement dans le worktree `.worktrees/feat-workflows`, branche `feat/workflows` ; ne jamais changer de branche ni créer de worktree.
- Interdit pendant tout le plan (l'utilisateur teste sur le serveur de développement qui sert ce worktree) : `pnpm turbo run ...`, `pnpm check`, `pnpm build`, `pnpm install`, démarrer ou arrêter un serveur. Si l'erreur « Failed to load url .../packages/blocks/dist/... » apparaît : `touch apps/web/app/error/dev.tsx`.
- Commandes web, depuis la racine du worktree : `pnpm --filter=web exec vitest run <chemin relatif à apps/web>`, `pnpm --filter=web exec tsc --noEmit`, `pnpm --filter=web exec oxlint --deny-warnings <fichiers relatifs à apps/web>`, `pnpm exec oxfmt --check <chemins>`, `pnpm --filter=@plane/i18n sync:check`.
- `packages/types`, `packages/constants` et `packages/i18n` sont consommés depuis leur `dist/`, reconstruit par le serveur de développement en marche (`tsdown --watch --no-clean`). Après une modification d'un de ces paquets, attendre que `dist/` soit plus récent que la source (`ls -l --time-style=full-iso packages/types/dist/index.d.mts`) ; s'il ne bouge pas en 20 secondes, lancer `pnpm --filter=@plane/types exec tsdown --no-clean` (ou le paquet concerné), jamais sans `--no-clean`.
- Commandes backend : `uv` local n'est pas à la bonne version, ne pas le mettre à jour. Tests : `docker compose -p wfr2-<tâche> -f docker-compose-test.yml run --rm --build api-tests pytest --create-db <chemin> -v`, puis `docker compose -p wfr2-<tâche> -f docker-compose-test.yml down -v`. Lint : `docker compose -p wfr2-<tâche> -f docker-compose-test.yml run --rm --no-deps api-tests ruff check <chemins>` et `ruff format --check <chemins>` (seuls les fichiers touchés ; 49 fichiers du dépôt sont déjà non formatés, hors périmètre). `manage.py` : `docker exec prototype-jira-api-1 python manage.py ...` (le conteneur monte `apps/api` de ce worktree).
- Autorisation contrôlée côté serveur sur chaque opération ; l'interface ne fait que refléter les droits. Tout objet est résolu dans le workspace de l'URL ; un objet absent ou d'un autre workspace reçoit la même réponse 404.
- Bornes inchangées : 1 000 statuts par workspace, 200 états et 1 000 transitions par workflow, noms 255 caractères.
- Tout nouveau texte d'interface passe par `packages/i18n` : anglais et français écrits dans ce plan (tâche 2), les 20 autres locales avec le skill `translate` (`.claude/skills/translate/SKILL.md`). En français on dit « ticket », apostrophe typographique (U+2019), espaces fines insécables dans les guillemets ; pluriels fr `one`, `many`, `other` ; es `one`, `other`.
- Ne jamais mettre `t` de `@plane/i18n` dans un tableau de dépendances (nouvelle fonction à chaque rendu) ; utiliser `currentLocale`.
- Nouveaux fichiers `.py`, `.ts`, `.tsx` (hors migrations) : en-tête `COPYRIGHT.txt`, recopié d'un fichier voisin.
- Frontend : conventions de Plane (MobX + SWR), dérogation explicite aux règles ASIN FE-2, FE-3, FE-6. Primitives de `@makeplane/propel`, composites de `@plane/blocks`. Éléments HTML natifs pour les listes de choix (cases à cocher, `select`).
- Tests web : React Flow sous jsdom masque les nœuds, on les trouve par leur texte ; `fireEvent.click` plutôt que `userEvent` sur les nœuds ; un geste que jsdom ne dessine pas se rejoue par les props capturées de `ReactFlow` (voir `workflow-canvas.test.tsx`).
- Aucune dépendance nouvelle.
- Ne jamais utiliser le compte de l'utilisateur ; ne recopier aucun identifiant de compte de test dans un rapport.

## Décisions prises en écrivant ce plan

| #   | Décision                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Y1  | L'empreinte (`version`) est calculée dans `workflow_detail` (vue), pas dans `workflow_graph` : l'instantané d'audit et le système d'un projet ne changent pas. `save_workflow_graph` reçoit `expected_version` facultatif (absent pour la création depuis un projet et la duplication). |
| Y2  | Pour que l'empreinte lue sous verrou soit fiable, `save_workflow_graph` verrouille en une seule requête, triée par identifiant, les statuts que le workflow utilise déjà et ceux que la charge cite. Une seule requête évite un interblocage entre deux enregistrements croisés.        |
| Y3  | Présence : une clé de cache `workflow_editing:<workflow>:<user>` par admin, lue pour tous les admins actifs du workspace en un `cache.get_many`. Pas de liste partagée à modifier, donc pas de course entre deux signaux.                                                               |
| Y4  | Un seul appel `POST presence/` sert de signal et de lecture : l'éditeur l'envoie toutes les 30 secondes avec `editing` égal à « brouillon modifié ».                                                                                                                                    |
| Y5  | « Recharger » (après un 409) est fait par la page : elle relit le workflow, les statuts et les états proposés, puis remonte l'éditeur (`key`), qui repart d'un état neuf.                                                                                                               |
| Y6  | La sélection de l'éditeur gagne le genre `start` : `TSelectionTarget = { kind: "state" \| "transition"; key: string } \| { kind: "start" }`, défini dans `graph-model.ts` ; `TEditorSelection = TSelectionTarget \| null`.                                                              |
| Y7  | Un statut du brouillon porte `server_name` (nom connu du serveur) et `shared_names` (noms des autres workflows) : le renommage d'un état partagé se détecte sans comparer au graphe enregistré, y compris pour un état partagé ajouté puis renommé dans le même brouillon.              |
| Y8  | La garde de sortie est un composant `LeaveGuard` (`useBlocker` de React Router et `beforeunload`), rendu par la page ; l'éditeur signale `dirty` par `onDirtyChange` (X10 : il ne connaît pas le routeur).                                                                              |
| Y9  | `text-caption-sm-medium` vaut 11 px dans le thème de Plane : la taille lisible de D9 est le zoom 1 (`READABLE_ZOOM = 1`). Le recalage automatique ne descend donc plus sous 100 %.                                                                                                      |
| Y10 | Une clé i18n en service ne change jamais de paramètres : `panel.shared` (paramètre `count`) est remplacée par une clé nouvelle `panel.shared_named` (`count`, `names`) et retirée à la tâche 17.                                                                                        |
| Y11 | Ordre : l'interface d'abord (D1 livrée à la tâche 3, pour que l'utilisateur la teste tôt), le serveur ensuite. Les champs de type ajoutés avant leur route (`workflows` d'un statut) sont facultatifs.                                                                                  |
| Y12 | Onglet du projet : toute modification passe par une fonction `run(change)` qui relit le système du projet, applique `change` à cette lecture, demande l'aperçu, puis applique ou affiche la correspondance.                                                                             |
| Y13 | Les anciennes clés i18n devenues inutiles sont retirées à la tâche 17, sur liste fermée, après vérification qu'aucun chemin complet ni préfixe construit par gabarit ne les utilise.                                                                                                    |

---

## File Structure

### Backend (`apps/api`)

| Fichier                                                      | Action          | Responsabilité                                                                                     |
| ------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------- |
| `plane/utils/workflow_graph.py`                              | Modify          | `graph_version`, verrou des statuts, contrôle `expected_version`.                                  |
| `plane/app/views/workflow/base.py`                           | Modify          | `version` du détail, 409, route de présence, lectures sans invités, noms des workflows par statut. |
| `plane/app/serializers/workflow.py`                          | Modify          | `workflows` d'un statut, refus `duplicate_transition`.                                             |
| `plane/app/views/__init__.py`, `plane/app/urls/workflow.py`  | Modify          | Export et route de présence.                                                                       |
| `plane/db/models/workflow.py`                                | Modify          | Contrainte sur les côtés.                                                                          |
| `plane/db/migrations/0131_workflow_transition_side_check.py` | Create (généré) | La contrainte.                                                                                     |
| `migrations_lockfile.txt`                                    | Modify (généré) | Dernière migration.                                                                                |
| `plane/tests/contract/app/test_workflows_app.py`             | Modify          | Tests des routes.                                                                                  |
| `plane/tests/unit/utils/test_workflow_graph_version.py`      | Create          | Tests de l'empreinte.                                                                              |
| `plane/tests/unit/serializers/test_workflow_graph.py`        | Modify          | Tests du refus des doublons.                                                                       |
| `plane/tests/unit/models/test_workflow_models.py`            | Modify          | Test de la contrainte.                                                                             |

### Types et web

| Fichier                                                                                        | Action  | Responsabilité                                                                        |
| ---------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `packages/types/src/workflow.ts`                                                               | Modify  | `workflows` d'un statut, `version`, `TWorkflowGraphSavePayload`, `TWorkflowEditor`.   |
| `packages/i18n/src/locales/*/workflow.json`                                                    | Modify  | Nouveaux textes, 22 locales.                                                          |
| `apps/web/components/workflow/editor/graph-model.ts` (+ `graph-model.links.test.ts`)           | Modify  | Lien DÉMARRER, doublons, transition avec états ajoutés, renommages partagés.          |
| `apps/web/components/workflow/editor/add-transition-dialog.tsx` (+ test)                       | Rewrite | Groupes « Dans ce workflow » et « Autres états existants », champ figé.               |
| `apps/web/components/workflow/editor/workflow-canvas.tsx`, `start-node.tsx` (+ test)           | Modify  | Sélection et retrait du lien DÉMARRER ; taille lisible ; consignes clavier traduites. |
| `apps/web/components/workflow/editor/start-panel.tsx` (+ test)                                 | Create  | Panneau « Départ du workflow ».                                                       |
| `apps/web/components/workflow/editor/side-panel.tsx` (+ test)                                  | Rewrite | Panneau redessiné.                                                                    |
| `apps/web/components/workflow/editor/text-view.tsx` (+ test)                                   | Modify  | Clic sur la ligne, ligne « Début » cliquable.                                         |
| `apps/web/components/workflow/editor/workflow-editor.tsx` (+ test)                             | Modify  | Câblage, 409 et « Recharger », présence, confirmation de renommage, signal `dirty`.   |
| `apps/web/components/workflow/editor/leave-guard.tsx` (+ test)                                 | Create  | Garde de sortie.                                                                      |
| `apps/web/app/(all)/[workspaceSlug]/workflow-editor/[workflowId]/page.tsx`                     | Modify  | Garde, rechargement, présence, invités non autorisés.                                 |
| `apps/web/services/workflow.service.ts`, `apps/web/store/workspace/workflow.store.ts` (+ test) | Modify  | `expected_version`, `sendPresence`.                                                   |
| `apps/web/components/workflow/project/scheme-helpers.ts` (+ test)                              | Modify  | Calculs du système du projet.                                                         |
| `apps/web/components/workflow/project/scheme-dialog.tsx` (+ test)                              | Create  | Fenêtre relier, ajouter, modifier les types, remplacer, et étape de correspondance.   |
| `apps/web/components/workflow/project/project-workflow-scheme.tsx` (+ test)                    | Rewrite | Tableau et orchestration.                                                             |

---

### Task 1: Logique du brouillon (spec 4.1, 4.2, 4.5, 6.4 ; D1, D3, D4, E4, Y6, Y7)

**Files:**

- Modify: `packages/types/src/workflow.ts`
- Modify: `apps/web/components/workflow/editor/graph-model.ts`
- Create: `apps/web/components/workflow/editor/graph-model.links.test.ts`
- Modify: `apps/web/components/workflow/editor/graph-model.test.ts`, `graph-model.layout.test.ts` (assertions que cette tâche change volontairement)
- Modify: `apps/web/components/workflow/editor/workflow-canvas.tsx` (type `TEditorSelection` seulement), `workflow-editor.tsx` (garde de sélection seulement)

**Interfaces:**

- Consumes: rien.
- Produces (tout exporté de `graph-model.ts`) :
  - `type TSelectionTarget = { kind: "state" | "transition"; key: string } | { kind: "start" }`
  - `TDraftStatus` gagne `server_name?: string` et `shared_names?: string[]` ; `TStatusOption` gagne `workflow_names: string[]`
  - `clearInitial(draft: TDraftGraph): TDraftGraph`
  - `isDuplicateRoute(draft, route: Pick<TDraftTransition, "from_any" | "source_keys" | "target_key">, exceptKey?: string): boolean`
  - `sourceCandidates(draft: TDraftGraph, transitionKey: string): TDraftState[]`
  - `type TStateRef = { kind: "state"; key: string } | { kind: "new"; key: string; status: TDraftStatus }`
  - `type TNewTransition = { key: string; name: string; from_any: boolean; sources: TStateRef[]; target: TStateRef }`
  - `addTransitionWithStates(draft: TDraftGraph, input: TNewTransition): TDraftGraph`
  - `type TSharedRename = { key: string; from: string; to: string; workflows: string[] }`
  - `renamedSharedStatuses(draft: TDraftGraph): TSharedRename[]`
  - `errorTarget(draft, code): TSelectionTarget | null` (renvoie `{ kind: "start" }` pour `initial_state_required`)
  - `validateDraft` peut renvoyer le code `duplicate_transition` ; `getGraphErrorKey` reconnaît `stale_graph` et `duplicate_transition`
  - `packages/types` : `TWorkflowStatus.workflows?: { id: string; name: string }[]`
  - `workflow-canvas.tsx` : `export type TEditorSelection = TSelectionTarget | null`

- [ ] **Step 1: Ajouter le champ de type**

Dans `packages/types/src/workflow.ts`, dans `TWorkflowStatus`, après `workflow_count?: number;` :

```ts
  /** Workflows using the status, sorted by name. */
  workflows?: { id: string; name: string }[];
```

Attendre la reconstruction de `packages/types/dist` (voir Global Constraints).

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `apps/web/components/workflow/editor/graph-model.links.test.ts` (en-tête COPYRIGHT recopié de `graph-model.test.ts`) :

```ts
import { describe, expect, it } from "vitest";
import type { TWorkflowDetail, TWorkflowStatus } from "@plane/types";
import {
  addStates,
  addTransitionWithStates,
  clearInitial,
  connectStates,
  errorTarget,
  fromDetail,
  getGraphErrorKey,
  isDuplicateRoute,
  optionToStatus,
  removeState,
  renamedSharedStatuses,
  sourceCandidates,
  startPlacement,
  statusOptions,
  validateDraft,
  type TDraftGraph,
  type TDraftStatus,
} from "./graph-model";

const status = (name: string, extra: Partial<TDraftStatus> = {}): TDraftStatus => ({
  name,
  color: "#3A3A3A",
  group: null,
  shared_count: 0,
  ...extra,
});
const state = (key: string, name: string, x = 0, isInitial = false, extra: Partial<TDraftStatus> = {}) => ({
  key,
  status: status(name, extra),
  position_x: x,
  position_y: 0,
  is_initial: isInitial,
});
const arrow = (key: string, sources: string[] | "*", target: string) => ({
  key,
  name: "",
  from_any: sources === "*",
  source_keys: sources === "*" ? [] : sources,
  target_key: target,
  rules: [],
  sides: {},
});
const base: TDraftGraph = {
  states: [state("a", "Todo", 0, true), state("b", "Doing", 240), state("c", "Done", 480)],
  transitions: [arrow("t1", ["a"], "b")],
};

describe("start link", () => {
  it("can be removed, which is an error pointing at the start", () => {
    const unlinked = clearInitial(base);
    expect(unlinked.states.some((item) => item.is_initial)).toBe(false);
    expect(validateDraft(unlinked)).toContain("initial_state_required");
    expect(errorTarget(unlinked, "initial_state_required")).toEqual({ kind: "start" });
  });

  it("is not moved to another state when the start state is removed", () => {
    expect(removeState(base, "a").states.some((item) => item.is_initial)).toBe(false);
  });

  it("is set on the first state of an empty workflow only", () => {
    const empty: TDraftGraph = { states: [], transitions: [] };
    expect(addStates(empty, [{ key: "n", status: status("New") }]).states[0].is_initial).toBe(true);
    const added = addStates(clearInitial(base), [{ key: "n", status: status("New") }]);
    expect(added.states.some((item) => item.is_initial)).toBe(false);
  });

  it("keeps the start node left of the diagram when nothing is linked", () => {
    expect(startPlacement(clearInitial(base))).toEqual({ x: -160, y: -20, sides: { source: "right", target: "left" } });
    expect(startPlacement({ states: [], transitions: [] })).toBeNull();
  });
});

describe("duplicate transitions", () => {
  it("detects a route that another transition already has", () => {
    const route = (sources: string[] | "*", target: string) => arrow("x", sources, target);
    expect(isDuplicateRoute(base, route(["a"], "b"))).toBe(true);
    expect(isDuplicateRoute(base, route(["c", "a"], "b"))).toBe(true);
    expect(isDuplicateRoute(base, route(["c"], "b"))).toBe(false);
    expect(isDuplicateRoute(base, route(["a"], "b"), "t1")).toBe(false);
    // A global transition and a transition from a state are two routes: their rules may differ.
    expect(isDuplicateRoute(base, route("*", "b"))).toBe(false);
    const withGlobal = { ...base, transitions: [...base.transitions, arrow("g", "*", "c")] };
    expect(isDuplicateRoute(withGlobal, route("*", "c"))).toBe(true);
  });

  it("is a draft error pointing at the later transition", () => {
    const draft = { ...base, transitions: [...base.transitions, arrow("t2", ["a", "c"], "b")] };
    expect(validateDraft(draft)).toContain("duplicate_transition");
    expect(errorTarget(draft, "duplicate_transition")).toEqual({ kind: "transition", key: "t2" });
    expect(validateDraft(base)).not.toContain("duplicate_transition");
  });

  it("is not created by drawing the same arrow twice", () => {
    expect(connectStates(base, "t2", "a", "right", "b", "left")).toBe(base);
  });

  it("is not offered as one more source of a transition", () => {
    expect(sourceCandidates(base, "t1").map((item) => item.key)).toEqual(["c"]);
    const draft = { ...base, transitions: [...base.transitions, arrow("t2", ["c"], "b")] };
    expect(sourceCandidates(draft, "t1")).toEqual([]);
    expect(sourceCandidates({ ...base, transitions: [arrow("g", "*", "b")] }, "g")).toEqual([]);
  });

  it("maps the two new server codes to their messages", () => {
    expect(getGraphErrorKey({ graph: ["stale_graph"] }).key).toBe("workflows.editor.errors.stale_graph");
    expect(getGraphErrorKey({ graph: ["duplicate_transition"] }).key).toBe(
      "workflows.editor.errors.duplicate_transition"
    );
  });
});

describe("addTransitionWithStates", () => {
  it("adds the states picked outside the workflow, right of the last one, then the transition", () => {
    const next = addTransitionWithStates(base, {
      key: "t9",
      name: " Review ",
      from_any: false,
      sources: [
        { kind: "state", key: "a" },
        { kind: "new", key: "n1", status: status("Review") },
      ],
      target: { kind: "new", key: "n2", status: status("Shipped") },
    });
    expect(next.states.map((item) => [item.key, item.position_x, item.is_initial])).toEqual([
      ["a", 0, true],
      ["b", 240, false],
      ["c", 480, false],
      ["n1", 720, false],
      ["n2", 960, false],
    ]);
    expect(next.transitions[1]).toEqual({
      key: "t9",
      name: "Review",
      from_any: false,
      source_keys: ["a", "n1"],
      target_key: "n2",
      rules: [],
      sides: {},
    });
  });

  it("ignores the sources of a transition from any state", () => {
    const next = addTransitionWithStates(base, {
      key: "t9",
      name: "",
      from_any: true,
      sources: [{ kind: "new", key: "n1", status: status("Review") }],
      target: { kind: "state", key: "c" },
    });
    expect(next.states).toHaveLength(3);
    expect(next.transitions[1]).toMatchObject({ from_any: true, source_keys: [], target_key: "c" });
  });

  it("links the start to the first state added to an empty workflow", () => {
    const next = addTransitionWithStates(
      { states: [], transitions: [] },
      {
        key: "t9",
        name: "",
        from_any: false,
        sources: [{ kind: "new", key: "n1", status: status("Todo") }],
        target: { kind: "new", key: "n2", status: status("Done") },
      }
    );
    expect(next.states.map((item) => item.is_initial)).toEqual([true, false]);
  });
});

describe("shared statuses", () => {
  const serverStatus = (id: string, name: string, workflows: { id: string; name: string }[]): TWorkflowStatus => ({
    id,
    name,
    color: "#3A3A3A",
    group: "started",
    group_is_auto: true,
    workflow_count: workflows.length,
    workflows,
  });
  const shared = serverStatus("s1", "Todo", [
    { id: "w", name: "Software" },
    { id: "w2", name: "Bug" },
    { id: "w3", name: "Delivery" },
  ]);
  const detail: TWorkflowDetail = {
    id: "w",
    name: "Software",
    description: "",
    updated_at: null,
    project_count: 0,
    states: [{ id: "a", status: shared, position_x: 0, position_y: 0, is_initial: true }],
    transitions: [],
  } as TWorkflowDetail;

  it("names the other workflows of a status and remembers its server name", () => {
    const draftStatus = fromDetail(detail, [shared]).states[0].status;
    expect(draftStatus.shared_names).toEqual(["Bug", "Delivery"]);
    expect(draftStatus.server_name).toBe("Todo");
  });

  it("carries the names through the list of other existing states", () => {
    const [option] = statusOptions([shared], [{ name: "Review", color: "#333333", group: "started" }], {
      states: [],
      transitions: [],
    });
    expect(option.workflow_names).toEqual(["Software", "Bug", "Delivery"]);
    expect(optionToStatus(option)).toMatchObject({
      server_name: "Todo",
      shared_names: ["Software", "Bug", "Delivery"],
    });
    const [, candidate] = statusOptions([shared], [{ name: "Review", color: "#333333", group: "started" }], {
      states: [],
      transitions: [],
    });
    expect(optionToStatus(candidate).server_name).toBeUndefined();
    expect(optionToStatus(candidate).shared_names).toEqual([]);
  });

  it("lists the renamed statuses that other workflows use", () => {
    const draft: TDraftGraph = {
      states: [
        state("a", "To do", 0, true, { id: "s1", server_name: "Todo", shared_names: ["Bug"] }),
        state("b", "Doing", 240, false, { id: "s2", server_name: "Doing", shared_names: ["Bug"] }),
        state("c", "Finished", 480, false, { id: "s3", server_name: "Done", shared_names: [] }),
        state("d", "Brand new", 720),
      ],
      transitions: [],
    };
    expect(renamedSharedStatuses(draft)).toEqual([{ key: "a", from: "Todo", to: "To do", workflows: ["Bug"] }]);
  });
});
```

- [ ] **Step 3: Lancer les tests, constater l'échec**

Run: `pnpm --filter=web exec vitest run components/workflow/editor/graph-model.links.test.ts`
Expected: FAIL à l'import (`clearInitial`, `addTransitionWithStates`, `isDuplicateRoute`, `sourceCandidates`, `renamedSharedStatuses` n'existent pas).

- [ ] **Step 4: Implémenter dans `graph-model.ts`**

`TDraftStatus` : ajouter après `shared_count: number;` (et compléter le commentaire du type d'une ligne : `server_name, shared_names: name known to the server and the other workflows using the status (W17).`) :

```ts
  server_name?: string;
  shared_names?: string[];
```

Sous `TDraftGraph` :

```ts
export type TSelectionTarget = { kind: "state" | "transition"; key: string } | { kind: "start" };
```

`GRAPH_ERROR_CODES` : ajouter `"stale_graph"` et `"duplicate_transition"`.

`fromDetail` : remplacer le calcul de `usage` et le littéral du statut par :

```ts
    const known = statuses.find((status) => status.id === state.status.id);
    const usage = known?.workflow_count ?? 1;
    return {
      key: state.id,
      status: {
        id: state.status.id,
        name: state.status.name,
        color: state.status.color,
        group: state.status.group_is_auto ? null : state.status.group,
        known_group: state.status.group,
        group_locked: !state.status.group_is_auto,
        shared_count: Math.max(usage - 1, 0),
        server_name: state.status.name,
        shared_names: (known?.workflows ?? []).filter((item) => item.id !== detail.id).map((item) => item.name),
      },
```

`addStates` : remplacer `const hasInitial = ...` et son usage par :

```ts
// Only the first state of an empty workflow is linked to the start by itself (D4).
const linksStart = draft.states.length === 0;
```

et `is_initial: linksStart && index === 0,`.

`removeState` : supprimer le report de l'état de départ (E4) :

```ts
export const removeState = (draft: TDraftGraph, key: string): TDraftGraph => {
  // The start link is not moved to another state: the admin chooses it again (E4).
  const states = draft.states.filter((state) => state.key !== key);
  const transitions = draft.transitions
    .filter((transition) => transition.target_key !== key)
    .map((transition) =>
      Object.assign({}, transition, { source_keys: transition.source_keys.filter((source) => source !== key) })
    )
    .filter((transition) => transition.from_any || transition.source_keys.length > 0);
  return { states, transitions };
};
```

Sous `setInitial` :

```ts
export const clearInitial = (draft: TDraftGraph): TDraftGraph => ({
  ...draft,
  states: draft.states.map((state) => (state.is_initial ? { ...state, is_initial: false } : state)),
});
```

Au-dessus de `draftChecks` :

```ts
type TRoute = Pick<TDraftTransition, "from_any" | "source_keys" | "target_key">;

const routePairs = (route: TRoute) =>
  route.from_any ? [`*>${route.target_key}`] : route.source_keys.map((source) => `${source}>${route.target_key}`);

/** True when another transition already links one of these sources, or any state, to this target (spec 6.4). */
export const isDuplicateRoute = (draft: TDraftGraph, route: TRoute, exceptKey?: string) => {
  const pairs = new Set(routePairs(route));
  return draft.transitions.some((item) => item.key !== exceptKey && routePairs(item).some((pair) => pairs.has(pair)));
};

/** States that can become one more source: not a source, not the target, no duplicate route (E9). */
export const sourceCandidates = (draft: TDraftGraph, transitionKey: string): TDraftState[] => {
  const transition = draft.transitions.find((item) => item.key === transitionKey);
  if (!transition || transition.from_any) return [];
  return draft.states.filter(
    (state) =>
      state.key !== transition.target_key &&
      !transition.source_keys.includes(state.key) &&
      !isDuplicateRoute(
        draft,
        { from_any: false, source_keys: [state.key], target_key: transition.target_key },
        transitionKey
      )
  );
};
```

Dans `draftChecks`, avant `const states` :

```ts
// The later of two transitions sharing a route is the faulty one.
const seenPairs = new Set<string>();
const duplicates = new Set<string>();
for (const transition of draft.transitions) {
  const pairs = routePairs({ ...transition, source_keys: transition.from_any ? [] : transition.source_keys });
  if (pairs.some((pair) => seenPairs.has(pair))) duplicates.add(transition.key);
  for (const pair of pairs) seenPairs.add(pair);
}
```

et, à la fin du tableau `transitions` de `draftChecks` : `["duplicate_transition", (transition) => duplicates.has(transition.key)],`.

`errorTarget` :

```ts
export const errorTarget = (draft: TDraftGraph, code: string): TSelectionTarget | null => {
  // The missing start link is fixed in the start panel (spec 4.2).
  if (code === "initial_state_required") return draft.states.length > 0 ? { kind: "start" } : null;
  const checks = draftChecks(draft);
  const stateTest = checks.states.find(([name]) => name === code)?.[1];
  const transitionTest = checks.transitions.find(([name]) => name === code)?.[1];
  const found = stateTest ? draft.states.find(stateTest) : transitionTest && draft.transitions.find(transitionTest);
  if (!found) return null;
  return { kind: stateTest ? "state" : "transition", key: found.key };
};
```

`startPlacement` : remplacer `if (!initial) return null;` par :

```ts
if (!initial) {
  if (draft.states.length === 0) return null;
  // Unlinked (spec 4.2): left of the leftmost state, the topmost one on a tie.
  const first = draft.states.reduce((best, item) =>
    item.position_x < best.position_x || (item.position_x === best.position_x && item.position_y < best.position_y)
      ? item
      : best
  );
  return {
    x: first.position_x - START_ARROW - START_SIZE,
    y: first.position_y + (STATE_BOX.height - START_SIZE) / 2,
    sides: { source: "right", target: "left" },
  };
}
```

`connectStates` : remplacer la garde par :

```ts
const known = (stateKey: string) => draft.states.some((state) => state.key === stateKey);
const route = { from_any: false, source_keys: [sourceKey], target_key: targetKey };
if (sourceKey === targetKey || !known(sourceKey) || !known(targetKey) || isDuplicateRoute(draft, route)) return draft;
```

Sous `connectStates` :

```ts
export type TStateRef = { kind: "state"; key: string } | { kind: "new"; key: string; status: TDraftStatus };
export type TNewTransition = {
  key: string;
  name: string;
  from_any: boolean;
  sources: TStateRef[];
  target: TStateRef;
};

/** One draft change for the dialog (D1): states picked outside the workflow, then the transition. */
export const addTransitionWithStates = (draft: TDraftGraph, input: TNewTransition): TDraftGraph => {
  const sources = input.from_any ? [] : input.sources;
  const fresh = [...sources, input.target].flatMap((ref) =>
    ref.kind === "new" ? [{ key: ref.key, status: ref.status }] : []
  );
  return addTransition(fresh.length > 0 ? addStates(draft, fresh) : draft, {
    key: input.key,
    name: input.name.trim(),
    from_any: input.from_any,
    source_keys: sources.map((ref) => ref.key),
    target_key: input.target.key,
    rules: [],
    sides: {},
  });
};

export type TSharedRename = { key: string; from: string; to: string; workflows: string[] };

/** Renamed statuses that other workflows use: the save asks before renaming them everywhere (D12). */
export const renamedSharedStatuses = (draft: TDraftGraph): TSharedRename[] =>
  draft.states.flatMap((state) => {
    const { server_name: from, shared_names: workflows = [] } = state.status;
    const to = state.status.name.trim();
    if (from === undefined || workflows.length === 0 || from.trim() === to) return [];
    return [{ key: state.key, from, to, workflows }];
  });
```

`TStatusOption` : ajouter `workflow_names: string[];`. Dans `statusOptions`, ajouter `workflow_names: (item.workflows ?? []).map((workflow) => workflow.name),` aux statuts et `workflow_names: []` aux candidats. `optionToStatus` :

```ts
export const optionToStatus = (option: TStatusOption): TDraftStatus => ({
  ...(option.id ? { id: option.id, server_name: option.name } : {}),
  name: option.name,
  color: option.color,
  group: option.group_is_auto ? null : option.group,
  known_group: option.group,
  group_locked: Boolean(option.id) && !option.group_is_auto,
  shared_count: option.workflow_count,
  shared_names: option.workflow_names,
});
```

- [ ] **Step 5: Faire compiler les consommateurs du nouveau type de sélection**

Dans `workflow-canvas.tsx`, remplacer la définition de `TEditorSelection` par :

```ts
export type TEditorSelection = TSelectionTarget | null;
```

(importer `type TSelectionTarget` de `./graph-model`). Dans `workflow-editor.tsx`, remplacer la garde de sélection par :

```ts
const isPickedInDraft =
  picked !== null &&
  (picked.kind === "start"
    ? true
    : (picked.kind === "state" ? draft.states : draft.transitions).some((item) => item.key === picked.key));
```

Aucun autre changement de comportement dans ces deux fichiers à cette tâche.

- [ ] **Step 6: Mettre à jour les assertions existantes que cette tâche change**

Lancer `pnpm --filter=web exec vitest run components/workflow`. Trois familles d'échecs sont attendues et se corrigent dans les tests, pas dans le code : (a) `removeState` ne reporte plus l'état de départ ; (b) `addStates` ne relie plus d'office un état quand le workflow a déjà des états ; (c) les objets produits par `fromDetail`, `statusOptions`, `optionToStatus` portent `server_name`, `shared_names`, `workflow_names`. Tout autre échec est une régression à corriger dans le code.

- [ ] **Step 7: Vérifier**

Run: `pnpm --filter=web exec vitest run components/workflow` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/editor`
Expected: tout passe, 0 erreur, 0 avertissement.

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/workflow.ts apps/web/components/workflow/editor
git commit -m "feat(web): add start link, duplicate and shared rename draft rules"
```

---

### Task 2: Textes en et fr, puis les 20 autres locales (spec 10, Y10)

**Files:**

- Modify: `packages/i18n/src/locales/*/workflow.json` (22 fichiers)

**Interfaces:**

- Consumes: rien.
- Produces: les clés ci-dessous, sous `workflows.`, identiques (mêmes paramètres ICU) dans les 22 locales.

- [ ] **Step 1: Lire le skill**

Lire `.claude/skills/translate/SKILL.md` en entier et l'appliquer à toute la tâche.

- [ ] **Step 2: Ajouter les clés nouvelles en `en` et `fr`**

Chaque ligne est `chemin sous workflows` : anglais / français. Les pluriels fr ont `one`, `many`, `other` (`many` égal à `other`).

```text
editor.add_transition.in_workflow: In this workflow / Dans ce workflow
editor.add_transition.other_states: Other existing states / Autres états existants
editor.add_transition.other_states_hint: Added to the diagram when selected. / Ajoutés au diagramme si cochés.
editor.add_transition.locked: Set to the selected state. / Fixé sur l’état sélectionné.
editor.add_transition.duplicate: This transition already exists. / Cette transition existe déjà.
editor.start_panel.title: Workflow start / Départ du workflow
editor.start_panel.field: Every new work item starts in the state / Tout nouveau ticket commence dans l’état
editor.start_panel.unlink: Remove the link / Retirer le lien
editor.errors.stale_graph: This workflow was changed in the meantime. Reload it. / Ce workflow a été modifié entre-temps. Rechargez-le.
editor.errors.duplicate_transition: Two transitions link the same states. / Deux transitions relient les mêmes états.
editor.reload: Reload / Recharger
editor.presence: {count, plural, one {{names} is also editing this workflow.} other {{names} are also editing this workflow.}} / {count, plural, one {{names} modifie aussi ce workflow.} many {{names} modifient aussi ce workflow.} other {{names} modifient aussi ce workflow.}}
editor.panel.shared_named: {count, plural, one {This state is also used in # other workflow: {names}. Renaming it or changing its color or category changes it there too.} other {This state is also used in # other workflows: {names}. Renaming it or changing its color or category changes it there too.}} / {count, plural, one {Cet état sert aussi dans # autre workflow : {names}. Le renommer ou changer sa couleur ou sa catégorie le modifie aussi.} many {Cet état sert aussi dans # autres workflows : {names}. Le renommer ou changer sa couleur ou sa catégorie les modifie aussi.} other {Cet état sert aussi dans # autres workflows : {names}. Le renommer ou changer sa couleur ou sa catégorie les modifie aussi.}}
editor.panel.more_names: {count, plural, one {{names} and # more} other {{names} and # more}} / {count, plural, one {{names} et # autre} many {{names} et # autres} other {{names} et # autres}}
editor.panel.incoming_count: Incoming transitions · {count} / Transitions entrantes · {count}
editor.panel.outgoing_count: Outgoing transitions · {count} / Transitions sortantes · {count}
editor.panel.add: Add / Ajouter
editor.panel.path: Path / Chemin
editor.panel.add_source: Add a source state / Ajouter un état de départ
editor.panel.rule: Rule / Règle
editor.panel.edit: Edit / Modifier
editor.panel.remove: Remove / Retirer
editor.panel.edit_rule: Edit the rule / Modifier la règle
editor.panel.remove_rule: Remove the rule / Retirer la règle
editor.restrict.summary_roles: Roles: {roles} / Rôles : {roles}
editor.restrict.summary_users: {count, plural, one {# person} other {# people}} / {count, plural, one {# personne} many {# personnes} other {# personnes}}
editor.rename.title: Rename everywhere? / Renommer partout ?
editor.rename.line: Renaming "{from}" to "{to}" also renames it in: {names}. / Renommer « {from} » en « {to} » le renomme aussi dans : {names}.
editor.rename.confirm: Rename everywhere / Renommer partout
editor.leave.title: Leave without saving? / Quitter sans enregistrer ?
editor.leave.body: The changes to this workflow are not saved. / Les changements de ce workflow ne sont pas enregistrés.
editor.leave.confirm: Leave without saving / Quitter sans enregistrer
editor.leave.stay: Stay / Rester
editor.a11y.node: Press Enter or Space to select a state. Use the arrow keys to move it and Delete to remove it. Press Escape to cancel. / Appuyez sur Entrée ou Espace pour sélectionner un état. Utilisez les flèches pour le déplacer et Suppr pour le retirer. Appuyez sur Échap pour annuler.
editor.a11y.node_read_only: Press Enter or Space to select a state. / Appuyez sur Entrée ou Espace pour sélectionner un état.
editor.a11y.edge: Press Enter or Space to select a transition. Press Delete to remove it or Escape to cancel. / Appuyez sur Entrée ou Espace pour sélectionner une transition. Appuyez sur Suppr pour la supprimer ou sur Échap pour annuler.
editor.a11y.moved: State moved. New position: x {x}, y {y}. / État déplacé. Nouvelle position : x {x}, y {y}.
editor.a11y.handle: Connection point / Point de connexion
scheme.add: Add a workflow / Ajouter un workflow
scheme.add_submit: Add / Ajouter
scheme.link_submit: Link / Relier
scheme.default_badge: default / par défaut
scheme.replace: Replace / Remplacer
scheme.replace_title: Replace the default workflow / Remplacer le workflow par défaut
scheme.edit_types: Edit types / Modifier les types
scheme.edit_types_named: Edit the types of {name} / Modifier les types de {name}
scheme.remove: Remove / Retirer
scheme.remove_named: Remove {name} / Retirer {name}
scheme.remove_title: Remove {name}? / Retirer {name} ?
scheme.remove_confirm: {count, plural, one {{types} will follow the default workflow {default}.} other {{types} will follow the default workflow {default}.}} / {count, plural, one {{types} suivra le workflow par défaut {default}.} many {{types} suivront le workflow par défaut {default}.} other {{types} suivront le workflow par défaut {default}.}}
scheme.types_field: Work item types concerned / Types de ticket concernés
scheme.link_note: It will apply to every work item type, including those created later. / Il s’appliquera à tous les types de ticket, y compris ceux créés plus tard.
scheme.taken_note: {count, plural, one {{types} is not listed: it already follows {workflow}.} other {{types} are not listed: they already follow {workflow}.}} / {count, plural, one {{types} n’apparaît pas : il suit déjà {workflow}.} many {{types} n’apparaissent pas : ils suivent déjà {workflow}.} other {{types} n’apparaissent pas : ils suivent déjà {workflow}.}}
scheme.unchecked_note: An unchecked type stays on the default workflow. / Un type non coché reste sur le workflow par défaut.
scheme.no_workflow: Every workflow of the workspace is already in the table. / Tous les workflows du workspace sont déjà dans le tableau.
scheme.no_type: Every work item type already follows a workflow of its own. / Tous les types de ticket suivent déjà un workflow particulier.
```

- [ ] **Step 3: Changer la valeur de six clés existantes en `en` et `fr`**

Les paramètres ne changent pas (aucune de ces clés n'en a).

```text
editor.errors.initial_state_required: Link START to a state. / Reliez DÉMARRER à un état.
editor.panel.set_initial: Set as start state / Définir comme état de départ
editor.panel.initial: Start state of the workflow / État de départ du workflow
editor.panel.remove_state: Remove from workflow / Retirer du workflow
editor.panel.remove_transition: Delete transition / Supprimer la transition
editor.panel.color: Column color / Couleur de colonne
```

Dans chaque locale, le mot « START » de `initial_state_required` est la valeur de `editor.start` de cette même locale.

- [ ] **Step 4: Traduire dans les 20 autres locales**

Avec le skill `translate` : les clés de l'étape 2 et les six valeurs de l'étape 3. Registre formel, mêmes paramètres ICU que l'anglais, catégories de pluriel de chaque langue selon le skill. Ne toucher à aucune autre clé.

- [ ] **Step 5: Vérifier**

Run: `pnpm --filter=@plane/i18n sync:check` puis `pnpm exec oxfmt --check packages/i18n/src/locales` puis `grep -rlP '\x{2014}' packages/i18n/src/locales/*/workflow.json | grep -v '^packages/i18n/src/locales/ru/'`
Expected: synchronisation OK ; format OK ; la recherche de tiret cadratin ne renvoie rien (le fichier `ru` en contient un, antérieur, sur une ligne que cette tâche ne touche pas : vérifier par `git diff` qu'aucune ligne ajoutée n'en contient).

- [ ] **Step 6: Commit**

```bash
git add packages/i18n/src/locales
git commit -m "feat(i18n): add the texts of the second workflow redesign"
```

Dans le rapport : lister les langues dont la traduction est la moins sûre, pour la mention `machine_translated` de la PR.

---

### Task 3: Fenêtre « Ajouter une transition » (spec 4.1 ; D1, D2 ; CA-1 à CA-4)

Après cette tâche, le coordinateur prévient l'utilisateur que D1 est à tester.

**Files:**

- Rewrite: `apps/web/components/workflow/editor/add-transition-dialog.tsx`
- Rewrite: `apps/web/components/workflow/editor/add-transition-dialog.test.tsx`
- Modify: `apps/web/components/workflow/editor/workflow-editor.tsx`, `workflow-editor.test.tsx`
- Modify: `apps/web/components/workflow/editor/side-panel.tsx`, `side-panel.test.tsx` (type du rappel `onAddTransition` seulement)

**Interfaces:**

- Consumes (tâche 1) : `isDuplicateRoute`, `stateName`, `addTransitionWithStates`, `optionToStatus`, `statusOptions`, `type TStateRef`, `type TStatusOption`, `type TDraftGraph`. Clés i18n de la tâche 2.
- Produces (exportés de `add-transition-dialog.tsx`) :
  - `type TTransitionLock = { side: "source" | "target"; key: string }`
  - `type TStateChoice = { kind: "state"; key: string } | { kind: "option"; option: TStatusOption }`
  - `type TTransitionChoice = { name: string; from_any: boolean; sources: TStateChoice[]; target: TStateChoice }`
  - `AddTransitionDialog` : props `{ isOpen: boolean; draft: TDraftGraph; options: TStatusOption[]; lock: TTransitionLock | null; onClose: () => void; onAdd: (choice: TTransitionChoice) => void }`
  - `WorkflowSidePanel` : `onAddTransition: (lock: TTransitionLock) => void`

- [ ] **Step 1: Écrire les tests de la fenêtre**

Remplacer le contenu de `add-transition-dialog.test.tsx` (garder l'en-tête COPYRIGHT) :

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddTransitionDialog, type TTransitionLock } from "./add-transition-dialog";
import type { TDraftGraph, TStatusOption } from "./graph-model";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const state = (key: string, name: string, isInitial = false) => ({
  key,
  status: { name, color: "#3A3A3A", group: null, shared_count: 0 },
  position_x: 0,
  position_y: 0,
  is_initial: isInitial,
});
const draft: TDraftGraph = {
  states: [state("a", "Alpha", true), state("b", "Beta"), state("c", "Gamma")],
  transitions: [{ key: "t1", name: "", from_any: false, source_keys: ["a"], target_key: "b", rules: [], sides: {} }],
};
const option = (name: string, id?: string): TStatusOption => ({
  ...(id ? { id } : {}),
  name,
  color: "#333333",
  group: "started",
  group_is_auto: false,
  workflow_count: 0,
  workflow_names: [],
});
const options = [option("Review", "s9"), option("Shipped")];

const PREFIX = "workflows.editor.add_transition";
const SUBMIT = `${PREFIX}.submit`;
const ANY = `${PREFIX}.any_state`;
const SOURCES = `${PREFIX}.sources`;
const TARGET = `${PREFIX}.target`;
const IN_WORKFLOW = `${PREFIX}.in_workflow`;
const OTHERS = `${PREFIX}.other_states`;

// An optgroup also has the group role: the fieldset is the one that holds the checkboxes.
const fieldsetOf = (name: string) =>
  screen.getAllByRole("group", { name }).find((element) => element.tagName === "FIELDSET") as HTMLElement;
const checkboxNames = (name: string) =>
  within(fieldsetOf(name))
    .getAllByRole("checkbox")
    .map((box) => box.closest("label")?.textContent);
const submit = () => screen.getByRole("button", { name: SUBMIT }) as HTMLButtonElement;

const open = (lock: TTransitionLock | null = null) => {
  const onAdd = vi.fn();
  render(<AddTransitionDialog isOpen draft={draft} options={options} lock={lock} onClose={() => {}} onAdd={onAdd} />);
  return { onAdd, user: userEvent.setup() };
};

describe("AddTransitionDialog", () => {
  it("offers the states of the workflow, then the other existing states", () => {
    open();
    expect(checkboxNames(IN_WORKFLOW)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(checkboxNames(OTHERS)).toEqual(["Review", "Shipped"]);
    const target = screen.getByRole("combobox", { name: TARGET });
    expect(
      within(target)
        .getAllByRole("option")
        .map((item) => item.textContent)
    ).toEqual([`${PREFIX}.choose_state`, "Alpha", "Beta", "Gamma", "Review", "Shipped"]);
  });

  it("opens empty from the header", () => {
    open();
    expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect((screen.getByRole("combobox", { name: TARGET }) as HTMLSelectElement).value).toBe("");
    expect(submit().disabled).toBe(true);
  });

  it("returns states of both groups", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Review" }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Shipped");
    await user.click(submit());
    expect(onAdd).toHaveBeenCalledWith({
      name: "",
      from_any: false,
      sources: [
        { kind: "state", key: "a" },
        { kind: "option", option: options[0] },
      ],
      target: { kind: "option", option: options[1] },
    });
  });

  it("locks the target when it is opened for an incoming transition", async () => {
    const { onAdd, user } = open({ side: "target", key: "b" });
    expect(screen.queryByRole("combobox", { name: TARGET })).toBeNull();
    const locked = screen.getByRole("textbox", { name: TARGET }) as HTMLInputElement;
    expect(locked.value).toBe("Beta");
    expect(locked.disabled).toBe(true);
    expect(screen.getByText(`${PREFIX}.locked`)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Gamma" }));
    await user.click(submit());
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      sources: [{ kind: "state", key: "c" }],
      target: { kind: "state", key: "b" },
    });
  });

  it("locks the source when it is opened for an outgoing transition", async () => {
    const { onAdd, user } = open({ side: "source", key: "a" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect((screen.getByRole("textbox", { name: SOURCES }) as HTMLInputElement).value).toBe("Alpha");
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Gamma");
    await user.click(submit());
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      from_any: false,
      sources: [{ kind: "state", key: "a" }],
      target: { kind: "state", key: "c" },
    });
  });

  it("refuses a transition that already exists", async () => {
    const { user } = open();
    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Beta");
    expect(screen.getByRole("alert").textContent).toBe(`${PREFIX}.duplicate`);
    expect(submit().disabled).toBe(true);
  });

  it("removes a state from the sources when it becomes the target", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Gamma" }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Alpha");
    expect((screen.getByRole("checkbox", { name: "Alpha" }) as HTMLInputElement).disabled).toBe(true);
    await user.click(submit());
    expect(onAdd.mock.calls[0][0].sources).toEqual([{ kind: "state", key: "c" }]);
  });

  it("ignores the checked sources of a transition from any state", async () => {
    const { onAdd, user } = open();
    await user.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: ANY }));
    await user.selectOptions(screen.getByRole("combobox", { name: TARGET }), "Gamma");
    await user.click(submit());
    expect(onAdd.mock.calls[0][0]).toMatchObject({ from_any: true, sources: [] });
  });
});
```

- [ ] **Step 2: Lancer, constater l'échec**

Run: `pnpm --filter=web exec vitest run components/workflow/editor/add-transition-dialog.test.tsx`
Expected: FAIL (la fenêtre ne reçoit ni `options` ni `lock`, pas de groupes).

- [ ] **Step 3: Réécrire `add-transition-dialog.tsx`**

Garder l'en-tête COPYRIGHT et les imports de `Dialog*`, `Button`, `InputField` du fichier actuel. Corps :

```tsx
import { LockOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// local imports
import { isDuplicateRoute, stateName, type TDraftGraph, type TStatusOption } from "./graph-model";

export type TTransitionLock = { side: "source" | "target"; key: string };
export type TStateChoice = { kind: "state"; key: string } | { kind: "option"; option: TStatusOption };
export type TTransitionChoice = { name: string; from_any: boolean; sources: TStateChoice[]; target: TStateChoice };

type Props = {
  isOpen: boolean;
  draft: TDraftGraph;
  /** Other existing states: workspace statuses and project states that are not in the workflow (D1). */
  options: TStatusOption[];
  /** Set when the dialog is opened from a state: that side cannot be changed (D2). */
  lock: TTransitionLock | null;
  onClose: () => void;
  onAdd: (choice: TTransitionChoice) => void;
};

// Values of the two lists: a state of the draft by its key, another existing state by its index.
const STATE = "state:";
const OPTION = "option:";
const PREFIX = "workflows.editor.add_transition";
const LABEL_CLASS = "text-body-xs-medium text-secondary";
const FIELD_CLASS = "rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular";
const CHECK_CLASS = "flex items-center gap-2 text-body-sm-regular text-primary max-md:min-h-11";
const HINT_CLASS = "text-caption-sm-regular text-tertiary";

export function AddTransitionDialog({ isOpen, draft, options, lock, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  const [fromAny, setFromAny] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const lockSide = lock?.side;
  const lockKey = lock?.key;

  useEffect(() => {
    if (!isOpen) return;
    setFromAny(false);
    setSources(lockSide === "source" && lockKey ? [`${STATE}${lockKey}`] : []);
    setTarget(lockSide === "target" && lockKey ? `${STATE}${lockKey}` : "");
    setName("");
  }, [isOpen, lockSide, lockKey]);

  const groups = [
    {
      label: t(`${PREFIX}.in_workflow`),
      entries: draft.states.map((state) => ({ value: `${STATE}${state.key}`, name: state.status.name })),
    },
    {
      label: t(`${PREFIX}.other_states`),
      hint: t(`${PREFIX}.other_states_hint`),
      entries: options.map((option, index) => ({ value: `${OPTION}${index}`, name: option.name })),
    },
  ].filter((group) => group.entries.length > 0);

  const toChoice = (value: string): TStateChoice =>
    value.startsWith(STATE)
      ? { kind: "state", key: value.slice(STATE.length) }
      : { kind: "option", option: options[Number(value.slice(OPTION.length))] };
  const stateKeys = (values: string[]) =>
    values.flatMap((value) => (value.startsWith(STATE) ? [value.slice(STATE.length)] : []));
  // Only a route between states already in the workflow can exist twice.
  const isDuplicate =
    target.startsWith(STATE) &&
    isDuplicateRoute(draft, {
      from_any: fromAny,
      source_keys: fromAny ? [] : stateKeys(sources),
      target_key: target.slice(STATE.length),
    });
  const isValid = target !== "" && (fromAny || sources.length > 0) && !sources.includes(target) && !isDuplicate;

  const lockedField = (labelKey: string, stateKey: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor="workflow-transition-locked" className={LABEL_CLASS}>
        {t(labelKey)}
      </label>
      <input
        id="workflow-transition-locked"
        type="text"
        disabled
        readOnly
        value={stateName(draft, stateKey)}
        aria-describedby="workflow-transition-locked-note"
        className={`${FIELD_CLASS} bg-layer-2 text-tertiary`}
      />
      <p id="workflow-transition-locked-note" className={`flex items-center gap-1 ${HINT_CLASS}`}>
        <LockOutline className="size-3" aria-hidden />
        {t(`${PREFIX}.locked`)}
      </p>
    </div>
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
            if (!isValid) return;
            onAdd({
              name: name.trim(),
              from_any: fromAny,
              sources: fromAny ? [] : sources.map(toChoice),
              target: toChoice(target),
            });
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t(`${PREFIX}.title`)}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-4">
                {lockSide === "source" && lockKey ? (
                  lockedField(`${PREFIX}.sources`, lockKey)
                ) : (
                  <fieldset className="space-y-2">
                    <legend className={LABEL_CLASS}>{t(`${PREFIX}.sources`)}</legend>
                    <label className={CHECK_CLASS}>
                      <input type="checkbox" checked={fromAny} onChange={(event) => setFromAny(event.target.checked)} />
                      {t(`${PREFIX}.any_state`)}
                    </label>
                    {groups.map((group) => (
                      <fieldset key={group.label} className="space-y-1">
                        <legend className="text-caption-sm-medium text-secondary">{group.label}</legend>
                        {group.hint && <p className={HINT_CLASS}>{group.hint}</p>}
                        {group.entries.map((entry) => (
                          <label key={entry.value} className={CHECK_CLASS}>
                            <input
                              type="checkbox"
                              disabled={fromAny || entry.value === target}
                              checked={!fromAny && sources.includes(entry.value)}
                              onChange={() =>
                                setSources((current) =>
                                  current.includes(entry.value)
                                    ? current.filter((value) => value !== entry.value)
                                    : [...current, entry.value]
                                )
                              }
                            />
                            {entry.name}
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </fieldset>
                )}
                {lockSide === "target" && lockKey ? (
                  lockedField(`${PREFIX}.target`, lockKey)
                ) : (
                  <label className={`flex flex-col gap-1 ${LABEL_CLASS}`}>
                    {t(`${PREFIX}.target`)}
                    <select
                      className={FIELD_CLASS}
                      value={target}
                      onChange={(event) => {
                        setTarget(event.target.value);
                        setSources((current) => current.filter((value) => value !== event.target.value));
                      }}
                    >
                      <option value="" disabled>
                        {t(`${PREFIX}.choose_state`)}
                      </option>
                      {groups.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.entries.map((entry) => (
                            <option key={entry.value} value={entry.value}>
                              {entry.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                )}
                {isDuplicate && (
                  <p role="alert" className="text-body-sm-regular text-danger-primary">
                    {t(`${PREFIX}.duplicate`)}
                  </p>
                )}
                <InputField
                  size="md"
                  orientation="vertical"
                  id="workflow-transition-new-name"
                  name="transition-name"
                  type="text"
                  maxLength={255}
                  label={t(`${PREFIX}.name`)}
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
              label={t(`${PREFIX}.submit`)}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Run: `pnpm --filter=web exec vitest run components/workflow/editor/add-transition-dialog.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 4: Écrire les tests de câblage de l'éditeur**

Ajouter dans `workflow-editor.test.tsx` (dans le `describe` existant) :

```tsx
it("adds a transition towards a state taken from the other existing states", async () => {
  const onSave = vi.fn(async (_payload: TWorkflowGraphPayload) => workflow);
  renderEditor({ onSave });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "workflows.editor.add_transition.title" }));
  await user.click(screen.getByRole("checkbox", { name: "Todo" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "workflows.editor.add_transition.target" }), "Review");
  await user.click(screen.getByRole("button", { name: "workflows.editor.add_transition.submit" }));
  await waitFor(() => expect(screen.getAllByText("Review").length).toBeGreaterThan(0));
  await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
  const payload = onSave.mock.calls[0][0];
  expect(payload.states.map((item) => item.status.name)).toEqual(["Todo", "Done", "Review"]);
  expect(payload.states[2].is_initial).toBe(false);
  expect(payload.transitions[1]).toMatchObject({
    from_any: false,
    source_keys: ["a"],
    target_key: payload.states[2].key,
  });
});

it("locks the target of a transition added from the panel of a state", async () => {
  renderEditor();
  const user = userEvent.setup();
  fireEvent.click(screen.getByText("Done"));
  await user.click(screen.getByRole("button", { name: "workflows.editor.panel.add_incoming" }));
  const locked = screen.getByRole("textbox", { name: "workflows.editor.add_transition.target" }) as HTMLInputElement;
  expect(locked.value).toBe("Done");
  expect(locked.disabled).toBe(true);
});
```

Run: `pnpm --filter=web exec vitest run components/workflow/editor/workflow-editor.test.tsx`
Expected: FAIL sur ces deux tests (et erreurs de types sur `preset`).

- [ ] **Step 5: Câbler l'éditeur et le panneau**

Dans `workflow-editor.tsx` :

- imports : `AddTransitionDialog, type TStateChoice, type TTransitionLock` ; de `./graph-model` ajouter `addTransitionWithStates`, `optionToStatus`, `type TStateRef` ; retirer `addTransition` s'il n'est plus utilisé.
- supprimer `type TPreset` ; `type TDialog = { kind: "state" } | { kind: "transition"; lock: TTransitionLock | null } | { kind: "rule" } | null;`
- en-tête : `onAddTransition={() => setDialog({ kind: "transition", lock: null })}`
- panneau : `onAddTransition={(lock) => setDialog({ kind: "transition", lock })}`
- fenêtre :

```tsx
<AddTransitionDialog
  isOpen={dialog?.kind === "transition"}
  draft={draft}
  options={options}
  lock={dialog?.kind === "transition" ? dialog.lock : null}
  onClose={() => setDialog(null)}
  onAdd={(choice) => {
    // Keys are made here, outside the state updater, so a replayed updater gives the same draft.
    const toRef = (item: TStateChoice): TStateRef =>
      item.kind === "state" ? item : { kind: "new", key: `new-${uuidv4()}`, status: optionToStatus(item.option) };
    const input = {
      key: `new-${uuidv4()}`,
      name: choice.name,
      from_any: choice.from_any,
      sources: choice.sources.map(toRef),
      target: toRef(choice.target),
    };
    setDraft((current) => addTransitionWithStates(current, input));
    setSelection({ kind: "transition", key: input.key });
    setDialog(null);
  }}
/>
```

Dans `side-panel.tsx` : `onAddTransition: (lock: TTransitionLock) => void;` (import du type depuis `./add-transition-dialog`) ; dans le tableau des deux lignes, remplacer `{ targetKey: state.key }` par `{ side: "target", key: state.key }` et `{ sourceKey: state.key }` par `{ side: "source", key: state.key }`. Adapter dans `side-panel.test.tsx` toute assertion qui lisait l'ancien objet.

- [ ] **Step 6: Vérifier**

Run: `pnpm --filter=web exec vitest run components/workflow` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/editor`
Expected: tout passe.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/workflow/editor
git commit -m "feat(web): pick any existing state in the add transition dialog"
```

---

### Task 4: Lien DÉMARRER sélectionnable et supprimable (spec 4.2, 4.3 ; D3, E5 ; CA-5, CA-6, CA-8, CA-12)

**Files:**

- Modify: `apps/web/components/workflow/editor/workflow-canvas.tsx`, `start-node.tsx`, `workflow-canvas.test.tsx`
- Create: `apps/web/components/workflow/editor/start-panel.tsx`, `start-panel.test.tsx`
- Modify: `apps/web/components/workflow/editor/side-panel.tsx`, `workflow-editor.tsx`, `workflow-editor.test.tsx`

**Interfaces:**

- Consumes (tâche 1) : `clearInitial`, `setInitial`, `startPlacement`, `errorTarget`, `TSelectionTarget`, `TEditorSelection`.
- Produces :
  - `WorkflowCanvas` reçoit la prop `onClearInitial: () => void`
  - `StartPanel` (exporté de `start-panel.tsx`) : props `{ draft: TDraftGraph; canEdit: boolean; onChange: (draft: TDraftGraph) => void }`
  - la sélection `{ kind: "start" }` ouvre le panneau « Départ du workflow »

- [ ] **Step 1: Écrire les tests du panneau de départ**

Créer `start-panel.test.tsx` (en-tête COPYRIGHT) :

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TDraftGraph } from "./graph-model";
import { StartPanel } from "./start-panel";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const state = (key: string, name: string, isInitial = false) => ({
  key,
  status: { name, color: "#3A3A3A", group: null, shared_count: 0 },
  position_x: 0,
  position_y: 0,
  is_initial: isInitial,
});
const linked: TDraftGraph = { states: [state("a", "Todo", true), state("b", "Done")], transitions: [] };
const unlinked: TDraftGraph = { states: [state("a", "Todo"), state("b", "Done")], transitions: [] };
const FIELD = "workflows.editor.start_panel.field";
const UNLINK = "workflows.editor.start_panel.unlink";
const REQUIRED = "workflows.editor.errors.initial_state_required";

describe("StartPanel", () => {
  it("shows the start state and moves the link to another one", async () => {
    const onChange = vi.fn();
    render(<StartPanel draft={linked} canEdit onChange={onChange} />);
    expect((screen.getByRole("combobox", { name: FIELD }) as HTMLSelectElement).value).toBe("a");
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: FIELD }), "Done");
    expect(onChange.mock.calls[0][0].states.map((item: { is_initial: boolean }) => item.is_initial)).toEqual([
      false,
      true,
    ]);
  });

  it("removes the link", async () => {
    const onChange = vi.fn();
    render(<StartPanel draft={linked} canEdit onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("button", { name: UNLINK }));
    expect(onChange.mock.calls[0][0].states.some((item: { is_initial: boolean }) => item.is_initial)).toBe(false);
  });

  it("asks for a link when there is none, with nothing to remove", () => {
    render(<StartPanel draft={unlinked} canEdit onChange={() => {}} />);
    expect((screen.getByRole("combobox", { name: FIELD }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(REQUIRED)).toBeTruthy();
    expect(screen.queryByRole("button", { name: UNLINK })).toBeNull();
  });

  it("offers no action to a reader", () => {
    render(<StartPanel draft={linked} canEdit={false} onChange={() => {}} />);
    expect((screen.getByRole("combobox", { name: FIELD }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: UNLINK })).toBeNull();
  });
});
```

Run: `pnpm --filter=web exec vitest run components/workflow/editor/start-panel.test.tsx`
Expected: FAIL (module absent).

- [ ] **Step 2: Créer `start-panel.tsx`**

```tsx
import { Button } from "@makeplane/propel/components/button";
import { useTranslation } from "@plane/i18n";
// local imports
import { clearInitial, setInitial, type TDraftGraph } from "./graph-model";

type Props = { draft: TDraftGraph; canEdit: boolean; onChange: (draft: TDraftGraph) => void };

/** Panel of the start link (spec 4.3): the state every new work item starts in. */
export function StartPanel({ draft, canEdit, onChange }: Props) {
  const { t } = useTranslation();
  const initial = draft.states.find((state) => state.is_initial);

  return (
    <fieldset className="flex flex-1 flex-col gap-4" disabled={!canEdit}>
      <label className="flex flex-col gap-1 text-body-xs-medium text-secondary">
        {t("workflows.editor.start_panel.field")}
        <select
          className="rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular max-md:min-h-11"
          value={initial?.key ?? ""}
          onChange={(event) => onChange(setInitial(draft, event.target.value))}
        >
          <option value="" disabled>
            {t("workflows.editor.add_transition.choose_state")}
          </option>
          {draft.states.map((state) => (
            <option key={state.key} value={state.key}>
              {state.status.name}
            </option>
          ))}
        </select>
      </label>
      {/* No alert role: the editor banner already announces it. */}
      {!initial && draft.states.length > 0 && (
        <p className="text-body-sm-regular text-danger-primary">
          {t("workflows.editor.errors.initial_state_required")}
        </p>
      )}
      {canEdit && initial && (
        <div className="mt-auto border-t border-subtle pt-4">
          <Button
            variant="danger-outline"
            size="sm"
            stretch="auto"
            label={t("workflows.editor.start_panel.unlink")}
            onClick={() => onChange(clearInitial(draft))}
          />
        </div>
      )}
    </fieldset>
  );
}
```

Run: le test de l'étape 1. Expected: PASS (4 tests).

- [ ] **Step 3: Écrire les tests du diagramme**

Ajouter dans `workflow-canvas.test.tsx` (le fichier a déjà `renderCanvas`, `flowProps`, `draft` ; ajouter `act` à l'import de `@testing-library/react` ; si `renderCanvas` énumère les props, y ajouter `onClearInitial={noop}`) :

```tsx
const START_EDGE = "__start_edge__";
const startEdge = () => flowProps.current?.edges?.find((edge) => edge.id === START_EDGE);

describe("start link", () => {
  it("selects the start from its node", () => {
    const onSelect = vi.fn();
    renderCanvas({ onSelect });
    fireEvent.click(screen.getByText("workflows.editor.start"));
    expect(onSelect).toHaveBeenCalledWith({ kind: "start" });
  });

  it("shows the start arrow as selected, and removable by who can edit", () => {
    renderCanvas({ selection: { kind: "start" } });
    expect(startEdge()).toMatchObject({ selected: true, deletable: true });
  });

  it("lets a reader select the start arrow but not remove it", () => {
    renderCanvas({ canEdit: false });
    expect(startEdge()).toMatchObject({ deletable: false });
    expect(startEdge()?.selectable).not.toBe(false);
  });

  it("removes the link when the start arrow is deleted", () => {
    const onClearInitial = vi.fn();
    const onRemoveTransition = vi.fn();
    renderCanvas({ onClearInitial, onRemoveTransition });
    const edge = startEdge();
    act(() => flowProps.current?.onDelete?.({ nodes: [], edges: edge ? [edge] : [] }));
    expect(onClearInitial).toHaveBeenCalledTimes(1);
    expect(onRemoveTransition).not.toHaveBeenCalled();
  });

  it("leaves the link to the state removal when the start state itself is deleted", () => {
    const onClearInitial = vi.fn();
    const onRemoveState = vi.fn();
    renderCanvas({ onClearInitial, onRemoveState });
    const edge = startEdge();
    const node = flowProps.current?.nodes?.find((item) => item.id === "a");
    act(() => flowProps.current?.onDelete?.({ nodes: node ? [node] : [], edges: edge ? [edge] : [] }));
    expect(onRemoveState).toHaveBeenCalledWith("a");
    expect(onClearInitial).not.toHaveBeenCalled();
  });

  it("keeps the start node, without an arrow, when nothing is linked", () => {
    const unlinked = { ...draft, states: draft.states.map((item) => ({ ...item, is_initial: false })) };
    renderCanvas({ draft: unlinked });
    expect(startEdge()).toBeUndefined();
    expect(screen.getByText("workflows.editor.start")).toBeTruthy();
  });
});
```

Run: `pnpm --filter=web exec vitest run components/workflow/editor/workflow-canvas.test.tsx`
Expected: FAIL sur ces six tests.

- [ ] **Step 4: Modifier le diagramme**

`start-node.tsx` : le nœud montre sa sélection.

```tsx
export function WorkflowStartNode({ data, selected }: NodeProps<TStartNode>) {
  return (
    <div
      className={`flex size-20 items-center justify-center rounded-full text-caption-sm-medium ${INVERSE_CLASS} ${selected ? "ring-2 ring-accent-strong ring-offset-2" : ""}`}
    >
```

`workflow-canvas.tsx` :

- props : ajouter `onClearInitial: () => void;` (type et déstructuration).
- nœud DÉMARRER : retirer `selectable: false` et `focusable: false` ; ajouter `selected: selection?.kind === "start",` ; remplacer `ariaLabel` par `t("workflows.editor.start_panel.title")` ; remplacer le commentaire par `// Selecting it opens the start panel, the only way in once the link is removed (E5).`
- flèche de DÉMARRER : retirer `selectable: false` et `focusable: false` ; remplacer `...ARROW,` par `...(selection?.kind === "start" ? SELECTED_ARROW : ARROW),` ; ajouter `selected: selection?.kind === "start",` ; remplacer `deletable: false` par `deletable: canEdit,`.
- `onNodesChange` : remplacer la recherche de `picked` et son usage par :

```tsx
const picked = changes.find((change) => change.type === "select" && change.selected);
if (picked && picked.type === "select") {
  if (picked.id === START_NODE_ID) {
    if (selection?.kind !== "start") onSelect({ kind: "start" });
  } else if (!(selection?.kind === "state" && selection.key === picked.id)) onSelect({ kind: "state", key: picked.id });
}
```

- `onEdgesChange` :

```tsx
const picked = changes.find((change) => change.type === "select" && change.selected);
if (picked && picked.type === "select")
  onSelect(picked.id === START_EDGE_ID ? { kind: "start" } : { kind: "transition", key: picked.id.split(":")[0] });
```

- `onNodeClick` : remplacer `if (node.id === START_NODE_ID) return;` par `if (node.id === START_NODE_ID) return onSelect({ kind: "start" });`
- `onEdgeClick` : ajouter en première ligne `if (edge.id === START_EDGE_ID) return onSelect({ kind: "start" });`
- `onDelete` : ajouter après la boucle des transitions :

```tsx
// The start arrow of a removed start state goes with it (removeState); alone, it is the link.
if (deletedEdges.some((edge) => edge.id === START_EDGE_ID && !removed.has(edge.target))) onClearInitial();
```

Vérifier dans `apps/web/node_modules/@xyflow/react/dist/esm/types/` que `selected`, `selectable`, `focusable`, `deletable` existent sur `Node` et `Edge` (ils existent en 12.12.0) ; si un nom diffère, garder le comportement.

Run: le test de l'étape 3. Expected: PASS.

- [ ] **Step 5: Écrire le test de l'éditeur**

Ajouter dans `workflow-editor.test.tsx` :

```tsx
it("blocks the save until the start is linked again", async () => {
  renderEditor();
  const user = userEvent.setup();
  const save = () => screen.getByRole("button", { name: "workflows.editor.save" }) as HTMLButtonElement;
  fireEvent.click(screen.getByText("workflows.editor.start"));
  await user.click(screen.getByRole("button", { name: "workflows.editor.start_panel.unlink" }));
  const banner = screen.getByRole("alert");
  expect(within(banner).getByRole("button", { name: "workflows.editor.errors.initial_state_required" })).toBeTruthy();
  expect(save().disabled).toBe(true);
  await user.selectOptions(screen.getByRole("combobox", { name: "workflows.editor.start_panel.field" }), "Done");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(save().disabled).toBe(false);
});

it("opens the start panel from the banner line", async () => {
  renderEditor();
  const user = userEvent.setup();
  fireEvent.click(screen.getByText("workflows.editor.start"));
  await user.click(screen.getByRole("button", { name: "workflows.editor.start_panel.unlink" }));
  fireEvent.click(screen.getByText("Todo"));
  await user.click(screen.getByRole("button", { name: "workflows.editor.errors.initial_state_required" }));
  expect(screen.getByRole("combobox", { name: "workflows.editor.start_panel.field" })).toBeTruthy();
});
```

Run: Expected: FAIL (pas de panneau de départ).

- [ ] **Step 6: Câbler le panneau et l'éditeur**

`side-panel.tsx` : importer `StartPanel` ; après le calcul de `transition` ajouter `const isStart = selection?.kind === "start";` ; le titre devient :

```tsx
const title = isStart
  ? "workflows.editor.start_panel.title"
  : state
    ? "workflows.editor.panel.state"
    : "workflows.editor.panel.transition";
```

remplacer chaque `state || transition` de la classe de l'`aside`, de son `aria-label` et de la condition du `h2` par `state || transition || isStart` ; l'état vide devient `{!state && !transition && !isStart && (...)}` ; ajouter après ce bloc `{isStart && <StartPanel draft={draft} canEdit={canEdit} onChange={onChange} />}`.

`workflow-editor.tsx` : importer `clearInitial` ; passer au diagramme `onClearInitial={() => setDraft((current) => clearInitial(current))}`.

- [ ] **Step 7: Vérifier**

Run: `pnpm --filter=web exec vitest run components/workflow` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/editor`
Expected: tout passe.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/workflow/editor
git commit -m "feat(web): make the start link selectable, removable and required"
```

---

### Task 5: Serveur, lectures : workflows d'un statut, invités exclus (spec 6.3, 6.6 ; D12, O7)

**Files:**

- Modify: `apps/api/plane/app/serializers/workflow.py`, `apps/api/plane/app/views/workflow/base.py`
- Modify: `apps/api/plane/tests/contract/app/test_workflows_app.py`

**Interfaces:**

- Consumes: rien.
- Produces : `GET /api/workspaces/<slug>/workflow-statuses/` renvoie pour chaque statut `workflows: [{ "id": str, "name": str }]` trié par nom ; `GET workflows/`, `GET workflows/<id>/` et `GET workflow-statuses/` répondent 403 à un invité.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `test_workflows_app.py`, classe `TestRead` : renommer `test_every_member_reads_workflows_and_statuses` en `test_admins_and_members_read_workflows_and_statuses` et réduire son paramétrage à `["admin", "member"]` ; ajouter :

```python
    def test_guests_read_neither_workflows_nor_statuses(self, workspace, users, software):
        client = _client(users["guest"])
        for url in (
            WORKFLOWS_URL.format(slug=workspace.slug),
            WORKFLOW_URL.format(slug=workspace.slug, pk=software.id),
            STATUSES_URL.format(slug=workspace.slug),
        ):
            assert client.get(url).status_code == status.HTTP_403_FORBIDDEN

    def test_a_status_names_the_workflows_that_use_it(self, workspace, users, software):
        build_workflow(workspace, "Bug", ["To do", "Fixed"])
        WorkflowStatus.objects.create(workspace=workspace, name="Unused", color="#3A3A3A")
        response = _client(users["member"]).get(STATUSES_URL.format(slug=workspace.slug))
        by_name = {item["name"]: item for item in response.data}
        assert [item["name"] for item in by_name["To do"]["workflows"]] == ["Bug", "Software"]
        assert by_name["Done"]["workflows"] == [{"id": str(software.id), "name": "Software"}]
        assert by_name["Unused"]["workflows"] == []
        assert by_name["To do"]["workflow_count"] == 2
```

Run: `docker compose -p wfr2-t5 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -v -k "TestRead"`
Expected: les deux nouveaux tests FAIL (200 pour l'invité, `KeyError: 'workflows'`).

- [ ] **Step 2: Implémenter**

`serializers/workflow.py`, `WorkflowStatusSerializer` :

```python
class WorkflowStatusSerializer(BaseSerializer):
    workflow_count = serializers.IntegerField(read_only=True)
    workflows = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowStatus
        fields = ["id", "name", "color", "group", "group_is_auto", "sequence", "workflow_count", "workflows"]
        read_only_fields = fields

    def get_workflows(self, obj):
        # Read from the prefetch of the view: one query for every status.
        return [{"id": str(state.workflow_id), "name": state.workflow.name} for state in obj.workflow_states.all()]
```

`views/workflow/base.py` : `from django.db.models import Count, Prefetch` ; dans `WorkflowStatusEndpoint.get`, les rôles deviennent `[ROLE.ADMIN, ROLE.MEMBER]` avec, au-dessus du décorateur, le commentaire `# Guests are outside accounts: workflows carry state names of projects they cannot see (spec 6.6).` ; la requête devient :

```python
        statuses = (
            WorkflowStatus.objects.filter(workspace__slug=slug)
            .annotate(workflow_count=Count("workflow_states"))
            .prefetch_related(
                Prefetch(
                    "workflow_states",
                    queryset=WorkflowState.objects.select_related("workflow").order_by("workflow__name"),
                )
            )
        )
```

Dans `WorkflowEndpoint.get`, les rôles deviennent `[ROLE.ADMIN, ROLE.MEMBER]`. Ne pas toucher aux routes du système d'un projet.

- [ ] **Step 3: Lancer tous les tests de workflows**

Run: `docker compose -p wfr2-t5 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests -k workflow -q` puis `docker compose -p wfr2-t5 -f docker-compose-test.yml down -v`
Expected: tout passe. Un autre test qui lisait ces trois routes avec un invité est à adapter (l'invité reçoit 403) : le signaler dans le rapport.

- [ ] **Step 4: Lint**

Run: `docker compose -p wfr2-t5 -f docker-compose-test.yml run --rm --no-deps api-tests ruff check plane/app/serializers/workflow.py plane/app/views/workflow/base.py plane/tests/contract/app/test_workflows_app.py` puis la même commande avec `ruff format --check`, puis `down -v`.
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add apps/api/plane/app/serializers/workflow.py apps/api/plane/app/views/workflow/base.py apps/api/plane/tests/contract/app/test_workflows_app.py
git commit -m "feat(api): name the workflows of a status, keep guests out of reads"
```

---

### Task 6: Panneau droit redessiné (spec 4.3, 4.5 ; D5, D12, E6, E9 ; CA-9 à CA-11, CA-14)

**Files:**

- Rewrite: `apps/web/components/workflow/editor/side-panel.tsx`
- Modify: `apps/web/components/workflow/editor/side-panel.test.tsx`
- Modify: `apps/web/components/workflow/editor/workflow-editor.tsx`

**Interfaces:**

- Consumes : `sourceCandidates`, `removeSource`, `removeState`, `removeTransition`, `routeLabel`, `setInitial`, `setRestriction`, `stateName`, `updateStatus`, `updateTransition`, `displayGroup`, `toneOf` (de `./graph-model`) ; `TONE_CLASS` (de `./tones`) ; `StartPanel` ; `TTransitionLock` ; `TEditorSelection`.
- Produces : `WorkflowSidePanel` avec les props

```ts
type Props = {
  draft: TDraftGraph;
  selection: TEditorSelection;
  canEdit: boolean;
  onChange: (draft: TDraftGraph) => void;
  onSelect: (selection: TEditorSelection) => void;
  onAddTransition: (lock: TTransitionLock) => void;
  /** Opens the rule dialog on the selected transition. */
  onEditRule: () => void;
  focusSignal: number;
};
```

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `side-panel.test.tsx` : retirer le `vi.mock("./restrict-actors-form", ...)` ; dans le mock de `@plane/i18n`, renvoyer aussi `currentLocale: "en"` (les listes de noms sont formatées selon la langue) ; ajouter `onSelect={() => {}}` et `onEditRule={() => {}}` aux props par défaut de `renderPanel` ; garder les tests existants dont le comportement ne change pas (catégorie automatique, retrait d'une source, repli) ; ajouter :

```tsx
const transition = (key: string, sources: string[] | "*", target: string, name = "") => ({
  key,
  name,
  from_any: sources === "*",
  source_keys: sources === "*" ? [] : sources,
  target_key: target,
  rules: [],
  sides: {},
});
const three: TDraftGraph = {
  states: [state("a"), state("b"), state("c")],
  transitions: [transition("t1", ["a"], "b", "Start"), transition("g", "*", "b"), transition("t2", ["b"], "c")],
};

describe("state panel", () => {
  it("lists the incoming and outgoing transitions as cards that select them", async () => {
    const onSelect = vi.fn();
    renderPanel({ draft: three, selection: { kind: "state", key: "b" }, onSelect });
    expect(screen.getByRole("heading", { name: 'workflows.editor.panel.incoming_count {"count":2}' })).toBeTruthy();
    expect(screen.getByRole("heading", { name: 'workflows.editor.panel.outgoing_count {"count":1}' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: /Start.*A → B/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "transition", key: "t1" });
    expect(screen.getByRole("button", { name: /workflows\.editor\.global → B/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /B → C/ })).toBeTruthy();
  });

  it("adds a transition locked on the state", async () => {
    const onAddTransition = vi.fn();
    renderPanel({ draft: three, selection: { kind: "state", key: "b" }, onAddTransition });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.add_incoming" }));
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.add_outgoing" }));
    expect(onAddTransition.mock.calls).toEqual([[{ side: "target", key: "b" }], [{ side: "source", key: "b" }]]);
  });

  it("names the other workflows that use the state", () => {
    const draft: TDraftGraph = {
      states: [state("a", { shared_count: 2, shared_names: ["Bug", "Delivery"] })],
      transitions: [],
    };
    renderPanel({ draft, selection: { kind: "state", key: "a" } });
    expect(screen.getByRole("note").textContent).toBe(
      'workflows.editor.panel.shared_named {"count":2,"names":"Bug, Delivery"}'
    );
  });

  it("shows no sharing note for a state used by this workflow only", () => {
    renderPanel({ draft: three, selection: { kind: "state", key: "a" } });
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("transition panel", () => {
  it("adds one more source state from the states that do not duplicate a route", async () => {
    const onChange = vi.fn();
    renderPanel({ draft: three, selection: { kind: "transition", key: "t2" }, onChange });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.add_source" }));
    const picker = screen.getByRole("combobox", { name: "workflows.editor.panel.add_source" });
    expect(
      within(picker)
        .getAllByRole("option")
        .map((item) => item.textContent)
    ).toEqual(["workflows.editor.add_transition.choose_state", "A"]);
    await user.selectOptions(picker, "A");
    expect(onChange.mock.calls[0][0].transitions[2].source_keys).toEqual(["b", "a"]);
  });

  it("offers no source to add to a transition from any state", () => {
    renderPanel({ draft: three, selection: { kind: "transition", key: "g" } });
    expect(screen.queryByRole("button", { name: "workflows.editor.panel.add_source" })).toBeNull();
  });

  it("summarises the rule and lets it be edited or removed", async () => {
    const onChange = vi.fn();
    const onEditRule = vi.fn();
    const draft: TDraftGraph = {
      ...three,
      transitions: [
        {
          ...transition("t1", ["a"], "b"),
          rules: [{ type: "restrict_actors", params: { roles: [20, 15], user_ids: ["u1"], assignee: true } }],
        },
      ],
    };
    renderPanel({ draft, selection: { kind: "transition", key: "t1" }, onChange, onEditRule });
    expect(
      screen.getByText(
        'workflows.editor.restrict.summary_roles {"roles":"workflows.roles.admin, workflows.roles.member"} · workflows.editor.restrict.summary_users {"count":1} · workflows.editor.restrict.assignee'
      )
    ).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.edit_rule" }));
    expect(onEditRule).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "workflows.editor.panel.remove_rule" }));
    expect(onChange.mock.calls[0][0].transitions[0].rules).toEqual([]);
  });

  it("offers to add a rule when there is none", async () => {
    const onEditRule = vi.fn();
    renderPanel({ draft: three, selection: { kind: "transition", key: "t1" }, onEditRule });
    await userEvent.setup().click(screen.getByRole("button", { name: "workflows.editor.add_rule.title" }));
    expect(onEditRule).toHaveBeenCalledTimes(1);
  });
});

describe("read-only panel", () => {
  const actions = () =>
    screen
      .queryAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent)
      .filter((name) => name !== "workflows.editor.panel.collapse");

  it("offers no action on a state", () => {
    renderPanel({ draft: three, selection: { kind: "state", key: "b" }, canEdit: false });
    // The transition cards still select: reading is allowed.
    expect(actions().every((name) => /→/.test(name ?? ""))).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: "workflows.editor.add_state.name" }) as HTMLInputElement).disabled
    ).toBe(true);
  });

  it("offers no action on a transition", () => {
    renderPanel({ draft: three, selection: { kind: "transition", key: "t1" }, canEdit: false });
    expect(actions()).toEqual([]);
  });
});
```

La fabrique `state(key, status)` du fichier nomme l'état par sa clé en majuscules (`A`, `B`, `C`).

Run: `pnpm --filter=web exec vitest run components/workflow/editor/side-panel.test.tsx`
Expected: FAIL sur les nouveaux tests.

- [ ] **Step 2: Réécrire `side-panel.tsx`**

Garder l'en-tête COPYRIGHT. Fichier complet :

```tsx
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { ChevronRightOutline, CloseOutline, WorkflowsOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups, TWorkflowRestrictActorsParams } from "@plane/types";
// local imports
import type { TTransitionLock } from "./add-transition-dialog";
import {
  displayGroup,
  removeSource,
  removeState,
  removeTransition,
  routeLabel,
  setInitial,
  setRestriction,
  sourceCandidates,
  stateName,
  toneOf,
  updateStatus,
  updateTransition,
  type TDraftGraph,
  type TDraftTransition,
} from "./graph-model";
import { StartPanel } from "./start-panel";
import { TONE_CLASS } from "./tones";
import type { TEditorSelection } from "./workflow-canvas";

const GROUPS: TStateGroups[] = ["backlog", "unstarted", "started", "completed", "cancelled"];
const ROLE_KEYS: Record<number, string> = { 20: "admin", 15: "member", 5: "guest" };
// Beyond five names the note says how many more there are (spec 4.5).
const MAX_NAMES = 5;
const FIELD_CLASS = "rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular max-md:min-h-11";
const LABEL_CLASS = "flex flex-col gap-1 text-body-xs-medium text-secondary";
const LINK_CLASS = "rounded-sm text-body-xs-medium text-accent-primary hover:underline max-md:min-h-11";
const CARD_CLASS =
  "w-full rounded-md border border-subtle bg-layer-1 p-2 text-left hover:bg-layer-1-hover max-md:min-h-11";
const CHIP_CLASS = "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-caption-sm-medium uppercase";
const SECTION_TITLE_CLASS = "text-body-sm-medium text-primary";
const FOOT_CLASS = "mt-auto space-y-2 border-t border-subtle pt-4";

type Props = {
  draft: TDraftGraph;
  // Always an element of the draft: the editor drops a selection whose element is gone.
  selection: TEditorSelection;
  canEdit: boolean;
  onChange: (draft: TDraftGraph) => void;
  onSelect: (selection: TEditorSelection) => void;
  onAddTransition: (lock: TTransitionLock) => void;
  /** Opens the rule dialog on the selected transition. */
  onEditRule: () => void;
  // Bumped when the selection comes from the text view, so keyboard users land in the panel.
  focusSignal: number;
};

export const WorkflowSidePanel = observer(function WorkflowSidePanel(props: Props) {
  const { draft, selection, canEdit, onChange, onSelect, onAddTransition, onEditRule, focusSignal } = props;
  const { t, currentLocale } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isAddingSource, setIsAddingSource] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sourcePickerRef = useRef<HTMLSelectElement>(null);
  const handledSignal = useRef(0);

  // Any selection opens the panel (spec 3.7), a click on the element already selected too: each click
  // stores a new selection object, while a re-render keeps the same one.
  useEffect(() => {
    if (selection !== null) setIsCollapsed(false);
    setIsAddingSource(false);
  }, [selection]);

  // A collapsed panel renders its heading only on the next pass, so the hand-off waits for it.
  useEffect(() => {
    if (focusSignal === handledSignal.current) return;
    if (isCollapsed) {
      setIsCollapsed(false);
      return;
    }
    handledSignal.current = focusSignal;
    headingRef.current?.focus();
  }, [focusSignal, isCollapsed]);

  // The link that opened the picker is gone: the picker takes the focus.
  useEffect(() => {
    if (isAddingSource) sourcePickerRef.current?.focus();
  }, [isAddingSource]);

  const state = selection?.kind === "state" ? draft.states.find((item) => item.key === selection.key) : undefined;
  const transition =
    selection?.kind === "transition" ? draft.transitions.find((item) => item.key === selection.key) : undefined;
  const isStart = selection?.kind === "start";
  const hasSelection = Boolean(state || transition || isStart);
  const unnamed = t("workflows.editor.text.unnamed");
  const names = new Intl.ListFormat(currentLocale, { style: "short", type: "unit" });

  const toneClassOf = (key: string) => {
    const found = draft.states.find((item) => item.key === key);
    return TONE_CLASS[toneOf(found ? displayGroup(draft, found) : "unstarted")];
  };
  const routeOf = (item: TDraftTransition) =>
    routeLabel(
      item.from_any ? t("workflows.editor.global") : item.source_keys.map((key) => stateName(draft, key)).join(", "),
      stateName(draft, item.target_key)
    );
  const sharedNote = (shared: string[]) => {
    const shown = names.format(shared.slice(0, MAX_NAMES));
    const list =
      shared.length > MAX_NAMES
        ? t("workflows.editor.panel.more_names", { names: shown, count: shared.length - MAX_NAMES })
        : shown;
    return t("workflows.editor.panel.shared_named", { count: shared.length, names: list });
  };
  const ruleSummary = (params: TWorkflowRestrictActorsParams) =>
    [
      params.roles?.length
        ? t("workflows.editor.restrict.summary_roles", {
            roles: names.format(params.roles.map((role) => t(`workflows.roles.${ROLE_KEYS[role]}`))),
          })
        : null,
      params.user_ids?.length ? t("workflows.editor.restrict.summary_users", { count: params.user_ids.length }) : null,
      params.assignee ? t("workflows.editor.restrict.assignee") : null,
      params.creator ? t("workflows.editor.restrict.creator") : null,
    ]
      .filter(Boolean)
      .join(" · ");

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

  // Below 1024px the strip overlays the content like the open panel instead of taking its width.
  if (isCollapsed)
    return (
      <div className="border-l border-subtle bg-layer-2 p-2 max-lg:absolute max-lg:top-0 max-lg:right-0 max-lg:z-10">
        {toggle}
      </div>
    );

  const transitionSection = (kind: "incoming" | "outgoing", items: TDraftTransition[], lock: TTransitionLock) => (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className={`flex-1 ${SECTION_TITLE_CLASS}`}>
          {t(`workflows.editor.panel.${kind}_count`, { count: items.length })}
        </h3>
        {canEdit && (
          <button
            type="button"
            className={LINK_CLASS}
            aria-label={t(`workflows.editor.panel.add_${kind}`)}
            onClick={() => onAddTransition(lock)}
          >
            {t("workflows.editor.panel.add")}
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className={CARD_CLASS}
              onClick={() => onSelect({ kind: "transition", key: item.key })}
            >
              <span className="block text-body-sm-medium text-primary">{item.name || unnamed}</span>
              <span className="block text-caption-sm-regular text-secondary">{routeOf(item)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  const rule = transition?.rules[0];
  const candidates = transition ? sourceCandidates(draft, transition.key) : [];
  const title = isStart
    ? t("workflows.editor.start_panel.title")
    : state
      ? state.status.name
      : transition
        ? transition.name || unnamed
        : t("workflows.editor.panel.empty_title");

  return (
    <aside
      // Below 1024px the panel overlays the canvas, and only while something is selected (spec 3.8).
      className={`flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-subtle bg-layer-2 p-4 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-10 max-lg:w-full max-lg:max-w-[400px] ${hasSelection ? "" : "max-lg:hidden"}`}
      aria-label={title}
    >
      <div className="flex items-start gap-2">
        {toggle}
        {hasSelection && (
          <div className="min-w-0 flex-1">
            {transition && (
              <p className="text-caption-sm-medium text-tertiary">{t("workflows.editor.panel.transition")}</p>
            )}
            <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-h5-semibold text-primary">
              {state && (
                <span className={`size-3 shrink-0 rounded-full border ${toneClassOf(state.key)}`} aria-hidden />
              )}
              <span className="truncate">{title}</span>
            </h2>
          </div>
        )}
      </div>

      {!hasSelection && (
        <div className="space-y-3 pt-8 text-center">
          <WorkflowsOutline className="mx-auto size-12 text-tertiary" aria-hidden />
          <h2 className="text-h5-semibold text-primary">{t("workflows.editor.panel.empty_title")}</h2>
          <p className="text-body-sm-regular text-secondary">{t("workflows.editor.panel.empty_body")}</p>
          <p className="text-body-sm-regular text-secondary">{t("workflows.editor.panel.empty_hint")}</p>
        </div>
      )}

      {isStart && <StartPanel draft={draft} canEdit={canEdit} onChange={onChange} />}

      {state && (
        <>
          <fieldset className="space-y-4" disabled={!canEdit}>
            <InputField
              size="md"
              orientation="vertical"
              id="workflow-state-name"
              name="state-name"
              type="text"
              maxLength={255}
              label={t("workflows.editor.add_state.name")}
              value={state.status.name}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange(updateStatus(draft, state.key, { name: event.target.value }))
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL_CLASS}>
                {t("workflows.editor.add_state.group")}
                <select
                  className={FIELD_CLASS}
                  value={state.status.group ?? ""}
                  onChange={(event) =>
                    onChange(
                      updateStatus(draft, state.key, { group: (event.target.value || null) as TStateGroups | null })
                    )
                  }
                >
                  {!state.status.group_locked && <option value="">{t("workflows.editor.add_state.group_auto")}</option>}
                  {GROUPS.map((group) => (
                    <option key={group} value={group}>
                      {t(`workflows.groups.${group}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL_CLASS}>
                {t("workflows.editor.panel.color")}
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    value={state.status.color}
                    onChange={(event) => onChange(updateStatus(draft, state.key, { color: event.target.value }))}
                  />
                  <span className="text-body-sm-regular text-primary uppercase">{state.status.color}</span>
                </span>
              </label>
            </div>
          </fieldset>
          {canEdit && (state.status.shared_names?.length ?? 0) > 0 && (
            <p
              role="note"
              className="rounded-md border border-warning-subtle bg-warning-subtle p-2 text-caption-sm-regular text-warning-primary"
            >
              {sharedNote(state.status.shared_names ?? [])}
            </p>
          )}
          {transitionSection(
            "incoming",
            draft.transitions.filter((item) => item.target_key === state.key),
            { side: "target", key: state.key }
          )}
          {transitionSection(
            "outgoing",
            draft.transitions.filter((item) => !item.from_any && item.source_keys.includes(state.key)),
            { side: "source", key: state.key }
          )}
          {(canEdit || state.is_initial) && (
            <div className={canEdit ? FOOT_CLASS : "mt-auto"}>
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
                  onClick={() => onChange(removeState(draft, state.key))}
                />
              )}
            </div>
          )}
        </>
      )}

      {transition && (
        <>
          <fieldset disabled={!canEdit}>
            <InputField
              size="md"
              orientation="vertical"
              id="workflow-transition-name"
              name="transition-name"
              type="text"
              maxLength={255}
              label={t("workflows.editor.add_transition.name")}
              value={transition.name}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange(updateTransition(draft, transition.key, { name: event.target.value }))
              }
            />
          </fieldset>
          <section className="space-y-2">
            <h3 className={SECTION_TITLE_CLASS}>{t("workflows.editor.panel.path")}</h3>
            <div role="group" aria-label={routeOf(transition)} className="flex flex-wrap items-center gap-1">
              {transition.from_any ? (
                <span className={`${CHIP_CLASS} border-subtle text-secondary`}>{t("workflows.editor.global")}</span>
              ) : (
                transition.source_keys.map((key) => (
                  <span key={key} className={`${CHIP_CLASS} ${toneClassOf(key)}`}>
                    {stateName(draft, key)}
                    {/* The last source has no remove button: a transition from states needs one. */}
                    {canEdit && transition.source_keys.length > 1 && (
                      <button
                        type="button"
                        className="flex size-5 items-center justify-center rounded-full hover:bg-layer-1-hover max-md:size-11"
                        aria-label={t("workflows.editor.panel.remove_source", { name: stateName(draft, key) })}
                        onClick={() => onChange(removeSource(draft, transition.key, key))}
                      >
                        <CloseOutline className="size-3" aria-hidden />
                      </button>
                    )}
                  </span>
                ))
              )}
              <span aria-hidden>→</span>
              <span className={`${CHIP_CLASS} ${toneClassOf(transition.target_key)}`}>
                {stateName(draft, transition.target_key)}
              </span>
            </div>
            {canEdit &&
              candidates.length > 0 &&
              (isAddingSource ? (
                <select
                  ref={sourcePickerRef}
                  className={`w-full ${FIELD_CLASS}`}
                  aria-label={t("workflows.editor.panel.add_source")}
                  value=""
                  onChange={(event) => {
                    onChange(
                      updateTransition(draft, transition.key, {
                        source_keys: [...transition.source_keys, event.target.value],
                      })
                    );
                    setIsAddingSource(false);
                  }}
                >
                  <option value="" disabled>
                    {t("workflows.editor.add_transition.choose_state")}
                  </option>
                  {candidates.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.status.name}
                    </option>
                  ))}
                </select>
              ) : (
                <button type="button" className={LINK_CLASS} onClick={() => setIsAddingSource(true)}>
                  {t("workflows.editor.panel.add_source")}
                </button>
              ))}
          </section>
          <section className="space-y-2">
            <h3 className={SECTION_TITLE_CLASS}>{t("workflows.editor.panel.rule")}</h3>
            {rule ? (
              <div className="space-y-1 rounded-md border border-subtle bg-layer-1 p-2">
                <p className="text-body-sm-medium text-primary">{t("workflows.editor.restrict.title")}</p>
                <p className="text-caption-sm-regular text-secondary">{ruleSummary(rule.params)}</p>
                {canEdit && (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className={LINK_CLASS}
                      aria-label={t("workflows.editor.panel.edit_rule")}
                      onClick={onEditRule}
                    >
                      {t("workflows.editor.panel.edit")}
                    </button>
                    <button
                      type="button"
                      className={LINK_CLASS}
                      aria-label={t("workflows.editor.panel.remove_rule")}
                      onClick={() => onChange(setRestriction(draft, transition.key, null))}
                    >
                      {t("workflows.editor.panel.remove")}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <p className="text-caption-sm-regular text-tertiary">{t("workflows.editor.restrict.description")}</p>
                {canEdit && (
                  <button type="button" className={LINK_CLASS} onClick={onEditRule}>
                    {t("workflows.editor.add_rule.title")}
                  </button>
                )}
              </>
            )}
          </section>
          {canEdit && (
            <div className={FOOT_CLASS}>
              <Button
                variant="danger-outline"
                size="sm"
                stretch="auto"
                label={t("workflows.editor.panel.remove_transition")}
                onClick={() => onChange(removeTransition(draft, transition.key))}
              />
            </div>
          )}
        </>
      )}
    </aside>
  );
});
```

Les classes `border-warning-subtle`, `bg-warning-subtle`, `text-warning-primary`, `bg-layer-1-hover` doivent exister dans le thème de propel : vérifier par une recherche dans `apps/web` (une autre classe en service du même rôle fait l'affaire sinon). Le nom accessible d'une carte est son contenu (« nom » puis « chemin »). Le libellé visible « Modifier » fait partie du nom accessible « Modifier la règle » (WCAG 2.5.3) ; de même pour « Retirer » et « Ajouter ».

- [ ] **Step 3: Câbler l'éditeur**

`workflow-editor.tsx`, sur `WorkflowSidePanel` : ajouter `onSelect={setSelection}` et `onEditRule={() => setDialog({ kind: "rule" })}`. La fenêtre de règle reçoit déjà `presetKey={selectedTransitionKey}`.

- [ ] **Step 4: Vérifier**

Run: `pnpm --filter=web exec vitest run components/workflow` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/editor`
Expected: tout passe. Les tests de l'éditeur qui cherchaient le titre « workflows.editor.panel.state » du panneau, ou le formulaire de règle dans le panneau, sont à adapter au nouveau panneau (le titre est le nom de l'élément).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workflow/editor
git commit -m "feat(web): redesign the side panel of the workflow editor"
```

---

### Task 7: Vue Texte : clic sur la ligne, départ cliquable (spec 4.2, 4.4 ; D11, E8 ; CA-13)

**Files:**

- Modify: `apps/web/components/workflow/editor/text-view.tsx`, `text-view.test.tsx`

**Interfaces:**

- Consumes : `TEditorSelection` (avec `{ kind: "start" }`).
- Produces : rien de nouveau ; `WorkflowTextView` garde ses props `{ draft, selection, onSelect }`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter dans `text-view.test.tsx` (réutiliser le brouillon et le rendu du fichier ; si aucun brouillon du fichier n'a un état de départ avec une transition entrante nommée, en déclarer un : états `a` « Todo » de départ et `b` « Done », transition `t` nommée « Finish » de `a` vers `b`) :

```tsx
it("selects the state when its row is clicked outside a transition", async () => {
  const onSelect = vi.fn();
  render(<WorkflowTextView draft={draft} selection={null} onSelect={onSelect} />);
  const row = screen.getByRole("button", { name: "Done" }).closest("tr") as HTMLElement;
  const cells = within(row).getAllByRole("cell");
  await userEvent.setup().click(cells[cells.length - 1]);
  expect(onSelect.mock.calls).toEqual([[{ kind: "state", key: "b" }]]);
});

it("selects only the transition when its name is clicked", async () => {
  const onSelect = vi.fn();
  render(<WorkflowTextView draft={draft} selection={null} onSelect={onSelect} />);
  await userEvent.setup().click(screen.getByRole("button", { name: /Finish/ }));
  expect(onSelect.mock.calls).toEqual([[{ kind: "transition", key: "t" }]]);
});

it("opens the start panel from the start line", async () => {
  const onSelect = vi.fn();
  render(<WorkflowTextView draft={draft} selection={null} onSelect={onSelect} />);
  await userEvent.setup().click(screen.getByRole("button", { name: /workflows\.editor\.text\.origin_start → Todo/ }));
  expect(onSelect.mock.calls).toEqual([[{ kind: "start" }]]);
});
```

Run: `pnpm --filter=web exec vitest run components/workflow/editor/text-view.test.tsx`
Expected: FAIL sur ces trois tests.

- [ ] **Step 2: Implémenter**

Dans `text-view.tsx` :

- la ligne : `<tr key={row.key} className="cursor-pointer align-top" onClick={() => onSelect({ kind: "state", key: row.key })}>`, précédée du commentaire `{/* Mouse shortcut (D11); the state button of the row is the keyboard path. */}`. Si oxlint signale un gestionnaire de clic sur un élément non interactif, ajouter au-dessus `// oxlint-disable-next-line <règle signalée> -- mouse shortcut, the state button of the row is the keyboard path (D11)`.
- chaque bouton de la ligne arrête la propagation pour ne sélectionner qu'une fois : bouton de repli `onClick={(event) => { event.stopPropagation(); setCollapsed(...); }}` ; bouton de l'état `onClick={(event) => { event.stopPropagation(); onSelect({ kind: "state", key: row.key }); }}` ; bouton d'une transition `onClick={(event) => { event.stopPropagation(); onSelect({ kind: "transition", key }); }}`.
- la ligne de départ (`key === null`) devient un bouton :

```tsx
                            {key === null ? (
                              <button
                                type="button"
                                className="rounded-sm text-left hover:underline max-md:min-h-11"
                                aria-current={selection?.kind === "start" ? "true" : undefined}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onSelect({ kind: "start" });
                                }}
                              >
                                {route}
                              </button>
                            ) : (
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter=web exec vitest run components/workflow` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/editor/text-view.tsx components/workflow/editor/text-view.test.tsx`
Expected: tout passe.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/workflow/editor/text-view.tsx apps/web/components/workflow/editor/text-view.test.tsx
git commit -m "feat(web): open the state panel from its row in the text view"
```

---

### Task 8: Serveur : empreinte du graphe et refus 409 (spec 6.1 ; D7 a, E1, Y1, Y2 ; CA-17 à CA-19)

**Files:**

- Modify: `apps/api/plane/utils/workflow_graph.py`, `apps/api/plane/app/views/workflow/base.py`
- Create: `apps/api/plane/tests/unit/utils/test_workflow_graph_version.py`
- Modify: `apps/api/plane/tests/contract/app/test_workflows_app.py`

**Interfaces:**

- Consumes: rien.
- Produces :
  - `plane.utils.workflow_graph.graph_version(graph: dict) -> str` (64 caractères hexadécimaux)
  - `save_workflow_graph(*, workflow, graph, actor_id, expected_version=None)` lève `GraphError("stale_graph")`
  - le détail d'un workflow (GET, POST, PATCH, PUT graph, duplicate) porte `version`
  - `PUT .../graph/` exige `expected_version` : absent ou mal formé 400 `{"expected_version": [...]}`, périmé 409 `{"graph": ["stale_graph"]}`
  - dans le fichier de tests de contrat : `_version(workflow)`, `_new_state(name)`, `_refused_actors(workspace, users, project)` (réutilisés par la tâche 9)

- [ ] **Step 1: Écrire les tests unitaires de l'empreinte**

Créer `plane/tests/unit/utils/test_workflow_graph_version.py` (en-tête COPYRIGHT en `#`, marqueurs comme `test_workflow_seed.py` du même dossier) :

```python
import pytest

from plane.db.models import Workflow, WorkflowState, WorkflowStatus, WorkflowTransition, WorkflowTransitionRule
from plane.db.models.workflow import RULE_RESTRICT_ACTORS
from plane.tests.workflow_builders import build_workflow
from plane.utils.workflow_graph import graph_version, workflow_graph


def _version(workflow):
    return graph_version(workflow_graph(workflow))


@pytest.mark.unit
@pytest.mark.django_db
class TestGraphVersion:
    @pytest.fixture
    def software(self, workspace):
        return build_workflow(workspace, "Software", ["To do", "Done"], [(["To do"], "Done", None)])

    def test_is_a_stable_sha256(self, software):
        first = _version(software)
        assert len(first) == 64
        assert set(first) <= set("0123456789abcdef")
        assert _version(Workflow.objects.get(pk=software.pk)) == first

    def test_ignores_the_name_and_description_of_the_workflow(self, software):
        before = _version(software)
        software.name = "Renamed"
        software.description = "Another description"
        software.save()
        assert _version(software) == before

    def test_changes_with_a_position(self, software):
        before = _version(software)
        state = software.states_by_name["Done"]
        state.position_x = 999
        state.save()
        assert _version(software) != before

    def test_changes_with_the_start_state(self, software):
        before = _version(software)
        WorkflowState.objects.filter(workflow=software).update(is_initial=False)
        assert _version(software) != before

    def test_changes_with_a_transition(self, software):
        before = _version(software)
        WorkflowTransition.objects.create(workflow=software, target=software.states_by_name["To do"], from_any=True)
        assert _version(software) != before

    def test_changes_with_a_rule(self, software):
        before = _version(software)
        WorkflowTransitionRule.objects.create(
            transition=software.transitions.first(), rule_type=RULE_RESTRICT_ACTORS, params={"assignee": True}
        )
        assert _version(software) != before

    def test_changes_when_a_shared_status_is_renamed_from_elsewhere(self, software):
        before = _version(software)
        WorkflowStatus.objects.filter(pk=software.states_by_name["To do"].status_id).update(name="Todo")
        assert _version(software) != before
```

Run: `docker compose -p wfr2-t8 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/unit/utils/test_workflow_graph_version.py -v`
Expected: FAIL à l'import (`graph_version` n'existe pas).

- [ ] **Step 2: Implémenter l'empreinte et le contrôle**

Dans `plane/utils/workflow_graph.py`, ajouter en tête `import hashlib` et `import json` (bloc `# Python imports` avant `# Module imports`), puis sous `workflow_graph` :

```python
def graph_version(graph):
    """Fingerprint of the states and transitions of a workflow_graph() result (spec 6.1)."""
    content = {"states": graph["states"], "transitions": graph["transitions"]}
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
```

Remplacer `_resolve_statuses` par deux fonctions :

```python
def _lock_statuses(workflow, graph, existing):
    """Lock in one query, ordered by id, the statuses the request cites and those the workflow uses now."""
    ids = {str(state["status"]["id"]) for state in graph["states"] if "id" in state["status"]}
    ids.update(str(state.status_id) for state in existing.values())
    return {
        str(status.id): status
        for status in WorkflowStatus.objects.select_for_update(of=("self",))
        .filter(workspace_id=workflow.workspace_id, pk__in=ids)
        .order_by("id")
    }


def _resolve_statuses(workflow, graph, existing, locked):
    """Check the request may use the statuses it cites; returns {status id: WorkflowStatus}."""
    ids = [str(state["status"]["id"]) for state in graph["states"] if "id" in state["status"]]
    statuses = {status_id: locked[status_id] for status_id in ids if status_id in locked}
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
```

Début de `save_workflow_graph` (le reste de la fonction ne change pas) :

```python
def save_workflow_graph(*, workflow, graph, actor_id, expected_version=None):
    """P1: replace the graph of a locked workflow, then propagate to every linked project (5.2)."""
    existing = {str(state.id): state for state in WorkflowState.objects.filter(workflow_id=workflow.id)}
    locked = _lock_statuses(workflow, graph, existing)
    # Read under the locks: a shared status renamed from another workflow counts as a change (spec 6.1).
    before = workflow_graph(workflow)
    if expected_version is not None and graph_version(before) != expected_version:
        raise GraphError("stale_graph")
    # An empty graph would leave linked projects without an initial state.
    if not graph["states"] and projects_using(workflow.id).exists():
        raise GraphError("initial_state_required")
    statuses = _resolve_statuses(workflow, graph, existing, locked)
```

Run: le test de l'étape 1. Expected: PASS (7 tests).

- [ ] **Step 3: Écrire les tests de contrat**

Dans `test_workflows_app.py` : importer `from plane.utils.workflow_graph import graph_version, workflow_graph` ; ajouter sous `_client` :

```python
def _version(workflow):
    return graph_version(workflow_graph(workflow))


def _new_state(name):
    return {
        "key": f"new-{name}",
        "status": {"name": name, "color": "#00AA00"},
        "position_x": 10,
        "position_y": 20,
        "is_initial": False,
    }


def _refused_actors(workspace, users, project):
    """Everyone spec 9 plays against an admin-only route: none of them is an admin of this workspace."""
    project_admin = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=project_admin, role=15)
    ProjectMember.objects.create(project=project, member=project_admin, role=20)
    foreign_admin = UserFactory()
    WorkspaceMember.objects.create(workspace=WorkspaceFactory(), member=foreign_admin, role=20)
    return {
        "project_admin": project_admin,
        "member": users["member"],
        "guest": users["guest"],
        "stranger": UserFactory(),
        "foreign_admin": foreign_admin,
    }
```

Faire porter l'empreinte courante par `_graph_payload` (dernière ligne) :

```python
    return {"states": states + list(extra_states), "transitions": [], "expected_version": _version(workflow)}
```

Ajouter la classe :

```python
@pytest.mark.contract
@pytest.mark.django_db
class TestStaleGraph:
    def _put(self, user, workspace, workflow, payload):
        return _client(user).put(GRAPH_URL.format(slug=workspace.slug, pk=workflow.id), payload, format="json")

    def test_the_detail_carries_the_version(self, workspace, users, software):
        detail = _client(users["member"]).get(WORKFLOW_URL.format(slug=workspace.slug, pk=software.id))
        assert detail.data["version"] == _version(software)

    @pytest.mark.parametrize(
        "value",
        [None, "", "abc", "g" * 64, "A" * 64, 12, ["a" * 64]],
        ids=["missing", "empty", "short", "not-hex", "upper-case", "number", "list"],
    )
    def test_a_missing_or_malformed_version_is_refused(self, workspace, users, software, value):
        payload = _graph_payload(software, [_new_state("Review")])
        if value is None:
            del payload["expected_version"]
        else:
            payload["expected_version"] = value
        response = self._put(users["admin"], workspace, software, payload)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "expected_version" in response.data
        assert WorkflowState.objects.filter(workflow=software).count() == 2

    def test_a_stale_save_is_refused_and_writes_nothing(self, workspace, users, software):
        stale = _graph_payload(software, drop=["Done"])
        first = self._put(users["admin"], workspace, software, _graph_payload(software, [_new_state("Review")]))
        assert first.status_code == status.HTTP_200_OK, first.data
        audits = AuditLog.objects.filter(action="workflow.graph_updated").count()
        response = self._put(users["admin"], workspace, software, stale)
        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data == {"graph": ["stale_graph"]}
        assert WorkflowState.objects.filter(workflow=software).count() == 3
        assert AuditLog.objects.filter(action="workflow.graph_updated").count() == audits

    def test_the_version_returned_by_a_save_allows_the_next_one(self, workspace, users, software):
        first = self._put(users["admin"], workspace, software, _graph_payload(software, [_new_state("Review")]))
        payload = _graph_payload(software, [_new_state("Shipped")])
        payload["expected_version"] = first.data["version"]
        second = self._put(users["admin"], workspace, software, payload)
        assert second.status_code == status.HTTP_200_OK, second.data
        assert second.data["version"] != first.data["version"]

    def test_a_shared_status_renamed_from_another_workflow_makes_the_draft_stale(self, workspace, users, software):
        other = build_workflow(workspace, "Bug", ["To do", "Fixed"])
        stale = _graph_payload(software)
        renaming = _graph_payload(other)
        renaming["states"][0]["status"]["name"] = "Todo"
        assert self._put(users["admin"], workspace, other, renaming).status_code == status.HTTP_200_OK
        response = self._put(users["admin"], workspace, software, stale)
        assert response.status_code == status.HTTP_409_CONFLICT
        assert WorkflowStatus.objects.get(pk=software.states_by_name["To do"].status_id).name == "Todo"

    def test_renaming_the_workflow_does_not_make_a_draft_stale(self, workspace, users, software):
        payload = _graph_payload(software, [_new_state("Review")])
        renamed = _client(users["admin"]).patch(
            WORKFLOW_URL.format(slug=workspace.slug, pk=software.id), {"name": "Renamed"}, format="json"
        )
        assert renamed.status_code == status.HTTP_200_OK
        assert self._put(users["admin"], workspace, software, payload).status_code == status.HTTP_200_OK

    @pytest.mark.parametrize("actor", ["project_admin", "member", "guest", "stranger", "foreign_admin"])
    def test_only_workspace_admins_save_even_with_a_valid_version(self, workspace, users, project, software, actor):
        user = _refused_actors(workspace, users, project)[actor]
        response = self._put(user, workspace, software, _graph_payload(software, [_new_state("Review")]))
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert WorkflowState.objects.filter(workflow=software).count() == 2
```

Run: `docker compose -p wfr2-t8 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -v -k "TestStaleGraph"`
Expected: FAIL (pas de `version`, 200 au lieu de 400 et de 409).

- [ ] **Step 4: Implémenter la vue**

Dans `views/workflow/base.py` : importer `graph_version` avec `GraphError, save_workflow_graph, workflow_graph` ;

```python
def workflow_detail(workflow, is_admin):
    graph = workflow_graph(workflow)
    # The fingerprint the editor sends back with its save (spec 6.1); the audit snapshot does not carry it.
    return {**graph, "version": graph_version(graph), **_projects(workflow, is_admin)}
```

Dans `WorkflowGraphEndpoint.put`, après la validation du sérialiseur du graphe :

```python
        try:
            expected_version = serializers.RegexField(r"^[0-9a-f]{64}$").run_validation(
                request.data.get("expected_version")
            )
        except serializers.ValidationError as error:
            return Response({"expected_version": error.detail}, status=status.HTTP_400_BAD_REQUEST)
```

passer `expected_version=expected_version` à `save_workflow_graph`, et dans `except GraphError as error:` ajouter en premier :

```python
            if error.code == "stale_graph":
                return Response({"graph": [error.code]}, status=status.HTTP_409_CONFLICT)
```

La création depuis un projet (`_seed`) et la duplication n'envoient pas `expected_version`.

- [ ] **Step 5: Lancer tous les tests de workflows**

Run: `docker compose -p wfr2-t8 -f docker-compose-test.yml run --rm api-tests pytest --create-db plane/tests -k workflow -q`, puis ruff (`check` et `format --check`) sur les quatre fichiers touchés, puis `docker compose -p wfr2-t8 -f docker-compose-test.yml down -v`.
Expected: tout passe. Un test existant qui envoie un graphe sans passer par `_graph_payload` reçoit désormais 400 : lui ajouter `"expected_version": _version(<workflow>)`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/plane/utils/workflow_graph.py apps/api/plane/app/views/workflow/base.py apps/api/plane/tests
git commit -m "feat(api): refuse a graph save made from a stale workflow"
```

---

### Task 9: Serveur : route de présence (spec 6.2 ; D7 b, E2, Y3, Y4 ; CA-20, CA-21)

**Files:**

- Modify: `apps/api/plane/app/views/workflow/base.py`, `apps/api/plane/app/views/__init__.py`, `apps/api/plane/app/urls/workflow.py`
- Modify: `apps/api/plane/tests/contract/app/test_workflows_app.py`

**Interfaces:**

- Consumes (tâche 8, fichier de tests) : `_client(user)`, `_refused_actors(workspace, users, project)`, fixtures `workspace`, `users`, `project`, `software`.
- Produces : `POST /api/workspaces/<slug>/workflows/<uuid:pk>/presence/`, corps `{"editing": true | false}`, réponse 200 `{"editors": [{"id": str, "display_name": str}]}` ; clé de cache `workflow_editing:<workflow id>:<user id>`, durée 75 s.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `test_workflows_app.py` : `from django.core.cache import cache` ; `PRESENCE_URL = "/api/workspaces/{slug}/workflows/{pk}/presence/"` ; puis :

```python
def _admin(workspace, name):
    user = UserFactory(display_name=name)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=20)
    return user


def _editing_key(workflow, user):
    return f"workflow_editing:{workflow.id}:{user.id}"


@pytest.mark.contract
@pytest.mark.django_db
class TestPresence:
    def _post(self, user, workspace, workflow, body=None):
        url = PRESENCE_URL.format(slug=workspace.slug, pk=workflow.id)
        return _client(user).post(url, {"editing": True} if body is None else body, format="json")

    def test_an_editing_admin_is_seen_by_the_others_and_not_by_themself(self, workspace, users, software):
        awa = _admin(workspace, "Awa")
        own = self._post(awa, workspace, software)
        assert own.status_code == status.HTTP_200_OK
        assert own.data == {"editors": []}
        seen = self._post(users["admin"], workspace, software, {"editing": False})
        assert seen.data == {"editors": [{"id": str(awa.id), "display_name": "Awa"}]}

    def test_false_clears_the_signal(self, workspace, users, software):
        awa = _admin(workspace, "Awa")
        self._post(awa, workspace, software)
        self._post(awa, workspace, software, {"editing": False})
        assert self._post(users["admin"], workspace, software, {"editing": False}).data == {"editors": []}

    def test_the_signal_expires_by_itself(self, workspace, users, software):
        self._post(users["admin"], workspace, software)
        assert 0 < cache.ttl(_editing_key(software, users["admin"])) <= 75

    def test_a_signal_on_another_workflow_is_not_listed(self, workspace, users, software):
        other = build_workflow(workspace, "Bug", ["Open"])
        self._post(_admin(workspace, "Awa"), workspace, other)
        assert self._post(users["admin"], workspace, software, {"editing": False}).data == {"editors": []}

    def test_editors_are_sorted_by_name_and_capped_at_ten(self, workspace, users, software):
        for index in range(12):
            cache.set(_editing_key(software, _admin(workspace, f"Admin {11 - index:02d}")), 1, timeout=75)
        names = [item["display_name"] for item in self._post(users["admin"], workspace, software).data["editors"]]
        assert names == [f"Admin {index:02d}" for index in range(10)]

    def test_a_deactivated_admin_is_not_listed(self, workspace, users, software):
        awa = _admin(workspace, "Awa")
        self._post(awa, workspace, software)
        WorkspaceMember.objects.filter(workspace=workspace, member=awa).update(is_active=False)
        assert self._post(users["admin"], workspace, software, {"editing": False}).data == {"editors": []}

    def test_the_identity_comes_from_the_session_never_from_the_body(self, workspace, users, software):
        awa = _admin(workspace, "Awa")
        self._post(users["admin"], workspace, software, {"editing": True, "user_id": str(awa.id)})
        assert cache.get(_editing_key(software, awa)) is None
        assert cache.get(_editing_key(software, users["admin"])) == 1

    @pytest.mark.parametrize(
        "body", [{}, {"editing": "yes"}, {"editing": 1}, {"editing": None}, []], ids=["missing", "text", "number", "null", "list"]
    )
    def test_a_body_without_a_strict_boolean_is_refused(self, workspace, users, software, body):
        response = self._post(users["admin"], workspace, software, body)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert cache.get(_editing_key(software, users["admin"])) is None

    @pytest.mark.parametrize("actor", ["project_admin", "member", "guest", "stranger", "foreign_admin"])
    def test_only_workspace_admins_use_the_route(self, workspace, users, project, software, actor):
        user = _refused_actors(workspace, users, project)[actor]
        self._post(_admin(workspace, "Awa"), workspace, software)
        response = self._post(user, workspace, software)
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "editors" not in response.data
        assert cache.get(_editing_key(software, user)) is None

    def test_a_workflow_of_another_workspace_looks_missing(self, workspace, users):
        foreign = build_workflow(WorkspaceFactory(), "Foreign", ["A"])
        hidden = self._post(users["admin"], workspace, foreign)
        url = PRESENCE_URL.format(slug=workspace.slug, pk=uuid4())
        missing = _client(users["admin"]).post(url, {"editing": True}, format="json")
        assert hidden.status_code == missing.status_code == status.HTTP_404_NOT_FOUND
        assert cache.get(_editing_key(foreign, users["admin"])) is None
```

La pile de tests a un vrai Redis (`test-redis`) : le cache de Django fonctionne. Chaque clé porte l'identifiant d'un workflow créé par le test, donc aucun nettoyage n'est nécessaire.

Run: `docker compose -p wfr2-t9 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py -v -k "TestPresence"`
Expected: FAIL (404, route absente).

- [ ] **Step 2: Implémenter**

`views/workflow/base.py` : `from django.core.cache import cache` ; sous les constantes :

```python
# Seconds an editing signal lives without being renewed; the editor renews it every 30 seconds (spec 6.2).
EDITING_TTL = 75
MAX_EDITORS = 10
```

Après `WorkflowDuplicateEndpoint` :

```python
def _editing_key(workflow_id, user_id):
    return f"workflow_editing:{workflow_id}:{user_id}"


class WorkflowPresenceEndpoint(BaseAPIView):
    # Ephemeral and informative only: nothing is stored in the database or the audit trail (spec 6.2).
    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk):
        if not isinstance(request.data, dict):
            return Response(NOT_AN_OBJECT, status=status.HTTP_400_BAD_REQUEST)
        editing = request.data.get("editing")
        if editing is not True and editing is not False:
            return Response({"editing": ["Must be true or false."]}, status=status.HTTP_400_BAD_REQUEST)
        workflow = Workflow.objects.get(workspace__slug=slug, pk=pk)
        # The identity is the session's, never a value of the body.
        own = _editing_key(workflow.id, request.user.id)
        if editing:
            cache.set(own, 1, timeout=EDITING_TTL)
        else:
            cache.delete(own)
        # One key per admin (Y3): read for every other active admin in one round trip.
        admins = {
            _editing_key(workflow.id, membership.member_id): membership.member
            for membership in WorkspaceMember.objects.filter(
                workspace_id=workflow.workspace_id, role=ROLE.ADMIN.value, is_active=True
            )
            .exclude(member_id=request.user.id)
            .select_related("member")
        }
        present = cache.get_many(list(admins))
        editors = sorted(
            ({"id": str(admins[key].id), "display_name": admins[key].display_name} for key in present),
            key=lambda editor: editor["display_name"].lower(),
        )
        return Response({"editors": editors[:MAX_EDITORS]}, status=status.HTTP_200_OK)
```

`views/__init__.py` : exporter `WorkflowPresenceEndpoint` à côté de `WorkflowDuplicateEndpoint` (même forme d'import que ses voisins). `urls/workflow.py` : importer la vue et ajouter après la route `duplicate` :

```python
    path(
        "workspaces/<str:slug>/workflows/<uuid:pk>/presence/",
        WorkflowPresenceEndpoint.as_view(),
        name="workflow-presence",
    ),
```

- [ ] **Step 3: Vérifier**

Run: le test de l'étape 1 (PASS), puis `pytest --create-db plane/tests -k workflow -q`, puis ruff (`check`, `format --check`) sur les fichiers touchés, puis `docker compose -p wfr2-t9 -f docker-compose-test.yml down -v`.
Expected: tout passe.

- [ ] **Step 4: Commit**

```bash
git add apps/api/plane/app/views apps/api/plane/app/urls/workflow.py apps/api/plane/tests/contract/app/test_workflows_app.py
git commit -m "feat(api): tell admins who else is editing a workflow"
```

---

### Task 10: Serveur : transitions en double et contrainte sur les côtés (spec 6.4, 6.5 ; O1, O2)

**Files:**

- Modify: `apps/api/plane/app/serializers/workflow.py`, `apps/api/plane/db/models/workflow.py`
- Create (généré): `apps/api/plane/db/migrations/0131_workflow_transition_side_check.py`
- Modify (généré): `apps/api/migrations_lockfile.txt`
- Modify: `apps/api/plane/tests/contract/app/test_workflows_app.py`, `apps/api/plane/tests/unit/models/test_workflow_models.py`

**Interfaces:**

- Consumes (fichier de tests) : `_graph_payload`, `_client`, fixtures.
- Produces : refus 400 `{"graph": ["duplicate_transition"]}` ; contrainte `workflow_transition_source_sides_valid`.

- [ ] **Step 1: Écrire les tests qui échouent**

`test_workflows_app.py` :

```python
@pytest.mark.contract
@pytest.mark.django_db
class TestDuplicateTransitions:
    def _arrow(self, software, sources, target):
        key = lambda name: str(software.states_by_name[name].id)  # noqa: E731
        return {
            "name": "",
            "from_any": sources == "*",
            "source_keys": [] if sources == "*" else [key(name) for name in sources],
            "target_key": key(target),
            "rules": [],
        }

    def _put(self, workspace, users, software, transitions):
        payload = _graph_payload(software)
        payload["transitions"] = transitions
        return _client(users["admin"]).put(
            GRAPH_URL.format(slug=workspace.slug, pk=software.id), payload, format="json"
        )

    def test_two_transitions_sharing_a_source_and_a_target_are_refused(self, workspace, users, software):
        arrows = [self._arrow(software, ["To do"], "Done"), self._arrow(software, ["To do"], "Done")]
        response = self._put(workspace, users, software, arrows)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"graph": ["duplicate_transition"]}

    def test_two_transitions_from_any_state_to_the_same_state_are_refused(self, workspace, users, software):
        arrows = [self._arrow(software, "*", "Done"), self._arrow(software, "*", "Done")]
        response = self._put(workspace, users, software, arrows)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data == {"graph": ["duplicate_transition"]}

    def test_a_global_and_a_named_transition_to_the_same_state_are_accepted(self, workspace, users, software):
        arrows = [self._arrow(software, "*", "Done"), self._arrow(software, ["To do"], "Done")]
        response = self._put(workspace, users, software, arrows)
        assert response.status_code == status.HTTP_200_OK, response.data
        assert len(response.data["transitions"]) == 2
```

`test_workflow_models.py` (mêmes marqueurs que les classes du fichier ; importer ce qui manque : `IntegrityError`, `transaction` de `django.db`, `WorkflowTransitionSource`, `build_workflow`) :

```python
class TestTransitionSideConstraint:
    def test_the_database_refuses_a_side_outside_the_four(self, workspace):
        workflow = build_workflow(workspace, "Sides", ["A", "B"], [(["A"], "B", None)])
        source = WorkflowTransitionSource.objects.get(transition__workflow=workflow)
        for field in ("source_side", "target_side"):
            with pytest.raises(IntegrityError), transaction.atomic():
                WorkflowTransitionSource.objects.filter(pk=source.pk).update(**{field: "middle"})
        WorkflowTransitionSource.objects.filter(pk=source.pk).update(source_side="top", target_side="")
```

Run: `docker compose -p wfr2-t10 -f docker-compose-test.yml run --rm --build api-tests pytest --create-db plane/tests/contract/app/test_workflows_app.py plane/tests/unit/models/test_workflow_models.py -v -k "Duplicate or SideConstraint"`
Expected: FAIL (200 au lieu de 400 ; aucune `IntegrityError`).

- [ ] **Step 2: Refuser les doublons**

`serializers/workflow.py`, dans `WorkflowGraphInputSerializer.validate`, avant `return attrs` :

```python
        # Two transitions over the same route make the actor check ambiguous (spec 6.4).
        routes = set()
        for transition in attrs["transitions"]:
            target = transition["target_key"]
            pairs = [("*", target)] if transition["from_any"] else [(source, target) for source in transition["source_keys"]]
            if any(pair in routes for pair in pairs):
                raise graph_error("duplicate_transition")
            routes.update(pairs)
```

- [ ] **Step 3: Ajouter la contrainte et générer la migration**

`db/models/workflow.py`, `WorkflowTransitionSource.Meta.constraints`, après la contrainte d'unicité :

```python
            # The copy of a workflow writes rows without the serializer: the database keeps the rule too.
            models.CheckConstraint(
                condition=Q(source_side__in=["", *TRANSITION_SIDES]) & Q(target_side__in=["", *TRANSITION_SIDES]),
                name="workflow_transition_source_sides_valid",
            ),
```

Run: `docker exec prototype-jira-api-1 python manage.py makemigrations db -n workflow_transition_side_check`
Expected: création de `plane/db/migrations/0131_workflow_transition_side_check.py` (une seule opération `AddConstraint`) et mise à jour de `apps/api/migrations_lockfile.txt`. Ne modifier ni l'un ni l'autre à la main. Si le fichier appartient à `root`, ne pas changer ses droits : `git add` le lit.

Run: `docker exec prototype-jira-api-1 python manage.py migrate db` puis `docker exec prototype-jira-api-1 python manage.py makemigrations --check --dry-run`
Expected: « Applying db.0131_workflow_transition_side_check... OK » puis « No changes detected ».

- [ ] **Step 4: Vérifier**

Run: le test de l'étape 1 (PASS), puis `pytest --create-db plane/tests -k workflow -q`, puis ruff (`check`, `format --check`) sur les fichiers touchés hors migration, puis `docker compose -p wfr2-t10 -f docker-compose-test.yml down -v`.
Expected: tout passe.

- [ ] **Step 5: Commit (deux commits)**

```bash
git add apps/api/plane/app/serializers/workflow.py apps/api/plane/tests/contract/app/test_workflows_app.py
git commit -m "feat(api): refuse two transitions over the same route"
git add apps/api/plane/db/models/workflow.py apps/api/plane/db/migrations/0131_workflow_transition_side_check.py apps/api/migrations_lockfile.txt apps/api/plane/tests/unit/models/test_workflow_models.py
git commit -m "feat(api): constrain the sides of a transition in the database"
```

---

### Task 11: Types, service, store et envoi de l'empreinte (spec 6.1, 6.2)

**Files:**

- Modify: `packages/types/src/workflow.ts`
- Modify: `apps/web/services/workflow.service.ts`, `apps/web/store/workspace/workflow.store.ts`, `workflow.store.test.ts`
- Modify: `apps/web/components/workflow/editor/workflow-editor.tsx`, `workflow-editor.test.tsx`
- Modify: tout fichier de test web dont un littéral `TWorkflowDetail` n'a pas `version` (signalé par `tsc`)

**Interfaces:**

- Consumes : routes des tâches 8 et 9.
- Produces :
  - `TWorkflowDetail` gagne `version: string`
  - `type TWorkflowGraphSavePayload = TWorkflowGraphPayload & { expected_version: string }`
  - `type TWorkflowEditor = { id: string; display_name: string }`
  - `WorkflowService.saveGraph(workspaceSlug, workflowId, payload: TWorkflowGraphSavePayload)` ; `WorkflowService.sendPresence(workspaceSlug: string, workflowId: string, editing: boolean): Promise<{ editors: TWorkflowEditor[] }>`
  - `IWorkflowStore.saveGraph(workspaceSlug, workflowId, payload: TWorkflowGraphSavePayload)` ; `IWorkflowStore.sendPresence(workspaceSlug: string, workflowId: string, editing: boolean): Promise<TWorkflowEditor[]>`
  - `WorkflowEditor` : `onSave: (payload: TWorkflowGraphSavePayload) => Promise<TWorkflowDetail>`

- [ ] **Step 1: Types**

`packages/types/src/workflow.ts` :

```ts
export type TWorkflowDetail = TWorkflowGraph & {
  /** Fingerprint of the graph, sent back with a save (stale save refused). */
  version: string;
  project_count: number;
  projects?: TWorkflowProjectRef[];
};
```

et, sous `TWorkflowGraphPayload` :

```ts
export type TWorkflowGraphSavePayload = TWorkflowGraphPayload & { expected_version: string };

/** Another workspace admin with unsaved changes on the same workflow. */
export type TWorkflowEditor = { id: string; display_name: string };
```

Attendre la reconstruction de `packages/types/dist`.

- [ ] **Step 2: Écrire les tests qui échouent**

`workflow.store.test.ts` : ajouter `version: "v1"` à la fabrique `detail`, puis :

```ts
it("sends the expected version with a graph save", async () => {
  const calls: unknown[] = [];
  const store = buildStore({
    saveGraph: async (_slug: string, id: string, payload: unknown) => {
      calls.push(payload);
      return detail(id, "Saved");
    },
  });
  await store.saveGraph("acme", "a", { states: [], transitions: [], expected_version: "v1" });
  expect(calls).toEqual([{ states: [], transitions: [], expected_version: "v1" }]);
});

it("returns the other editors of a workflow", async () => {
  const calls: unknown[][] = [];
  const store = buildStore({
    sendPresence: async (...args: unknown[]) => {
      calls.push(args);
      return { editors: [{ id: "u", display_name: "Awa" }] };
    },
  });
  expect(await store.sendPresence("acme", "a", true)).toEqual([{ id: "u", display_name: "Awa" }]);
  expect(calls).toEqual([["acme", "a", true]]);
});
```

Adapter l'appel existant `store.saveGraph("acme", "a", { states: [], transitions: [] })` en lui ajoutant `expected_version: "v1"`.

`workflow-editor.test.tsx` : ajouter `version: "v1"` au `workflow` du fichier, typer les `onSave` simulés avec `TWorkflowGraphSavePayload`, puis :

```tsx
it("sends back the version of the workflow it was opened on", async () => {
  const onSave = vi.fn(async (_payload: TWorkflowGraphSavePayload) => workflow);
  renderEditor({ onSave });
  const user = userEvent.setup();
  await addReview(user);
  await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
  expect(onSave.mock.calls[0][0].expected_version).toBe("v1");
});
```

Run: `pnpm --filter=web exec vitest run store/workspace/workflow.store.test.ts components/workflow/editor/workflow-editor.test.tsx`
Expected: FAIL (`sendPresence` absent, `expected_version` absent).

- [ ] **Step 3: Implémenter**

`workflow.service.ts` : importer `TWorkflowEditor`, `TWorkflowGraphSavePayload` ; `saveGraph(workspaceSlug: string, workflowId: string, payload: TWorkflowGraphSavePayload)` ; ajouter :

```ts
  sendPresence(workspaceSlug: string, workflowId: string, editing: boolean): Promise<{ editors: TWorkflowEditor[] }> {
    return this.unwrap(this.post(`/api/workspaces/${workspaceSlug}/workflows/${workflowId}/presence/`, { editing }));
  }
```

`workflow.store.ts` : même changement de type sur `saveGraph` (interface et méthode) ; ajouter à l'interface `sendPresence: (workspaceSlug: string, workflowId: string, editing: boolean) => Promise<TWorkflowEditor[]>;` et à la classe (ce n'est pas une action : rien d'observable ne change) :

```ts
// Nothing is kept: the editors of a workflow only matter to the editor showing them.
sendPresence = async (workspaceSlug: string, workflowId: string, editing: boolean) =>
  (await this.service.sendPresence(workspaceSlug, workflowId, editing)).editors;
```

`workflow-editor.tsx` : `onSave: (payload: TWorkflowGraphSavePayload) => Promise<TWorkflowDetail>;` et, dans `save`, `await onSave({ ...toPayload(draft), expected_version: workflow.version })`. L'empreinte reste hors de `toPayload` : `isDraftDirty` compare des graphes, pas des versions.

- [ ] **Step 4: Vérifier**

Run: `pnpm --filter=web exec tsc --noEmit` (corriger chaque littéral `TWorkflowDetail` de test sans `version` en ajoutant `version: "v1"`), puis `pnpm --filter=web exec vitest run`, puis `pnpm --filter=web exec oxlint --deny-warnings services/workflow.service.ts store/workspace components/workflow`
Expected: tout passe.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/workflow.ts apps/web
git commit -m "feat(web): send the workflow version with a graph save"
```

---

### Task 12: Coque de l'éditeur : 409, présence, renommage partagé (spec 4.5, 4.6, 4.7 ; D7, D12, E3, E10, Y5)

**Files:**

- Modify: `apps/web/components/workflow/editor/workflow-editor.tsx`, `workflow-editor.test.tsx`

**Interfaces:**

- Consumes : `renamedSharedStatuses`, `type TSharedRename` (tâche 1) ; `TWorkflowEditor` (tâche 11) ; `ConfirmDialog` de `@plane/blocks/dialog` (props `isOpen`, `handleClose`, `handleSubmit`, `isSubmitting`, `title`, `content`, `primaryButtonText: { loading, default }`, `secondaryButtonText`) ; clés i18n de la tâche 2.
- Produces : `WorkflowEditor` gagne les props

```ts
  /** Reloads the workflow after a stale save; the page then remounts the editor (Y5). */
  onReload: () => Promise<void>;
  /** Signals unsaved changes and returns the other admins who have some (spec 4.6). */
  onPresence?: (editing: boolean) => Promise<TWorkflowEditor[]>;
  onDirtyChange?: (dirty: boolean) => void;
```

- [ ] **Step 1: Écrire les tests qui échouent**

`workflow-editor.test.tsx` : ajouter `onReload={async () => {}}` aux props par défaut de `editorOf` ; importer `act` ; puis :

```tsx
describe("stale save", () => {
  it("asks to reload and blocks the save", async () => {
    const onReload = vi.fn(async () => {});
    renderEditor({ onSave: vi.fn().mockRejectedValue({ graph: ["stale_graph"] }), onReload });
    const user = userEvent.setup();
    await addReview(user);
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
    const banner = await screen.findByRole("alert");
    expect(within(banner).getByText("workflows.editor.errors.stale_graph")).toBeTruthy();
    expect((screen.getByRole("button", { name: "workflows.editor.save" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(banner).getByRole("button", { name: "workflows.editor.reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("presence", () => {
  it("shows the other admins who are editing", async () => {
    const onPresence = vi.fn(async () => [{ id: "u", display_name: "Awa" }]);
    renderEditor({ onPresence });
    expect((await screen.findByRole("status")).textContent).toBe("workflows.editor.presence");
    expect(onPresence).toHaveBeenCalledWith(false);
  });

  it("signals its own unsaved changes, then their end when it closes", async () => {
    const onPresence = vi.fn(async () => []);
    const { unmount } = renderEditor({ onPresence });
    await addReview(userEvent.setup());
    await waitFor(() => expect(onPresence).toHaveBeenLastCalledWith(true));
    unmount();
    expect(onPresence).toHaveBeenLastCalledWith(false);
  });

  it("asks again every thirty seconds", async () => {
    vi.useFakeTimers();
    try {
      const onPresence = vi.fn(async () => []);
      renderEditor({ onPresence });
      expect(onPresence).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(onPresence).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the banner when the call fails", async () => {
    const onPresence = vi.fn().mockRejectedValue(new Error("down"));
    renderEditor({ onPresence });
    await waitFor(() => expect(onPresence).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is silent for a reader", () => {
    const onPresence = vi.fn(async () => []);
    renderEditor({ readOnly: true, onPresence });
    expect(onPresence).not.toHaveBeenCalled();
  });
});

describe("renaming a shared state", () => {
  const shared = [
    {
      ...statusOf("sa", "Todo"),
      workflow_count: 2,
      workflows: [
        { id: "w", name: "Software" },
        { id: "w2", name: "Bug" },
      ],
    },
    statusOf("sb", "Done"),
  ];
  const rename = async (user: ReturnType<typeof userEvent.setup>) => {
    fireEvent.click(screen.getByText("Todo"));
    const field = screen.getByRole("textbox", { name: "workflows.editor.add_state.name" });
    await user.clear(field);
    await user.type(field, "To do");
    await user.click(screen.getByRole("button", { name: "workflows.editor.save" }));
  };

  it("asks before saving and sends nothing when cancelled", async () => {
    const onSave = vi.fn(async () => workflow);
    renderEditor({ statuses: shared, onSave });
    const user = userEvent.setup();
    await rename(user);
    expect(await screen.findByText("workflows.editor.rename.line")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "workflows.settings.form.cancel" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves once the rename is confirmed", async () => {
    const onSave = vi.fn(async (_payload: TWorkflowGraphSavePayload) => workflow);
    renderEditor({ statuses: shared, onSave });
    const user = userEvent.setup();
    await rename(user);
    await user.click(await screen.findByRole("button", { name: "workflows.editor.rename.confirm" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].states[0].status.name).toBe("To do");
  });

  it("does not ask for a state this workflow is alone to use", async () => {
    const onSave = vi.fn(async () => workflow);
    renderEditor({ onSave });
    await rename(userEvent.setup());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

it("tells the page when unsaved changes appear and go", async () => {
  const onDirtyChange = vi.fn();
  renderEditor({ onDirtyChange });
  const user = userEvent.setup();
  await addReview(user);
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  await user.click(screen.getByRole("button", { name: "workflows.editor.discard" }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});
```

Run: `pnpm --filter=web exec vitest run components/workflow/editor/workflow-editor.test.tsx`
Expected: FAIL sur ces tests.

- [ ] **Step 2: Implémenter**

Dans `workflow-editor.tsx` :

- imports : `ConfirmDialog` de `@plane/blocks/dialog` ; `Button` de `@makeplane/propel/components/button` ; `renamedSharedStatuses`, `type TSharedRename` ; `TWorkflowEditor`, `TWorkflowGraphSavePayload`.
- `const { t, currentLocale } = useTranslation();`
- constantes du module :

```ts
const STALE_KEY = "workflows.editor.errors.stale_graph";
// The server keeps an editing signal 75 seconds (spec 6.2).
const PRESENCE_INTERVAL = 30_000;
```

- états :

```ts
const [editors, setEditors] = useState<TWorkflowEditor[]>([]);
const [renames, setRenames] = useState<TSharedRename[] | null>(null);
const [isReloading, setIsReloading] = useState(false);
```

- après le calcul de `dirty` :

```ts
const isStale = serverError?.key === STALE_KEY;

useEffect(() => {
  onDirtyChange?.(dirty);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the page callback may change identity, only dirty matters
}, [dirty]);
// A closed editor holds no unsaved change.
useEffect(
  () => () => onDirtyChange?.(false),
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- on unmount only
  []
);

// One call both signals this admin's unsaved changes and reads the others' (Y4): at once when the
// draft becomes dirty or clean, then every 30 seconds. A failure only hides the banner.
useEffect(() => {
  if (!canEdit || !onPresence) return;
  let isCurrent = true;
  const beat = () =>
    onPresence(dirty).then(
      (next) => isCurrent && setEditors(next),
      () => isCurrent && setEditors([])
    );
  void beat();
  const timer = window.setInterval(() => void beat(), PRESENCE_INTERVAL);
  return () => {
    isCurrent = false;
    window.clearInterval(timer);
  };
}, [canEdit, dirty, onPresence]);
useEffect(
  () => () => {
    if (canEdit) void onPresence?.(false).catch(() => undefined);
  },
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- on unmount only
  []
);
```

- `save` reçoit la confirmation :

```ts
const save = async (isRenameConfirmed = false) => {
  // Renaming a status other workflows use renames it there too: ask once, here, where it takes effect (E3).
  const renamed = renamedSharedStatuses(draft);
  if (renamed.length > 0 && !isRenameConfirmed) return setRenames(renamed);
  setRenames(null);
  setServerError(null);
  setIsSaving(true);
  try {
    const result = await onSave({ ...toPayload(draft), expected_version: workflow.version });
    setDraft(fromDetail(result, statusesRef.current));
    setToast({ type: "success", title: t("workflows.editor.saved"), message: "" });
  } catch (error) {
    setServerError(getGraphErrorKey(error));
  } finally {
    setIsSaving(false);
  }
};

const reload = async () => {
  setIsReloading(true);
  try {
    await onReload();
  } catch {
    // The stale banner stays, so the reload can be tried again.
    setToast({ type: "error", title: t("workflows.settings.load_error"), message: "" });
  } finally {
    setIsReloading(false);
  }
};
```

- en-tête : `canSave={dirty && errors.length === 0 && !isStale}` et `onSave={() => void save()}` (jamais `onSave={save}` : l'événement du clic serait pris pour la confirmation).
- bandeau de présence, juste après le bandeau `notice` :

```tsx
{
  editors.length > 0 && (
    <p role="status" className="border-b border-subtle bg-layer-1 px-6 py-2 text-body-sm-regular text-secondary">
      {t("workflows.editor.presence", {
        count: editors.length,
        names: new Intl.ListFormat(currentLocale, { style: "long", type: "conjunction" }).format(
          editors.map((editor) => editor.display_name)
        ),
      })}
    </p>
  );
}
```

- dans le bandeau d'alerte, sous `<p>{t(serverError.key)}</p>` :

```tsx
{
  isStale && (
    <Button
      variant="secondary"
      size="sm"
      stretch="auto"
      loading={isReloading}
      label={t("workflows.editor.reload")}
      onClick={() => void reload()}
    />
  );
}
```

- avant la fermeture du `div` racine :

```tsx
<ConfirmDialog
  isOpen={renames !== null}
  handleClose={() => setRenames(null)}
  handleSubmit={() => save(true)}
  isSubmitting={isSaving}
  title={t("workflows.editor.rename.title")}
  content={
    <ul className="space-y-1">
      {(renames ?? []).map((item) => (
        <li key={item.key}>
          {t("workflows.editor.rename.line", {
            from: item.from,
            to: item.to,
            names: new Intl.ListFormat(currentLocale, { style: "short", type: "unit" }).format(item.workflows),
          })}
        </li>
      ))}
    </ul>
  }
  primaryButtonText={{
    loading: t("workflows.editor.rename.confirm"),
    default: t("workflows.editor.rename.confirm"),
  }}
  secondaryButtonText={t("workflows.settings.form.cancel")}
/>
```

Lire `packages/blocks/src/dialog/confirm-dialog.tsx` : si `variant` propose une variante non destructrice, la prendre (un renommage n'est pas une suppression) ; sinon garder la variante par défaut. Si `content` n'accepte pas un élément, passer les lignes jointes par un saut de ligne.

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter=web exec vitest run components/workflow` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/editor`
Expected: tout passe, sortie des tests sans avertissement `act`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/workflow/editor/workflow-editor.tsx apps/web/components/workflow/editor/workflow-editor.test.tsx
git commit -m "feat(web): handle stale saves, presence and shared renames in the editor"
```

---

### Task 13: Page de l'éditeur : garde de sortie, rechargement, présence, invités (spec 4.6, 4.7, 6.6 ; D8, O7, Y5, Y8 ; CA-22, CA-23)

**Files:**

- Create: `apps/web/components/workflow/editor/leave-guard.tsx`, `leave-guard.test.tsx`
- Modify: `apps/web/app/(all)/[workspaceSlug]/workflow-editor/[workflowId]/page.tsx`

**Interfaces:**

- Consumes : `WorkflowEditor` (props `onReload`, `onPresence`, `onDirtyChange`) ; `IWorkflowStore.sendPresence` ; `useBlocker` de `react-router` (8.3.0) ; `ConfirmDialog`.
- Produces : `LeaveGuard` (exporté de `leave-guard.tsx`) : props `{ when: boolean }`.

- [ ] **Step 1: Écrire les tests de la garde**

Créer `leave-guard.test.tsx` (en-tête COPYRIGHT) :

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { LeaveGuard } from "./leave-guard";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const open = (when: boolean) => {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <>
          <LeaveGuard when={when} />
          <Link to="/other">go elsewhere</Link>
        </>
      ),
    },
    { path: "/other", element: <p>other page</p> },
  ]);
  render(<RouterProvider router={router} />);
  return userEvent.setup();
};
const TITLE = "workflows.editor.leave.title";

describe("LeaveGuard", () => {
  it("lets a navigation through when there is nothing to lose", async () => {
    const user = open(false);
    await user.click(screen.getByRole("link", { name: "go elsewhere" }));
    expect(await screen.findByText("other page")).toBeTruthy();
  });

  it("asks before leaving and stays on request", async () => {
    const user = open(true);
    await user.click(screen.getByRole("link", { name: "go elsewhere" }));
    expect(await screen.findByText(TITLE)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "workflows.editor.leave.stay" }));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(screen.queryByText("other page")).toBeNull();
    expect(screen.getByRole("link", { name: "go elsewhere" })).toBeTruthy();
  });

  it("leaves once confirmed", async () => {
    const user = open(true);
    await user.click(screen.getByRole("link", { name: "go elsewhere" }));
    await user.click(await screen.findByRole("button", { name: "workflows.editor.leave.confirm" }));
    expect(await screen.findByText("other page")).toBeTruthy();
  });

  it("warns the browser on tab close only while there is something to lose", () => {
    const fire = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const { unmount } = render(
      <RouterProvider router={createMemoryRouter([{ path: "/", element: <LeaveGuard when /> }])} />
    );
    expect(fire()).toBe(true);
    unmount();
    expect(fire()).toBe(false);
  });
});
```

Run: `pnpm --filter=web exec vitest run components/workflow/editor/leave-guard.test.tsx`
Expected: FAIL (module absent).

- [ ] **Step 2: Créer `leave-guard.tsx`**

```tsx
import { useEffect } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { useTranslation } from "@plane/i18n";

/**
 * Asks before leaving while `when` is true (D8): navigation inside the application through the router,
 * tab close or reload through the browser's own confirmation.
 */
export function LeaveGuard({ when }: { when: boolean }) {
  const { t } = useTranslation();
  const blocker = useBlocker(when);

  useEffect(() => {
    if (!when) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers only show their confirmation when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [when]);

  // A navigation blocked while its reason has gone (saved meanwhile) goes through.
  useEffect(() => {
    if (blocker.state === "blocked" && !when) blocker.proceed();
  }, [blocker, when]);

  return (
    <ConfirmDialog
      isOpen={blocker.state === "blocked"}
      handleClose={() => blocker.reset?.()}
      handleSubmit={() => blocker.proceed?.()}
      title={t("workflows.editor.leave.title")}
      content={t("workflows.editor.leave.body")}
      primaryButtonText={{
        loading: t("workflows.editor.leave.confirm"),
        default: t("workflows.editor.leave.confirm"),
      }}
      secondaryButtonText={t("workflows.editor.leave.stay")}
    />
  );
}
```

Vérifier la signature de `useBlocker` et de `Blocker` (`state`, `proceed`, `reset`) dans les types de `react-router` 8.3.0 installés ; adapter les appels si un nom diffère, sans changer le comportement.

Run: le test de l'étape 1. Expected: PASS (4 tests).

- [ ] **Step 3: Câbler la page**

Cette étape câble des composants déjà testés ; elle se vérifie par les types, le lint et le contrôle à l'écran du coordinateur. Dans `page.tsx` :

- imports : `useCallback`, `useState` de `react` ; `LeaveGuard` ; `NotAuthorizedView` de `@/components/auth-screens/not-authorized-view`.
- store : ajouter `sendPresence` aux méthodes lues de `useWorkflow()`.
- droits (lire dans `@/hooks/store/user` comment `useUserPermissions` expose le rôle du workspace ; la page de la liste des workflows, `settings/(workspace)/workflows/page.tsx`, montre l'usage de `NotAuthorizedView` à reprendre) :

```tsx
// Guests read no workflow (spec 6.6): the server refuses them, the page says so without asking it.
const canRead = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE);
```

Tant que le rôle du workspace n'est pas connu, la page garde son squelette de chargement ; une fois connu et `canRead` faux, elle rend `NotAuthorizedView` et ne lance aucune requête (clés SWR à `null`).

- états et rappels :

```tsx
const [dirty, setDirty] = useState(false);
// Bumped by a reload: the editor is remounted and starts from the workflow just read (Y5).
const [reloads, setReloads] = useState(0);

const reload = async () => {
  await Promise.all([
    fetchWorkflowDetail(workspaceSlug, workflowId),
    fetchStatuses(workspaceSlug),
    isWorkspaceAdmin ? fetchCandidates(workspaceSlug) : undefined,
  ]);
  setReloads((count) => count + 1);
};
// Stable identity: the editor restarts its 30 second timer when this changes.
const reportPresence = useCallback(
  (editing: boolean) => sendPresence(workspaceSlug, workflowId, editing),
  [sendPresence, workspaceSlug, workflowId]
);
```

- rendu : `<LeaveGuard when={dirty} />` à côté de `PageHead` ; sur l'éditeur `key={`${workflow.id}:${reloads}`}`, `onReload={reload}`, `onPresence={isWorkspaceAdmin ? reportPresence : undefined}`, `onDirtyChange={setDirty}`.

- [ ] **Step 4: Vérifier**

Run: `pnpm --filter=web exec vitest run components/workflow` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/editor "app/(all)/[workspaceSlug]/workflow-editor"`
Expected: tout passe.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workflow/editor/leave-guard.tsx apps/web/components/workflow/editor/leave-guard.test.tsx "apps/web/app/(all)/[workspaceSlug]/workflow-editor"
git commit -m "feat(web): guard the editor exit and wire reload and presence"
```

Dans le rapport : dire si `useBlocker` a pu être vérifié seulement sous `createMemoryRouter` (le contrôle dans l'application revient au coordinateur).

---

### Task 14: Onglet Workflows du projet (spec 5 ; D6, E7, Y12 ; CA-25 à CA-29)

**Files:**

- Modify: `apps/web/components/workflow/project/scheme-helpers.ts`, `scheme-helpers.test.ts`
- Create: `apps/web/components/workflow/project/scheme-dialog.tsx`
- Rewrite: `apps/web/components/workflow/project/project-workflow-scheme.tsx`, `project-workflow-scheme.test.tsx`

**Interfaces:**

- Consumes : store `useWorkflow()` (`fetchWorkflows`, `getWorkspaceWorkflows`, `getProjectScheme`, `fetchProjectScheme`, `fetchWorkflowDetail`, `getWorkflowDetail`, `previewProjectScheme`, `applyProjectScheme`, `detachProjectScheme`) ; helpers existants `buildSchemePayload`, `getSchemeErrorKey`, `getSchemeNeeds`, `mergeArrivals`, `needKey`, `pendingNeeds`, `schemeRows` ; clés i18n de la tâche 2. Le serveur ne change pas.
- Produces (exportés de `scheme-helpers.ts`) :
  - `type TSchemeChoice = { defaultWorkflowId: string; items: Record<string, string> }` (identifiant de type vers identifiant de workflow)
  - `schemeChoice(scheme: Pick<TProjectWorkflowScheme, "default_workflow_id" | "items">): TSchemeChoice`
  - `withWorkflowTypes(choice: TSchemeChoice, workflowId: string, typeIds: string[]): TSchemeChoice`
  - `withoutWorkflow(choice: TSchemeChoice, workflowId: string): TSchemeChoice`
  - `withDefault(choice: TSchemeChoice, workflowId: string): TSchemeChoice`
  - `freeTypeIds(choice: TSchemeChoice, typeIds: string[], ownWorkflowId?: string): string[]`
  - `unusedWorkflowIds(choice: TSchemeChoice, workflowIds: string[]): string[]`
- Produces (exportés de `scheme-dialog.tsx`) : `SchemeFormDialog`, `SchemeMappingDialog`, `type TSchemeFormProps`.

- [ ] **Step 1: Écrire les tests des calculs**

Ajouter dans `scheme-helpers.test.ts` (compléter l'import depuis `./scheme-helpers`) :

```ts
describe("scheme choice", () => {
  const choice = schemeChoice({
    default_workflow_id: "w-default",
    items: [
      { issue_type_id: "bug", workflow_id: "w-strict" },
      { issue_type_id: "story", workflow_id: "w-strict" },
    ],
  });
  const allTypes = ["bug", "story", "task", "epic"];

  it("reads a scheme as a default workflow and a workflow per type", () => {
    expect(choice).toEqual({ defaultWorkflowId: "w-default", items: { bug: "w-strict", story: "w-strict" } });
    expect(schemeChoice({ default_workflow_id: null, items: [] })).toEqual({ defaultWorkflowId: "", items: {} });
  });

  it("gives a workflow exactly the chosen types", () => {
    expect(withWorkflowTypes(choice, "w-free", ["task"]).items).toEqual({
      bug: "w-strict",
      story: "w-strict",
      task: "w-free",
    });
    expect(withWorkflowTypes(choice, "w-strict", ["bug", "task"]).items).toEqual({ bug: "w-strict", task: "w-strict" });
  });

  it("sends the types of a removed workflow back to the default one", () => {
    expect(withoutWorkflow(choice, "w-strict")).toEqual({ defaultWorkflowId: "w-default", items: {} });
  });

  it("replaces the default workflow and keeps the other lines", () => {
    expect(withDefault(choice, "w-free")).toEqual({
      defaultWorkflowId: "w-free",
      items: { bug: "w-strict", story: "w-strict" },
    });
    // A workflow that becomes the default one no longer needs its own lines.
    expect(withDefault(choice, "w-strict")).toEqual({ defaultWorkflowId: "w-strict", items: {} });
  });

  it("lists the types a workflow may take: the free ones and its own", () => {
    expect(freeTypeIds(choice, allTypes)).toEqual(["task", "epic"]);
    expect(freeTypeIds(choice, allTypes, "w-strict")).toEqual(allTypes);
  });

  it("lists the workflows that are not in the table yet", () => {
    expect(unusedWorkflowIds(choice, ["w-default", "w-strict", "w-free"])).toEqual(["w-free"]);
  });
});
```

Run: `pnpm --filter=web exec vitest run components/workflow/project/scheme-helpers.test.ts`
Expected: FAIL à l'import.

- [ ] **Step 2: Implémenter les calculs**

À la fin de `scheme-helpers.ts` :

```ts
/** The scheme as the tab edits it: the default workflow, and the workflow of each type that has its own. */
export type TSchemeChoice = { defaultWorkflowId: string; items: Record<string, string> };

export const schemeChoice = (scheme: Pick<TProjectWorkflowScheme, "default_workflow_id" | "items">): TSchemeChoice => ({
  defaultWorkflowId: scheme.default_workflow_id ?? "",
  items: Object.fromEntries(scheme.items.map((item) => [item.issue_type_id, item.workflow_id])),
});

/** The workflow follows exactly these types; a type it had and lost goes back to the default workflow. */
export const withWorkflowTypes = (choice: TSchemeChoice, workflowId: string, typeIds: string[]): TSchemeChoice => ({
  ...choice,
  items: {
    ...Object.fromEntries(Object.entries(choice.items).filter(([, id]) => id !== workflowId)),
    ...Object.fromEntries(typeIds.map((typeId) => [typeId, workflowId])),
  },
});

export const withoutWorkflow = (choice: TSchemeChoice, workflowId: string) => withWorkflowTypes(choice, workflowId, []);

/** Types that followed the new default workflow on their own line now follow it as the default. */
export const withDefault = (choice: TSchemeChoice, workflowId: string): TSchemeChoice => ({
  defaultWorkflowId: workflowId,
  items: Object.fromEntries(Object.entries(choice.items).filter(([, id]) => id !== workflowId)),
});

/** Types a workflow may take: those on the default workflow, plus its own. */
export const freeTypeIds = (choice: TSchemeChoice, typeIds: string[], ownWorkflowId?: string) =>
  typeIds.filter((typeId) => choice.items[typeId] === undefined || choice.items[typeId] === ownWorkflowId);

export const unusedWorkflowIds = (choice: TSchemeChoice, workflowIds: string[]) => {
  const used = new Set([choice.defaultWorkflowId, ...Object.values(choice.items)]);
  return workflowIds.filter((id) => !used.has(id));
};
```

Run: le test de l'étape 1. Expected: PASS.

- [ ] **Step 3: Écrire les tests de l'onglet**

Réécrire `project-workflow-scheme.test.tsx`. Garder l'en-tête COPYRIGHT, les imports, les `vi.mock` de `@plane/blocks/toast`, `use-work-item-type`, `use-project-state`, la fonction `hrefOf` et le rendu sous `MemoryRouter`. Remplacer le reste par :

```tsx
vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    // Lists of names are formatted for the locale: a fixed one keeps the assertions stable.
    currentLocale: "en",
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  }),
}));

type TNeed = {
  state_id: string;
  state_name: string;
  workflow_id: string;
  issue_count: number;
  auto_status_id: string | null;
};
const state = vi.hoisted(() => ({
  scheme: undefined as TProjectWorkflowScheme | undefined,
  workflows: [] as { id: string; name: string }[],
  types: [] as { id: string; name: string }[],
  canManage: true,
  details: {} as Record<string, { states: { status: { id: string; name: string } }[] }>,
  fetchProjectScheme: vi.fn(),
  previewProjectScheme: vi.fn(),
  applyProjectScheme: vi.fn(),
  detachProjectScheme: vi.fn(),
  fetchWorkflowDetail: vi.fn(),
}));
vi.mock("@/hooks/store/use-workflow", () => ({
  useWorkflow: () => ({
    fetchWorkflows: vi.fn().mockResolvedValue([]),
    getWorkspaceWorkflows: () => state.workflows,
    getProjectScheme: () => state.scheme,
    fetchProjectScheme: (...args: unknown[]) => state.fetchProjectScheme(...args),
    fetchWorkflowDetail: (...args: unknown[]) => state.fetchWorkflowDetail(...args),
    getWorkflowDetail: (id: string) => state.details[id],
    previewProjectScheme: (...args: unknown[]) => state.previewProjectScheme(...args),
    applyProjectScheme: (...args: unknown[]) => state.applyProjectScheme(...args),
    detachProjectScheme: (...args: unknown[]) => state.detachProjectScheme(...args),
  }),
}));
vi.mock("@/hooks/store/user", () => ({
  useUserPermissions: () => ({ allowPermissions: () => state.canManage }),
}));

const graph = (id: string, name: string) => ({
  id,
  name,
  description: "",
  updated_at: null,
  states: [],
  transitions: [],
});
const linked = (): TProjectWorkflowScheme => ({
  default_workflow_id: "w-default",
  items: [
    { issue_type_id: "bug", workflow_id: "w-strict" },
    { issue_type_id: "story", workflow_id: "w-strict" },
  ],
  workflows: [graph("w-default", "Software"), graph("w-strict", "Strict")],
});
const strictItems = [
  { issue_type_id: "bug", workflow_id: "w-strict" },
  { issue_type_id: "story", workflow_id: "w-strict" },
];

const S = "workflows.scheme";
const named = (key: string, name: string) => `${S}.${key} ${JSON.stringify({ name })}`;
const button = (name: string) => screen.getByRole("button", { name });
const lastApplied = () => state.applyProjectScheme.mock.calls.at(-1)?.[2];

beforeEach(() => {
  state.scheme = linked();
  state.workflows = [
    { id: "w-default", name: "Software" },
    { id: "w-strict", name: "Strict" },
    { id: "w-free", name: "Kanban" },
  ];
  state.types = [
    { id: "bug", name: "Bug" },
    { id: "story", name: "Story" },
    { id: "task", name: "Task" },
    { id: "epic", name: "Epic" },
  ];
  state.canManage = true;
  state.details = {};
  state.fetchProjectScheme = vi.fn(async () => state.scheme);
  state.previewProjectScheme = vi.fn(async () => [] as TNeed[]);
  state.applyProjectScheme = vi.fn(async () => state.scheme);
  state.detachProjectScheme = vi.fn().mockResolvedValue(undefined);
  state.fetchWorkflowDetail = vi.fn().mockResolvedValue(undefined);
  setToast.mockClear();
});

const open = () => {
  render(
    <MemoryRouter>
      <ProjectWorkflowScheme workspaceSlug="ws" projectId="p1" />
    </MemoryRouter>
  );
  return userEvent.setup();
};

describe("linked project", () => {
  it("shows one row per workflow, the default one first", () => {
    open();
    const [, defaultRow, strictRow] = screen.getAllByRole("row");
    expect(hrefOf(within(defaultRow).getByRole("link", { name: "Software" }))).toBe("/ws/settings/workflows/w-default");
    expect(within(defaultRow).getByText(`${S}.default_badge`)).toBeTruthy();
    expect(within(defaultRow).getByText(`${S}.other_types`)).toBeTruthy();
    expect(within(defaultRow).getByRole("button", { name: `${S}.replace` })).toBeTruthy();
    expect(within(strictRow).getByText("Bug, Story")).toBeTruthy();
    expect(within(strictRow).getByRole("button", { name: named("edit_types_named", "Strict") })).toBeTruthy();
    expect(within(strictRow).getByRole("button", { name: named("remove_named", "Strict") })).toBeTruthy();
  });

  it("adds a workflow for types that follow the default one, from the scheme the server holds", async () => {
    const user = open();
    await user.click(button(`${S}.add`));
    const dialog = screen.getByRole("dialog");
    const workflow = within(dialog).getByRole("combobox", { name: `${S}.table.workflow` });
    expect(
      within(workflow)
        .getAllByRole("option")
        .map((item) => item.textContent)
    ).toEqual([`${S}.choose`, "Kanban"]);
    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .map((box) => box.closest("label")?.textContent)
    ).toEqual(["Task", "Epic"]);
    expect(
      within(dialog).getByText(
        `${S}.taken_note ${JSON.stringify({ count: 2, types: "Bug, Story", workflow: "Strict" })}`
      )
    ).toBeTruthy();
    const submit = within(dialog).getByRole("button", { name: `${S}.add_submit` }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.selectOptions(workflow, "Kanban");
    await user.click(within(dialog).getByRole("checkbox", { name: "Task" }));
    await user.click(submit);
    const payload = {
      default_workflow_id: "w-default",
      items: [...strictItems, { issue_type_id: "task", workflow_id: "w-free" }],
      mappings: [],
    };
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledWith("ws", "p1", payload));
    expect(state.previewProjectScheme).toHaveBeenCalledWith("ws", "p1", payload);
    expect(state.fetchProjectScheme.mock.invocationCallOrder[0]).toBeLessThan(
      state.previewProjectScheme.mock.invocationCallOrder[0]
    );
    expect(setToast).toHaveBeenCalled();
  });

  it("asks where work items go before applying, when some must change state", async () => {
    state.previewProjectScheme = vi.fn(async () => [
      { state_id: "st1", state_name: "Doing", workflow_id: "w-free", issue_count: 3, auto_status_id: null },
    ]);
    state.details = { "w-free": { states: [{ status: { id: "sx", name: "Open" } }] } };
    const user = open();
    await user.click(button(`${S}.add`));
    await user.selectOptions(screen.getByRole("combobox", { name: `${S}.table.workflow` }), "Kanban");
    await user.click(screen.getByRole("checkbox", { name: "Task" }));
    await user.click(button(`${S}.add_submit`));
    const arrival = await screen.findByRole("combobox", { name: /workflows\.scheme\.mapping\.row/ });
    expect(state.applyProjectScheme).not.toHaveBeenCalled();
    const apply = button(`${S}.apply`) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await user.selectOptions(arrival, "Open");
    await user.click(apply);
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied().mappings).toEqual([{ state_id: "st1", workflow_id: "w-free", status_id: "sx" }]);
  });

  it("changes the types of a workflow", async () => {
    const user = open();
    await user.click(button(named("edit_types_named", "Strict")));
    const dialog = screen.getByRole("dialog");
    const boxes = within(dialog).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => [box.closest("label")?.textContent, box.checked])).toEqual([
      ["Bug", true],
      ["Story", true],
      ["Task", false],
      ["Epic", false],
    ]);
    await user.click(within(dialog).getByRole("checkbox", { name: "Story" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Task" }));
    await user.click(within(dialog).getByRole("button", { name: `${S}.apply` }));
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied().items).toEqual([
      { issue_type_id: "bug", workflow_id: "w-strict" },
      { issue_type_id: "task", workflow_id: "w-strict" },
    ]);
  });

  it("removes a workflow after a confirmation that names its types", async () => {
    const user = open();
    await user.click(button(named("remove_named", "Strict")));
    expect(
      screen.getByText(`${S}.remove_confirm ${JSON.stringify({ count: 2, types: "Bug, Story", default: "Software" })}`)
    ).toBeTruthy();
    expect(state.applyProjectScheme).not.toHaveBeenCalled();
    await user.click(button(`${S}.remove`));
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied()).toEqual({ default_workflow_id: "w-default", items: [], mappings: [] });
  });

  it("replaces the default workflow", async () => {
    const user = open();
    await user.click(button(`${S}.replace`));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: `${S}.table.workflow` }), "Kanban");
    await user.click(within(dialog).getByRole("button", { name: `${S}.replace` }));
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied()).toEqual({ default_workflow_id: "w-free", items: strictItems, mappings: [] });
  });

  it("says why no workflow can be added when every one is in the table", () => {
    state.workflows = state.workflows.slice(0, 2);
    open();
    expect((button(`${S}.add`) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(`${S}.no_workflow`)).toBeTruthy();
  });

  it("shows a refusal of the server in the dialog", async () => {
    state.previewProjectScheme = vi.fn().mockRejectedValue({ scheme: ["invalid_scheme"] });
    const user = open();
    await user.click(button(`${S}.replace`));
    await user.selectOptions(screen.getByRole("combobox", { name: `${S}.table.workflow` }), "Kanban");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: `${S}.replace` }));
    expect((await screen.findByRole("alert")).textContent).toBe(`${S}.errors.invalid_scheme`);
    expect(state.applyProjectScheme).not.toHaveBeenCalled();
  });

  it("offers no action to who cannot manage the project", () => {
    state.canManage = false;
    open();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.getByRole("link", { name: "Strict" })).toBeTruthy();
  });

  it("stops using workflows after a confirmation", async () => {
    const user = open();
    await user.click(button(`${S}.detach`));
    expect(screen.getByText(`${S}.detach_confirm`)).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: `${S}.detach` }).at(-1) as HTMLElement;
    await user.click(confirm);
    await waitFor(() => expect(state.detachProjectScheme).toHaveBeenCalledWith("ws", "p1"));
  });
});

describe("project without a workflow", () => {
  beforeEach(() => {
    state.scheme = { default_workflow_id: null, items: [], workflows: [] };
  });

  it("links a first workflow, which becomes the default one for every type", async () => {
    const user = open();
    expect(screen.getByText(`${S}.free`)).toBeTruthy();
    await user.click(button(`${S}.link`));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).getByText(`${S}.link_note`)).toBeTruthy();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: `${S}.table.workflow` }), "Software");
    await user.click(within(dialog).getByRole("button", { name: `${S}.link_submit` }));
    await waitFor(() => expect(state.applyProjectScheme).toHaveBeenCalledTimes(1));
    expect(lastApplied()).toEqual({ default_workflow_id: "w-default", items: [], mappings: [] });
  });
});
```

Ajouter `within` et `waitFor` à l'import de `@testing-library/react` s'ils manquent.

Run: `pnpm --filter=web exec vitest run components/workflow/project/project-workflow-scheme.test.tsx`
Expected: FAIL (l'onglet a encore son assistant à une ligne par type).

- [ ] **Step 4: Créer `scheme-dialog.tsx`**

En-tête COPYRIGHT ; mêmes imports `Dialog*` et `Button` que `add-transition-dialog.tsx`.

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowMappingNeed } from "@plane/types";
// local imports
import { needKey } from "./scheme-helpers";

type TNamed = { id: string; name: string };

const SELECT_CLASS = "rounded-md border border-subtle bg-layer-1 px-2 py-1.5 text-body-sm-regular max-md:min-h-11";
const LABEL_CLASS = "flex flex-col gap-1 text-body-xs-medium text-secondary";
const NOTE_CLASS = "text-caption-sm-regular text-tertiary";
const ALERT_CLASS = "text-body-sm-regular text-danger-primary";

export type TSchemeFormProps = {
  isOpen: boolean;
  title: string;
  submitLabel: string;
  /** Workflows to choose from; the only one of the list when the workflow is fixed (edit types). */
  workflows: TNamed[];
  isWorkflowFixed?: boolean;
  /** Types to tick; undefined when the workflow applies to every type (link, replace). */
  types?: TNamed[];
  checkedTypeIds?: string[];
  notes: string[];
  isBusy: boolean;
  errorKey: string | null;
  onSubmit: (workflowId: string, typeIds: string[]) => void;
  onClose: () => void;
};

/** One form for the four changes of a project scheme: link, add a workflow, edit its types, replace the default. */
export function SchemeFormDialog(props: TSchemeFormProps) {
  const { isOpen, title, submitLabel, workflows, isWorkflowFixed = false, types, checkedTypeIds, notes } = props;
  const { isBusy, errorKey, onSubmit, onClose } = props;
  const { t } = useTranslation();
  const [workflowId, setWorkflowId] = useState("");
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const fixedId = isWorkflowFixed ? (workflows[0]?.id ?? "") : "";
  // Compared as a string: the parent builds a new array on every render.
  const initialTypes = (checkedTypeIds ?? []).join(",");

  useEffect(() => {
    if (!isOpen) return;
    setWorkflowId(fixedId);
    setTypeIds(initialTypes ? initialTypes.split(",") : []);
  }, [isOpen, fixedId, initialTypes]);

  // Sent in the order of the list, whatever the order of the clicks.
  const orderedTypeIds = (types ?? []).map((type) => type.id).filter((id) => typeIds.includes(id));
  const isValid = workflowId !== "" && (types === undefined || orderedTypeIds.length > 0);

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
            if (isValid) onSubmit(workflowId, orderedTypeIds);
          }}
        >
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{title}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-4">
                <label className={LABEL_CLASS}>
                  {t("workflows.scheme.table.workflow")}
                  <select
                    className={SELECT_CLASS}
                    value={workflowId}
                    disabled={isWorkflowFixed}
                    onChange={(event) => setWorkflowId(event.target.value)}
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
                {types && (
                  <fieldset className="space-y-1">
                    <legend className="text-body-xs-medium text-secondary">{t("workflows.scheme.types_field")}</legend>
                    {types.map((type) => (
                      <label
                        key={type.id}
                        className="flex items-center gap-2 text-body-sm-regular text-primary max-md:min-h-11"
                      >
                        <input
                          type="checkbox"
                          checked={typeIds.includes(type.id)}
                          onChange={() =>
                            setTypeIds((current) =>
                              current.includes(type.id) ? current.filter((id) => id !== type.id) : [...current, type.id]
                            )
                          }
                        />
                        {type.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                {notes.map((note) => (
                  <p key={note} className={NOTE_CLASS}>
                    {note}
                  </p>
                ))}
                {errorKey && (
                  <p role="alert" className={ALERT_CLASS}>
                    {t(errorKey)}
                  </p>
                )}
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              disabled={isBusy}
              label={t("workflows.settings.form.cancel")}
              onClick={onClose}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              loading={isBusy}
              disabled={!isValid || isBusy}
              label={submitLabel}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type TMappingProps = {
  isOpen: boolean;
  needs: TWorkflowMappingNeed[];
  arrivals: Record<string, string>;
  statesOf: (workflowId: string) => TNamed[];
  workflowName: (workflowId: string) => string;
  isBusy: boolean;
  errorKey: string | null;
  onArrival: (key: string, statusId: string) => void;
  onApply: () => void;
  onClose: () => void;
};

/** Second step (W10): where the work items of states missing from their new workflow go. Nothing moves before Apply. */
export function SchemeMappingDialog(props: TMappingProps) {
  const { isOpen, needs, arrivals, statesOf, workflowName, isBusy, errorKey, onArrival, onApply, onClose } = props;
  const { t } = useTranslation();

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>{t("workflows.scheme.mapping.title")}</DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody tabIndex={0}>
            <div className="space-y-4">
              <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.mapping.description")}</p>
              {needs.map((need) => (
                <label key={needKey(need)} className={LABEL_CLASS}>
                  {t("workflows.scheme.mapping.row", {
                    state: need.state_name,
                    workflow: workflowName(need.workflow_id),
                    count: need.issue_count,
                  })}
                  <select
                    className={SELECT_CLASS}
                    value={arrivals[needKey(need)] ?? ""}
                    onChange={(event) => onArrival(needKey(need), event.target.value)}
                  >
                    <option value="" disabled>
                      {t("workflows.scheme.mapping.pick")}
                    </option>
                    {statesOf(need.workflow_id).map((state) => (
                      <option key={state.id} value={state.id}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {errorKey && (
                <p role="alert" className={ALERT_CLASS}>
                  {t(errorKey)}
                </p>
              )}
            </div>
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            disabled={isBusy}
            label={t("workflows.settings.form.cancel")}
            onClick={onClose}
          />
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            loading={isBusy}
            disabled={isBusy || needs.some((need) => !arrivals[needKey(need)])}
            label={t("workflows.scheme.apply")}
            onClick={onApply}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Réécrire `project-workflow-scheme.tsx`**

Garder l'en-tête COPYRIGHT. Fichier complet :

```tsx
import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Button } from "@makeplane/propel/components/button";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { setToast } from "@plane/blocks/toast";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowMappingNeed } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { useWorkflow } from "@/hooks/store/use-workflow";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { SchemeFormDialog, SchemeMappingDialog, type TSchemeFormProps } from "./scheme-dialog";
import {
  buildSchemePayload,
  freeTypeIds,
  getSchemeErrorKey,
  getSchemeNeeds,
  mergeArrivals,
  pendingNeeds,
  schemeChoice,
  schemeRows,
  unusedWorkflowIds,
  withDefault,
  withWorkflowTypes,
  withoutWorkflow,
  type TSchemeChoice,
} from "./scheme-helpers";

type Props = { workspaceSlug: string; projectId: string };

type TAction =
  | { kind: "link" }
  | { kind: "add" }
  | { kind: "replace" }
  | { kind: "types"; workflowId: string }
  | { kind: "remove"; workflowId: string };
type TForm = Pick<
  TSchemeFormProps,
  "title" | "submitLabel" | "workflows" | "isWorkflowFixed" | "types" | "checkedTypeIds" | "notes" | "onSubmit"
>;

// Shown for a type unknown to the store (deleted meanwhile, or not loaded yet).
const UNKNOWN = "-";
const ACTION_CLASS = "rounded-sm text-body-xs-medium text-accent-primary hover:underline max-md:min-h-11";
const CELL_CLASS = "border-b border-subtle p-2";

export const ProjectWorkflowScheme = observer(function ProjectWorkflowScheme({ workspaceSlug, projectId }: Props) {
  const { t, currentLocale } = useTranslation();
  const {
    fetchWorkflows,
    getWorkspaceWorkflows,
    getProjectScheme,
    fetchProjectScheme,
    fetchWorkflowDetail,
    getWorkflowDetail,
    previewProjectScheme,
    applyProjectScheme,
    detachProjectScheme,
  } = useWorkflow();
  const { getProjectAssignableTypes } = useWorkItemType();
  const { fetchProjectStates } = useProjectState();
  const { allowPermissions } = useUserPermissions();
  // Display only (A4): the server refuses every write from anyone else.
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const scheme = getProjectScheme(projectId);
  const workflows = getWorkspaceWorkflows(workspaceSlug);
  const types = getProjectAssignableTypes(workspaceSlug, projectId).map((type) => ({
    id: type.id as string,
    name: type.name as string,
  }));

  const [action, setAction] = useState<TAction | null>(null);
  const [mapping, setMapping] = useState<{ choice: TSchemeChoice; needs: TWorkflowMappingNeed[] } | null>(null);
  const [arrivals, setArrivals] = useState<Record<string, string>>({});
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDetachOpen, setIsDetachOpen] = useState(false);

  const rows = scheme ? schemeRows(scheme) : [];
  const choice = schemeChoice(scheme ?? { default_workflow_id: null, items: [] });
  const typeIds = types.map((type) => type.id);
  const names = new Intl.ListFormat(currentLocale, { style: "short", type: "unit" });
  const workflowName = (id: string) =>
    workflows.find((workflow) => workflow.id === id)?.name ?? t("workflows.scheme.table.unknown_workflow");
  const typeNames = (ids: string[]) =>
    names.format(ids.map((id) => types.find((type) => type.id === id)?.name ?? UNKNOWN));
  const toNamed = (id: string) => ({ id, name: workflowName(id) });
  const unused = unusedWorkflowIds(
    choice,
    workflows.map((workflow) => workflow.id)
  ).map(toNamed);
  const typesFor = (ownWorkflowId?: string) => {
    const free = freeTypeIds(choice, typeIds, ownWorkflowId);
    return types.filter((type) => free.includes(type.id));
  };
  // Why a type is missing from the list: it already follows another workflow of the table.
  const takenNotes = (exceptWorkflowId?: string) =>
    rows
      .filter((row) => !row.isDefault && row.typeIds.length > 0 && row.workflowId !== exceptWorkflowId)
      .map((row) =>
        t("workflows.scheme.taken_note", {
          count: row.typeIds.length,
          types: typeNames(row.typeIds),
          workflow: workflowName(row.workflowId),
        })
      );
  const addBlocker =
    unused.length === 0 ? "workflows.scheme.no_workflow" : typesFor().length === 0 ? "workflows.scheme.no_type" : null;

  const start = (next: TAction) => {
    setErrorKey(null);
    setAction(next);
  };
  const close = () => {
    setAction(null);
    setMapping(null);
    setArrivals({});
    setErrorKey(null);
  };

  const applyChoice = async (next: TSchemeChoice, chosen: Record<string, string>) => {
    await applyProjectScheme(
      workspaceSlug,
      projectId,
      buildSchemePayload(next.defaultWorkflowId, next.items, chosen, typeIds)
    );
    await Promise.allSettled([fetchProjectStates(workspaceSlug, projectId), fetchWorkflows(workspaceSlug)]);
    close();
    setToast({ type: "success", title: t("workflows.scheme.applied"), message: "" });
  };

  // Every change starts from the scheme the server holds now, not from the copy on screen (Y12), and
  // is applied at once unless work items must change state (W10).
  const run = async (change: (current: TSchemeChoice) => TSchemeChoice) => {
    setErrorKey(null);
    setIsBusy(true);
    try {
      const next = change(schemeChoice(await fetchProjectScheme(workspaceSlug, projectId)));
      const payload = buildSchemePayload(next.defaultWorkflowId, next.items, {}, typeIds);
      const needs = pendingNeeds(await previewProjectScheme(workspaceSlug, projectId, payload));
      if (needs.length === 0) return await applyChoice(next, {});
      const involved = [...new Set(needs.map((need) => need.workflow_id))];
      await Promise.all(involved.map((workflowId) => fetchWorkflowDetail(workspaceSlug, workflowId)));
      setArrivals({});
      setMapping({ choice: next, needs });
    } catch (error) {
      // A confirmation has no room for a message: it closes and the page shows the refusal.
      if (action?.kind === "remove") setAction(null);
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const applyMapping = async () => {
    if (!mapping) return;
    setErrorKey(null);
    setIsBusy(true);
    try {
      await applyChoice(mapping.choice, arrivals);
    } catch (error) {
      const refreshed = getSchemeNeeds(error);
      if (refreshed) {
        setMapping({ choice: mapping.choice, needs: refreshed });
        setArrivals((current) => mergeArrivals(current, refreshed));
      }
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsBusy(false);
    }
  };

  const detach = async () => {
    setIsBusy(true);
    try {
      await detachProjectScheme(workspaceSlug, projectId);
      await Promise.allSettled([fetchProjectStates(workspaceSlug, projectId), fetchWorkflows(workspaceSlug)]);
      setToast({ type: "success", title: t("workflows.scheme.detached"), message: "" });
    } catch (error) {
      setErrorKey(getSchemeErrorKey(error));
    } finally {
      setIsDetachOpen(false);
      setIsBusy(false);
    }
  };

  const formOf = (current: TAction | null): TForm | null => {
    if (current?.kind === "link")
      return {
        title: t("workflows.scheme.link"),
        submitLabel: t("workflows.scheme.link_submit"),
        workflows: workflows.map((workflow) => toNamed(workflow.id)),
        notes: [t("workflows.scheme.link_note")],
        onSubmit: (workflowId) => void run(() => ({ defaultWorkflowId: workflowId, items: {} })),
      };
    if (current?.kind === "add")
      return {
        title: t("workflows.scheme.add"),
        submitLabel: t("workflows.scheme.add_submit"),
        workflows: unused,
        types: typesFor(),
        notes: [...takenNotes(), t("workflows.scheme.unchecked_note")],
        onSubmit: (workflowId, ids) => void run((latest) => withWorkflowTypes(latest, workflowId, ids)),
      };
    if (current?.kind === "types")
      return {
        title: t("workflows.scheme.edit_types_named", { name: workflowName(current.workflowId) }),
        submitLabel: t("workflows.scheme.apply"),
        workflows: [toNamed(current.workflowId)],
        isWorkflowFixed: true,
        types: typesFor(current.workflowId),
        checkedTypeIds: rows.find((row) => row.workflowId === current.workflowId)?.typeIds ?? [],
        notes: [...takenNotes(current.workflowId), t("workflows.scheme.unchecked_note")],
        onSubmit: (workflowId, ids) => void run((latest) => withWorkflowTypes(latest, workflowId, ids)),
      };
    if (current?.kind === "replace")
      return {
        title: t("workflows.scheme.replace_title"),
        submitLabel: t("workflows.scheme.replace"),
        workflows: unused,
        notes: [t("workflows.scheme.link_note")],
        onSubmit: (workflowId) => void run((latest) => withDefault(latest, workflowId)),
      };
    return null;
  };
  const form = formOf(action);
  const removed = action?.kind === "remove" ? rows.find((row) => row.workflowId === action.workflowId) : undefined;
  const isDialogOpen = action !== null || mapping !== null;

  return (
    <div className="space-y-6">
      {rows.length === 0 ? (
        <div className="space-y-3">
          <p className="text-body-sm-regular text-secondary">{t("workflows.scheme.free")}</p>
          {canManage && (
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              label={t("workflows.scheme.link")}
              onClick={() => start({ kind: "link" })}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {canManage && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {addBlocker && <p className="text-caption-sm-regular text-tertiary">{t(addBlocker)}</p>}
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                disabled={addBlocker !== null}
                label={t("workflows.scheme.add")}
                onClick={() => start({ kind: "add" })}
              />
              <Button
                variant="danger-outline"
                size="md"
                stretch="auto"
                label={t("workflows.scheme.detach")}
                onClick={() => setIsDetachOpen(true)}
              />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate border-spacing-0" aria-label={t("workflows.label")}>
              <thead>
                <tr className="text-left text-body-xs-medium text-secondary">
                  {(canManage ? (["workflow", "types", "actions"] as const) : (["workflow", "types"] as const)).map(
                    (column) => (
                      <th key={column} scope="col" className={CELL_CLASS}>
                        {t(`workflows.scheme.table.${column}`)}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = workflowName(row.workflowId);
                  return (
                    <tr key={row.workflowId} className="align-top text-body-sm-regular text-primary">
                      <td className={CELL_CLASS}>
                        <Link
                          href={`/${workspaceSlug}/settings/workflows/${row.workflowId}`}
                          className="text-body-sm-medium hover:underline"
                        >
                          {name}
                        </Link>
                        {row.isDefault && (
                          <span className="ml-2 rounded-sm border border-subtle px-1.5 py-0.5 text-caption-sm-medium text-secondary">
                            {t("workflows.scheme.default_badge")}
                          </span>
                        )}
                      </td>
                      <td className={`${CELL_CLASS} text-secondary`}>
                        {row.isDefault ? t("workflows.scheme.other_types") : typeNames(row.typeIds)}
                      </td>
                      {canManage && (
                        <td className={CELL_CLASS}>
                          {row.isDefault ? (
                            <button
                              type="button"
                              className={ACTION_CLASS}
                              disabled={unused.length === 0}
                              onClick={() => start({ kind: "replace" })}
                            >
                              {t("workflows.scheme.replace")}
                            </button>
                          ) : (
                            <span className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                className={ACTION_CLASS}
                                aria-label={t("workflows.scheme.edit_types_named", { name })}
                                onClick={() => start({ kind: "types", workflowId: row.workflowId })}
                              >
                                {t("workflows.scheme.edit_types")}
                              </button>
                              <button
                                type="button"
                                className={ACTION_CLASS}
                                aria-label={t("workflows.scheme.remove_named", { name })}
                                onClick={() => start({ kind: "remove", workflowId: row.workflowId })}
                              >
                                {t("workflows.scheme.remove")}
                              </button>
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {errorKey && !isDialogOpen && (
        <p role="alert" className="text-body-sm-regular text-danger-primary">
          {t(errorKey)}
        </p>
      )}
      {form && (
        <SchemeFormDialog {...form} isOpen={mapping === null} isBusy={isBusy} errorKey={errorKey} onClose={close} />
      )}
      <SchemeMappingDialog
        isOpen={mapping !== null}
        needs={mapping?.needs ?? []}
        arrivals={arrivals}
        statesOf={(workflowId) =>
          (getWorkflowDetail(workflowId)?.states ?? []).map((state) => ({
            id: state.status.id,
            name: state.status.name,
          }))
        }
        workflowName={workflowName}
        isBusy={isBusy}
        errorKey={errorKey}
        onArrival={(key, statusId) => setArrivals((current) => ({ ...current, [key]: statusId }))}
        onApply={() => void applyMapping()}
        onClose={close}
      />
      <ConfirmDialog
        isOpen={removed !== undefined && mapping === null}
        handleClose={close}
        handleSubmit={() => (removed ? run((latest) => withoutWorkflow(latest, removed.workflowId)) : undefined)}
        isSubmitting={isBusy}
        title={t("workflows.scheme.remove_title", { name: removed ? workflowName(removed.workflowId) : "" })}
        content={t("workflows.scheme.remove_confirm", {
          count: removed?.typeIds.length ?? 0,
          types: typeNames(removed?.typeIds ?? []),
          default: workflowName(choice.defaultWorkflowId),
        })}
        primaryButtonText={{ loading: t("workflows.scheme.remove"), default: t("workflows.scheme.remove") }}
      />
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

Le libellé visible « Modifier les types » fait partie du nom accessible « Modifier les types de Strict » ; de même pour « Retirer ». `schemeRows` et son type restent ceux du fichier ; l'export `scheme.workflows` du système n'est plus lu ici (les noms viennent de la liste des workflows du workspace, que la page charge).

- [ ] **Step 6: Vérifier**

Run: `pnpm --filter=web exec vitest run components/workflow/project` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/project`
Expected: tout passe. Si un test échoue parce qu'un nom accessible de `ConfirmDialog` diffère de ce que le test suppose (bouton principal nommé par `primaryButtonText.default`), lire `packages/blocks/src/dialog/confirm-dialog.tsx` et corriger le test, pas le composant partagé.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/workflow/project
git commit -m "feat(web): manage project workflows one workflow at a time"
```

---

### Task 15: Taille lisible des états (spec 4.8 ; D9, E11, Y9 ; CA-24)

Commit à part : l'utilisateur le teste avant qu'on le garde. Le coordinateur le lui rappelle après cette tâche.

**Files:**

- Modify: `apps/web/components/workflow/editor/graph-model.ts`, `graph-model.links.test.ts`
- Modify: `apps/web/components/workflow/editor/workflow-canvas.tsx`, `workflow-canvas.test.tsx`

**Interfaces:**

- Consumes : `@xyflow/react` 12.12.0 : `getViewportForBounds(bounds, width, height, minZoom, maxZoom, padding)`, `useNodesInitialized()`, `useReactFlow()` (`fitView`, `getNodes`, `getNodesBounds`), `useStore`.
- Produces (exportés de `graph-model.ts`) : `READABLE_ZOOM = 1` ; `refitTarget(zoomToFitAll: number, isOpening: boolean, hasGrown: boolean): "all" | "start" | "last" | "keep"`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `graph-model.links.test.ts` (compléter l'import) :

```ts
describe("refitTarget", () => {
  it("shows the whole diagram when it fits at a readable size", () => {
    expect(refitTarget(READABLE_ZOOM, true, false)).toBe("all");
    expect(refitTarget(READABLE_ZOOM, false, true)).toBe("all");
  });

  it("opens on the start when the diagram is too large", () => {
    expect(refitTarget(0.4, true, false)).toBe("start");
  });

  it("then follows the state just added, and stays put after a removal", () => {
    expect(refitTarget(0.4, false, true)).toBe("last");
    expect(refitTarget(0.4, false, false)).toBe("keep");
  });
});
```

Run: `pnpm --filter=web exec vitest run components/workflow/editor/graph-model.links.test.ts`
Expected: FAIL à l'import.

- [ ] **Step 2: Implémenter la décision**

Dans `graph-model.ts`, sous `startPlacement` :

```ts
// State names are 11px at zoom 1 (text-caption-sm): an automatic refit never goes below it (D9).
export const READABLE_ZOOM = 1;

/** What an automatic refit shows (D9): everything when it stays readable, else a part at the readable zoom. */
export const refitTarget = (zoomToFitAll: number, isOpening: boolean, hasGrown: boolean) => {
  if (zoomToFitAll >= READABLE_ZOOM) return "all" as const;
  if (isOpening) return "start" as const;
  return hasGrown ? ("last" as const) : ("keep" as const);
};
```

Run: le test de l'étape 1. Expected: PASS.

- [ ] **Step 3: Brancher le diagramme**

Dans `workflow-canvas.tsx` :

- imports de `@xyflow/react` : ajouter `getViewportForBounds`, `useNodesInitialized` ; de `./graph-model` : `READABLE_ZOOM`, `refitTarget`.
- constantes : `const FIT_PADDING = 0.2;` `const MIN_ZOOM = 0.25;` ; `FIT_VIEW_OPTIONS = { padding: FIT_PADDING, maxZoom: 1 }` ; utiliser `MIN_ZOOM` pour `minZoom` de `ReactFlow` et du curseur.
- sous `ZoomSlider`, un composant rendu à l'intérieur de `ReactFlow` (il lit son store) :

```tsx
type TReadableFitProps = { stateCount: number; startKeys: string[]; lastKey?: string };

// Refits when a state is added or removed, never on a pan or a drag (R12), and never below the
// readable zoom (D9): a diagram too large opens on its start, then follows the state just added.
function ReadableFit({ stateCount, startKeys, lastKey }: TReadableFitProps) {
  const isMeasured = useNodesInitialized();
  const { fitView, getNodes, getNodesBounds } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const previousCount = useRef<number | null>(null);

  useEffect(() => {
    if (!isMeasured) return;
    const isOpening = previousCount.current === null;
    const hasGrown = previousCount.current !== null && stateCount > previousCount.current;
    previousCount.current = stateCount;
    const zoom = getViewportForBounds(getNodesBounds(getNodes()), width, height, MIN_ZOOM, 1, FIT_PADDING).zoom;
    const target = refitTarget(zoom, isOpening, hasGrown);
    if (target === "keep") return;
    const focus = target === "start" ? startKeys : target === "last" && lastKey ? [lastKey] : null;
    void fitView(
      focus ? { ...FIT_VIEW_OPTIONS, minZoom: READABLE_ZOOM, nodes: focus.map((id) => ({ id })) } : FIT_VIEW_OPTIONS
    );
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a resize or a new callback identity must not move the view
  }, [isMeasured, stateCount]);

  return null;
}
```

- dans `WorkflowCanvas` : supprimer l'effet `useEffect(() => { const frame = requestAnimationFrame(...) }, [stateCount])` et les props `fitView` et `fitViewOptions` de `ReactFlow` ; ajouter parmi les enfants de `ReactFlow` :

```tsx
<ReadableFit
  stateCount={draft.states.length}
  startKeys={initial ? [START_NODE_ID, initial.key] : [START_NODE_ID]}
  lastKey={draft.states[draft.states.length - 1]?.key}
/>
```

Vérifier les quatre noms importés dans `apps/web/node_modules/@xyflow/react/dist/esm/` ; si la signature de `getViewportForBounds` diffère, garder le comportement (zoom nécessaire pour tout voir, borné à 1).

- [ ] **Step 4: Adapter les tests du diagramme**

Lancer `pnpm --filter=web exec vitest run components/workflow/editor/workflow-canvas.test.tsx components/workflow/editor/workflow-editor.test.tsx`. Un test existant qui attendait `fitView` par la prop ou par `requestAnimationFrame` s'adapte au nouveau mécanisme (sous jsdom la vue mesure 0 sur 0 : le diagramme « ne tient pas », donc `fitView` reçoit `nodes`). Ajouter dans `workflow-canvas.test.tsx` :

```tsx
it("never refits below the readable zoom", async () => {
  renderCanvas();
  await waitFor(() => expect(flowInstance.current).toBeDefined());
  expect(flowProps.current?.fitView).toBeUndefined();
  expect(flowProps.current?.minZoom).toBe(0.25);
});
```

- [ ] **Step 5: Vérifier**

Run: `pnpm --filter=web exec vitest run components/workflow` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/editor`
Expected: tout passe, sans boucle de rendu (le test X6 existant du diagramme reste vert).

- [ ] **Step 6: Commit (seul, sans autre changement)**

```bash
git add apps/web/components/workflow/editor/graph-model.ts apps/web/components/workflow/editor/graph-model.links.test.ts apps/web/components/workflow/editor/workflow-canvas.tsx apps/web/components/workflow/editor/workflow-canvas.test.tsx
git commit -m "feat(web): keep state names readable when the diagram is refitted"
```

Donner le hash de ce commit dans le rapport : s'il ne convient pas à l'utilisateur, il est annulé par `git revert`, sans toucher au reste.

---

### Task 16: Consignes clavier du diagramme traduites (O5 ; spec 7)

**Files:**

- Modify: `apps/web/components/workflow/editor/workflow-canvas.tsx`, `workflow-canvas.test.tsx`

**Interfaces:**

- Consumes : prop `ariaLabelConfig` de `ReactFlow` (clés `node.a11yDescription.default`, `node.a11yDescription.keyboardDisabled`, `node.a11yDescription.ariaLiveMessage`, `edge.a11yDescription.default`, `minimap.ariaLabel`, `handle.ariaLabel`, définies dans `@xyflow/system/dist/esm/constants.d.ts`) ; clés i18n `workflows.editor.a11y.*` de la tâche 2.
- Produces : rien d'autre.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `workflow-canvas.test.tsx` :

```tsx
describe("keyboard instructions", () => {
  it("are translated for who can edit", () => {
    renderCanvas();
    const config = flowProps.current?.ariaLabelConfig;
    expect(config?.["node.a11yDescription.default"]).toBe("workflows.editor.a11y.node");
    expect(config?.["node.a11yDescription.keyboardDisabled"]).toBe("workflows.editor.a11y.node_read_only");
    expect(config?.["edge.a11yDescription.default"]).toBe("workflows.editor.a11y.edge");
    expect(config?.["minimap.ariaLabel"]).toBe("workflows.editor.minimap");
    expect(config?.["handle.ariaLabel"]).toBe("workflows.editor.a11y.handle");
    expect(config?.["node.a11yDescription.ariaLiveMessage"]?.({ direction: "up", x: 12, y: 34 })).toBe(
      'workflows.editor.a11y.moved {"x":12,"y":34}'
    );
  });

  it("promise no move and no removal to a reader", () => {
    renderCanvas({ canEdit: false });
    expect(flowProps.current?.ariaLabelConfig?.["node.a11yDescription.default"]).toBe(
      "workflows.editor.a11y.node_read_only"
    );
  });
});
```

Run: `pnpm --filter=web exec vitest run components/workflow/editor/workflow-canvas.test.tsx`
Expected: FAIL (`ariaLabelConfig` absent).

- [ ] **Step 2: Implémenter**

Dans `WorkflowCanvas`, avant le `return` :

```tsx
// React Flow's built-in screen reader instructions, in the interface language. Memoised: a new object on
// every render would be written to its store each time.
const ariaLabelConfig = useMemo(
  () => ({
    "node.a11yDescription.default": t(canEdit ? "workflows.editor.a11y.node" : "workflows.editor.a11y.node_read_only"),
    "node.a11yDescription.keyboardDisabled": t("workflows.editor.a11y.node_read_only"),
    "node.a11yDescription.ariaLiveMessage": ({ x, y }: { x: number; y: number }) =>
      t("workflows.editor.a11y.moved", { x, y }),
    "edge.a11yDescription.default": t("workflows.editor.a11y.edge"),
    "minimap.ariaLabel": t("workflows.editor.minimap"),
    "handle.ariaLabel": t("workflows.editor.a11y.handle"),
  }),
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- t is a new function on every render, the locale stands for it
  [canEdit, currentLocale]
);
```

et passer `ariaLabelConfig={ariaLabelConfig}` à `ReactFlow`. Vérifier les six clés dans les types installés ; ne passer que celles qui existent.

- [ ] **Step 3: Vérifier et commiter**

Run: `pnpm --filter=web exec vitest run components/workflow/editor` puis `pnpm --filter=web exec tsc --noEmit` puis `pnpm --filter=web exec oxlint --deny-warnings components/workflow/editor/workflow-canvas.tsx components/workflow/editor/workflow-canvas.test.tsx`
Expected: tout passe.

```bash
git add apps/web/components/workflow/editor/workflow-canvas.tsx apps/web/components/workflow/editor/workflow-canvas.test.tsx
git commit -m "feat(web): translate the keyboard instructions of the diagram"
```

---

### Task 17: Nettoyage et vérification finale (spec 9, Y13)

**Files:**

- Modify: `packages/i18n/src/locales/*/workflow.json` (retrait de clés), `docs/superpowers/specs/2026-11-14-workflow-screens-redesign-2-design.md` (statut)

- [ ] **Step 1: Retirer les clés i18n devenues inutiles**

Liste fermée de candidates, sous `workflows.` : `editor.panel.shared`, `editor.panel.incoming`, `editor.panel.outgoing`, `editor.panel.state`, `scheme.default_workflow`, `scheme.per_type`, `scheme.same_as_default`, `scheme.next`, `scheme.back`, `scheme.change`, `scheme.edit_workflow`, `scheme.table.edit_named`.

Pour chacune : la retirer des 22 locales seulement si aucune recherche ne la trouve dans `apps/` et `packages/` hors `locales`, ni par son chemin complet, ni par un préfixe construit par gabarit (`workflows.editor.panel.${`, `workflows.scheme.${`, `workflows.scheme.table.${`, et les constantes de préfixe comme `PREFIX` ou `S`). Aucune autre clé n'est retirée. Lister dans le rapport les clés retirées et les clés gardées avec l'usage qui les garde.

Run: `pnpm --filter=@plane/i18n sync:check` puis `pnpm exec oxfmt --check packages/i18n/src/locales`
Expected: OK.

```bash
git add packages/i18n/src/locales
git commit -m "chore(i18n): drop the workflow texts the redesign no longer uses"
```

- [ ] **Step 2: Suite web complète**

Run: `pnpm --filter=web exec vitest run`, `pnpm --filter=web exec tsc --noEmit`, puis `pnpm -r --if-present run check:format`, `pnpm -r --if-present run check:lint`, `pnpm -r --if-present run check:types` (mêmes scripts que `pnpm check`, sans l'étape de construction de turbo).
Expected: tout passe ; noter le nombre de tests et le nombre d'avertissements de lint de `web` (384 avant ce plan : il ne doit pas augmenter).

- [ ] **Step 3: Suite serveur complète, en arrière-plan**

Run (arrière-plan, environ 40 minutes) : `docker compose -p wfr2-final -f docker-compose-test.yml up --build --abort-on-container-exit --exit-code-from api-tests`, puis `docker compose -p wfr2-final -f docker-compose-test.yml down -v`.
Expected: 0 échec. Le test amont `test_dynamic_fields.py::test_fields_restricts_output_not_input` dépend du DNS : s'il est le seul échec, le rejouer seul et le dire.

Run: `docker exec prototype-jira-api-1 python manage.py makemigrations --check --dry-run`
Expected: « No changes detected ».

- [ ] **Step 4: Statut de la spec**

Dans la spec de la refonte 2, remplacer `- Statut : en relecture` par `- Statut : validée le 2026-11-14 (points O1 à O8 acceptés tels que recommandés)`.

```bash
git add docs/superpowers/specs/2026-11-14-workflow-screens-redesign-2-design.md
git commit -m "docs(workflows): mark the second redesign spec as validated"
```

- [ ] **Step 5: Rapport**

Lister : nombre de tests web et serveur, écarts au plan, clés i18n retirées, langues à marquer `machine_translated`, ce qui n'a pas pu être vérifié hors navigateur (garde de sortie dans l'application, présence entre deux sessions, taille lisible, thème sombre du nouveau panneau, cibles de 44 px). Le parcours manuel des sections 4 et 5 de la spec avec les quatre rôles, `pnpm check` au sens strict, `/qa`, `/ponytail-review` et `/security` reviennent au coordinateur.

---

## Couverture de la spec

| Spec                          | Tâche                                                     |
| ----------------------------- | --------------------------------------------------------- |
| 4.1 Fenêtre de transition     | 1 (logique), 3                                            |
| 4.2 Lien DÉMARRER             | 1 (logique), 4, 7 (ligne « Début »)                       |
| 4.3 Panneau droit             | 4 (départ), 6                                             |
| 4.4 Vue Texte                 | 7                                                         |
| 4.5 État partagé              | 1 (logique), 5 (noms), 6 (encart), 12 (confirmation)      |
| 4.6 Deux admins               | 8, 9, 11, 12, 13                                          |
| 4.7 Quitter avec un brouillon | 12 (signal), 13                                           |
| 4.8 Taille lisible            | 15                                                        |
| 5 Onglet du projet            | 14                                                        |
| 6.1 Empreinte et 409          | 8, 11                                                     |
| 6.2 Présence                  | 9, 11                                                     |
| 6.3 Workflows d'un statut     | 5                                                         |
| 6.4 Transition en double      | 1 (éditeur), 3 (fenêtre), 6 (panneau), 10 (serveur)       |
| 6.5 Contrainte sur les côtés  | 10                                                        |
| 6.6 Invités                   | 5 (serveur), 13 (page)                                    |
| 7 O5 consignes clavier        | 2 (textes), 16                                            |
| 9 Tests, 10 Textes            | chaque tâche ; 2, 17                                      |
| CA-1 à CA-4                   | 3                                                         |
| CA-5 à CA-8, CA-12            | 4 (CA-7 : test serveur existant `initial_state_required`) |
| CA-9 à CA-11, CA-14           | 6                                                         |
| CA-13                         | 7                                                         |
| CA-15, CA-16                  | 12                                                        |
| CA-17 à CA-19                 | 8, 12                                                     |
| CA-20, CA-21                  | 9, 12                                                     |
| CA-22, CA-23                  | 13                                                        |
| CA-24                         | 15, puis essai de l'utilisateur                           |
| CA-25 à CA-29                 | 14 (CA-29 côté serveur : tests existants du système)      |
