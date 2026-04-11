# Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to manage changelog entries at the monorepo level.

## Quick Start

### Creating a changeset

When you make changes that should be documented in the changelog:

```bash
bun changeset
```

This will prompt you to:
1. Describe your changes
2. The changeset will be saved in `.changeset/` directory

### Applying changesets

When ready to update the changelog (typically done by maintainers):

```bash
bun changeset:version
```

This will:
- Update the root `CHANGELOG.md` with all pending changesets
- Remove the applied changeset files

## Important Notes

- **All packages are private and unversioned** - we don't publish packages
- Changesets are used purely for **changelog documentation**
- The `ignore` configuration prevents changesets from trying to version individual packages
- Changes are tracked at the **monorepo level** in the root `CHANGELOG.md`

## Workflow

1. Make your code changes
2. Run `bun changeset` to document what changed
3. Commit both your code and the changeset file
4. When merging to `main`, the **Drone** `release-versions` step can run `changeset version` / tagging when pending changesets exist (see `.drone.yml`). You can also run `bun changeset:version` locally when cutting a release manually.
