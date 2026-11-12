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
